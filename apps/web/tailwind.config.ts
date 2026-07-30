import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        canvas: "var(--black)",
        surface: "var(--surface)",
        raised: "var(--surface-raised)",
        hairline: "var(--border)",
        wire: "var(--border-visible)",
        faint: "var(--text-disabled)",
        muted: "var(--text-secondary)",
        foreground: "var(--text-primary)",
        display: "var(--text-display)",
        /** Home + stats accent orange; use `border-brand`, `text-brand/80`, etc. */
        brand: "rgb(var(--brand-rgb) / <alpha-value>)",
        accent: "var(--accent)",
        success: "var(--success)",
        warning: "var(--warning)",
        interactive: "var(--interactive)",
        error: "var(--error)",
        /** Dashboard conversational overline — brand + secondary mix */
        overline: "var(--text-overline)",
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-body)", "system-ui", "sans-serif"],
        mono: ["var(--font-data)", "ui-monospace", "monospace"],
      },
      fontSize: {
        "display-xl": ["4.5rem", { lineHeight: "1" }],
        "display-md": ["2.25rem", { lineHeight: "1.1" }],
        /** Between heading and display-md — section titles in danger / error surfaces */
        "display-sm": ["1.875rem", { lineHeight: "1.12" }],
        heading: ["1.5rem", { lineHeight: "1.2" }],
        body: ["1rem", { lineHeight: "1.6" }],
        caption: ["0.75rem", { lineHeight: "1.4" }],
        label: [
          "0.6875rem",
          { lineHeight: "1.2", letterSpacing: "0.08em" },
        ],
      },
      spacing: {
        "3xl": "4rem",
        "4xl": "6rem",
      },
      maxWidth: {
        "app-content": "var(--app-content-max-width)",
        "auth-form": "var(--auth-form-max-width)",
      },
      keyframes: {
        "nav-menu-in": {
          from: { opacity: "0", transform: "translateY(-0.35rem)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "home-explore-slice-in": {
          from: { opacity: "0", transform: "translateY(0.2rem)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "nav-menu-in": "nav-menu-in 0.22s cubic-bezier(0.22, 1, 0.36, 1) both",
        "home-explore-slice-in":
          "home-explore-slice-in 0.32s cubic-bezier(0.22, 1, 0.36, 1) both",
      },
    },
  },
  plugins: [],
};

export default config;
