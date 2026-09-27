import crypto from "node:crypto";
import { prisma } from "../../lib/prisma";
import { encrypt, decrypt } from "../../lib/crypto";
import { getProvider } from "../providers/registry";
import { getProviderValues, saveOAuthResult, recordTestResult } from "../integrations/vault";
import { logger } from "../../lib/logger";
import { safeErrorMessage } from "../../lib/http";

/**
 * Server-side OAuth 2.0 authorization-code flow (PKCE where the provider
 * supports it). The browser only ever sees the provider's consent page and a
 * redirect back to the Control Center; codes are exchanged and tokens stored
 * (encrypted) on the server. Access/refresh tokens are never sent to the
 * browser.
 */

const STATE_TTL_MS = 10 * 60 * 1000;

export function publicWebUrl(): string | null {
  const url = process.env.PUBLIC_WEB_URL?.replace(/\/+$/, "");
  return url || null;
}

export function oauthRedirectUri(provider: string): string | null {
  const base = publicWebUrl();
  return base ? `${base}/api/oauth/callback/${provider}` : null;
}

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export async function startOAuth(provider: string): Promise<{ authorizeUrl: string }> {
  const def = getProvider(provider);
  if (!def?.oauth) throw new Error("This provider does not use OAuth");
  const redirectUri = oauthRedirectUri(provider);
  if (!redirectUri) throw new Error("PUBLIC_WEB_URL is not set on the API service, so no OAuth redirect URL can be built");
  const values = await getProviderValues(provider);
  const clientIdField = def.fields.find((f) => f.name === "clientId" || f.name === "appId")!;
  const clientId = values?.[clientIdField.name];
  const secretField = def.fields.find((f) => f.secret && f.group === "OAuth app");
  if (!clientId || (secretField && !values?.[secretField.name])) {
    throw new Error(`Save the ${def.label} OAuth app credentials first (${clientIdField.label}${secretField ? ` and ${secretField.label}` : ""})`);
  }

  const state = base64url(crypto.randomBytes(24));
  let codeVerifier: string | undefined;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: def.oauth.scopes.join(def.oauth.scopeSeparator ?? " "),
    ...(def.oauth.extraAuthorizeParams ?? {}),
  });
  if (def.oauth.pkce) {
    codeVerifier = base64url(crypto.randomBytes(48));
    params.set("code_challenge", base64url(crypto.createHash("sha256").update(codeVerifier).digest()));
    params.set("code_challenge_method", "S256");
  }
  await prisma.oAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await prisma.oAuthState.create({
    data: {
      id: state,
      provider,
      codeVerifierEnc: codeVerifier ? JSON.stringify(encrypt(codeVerifier)) : null,
      expiresAt: new Date(Date.now() + STATE_TTL_MS),
    },
  });
  return { authorizeUrl: `${def.oauth.authorizeUrl}?${params.toString()}` };
}

export async function completeOAuth(provider: string, state: string, code: string): Promise<{ ok: boolean; message: string; account?: string }> {
  const def = getProvider(provider);
  if (!def?.oauth) return { ok: false, message: "Unknown OAuth provider" };
  const row = await prisma.oAuthState.findUnique({ where: { id: state } });
  // Single use: delete before doing anything else.
  if (row) await prisma.oAuthState.delete({ where: { id: state } }).catch(() => undefined);
  if (!row || row.provider !== provider || row.expiresAt < new Date()) {
    return { ok: false, message: "This connection link expired or was already used — click Connect account again" };
  }
  const redirectUri = oauthRedirectUri(provider)!;
  const values = (await getProviderValues(provider)) ?? {};
  const codeVerifier = row.codeVerifierEnc ? decrypt(JSON.parse(row.codeVerifierEnc)) : undefined;
  try {
    const result = await def.oauth.exchangeCode({ code, redirectUri, codeVerifier, values });
    await saveOAuthResult(provider, result);
    const test = await def.testConnection((await getProviderValues(provider)) ?? {});
    await recordTestResult(provider, test);
    return { ok: test.ok, message: test.ok ? `Connected ${result.account}` : `Account linked but test failed: ${test.message}`, account: result.account };
  } catch (err) {
    const message = safeErrorMessage(err);
    await prisma.integration.update({
      where: { provider },
      data: { status: "TEST_FAILED", lastTestOk: false, lastTestMessage: `OAuth connection failed: ${message}`.slice(0, 500), lastTestedAt: new Date() },
    });
    logger.warn({ provider, err: message }, "[oauth] code exchange failed");
    return { ok: false, message };
  }
}

/** Refreshes OAuth access tokens that expire within 15 minutes. Returns the
 * providers that were refreshed (so the caller can re-sync n8n credentials). */
export async function refreshExpiringTokens(): Promise<string[]> {
  const soon = new Date(Date.now() + 15 * 60 * 1000);
  const rows = await prisma.integration.findMany({ where: { authType: "OAUTH", tokenExpiresAt: { not: null, lt: soon } } });
  const refreshed: string[] = [];
  for (const row of rows) {
    const def = getProvider(row.provider);
    if (!def?.oauth?.refresh) continue;
    try {
      const values = (await getProviderValues(row.provider)) ?? {};
      if (!values.refreshToken) throw new Error("No refresh token stored — reconnect the account");
      const result = await def.oauth.refresh({ values });
      await saveOAuthResult(row.provider, result);
      refreshed.push(row.provider);
      logger.info({ provider: row.provider }, "[oauth] access token refreshed");
    } catch (err) {
      const message = safeErrorMessage(err);
      await prisma.integration.update({
        where: { provider: row.provider },
        data: { status: "ACTION_REQUIRED", lastTestOk: false, lastTestMessage: `Token refresh failed — reconnect the account: ${message}`.slice(0, 500), lastTestedAt: new Date() },
      });
      logger.warn({ provider: row.provider, err: message }, "[oauth] refresh failed");
    }
  }
  return refreshed;
}
