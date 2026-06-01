/**
 * Core type definitions for the Pre-Flight Briefing PWA.
 *
 * The shapes here are the contract between the BFF (Next.js API routes),
 * the FRAT engine, the geospatial utilities and the React UI. Keep them
 * framework-agnostic so the same types can be reused on server and client.
 */

import type { Feature, FeatureCollection, LineString, Polygon, MultiPolygon, Point } from "geojson";

/* -------------------------------------------------------------------------- */
/* Route                                                                      */
/* -------------------------------------------------------------------------- */

export interface RoutePoint {
  /** ICAO identifier, e.g. "LFSB". */
  icao: string;
  name?: string;
  /** Decimal degrees. */
  lat: number;
  lon: number;
  /** Field elevation in feet AMSL, when known. */
  elevationFt?: number;
  role: "departure" | "waypoint" | "destination" | "alternate";
}

export interface Route {
  points: RoutePoint[];
  /** Planned cruise altitude in feet AMSL. */
  altitudeFt: number;
  /** Corridor buffer radius in nautical miles (default 10). */
  bufferNm: number;
  /** Planned departure time (ISO 8601, UTC). */
  etdUtc: string;
  /** Estimated time enroute in minutes. */
  eteMinutes: number;
  /** Route centreline as a GeoJSON LineString (lon,lat order). */
  line: Feature<LineString>;
  /** Buffered corridor polygon used for all spatial filtering. */
  corridor: Feature<Polygon | MultiPolygon>;
}

/* -------------------------------------------------------------------------- */
/* Meteorology                                                                */
/* -------------------------------------------------------------------------- */

export type FlightRule = "VFR" | "MVFR" | "IFR" | "LIFR";

export interface SurfaceWind {
  /** Direction in degrees true. `null` for variable/calm. */
  directionDeg: number | null;
  speedKt: number;
  gustKt?: number;
  variable?: boolean;
}

export interface Metar {
  icao: string;
  raw: string;
  observedUtc: string;
  wind: SurfaceWind;
  /** Prevailing visibility in statute miles. */
  visibilitySm: number | null;
  /** Lowest broken/overcast ceiling in feet AGL. `null` = no ceiling reported. */
  ceilingFt: number | null;
  temperatureC?: number;
  dewpointC?: number;
  altimeterHpa?: number;
  flightRule: FlightRule;
}

export interface Taf {
  icao: string;
  raw: string;
  issuedUtc: string;
  validFromUtc: string;
  validToUtc: string;
  forecasts: TafForecast[];
}

export interface TafForecast {
  fromUtc: string;
  toUtc: string;
  changeType: "FM" | "BECMG" | "TEMPO" | "PROB" | "BASE";
  wind: SurfaceWind;
  visibilitySm: number | null;
  ceilingFt: number | null;
  flightRule: FlightRule;
}

export interface WindsAloft {
  /** Station or grid point id. */
  id: string;
  lat: number;
  lon: number;
  levels: WindsAloftLevel[];
}

export interface WindsAloftLevel {
  altitudeFt: number;
  directionDeg: number;
  speedKt: number;
  temperatureC?: number;
}

export type SigmetHazard =
  | "CONVECTIVE"
  | "TURBULENCE"
  | "ICING"
  | "IFR"
  | "MOUNTAIN_WAVE"
  | "VOLCANIC_ASH"
  | "FREEZING_LEVEL"
  | "OTHER";

export interface Sigmet {
  id: string;
  hazard: SigmetHazard;
  severity?: "LIGHT" | "MODERATE" | "SEVERE";
  raw: string;
  validFromUtc: string;
  validToUtc: string;
  /** Affected area. Some products are line/point based. */
  geometry: Feature<Polygon | MultiPolygon | LineString | Point>;
  /** Base/top in feet AMSL where published. */
  baseFt?: number;
  topFt?: number;
}

export interface MeteoData {
  metars: Metar[];
  tafs: Taf[];
  windsAloft: WindsAloft[];
  sigmets: Sigmet[];
  fetchedUtc: string;
}

/* -------------------------------------------------------------------------- */
/* Airspace & Airports                                                        */
/* -------------------------------------------------------------------------- */

export type AirspaceClass =
  | "A" | "B" | "C" | "D" | "E" | "F" | "G"
  | "PROHIBITED" | "RESTRICTED" | "DANGER" | "TMA" | "CTR" | "OTHER";

export interface Airspace {
  id: string;
  name: string;
  class: AirspaceClass;
  /** ICAO designator, e.g. "LS-R7" / "ED-R" / "EDR136". */
  designator?: string;
  lowerFt: number;
  upperFt: number;
  /** True if lower limit is referenced to ground (AGL) rather than AMSL. */
  lowerIsAgl?: boolean;
  geometry: Feature<Polygon | MultiPolygon>;
  /** Activity schedule, when published (free text from source). */
  activity?: string;
}

export interface Frequency {
  type: string; // TWR, GND, ATIS, APP, AFIS, ...
  name?: string;
  mhz: number;
}

export interface Airport {
  icao: string;
  name: string;
  lat: number;
  lon: number;
  elevationFt: number;
  runways: Runway[];
  frequencies: Frequency[];
}

export interface Runway {
  designator: string; // e.g. "15/33"
  headingDeg: number; // magnetic heading of the lower-numbered end
  lengthM: number;
  surface?: string;
  closed?: boolean;
}

export interface AirspaceData {
  airspaces: Airspace[];
  airports: Airport[];
  fetchedUtc: string;
}

/* -------------------------------------------------------------------------- */
/* NOTAMs                                                                      */
/* -------------------------------------------------------------------------- */

export type NotamCategory =
  | "RUNWAY"
  | "TAXIWAY"
  | "AIRSPACE"
  | "NAVAID"
  | "OBSTACLE"
  | "LIGHTING"
  | "GPS_RAIM"
  | "OTHER";

export interface Notam {
  id: string;
  icao?: string;
  category: NotamCategory;
  /** Decoded one-line summary where available, else the Q/E field text. */
  summary: string;
  raw: string;
  effectiveFromUtc: string;
  effectiveToUtc: string | "PERM";
  /** Point the NOTAM is anchored to (Q-line coordinates or station). */
  location?: Feature<Point>;
  /** True when this NOTAM closes a runway. */
  closesRunway?: boolean;
}

export interface NotamData {
  notams: Notam[];
  fetchedUtc: string;
}

/* -------------------------------------------------------------------------- */
/* FRAT inputs                                                                 */
/* -------------------------------------------------------------------------- */

export interface PilotInputs {
  totalHours: number;
  hoursOnType: number;
  hoursLast90Days: number;
  /** Subjective sleep quality, 1 (poor) – 5 (excellent). */
  sleepQuality: 1 | 2 | 3 | 4 | 5;
  instrumentRated: boolean;
  currentForNight?: boolean;
}

export interface AircraftInputs {
  model: string;
  /** Demonstrated/published crosswind limit in knots. */
  crosswindLimitKt: number;
  /** Planned fuel reserve in minutes at destination. */
  fuelReserveMinutes: number;
  /** True if the aircraft is approved & equipped for IFR. */
  ifrCapable: boolean;
}

/* -------------------------------------------------------------------------- */
/* Risk assessment output                                                      */
/* -------------------------------------------------------------------------- */

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "NO_GO";

/** A single contributing factor inside one PAVE category. */
export interface RiskFactor {
  /** Stable machine key, e.g. "xwind.LFSB". */
  code: string;
  label: string;
  level: RiskLevel;
  points: number;
  /** Human-readable explanation shown verbatim in the UI. */
  detail: string;
}

export type PaveCategory = "PILOT" | "AIRCRAFT" | "ENVIRONMENT" | "EXTERNAL";

export interface CategoryScore {
  category: PaveCategory;
  score: number;
  level: RiskLevel;
  factors: RiskFactor[];
}

export interface RiskAssessment {
  /** PAVE breakdown. */
  categories: CategoryScore[];
  /** Sum of every factor's points. */
  totalScore: number;
  /** Worst-case rollup level across all categories. */
  overallLevel: RiskLevel;
  /** True when any factor forces a hard No-Go. */
  noGo: boolean;
  /** Ordered, actionable mitigation strings for the pilot. */
  mitigations: string[];
  computedUtc: string;
}

/* -------------------------------------------------------------------------- */
/* Aggregate briefing payload (what gets stored in IndexedDB)                  */
/* -------------------------------------------------------------------------- */

export interface Briefing {
  /** Stable id used as the IndexedDB key (e.g. route + ETD hash). */
  id: string;
  generatedUtc: string;
  route: Route;
  pilot: PilotInputs;
  aircraft: AircraftInputs;
  meteo: MeteoData;
  airspace: AirspaceData;
  notams: NotamData;
  risk: RiskAssessment;
  /** Spatially filtered subset that actually intersects the corridor. */
  corridor: {
    airspaces: Airspace[];
    notams: Notam[];
    sigmets: Sigmet[];
  };
  /** Tile coordinates pre-cached for offline map viewing. */
  cachedTiles?: TileCoord[];
}

export interface TileCoord {
  z: number;
  x: number;
  y: number;
}

/** Convenience alias for any GeoJSON we hand to Leaflet. */
export type AnyFeatureCollection = FeatureCollection;
