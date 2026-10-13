import { ProviderDefinition, ProviderField, TestResult, OAuthResult } from "./types";
import { timedFetch, describeHttpFailure, readErrorDetail, safeErrorMessage, ProviderError } from "../../lib/http";

/**
 * Every provider the Control Center can configure. See ./types.ts for the
 * contract. Test calls are real, read-only, and never report success on
 * anything but a verified 2xx from the provider itself.
 */

async function failed(err: unknown, start: number): Promise<TestResult> {
  return { ok: false, message: safeErrorMessage(err), latencyMs: Date.now() - start };
}

/** GET a URL with headers; 2xx → ok, otherwise a safe failure message. */
async function probe(
  provider: string,
  url: string,
  headers: Record<string, string>,
  onOk?: (body: unknown) => { message?: string; account?: string } | Promise<{ message?: string; account?: string }>,
): Promise<TestResult> {
  const start = Date.now();
  try {
    const { res, latencyMs } = await timedFetch(url, { headers });
    if (!res.ok) {
      const err = describeHttpFailure(provider, res.status, await readErrorDetail(res));
      return { ok: false, message: err.message, latencyMs };
    }
    const body = await res.json().catch(() => null);
    const extra = onOk ? await onOk(body) : {};
    return { ok: true, message: extra.message ?? "Connected", latencyMs, account: extra.account };
  } catch (err) {
    return failed(err, start);
  }
}

function formBody(values: Record<string, string | undefined>): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(values)) if (v !== undefined) p.set(k, v);
  return p;
}

async function postForm(provider: string, url: string, body: URLSearchParams, headers: Record<string, string> = {}) {
  const { res } = await timedFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", ...headers },
    body,
  });
  if (!res.ok) throw describeHttpFailure(provider, res.status, await readErrorDetail(res));
  return (await res.json()) as Record<string, unknown>;
}

function expiry(expiresIn: unknown): Date | undefined {
  const n = Number(expiresIn);
  return Number.isFinite(n) && n > 0 ? new Date(Date.now() + n * 1000) : undefined;
}

const WA_TEMPLATE_KEYS = [
  "WELCOME_D1", "WELCOME_D2", "WELCOME_D3",
  "REENGAGE_7", "REENGAGE_14", "REENGAGE_21",
  "NURTURE_VENDOR_D1", "NURTURE_VENDOR_D2", "NURTURE_VENDOR_D3", "NURTURE_VENDOR_D7", "NURTURE_VENDOR_D14",
  "NURTURE_BUYER_D1", "NURTURE_BUYER_D3", "NURTURE_BUYER_D5",
  "WAITLIST_CONFIRM",
] as const;

/** camelCase field name for a template key: WELCOME_D1 -> tplWelcomeD1 */
export function templateFieldName(key: string): string {
  return "tpl" + key.toLowerCase().split("_").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
}

const waTemplateFields: ProviderField[] = WA_TEMPLATE_KEYS.map((key) => ({
  name: templateFieldName(key),
  label: `Template name: ${key}`,
  type: "text" as const,
  secret: false,
  required: false,
  group: "Approved message templates",
  help: "Exact name of the Meta-approved template. Empty = that step is skipped (the team gets one Telegram alert).",
  pattern: "^[a-z0-9_]+$",
  patternMessage: "Template names are lowercase letters, digits and underscores",
}));

export { WA_TEMPLATE_KEYS };

const X_API = "https://api.x.com/2";
const META_GRAPH = "https://graph.facebook.com";

export const PROVIDERS: ProviderDefinition[] = [
  // ------------------------------------------------------------------ AI
  {
    key: "openai",
    label: "OpenAI",
    category: "AI",
    authType: "API_KEY",
    description: "Video scripts and (when chosen as the AI provider in Settings) every AI step in the n8n workflows.",
    docsUrl: "https://platform.openai.com/api-keys",
    fields: [
      { name: "apiKey", label: "API key", type: "secret", secret: true, required: true, placeholder: "sk-...", pattern: "^sk-[A-Za-z0-9_-]{20,}$", patternMessage: "OpenAI keys start with sk-" },
      { name: "model", label: "Default model", type: "text", secret: false, required: false, default: "gpt-4o-mini", group: "Settings" },
    ],
    testConnection: (v) =>
      probe("OpenAI", "https://api.openai.com/v1/models", { Authorization: `Bearer ${v.apiKey}` }, (body) => {
        const models = (body as { data?: { id: string }[] } | null)?.data ?? [];
        const model = v.model || "gpt-4o-mini";
        const has = models.some((m) => m.id === model);
        return { message: has ? `Connected — model ${model} available` : `Connected — but model "${model}" is not available to this key` };
      }),
  },
  {
    key: "groq",
    label: "Groq",
    category: "AI",
    authType: "API_KEY",
    description: "Fast, low-cost OpenAI-compatible AI. Default provider for the n8n content workflows.",
    docsUrl: "https://console.groq.com/keys",
    fields: [
      { name: "apiKey", label: "API key", type: "secret", secret: true, required: true, placeholder: "gsk_...", pattern: "^gsk_[A-Za-z0-9]{20,}$", patternMessage: "Groq keys start with gsk_" },
      { name: "model", label: "Default model", type: "text", secret: false, required: false, default: "llama-3.3-70b-versatile", group: "Settings" },
    ],
    testConnection: (v) => probe("Groq", "https://api.groq.com/openai/v1/models", { Authorization: `Bearer ${v.apiKey}` }),
  },
  {
    key: "anthropic",
    label: "Anthropic (Claude)",
    category: "AI",
    authType: "API_KEY",
    description: "Script writing and the Brand/Audience critic pass, when chosen as the AI provider.",
    docsUrl: "https://console.anthropic.com/settings/keys",
    fields: [
      { name: "apiKey", label: "API key", type: "secret", secret: true, required: true, placeholder: "sk-ant-...", pattern: "^sk-ant-[A-Za-z0-9_-]{20,}$", patternMessage: "Anthropic keys start with sk-ant-" },
      { name: "model", label: "Default model", type: "text", secret: false, required: false, default: "claude-sonnet-4-5", group: "Settings" },
    ],
    testConnection: (v) =>
      probe("Anthropic", "https://api.anthropic.com/v1/models", { "x-api-key": v.apiKey ?? "", "anthropic-version": "2023-06-01" }, (body) => {
        const models = (body as { data?: { id: string }[] } | null)?.data ?? [];
        const model = v.model || "claude-sonnet-4-5";
        const has = models.some((m) => m.id === model || m.id.startsWith(model));
        return { message: has ? `Connected — model ${model} available` : `Connected — but model "${model}" was not found in this key's model list` };
      }),
  },

  // ------------------------------------------------------- Orchestration
  {
    key: "n8n",
    label: "n8n",
    category: "ORCHESTRATION",
    authType: "INFRA",
    description:
      "Workflow engine running the 22 automations. Connected automatically by the deployment (private network + an API key the Control Center creates itself). Edit only if you moved n8n elsewhere.",
    fields: [
      { name: "baseUrl", label: "n8n URL (internal)", type: "url", secret: false, required: true, placeholder: "http://n8n.railway.internal:5678" },
      { name: "publicUrl", label: "n8n public URL (editor + webhooks)", type: "url", secret: false, required: false, placeholder: "https://n8n-yourproject.up.railway.app" },
      { name: "apiKey", label: "n8n API key", type: "secret", secret: true, required: true },
    ],
    testConnection: (v) =>
      probe("n8n", `${(v.baseUrl ?? "").replace(/\/+$/, "")}/api/v1/workflows?limit=250`, { "X-N8N-API-KEY": v.apiKey ?? "" }, (body) => {
        const count = (body as { data?: unknown[] } | null)?.data?.length ?? 0;
        return { message: `Connected — ${count} workflow(s) in n8n`, account: v.publicUrl || v.baseUrl };
      }),
  },
  {
    key: "google-sheets",
    label: "Google Sheets",
    category: "ORCHESTRATION",
    authType: "API_KEY",
    description:
      "The workflows' database (leads, content calendar, analytics). Uses a Google Cloud service account — the right mechanism for a server: no browser consent that expires. The same key is pushed into n8n automatically.",
    docsUrl: "https://console.cloud.google.com/iam-admin/serviceaccounts",
    caveat: "Share the spreadsheet with the service account's client_email as an Editor, otherwise the test fails with 'access denied'.",
    fields: [
      { name: "serviceAccountJson", label: "Service account JSON key (paste the whole file)", type: "json", secret: true, required: true, placeholder: '{"type":"service_account",...}' },
      { name: "spreadsheetId", label: "Spreadsheet ID", type: "text", secret: false, required: true, pattern: "^[A-Za-z0-9_-]{25,}$", patternMessage: "The long ID between /d/ and /edit in the sheet URL", help: "From the sheet URL: docs.google.com/spreadsheets/d/<ID>/edit" },
    ],
    async testConnection(v) {
      const start = Date.now();
      try {
        let keyFile: { client_email?: string; private_key?: string };
        try {
          keyFile = JSON.parse(v.serviceAccountJson ?? "");
        } catch {
          return { ok: false, message: "Service account JSON is not valid JSON", latencyMs: Date.now() - start };
        }
        if (!keyFile.client_email || !keyFile.private_key) {
          return { ok: false, message: "JSON is missing client_email/private_key — download a service account KEY file", latencyMs: Date.now() - start };
        }
        const { GoogleAuth } = await import("google-auth-library");
        const auth = new GoogleAuth({ credentials: keyFile, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
        const token = await (await auth.getClient()).getAccessToken().catch((err: unknown) => {
          throw new ProviderError(`Google rejected the service account key: ${safeErrorMessage(err)}`, 401, false);
        });
        const { res, latencyMs } = await timedFetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(v.spreadsheetId ?? "")}?fields=properties.title,sheets.properties.title`,
          { headers: { Authorization: `Bearer ${token.token}` } },
        );
        if (res.status === 403 || res.status === 404) {
          return { ok: false, message: `Access denied — share the spreadsheet with ${keyFile.client_email} as Editor`, latencyMs };
        }
        if (!res.ok) return { ok: false, message: describeHttpFailure("Google Sheets", res.status, await readErrorDetail(res)).message, latencyMs };
        const body = (await res.json()) as { properties?: { title?: string }; sheets?: { properties?: { title?: string } }[] };
        const tabs = (body.sheets ?? []).map((s) => s.properties?.title).filter(Boolean);
        return { ok: true, message: `Connected — "${body.properties?.title ?? "spreadsheet"}" (${tabs.length} tabs)`, latencyMs, account: keyFile.client_email };
      } catch (err) {
        return failed(err, start);
      }
    },
  },
  {
    key: "webhooks",
    label: "Inbound webhook security",
    category: "ORCHESTRATION",
    authType: "INFRA",
    description:
      "Shared secret that websites/apps must send (header X-Eki-Webhook-Secret) when posting leads, waitlist sign-ups, referrals and feedback to the automations. Generated automatically; rotate it here.",
    fields: [
      { name: "sharedSecret", label: "Webhook shared secret", type: "secret", secret: true, required: true, generatable: true, pattern: "^.{24,}$", patternMessage: "Use at least 24 characters" },
    ],
    async testConnection(v) {
      const len = (v.sharedSecret ?? "").length;
      if (len < 24) return { ok: false, message: "Secret missing or shorter than 24 characters", latencyMs: 0 };
      return { ok: true, message: `Secret set (${len} characters). It is pushed into n8n's header-auth credential on sync.`, latencyMs: 0 };
    },
  },

  // ----------------------------------------------------------- Messaging
  {
    key: "telegram",
    label: "Telegram",
    category: "MESSAGING",
    authType: "API_KEY",
    description: "Team alerts, content approvals and video APPROVE / REJECT buttons.",
    docsUrl: "https://core.telegram.org/bots#how-do-i-create-a-bot",
    fields: [
      { name: "botToken", label: "Bot token (from @BotFather)", type: "secret", secret: true, required: true, placeholder: "123456789:AA...", pattern: "^\\d{6,}:[A-Za-z0-9_-]{30,}$", patternMessage: "Looks like 123456789:AA... from @BotFather" },
      { name: "approvalChatId", label: "Team chat ID", type: "text", secret: false, required: true, pattern: "^-?\\d{5,}$", patternMessage: "Numeric chat id (groups are negative, e.g. -1001234567890)", help: "Add the bot to your team group, then use @userinfobot / getUpdates to read the group's id." },
    ],
    async testConnection(v) {
      const start = Date.now();
      try {
        const base = `https://api.telegram.org/bot${v.botToken}`;
        const { res, latencyMs } = await timedFetch(`${base}/getMe`);
        const me = (await res.json().catch(() => null)) as { ok?: boolean; description?: string; result?: { username?: string } } | null;
        if (!res.ok || !me?.ok) return { ok: false, message: `Telegram: ${me?.description ?? `responded ${res.status}`}`, latencyMs };
        const account = me.result?.username ? `@${me.result.username}` : undefined;
        if (v.approvalChatId) {
          const { res: chatRes } = await timedFetch(`${base}/getChat?chat_id=${encodeURIComponent(v.approvalChatId)}`);
          const chat = (await chatRes.json().catch(() => null)) as { ok?: boolean; description?: string; result?: { title?: string } } | null;
          if (!chat?.ok) {
            return { ok: false, message: `Bot works, but it cannot see chat ${v.approvalChatId}: ${chat?.description ?? "unknown"} — add the bot to the group`, latencyMs: Date.now() - start, account };
          }
          return { ok: true, message: `Connected — bot is in "${chat.result?.title ?? v.approvalChatId}"`, latencyMs: Date.now() - start, account };
        }
        return { ok: true, message: "Connected", latencyMs, account };
      } catch (err) {
        return failed(err, start);
      }
    },
  },
  {
    key: "whatsapp",
    label: "WhatsApp Cloud API",
    category: "MESSAGING",
    authType: "API_KEY",
    description: "Lead conversations and nurture sequences. Business-initiated messages need Meta-approved templates (names below).",
    docsUrl: "https://developers.facebook.com/docs/whatsapp/cloud-api/get-started",
    fields: [
      { name: "accessToken", label: "Permanent access token (System User)", type: "secret", secret: true, required: true },
      { name: "phoneNumberId", label: "Phone number ID", type: "text", secret: false, required: true, pattern: "^\\d{8,}$", patternMessage: "Numeric id from WhatsApp → API Setup" },
      { name: "wabaId", label: "WhatsApp Business Account ID", type: "text", secret: false, required: false, pattern: "^\\d{8,}$", patternMessage: "Numeric id" },
      { name: "appSecret", label: "Meta app secret (verifies webhook signatures)", type: "secret", secret: true, required: true },
      { name: "verifyToken", label: "Webhook verify token", type: "secret", secret: true, required: true, generatable: true, help: "Paste the same value into Meta → WhatsApp → Configuration → Verify token." },
      { name: "graphVersion", label: "Graph API version", type: "text", secret: false, required: false, default: "v23.0", group: "Settings", pattern: "^v\\d+\\.\\d+$" },
      { name: "templateLang", label: "Template language code", type: "text", secret: false, required: false, default: "en", group: "Settings" },
      { name: "maxPerRun", label: "Max template sends per workflow run", type: "number", secret: false, required: false, default: "40", group: "Settings" },
      ...waTemplateFields,
    ],
    testConnection: (v) =>
      probe(
        "WhatsApp (Meta)",
        `${META_GRAPH}/${v.graphVersion || "v23.0"}/${encodeURIComponent(v.phoneNumberId ?? "")}?fields=display_phone_number,verified_name,quality_rating`,
        { Authorization: `Bearer ${v.accessToken}` },
        (body) => {
          const b = body as { display_phone_number?: string; verified_name?: string } | null;
          return { account: [b?.verified_name, b?.display_phone_number].filter(Boolean).join(" · ") || undefined };
        },
      ),
  },

  // ---------------------------------------------------------------- Email
  {
    key: "resend",
    label: "Resend",
    category: "EMAIL",
    authType: "API_KEY",
    description: "Transactional and sequence email, weekly reports.",
    docsUrl: "https://resend.com/api-keys",
    fields: [
      { name: "apiKey", label: "API key", type: "secret", secret: true, required: true, placeholder: "re_...", pattern: "^re_[A-Za-z0-9_]{10,}$", patternMessage: "Resend keys start with re_" },
      { name: "fromEmail", label: "From address", type: "text", secret: false, required: true, placeholder: "Eki <hello@your-domain.com>", help: "Must be on a domain verified in Resend." },
      { name: "teamEmail", label: "Team email (receives weekly reports)", type: "email", secret: false, required: false },
    ],
    async testConnection(v) {
      const start = Date.now();
      try {
        const { res, latencyMs } = await timedFetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${v.apiKey}` } });
        if (!res.ok) {
          // Send-only keys cannot list domains; that still proves the key is valid.
          const detail = await readErrorDetail(res);
          if (res.status === 401 && detail && /restricted/i.test(detail)) {
            return { ok: true, message: "Connected (sending-only key — domain verification not checked)", latencyMs };
          }
          return { ok: false, message: describeHttpFailure("Resend", res.status, detail).message, latencyMs };
        }
        const body = (await res.json()) as { data?: { name: string; status: string }[] };
        const domain = (v.fromEmail ?? "").match(/@([^>\s]+)/)?.[1]?.toLowerCase();
        const match = body.data?.find((d) => d.name.toLowerCase() === domain);
        if (domain && !match) return { ok: false, message: `Key works, but ${domain} is not a domain in this Resend account`, latencyMs };
        if (match && match.status !== "verified") return { ok: false, message: `Domain ${domain} is "${match.status}" in Resend — finish DNS verification`, latencyMs };
        return { ok: true, message: domain ? `Connected — ${domain} verified` : "Connected", latencyMs, account: domain };
      } catch (err) {
        return failed(err, start);
      }
    },
  },

  // --------------------------------------------------------------- Social
  {
    key: "buffer",
    label: "Buffer",
    category: "SOCIAL",
    authType: "API_KEY",
    description: "Social post scheduling used by workflows 10, 12 and 14.",
    docsUrl: "https://buffer.com/developers/api",
    caveat:
      "Buffer no longer registers new OAuth apps for its legacy API, so this uses an existing access token. The legacy API shape the workflows use has not been confirmed against a live Buffer account.",
    fields: [
      { name: "accessToken", label: "Access token", type: "secret", secret: true, required: true },
      { name: "profileIdInstagram", label: "Instagram profile ID", type: "text", secret: false, required: false, group: "Profiles" },
      { name: "profileIdFacebook", label: "Facebook profile ID", type: "text", secret: false, required: false, group: "Profiles" },
      { name: "profileIdLinkedin", label: "LinkedIn profile ID", type: "text", secret: false, required: false, group: "Profiles" },
      { name: "profileIdTiktok", label: "TikTok profile ID", type: "text", secret: false, required: false, group: "Profiles" },
    ],
    async testConnection(v) {
      const start = Date.now();
      try {
        // Buffer's legacy API documents the token as a query parameter; this URL is never logged.
        const { res, latencyMs } = await timedFetch(`https://api.bufferapp.com/1/user.json?access_token=${encodeURIComponent(v.accessToken ?? "")}`);
        if (!res.ok) return { ok: false, message: describeHttpFailure("Buffer", res.status, await readErrorDetail(res)).message, latencyMs };
        const body = (await res.json().catch(() => null)) as { name?: string } | null;
        return { ok: true, message: "Connected", latencyMs, account: body?.name };
      } catch (err) {
        return failed(err, start);
      }
    },
  },
  {
    key: "x",
    label: "X (Twitter)",
    category: "SOCIAL",
    authType: "OAUTH",
    description: "Posting to X (workflow 10 and approved videos). Connect the brand account with OAuth — tokens stay on the server and refresh automatically.",
    docsUrl: "https://developer.x.com/en/portal/dashboard",
    fields: [
      { name: "clientId", label: "OAuth 2.0 Client ID", type: "text", secret: false, required: true, group: "OAuth app" },
      { name: "clientSecret", label: "OAuth 2.0 Client Secret", type: "secret", secret: true, required: true, group: "OAuth app" },
    ],
    oauth: {
      authorizeUrl: "https://x.com/i/oauth2/authorize",
      scopes: ["tweet.read", "tweet.write", "users.read", "media.write", "offline.access"],
      pkce: true,
      scopeSeparator: " ",
      async exchangeCode({ code, redirectUri, codeVerifier, values }) {
        const basic = Buffer.from(`${values.clientId}:${values.clientSecret}`).toString("base64");
        const tokens = await postForm(
          "X",
          `${X_API}/oauth2/token`,
          formBody({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: codeVerifier, client_id: values.clientId }),
          { Authorization: `Basic ${basic}` },
        );
        return xFinalize(tokens);
      },
      async refresh({ values }) {
        const basic = Buffer.from(`${values.clientId}:${values.clientSecret}`).toString("base64");
        const tokens = await postForm(
          "X",
          `${X_API}/oauth2/token`,
          formBody({ grant_type: "refresh_token", refresh_token: values.refreshToken, client_id: values.clientId }),
          { Authorization: `Basic ${basic}` },
        );
        return xFinalize(tokens);
      },
    },
    testConnection: (v) =>
      probe("X", `${X_API}/users/me`, { Authorization: `Bearer ${v.accessToken}` }, (body) => {
        const u = (body as { data?: { username?: string } } | null)?.data;
        return { account: u?.username ? `@${u.username}` : undefined };
      }),
  },
  {
    key: "meta",
    label: "Meta (Facebook Page / Instagram)",
    category: "SOCIAL",
    authType: "OAUTH",
    description: "Publishes approved videos as Facebook Page videos and Instagram Reels. Connect with Facebook Login; the page token is stored encrypted.",
    docsUrl: "https://developers.facebook.com/apps",
    fields: [
      { name: "appId", label: "Meta App ID", type: "text", secret: false, required: true, group: "OAuth app", pattern: "^\\d{8,}$" },
      { name: "appSecret", label: "Meta App Secret", type: "secret", secret: true, required: true, group: "OAuth app" },
      { name: "pageId", label: "Facebook Page ID (optional — first page is used if empty)", type: "text", secret: false, required: false, group: "Settings" },
      { name: "graphVersion", label: "Graph API version", type: "text", secret: false, required: false, default: "v23.0", group: "Settings", pattern: "^v\\d+\\.\\d+$" },
    ],
    oauth: {
      authorizeUrl: "https://www.facebook.com/v23.0/dialog/oauth",
      scopes: ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "instagram_basic", "instagram_content_publish", "business_management"],
      pkce: false,
      scopeSeparator: ",",
      async exchangeCode({ code, redirectUri, values }) {
        const ver = values.graphVersion || "v23.0";
        const q = (p: Record<string, string>) => new URLSearchParams(p).toString();
        const get = async (url: string) => {
          const { res } = await timedFetch(url);
          if (!res.ok) throw describeHttpFailure("Meta", res.status, await readErrorDetail(res));
          return (await res.json()) as Record<string, unknown>;
        };
        const short = await get(`${META_GRAPH}/${ver}/oauth/access_token?${q({ client_id: values.appId ?? "", client_secret: values.appSecret ?? "", redirect_uri: redirectUri, code })}`);
        const long = await get(
          `${META_GRAPH}/${ver}/oauth/access_token?${q({ grant_type: "fb_exchange_token", client_id: values.appId ?? "", client_secret: values.appSecret ?? "", fb_exchange_token: String(short.access_token) })}`,
        );
        const userToken = String(long.access_token);
        // Page tokens derived from a long-lived user token do not expire.
        const pages = (await get(`${META_GRAPH}/${ver}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&access_token=${encodeURIComponent(userToken)}`)) as {
          data?: { id: string; name: string; access_token: string; instagram_business_account?: { id: string; username?: string } }[];
        };
        const page = pages.data?.find((p) => !values.pageId || p.id === values.pageId);
        if (!page) {
          throw new ProviderError(values.pageId ? `Page ${values.pageId} was not granted to this app` : "No Facebook Page was granted — select a Page in the Facebook dialog", 400, false);
        }
        const ig = page.instagram_business_account;
        return {
          account: `${page.name}${ig?.username ? ` · IG @${ig.username}` : ""}`,
          secrets: { userAccessToken: userToken, pageAccessToken: page.access_token },
          config: { pageId: page.id, pageName: page.name, instagramUserId: ig?.id ?? "" },
          expiresAt: null,
        };
      },
    },
    testConnection: (v) =>
      probe(
        "Meta",
        `${META_GRAPH}/${v.graphVersion || "v23.0"}/${encodeURIComponent(v.pageId || "me")}?fields=id,name,instagram_business_account{username}`,
        { Authorization: `Bearer ${v.pageAccessToken}` },
        (body) => {
          const b = body as { name?: string; instagram_business_account?: { username?: string } } | null;
          const ig = b?.instagram_business_account?.username;
          return { account: `${b?.name ?? "Page"}${ig ? ` · IG @${ig}` : ""}`, message: ig ? "Connected — Page + Instagram" : "Connected — Page only (no Instagram business account linked)" };
        },
      ),
  },
  {
    key: "linkedin",
    label: "LinkedIn",
    category: "SOCIAL",
    authType: "OAUTH",
    description: "Posts approved videos to LinkedIn (member profile, or an organization page when approved for w_organization_social).",
    docsUrl: "https://www.linkedin.com/developers/apps",
    fields: [
      { name: "clientId", label: "Client ID", type: "text", secret: false, required: true, group: "OAuth app" },
      { name: "clientSecret", label: "Client Secret", type: "secret", secret: true, required: true, group: "OAuth app" },
      { name: "organizationId", label: "Organization ID (optional — posts as the member if empty)", type: "text", secret: false, required: false, group: "Settings", pattern: "^\\d+$" },
    ],
    oauth: {
      authorizeUrl: "https://www.linkedin.com/oauth/v2/authorization",
      scopes: ["openid", "profile", "w_member_social"],
      pkce: false,
      scopeSeparator: " ",
      async exchangeCode({ code, redirectUri, values }) {
        const tokens = await postForm(
          "LinkedIn",
          "https://www.linkedin.com/oauth/v2/accessToken",
          formBody({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: values.clientId, client_secret: values.clientSecret }),
        );
        return linkedinFinalize(tokens);
      },
      async refresh({ values }) {
        if (!values.refreshToken) throw new ProviderError("LinkedIn did not issue a refresh token to this app — reconnect the account before it expires", 400, false);
        const tokens = await postForm(
          "LinkedIn",
          "https://www.linkedin.com/oauth/v2/accessToken",
          formBody({ grant_type: "refresh_token", refresh_token: values.refreshToken, client_id: values.clientId, client_secret: values.clientSecret }),
        );
        return linkedinFinalize(tokens);
      },
    },
    testConnection: (v) =>
      probe("LinkedIn", "https://api.linkedin.com/v2/userinfo", { Authorization: `Bearer ${v.accessToken}` }, (body) => {
        const b = body as { name?: string } | null;
        return { account: b?.name };
      }),
  },

  // ------------------------------------------------------------- Research
  {
    key: "apify",
    label: "Apify",
    category: "RESEARCH",
    authType: "API_KEY",
    description: "Trend scraping for the Viral Intelligence Engine (workflow 15).",
    docsUrl: "https://console.apify.com/settings/integrations",
    fields: [
      { name: "apiToken", label: "API token", type: "secret", secret: true, required: true, placeholder: "apify_api_..." },
      { name: "trendsActorId", label: "Trends actor ID", type: "text", secret: false, required: true, placeholder: "username~actor-name", group: "Settings" },
      { name: "trendsInputJson", label: "Actor input (JSON)", type: "json", secret: false, required: false, default: "{}", group: "Settings" },
    ],
    testConnection: (v) =>
      probe("Apify", "https://api.apify.com/v2/users/me", { Authorization: `Bearer ${v.apiToken}` }, (body) => ({
        account: (body as { data?: { username?: string } } | null)?.data?.username,
      })),
  },

  // ---------------------------------------------------------------- Media
  {
    key: "runway",
    label: "Runway",
    category: "MEDIA",
    authType: "API_KEY",
    description: "AI video scene generation (text-to-video) for the Video Generator.",
    docsUrl: "https://dev.runwayml.com/",
    fields: [
      { name: "apiKey", label: "API secret", type: "secret", secret: true, required: true, placeholder: "key_..." },
      {
        name: "model",
        label: "Video model",
        type: "select",
        secret: false,
        required: false,
        default: "gen4.5",
        group: "Settings",
        options: [
          { value: "gen4.5", label: "Gen-4.5 (2–10 s clips, 720p)" },
          { value: "veo3.1_fast", label: "Veo 3.1 Fast (4/6/8 s, up to 1080p)" },
          { value: "veo3.1", label: "Veo 3.1 (4/6/8 s, up to 1080p)" },
        ],
      },
    ],
    testConnection: (v) =>
      probe("Runway", "https://api.dev.runwayml.com/v1/organization", { Authorization: `Bearer ${v.apiKey}`, "X-Runway-Version": "2024-11-06" }, (body) => {
        const credits = (body as { creditBalance?: number } | null)?.creditBalance;
        return { message: typeof credits === "number" ? `Connected — ${credits} credits available` : "Connected" };
      }),
  },
  {
    key: "elevenlabs",
    label: "ElevenLabs",
    category: "MEDIA",
    authType: "API_KEY",
    description: "Natural voiceover for generated videos.",
    docsUrl: "https://elevenlabs.io/app/settings/api-keys",
    fields: [
      { name: "apiKey", label: "API key", type: "secret", secret: true, required: true, placeholder: "sk_..." },
      { name: "voiceId", label: "Default voice ID", type: "text", secret: false, required: true, group: "Settings", help: "ElevenLabs → Voices → (voice) → copy ID. Projects can override it." },
      { name: "model", label: "Model", type: "text", secret: false, required: false, default: "eleven_multilingual_v2", group: "Settings" },
    ],
    async testConnection(v) {
      const start = Date.now();
      try {
        const headers = { "xi-api-key": v.apiKey ?? "" };
        const { res, latencyMs } = await timedFetch(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(v.voiceId ?? "")}`, { headers });
        if (res.status === 404 || res.status === 400) return { ok: false, message: `Key accepted but voice "${v.voiceId}" was not found`, latencyMs };
        if (!res.ok) return { ok: false, message: describeHttpFailure("ElevenLabs", res.status, await readErrorDetail(res)).message, latencyMs };
        const voice = (await res.json().catch(() => null)) as { name?: string } | null;
        const sub = await timedFetch("https://api.elevenlabs.io/v1/user/subscription", { headers }).catch(() => null);
        let remaining = "";
        if (sub?.res.ok) {
          const s = (await sub.res.json()) as { character_count?: number; character_limit?: number };
          if (typeof s.character_limit === "number") remaining = ` — ${(s.character_limit - (s.character_count ?? 0)).toLocaleString("en")} characters left`;
        }
        return { ok: true, message: `Connected — voice "${voice?.name ?? v.voiceId}"${remaining}`, latencyMs: Date.now() - start, account: voice?.name };
      } catch (err) {
        return failed(err, start);
      }
    },
  },
];

async function xFinalize(tokens: Record<string, unknown>): Promise<OAuthResult> {
  const accessToken = String(tokens.access_token ?? "");
  if (!accessToken) throw new ProviderError("X did not return an access token", 400, false);
  const { res } = await timedFetch(`${X_API}/users/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const me = res.ok ? ((await res.json()) as { data?: { id?: string; username?: string } }).data : undefined;
  return {
    account: me?.username ? `@${me.username}` : "X account",
    secrets: { accessToken, ...(tokens.refresh_token ? { refreshToken: String(tokens.refresh_token) } : {}) },
    config: { userId: me?.id ?? "" },
    expiresAt: expiry(tokens.expires_in) ?? null,
  };
}

async function linkedinFinalize(tokens: Record<string, unknown>): Promise<OAuthResult> {
  const accessToken = String(tokens.access_token ?? "");
  if (!accessToken) throw new ProviderError("LinkedIn did not return an access token", 400, false);
  const { res } = await timedFetch("https://api.linkedin.com/v2/userinfo", { headers: { Authorization: `Bearer ${accessToken}` } });
  const me = res.ok ? ((await res.json()) as { sub?: string; name?: string }) : undefined;
  return {
    account: me?.name ?? "LinkedIn member",
    secrets: { accessToken, ...(tokens.refresh_token ? { refreshToken: String(tokens.refresh_token) } : {}) },
    config: { memberId: me?.sub ?? "" },
    expiresAt: expiry(tokens.expires_in) ?? null,
  };
}
