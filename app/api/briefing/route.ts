/**
 * BFF aggregator: POST /api/briefing
 *
 * Orchestrates the full pipeline server-side:
 *   1. Parse + resolve the route to coordinates.
 *   2. Build the route line and N-NM corridor (Turf).
 *   3. Fetch open data (METAR/TAF/SIGMET/airspace/NOTAM) in parallel.
 *   4. Spatially filter everything down to the corridor.
 *   5. Run the FRAT engine.
 *   6. Return the assembled Briefing for the client to render + cache offline.
 */

import { NextResponse } from "next/server";

import type {
  AircraftInputs,
  Briefing,
  PilotInputs,
} from "../../../types/briefing";
import { calculateFlightRisk } from "../../../services/fratEngine";
import {
  buildCorridor,
  buildRouteLine,
  corridorBbox,
  filterAirspaces,
  filterNotams,
  filterSigmets,
  parseRouteString,
  resolveRoutePoints,
  tilesForCorridor,
} from "../../../services/geoUtils";
import {
  fetchAirports,
  fetchAirspaces,
  fetchMetars,
  fetchNotams,
  fetchSigmets,
  fetchTafs,
  fetchWindsAloft,
  resolveAirportCoords,
} from "../../../services/dataSources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface BriefingRequest {
  route: string;
  altitudeFt: number;
  bufferNm?: number;
  etdUtc?: string;
  eteMinutes?: number;
  pilot: PilotInputs;
  aircraft: AircraftInputs;
  /** Optional alternates that should also drive wind/ceiling risk. */
  alternates?: string[];
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function POST(req: Request) {
  let body: BriefingRequest;
  try {
    body = (await req.json()) as BriefingRequest;
  } catch {
    return badRequest("Invalid JSON body.");
  }

  const icaos = parseRouteString(body.route ?? "");
  if (icaos.length < 2) {
    return badRequest("Provide at least a departure and destination ICAO.");
  }
  if (!body.pilot || !body.aircraft) {
    return badRequest("pilot and aircraft inputs are required.");
  }

  const bufferNm = body.bufferNm ?? 10;
  const etdUtc = body.etdUtc ?? new Date().toISOString();
  const eteMinutes = body.eteMinutes ?? 0;

  // 1 + 2: resolve coordinates and build geometry.
  let points;
  try {
    points = await resolveRoutePoints(icaos, resolveAirportCoords);
  } catch (e) {
    return badRequest((e as Error).message);
  }
  const line = buildRouteLine(points);
  const corridor = buildCorridor(line, bufferNm);
  const bbox = corridorBbox(corridor);

  // Endpoints whose surface weather drives wind/ceiling risk.
  const endpoints = [
    points[0].icao,
    points[points.length - 1].icao,
    ...(body.alternates ?? []),
  ];
  const allWxIcaos = Array.from(new Set([...icaos, ...(body.alternates ?? [])]));

  // 3: fetch every source in parallel; adapters degrade gracefully.
  const [metars, tafs, sigmets, airspacesRaw, airports, notamsRaw, windsAloft] =
    await Promise.all([
      fetchMetars(allWxIcaos),
      fetchTafs(allWxIcaos),
      fetchSigmets(),
      fetchAirspaces(bbox),
      fetchAirports(allWxIcaos),
      fetchNotams(allWxIcaos),
      fetchWindsAloft(),
    ]);

  // 4: spatially filter to the corridor.
  const corridorAirspaces = filterAirspaces(airspacesRaw, corridor);
  const corridorNotams = filterNotams(notamsRaw, corridor, icaos);
  const corridorSigmets = filterSigmets(sigmets, corridor);

  const meteo = {
    metars,
    tafs,
    windsAloft,
    sigmets: corridorSigmets,
    fetchedUtc: new Date().toISOString(),
  };
  const notamData = { notams: corridorNotams, fetchedUtc: new Date().toISOString() };

  // 5: FRAT.
  const risk = calculateFlightRisk(
    body.pilot,
    body.aircraft,
    meteo,
    notamData,
    line,
    { endpointIcaos: endpoints }
  );

  // 6: assemble.
  const id = `${icaos.join("-")}_${etdUtc}`;
  const briefing: Briefing = {
    id,
    generatedUtc: new Date().toISOString(),
    route: {
      points,
      altitudeFt: body.altitudeFt,
      bufferNm,
      etdUtc,
      eteMinutes,
      line,
      corridor,
    },
    pilot: body.pilot,
    aircraft: body.aircraft,
    meteo,
    airspace: {
      airspaces: corridorAirspaces,
      airports,
      fetchedUtc: new Date().toISOString(),
    },
    notams: notamData,
    risk,
    corridor: {
      airspaces: corridorAirspaces,
      notams: corridorNotams,
      sigmets: corridorSigmets,
    },
    cachedTiles: tilesForCorridor(corridor),
  };

  return NextResponse.json(briefing);
}
