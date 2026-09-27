/**
 * Outbound HTTP helpers shared by every provider call the API makes.
 *
 * - `timedFetch`: hard timeout (AbortController) + latency measurement.
 * - `ProviderError`: carries the HTTP status and whether a retry makes sense,
 *   with a message that is already safe to show an admin.
 * - `withRetry`: bounded exponential backoff for transient failures only
 *   (timeouts, 429, 5xx). Never retries 401/403/4xx — those need a human.
 * - `scrubSecrets`: removes known secret values from any text before it is
 *   logged, stored, or returned (provider error bodies sometimes echo the
 *   request, including the key).
 */

// Keep in sync with api/src/lib/http.ts (separately deployed service).

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * TEST MODE ONLY. When ALLOW_PROVIDER_OVERRIDES=true, PROVIDER_API_OVERRIDES
 * (JSON: {"api.openai.com":"http://mock:9100", ...}) redirects calls for
 * those hostnames — used to exercise the full pipeline against a local mock
 * in environments where real providers are unreachable. Off unless both are
 * set; when on, the Dashboard shows a red "TEST MODE" banner so it can never
 * pass silently for production.
 */
let overrides: Record<string, string> | null | undefined;
export function providerOverrides(): Record<string, string> | null {
  if (overrides !== undefined) return overrides;
  overrides = null;
  if (process.env.ALLOW_PROVIDER_OVERRIDES === "true" && process.env.PROVIDER_API_OVERRIDES) {
    try {
      overrides = JSON.parse(process.env.PROVIDER_API_OVERRIDES) as Record<string, string>;
    } catch {
      overrides = null;
    }
  }
  return overrides;
}

function applyOverride(url: string): string {
  const map = providerOverrides();
  if (!map) return url;
  const u = new URL(url);
  const target = map[u.hostname];
  if (!target) return url;
  return `${target.replace(/\/+$/, "")}${u.pathname}${u.search}`;
}

export async function timedFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<{ res: Response; latencyMs: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await fetch(applyOverride(url), { ...init, signal: controller.signal });
    return { res, latencyMs: Date.now() - start };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new ProviderError(`Request timed out after ${Math.round(timeoutMs / 1000)}s`, null, true);
    }
    const cause = err instanceof Error && "cause" in err ? (err as { cause?: { code?: string } }).cause?.code : undefined;
    throw new ProviderError(`Network error${cause ? ` (${cause})` : ""} — provider unreachable`, null, true);
  } finally {
    clearTimeout(timer);
  }
}

/** Maps an HTTP status to a safe, human-readable message and retryability. */
export function describeHttpFailure(provider: string, status: number, detail?: string): ProviderError {
  const suffix = detail ? `: ${detail.slice(0, 200)}` : "";
  if (status === 401) return new ProviderError(`${provider} rejected the credentials (401 Unauthorized)${suffix}`, status, false);
  if (status === 403) return new ProviderError(`${provider} denied access (403 Forbidden) — check the key's permissions/plan${suffix}`, status, false);
  if (status === 404) return new ProviderError(`${provider} resource not found (404)${suffix}`, status, false);
  if (status === 429) return new ProviderError(`${provider} rate limit or quota exceeded (429)${suffix}`, status, true);
  if (status >= 500) return new ProviderError(`${provider} is having problems (${status})${suffix}`, status, true);
  return new ProviderError(`${provider} responded ${status}${suffix}`, status, false);
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: { retries?: number; baseDelayMs?: number; onRetry?: (err: unknown, attempt: number) => void } = {},
): Promise<T> {
  const retries = opts.retries ?? 3;
  const base = opts.baseDelayMs ?? 1000;
  let attempt = 0;
  for (;;) {
    try {
      return await fn(attempt);
    } catch (err) {
      const retryable = err instanceof ProviderError ? err.retryable : false;
      if (!retryable || attempt >= retries) throw err;
      opts.onRetry?.(err, attempt + 1);
      const delay = base * 2 ** attempt + Math.floor(Math.random() * 250);
      await new Promise((r) => setTimeout(r, delay));
      attempt += 1;
    }
  }
}

export function scrubSecrets(text: string, secrets: Iterable<string | undefined | null>): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 6) out = out.split(s).join("[REDACTED]");
  }
  // Generic patterns for anything we don't know about explicitly.
  return out
    .replace(/(bot)\d{6,}:[A-Za-z0-9_-]{20,}/g, "$1[REDACTED]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, "$1[REDACTED]")
    .replace(/\b(sk|gsk|re|key|xi|pk|rk)[-_][A-Za-z0-9_-]{16,}\b/g, "[REDACTED]")
    .replace(/(access_token=)[^&\s"]+/gi, "$1[REDACTED]");
}

export function safeErrorMessage(err: unknown): string {
  if (err instanceof ProviderError) return err.message;
  if (err instanceof Error) return scrubSecrets(err.message, []).slice(0, 300);
  return "Unknown error";
}

/** Reads a provider's JSON error body and extracts a short, safe detail. */
export async function readErrorDetail(res: Response): Promise<string | undefined> {
  const text = await res.text().catch(() => "");
  if (!text) return undefined;
  try {
    const body = JSON.parse(text) as Record<string, unknown>;
    const candidates = [
      (body.error as { message?: string } | undefined)?.message,
      typeof body.error === "string" ? body.error : undefined,
      body.message,
      body.description,
      (body.detail as { message?: string } | undefined)?.message,
      typeof body.detail === "string" ? body.detail : undefined,
      body.title,
    ];
    const found = candidates.find((c): c is string => typeof c === "string" && c.length > 0);
    return found ? scrubSecrets(found, []).slice(0, 200) : undefined;
  } catch {
    return scrubSecrets(text, []).slice(0, 200);
  }
}
