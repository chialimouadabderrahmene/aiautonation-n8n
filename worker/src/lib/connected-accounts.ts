import { prisma } from "./prisma";
import { decrypt } from "./crypto";

/** Which decrypted field name each provider's publish code expects for the primary token — mirrors api/src/modules/accounts/service.ts's TOKEN_FIELDS. */
const PRIMARY_FIELD: Record<string, string> = { x: "accessToken", meta: "pageAccessToken", linkedin: "accessToken" };

/**
 * Decrypts one specific ConnectedAccount's token (+ its `extra` config) into
 * the same flat shape `requireConnected()` returns from the legacy single
 * Integration connection, so publish.ts's per-platform code needs no
 * provider-specific branching to use either source.
 */
export async function getConnectedAccountCreds(id: string): Promise<Record<string, string>> {
  const row = await prisma.connectedAccount.findUniqueOrThrow({ where: { id } });
  if (row.status !== "CONNECTED") throw new Error(`Connected account "${row.label}" is not connected — reconnect it`);
  let token: string;
  try {
    token = decrypt({ ciphertext: row.tokenCiphertext, iv: row.tokenIv, authTag: row.tokenAuthTag });
  } catch {
    throw new Error(`Connected account "${row.label}" cannot be decrypted — AUTOMATION_SECRET_KEY on the worker must equal the API's`);
  }
  const field = PRIMARY_FIELD[row.provider] ?? "accessToken";
  return { [field]: token, ...(row.extra as Record<string, string>) };
}
