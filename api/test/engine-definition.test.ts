import { describe, it, expect } from "vitest";
import { validateDefinition, checkActionReferences } from "../src/modules/engine/definition";
import { ACTION_REGISTRY } from "../src/modules/engine/actions";

describe("workflow definition validation", () => {
  it("accepts a well-formed definition with every step type", () => {
    const result = validateDefinition({
      steps: [
        { key: "s1", type: "action", action: "lead.upsert", input: { phone: "{{trigger.phone}}" } },
        { key: "s2", type: "condition", condition: { path: "s1.isNew", op: "eq", value: true } },
        { key: "s3", type: "delay", ms: 1000 },
        { key: "s4", type: "parallel", branches: [{ key: "b1", type: "action", action: "notify.telegram", input: { chatId: "1", text: "hi" } }] },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an unknown step type, a bad operator, and duplicate step keys", () => {
    expect(validateDefinition({ steps: [{ key: "s1", type: "code", script: "process.exit()" }] }).ok).toBe(false);
    expect(validateDefinition({ steps: [{ key: "s1", type: "condition", condition: { path: "x", op: "nope" } }] }).ok).toBe(false);
    expect(validateDefinition({ steps: [
      { key: "dup", type: "delay", ms: 1 },
      { key: "dup", type: "delay", ms: 1 },
    ] }).ok).toBe(false);
  });

  it("rejects a delay longer than 7 days and a timeout longer than 120s — sane operational bounds", () => {
    expect(validateDefinition({ steps: [{ key: "s", type: "delay", ms: 8 * 24 * 60 * 60 * 1000 }] }).ok).toBe(false);
    expect(validateDefinition({ steps: [{ key: "s", type: "action", action: "x", timeoutMs: 999_999 }] }).ok).toBe(false);
  });

  it("checkActionReferences catches a step pointing at an action that doesn't exist in the registry", () => {
    const parsed = validateDefinition({ steps: [{ key: "s1", type: "action", action: "totally.made.up" }] });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const unknown = checkActionReferences(parsed.definition, new Set(Object.keys(ACTION_REGISTRY)));
      expect(unknown).toEqual(['s1 -> "totally.made.up"']);
    }
  });

  it("has no unresolvable action reference in a definition that only uses real registry keys", () => {
    const parsed = validateDefinition({ steps: [{ key: "s1", type: "action", action: "lead.upsert" }] });
    if (parsed.ok) expect(checkActionReferences(parsed.definition, new Set(Object.keys(ACTION_REGISTRY)))).toEqual([]);
  });
});
