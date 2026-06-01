"use client";

/**
 * RouteMap — dark "moving map" instrument view.
 *
 * Dark CartoDB basemap to match the glass-cockpit theme. Renders the corridor
 * buffer (cyan), corridor-intersecting airspace + SIGMET polygons, the active
 * route line (magenta, per avionics convention) and waypoint markers.
 *
 * Must be imported with `ssr: false` (Leaflet touches `window`).
 */

import { useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  GeoJSON,
  Polyline,
  CircleMarker,
  Tooltip,
} from "react-leaflet";
import type { LatLngExpression } from "leaflet";
import "leaflet/dist/leaflet.css";

import type { Briefing } from "../types/briefing";

const CLASS_COLORS: Record<string, string> = {
  PROHIBITED: "#ff4d57",
  RESTRICTED: "#ff8a3d",
  DANGER: "#f5b301",
  default: "#9b8cff",
};

export default function RouteMap({ briefing }: { briefing: Briefing }) {
  const { route } = briefing;

  const center = useMemo<LatLngExpression>(() => {
    const p = route.points[Math.floor(route.points.length / 2)];
    return [p.lat, p.lon];
  }, [route.points]);

  const routeLatLngs = route.points.map((p) => [p.lat, p.lon] as LatLngExpression);

  return (
    <section className="panel bezel overflow-hidden">
      <div className="panel-head">
        <span>Moving Map</span>
        <span className="flex items-center gap-3 normal-case tracking-normal">
          <Legend color="var(--magenta)" label="ROUTE" />
          <Legend color="var(--cyan)" label="CORRIDOR" />
          <span className="tag">{route.bufferNm}NM</span>
        </span>
      </div>

      <div className="h-[460px]">
        <MapContainer center={center} zoom={8} className="h-full w-full" zoomControl={false} attributionControl>
          <TileLayer
            attribution='&copy; OpenStreetMap &middot; &copy; CARTO'
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"
            subdomains="abcd"
          />

          {/* Corridor buffer */}
          <GeoJSON
            data={route.corridor as GeoJSON.GeoJsonObject}
            style={{ color: "#36e0ff", weight: 1, fillColor: "#36e0ff", fillOpacity: 0.06, dashArray: "2 4" }}
          />

          {/* Airspace polygons intersecting the corridor */}
          {briefing.corridor.airspaces.map((a) => (
            <GeoJSON
              key={a.id}
              data={a.geometry as GeoJSON.GeoJsonObject}
              style={{
                color: CLASS_COLORS[a.class] ?? CLASS_COLORS.default,
                weight: 1.4,
                fillColor: CLASS_COLORS[a.class] ?? CLASS_COLORS.default,
                fillOpacity: 0.1,
              }}
            />
          ))}

          {/* Active SIGMET hazard areas */}
          {briefing.corridor.sigmets.map((s) => (
            <GeoJSON
              key={s.id}
              data={s.geometry as GeoJSON.GeoJsonObject}
              style={{ color: "#ff4d57", weight: 2, dashArray: "5 4", fillColor: "#ff4d57", fillOpacity: 0.08 }}
            />
          ))}

          {/* Active route line (magenta) */}
          <Polyline positions={routeLatLngs} pathOptions={{ color: "#ff5ad8", weight: 2.5, opacity: 0.95 }} />

          {/* Waypoints */}
          {route.points.map((p) => {
            const fill =
              p.role === "departure" ? "#2fd47a" : p.role === "destination" ? "#ff4d57" : "#36e0ff";
            return (
              <CircleMarker
                key={p.icao}
                center={[p.lat, p.lon]}
                radius={5}
                pathOptions={{ color: "#070a10", weight: 2, fillColor: fill, fillOpacity: 1 }}
              >
                <Tooltip permanent direction="top" offset={[0, -6]} className="!border-0 !bg-transparent !shadow-none">
                  <span style={{ color: fill, fontFamily: "var(--font-display)", fontSize: 11, letterSpacing: 1, textShadow: "0 0 6px #000" }}>
                    {p.icao}
                  </span>
                </Tooltip>
              </CircleMarker>
            );
          })}
        </MapContainer>
      </div>
    </section>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-[2px] w-4 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
      <span className="font-display text-[0.56rem] tracking-[0.16em] text-ink-faint">{label}</span>
    </span>
  );
}
