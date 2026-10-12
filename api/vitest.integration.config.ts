import { defineConfig } from "vitest/config";

// Hits a REAL Postgres + Redis — never run by `npm test`. Run explicitly:
//   DATABASE_URL=... REDIS_URL=... npm run test:integration
export default defineConfig({
  test: {
    include: [
      "test/engine-integration.test.ts",
      "test/engine-batch2-integration.test.ts",
      "test/engine-whatsapp-sequence-integration.test.ts",
      "test/engine-whatsapp-webhook-integration.test.ts",
      "test/engine-social-posting-integration.test.ts",
      "test/engine-intelligence-integration.test.ts",
      "test/engine-content-calendar-integration.test.ts",
    ],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // These tests share ONE real Postgres and each file's beforeAll/beforeEach truncates
    // tables other files also read/write (EngineLead especially) — running files concurrently
    // caused real cross-file pollution (caught here: a lead created by the WhatsApp-sequence
    // suite was counted by the weekly-analytics-report window test in another file). Integration
    // tests against a shared live database are not safe to parallelize across files.
    fileParallelism: false,
  },
});
