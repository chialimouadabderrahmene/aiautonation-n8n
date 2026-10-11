/**
 * Minimal, safe templating for step `input`: a string value of the exact form "{{path}}" is
 * replaced with the context value at that path (any type, not stringified); a string
 * containing one or more "{{path}}" substrings mixed with other text has each substituted and
 * coerced to a string. No expression language, no function calls — just context lookups, so a
 * workflow definition can never execute arbitrary logic through its own input values.
 */

function get(ctx: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined || typeof acc !== "object") return undefined;
    // Own properties only — never resolve through the prototype chain (no leaking
    // `constructor`, `__proto__`, inherited methods, etc. into a workflow's output/context).
    if (!Object.prototype.hasOwnProperty.call(acc, key)) return undefined;
    return (acc as Record<string, unknown>)[key];
  }, ctx);
}

const REF = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

function resolveString(value: string, ctx: unknown): unknown {
  const whole = value.match(/^\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}$/);
  if (whole?.[1]) return get(ctx, whole[1]);
  if (!REF.test(value)) return value;
  return value.replace(REF, (_m, path: string) => {
    const v = get(ctx, path);
    return v === undefined || v === null ? "" : String(v);
  });
}

export function resolveInput(input: unknown, ctx: unknown): unknown {
  if (typeof input === "string") return resolveString(input, ctx);
  if (Array.isArray(input)) return input.map((v) => resolveInput(v, ctx));
  if (input && typeof input === "object") {
    return Object.fromEntries(Object.entries(input as Record<string, unknown>).map(([k, v]) => [k, resolveInput(v, ctx)]));
  }
  return input;
}
