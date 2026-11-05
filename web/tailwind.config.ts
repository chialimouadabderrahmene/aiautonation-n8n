import type { Config } from "tailwindcss";

/**
 * Eki's own palette: market colours, not admin-panel greys.
 * `slate` and `brand` are remapped too, so the back-office screens that still use those
 * classes pick up the same warm look without being rewritten.
 */
const warm = {
  50: "#FAF5EA",
  100: "#F3EBDB",
  200: "#E6DAC4",
  300: "#D3C4A9",
  400: "#A39480",
  500: "#7C6E5D",
  600: "#5E5244",
  700: "#463C31",
  800: "#30281F",
  900: "#1C1410",
};

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#FBF6EB",
        card: "#FFFDF8",
        ink: { DEFAULT: "#1C1410", soft: "#5E5244", faint: "#8E8070" },
        rule: "#E6DAC4",
        palm: { DEFAULT: "#D9481C", deep: "#B23A14", wash: "#FBE7DD" },
        plantain: { DEFAULT: "#F2A93B", wash: "#FDF1DA" },
        leaf: { DEFAULT: "#1E6B45", deep: "#16543A", wash: "#E2F0E7" },
        berry: { DEFAULT: "#A62B3F", wash: "#F8E4E7" },
        slate: warm,
        brand: { 50: "#FBE7DD", 500: "#D9481C", 600: "#D9481C", 700: "#B23A14" },
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        sans: ["var(--font-body)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        ticket: "0 1px 0 rgba(28,20,16,.04), 0 8px 24px -14px rgba(28,20,16,.28)",
        lift: "0 18px 44px -20px rgba(28,20,16,.45)",
      },
    },
  },
  plugins: [],
};

export default config;
