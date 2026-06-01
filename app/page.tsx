"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

import type { Briefing } from "../types/briefing";
import RiskAssessmentCard from "../components/RiskAssessmentCard";
import { persistBriefing, registerServiceWorker } from "../lib/idb";

const RouteMap = dynamic(() => import("../components/RouteMap"), {
  ssr: false,
  loading: () => (
    <div className="panel bezel grid h-[460px] place-items-center text-ink-faint">
      <span className="font-display text-xs tracking-[0.2em]">LOADING CHART…</span>
    </div>
  ),
});

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
  const [online, setOnline] = useState(true);

  useEffect(() => {
    registerServiceWorker().catch(() => undefined);
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  const update =
    (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
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
      persistBriefing(data).catch(() => undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relayer mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6">
      {/* ── EFB title bar ───────────────────────────────────────────── */}
      <header className="panel bezel mb-5 flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <Wings />
          <div>
            <h1 className="font-display text-lg font-bold tracking-[0.18em] text-ink sm:text-xl">
              PRE<span className="text-cyan">FLIGHT</span>
            </h1>
            <p className="font-display text-[0.56rem] tracking-[0.34em] text-ink-faint">
              METEO · AIRSPACE · FRAT
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`led ${online ? "led-go" : "led-caution"} ${online ? "" : "pulse"}`} />
          <span className="font-display text-[0.6rem] tracking-[0.2em] text-ink-dim">
            {online ? "ONLINE" : "OFFLINE · CACHED"}
          </span>
        </div>
      </header>

      {/* ── Flight plan input ──────────────────────────────────────── */}
      <section className="panel bezel mb-6">
        <div className="panel-head">
          <span>Flight Plan</span>
          <span className="tag">PAVE INPUTS</span>
        </div>

        <div className="space-y-5 p-4 sm:p-6">
          {/* Route block */}
          <Block label="Route">
            <Field className="sm:col-span-2" label="ICAO sequence">
              <input
                className="field-input tracking-[0.3em]"
                value={form.route}
                onChange={update("route")}
                placeholder="LFSB LFGA LSGG"
                spellCheck={false}
              />
            </Field>
            <Num label="Altitude · ft" value={form.altitudeFt} onChange={update("altitudeFt")} />
            <Num label="Corridor · NM" value={form.bufferNm} onChange={update("bufferNm")} />
          </Block>

          {/* Aircraft block */}
          <Block label="Aircraft">
            <Field label="Model">
              <input className="field-input" value={form.aircraftModel} onChange={update("aircraftModel")} spellCheck={false} />
            </Field>
            <Num label="Crosswind lim · kt" value={form.crosswindLimitKt} onChange={update("crosswindLimitKt")} />
            <Num label="Fuel reserve · min" value={form.fuelReserveMinutes} onChange={update("fuelReserveMinutes")} />
            <Toggle label="IFR capable" checked={form.ifrCapable} onChange={update("ifrCapable")} />
          </Block>

          {/* Pilot block */}
          <Block label="Pilot">
            <Num label="Total hrs" value={form.totalHours} onChange={update("totalHours")} />
            <Num label="Hrs on type" value={form.hoursOnType} onChange={update("hoursOnType")} />
            <Num label="Hrs / 90d" value={form.hoursLast90Days} onChange={update("hoursLast90Days")} />
            <Num label="Sleep 1–5" value={form.sleepQuality} onChange={update("sleepQuality")} />
            <Toggle label="Instrument rated" checked={form.instrumentRated} onChange={update("instrumentRated")} />
          </Block>

          <div className="flex flex-col items-stretch gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-mono text-[0.72rem] text-ink-faint">
              Live data: aviationweather.gov · OpenAIP · NOTAM
            </p>
            <button onClick={generate} disabled={loading} className="btn-fly px-7 py-2.5 text-sm">
              {loading ? "ACQUIRING…" : "GENERATE BRIEFING"}
            </button>
          </div>
        </div>
      </section>

      {error && (
        <div role="alert"
             className="mb-6 flex items-center gap-2 rounded-xl border border-warn/50 px-4 py-3 font-mono text-sm text-warn"
             style={{ background: "rgba(255,77,87,0.07)" }}>
          <span className="led led-warn pulse" /> {error}
        </div>
      )}

      {briefing && (
        <div className="grid gap-6 lg:grid-cols-2">
          <RiskAssessmentCard
            risk={briefing.risk}
            aircraftModel={briefing.aircraft.model}
            className="rise"
          />
          <div className="rise space-y-6" style={{ animationDelay: "120ms" }}>
            <RouteMap briefing={briefing} />
            <WxStrip briefing={briefing} />
          </div>
        </div>
      )}
    </main>
  );
}

/* ── Layout helpers ──────────────────────────────────────────────── */

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="h-px flex-none" />
        <span className="font-display text-[0.62rem] tracking-[0.28em] text-cyan">{label.toUpperCase()}</span>
        <span className="h-px flex-1 bg-line" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{children}</div>
    </div>
  );
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="field-label">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Num({ label, value, onChange }: { label: string; value: number | string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <Field label={label}>
      <input type="number" className="field-input" value={value} onChange={onChange} />
    </Field>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <label className="flex cursor-pointer select-none flex-col justify-end gap-1">
      <span className="field-label">{label}</span>
      <div className="flex items-center gap-2 rounded-lg border border-line bg-black/30 px-2.5 py-2">
        <input type="checkbox" className="peer sr-only" checked={checked} onChange={onChange} />
        <span className={`led ${checked ? "led-go" : ""}`}
              style={checked ? undefined : { background: "var(--ink-faint)", boxShadow: "none", color: "var(--ink-faint)" }} />
        <span className={`font-mono text-xs ${checked ? "text-go" : "text-ink-faint"}`}>
          {checked ? "YES" : "NO"}
        </span>
      </div>
    </label>
  );
}

/* Compact METAR strip under the map. */
function WxStrip({ briefing }: { briefing: Briefing }) {
  const rules: Record<string, string> = {
    VFR: "var(--go)", MVFR: "var(--caution)", IFR: "var(--warn)", LIFR: "var(--warn)",
  };
  const metars = briefing.meteo.metars;
  return (
    <section className="panel bezel">
      <div className="panel-head"><span>Surface Weather</span><span className="tag">METAR</span></div>
      {metars.length === 0 ? (
        <p className="px-4 py-5 font-mono text-sm text-ink-faint">No METAR returned for these stations.</p>
      ) : (
        <ul className="divide-y divide-line">
          {metars.map((m) => (
            <li key={m.icao} className="flex items-center gap-3 px-4 py-2.5">
              <span className="led" style={{ background: rules[m.flightRule], color: rules[m.flightRule] }} />
              <span className="font-display text-sm tracking-[0.1em] text-ink">{m.icao}</span>
              <span className="readout text-xs" style={{ color: rules[m.flightRule] }}>{m.flightRule}</span>
              <span className="readout ml-auto text-xs text-ink-dim">
                {m.wind.directionDeg ?? "VRB"}° / {m.wind.speedKt}
                {m.wind.gustKt ? `G${m.wind.gustKt}` : ""}kt
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Wings() {
  return (
    <svg width="34" height="34" viewBox="0 0 48 48" fill="none" aria-hidden>
      <circle cx="24" cy="24" r="22" stroke="var(--cyan)" strokeWidth="1.5" opacity="0.5" />
      <path d="M24 6 L24 42 M6 24 L42 24" stroke="var(--line-strong)" strokeWidth="1" />
      <path d="M24 12 L31 30 L24 26 L17 30 Z" fill="var(--cyan)" style={{ filter: "drop-shadow(0 0 5px var(--cyan))" }} />
    </svg>
  );
}
