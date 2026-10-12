/**
 * Multi-account distribution: ConnectedAccount is the successor to
 * Integration's single OAuth slot per provider. v1 capture mechanism reuses
 * the EXISTING OAuth connect flow end to end (Integrations -> Connect
 * account) instead of a second OAuth implementation: once an admin has
 * connected an account there in the normal way, "capture" copies that
 * connection's live tokens into a new, separately listable ConnectedAccount
 * row, after which Integrations can be reconnected to a different
 * account/page for the next capture. A dedicated "pick an account from a
 * list" OAuth UI (Meta lets a user grant several Pages in one consent
 * screen) is a reasonable next step, not required for a first working
 * multi-account slice.
 */
import crypto from "node:crypto";
import { prisma } from "../../lib/prisma";
import { encrypt, decrypt, maskSecret } from "../../lib/crypto";
import { getProviderValues } from "../integrations/vault";
import { ProviderError } from "../../lib/http";

const TOKEN_FIELDS: Record<string, { primary: string; refresh?: string }> = {
  x: { primary: "accessToken", refresh: "refreshToken" },
  meta: { primary: "pageAccessToken" },
  linkedin: { primary: "accessToken" },
};

const EXTERNAL_ID: Record<string, (v: Record<string, string>, account: string | null) => string | null> = {
  x: (_v, account) => account, // X has no numeric id in the stored config; the handle is unique
  meta: (v) => v.pageId || null,
  linkedin: (v) => v.organizationId || v.memberId || null,
};

export class CaptureError extends ProviderError {}

/** Snapshots the CURRENT (just-connected) Integration tokens for `provider` into a new, named ConnectedAccount. */
export async function captureCurrentConnection(provider: string, label: string): Promise<{ id: string; label: string; externalAccountId: string }> {
  const fields = TOKEN_FIELDS[provider];
  if (!fields) throw new CaptureError(`${provider} does not support multiple connected accounts yet`, null, false);
  const integration = await prisma.integration.findUnique({ where: { provider } });
  if (!integration || integration.status !== "CONNECTED") throw new CaptureError(`Connect ${provider} in Integrations first (Connect account -> Test), then capture it here`, null, false);

  const values = await getProviderValues(provider);
  if (!values) throw new CaptureError(`${provider} has no stored connection`, null, false);
  const primary = values[fields.primary];
  if (!primary) throw new CaptureError(`${provider}'s connection is missing its ${fields.primary} — reconnect it in Integrations`, null, false);

  const externalAccountId = EXTERNAL_ID[provider]?.(values, integration.connectedAccount) ?? integration.connectedAccount ?? crypto.randomUUID();
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    if (k === fields.primary || k === fields.refresh || !v) continue;
    extra[k] = v;
  }
  const tokenEnc = encrypt(primary);
  const refreshValue = fields.refresh ? values[fields.refresh] : undefined;
  const refreshEnc = refreshValue ? encrypt(refreshValue) : null;

  const existingCount = await prisma.connectedAccount.count({ where: { provider } });
  const row = await prisma.connectedAccount.upsert({
    where: { provider_externalAccountId: { provider, externalAccountId } },
    update: {
      label,
      status: "CONNECTED",
      tokenCiphertext: tokenEnc.ciphertext,
      tokenIv: tokenEnc.iv,
      tokenAuthTag: tokenEnc.authTag,
      refreshTokenCiphertext: refreshEnc?.ciphertext ?? null,
      refreshTokenIv: refreshEnc?.iv ?? null,
      refreshTokenAuthTag: refreshEnc?.authTag ?? null,
      tokenExpiresAt: integration.tokenExpiresAt,
      extra,
    },
    create: {
      provider,
      label,
      externalAccountId,
      isDefault: existingCount === 0,
      tokenCiphertext: tokenEnc.ciphertext,
      tokenIv: tokenEnc.iv,
      tokenAuthTag: tokenEnc.authTag,
      refreshTokenCiphertext: refreshEnc?.ciphertext ?? null,
      refreshTokenIv: refreshEnc?.iv ?? null,
      refreshTokenAuthTag: refreshEnc?.authTag ?? null,
      tokenExpiresAt: integration.tokenExpiresAt,
      extra,
    },
  });
  return { id: row.id, label: row.label, externalAccountId: row.externalAccountId };
}

export async function listConnectedAccounts(provider?: string) {
  const rows = await prisma.connectedAccount.findMany({ where: provider ? { provider } : undefined, orderBy: [{ provider: "asc" }, { connectedAt: "asc" }] });
  // Never return token material — only enough to identify the row.
  return rows.map((r) => ({ id: r.id, provider: r.provider, label: r.label, externalAccountId: r.externalAccountId, isDefault: r.isDefault, status: r.status, connectedAt: r.connectedAt, maskedToken: maskSecret(decryptPreviewSafe(r)) }));
}

function decryptPreviewSafe(r: { tokenCiphertext: string; tokenIv: string; tokenAuthTag: string }): string {
  try {
    return decrypt({ ciphertext: r.tokenCiphertext, iv: r.tokenIv, authTag: r.tokenAuthTag });
  } catch {
    return "????????"; // AUTOMATION_SECRET_KEY mismatch — show a masked placeholder, never throw on a list call
  }
}

export async function renameConnectedAccount(id: string, label: string) {
  return prisma.connectedAccount.update({ where: { id }, data: { label } });
}

export async function deleteConnectedAccount(id: string) {
  await prisma.connectedAccount.delete({ where: { id } });
}

export async function setDefaultConnectedAccount(id: string) {
  const row = await prisma.connectedAccount.findUniqueOrThrow({ where: { id } });
  await prisma.$transaction([
    prisma.connectedAccount.updateMany({ where: { provider: row.provider, isDefault: true }, data: { isDefault: false } }),
    prisma.connectedAccount.update({ where: { id }, data: { isDefault: true } }),
  ]);
}
