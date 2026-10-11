/**
 * Minimal, dependency-free 5-field cron parser + timezone-aware "next run"
 * calculator. No npm cron package: this keeps the engine's only dependency
 * for scheduling the platform's own Intl/Date APIs, which already carry a
 * full IANA tz database (so DST transitions are handled correctly without
 * us tracking offsets ourselves).
 *
 * Supported field syntax: "*", "N", "N,M", "N-M", "*\/N", "N-M/S" per field.
 * Fields: minute(0-59) hour(0-23) day-of-month(1-31) month(1-12) day-of-week(0-6, 0=Sun).
 */

export interface ParsedCron {
  minutes: Set<number>;
  hours: Set<number>;
  doms: Set<number>;
  months: Set<number>;
  dows: Set<number>;
  domIsWildcard: boolean;
  dowIsWildcard: boolean;
}

function parseField(spec: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const [rangePartRaw, stepPart] = part.split("/");
    const rangePart = rangePartRaw ?? "*";
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step <= 0) throw new Error(`Invalid cron step "${part}"`);
    let lo = min, hi = max;
    if (rangePart !== "*") {
      if (rangePart.includes("-")) {
        const [aRaw, bRaw] = rangePart.split("-");
        const a = Number(aRaw), b = Number(bRaw);
        if (!Number.isInteger(a) || !Number.isInteger(b) || a > b) throw new Error(`Invalid cron range "${rangePart}"`);
        lo = a; hi = b;
      } else {
        const n = Number(rangePart);
        if (!Number.isInteger(n)) throw new Error(`Invalid cron value "${rangePart}"`);
        lo = n; hi = n;
      }
    }
    if (lo < min || hi > max) throw new Error(`Cron field value out of range ${min}-${max}: "${part}"`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr: string): ParsedCron {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`Cron expression must have 5 fields, got ${fields.length}: "${expr}"`);
  const [min, hour, dom, month, dow] = fields as [string, string, string, string, string];
  return {
    minutes: parseField(min, 0, 59),
    hours: parseField(hour, 0, 23),
    doms: parseField(dom, 1, 31),
    months: parseField(month, 1, 12),
    dows: parseField(dow, 0, 6),
    domIsWildcard: dom.trim() === "*",
    dowIsWildcard: dow.trim() === "*",
  };
}

/** Wall-clock fields of `instant` as observed in `timezone` — the basis for every DST-correct comparison below. */
function wallClock(instant: Date, timezone: string): { minute: number; hour: number; dom: number; month: number; dow: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, minute: "numeric", hour: "numeric", hourCycle: "h23",
    day: "numeric", month: "numeric", weekday: "short",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    minute: Number(get("minute")), hour: Number(get("hour")),
    dom: Number(get("day")), month: Number(get("month")), dow: dowMap[get("weekday")] ?? 0,
  };
}

const MAX_ITERATIONS = 60 * 24 * 400; // ~400 days of minute-stepping, a hard safety bound

/**
 * Next instant at/after `after` whose wall-clock time in `timezone` matches the cron fields.
 * Steps minute-by-minute (bounded) rather than computing offsets directly, so a DST "spring
 * forward" (a wall-clock minute that never occurs) or "fall back" (one that occurs twice) is
 * handled correctly for free — each candidate instant's real wall time is asked of Intl itself.
 */
export function nextRunAt(expr: string, timezone: string, after: Date): Date {
  const cron = parseCron(expr);
  // Round up to the next whole minute first.
  let t = new Date(Math.ceil((after.getTime() + 1) / 60_000) * 60_000);
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const w = wallClock(t, timezone);
    // Standard crontab(5) day semantics: if BOTH day-of-month and day-of-week are restricted,
    // a day matching EITHER satisfies it (an OR, not an AND); if only one is restricted, that
    // one alone decides; if both are "*", every day matches.
    const dayOk =
      cron.domIsWildcard && cron.dowIsWildcard ? true :
      cron.domIsWildcard ? cron.dows.has(w.dow) :
      cron.dowIsWildcard ? cron.doms.has(w.dom) :
      cron.doms.has(w.dom) || cron.dows.has(w.dow);
    if (cron.minutes.has(w.minute) && cron.hours.has(w.hour) && cron.months.has(w.month) && dayOk) {
      return t;
    }
    t = new Date(t.getTime() + 60_000);
  }
  throw new Error(`Could not find a next run for cron "${expr}" in timezone "${timezone}" within the search bound`);
}
