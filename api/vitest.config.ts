import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"], exclude: ["test/engine-integration.test.ts", "test/engine-batch2-integration.test.ts"], environment: "node" },
});
