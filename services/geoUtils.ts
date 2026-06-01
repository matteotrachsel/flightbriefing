/**
 * Geospatial helpers built on Turf.js.
 *
 * Responsibilities:
 *   1. Turn a route string ("LFSB LFGA LSGG") + coordinate lookup into a
 *      GeoJSON LineString.
 *   2. Build an N-nautical-mile corridor buffer around the centreline.
 *   3. Filter fetched airspaces / NOTAMs / SIGMETs down to only those that
 *      intersect the corridor.
 *   4. Compute the slippy-map tiles covering the corridor for offline caching.
 *
 * All coordinates follow GeoJSON convention: [lon, lat].
 */

import type {
  Feature,
  FeatureCollection,
  LineString,
  Polygon,
  MultiPolygon,
  Point,
  Position,
} from "geojson";
import { lineString, point } from "@turf/helpers";
import buffer from "@turf/buffer";
import bbox from "@turf/bbox";
import booleanIntersects from "@turf/boolean-intersects";

import type {
  Airspace,
  Notam,
  Sigmet,
  RoutePoint,
  TileCoord,
} from "../types/briefing";

/** Nautical mile → kilometre. */
export const NM_TO_KM = 1.852;

export interface CoordResolver {
  /** Resolve an ICAO id to coordinates; throws/returns undefined if unknown. */
  (icao: string): Promise<RoutePoint | undefined> | RoutePoint | undefined;
}

/**
 * Parse a free-form route string into uppercase ICAO tokens.
 * Accepts spaces, commas, arrows and slashes as separators.
 */
export function parseRouteString(input: string): string[] {
  return input
    .toUpperCase()
    .split(/[\s,>/→-]+/)
    .map((t) => t.trim())
    .filter((t) => /^[A-Z0-9]{3,4}$/.test(t));
}

/**
 * Resolve every ICAO in the route to coordinates and assign PAVE-style roles
 * (first = departure, last = destination, middle = waypoint).
 */
export async function resolveRoutePoints(
  icaos: string[],
  resolve: CoordResolver
): Promise<RoutePoint[]> {
  if (icaos.length < 2) {
    throw new Error("A route needs at least a departure and a destination.");
  }

  const resolved = await Promise.all(
    icaos.map(async (icao) => {
      const p = await resolve(icao);
      if (!p) throw new Error(`Could not resolve coordinates for ${icao}.`);
      return p;
    })
  );

  return resolved.map((p, i) => ({
    ...p,
    role:
      i === 0
        ? "departure"
        : i === resolved.length - 1
        ? "destination"
        : "waypoint",
  }));
}

/** Build a GeoJSON LineString centreline from ordered route points. */
export function buildRouteLine(points: RoutePoint[]): Feature<LineString> {
  const coords: Position[] = points.map((p) => [p.lon, p.lat]);
  return lineString(coords, { kind: "route-centreline" });
}

/**
 * Build a corridor polygon `bufferNm` nautical miles either side of the route.
 * Turf buffers in kilometres, so we convert. Returns a (Multi)Polygon feature.
 */
export function buildCorridor(
  line: Feature<LineString>,
  bufferNm = 10
): Feature<Polygon | MultiPolygon> {
  const widthKm = bufferNm * NM_TO_KM;
  const corridor = buffer(line, widthKm, { units: "kilometers" });
  if (!corridor) {
    throw new Error("Failed to build route corridor buffer.");
  }
  return corridor as Feature<Polygon | MultiPolygon>;
}

/** Generic intersection test used by all the corridor filters below. */
function intersectsCorridor(
  corridor: Feature<Polygon | MultiPolygon>,
  geometry: Feature
): boolean {
  try {
    return booleanIntersects(corridor, geometry);
  } catch {
    // Malformed source geometry should never crash the whole briefing.
    return false;
  }
}

/** Keep only airspaces whose footprint intersects the corridor. */
export function filterAirspaces(
  airspaces: Airspace[],
  corridor: Feature<Polygon | MultiPolygon>
): Airspace[] {
  return airspaces.filter((a) => intersectsCorridor(corridor, a.geometry));
}

/**
 * Keep only NOTAMs anchored inside the corridor. NOTAMs without coordinates
 * are retained only when they are tied to a route ICAO (so airport-wide NOTAMs
 * for fields on the route are never silently dropped).
 */
export function filterNotams(
  notams: Notam[],
  corridor: Feature<Polygon | MultiPolygon>,
  routeIcaos: string[]
): Notam[] {
  const onRoute = new Set(routeIcaos.map((c) => c.toUpperCase()));
  return notams.filter((n) => {
    if (n.location) return intersectsCorridor(corridor, n.location);
    return n.icao ? onRoute.has(n.icao.toUpperCase()) : false;
  });
}

/** Keep only SIGMETs whose hazard area intersects the corridor. */
export function filterSigmets(
  sigmets: Sigmet[],
  corridor: Feature<Polygon | MultiPolygon>
): Sigmet[] {
  return sigmets.filter((s) => intersectsCorridor(corridor, s.geometry));
}

/** Convenience: wrap a lon/lat into a Point feature (e.g. NOTAM anchor). */
export function toPoint(lon: number, lat: number): Feature<Point> {
  return point([lon, lat]);
}

/** Bounding box of the corridor as [minLon, minLat, maxLon, maxLat]. */
export function corridorBbox(
  corridor: Feature<Polygon | MultiPolygon>
): [number, number, number, number] {
  const b = bbox(corridor);
  return [b[0], b[1], b[2], b[3]];
}

/* -------------------------------------------------------------------------- */
/* Slippy-map tile maths (for offline map caching)                            */
/* -------------------------------------------------------------------------- */

function lonToTileX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, z));
}

function latToTileY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) *
      Math.pow(2, z)
  );
}

/**
 * Enumerate XYZ tiles covering the corridor bounding box across a zoom range.
 * Capped at `maxTiles` so a long route can't try to cache the whole planet.
 */
export function tilesForCorridor(
  corridor: Feature<Polygon | MultiPolygon>,
  minZoom = 7,
  maxZoom = 11,
  maxTiles = 4000
): TileCoord[] {
  const [minLon, minLat, maxLon, maxLat] = corridorBbox(corridor);
  const tiles: TileCoord[] = [];

  for (let z = minZoom; z <= maxZoom; z++) {
    const xStart = lonToTileX(minLon, z);
    const xEnd = lonToTileX(maxLon, z);
    // Note: tile Y grows southward, so maxLat → smaller Y.
    const yStart = latToTileY(maxLat, z);
    const yEnd = latToTileY(minLat, z);

    for (let x = xStart; x <= xEnd; x++) {
      for (let y = yStart; y <= yEnd; y++) {
        tiles.push({ z, x, y });
        if (tiles.length >= maxTiles) return tiles;
      }
    }
  }
  return tiles;
}

/** Build an OSM tile URL for a given tile coordinate. */
export function tileUrl(
  { z, x, y }: TileCoord,
  template = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
): string {
  return template
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
}

/** Bundle corridor geometry into one FeatureCollection for Leaflet rendering. */
export function corridorFeatureCollection(
  line: Feature<LineString>,
  corridor: Feature<Polygon | MultiPolygon>,
  points: RoutePoint[]
): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      corridor,
      line,
      ...points.map((p) =>
        point([p.lon, p.lat], { icao: p.icao, role: p.role })
      ),
    ],
  };
}
