import pino from "pino";

/**
 * Structured logger with secret redaction. Any object key that commonly
 * carries a credential is replaced with "[REDACTED]" before it is written,
 * wherever it appears in the logged object (one or two levels deep).
 */
const SECRET_KEYS = [
  "apiKey", "apikey", "api_key", "accessToken", "access_token", "refreshToken", "refresh_token",
  "botToken", "password", "secret", "secrets", "clientSecret", "client_secret", "appSecret",
  "authorization", "Authorization", "cookie", "privateKey", "private_key", "serviceAccountJson",
  "pageAccessToken", "userAccessToken", "sharedSecret", "verifyToken", "token",
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "eki-automation-worker" },
  redact: {
    paths: [
      ...SECRET_KEYS,
      ...SECRET_KEYS.map((k) => `*.${k}`),
      ...SECRET_KEYS.map((k) => `*.*.${k}`),
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers[\"x-n8n-api-key\"]",
      "req.headers[\"x-internal-token\"]",
      "req.headers[\"x-telegram-bot-api-secret-token\"]",
    ],
    censor: "[REDACTED]",
  },
});
