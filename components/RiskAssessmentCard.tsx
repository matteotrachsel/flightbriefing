"use client";

/**
 * RiskAssessmentCard
 *
 * A highly scannable visualization of the FRAT output. Designed for fast,
 * in-cockpit reading: a big overall verdict, a per-category PAVE strip, and an
 * expandable list of the exact triggering factors with their explanations.
 *
 * Semantic colour coding:
 *   LOW   → green
 *   MEDIUM→ amber
 *   HIGH  → red
 *   NO_GO → red (with an explicit NO-GO banner)
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
  /** Optional aircraft model shown in the header for context. */
  aircraftModel?: string;
  className?: string;
}

/* -------------------------------------------------------------------------- */
/* Styling helpers — Tailwind class lookups keyed by risk level               */
/* -------------------------------------------------------------------------- */

const LEVEL_STYLES: Record<
  RiskLevel,
  { bg: string; border: string; text: string; dot: string; label: string }
> = {
  LOW: {
    bg: "bg-emerald-50",
    border: "border-emerald-300",
    text: "text-emerald-800",
    dot: "bg-emerald-500",
    label: "Low",
  },
  MEDIUM: {
    bg: "bg-amber-50",
    border: "border-amber-300",
    text: "text-amber-800",
    dot: "bg-amber-500",
    label: "Caution",
  },
  HIGH: {
    bg: "bg-red-50",
    border: "border-red-300",
    text: "text-red-800",
    dot: "bg-red-500",
    label: "High",
  },
  NO_GO: {
    bg: "bg-red-100",
    border: "border-red-500",
    text: "text-red-900",
    dot: "bg-red-600",
    label: "No-Go",
  },
};

const CATEGORY_LABEL: Record<PaveCategory, string> = {
  PILOT: "Pilot",
  AIRCRAFT: "Aircraft",
  ENVIRONMENT: "Environment",
  EXTERNAL: "External",
};

/* -------------------------------------------------------------------------- */
/* Sub-components                                                              */
/* -------------------------------------------------------------------------- */

function LevelBadge({ level }: { level: RiskLevel }) {
  const s = LEVEL_STYLES[level];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${s.bg} ${s.border} ${s.text}`}
    >
      <span className={`h-2 w-2 rounded-full ${s.dot}`} aria-hidden />
      {s.label}
    </span>
  );
}

function CategoryRow({ category }: { category: CategoryScore }) {
  const s = LEVEL_STYLES[category.level];
  return (
    <div
      className={`flex items-center justify-between rounded-lg border px-3 py-2 ${s.bg} ${s.border}`}
    >
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${s.dot}`} aria-hidden />
        <span className={`text-sm font-medium ${s.text}`}>
          {CATEGORY_LABEL[category.category]}
        </span>
      </div>
      <span className={`text-xs font-semibold ${s.text}`}>
        {category.score} pts
      </span>
    </div>
  );
}

function FactorItem({ factor }: { factor: RiskFactor }) {
  const s = LEVEL_STYLES[factor.level];
  return (
    <li className={`rounded-md border ${s.border} ${s.bg} p-2.5`}>
      <div className="flex items-start justify-between gap-2">
        <span className={`text-sm font-semibold ${s.text}`}>
          {factor.label}
        </span>
        <LevelBadge level={factor.level} />
      </div>
      <p className="mt-1 text-sm text-slate-700">{factor.detail}</p>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Main component                                                              */
/* -------------------------------------------------------------------------- */

export default function RiskAssessmentCard({
  risk,
  aircraftModel,
  className = "",
}: RiskAssessmentCardProps) {
  const [showAllFactors, setShowAllFactors] = useState(true);
  const overall = LEVEL_STYLES[risk.overallLevel];

  // Flatten and sort factors worst-first so the scary stuff is at the top.
  const factors = useMemo(() => {
    const rank: Record<RiskLevel, number> = {
      NO_GO: 0,
      HIGH: 1,
      MEDIUM: 2,
      LOW: 3,
    };
    return risk.categories
      .flatMap((c) => c.factors)
      .sort((a, b) => rank[a.level] - rank[b.level]);
  }, [risk.categories]);

  const visibleFactors = showAllFactors ? factors : factors.slice(0, 3);

  return (
    <section
      className={`overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}
      aria-label="Flight risk assessment"
    >
      {/* Header / overall verdict */}
      <header className={`border-b ${overall.border} ${overall.bg} p-4`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Flight Risk Assessment
            </p>
            <h2 className={`mt-0.5 text-2xl font-bold ${overall.text}`}>
              {risk.overallLevel === "NO_GO"
                ? "NO-GO"
                : `${overall.label} Risk`}
            </h2>
            {aircraftModel && (
              <p className="mt-0.5 text-xs text-slate-500">{aircraftModel}</p>
            )}
          </div>
          <div className="text-right">
            <div className={`text-4xl font-black tabular-nums ${overall.text}`}>
              {risk.totalScore}
            </div>
            <p className="text-xs text-slate-500">FRAT score</p>
          </div>
        </div>

        {risk.noGo && (
          <div
            role="alert"
            className="mt-3 rounded-lg border border-red-500 bg-red-600 px-3 py-2 text-sm font-semibold text-white"
          >
            ⚠ Hard No-Go condition triggered — see factors below.
          </div>
        )}
      </header>

      {/* PAVE category strip */}
      <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-4">
        {risk.categories.map((c) => (
          <CategoryRow key={c.category} category={c} />
        ))}
      </div>

      {/* Triggering factors */}
      <div className="px-4 pb-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">
            Triggering factors{" "}
            <span className="font-normal text-slate-400">
              ({factors.length})
            </span>
          </h3>
          {factors.length > 3 && (
            <button
              type="button"
              onClick={() => setShowAllFactors((v) => !v)}
              className="text-xs font-medium text-sky-600 hover:text-sky-800"
            >
              {showAllFactors ? "Show top 3" : "Show all"}
            </button>
          )}
        </div>

        {factors.length === 0 ? (
          <p className="py-3 text-sm text-emerald-700">
            No elevated risk factors detected.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {visibleFactors.map((f) => (
              <FactorItem key={f.code} factor={f} />
            ))}
          </ul>
        )}
      </div>

      {/* Mitigations */}
      {risk.mitigations.length > 0 && (
        <div className="border-t border-slate-100 bg-slate-50 p-4">
          <h3 className="text-sm font-semibold text-slate-700">
            Recommended mitigations
          </h3>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-slate-600">
            {risk.mitigations.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      <footer className="px-4 py-2 text-right">
        <time className="text-[11px] text-slate-400">
          Computed {new Date(risk.computedUtc).toUTCString()}
        </time>
      </footer>
    </section>
  );
}
