import { prisma } from "./prisma";
import { decrypt } from "./crypto";

/** Read-only mirror of api's getDecryptedCredentials — the worker never
 * writes Integration rows, only reads them to make real provider calls. */
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
    secrets[cred.fieldName] = decrypt({ ciphertext: cred.ciphertext, iv: cred.iv, authTag: cred.authTag });
  }
  return { secrets, config: (integration.config as Record<string, string>) ?? {} };
}
