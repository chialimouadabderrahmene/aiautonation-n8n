import { prisma } from "./prisma";
import { decrypt } from "./crypto";

/** Read-only mirror of api's vault — the worker never writes credentials,
 * it only decrypts them to make real provider calls. */
export async function getDecryptedCredentials(
  provider: string,
): Promise<{ secrets: Record<string, string>; config: Record<string, string>; status: string } | null> {
  const integration = await prisma.integration.findUnique({ where: { provider }, include: { credentials: true } });
  if (!integration) return null;
  const secrets: Record<string, string> = {};
  try {
    for (const cred of integration.credentials) {
      secrets[cred.fieldName] = decrypt({ ciphertext: cred.ciphertext, iv: cred.iv, authTag: cred.authTag });
    }
  } catch {
    throw new Error(`Stored ${provider} credentials cannot be decrypted — AUTOMATION_SECRET_KEY on the worker must equal the API's`);
  }
  return { secrets, config: (integration.config as Record<string, string>) ?? {}, status: integration.status };
}

/** Secrets + config for a provider that must be CONNECTED (tested) to be used. */
export async function requireConnected(provider: string, label: string): Promise<Record<string, string>> {
  const c = await getDecryptedCredentials(provider);
  if (!c || c.status !== "CONNECTED") throw new Error(`${label} is not connected — configure and test it in Integrations`);
  return { ...c.config, ...c.secrets };
}
