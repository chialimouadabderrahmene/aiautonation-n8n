import { prisma } from "../../lib/prisma";
import { timedFetch, readErrorDetail } from "../../lib/http";
import { saveCredentials, getDecryptedCredentials, recordTestResult, getProviderValues } from "../integrations/vault";
import { getProvider } from "../providers/registry";
import { n8nProcessHealthy } from "./client";
import { logger } from "../../lib/logger";

/**
 * Connects the Control Center to its n8n instance with zero manual steps.
 *
 * On a fresh deployment n8n has no owner account and no API key, and n8n
 * offers no environment variable to pre-seed either. This module performs,
 * over the private network, exactly what an admin would click through once:
 *   1. POST /rest/owner/setup  (only if n8n reports setup is still pending)
 *   2. POST /rest/login        (N8N_OWNER_EMAIL / N8N_OWNER_PASSWORD)
 *   3. POST /rest/api-keys     (all scopes the instance offers)
 * then stores the key encrypted and runs the normal n8n connection test.
 *
 * These /rest endpoints are n8n's internal UI API, not its public API; they
 * were verified against the pinned image (n8nio/n8n:2.40.7) — see
 * docs/N8N_SETUP.md. If they ever fail (e.g. the owner was created by hand
 * with a different password) n8n shows ACTION_REQUIRED with the reason and
 * an admin can paste an API key in Integrations → n8n instead.
 */

const BROWSER_ID = "eki-control-center";

export interface BootstrapOutcome {
  status: "already_connected" | "connected" | "not_configured" | "n8n_unreachable" | "failed";
  message: string;
}

function envConfig() {
  const internalUrl = process.env.N8N_INTERNAL_URL?.replace(/\/+$/, "");
  const publicUrl = process.env.N8N_PUBLIC_URL?.replace(/\/+$/, "");
  const email = process.env.N8N_OWNER_EMAIL;
  const password = process.env.N8N_OWNER_PASSWORD;
  return { internalUrl, publicUrl, email, password };
}

async function rest(base: string, path: string, init: RequestInit & { cookie?: string } = {}) {
  const { res } = await timedFetch(
    `${base}/rest${path}`,
    {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "browser-id": BROWSER_ID,
        ...(init.cookie ? { Cookie: init.cookie } : {}),
        ...init.headers,
      },
    },
    15_000,
  );
  return res;
}

export async function bootstrapN8n(): Promise<BootstrapOutcome> {
  const cfg = envConfig();

  // Already connected with a working key? Nothing to do.
  const existing = await prisma.integration.findUnique({ where: { provider: "n8n" } });
  const creds = await getDecryptedCredentials("n8n").catch(() => null);
  if (existing?.status === "CONNECTED" && creds?.secrets.apiKey) {
    return { status: "already_connected", message: "n8n already connected" };
  }
  if (creds?.secrets.apiKey && creds.config.baseUrl) {
    // A key exists (auto-created earlier or pasted by an admin): re-test it before minting another.
    const values = await getProviderValues("n8n");
    const result = await getProvider("n8n")!.testConnection(values ?? {});
    await recordTestResult("n8n", result);
    if (result.ok) return { status: "connected", message: result.message };
  }

  if (!cfg.internalUrl || !cfg.email || !cfg.password) {
    return { status: "not_configured", message: "N8N_INTERNAL_URL / N8N_OWNER_EMAIL / N8N_OWNER_PASSWORD are not set on the API service" };
  }
  if (!(await n8nProcessHealthy(cfg.internalUrl))) {
    return { status: "n8n_unreachable", message: `n8n is not answering at ${cfg.internalUrl} yet` };
  }

  try {
    const settingsRes = await rest(cfg.internalUrl, "/settings");
    const settings = (await settingsRes.json().catch(() => null)) as { data?: { userManagement?: { showSetupOnFirstLoad?: boolean } } } | null;
    if (settings?.data?.userManagement?.showSetupOnFirstLoad) {
      const setup = await rest(cfg.internalUrl, "/owner/setup", {
        method: "POST",
        body: JSON.stringify({ email: cfg.email, firstName: "Eki", lastName: "Control Center", password: cfg.password }),
      });
      if (!setup.ok) throw new Error(`owner setup failed (${setup.status}): ${(await readErrorDetail(setup)) ?? ""}`);
      logger.info({ email: cfg.email }, "[n8n] owner account created");
    }

    const login = await rest(cfg.internalUrl, "/login", {
      method: "POST",
      body: JSON.stringify({ emailOrLdapLoginId: cfg.email, password: cfg.password }),
    });
    if (!login.ok) {
      throw new Error(
        `login as ${cfg.email} failed (${login.status}) — the n8n owner was probably created with a different password. Paste an API key from n8n → Settings → n8n API into Integrations → n8n.`,
      );
    }
    const cookie = login.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");

    const scopesRes = await rest(cfg.internalUrl, "/api-keys/scopes", { cookie });
    const scopes = scopesRes.ok ? (((await scopesRes.json()) as { data?: string[] }).data ?? []) : [];
    const keyRes = await rest(cfg.internalUrl, "/api-keys", {
      method: "POST",
      cookie,
      body: JSON.stringify({ label: `eki-control-center-${new Date().toISOString().slice(0, 19)}`, expiresAt: null, scopes }),
    });
    if (!keyRes.ok) throw new Error(`API key creation failed (${keyRes.status}): ${(await readErrorDetail(keyRes)) ?? ""}`);
    const apiKey = ((await keyRes.json()) as { data?: { rawApiKey?: string } }).data?.rawApiKey;
    if (!apiKey) throw new Error("n8n did not return the new API key");

    await saveCredentials({
      provider: "n8n",
      secrets: { apiKey },
      config: { baseUrl: cfg.internalUrl, ...(cfg.publicUrl ? { publicUrl: cfg.publicUrl } : {}) },
    });
    const values = await getProviderValues("n8n");
    const result = await getProvider("n8n")!.testConnection(values ?? {});
    await recordTestResult("n8n", result);
    logger.info({ ok: result.ok }, "[n8n] API key provisioned and tested");
    return result.ok ? { status: "connected", message: result.message } : { status: "failed", message: result.message };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.integration.update({
      where: { provider: "n8n" },
      data: { status: "ACTION_REQUIRED", lastTestOk: false, lastTestMessage: `Automatic connection failed: ${message}`.slice(0, 500), lastTestedAt: new Date() },
    });
    return { status: "failed", message };
  }
}
