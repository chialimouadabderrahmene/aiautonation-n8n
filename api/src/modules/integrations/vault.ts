import crypto from "node:crypto";
import { IntegrationCategory, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { encrypt, decrypt, maskSecret } from "../../lib/crypto";
import { PROVIDERS, getProvider, publicProviderSchema } from "../providers/registry";
import { OAuthResult, TestResult } from "../providers/types";

/** Secret field names that are not user-entered but obtained via OAuth. */
export const OAUTH_TOKEN_FIELDS = ["accessToken", "refreshToken", "userAccessToken", "pageAccessToken"];

/** Ensures an Integration row exists for every provider in the registry and
 * that auto-generatable secrets (inbound webhook secret) exist. Idempotent. */
export async function ensureIntegrationRows(): Promise<void> {
  for (const p of PROVIDERS) {
    await prisma.integration.upsert({
      where: { provider: p.key },
      update: { category: p.category as IntegrationCategory, authType: p.authType },
      create: { provider: p.key, category: p.category as IntegrationCategory, authType: p.authType },
    });
  }
  // The inbound webhook secret has nothing external to wait for: generate it
  // on first boot so webhook workflows are never exposed without one.
  const webhooks = await prisma.integration.findUnique({ where: { provider: "webhooks" }, include: { credentials: true } });
  if (webhooks && !webhooks.credentials.some((c) => c.fieldName === "sharedSecret")) {
    await storeSecrets("webhooks", { sharedSecret: generateSecretValue() });
    await prisma.integration.update({ where: { provider: "webhooks" }, data: { status: "CONFIGURED" } });
  }
}

export function generateSecretValue(): string {
  return crypto.randomBytes(24).toString("base64url");
}

async function storeSecrets(provider: string, secrets: Record<string, string>): Promise<void> {
  const integration = await prisma.integration.findUniqueOrThrow({ where: { provider } });
  for (const [fieldName, value] of Object.entries(secrets)) {
    if (!value) continue;
    const enc = encrypt(value);
    await prisma.encryptedCredential.upsert({
      where: { integrationId_fieldName: { integrationId: integration.id, fieldName } },
      update: { ...enc, maskedPreview: maskSecret(value) },
      create: { integrationId: integration.id, fieldName, ...enc, maskedPreview: maskSecret(value) },
    });
  }
}

export interface SaveCredentialsInput {
  provider: string;
  /** Secret field values, plaintext, in memory only for the duration of this call. Blank = keep stored value. */
  secrets: Record<string, string>;
  /** Non-secret config values. Empty string removes a value. */
  config: Record<string, string>;
}

/**
 * Persists credentials for a provider. Each secret field is encrypted and
 * stored as its own row; non-secret config lives on Integration.config.
 * Status becomes CONFIGURED (never CONNECTED) until a real test passes.
 */
export async function saveCredentials(input: SaveCredentialsInput): Promise<void> {
  const def = getProvider(input.provider);
  if (!def) throw new Error(`Unknown provider: ${input.provider}`);
  const existing = await prisma.integration.findUniqueOrThrow({ where: { provider: input.provider } });

  const merged: Record<string, string> = { ...((existing.config as Record<string, string>) ?? {}) };
  for (const [k, v] of Object.entries(input.config)) {
    const value = v.trim();
    if (value) merged[k] = value;
    else delete merged[k];
  }
  const secrets = Object.fromEntries(Object.entries(input.secrets).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v));

  await prisma.integration.update({
    where: { provider: input.provider },
    data: { config: merged, status: "CONFIGURED", lastTestedAt: null, lastTestOk: null, lastTestMessage: null, lastTestLatencyMs: null },
  });
  await storeSecrets(input.provider, secrets);
}

/** Generates a new value for a generatable secret field and returns it ONCE
 * (the only time a plaintext secret leaves the API — the admin must copy it
 * into the external system that sends it, e.g. a website form or Meta). */
export async function rotateGeneratedSecret(provider: string, fieldName: string): Promise<string> {
  const def = getProvider(provider);
  const field = def?.fields.find((f) => f.name === fieldName);
  if (!def || !field?.generatable) throw new Error("Field is not generatable");
  const value = generateSecretValue();
  await storeSecrets(provider, { [fieldName]: value });
  await prisma.integration.update({ where: { provider }, data: { status: "CONFIGURED", lastTestOk: null, lastTestMessage: "Secret rotated — test again" } });
  return value;
}

export async function saveOAuthResult(provider: string, result: OAuthResult): Promise<void> {
  const existing = await prisma.integration.findUniqueOrThrow({ where: { provider } });
  const config = { ...((existing.config as Record<string, string>) ?? {}), ...(result.config ?? {}) };
  await storeSecrets(provider, result.secrets);
  await prisma.integration.update({
    where: { provider },
    data: {
      config,
      connectedAccount: result.account,
      connectedAt: existing.connectedAt && existing.connectedAccount === result.account ? existing.connectedAt : new Date(),
      tokenExpiresAt: result.expiresAt ?? null,
    },
  });
}

export class CredentialsUnreadableError extends Error {
  constructor(provider: string) {
    super(`Stored credentials for ${provider} cannot be decrypted (was AUTOMATION_SECRET_KEY changed?) — re-enter them in Integrations.`);
  }
}

/** Decrypts every stored secret field for a provider, plus its non-secret
 * config. Internal use only — never put the result in an API response. */
export async function getDecryptedCredentials(
  provider: string,
): Promise<{ secrets: Record<string, string>; config: Record<string, string> } | null> {
  const integration = await prisma.integration.findUnique({ where: { provider }, include: { credentials: true } });
  if (!integration) return null;
  const secrets: Record<string, string> = {};
  try {
    for (const cred of integration.credentials) {
      secrets[cred.fieldName] = decrypt({ ciphertext: cred.ciphertext, iv: cred.iv, authTag: cred.authTag });
    }
  } catch {
    throw new CredentialsUnreadableError(provider);
  }
  return { secrets, config: (integration.config as Record<string, string>) ?? {} };
}

/** Values as seen by testConnection/oauth: defaults < config < secrets. */
export async function getProviderValues(provider: string): Promise<Record<string, string> | null> {
  const def = getProvider(provider);
  const creds = await getDecryptedCredentials(provider);
  if (!def || !creds) return null;
  const defaults = Object.fromEntries(def.fields.filter((f) => f.default !== undefined).map((f) => [f.name, f.default as string]));
  return { ...defaults, ...creds.config, ...creds.secrets };
}

export async function recordTestResult(provider: string, result: TestResult): Promise<void> {
  await prisma.integration.update({
    where: { provider },
    data: {
      status: result.ok ? "CONNECTED" : "TEST_FAILED",
      lastTestedAt: new Date(),
      lastTestOk: result.ok,
      lastTestMessage: result.message.slice(0, 500),
      lastTestLatencyMs: result.latencyMs,
      ...(result.account && !getProvider(provider)?.oauth ? { connectedAccount: result.account } : {}),
    },
  });
}

export async function disconnectIntegration(provider: string): Promise<void> {
  const integration = await prisma.integration.findUnique({ where: { provider } });
  if (!integration) return;
  await prisma.encryptedCredential.deleteMany({ where: { integrationId: integration.id } });
  await prisma.integration.update({
    where: { provider },
    data: {
      status: "NOT_CONFIGURED",
      config: {},
      lastTestedAt: null,
      lastTestOk: null,
      lastTestMessage: null,
      lastTestLatencyMs: null,
      connectedAccount: null,
      connectedAt: null,
      tokenExpiresAt: null,
    },
  });
}

/** Removes only OAuth tokens (keeps the OAuth app's client id/secret). */
export async function disconnectOAuthAccount(provider: string): Promise<void> {
  const integration = await prisma.integration.findUniqueOrThrow({ where: { provider } });
  await prisma.encryptedCredential.deleteMany({ where: { integrationId: integration.id, fieldName: { in: OAUTH_TOKEN_FIELDS } } });
  await prisma.integration.update({
    where: { provider },
    data: { status: "CONFIGURED", connectedAccount: null, connectedAt: null, tokenExpiresAt: null, lastTestOk: null, lastTestMessage: "Account disconnected" },
  });
}

/** Safe, list-ready view: masked secrets only, never plaintext, never tokens. */
export async function listIntegrationsMasked() {
  const integrations = await prisma.integration.findMany({ include: { credentials: true } });
  const order = new Map(PROVIDERS.map((p, i) => [p.key, i]));
  return integrations
    .filter((i) => getProvider(i.provider))
    .sort((a, b) => (order.get(a.provider) ?? 99) - (order.get(b.provider) ?? 99))
    .map((integration) => {
      const def = getProvider(integration.provider)!;
      const schema = publicProviderSchema(def);
      const stored = new Set(integration.credentials.map((c) => c.fieldName));
      const hasOAuthTokens = OAUTH_TOKEN_FIELDS.some((f) => stored.has(f));
      const configured = def.fields.filter((f) => f.required).every((f) => (f.secret ? stored.has(f.name) : Boolean((integration.config as Record<string, string>)[f.name] ?? f.default)));
      return {
        ...schema,
        provider: integration.provider,
        status: integration.status,
        configured,
        oauthConnected: def.oauth ? hasOAuthTokens : undefined,
        connectedAccount: integration.connectedAccount,
        connectedAt: integration.connectedAt,
        tokenExpiresAt: integration.tokenExpiresAt,
        lastTestedAt: integration.lastTestedAt,
        lastTestOk: integration.lastTestOk,
        lastTestMessage: integration.lastTestMessage,
        lastTestLatencyMs: integration.lastTestLatencyMs,
        updatedAt: integration.updatedAt,
        n8nCredentialIds: integration.n8nCredentialIds,
        config: integration.config as Prisma.JsonObject,
        fields: schema.fields.map((f) => ({
          ...f,
          maskedPreview: f.secret ? integration.credentials.find((c) => c.fieldName === f.name)?.maskedPreview ?? null : null,
        })),
      };
    });
}

/** INFRA integrations whose only input is generated by the Control Center
 * itself (the inbound webhook secret) are verified automatically at boot —
 * the check is the same one the Test button runs, not an assumed success. */
export async function autoVerifyGeneratedIntegrations(): Promise<void> {
  for (const provider of ["webhooks"]) {
    const row = await prisma.integration.findUnique({ where: { provider } });
    if (!row || row.status === "CONNECTED") continue;
    const values = await getProviderValues(provider).catch(() => null);
    if (!values) continue;
    await recordTestResult(provider, await getProvider(provider)!.testConnection(values));
  }
}
