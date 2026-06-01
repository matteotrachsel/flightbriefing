"use client";

/**
 * RiskAssessmentCard — glass-cockpit annunciator panel.
 *
 * Reads like an avionics MFD page: a circular FRAT instrument gauge, a row of
 * PAVE annunciator lights, a prioritized CAUTION/WARNING list and a mitigation
 * checklist. Semantic colour coding: green = LOW, amber = MEDIUM, red = HIGH /
 * NO-GO.
 */

import { useMemo, useState } from "react";
import type {
  CategoryScore,
  PaveCategory,
  RiskAssessment,
  RiskFactor,
  RiskLevel,
} from "../types/briefing";

interface RiskAssessmentCardProps {
  risk: RiskAssessment;
  aircraftModel?: string;
  className?: string;
}

/* Level → theme tokens (CSS variables defined in globals.css). */
const LEVEL = {
  LOW: { color: "var(--go)", led: "led-go", text: "text-go", label: "LOW", verdict: "GO" },
  MEDIUM: { color: "var(--caution)", led: "led-caution", text: "text-caution", label: "CAUTION", verdict: "REVIEW" },
  HIGH: { color: "var(--warn)", led: "led-warn", text: "text-warn", label: "HIGH", verdict: "MARGINAL" },
  NO_GO: { color: "var(--warn)", led: "led-warn", text: "text-warn", label: "NO-GO", verdict: "NO-GO" },
} as const satisfies Record<RiskLevel, { color: string; led: string; text: string; label: string; verdict: string }>;

const CATEGORY_LABEL: Record<PaveCategory, string> = {
  PILOT: "Pilot",
  AIRCRAFT: "Aircraft",
  ENVIRONMENT: "Environ",
  EXTERNAL: "External",
};

/* The arc saturates at this score; NO-GO always fills the dial. */
const GAUGE_MAX = 40;

/* -------------------------------------------------------------------------- */

function FratGauge({ risk }: { risk: RiskAssessment }) {
  const theme = LEVEL[risk.overallLevel];
  const r = 78;
  const c = 2 * Math.PI * r;
  const frac = risk.noGo ? 1 : Math.min(risk.totalScore / GAUGE_MAX, 1);
  const offset = c * (1 - frac * 0.75); // 0.75 → leave a 270° dial sweep

  return (
    <div className="relative grid place-items-center" style={{ width: 196, height: 196 }}>
      <svg width="196" height="196" viewBox="0 0 196 196" className="-rotate-[135deg]">
        {/* track */}
        <circle
          cx="98" cy="98" r={r}
          fill="none" stroke="var(--line-strong)" strokeWidth="8"
          strokeDasharray={`${c * 0.75} ${c}`} strokeLinecap="round"
        />
        {/* tick marks */}
        {Array.from({ length: 28 }).map((_, i) => {
          const a = (i / 27) * 270 - 0;
          return (
            <line
              key={i}
              x1="98" y1="20" x2="98" y2="26"
              stroke="var(--line-strong)" strokeWidth="1.5"
              transform={`rotate(${a} 98 98)`}
            />
          );
        })}
        {/* value arc */}
        <circle
          cx="98" cy="98" r={r}
          fill="none" stroke={theme.color} strokeWidth="8"
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          style={{
            filter: `drop-shadow(0 0 6px ${theme.color})`,
            transition: "stroke-dashoffset 1s cubic-bezier(0.2,0.7,0.2,1), stroke 0.4s",
          }}
        />
      </svg>

      {/* center readout */}
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="font-mono text-5xl font-semibold leading-none" style={{ color: theme.color, textShadow: `0 0 18px ${theme.color}55` }}>
            {risk.totalScore}
          </div>
          <div className="mt-1 font-display text-[0.6rem] tracking-[0.3em] text-ink-faint">FRAT</div>
          <div className={`mt-2 font-display text-sm font-semibold tracking-[0.22em] ${theme.text}`}>
            {theme.verdict}
          </div>
        </div>
      </div>
    </div>
  );
}

function Annunciator({ category, delay }: { category: CategoryScore; delay: number }) {
  const t = LEVEL[category.level];
  const active = category.level !== "LOW";
  return (
    <div
      className="rise panel bezel flex items-center justify-between gap-2 px-3 py-2.5"
      style={{ animationDelay: `${delay}ms`, borderColor: active ? `${t.color}55` : undefined }}
    >
      <div className="flex items-center gap-2">
        <span className={`led ${t.led} ${active ? "pulse" : ""}`} />
        <span className="font-display text-[0.66rem] tracking-[0.16em] text-ink-dim">
          {CATEGORY_LABEL[category.category].toUpperCase()}
        </span>
      </div>
      <span className={`readout text-sm font-semibold ${active ? t.text : "text-ink-faint"}`}>
        {String(category.score).padStart(2, "0")}
      </span>
    </div>
  );
}

function FactorRow({ factor, delay }: { factor: RiskFactor; delay: number }) {
  const t = LEVEL[factor.level];
  return (
    <li
      className="rise relative overflow-hidden rounded-lg border px-3 py-2.5"
      style={{ animationDelay: `${delay}ms`, borderColor: `${t.color}40`, background: `${t.color}0d` }}
    >
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: t.color, boxShadow: `0 0 8px ${t.color}` }} />
      <div className="flex items-center justify-between gap-2 pl-1">
        <span className={`font-display text-[0.78rem] font-semibold tracking-wide ${t.text}`}>
          {factor.label}
        </span>
        <span className="tag flex items-center gap-1.5" style={{ borderColor: `${t.color}55`, color: t.color }}>
          <span className={`led ${t.led}`} style={{ width: ".4rem", height: ".4rem" }} />
          {t.label}
        </span>
      </div>
      <p className="mt-1 pl-1 text-[0.82rem] leading-snug text-ink-dim">{factor.detail}</p>
    </li>
  );
}

/* -------------------------------------------------------------------------- */

export default function RiskAssessmentCard({
  risk,
  aircraftModel,
  className = "",
}: RiskAssessmentCardProps) {
  const [showAll, setShowAll] = useState(true);
  const theme = LEVEL[risk.overallLevel];

  const factors = useMemo(() => {
    const rank: Record<RiskLevel, number> = { NO_GO: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    return risk.categories
      .flatMap((c) => c.factors)
      .sort((a, b) => rank[a.level] - rank[b.level]);
  }, [risk.categories]);

  const visible = showAll ? factors : factors.slice(0, 3);

  return (
    <section className={`panel bezel overflow-hidden ${className}`} aria-label="Flight risk assessment">
      <div className="panel-head">
        <span>Flight Risk Assessment</span>
        <span className="flex items-center gap-2 normal-case tracking-normal">
          <span className={`led ${theme.led} pulse`} />
          <span className={`font-display text-[0.66rem] tracking-[0.2em] ${theme.text}`}>{theme.label}</span>
        </span>
      </div>

      {/* Verdict + gauge */}
      <div className="flex flex-col items-center gap-5 px-4 pt-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <FratGauge risk={risk} />
        <div className="flex-1 sm:pl-2">
          <div className="font-display text-[0.62rem] tracking-[0.3em] text-ink-faint">VERDICT</div>
          <div className={`font-display text-3xl font-bold leading-tight ${theme.text}`}
               style={{ textShadow: `0 0 22px ${theme.color}44` }}>
            {risk.overallLevel === "NO_GO" ? "NO-GO" : `${theme.label} RISK`}
          </div>
          {aircraftModel && (
            <div className="mt-1 readout text-sm text-ink-dim">{aircraftModel}</div>
          )}

          {risk.noGo && (
            <div role="alert"
                 className="mt-3 flex items-center gap-2 rounded-lg border border-warn/60 px-3 py-2 font-display text-xs tracking-[0.12em] text-warn"
                 style={{ background: "rgba(255,77,87,0.08)" }}>
              <span className="led led-warn pulse" /> HARD NO-GO CONDITION ACTIVE
            </div>
          )}
        </div>
      </div>

      {/* PAVE annunciator strip */}
      <div className="mt-5 grid grid-cols-2 gap-2 px-4 sm:grid-cols-4 sm:px-6">
        {risk.categories.map((c, i) => (
          <Annunciator key={c.category} category={c} delay={120 + i * 70} />
        ))}
      </div>

      {/* Factors */}
      <div className="px-4 pt-5 sm:px-6">
        <div className="flex items-center justify-between border-b border-line pb-2">
          <h3 className="font-display text-[0.68rem] tracking-[0.2em] text-ink-dim">
            CAUTION / WARNING <span className="readout text-ink-faint">[{factors.length}]</span>
          </h3>
          {factors.length > 3 && (
            <button type="button" onClick={() => setShowAll((v) => !v)}
                    className="font-display text-[0.62rem] tracking-[0.14em] text-cyan hover:brightness-125">
              {showAll ? "COLLAPSE" : "EXPAND ALL"}
            </button>
          )}
        </div>

        {factors.length === 0 ? (
          <p className="flex items-center gap-2 py-4 font-display text-sm tracking-wide text-go">
            <span className="led led-go" /> ALL SYSTEMS NOMINAL — NO ELEVATED RISK
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {visible.map((f, i) => (
              <FactorRow key={f.code} factor={f} delay={200 + i * 60} />
            ))}
          </ul>
        )}
      </div>

      {/* Mitigations checklist */}
      {risk.mitigations.length > 0 && (
        <div className="mt-5 border-t border-line bg-black/20 px-4 py-4 sm:px-6">
          <h3 className="font-display text-[0.68rem] tracking-[0.2em] text-ink-dim">MITIGATION CHECKLIST</h3>
          <ul className="mt-3 space-y-1.5">
            {risk.mitigations.map((m, i) => (
              <li key={i} className="flex gap-2.5 text-[0.85rem] leading-snug text-ink">
                <span className="mt-[0.15rem] font-mono text-cyan">›</span>
                <span>{m}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center justify-between px-4 py-2.5 sm:px-6">
        <span className="font-display text-[0.58rem] tracking-[0.22em] text-ink-faint">PAVE MODEL</span>
        <time className="readout text-[0.66rem] text-ink-faint">
          {new Date(risk.computedUtc).toISOString().replace("T", " ").slice(0, 16)}Z
        </time>
      </div>
    </section>
  );
}
