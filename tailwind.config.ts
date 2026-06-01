import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["var(--font-display)", "ui-sans-serif", "system-ui"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
        body: ["var(--font-body)", "ui-sans-serif", "system-ui"],
      },
      colors: {
        bg: "var(--bg)",
        panel: "var(--panel-solid)",
        ink: "var(--ink)",
        "ink-dim": "var(--ink-dim)",
        "ink-faint": "var(--ink-faint)",
        go: "var(--go)",
        caution: "var(--caution)",
        warn: "var(--warn)",
        cyan: "var(--cyan)",
        magenta: "var(--magenta)",
      },
      borderColor: {
        line: "var(--line)",
        "line-strong": "var(--line-strong)",
      },
    },
  },
  plugins: [],
};

export default config;
