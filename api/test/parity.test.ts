import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

describe("api/worker shared code parity (separately deployed copies)", () => {
  it("storage.ts is identical", () => expect(read("worker/src/lib/storage.ts")).toBe(read("api/src/lib/storage.ts")));
  it("crypto.ts is identical", () => expect(read("worker/src/lib/crypto.ts")).toBe(read("api/src/lib/crypto.ts")));
  it("http.ts is identical apart from the sync note", () => {
    const strip = (s: string) => s.split("\n").filter((l) => !l.startsWith("// Keep in sync")).join("\n");
    expect(strip(read("worker/src/lib/http.ts"))).toBe(strip(read("api/src/lib/http.ts")));
  });
  it("Prisma schemas are identical from the generator block on", () => {
    const body = (s: string) => s.slice(s.indexOf("generator client"));
    expect(body(read("worker/prisma/schema.prisma"))).toBe(body(read("api/prisma/schema.prisma")));
  });
  it("queue names match", () => {
    for (const name of ["video-generation", "video-delivery"]) {
      expect(read("api/src/lib/queue.ts")).toContain(`"${name}"`);
      expect(read("worker/src/lib/queue.ts")).toContain(`"${name}"`);
    }
  });
});
