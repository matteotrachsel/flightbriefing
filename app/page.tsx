"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

import type { Briefing } from "../types/briefing";
import RiskAssessmentCard from "../components/RiskAssessmentCard";
import { persistBriefing, registerServiceWorker } from "../lib/idb";

// Leaflet must be client-only (no SSR). The map component is a small wrapper
// around react-leaflet that renders briefing.route.corridor + waypoints.
const RouteMap = dynamic(() => import("../components/RouteMap"), { ssr: false });

const DEFAULT_FORM = {
  route: "LFSB LFGA LSGG",
  altitudeFt: 6500,
  bufferNm: 10,
  totalHours: 240,
  hoursOnType: 30,
  hoursLast90Days: 12,
  sleepQuality: 4,
  instrumentRated: false,
  aircraftModel: "DR400-180",
  crosswindLimitKt: 20,
  fuelReserveMinutes: 45,
  ifrCapable: false,
};

export default function HomePage() {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    registerServiceWorker().catch(() => undefined);
  }, []);

  const update = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [k]: v }));
  };

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/briefing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          route: form.route,
          altitudeFt: Number(form.altitudeFt),
          bufferNm: Number(form.bufferNm),
          pilot: {
            totalHours: Number(form.totalHours),
            hoursOnType: Number(form.hoursOnType),
            hoursLast90Days: Number(form.hoursLast90Days),
            sleepQuality: Number(form.sleepQuality),
            instrumentRated: Boolean(form.instrumentRated),
          },
          aircraft: {
            model: form.aircraftModel,
            crosswindLimitKt: Number(form.crosswindLimitKt),
            fuelReserveMinutes: Number(form.fuelReserveMinutes),
            ifrCapable: Boolean(form.ifrCapable),
          },
        }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(error || "Failed to generate briefing.");
      }
      const data: Briefing = await res.json();
      setBriefing(data);
      // Persist for offline cockpit viewing + warm the tile cache.
      persistBriefing(data).catch(() => undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl p-4 sm:p-6">
      <h1 className="text-xl font-bold text-slate-800">Pre-Flight Briefing</h1>
      <p className="mb-4 text-sm text-slate-500">
        Route, weather, airspace and automated FRAT risk — offline-ready.
      </p>

      <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-3">
        <label className="col-span-3 text-sm">
          Route (ICAO codes)
          <input
            className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
            value={form.route}
            onChange={update("route")}
          />
        </label>
        <NumField label="Altitude (ft)" value={form.altitudeFt} onChange={update("altitudeFt")} />
        <NumField label="Corridor (NM)" value={form.bufferNm} onChange={update("bufferNm")} />
        <TextField label="Aircraft model" value={form.aircraftModel} onChange={update("aircraftModel")} />
        <NumField label="Crosswind limit (kt)" value={form.crosswindLimitKt} onChange={update("crosswindLimitKt")} />
        <NumField label="Fuel reserve (min)" value={form.fuelReserveMinutes} onChange={update("fuelReserveMinutes")} />
        <NumField label="Total hours" value={form.totalHours} onChange={update("totalHours")} />
        <NumField label="Hours on type" value={form.hoursOnType} onChange={update("hoursOnType")} />
        <NumField label="Hours last 90d" value={form.hoursLast90Days} onChange={update("hoursLast90Days")} />
        <NumField label="Sleep (1-5)" value={form.sleepQuality} onChange={update("sleepQuality")} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.instrumentRated} onChange={update("instrumentRated")} />
          Instrument rated
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.ifrCapable} onChange={update("ifrCapable")} />
          Aircraft IFR-capable
        </label>

        <div className="col-span-3">
          <button
            onClick={generate}
            disabled={loading}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {loading ? "Generating…" : "Generate briefing"}
          </button>
        </div>
      </section>

      {error && (
        <p className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {briefing && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <RiskAssessmentCard risk={briefing.risk} aircraftModel={briefing.aircraft.model} />
          <RouteMap briefing={briefing} />
        </div>
      )}
    </main>
  );
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className="text-sm">
      {label}
      <input
        type="number"
        className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
        value={value}
        onChange={onChange}
      />
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className="text-sm">
      {label}
      <input
        className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5"
        value={value}
        onChange={onChange}
      />
    </label>
  );
}
