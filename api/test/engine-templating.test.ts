import { describe, it, expect } from "vitest";
import { resolveInput } from "../src/modules/engine/templating";

describe("step input templating", () => {
  const ctx = { trigger: { phone: "+391234", name: "Mario" }, lead: { leadId: "abc" } };

  it("a whole-string reference resolves to the raw (non-stringified) value", () => {
    expect(resolveInput("{{lead.leadId}}", ctx)).toBe("abc");
    expect(resolveInput({ x: "{{trigger.phone}}" }, { trigger: { phone: 123 } })).toEqual({ x: 123 });
  });

  it("interpolates references embedded in a larger string", () => {
    expect(resolveInput("Hello {{trigger.name}}, id {{lead.leadId}}", ctx)).toBe("Hello Mario, id abc");
  });

  it("leaves plain strings untouched and recurses into arrays/objects", () => {
    expect(resolveInput("no refs here", ctx)).toBe("no refs here");
    expect(resolveInput({ a: ["{{trigger.phone}}", "literal"], b: { c: "{{lead.leadId}}" } }, ctx)).toEqual({ a: ["+391234", "literal"], b: { c: "abc" } });
  });

  it("an unresolved path interpolates as empty string, never throws or leaves the braces", () => {
    expect(resolveInput("value: {{nope.nope}}", ctx)).toBe("value: ");
  });

  it("never executes anything — a string is always just a lookup, never a function call", () => {
    expect(resolveInput("{{constructor}}", ctx)).toBe(undefined);
  });
});
