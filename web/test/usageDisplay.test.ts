import { describe, expect, it } from "vitest";
import { formatMicros, usageLabel } from "../src/lib/usageDisplay";

describe("usage display", () => {
  it("formats integer micro-costs without floating-point drift", () => expect(formatMicros(123456)).toBe("$0.1235"));
  it("keeps unknown values visibly unknown", () => expect(formatMicros(Number.NaN)).toBe("Unknown"));
  it("labels cost provenance", () => expect(usageLabel("PROVIDER_REPORTED")).toBe("Provider reported"));
});
