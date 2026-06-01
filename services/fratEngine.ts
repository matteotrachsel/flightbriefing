/**
 * Flight Risk Assessment Tool (FRAT) engine.
 *
 * Pure, deterministic business logic — no I/O, no framework imports — so it
 * can run inside a Next.js API route, an edge function, or a unit test.
 *
 * It scores a flight against the PAVE model (Pilot, Aircraft, enVironment,
 * External pressures) and returns a structured {@link RiskAssessment}.
 *
 * Scoring philosophy:
 *   - Every contributing condition emits a {@link RiskFactor} with points.
 *   - Points roll up per category and into a cumulative total.
 *   - A category's level is the worst factor it contains.
 *   - Certain conditions (e.g. IFR with a non-instrument-rated pilot) set a
 *     hard `noGo` flag regardless of the numerical total.
 */

import type { Feature, LineString } from "geojson";
import booleanIntersects from "@turf/boolean-intersects";

import type {
  AircraftInputs,
  CategoryScore,
  FlightRule,
  Metar,
  MeteoData,
  Notam,
  NotamData,
  PaveCategory,
  PilotInputs,
  RiskAssessment,
  RiskFactor,
  RiskLevel,
  SurfaceWind,
} from "../types/briefing";

/* -------------------------------------------------------------------------- */
/* Tunable risk matrix                                                        */
/* -------------------------------------------------------------------------- */

export const POINTS = {
  LOW: 0,
  MEDIUM: 4,
  HIGH: 10,
  NO_GO: 100,
} as const;

/** Total-score thresholds for the overall rollup. */
export const THRESHOLDS = {
  /** <= this is LOW (green). */
  low: 10,
  /** <= this is MEDIUM (amber); above is HIGH (red). */
  medium: 25,
} as const;

const LEVEL_RANK: Record<RiskLevel, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  NO_GO: 3,
};

function worst(a: RiskLevel, b: RiskLevel): RiskLevel {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}

function rollupLevel(factors: RiskFactor[]): RiskLevel {
  return factors.reduce<RiskLevel>((acc, f) => worst(acc, f.level), "LOW");
}

function makeCategory(
  category: PaveCategory,
  factors: RiskFactor[]
): CategoryScore {
  return {
    category,
    factors,
    score: factors.reduce((s, f) => s + f.points, 0),
    level: rollupLevel(factors),
  };
}

/* -------------------------------------------------------------------------- */
/* Wind / crosswind maths                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Crosswind component for a wind against a runway heading.
 * Uses the gust value when present (most conservative).
 */
export function crosswindComponent(
  wind: SurfaceWind,
  runwayHeadingDeg: number
): number {
  if (wind.directionDeg == null) return 0; // variable/calm
  const speed = Math.max(wind.speedKt, wind.gustKt ?? 0);
  const angle = ((wind.directionDeg - runwayHeadingDeg + 540) % 360) - 180;
  return Math.abs(speed * Math.sin((angle * Math.PI) / 180));
}

/**
 * Without runway data we can't know the exact crosswind, so we treat the full
 * surface wind speed as a worst-case crosswind. This keeps the engine usable
 * even when OpenAIP runway headings are missing.
 */
function worstCaseCrosswind(wind: SurfaceWind): number {
  return Math.max(wind.speedKt, wind.gustKt ?? 0);
}

/* -------------------------------------------------------------------------- */
/* PILOT                                                                       */
/* -------------------------------------------------------------------------- */

function scorePilot(pilot: PilotInputs): CategoryScore {
  const factors: RiskFactor[] = [];

  if (pilot.totalHours < 100) {
    factors.push({
      code: "pilot.totalHours",
      label: "Low total time",
      level: "MEDIUM",
      points: POINTS.MEDIUM,
      detail: `Total time ${pilot.totalHours}h is below the 100h experience floor.`,
    });
  }

  if (pilot.hoursOnType < 25) {
    factors.push({
      code: "pilot.onType",
      label: "Low time on type",
      level: pilot.hoursOnType < 10 ? "HIGH" : "MEDIUM",
      points: pilot.hoursOnType < 10 ? POINTS.HIGH : POINTS.MEDIUM,
      detail: `Only ${pilot.hoursOnType}h on the aircraft type.`,
    });
  }

  if (pilot.hoursLast90Days < 10) {
    factors.push({
      code: "pilot.recency",
      label: "Limited recent experience",
      level: pilot.hoursLast90Days < 3 ? "HIGH" : "MEDIUM",
      points: pilot.hoursLast90Days < 3 ? POINTS.HIGH : POINTS.MEDIUM,
      detail: `${pilot.hoursLast90Days}h flown in the last 90 days — recency is marginal.`,
    });
  }

  if (pilot.sleepQuality <= 2) {
    factors.push({
      code: "pilot.fatigue",
      label: "Fatigue risk",
      level: pilot.sleepQuality === 1 ? "HIGH" : "MEDIUM",
      points: pilot.sleepQuality === 1 ? POINTS.HIGH : POINTS.MEDIUM,
      detail: `Reported sleep quality ${pilot.sleepQuality}/5 indicates elevated fatigue risk.`,
    });
  }

  return makeCategory("PILOT", factors);
}

/* -------------------------------------------------------------------------- */
/* AIRCRAFT                                                                    */
/* -------------------------------------------------------------------------- */

function scoreAircraft(aircraft: AircraftInputs): CategoryScore {
  const factors: RiskFactor[] = [];

  if (aircraft.fuelReserveMinutes < 30) {
    factors.push({
      code: "aircraft.fuel",
      label: "Marginal fuel reserve",
      level: aircraft.fuelReserveMinutes < 20 ? "HIGH" : "MEDIUM",
      points:
        aircraft.fuelReserveMinutes < 20 ? POINTS.HIGH : POINTS.MEDIUM,
      detail: `Planned reserve of ${aircraft.fuelReserveMinutes} min is below the 30 min VFR minimum.`,
    });
  }

  if (aircraft.crosswindLimitKt <= 0) {
    factors.push({
      code: "aircraft.xwindLimit",
      label: "Missing crosswind limit",
      level: "MEDIUM",
      points: POINTS.MEDIUM,
      detail:
        "No demonstrated crosswind limit supplied — wind risk cannot be fully evaluated.",
    });
  }

  return makeCategory("AIRCRAFT", factors);
}

/* -------------------------------------------------------------------------- */
/* ENVIRONMENT (the data-driven core)                                         */
/* -------------------------------------------------------------------------- */

/** METARs/TAFs at these fields drive wind & ceiling risk. */
function endpointIcaos(
  routeGeoJson: Feature<LineString> | undefined,
  meteo: MeteoData,
  endpoints: string[]
): Metar[] {
  const wanted = new Set(endpoints.map((i) => i.toUpperCase()));
  const found = meteo.metars.filter((m) => wanted.has(m.icao.toUpperCase()));
  // If endpoints weren't supplied, fall back to every METAR we have.
  return found.length ? found : meteo.metars;
}

function scoreWind(
  metars: Metar[],
  aircraft: AircraftInputs
): RiskFactor[] {
  const factors: RiskFactor[] = [];
  const limit = aircraft.crosswindLimitKt;
  if (limit <= 0) return factors; // handled in aircraft category

  for (const m of metars) {
    // Worst-case crosswind because we may not have a specific runway heading.
    const xwind = worstCaseCrosswind(m.wind);
    const ratio = xwind / limit;

    if (ratio >= 1.0) {
      factors.push({
        code: `xwind.${m.icao}`,
        label: `Crosswind exceeds limit at ${m.icao}`,
        level: "HIGH",
        points: POINTS.HIGH,
        detail: `Crosswind component at ${m.icao} is ${Math.round(
          xwind
        )}kt, at or above the ${limit}kt aircraft maximum.`,
      });
    } else if (ratio >= 0.7) {
      factors.push({
        code: `xwind.${m.icao}`,
        label: `High crosswind at ${m.icao}`,
        level: "MEDIUM",
        points: POINTS.MEDIUM,
        detail: `Crosswind component at ${m.icao} is ${Math.round(
          xwind
        )}kt, exceeding 70% of the ${limit}kt aircraft maximum.`,
      });
    }

    if (m.wind.gustKt && m.wind.gustKt - m.wind.speedKt >= 10) {
      factors.push({
        code: `gust.${m.icao}`,
        label: `Gusty conditions at ${m.icao}`,
        level: "MEDIUM",
        points: POINTS.MEDIUM,
        detail: `Gusts to ${m.wind.gustKt}kt (spread of ${
          m.wind.gustKt - m.wind.speedKt
        }kt) reported at ${m.icao}.`,
      });
    }
  }
  return factors;
}

function ceilingFactorFor(
  rule: FlightRule,
  icao: string,
  source: "METAR" | "TAF",
  pilotInstrumentRated: boolean,
  aircraftIfrCapable: boolean
): RiskFactor | null {
  switch (rule) {
    case "VFR":
      return null;
    case "MVFR":
      return {
        code: `wx.${source}.${icao}`,
        label: `Marginal VFR at ${icao}`,
        level: "MEDIUM",
        points: POINTS.MEDIUM,
        detail: `${source} indicates MVFR conditions at ${icao} — reduced ceiling/visibility margin.`,
      };
    case "IFR":
    case "LIFR": {
      const noInstrument = !pilotInstrumentRated || !aircraftIfrCapable;
      return {
        code: `wx.${source}.${icao}`,
        label: `${rule} conditions at ${icao}`,
        level: noInstrument ? "NO_GO" : "HIGH",
        points: noInstrument ? POINTS.NO_GO : POINTS.HIGH,
        detail: noInstrument
          ? `${source} reports ${rule} at ${icao}. ${
              !pilotInstrumentRated
                ? "Pilot holds no instrument rating"
                : "Aircraft is not IFR-capable"
            } — automatic No-Go.`
          : `${source} reports ${rule} conditions at ${icao}. IFR currency and approach planning required.`,
      };
    }
  }
}

function scoreCeilingVisibility(
  meteo: MeteoData,
  endpoints: string[],
  pilot: PilotInputs,
  aircraft: AircraftInputs
): RiskFactor[] {
  const factors: RiskFactor[] = [];
  const wanted = new Set(endpoints.map((i) => i.toUpperCase()));
  const useMetar = (icao: string) =>
    wanted.size === 0 || wanted.has(icao.toUpperCase());

  for (const m of meteo.metars) {
    if (!useMetar(m.icao)) continue;
    const f = ceilingFactorFor(
      m.flightRule,
      m.icao,
      "METAR",
      pilot.instrumentRated,
      aircraft.ifrCapable
    );
    if (f) factors.push(f);
  }

  // TAF: take the worst flight rule across the forecast period per field.
  for (const taf of meteo.tafs) {
    if (!useMetar(taf.icao)) continue;
    const worstRule = taf.forecasts.reduce<FlightRule>(
      (acc, fc) => worstFlightRule(acc, fc.flightRule),
      "VFR"
    );
    const f = ceilingFactorFor(
      worstRule,
      taf.icao,
      "TAF",
      pilot.instrumentRated,
      aircraft.ifrCapable
    );
    if (f) factors.push(f);
  }

  return factors;
}

const RULE_RANK: Record<FlightRule, number> = {
  VFR: 0,
  MVFR: 1,
  IFR: 2,
  LIFR: 3,
};
function worstFlightRule(a: FlightRule, b: FlightRule): FlightRule {
  return RULE_RANK[a] >= RULE_RANK[b] ? a : b;
}

function scoreEnrouteHazards(
  meteo: MeteoData,
  routeGeoJson: Feature<LineString> | undefined
): RiskFactor[] {
  const factors: RiskFactor[] = [];
  if (!routeGeoJson) return factors;

  for (const s of meteo.sigmets) {
    let hits = false;
    try {
      hits = booleanIntersects(routeGeoJson, s.geometry);
    } catch {
      hits = false;
    }
    if (!hits) continue;

    const isConvectiveOrIce =
      s.hazard === "CONVECTIVE" ||
      s.hazard === "ICING" ||
      s.hazard === "FREEZING_LEVEL";

    factors.push({
      code: `sigmet.${s.id}`,
      label: `${s.hazard} hazard on route`,
      level: isConvectiveOrIce ? "HIGH" : "MEDIUM",
      points: isConvectiveOrIce ? POINTS.HIGH : POINTS.MEDIUM,
      detail: `Route penetrates an active ${s.hazard} SIGMET (valid to ${s.validToUtc}).`,
    });
  }
  return factors;
}

function scoreEnvironment(
  meteo: MeteoData,
  routeGeoJson: Feature<LineString> | undefined,
  endpoints: string[],
  pilot: PilotInputs,
  aircraft: AircraftInputs
): CategoryScore {
  const factors: RiskFactor[] = [
    ...scoreWind(endpointIcaos(routeGeoJson, meteo, endpoints), aircraft),
    ...scoreCeilingVisibility(meteo, endpoints, pilot, aircraft),
    ...scoreEnrouteHazards(meteo, routeGeoJson),
  ];
  return makeCategory("ENVIRONMENT", factors);
}

/* -------------------------------------------------------------------------- */
/* EXTERNAL (airspace + NOTAM pressures)                                      */
/* -------------------------------------------------------------------------- */

function scoreExternal(
  notamData: NotamData,
  endpoints: string[]
): CategoryScore {
  const factors: RiskFactor[] = [];
  const endpointSet = new Set(endpoints.map((i) => i.toUpperCase()));

  for (const n of notamData.notams) {
    if (n.closesRunway || n.category === "RUNWAY") {
      const atEndpoint = n.icao && endpointSet.has(n.icao.toUpperCase());
      factors.push({
        code: `notam.${n.id}`,
        label: `Runway NOTAM${n.icao ? ` at ${n.icao}` : ""}`,
        level: atEndpoint ? "HIGH" : "MEDIUM",
        points: atEndpoint ? POINTS.HIGH : POINTS.MEDIUM,
        detail: `${n.summary} (effective to ${n.effectiveToUtc}).`,
      });
    } else if (n.category === "AIRSPACE") {
      factors.push({
        code: `notam.${n.id}`,
        label: "Airspace NOTAM on route",
        level: "MEDIUM",
        points: POINTS.MEDIUM,
        detail: `${n.summary} (effective to ${n.effectiveToUtc}).`,
      });
    }
  }

  return makeCategory("EXTERNAL", factors);
}

/* -------------------------------------------------------------------------- */
/* Mitigations                                                                 */
/* -------------------------------------------------------------------------- */

function buildMitigations(categories: CategoryScore[]): string[] {
  const out: string[] = [];
  const all = categories.flatMap((c) => c.factors);

  if (all.some((f) => f.code.startsWith("xwind."))) {
    out.push(
      "Brief a crosswind landing technique and identify a more favourably-aligned runway or alternate."
    );
  }
  if (all.some((f) => f.code.startsWith("wx.") && f.level === "NO_GO")) {
    out.push(
      "Conditions are below VFR minima for this pilot/aircraft — delay departure or file IFR with a qualified crew."
    );
  } else if (all.some((f) => f.code.startsWith("wx."))) {
    out.push(
      "Plan a weather hold/diversion strategy and confirm an alternate with better ceiling and visibility."
    );
  }
  if (all.some((f) => f.code.startsWith("sigmet."))) {
    out.push(
      "Re-route around the active SIGMET area or delay until the convective/icing hazard clears."
    );
  }
  if (all.some((f) => f.code.startsWith("notam."))) {
    out.push(
      "Re-read affected NOTAMs aloud during planning and confirm runway/airspace availability before departure."
    );
  }
  if (all.some((f) => f.code === "pilot.fatigue")) {
    out.push("Consider postponing — fatigue significantly degrades decision-making.");
  }
  if (all.some((f) => f.code === "aircraft.fuel")) {
    out.push("Increase fuel uplift to restore a minimum 45-minute reserve.");
  }

  if (out.length === 0) {
    out.push("No elevated risks detected. Maintain standard vigilance and continue normal preflight checks.");
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Public entry point                                                          */
/* -------------------------------------------------------------------------- */

export interface FratContext {
  /** ICAO codes whose surface weather drives wind/ceiling risk (dep + dest + alternates). */
  endpointIcaos: string[];
}

/**
 * Calculate the full flight risk assessment.
 *
 * @param pilotInputs   Static pilot/crew inputs.
 * @param aircraftInputs Static aircraft inputs + performance limits.
 * @param meteoData     Live METAR/TAF/SIGMET payload.
 * @param notams        Corridor-filtered NOTAMs.
 * @param routeGeoJson  Route centreline (used for SIGMET intersection).
 * @param context       Which ICAOs are the wind/ceiling endpoints.
 */
export function calculateFlightRisk(
  pilotInputs: PilotInputs,
  aircraftInputs: AircraftInputs,
  meteoData: MeteoData,
  notams: NotamData,
  routeGeoJson: Feature<LineString> | undefined,
  context: FratContext = { endpointIcaos: [] }
): RiskAssessment {
  const categories: CategoryScore[] = [
    scorePilot(pilotInputs),
    scoreAircraft(aircraftInputs),
    scoreEnvironment(
      meteoData,
      routeGeoJson,
      context.endpointIcaos,
      pilotInputs,
      aircraftInputs
    ),
    scoreExternal(notams, context.endpointIcaos),
  ];

  const totalScore = categories.reduce((s, c) => s + c.score, 0);
  const noGo = categories.some((c) =>
    c.factors.some((f) => f.level === "NO_GO")
  );

  const overallLevel: RiskLevel = noGo
    ? "NO_GO"
    : totalScore <= THRESHOLDS.low
    ? "LOW"
    : totalScore <= THRESHOLDS.medium
    ? "MEDIUM"
    : "HIGH";

  return {
    categories,
    totalScore,
    overallLevel,
    noGo,
    mitigations: buildMitigations(categories),
    computedUtc: new Date().toISOString(),
  };
}
