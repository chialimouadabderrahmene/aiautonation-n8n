/**
 * Provider registry: one entry per external service the Control Center can
 * configure. This is the single source of truth for:
 *   - which credential fields the Integrations UI renders (`fields`)
 *   - what a "connection test" actually does (`testConnection` — a real,
 *     lightweight, read-only call to the provider; never a fake success)
 *   - which category a provider groups under
 *
 * Adding a provider later means adding one entry here — nothing else in the
 * app hardcodes a provider name (see README "Adding a provider").
 */

export type IntegrationCategory =
  | "AI"
  | "ORCHESTRATION"
  | "MESSAGING"
  | "EMAIL"
  | "SOCIAL"
  | "RESEARCH"
  | "MEDIA";

export interface ProviderField {
  name: string;
  label: string;
  secret: boolean;
  required: boolean;
  placeholder?: string;
  /** Non-secret config value with a sane default (e.g. model name). */
  default?: string;
}

export interface TestResult {
  ok: boolean;
  message: string;
  latencyMs: number;
}

export interface ProviderDefinition {
  key: string;
  label: string;
  category: IntegrationCategory;
  description: string;
  /** Known limitation worth surfacing in the UI, if any (kept honest). */
  caveat?: string;
  fields: ProviderField[];
  testConnection: (values: Record<string, string>) => Promise<TestResult>;
}

const TIMEOUT_MS = 8000;

async function timedFetch(url: string, init: RequestInit): Promise<{ res: Response; latencyMs: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const start = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return { res, latencyMs: Date.now() - start };
  } finally {
    clearTimeout(timer);
  }
}

function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "AbortError") return "Request timed out";
    // Never leak stack traces or raw header dumps that might contain the key.
    return err.message.slice(0, 200);
  }
  return "Unknown error";
}

export const PROVIDERS: ProviderDefinition[] = [
  {
    key: "openai",
    label: "OpenAI",
    category: "AI",
    description: "Script generation, structuring, summarisation.",
    fields: [
      { name: "apiKey", label: "API Key", secret: true, required: true, placeholder: "sk-..." },
      { name: "model", label: "Default model", secret: false, required: false, default: "gpt-4o-mini" },
    ],
    async testConnection(values) {
      try {
        const { res, latencyMs } = await timedFetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${values.apiKey}` },
        });
        if (res.status === 401) return { ok: false, message: "Unauthorized API key", latencyMs };
        if (!res.ok) return { ok: false, message: `OpenAI responded ${res.status}`, latencyMs };
        return { ok: true, message: "Connected", latencyMs };
      } catch (err) {
        return { ok: false, message: safeErrorMessage(err), latencyMs: TIMEOUT_MS };
      }
    },
  },
  {
    key: "groq",
    label: "Groq",
    category: "AI",
    description: "Default AI provider for the existing n8n content workflows (OpenAI-compatible).",
    fields: [
      { name: "apiKey", label: "API Key", secret: true, required: true, placeholder: "gsk_..." },
      { name: "model", label: "Default model", secret: false, required: false, default: "llama-3.3-70b-versatile" },
    ],
    async testConnection(values) {
      try {
        const { res, latencyMs } = await timedFetch("https://api.groq.com/openai/v1/models", {
          headers: { Authorization: `Bearer ${values.apiKey}` },
        });
        if (res.status === 401) return { ok: false, message: "Unauthorized API key", latencyMs };
        if (!res.ok) return { ok: false, message: `Groq responded ${res.status}`, latencyMs };
        return { ok: true, message: "Connected", latencyMs };
      } catch (err) {
        return { ok: false, message: safeErrorMessage(err), latencyMs: TIMEOUT_MS };
      }
    },
  },
  {
    key: "n8n",
    label: "n8n",
    category: "ORCHESTRATION",
    description: "The workflow orchestration engine. Must be deployed separately (see docs/N8N_SETUP.md) before this can connect.",
    fields: [
      { name: "baseUrl", label: "n8n base URL", secret: false, required: true, placeholder: "https://your-instance.up.railway.app" },
      { name: "apiKey", label: "n8n API key", secret: true, required: true },
    ],
    async testConnection(values) {
      if (!values.baseUrl || !values.apiKey) {
        return { ok: false, message: "Missing base URL or API key", latencyMs: 0 };
      }
      try {
        const { res, latencyMs } = await timedFetch(
          `${values.baseUrl.replace(/\/+$/, "")}/api/v1/workflows?limit=1`,
          { headers: { "X-N8N-API-KEY": values.apiKey } },
        );
        if (res.status === 401) return { ok: false, message: "Unauthorized API key", latencyMs };
        if (!res.ok) return { ok: false, message: `n8n responded ${res.status}`, latencyMs };
        return { ok: true, message: "Connected", latencyMs };
      } catch (err) {
        return { ok: false, message: safeErrorMessage(err), latencyMs: TIMEOUT_MS };
      }
    },
  },
  {
    key: "telegram",
    label: "Telegram",
    category: "MESSAGING",
    description: "Content approvals, error alerts, video approval.",
    fields: [
      { name: "botToken", label: "Bot token", secret: true, required: true, placeholder: "123456:AA..." },
      { name: "approvalChatId", label: "Approval chat ID", secret: false, required: true },
    ],
    async testConnection(values) {
      try {
        const { res, latencyMs } = await timedFetch(`https://api.telegram.org/bot${values.botToken}/getMe`, {});
        const body = (await res.clone().json().catch(() => null)) as { ok?: boolean; description?: string } | null;
        if (!res.ok || !body?.ok) {
          return { ok: false, message: body?.description ?? `Telegram responded ${res.status}`, latencyMs };
        }
        return { ok: true, message: "Connected", latencyMs };
      } catch (err) {
        return { ok: false, message: safeErrorMessage(err), latencyMs: TIMEOUT_MS };
      }
    },
  },
  {
    key: "whatsapp",
    label: "WhatsApp Cloud API",
    category: "MESSAGING",
    description: "Lead conversations, nurture sequences. Business-initiated messages additionally require approved templates.",
    fields: [
      { name: "accessToken", label: "Access token (permanent, System User)", secret: true, required: true },
      { name: "phoneNumberId", label: "Phone number ID", secret: false, required: true },
      { name: "wabaId", label: "WhatsApp Business Account ID", secret: false, required: false },
      { name: "appSecret", label: "App secret (webhook signature)", secret: true, required: true },
      { name: "verifyToken", label: "Webhook verify token", secret: true, required: true },
    ],
    async testConnection(values) {
      try {
        const { res, latencyMs } = await timedFetch(
          `https://graph.facebook.com/v20.0/${values.phoneNumberId}?fields=display_phone_number`,
          { headers: { Authorization: `Bearer ${values.accessToken}` } },
        );
        const body = (await res.clone().json().catch(() => null)) as { error?: { message?: string } } | null;
        if (!res.ok) return { ok: false, message: body?.error?.message ?? `Meta responded ${res.status}`, latencyMs };
        return { ok: true, message: "Connected", latencyMs };
      } catch (err) {
        return { ok: false, message: safeErrorMessage(err), latencyMs: TIMEOUT_MS };
      }
    },
  },
  {
    key: "resend",
    label: "Resend",
    category: "EMAIL",
    description: "Transactional and sequence email.",
    fields: [
      { name: "apiKey", label: "API key", secret: true, required: true, placeholder: "re_..." },
      { name: "fromEmail", label: "From address (verified domain)", secret: false, required: true },
    ],
    async testConnection(values) {
      try {
        const { res, latencyMs } = await timedFetch("https://api.resend.com/domains", {
          headers: { Authorization: `Bearer ${values.apiKey}` },
        });
        if (res.status === 401) return { ok: false, message: "Unauthorized API key", latencyMs };
        if (!res.ok) return { ok: false, message: `Resend responded ${res.status}`, latencyMs };
        return { ok: true, message: "Connected", latencyMs };
      } catch (err) {
        return { ok: false, message: safeErrorMessage(err), latencyMs: TIMEOUT_MS };
      }
    },
  },
  {
    key: "buffer",
    label: "Buffer",
    category: "SOCIAL",
    description: "Social post scheduling.",
    caveat: "Buffer's legacy publish API (bufferapp.com/1) is what the existing workflows target; whether it still issues tokens to new integrations has not been confirmed against a real account.",
    fields: [
      { name: "accessToken", label: "Access token", secret: true, required: true },
    ],
    async testConnection(values) {
      try {
        const { res, latencyMs } = await timedFetch(
          `https://api.bufferapp.com/1/user.json?access_token=${encodeURIComponent(values.accessToken ?? "")}`,
          {},
        );
        if (!res.ok) return { ok: false, message: `Buffer responded ${res.status}`, latencyMs };
        return { ok: true, message: "Connected", latencyMs };
      } catch (err) {
        return { ok: false, message: safeErrorMessage(err), latencyMs: TIMEOUT_MS };
      }
    },
  },
  {
    key: "x",
    label: "X (Twitter)",
    category: "SOCIAL",
    description: "Direct posting to X.",
    fields: [
      { name: "accessToken", label: "User access token (OAuth2, tweet.read + users.read)", secret: true, required: true },
    ],
    async testConnection(values) {
      try {
        const { res, latencyMs } = await timedFetch("https://api.twitter.com/2/users/me", {
          headers: { Authorization: `Bearer ${values.accessToken}` },
        });
        if (res.status === 401) return { ok: false, message: "Unauthorized token", latencyMs };
        if (!res.ok) return { ok: false, message: `X responded ${res.status}`, latencyMs };
        return { ok: true, message: "Connected", latencyMs };
      } catch (err) {
        return { ok: false, message: safeErrorMessage(err), latencyMs: TIMEOUT_MS };
      }
    },
  },
  {
    key: "meta",
    label: "Meta (Facebook / Instagram)",
    category: "SOCIAL",
    description: "Page/Instagram Business publishing.",
    fields: [
      { name: "pageAccessToken", label: "Page access token", secret: true, required: true },
      { name: "pageId", label: "Page ID", secret: false, required: false },
    ],
    async testConnection(values) {
      try {
        const { res, latencyMs } = await timedFetch("https://graph.facebook.com/v20.0/me?fields=id,name", {
          headers: { Authorization: `Bearer ${values.pageAccessToken}` },
        });
        const body = (await res.clone().json().catch(() => null)) as { error?: { message?: string } } | null;
        if (!res.ok) return { ok: false, message: body?.error?.message ?? `Meta responded ${res.status}`, latencyMs };
        return { ok: true, message: "Connected", latencyMs };
      } catch (err) {
        return { ok: false, message: safeErrorMessage(err), latencyMs: TIMEOUT_MS };
      }
    },
  },
  {
    key: "apify",
    label: "Apify",
    category: "RESEARCH",
    description: "Trend/pain-point scraping actors.",
    fields: [
      { name: "apiToken", label: "API token", secret: true, required: true },
      { name: "trendsActorId", label: "Trends actor ID", secret: false, required: false },
    ],
    async testConnection(values) {
      try {
        const { res, latencyMs } = await timedFetch("https://api.apify.com/v2/users/me", {
          headers: { Authorization: `Bearer ${values.apiToken}` },
        });
        if (res.status === 401) return { ok: false, message: "Unauthorized token", latencyMs };
        if (!res.ok) return { ok: false, message: `Apify responded ${res.status}`, latencyMs };
        return { ok: true, message: "Connected", latencyMs };
      } catch (err) {
        return { ok: false, message: safeErrorMessage(err), latencyMs: TIMEOUT_MS };
      }
    },
  },
  {
    key: "google-sheets",
    label: "Google Sheets",
    category: "ORCHESTRATION",
    description: "The workflows' database (leads, content calendar, analytics, ...).",
    caveat: "n8n itself normally holds interactive Google OAuth2 credentials for the workflows to run. This entry uses a Google Cloud service-account key instead (simpler to test from a backend, no browser OAuth dance) — share the target spreadsheet with the service account's email as an Editor. This does NOT configure the credential n8n uses; it only lets the Control Center verify Sheets access independently.",
    fields: [
      { name: "serviceAccountJson", label: "Service account JSON key (paste full file contents)", secret: true, required: true },
      { name: "spreadsheetId", label: "Spreadsheet ID", secret: false, required: true },
    ],
    async testConnection(values) {
      const start = Date.now();
      try {
        const { GoogleAuth } = await import("google-auth-library");
        let keyFile: { client_email?: string; private_key?: string };
        try {
          keyFile = JSON.parse(values.serviceAccountJson ?? "");
        } catch {
          return { ok: false, message: "Service account JSON is not valid JSON", latencyMs: Date.now() - start };
        }
        const auth = new GoogleAuth({
          credentials: keyFile,
          scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
        });
        const client = await auth.getClient();
        const token = await client.getAccessToken();
        const { res, latencyMs } = await timedFetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${values.spreadsheetId}?fields=spreadsheetId`,
          { headers: { Authorization: `Bearer ${token.token}` } },
        );
        if (res.status === 403 || res.status === 404) {
          return { ok: false, message: "Access denied — share the spreadsheet with the service account's client_email", latencyMs };
        }
        if (!res.ok) return { ok: false, message: `Google Sheets responded ${res.status}`, latencyMs };
        return { ok: true, message: "Connected", latencyMs };
      } catch (err) {
        return { ok: false, message: safeErrorMessage(err), latencyMs: Date.now() - start };
      }
    },
  },
  {
    key: "runway",
    label: "Runway",
    category: "MEDIA",
    description: "Text-to-video and image-to-video scene generation.",
    caveat: "The test call targets Runway's documented Organization endpoint (api.dev.runwayml.com/v1/organization, API version header 2024-11-06). Verify against Runway's current API reference before relying on it — it has not been exercised against a real key.",
    fields: [
      { name: "apiKey", label: "API key", secret: true, required: true },
      { name: "model", label: "Default model", secret: false, required: false, default: "gen3a_turbo" },
      { name: "resolution", label: "Default resolution", secret: false, required: false, default: "1280x768" },
      { name: "aspectRatio", label: "Default aspect ratio", secret: false, required: false, default: "9:16" },
      { name: "durationSec", label: "Default scene duration (sec)", secret: false, required: false, default: "5" },
    ],
    async testConnection(values) {
      try {
        const { res, latencyMs } = await timedFetch("https://api.dev.runwayml.com/v1/organization", {
          headers: {
            Authorization: `Bearer ${values.apiKey}`,
            "X-Runway-Version": "2024-11-06",
          },
        });
        if (res.status === 401 || res.status === 403) return { ok: false, message: "Unauthorized API key", latencyMs };
        if (!res.ok) return { ok: false, message: `Runway responded ${res.status}`, latencyMs };
        return { ok: true, message: "Connected", latencyMs };
      } catch (err) {
        return { ok: false, message: safeErrorMessage(err), latencyMs: TIMEOUT_MS };
      }
    },
  },
  {
    key: "elevenlabs",
    label: "ElevenLabs",
    category: "MEDIA",
    description: "Voiceover generation.",
    fields: [
      { name: "apiKey", label: "API key", secret: true, required: true },
      { name: "voiceId", label: "Default voice ID", secret: false, required: false },
      { name: "model", label: "Default model", secret: false, required: false, default: "eleven_multilingual_v2" },
    ],
    async testConnection(values) {
      try {
        const { res, latencyMs } = await timedFetch("https://api.elevenlabs.io/v1/user", {
          headers: { "xi-api-key": values.apiKey ?? "" },
        });
        if (res.status === 401) return { ok: false, message: "Unauthorized API key", latencyMs };
        if (!res.ok) return { ok: false, message: `ElevenLabs responded ${res.status}`, latencyMs };
        return { ok: true, message: "Connected", latencyMs };
      } catch (err) {
        return { ok: false, message: safeErrorMessage(err), latencyMs: TIMEOUT_MS };
      }
    },
  },
];

export function getProvider(key: string): ProviderDefinition | undefined {
  return PROVIDERS.find((p) => p.key === key);
}
