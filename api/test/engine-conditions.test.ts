import { describe, it, expect } from "vitest";
import { evaluateCondition } from "../src/modules/engine/conditions";

describe("condition evaluator", () => {
  const ctx = { lead: { email: "a@b.com", age: 30, tags: ["vip", "italy"] }, flag: true };

  it("leaf operators", () => {
    expect(evaluateCondition(ctx, { path: "lead.email", op: "eq", value: "a@b.com" })).toBe(true);
    expect(evaluateCondition(ctx, { path: "lead.email", op: "neq", value: "x@y.com" })).toBe(true);
    expect(evaluateCondition(ctx, { path: "lead.age", op: "gt", value: 18 })).toBe(true);
    expect(evaluateCondition(ctx, { path: "lead.age", op: "lte", value: 30 })).toBe(true);
    expect(evaluateCondition(ctx, { path: "lead.email", op: "contains", value: "@b" })).toBe(true);
    expect(evaluateCondition(ctx, { path: "lead.tags", op: "contains", value: "vip" })).toBe(true);
    expect(evaluateCondition(ctx, { path: "lead.age", op: "in", value: [10, 20, 30] })).toBe(true);
    expect(evaluateCondition(ctx, { path: "missing.path", op: "exists" })).toBe(false);
    expect(evaluateCondition(ctx, { path: "flag", op: "exists" })).toBe(true);
    expect(evaluateCondition(ctx, { path: "lead.email", op: "matches", value: "^a@" })).toBe(true);
  });

  it("AND/OR/NOT groups, including nesting", () => {
    expect(evaluateCondition(ctx, { all: [{ path: "flag", op: "eq", value: true }, { path: "lead.age", op: "gt", value: 18 }] })).toBe(true);
    expect(evaluateCondition(ctx, { all: [{ path: "flag", op: "eq", value: true }, { path: "lead.age", op: "gt", value: 99 }] })).toBe(false);
    expect(evaluateCondition(ctx, { any: [{ path: "lead.age", op: "gt", value: 99 }, { path: "flag", op: "eq", value: true }] })).toBe(true);
    expect(evaluateCondition(ctx, { not: { path: "flag", op: "eq", value: false } })).toBe(true);
    expect(evaluateCondition(ctx, { all: [{ any: [{ path: "lead.age", op: "lt", value: 10 }, { path: "flag", op: "eq", value: true }] }, { not: { path: "lead.age", op: "gt", value: 99 } }] })).toBe(true);
  });

  it("undefined/empty condition is vacuously true; an empty group is vacuously true", () => {
    expect(evaluateCondition(ctx, undefined)).toBe(true);
    expect(evaluateCondition(ctx, {})).toBe(true);
  });

  it("type-mismatched numeric comparisons are false, never a thrown error or a coercion surprise", () => {
    expect(evaluateCondition(ctx, { path: "lead.email", op: "gt", value: 5 })).toBe(false);
  });
});
