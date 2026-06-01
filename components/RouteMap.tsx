"use client";

/**
 * RouteMap — Leaflet view of the briefing.
 *
 * Renders OSM tiles, the route centreline, the buffered corridor, waypoint
 * markers, and any corridor-intersecting airspace / SIGMET polygons. Must be
 * imported with `ssr: false` (Leaflet touches `window`).
 */

import { useMemo } from "react";
import { MapContainer, TileLayer, GeoJSON, Polyline, CircleMarker, Tooltip } from "react-leaflet";
import type { LatLngExpression } from "leaflet";
import "leaflet/dist/leaflet.css";

import type { Briefing } from "../types/briefing";

const CLASS_COLORS: Record<string, string> = {
  PROHIBITED: "#dc2626",
  RESTRICTED: "#ea580c",
  DANGER: "#d97706",
  default: "#7c3aed",
};

export default function RouteMap({ briefing }: { briefing: Briefing }) {
  const { route, corridor } = briefing;

  const center = useMemo<LatLngExpression>(() => {
    const p = route.points[Math.floor(route.points.length / 2)];
    return [p.lat, p.lon];
  }, [route.points]);

  const routeLatLngs = route.points.map(
    (p) => [p.lat, p.lon] as LatLngExpression
  );

  return (
    <div className="h-[480px] overflow-hidden rounded-2xl border border-slate-200 shadow-sm">
      <MapContainer center={center} zoom={8} className="h-full w-full">
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* Corridor buffer */}
        <GeoJSON
          data={route.corridor as GeoJSON.GeoJsonObject}
          style={{ color: "#0ea5e9", weight: 1, fillOpacity: 0.08 }}
        />

        {/* Airspace polygons that intersect the corridor */}
        {briefing.corridor.airspaces.map((a) => (
          <GeoJSON
            key={a.id}
            data={a.geometry as GeoJSON.GeoJsonObject}
            style={{
              color: CLASS_COLORS[a.class] ?? CLASS_COLORS.default,
              weight: 1.5,
              fillOpacity: 0.12,
            }}
          />
        ))}

        {/* Active SIGMET hazard areas */}
        {briefing.corridor.sigmets.map((s) => (
          <GeoJSON
            key={s.id}
            data={s.geometry as GeoJSON.GeoJsonObject}
            style={{ color: "#b91c1c", weight: 2, dashArray: "4", fillOpacity: 0.1 }}
          />
        ))}

        {/* Route centreline */}
        <Polyline positions={routeLatLngs} pathOptions={{ color: "#1e293b", weight: 3 }} />

        {/* Waypoint markers */}
        {route.points.map((p) => (
          <CircleMarker
            key={p.icao}
            center={[p.lat, p.lon]}
            radius={6}
            pathOptions={{
              color: "#0f172a",
              fillColor: p.role === "departure" ? "#16a34a" : p.role === "destination" ? "#dc2626" : "#0ea5e9",
              fillOpacity: 1,
            }}
          >
            <Tooltip permanent direction="top" offset={[0, -6]}>
              {p.icao}
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
