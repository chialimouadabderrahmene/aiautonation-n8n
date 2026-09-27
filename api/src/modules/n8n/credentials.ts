import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { getProviderValues, getDecryptedCredentials } from "../integrations/vault";
import { n8nClient } from "./client";
import { logger } from "../../lib/logger";

/**
 * The n8n credentials the 22 workflows reference, created and kept up to date
 * FROM the Control Center's vault through n8n's public API — nobody opens
 * n8n's credential screens. Each entry names the vault source, the n8n
 * credential type, and how to build its data.
 */
export interface ManagedCredential {
  /** Name used in n8n and in the workflow transformer. */
  name: string;
  type: string;
  /** Integration whose secrets feed it (and whose row stores the n8n id). */
  source: string;
  build: () => Promise<Record<string, unknown> | null>;
}

export const MANAGED_CREDENTIALS: ManagedCredential[] = [
  {
    name: "Eki Telegram Bot",
    type: "telegramApi",
    source: "telegram",
    build: async () => {
      const v = await getProviderValues("telegram").catch(() => null);
      return v?.botToken ? { accessToken: v.botToken, baseUrl: "https://api.telegram.org" } : null;
    },
  },
  {
    name: "Eki Google Sheets (Service Account)",
    type: "googleApi",
    source: "google-sheets",
    build: async () => {
      const v = await getProviderValues("google-sheets").catch(() => null);
      if (!v?.serviceAccountJson) return null;
      try {
        const key = JSON.parse(v.serviceAccountJson) as { client_email?: string; private_key?: string };
        if (!key.client_email || !key.private_key) return null;
        return { email: key.client_email, privateKey: key.private_key, inpersonate: false, httpNode: false };
      } catch {
        return null;
      }
    },
  },
  {
    name: "Eki Webhook Shared Secret",
    type: "httpHeaderAuth",
    source: "webhooks",
    build: async () => {
      const v = await getProviderValues("webhooks").catch(() => null);
      return v?.sharedSecret ? { name: "X-Eki-Webhook-Secret", value: v.sharedSecret } : null;
    },
  },
  {
    name: "Eki Telegram Webhook Secret",
    type: "httpHeaderAuth",
    source: "webhooks",
    build: async () => {
      const c = await getDecryptedCredentials("webhooks").catch(() => null);
      const secret = c?.secrets.telegramWebhookSecret;
      return secret ? { name: "X-Telegram-Bot-Api-Secret-Token", value: secret } : null;
    },
  },
  {
    // Workflow 10 posts to X with this header. The Control Center owns the
    // OAuth tokens and refreshes them (modules/oauth/refresher.ts), patching
    // this credential each time — n8n never needs its own OAuth dance.
    name: "Eki X Bearer",
    type: "httpHeaderAuth",
    source: "x",
    build: async () => {
      const v = await getProviderValues("x").catch(() => null);
      return v?.accessToken ? { name: "Authorization", value: `Bearer ${v.accessToken}` } : null;
    },
  },
];

type StoredIds = Record<string, { id: string; hash: string }>;

function hashData(data: Record<string, unknown>): string {
  return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex").slice(0, 16);
}

/**
 * Creates/updates every managed credential whose source is configured.
 * Returns name → n8n credential id for everything that exists in n8n.
 * Idempotent: unchanged data is not re-sent; a credential deleted by hand in
 * n8n is recreated; one with the right name but unknown id is adopted.
 */
export async function syncN8nCredentials(): Promise<Record<string, string>> {
  const existing = await n8nClient.listCredentials();
  const ids: Record<string, string> = {};

  for (const spec of MANAGED_CREDENTIALS) {
    const integration = await prisma.integration.findUnique({ where: { provider: spec.source } });
    if (!integration) continue;
    const stored = ((integration.n8nCredentialIds as StoredIds | null) ?? {}) as StoredIds;
    const data = await spec.build();
    const current = stored[spec.name];
    const live = existing.find((c) => (current && c.id === current.id) || (!current && c.name === spec.name && c.type === spec.type));

    if (!data) {
      if (live) ids[spec.name] = live.id; // keep references valid; readiness still blocks on the source
      continue;
    }
    const hash = hashData(data);
    let id: string;
    if (live) {
      id = live.id;
      if (!current || current.hash !== hash || current.id !== live.id) {
        await n8nClient.updateCredential(live.id, spec.name, spec.type, data);
        logger.info({ credential: spec.name }, "[n8n] credential updated");
      }
    } else {
      id = (await n8nClient.createCredential(spec.name, spec.type, data)).id;
      logger.info({ credential: spec.name }, "[n8n] credential created");
    }
    ids[spec.name] = id;
    stored[spec.name] = { id, hash };
    await prisma.integration.update({ where: { provider: spec.source }, data: { n8nCredentialIds: stored as unknown as Prisma.InputJsonValue } });
  }
  return ids;
}
