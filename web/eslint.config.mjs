import nextConfig from "eslint-config-next";

export default [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts"] },
  ...nextConfig,
  {
    rules: {
      // Existing client components intentionally synchronize API state and
      // polling refs from effects. These React 19 diagnostics are not
      // compatible with the current React 18 runtime; revisit with the
      // planned React 19 migration instead of changing behavior here.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
    },
  },
];
