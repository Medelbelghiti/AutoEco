import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // AutoEco design system: charcoal + emerald + neutrals
        charcoal: {
          50: "#f6f7f8",
          100: "#eceef0",
          200: "#d5d9de",
          300: "#b1b8c0",
          400: "#86909a",
          500: "#67727c",
          600: "#525b65",
          700: "#434a52",
          800: "#393e45",
          900: "#0f1216",
          950: "#0a0c0f",
        },
        // Money / savings / eco = emerald (sparingly)
        emerald: {
          50: "#ecfdf5",
          100: "#d1fae5",
          200: "#a7f3d0",
          300: "#6ee7b7",
          400: "#34d399",
          500: "#10b981",
          600: "#059669",
          700: "#047857",
          800: "#065f46",
          900: "#064e3b",
        },
        // Destructive / overspend = amber
        amber: {
          50: "#fffbeb",
          100: "#fef3c7",
          200: "#fde68a",
          400: "#fbbf24",
          500: "#f59e0b",
          600: "#d97706",
          700: "#b45309",
        },
        // Destructive / danger = rose (never for safety score)
        rose: {
          50: "#fff1f2",
          500: "#f43f5e",
          600: "#e11d48",
          700: "#be123c",
        },
      },
      fontFamily: {
        sans: [
          "var(--font-sans)",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Noto Sans Arabic",
          "Tahoma",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        soft: "0 1px 2px rgba(15, 18, 22, 0.04), 0 2px 8px rgba(15, 18, 22, 0.04)",
        elevated: "0 4px 12px rgba(15, 18, 22, 0.06), 0 12px 32px rgba(15, 18, 22, 0.06)",
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.125rem",
      },
    },
  },
  plugins: [],
};

export default config;
