import { prisma } from "../../lib/prisma";
import { encrypt, decrypt, maskSecret } from "../../lib/crypto";
import { getProvider } from "../providers/registry";
import { IntegrationCategory } from "@prisma/client";

/** Ensures an Integration row exists for every provider in the registry. */
export async function ensureIntegrationRows(): Promise<void> {
  const { PROVIDERS } = await import("../providers/registry");
  for (const p of PROVIDERS) {
    await prisma.integration.upsert({
      where: { provider: p.key },
      update: {},
      create: { provider: p.key, category: p.category as IntegrationCategory },
    });
  }
}

export interface SaveCredentialsInput {
  provider: string;
  /** Secret field values, plaintext, in memory only for the duration of this call. */
  secrets: Record<string, string>;
  /** Non-secret config values (model name, defaults, ...). */
  config: Record<string, string>;
}

/**
 * Persists credentials for a provider. Each secret field is encrypted and
 * stored as its own row; non-secret config lives on Integration.config.
 * Status resets to CONFIGURED (not CONNECTED) until a test actually passes —
 * saving is never treated as evidence of working credentials.
 */
export async function saveCredentials(input: SaveCredentialsInput): Promise<void> {
  const def = getProvider(input.provider);
  if (!def) throw new Error(`Unknown provider: ${input.provider}`);

  const integration = await prisma.integration.upsert({
    where: { provider: input.provider },
    update: { config: input.config, status: "CONFIGURED", lastTestedAt: null, lastTestOk: null, lastTestMessage: null },
    create: { provider: input.provider, category: def.category as IntegrationCategory, config: input.config, status: "CONFIGURED" },
  });

  for (const field of def.fields.filter((f) => f.secret)) {
    const value = input.secrets[field.name];
    if (!value) continue; // allow partial update: blank = keep existing
    const enc = encrypt(value);
    await prisma.encryptedCredential.upsert({
      where: { integrationId_fieldName: { integrationId: integration.id, fieldName: field.name } },
      update: { ...enc, maskedPreview: maskSecret(value) },
      create: { integrationId: integration.id, fieldName: field.name, ...enc, maskedPreview: maskSecret(value) },
    });
  }
}

/** Decrypts every stored secret field for a provider, plus its non-secret config. Internal use only — never expose the return value of this function directly in an API response. */
export async function getDecryptedCredentials(
  provider: string,
): Promise<{ secrets: Record<string, string>; config: Record<string, string> } | null> {
  const integration = await prisma.integration.findUnique({
    where: { provider },
    include: { credentials: true },
  });
  if (!integration) return null;

  const secrets: Record<string, string> = {};
  for (const cred of integration.credentials) {
    secrets[cred.fieldName] = decrypt({
      ciphertext: cred.ciphertext,
      iv: cred.iv,
      authTag: cred.authTag,
    });
  }
  return { secrets, config: (integration.config as Record<string, string>) ?? {} };
}

export async function disconnectIntegration(provider: string): Promise<void> {
  const integration = await prisma.integration.findUnique({ where: { provider } });
  if (!integration) return;
  await prisma.encryptedCredential.deleteMany({ where: { integrationId: integration.id } });
  await prisma.integration.update({
    where: { provider },
    data: { status: "NOT_CONFIGURED", config: {}, lastTestedAt: null, lastTestOk: null, lastTestMessage: null },
  });
}

/** Safe, list-ready view: masked secrets only, never plaintext. */
export async function listIntegrationsMasked() {
  const integrations = await prisma.integration.findMany({ include: { credentials: true } });
  return integrations.map((integration) => {
    const def = getProvider(integration.provider);
    return {
      provider: integration.provider,
      label: def?.label ?? integration.provider,
      category: integration.category,
      description: def?.description,
      caveat: def?.caveat,
      status: integration.status,
      lastTestedAt: integration.lastTestedAt,
      lastTestOk: integration.lastTestOk,
      lastTestMessage: integration.lastTestMessage,
      lastTestLatencyMs: integration.lastTestLatencyMs,
      config: integration.config,
      fields: (def?.fields ?? []).map((f) => ({
        name: f.name,
        label: f.label,
        secret: f.secret,
        required: f.required,
        default: f.default,
        maskedPreview: f.secret
          ? integration.credentials.find((c) => c.fieldName === f.name)?.maskedPreview ?? null
          : null,
      })),
    };
  });
}
