import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: [
      "test/engine-integration.test.ts",
      "test/engine-batch2-integration.test.ts",
      "test/engine-whatsapp-sequence-integration.test.ts",
      "test/engine-whatsapp-webhook-integration.test.ts",
      "test/engine-social-posting-integration.test.ts",
      "test/engine-intelligence-integration.test.ts",
      "test/engine-content-calendar-integration.test.ts",
      "test/engine-autopilot-controller-integration.test.ts",
    ],
    environment: "node",
  },
});
