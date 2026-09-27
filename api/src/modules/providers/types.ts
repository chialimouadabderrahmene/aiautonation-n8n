/**
 * Provider configuration contract. Every integration the Control Center can
 * configure is described by ONE `ProviderDefinition` object — the UI renders
 * its form from `fields`, the API validates input against the same `fields`,
 * `testConnection` performs a real provider call, and (for OAuth providers)
 * `oauth` drives the server-side authorization flow. Adding a provider means
 * adding one definition to `definitions.ts`; no page or route hardcodes one.
 */

export type IntegrationCategory = "AI" | "ORCHESTRATION" | "MESSAGING" | "EMAIL" | "SOCIAL" | "RESEARCH" | "MEDIA";

/**
 * API_KEY  – admin pastes keys/IDs, clicks Test.
 * OAUTH    – admin enters the OAuth app's client id/secret once, then clicks
 *            "Connect account"; tokens are obtained and refreshed server-side.
 * INFRA    – provisioned automatically by the deployment (n8n, inbound
 *            webhook secrets); still testable, editable only as a fallback.
 */
export type AuthType = "API_KEY" | "OAUTH" | "INFRA";

export type FieldType = "secret" | "text" | "url" | "email" | "number" | "select" | "textarea" | "json";

export interface ProviderField {
  name: string;
  label: string;
  type: FieldType;
  /** Secret fields are encrypted at rest and never returned — only a masked preview. */
  secret: boolean;
  required: boolean;
  placeholder?: string;
  default?: string;
  help?: string;
  options?: { value: string; label: string }[];
  /** Regex (JS syntax) the value must match. */
  pattern?: string;
  patternMessage?: string;
  /** Group heading in the UI ("Credentials", "Settings", "WhatsApp templates", ...). */
  group?: string;
  /** Secret the Control Center can generate itself (webhook secrets). */
  generatable?: boolean;
}

export interface TestResult {
  ok: boolean;
  message: string;
  latencyMs: number;
  /** Non-secret identity of what we connected to (bot username, org name...). */
  account?: string;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scope?: string;
}

export interface OAuthResult {
  account: string;
  /** Secret token material to store encrypted (access/refresh/page tokens). */
  secrets: Record<string, string>;
  /** Non-secret values discovered during connect (user id, page id...). */
  config?: Record<string, string>;
  expiresAt?: Date | null;
}

export interface OAuthConfig {
  authorizeUrl: string;
  scopes: string[];
  pkce: boolean;
  /** Extra query params for the authorize URL. */
  extraAuthorizeParams?: Record<string, string>;
  /** Scope separator in the authorize URL (X and LinkedIn: space, Meta: comma). */
  scopeSeparator?: string;
  /** Exchange the authorization code for tokens and describe the account. */
  exchangeCode: (input: { code: string; redirectUri: string; codeVerifier?: string; values: Record<string, string> }) => Promise<OAuthResult>;
  /** Refresh an access token. Omit when the provider issues long-lived tokens. */
  refresh?: (input: { values: Record<string, string> }) => Promise<OAuthResult>;
}

export interface ProviderDefinition {
  key: string;
  label: string;
  category: IntegrationCategory;
  authType: AuthType;
  description: string;
  /** Where the admin gets the credentials (shown as a link in the UI). */
  docsUrl?: string;
  /** Known limitation worth surfacing in the UI (kept honest). */
  caveat?: string;
  fields: ProviderField[];
  oauth?: OAuthConfig;
  /** Real, read-only call to the provider. `values` = decrypted secrets + config. */
  testConnection: (values: Record<string, string>) => Promise<TestResult>;
}
