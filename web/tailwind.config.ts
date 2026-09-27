import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eefcf4",
          500: "#0a9d5c",
          600: "#08814a",
          700: "#0a3d2a",
        },
      },
    },
  },
  plugins: [],
};

export default config;
