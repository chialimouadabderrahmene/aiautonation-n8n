import { defineConfig } from "vitest/config";

// Hits a REAL Postgres + Redis — never run by `npm test`. Run explicitly:
//   DATABASE_URL=... REDIS_URL=... npm run test:integration
export default defineConfig({
  test: { include: ["test/engine-integration.test.ts", "test/engine-batch2-integration.test.ts"], environment: "node", testTimeout: 30_000, hookTimeout: 30_000 },
});
