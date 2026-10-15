import { defineConfig } from "vitest/config";

export default defineConfig({ root: process.cwd(), test: { include: ["test/**/*.test.ts"], environment: "node" } });
