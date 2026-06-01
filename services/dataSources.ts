/**
 * Open-source aviation data adapters.
 *
 * These functions run on the server (Next.js API routes / BFF) so they double
 * as a CORS proxy. Each adapter normalizes a third-party response into the
 * internal types from `types/briefing.ts`.
 *
 * Sources:
 *   - aviationweather.gov  → METAR / TAF / SIGMET (public, no key, JSON output)
 *   - OpenAIP              → airspace + airport/runway/frequency (needs API key)
 *   - NOTAMs               → pluggable; bbox-filtered free feed (needs config)
 *
 * Adapters degrade gracefully: a failing/unconfigured source returns an empty
 * (but well-formed) slice rather than failing the whole briefing.
 */

import type { Feature, Point, Polygon, MultiPolygon } from "geojson";
import type {
  Airport,
  Airspace,
  AirspaceClass,
  FlightRule,
  Metar,
  Notam,
  RoutePoint,
  Sigmet,
  Taf,
  WindsAloft,
} from "../types/briefing";

const AWC = "https://aviationweather.gov/api/data";

async function getJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, { ...init, next: { revalidate: 0 } } as RequestInit);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Flight-rule derivation                                                     */
/* -------------------------------------------------------------------------- */

export function deriveFlightRule(
  ceilingFt: number | null,
  visibilitySm: number | null
): FlightRule {
  const ceil = ceilingFt ?? Infinity;
  const vis = visibilitySm ?? 99;
  if (ceil < 500 || vis < 1) return "LIFR";
  if (ceil < 1000 || vis < 3) return "IFR";
  if (ceil <= 3000 || vis <= 5) return "MVFR";
  return "VFR";
}

/* -------------------------------------------------------------------------- */
/* METAR                                                                      */
/* -------------------------------------------------------------------------- */

interface AwcMetar {
  icaoId: string;
  rawOb: string;
  obsTime: number; // epoch seconds
  lat: number;
  lon: number;
  wdir: number | "VRB" | null;
  wspd: number | null;
  wgst: number | null;
  visib: number | string | null;
  temp: number | null;
  dewp: number | null;
  altim: number | null;
  clouds?: { cover: string; base: number | null }[];
  elev?: number | null;
}

function lowestCeiling(clouds: AwcMetar["clouds"]): number | null {
  if (!clouds) return null;
  const ceil = clouds
    .filter((c) => c.cover === "BKN" || c.cover === "OVC")
    .map((c) => c.base)
    .filter((b): b is number => typeof b === "number");
  return ceil.length ? Math.min(...ceil) : null;
}

function parseVisib(v: AwcMetar["visib"]): number | null {
  if (v == null) return null;
  if (typeof v === "number") return v;
  // strings like "10+" or "6SM"
  const n = parseFloat(String(v).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export async function fetchMetars(icaos: string[]): Promise<Metar[]> {
  if (!icaos.length) return [];
  const url = `${AWC}/metar?ids=${icaos.join(",")}&format=json`;
  const raw = await getJson<AwcMetar[]>(url);
  if (!raw) return [];
  return raw.map((m) => {
    const ceilingFt = lowestCeiling(m.clouds);
    const visibilitySm = parseVisib(m.visib);
    return {
      icao: m.icaoId,
      raw: m.rawOb,
      observedUtc: new Date((m.obsTime ?? 0) * 1000).toISOString(),
      wind: {
        directionDeg: m.wdir === "VRB" || m.wdir == null ? null : m.wdir,
        speedKt: m.wspd ?? 0,
        gustKt: m.wgst ?? undefined,
        variable: m.wdir === "VRB",
      },
      visibilitySm,
      ceilingFt,
      temperatureC: m.temp ?? undefined,
      dewpointC: m.dewp ?? undefined,
      altimeterHpa: m.altim ?? undefined,
      flightRule: deriveFlightRule(ceilingFt, visibilitySm),
    } satisfies Metar;
  });
}

/** METARs carry lat/lon, so this doubles as an ICAO → coordinate resolver. */
export async function resolveAirportCoords(
  icao: string
): Promise<RoutePoint | undefined> {
  const url = `${AWC}/metar?ids=${icao}&format=json`;
  const raw = await getJson<AwcMetar[]>(url);
  const hit = raw?.[0];
  if (!hit || hit.lat == null || hit.lon == null) return undefined;
  return {
    icao: hit.icaoId,
    lat: hit.lat,
    lon: hit.lon,
    elevationFt: hit.elev ?? undefined,
    role: "waypoint",
  };
}

/* -------------------------------------------------------------------------- */
/* TAF                                                                        */
/* -------------------------------------------------------------------------- */

interface AwcTaf {
  icaoId: string;
  rawTAF: string;
  issueTime: string;
  validTimeFrom: number;
  validTimeTo: number;
  fcsts?: {
    timeFrom: number;
    timeTo: number;
    fcstChange?: string;
    wdir?: number | "VRB";
    wspd?: number;
    wgst?: number;
    visib?: number | string;
    clouds?: { cover: string; base: number | null }[];
  }[];
}

export async function fetchTafs(icaos: string[]): Promise<Taf[]> {
  if (!icaos.length) return [];
  const url = `${AWC}/taf?ids=${icaos.join(",")}&format=json`;
  const raw = await getJson<AwcTaf[]>(url);
  if (!raw) return [];
  return raw.map((t) => ({
    icao: t.icaoId,
    raw: t.rawTAF,
    issuedUtc: t.issueTime,
    validFromUtc: new Date(t.validTimeFrom * 1000).toISOString(),
    validToUtc: new Date(t.validTimeTo * 1000).toISOString(),
    forecasts: (t.fcsts ?? []).map((f) => {
      const ceilingFt = lowestCeiling(f.clouds);
      const visibilitySm = parseVisib(f.visib ?? null);
      return {
        fromUtc: new Date(f.timeFrom * 1000).toISOString(),
        toUtc: new Date(f.timeTo * 1000).toISOString(),
        changeType: (f.fcstChange as Taf["forecasts"][number]["changeType"]) ?? "BASE",
        wind: {
          directionDeg: f.wdir === "VRB" || f.wdir == null ? null : f.wdir,
          speedKt: f.wspd ?? 0,
          gustKt: f.wgst,
          variable: f.wdir === "VRB",
        },
        visibilitySm,
        ceilingFt,
        flightRule: deriveFlightRule(ceilingFt, visibilitySm),
      };
    }),
  }));
}

/* -------------------------------------------------------------------------- */
/* SIGMET / G-AIRMET                                                          */
/* -------------------------------------------------------------------------- */

interface AwcSigmet {
  airSigmetId?: string | number;
  hazard?: string;
  severity?: string | number;
  rawAirSigmet?: string;
  validTimeFrom?: number;
  validTimeTo?: number;
  altitudeLow1?: number;
  altitudeHi1?: number;
  coords?: { lat: number; lon: number }[];
}

function mapHazard(h?: string): Sigmet["hazard"] {
  switch ((h ?? "").toUpperCase()) {
    case "CONVECTIVE":
    case "TS":
      return "CONVECTIVE";
    case "TURB":
      return "TURBULENCE";
    case "ICE":
    case "ICING":
      return "ICING";
    case "IFR":
      return "IFR";
    case "MTW":
      return "MOUNTAIN_WAVE";
    case "ASH":
      return "VOLCANIC_ASH";
    default:
      return "OTHER";
  }
}

export async function fetchSigmets(): Promise<Sigmet[]> {
  const url = `${AWC}/airsigmet?format=json`;
  const raw = await getJson<AwcSigmet[]>(url);
  if (!raw) return [];
  return raw
    .filter((s) => s.coords && s.coords.length >= 3)
    .map((s) => {
      const ring = s.coords!.map((c) => [c.lon, c.lat]);
      // Close the ring for a valid polygon.
      if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
        ring.push(ring[0]);
      }
      const geometry: Feature<Polygon> = {
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: [ring] },
      };
      return {
        id: String(s.airSigmetId ?? Math.random().toString(36).slice(2)),
        hazard: mapHazard(s.hazard),
        raw: s.rawAirSigmet ?? "",
        validFromUtc: new Date((s.validTimeFrom ?? 0) * 1000).toISOString(),
        validToUtc: new Date((s.validTimeTo ?? 0) * 1000).toISOString(),
        baseFt: s.altitudeLow1,
        topFt: s.altitudeHi1,
        geometry,
      } satisfies Sigmet;
    });
}

/* -------------------------------------------------------------------------- */
/* OpenAIP airspace + airports (requires OPENAIP_API_KEY)                     */
/* -------------------------------------------------------------------------- */

const OPENAIP_KEY = process.env.OPENAIP_API_KEY;
const OPENAIP = "https://api.core.openaip.net/api";

function mapAirspaceClass(t: number | string | undefined): AirspaceClass {
  // OpenAIP encodes type numerically; map the common ones.
  const m: Record<string, AirspaceClass> = {
    "0": "OTHER",
    "1": "RESTRICTED",
    "2": "DANGER",
    "3": "PROHIBITED",
    "4": "CTR",
    "21": "TMA",
  };
  return m[String(t)] ?? "OTHER";
}

export async function fetchAirspaces(
  bbox: [number, number, number, number]
): Promise<Airspace[]> {
  if (!OPENAIP_KEY) return [];
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const url = `${OPENAIP}/airspaces?bbox=${minLon},${minLat},${maxLon},${maxLat}&limit=1000`;
  const data = await getJson<{ items?: any[] }>(url, {
    headers: { "x-openaip-client-id": OPENAIP_KEY },
  });
  const items = data?.items ?? [];
  return items
    .filter((a) => a.geometry)
    .map((a) => ({
      id: String(a._id ?? a.id),
      name: a.name ?? "Airspace",
      class: mapAirspaceClass(a.type),
      designator: a.icaoClass ?? a.name,
      lowerFt: a.lowerLimit?.value ?? 0,
      upperFt: a.upperLimit?.value ?? 0,
      lowerIsAgl: a.lowerLimit?.referenceDatum === 1,
      activity: a.activity != null ? String(a.activity) : undefined,
      geometry: {
        type: "Feature",
        properties: { name: a.name, class: a.type },
        geometry: a.geometry,
      } as Feature<Polygon | MultiPolygon>,
    }));
}

export async function fetchAirports(icaos: string[]): Promise<Airport[]> {
  if (!OPENAIP_KEY || !icaos.length) return [];
  const out: Airport[] = [];
  for (const icao of icaos) {
    const data = await getJson<{ items?: any[] }>(
      `${OPENAIP}/airports?search=${icao}&limit=1`,
      { headers: { "x-openaip-client-id": OPENAIP_KEY } }
    );
    const a = data?.items?.[0];
    if (!a) continue;
    out.push({
      icao: a.icaoCode ?? icao,
      name: a.name ?? icao,
      lat: a.geometry?.coordinates?.[1] ?? 0,
      lon: a.geometry?.coordinates?.[0] ?? 0,
      elevationFt: a.elevation?.value ?? 0,
      runways: (a.runways ?? []).map((r: any) => ({
        designator: r.designator ?? "",
        headingDeg: r.trueHeading ?? 0,
        lengthM: r.dimension?.length?.value ?? 0,
        surface: r.surface?.mainComposite,
        closed: r.operations?.status === 2,
      })),
      frequencies: (a.frequencies ?? []).map((f: any) => ({
        type: f.type ?? "",
        name: f.name,
        mhz: f.value ? parseFloat(f.value) : 0,
      })),
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* NOTAMs (pluggable; configure NOTAM_API_URL to enable)                      */
/* -------------------------------------------------------------------------- */

const NOTAM_API_URL = process.env.NOTAM_API_URL;

export async function fetchNotams(icaos: string[]): Promise<Notam[]> {
  if (!NOTAM_API_URL || !icaos.length) return [];
  const data = await getJson<{ notams?: any[] }>(
    `${NOTAM_API_URL}?locations=${icaos.join(",")}`
  );
  const items = data?.notams ?? [];
  return items.map((n: any) => {
    const closesRunway = /\bRWY\b.*\bCLSD\b/i.test(n.text ?? n.summary ?? "");
    const location: Feature<Point> | undefined =
      n.lat != null && n.lon != null
        ? {
            type: "Feature",
            properties: {},
            geometry: { type: "Point", coordinates: [n.lon, n.lat] },
          }
        : undefined;
    return {
      id: String(n.id ?? n.notamId),
      icao: n.location ?? n.icao,
      category: closesRunway ? "RUNWAY" : "OTHER",
      summary: n.summary ?? n.text ?? "",
      raw: n.text ?? "",
      effectiveFromUtc: n.effectiveStart ?? new Date().toISOString(),
      effectiveToUtc: n.effectiveEnd ?? "PERM",
      location,
      closesRunway,
    } satisfies Notam;
  });
}

/* Winds aloft is exposed by AWC but format-heavy; stubbed empty for now. */
export async function fetchWindsAloft(): Promise<WindsAloft[]> {
  return [];
}
