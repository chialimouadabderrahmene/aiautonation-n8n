/**
 * Credential encryption for the Control Center's own database.
 *
 * AES-256-GCM, key derived (scrypt) from AUTOMATION_SECRET_KEY — a secret
 * that must be generated once (`openssl rand -hex 32`), stored only as a
 * server-side environment variable, and never committed to git or logged.
 * Losing it makes every stored credential permanently unreadable (same
 * trade-off n8n itself makes with N8N_ENCRYPTION_KEY) — back it up.
 *
 * Plaintext leaves this module in exactly two places: `encrypt()` (input)
 * and `decrypt()` (output, called only by the code that is about to make the
 * real provider API call for a test-connection or a job). Nothing else in
 * this codebase should import `decrypt`.
 */
import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const SALT = "eki-automation-control-center-v1"; // fixed salt is fine: the key itself is a 32-byte random secret, this only derives a key of the right length from it.

function getKey(): Buffer {
  const secret = process.env.AUTOMATION_SECRET_KEY;
  if (!secret || secret.length < 32) {
    throw new Error(
      "AUTOMATION_SECRET_KEY is not set (or too short). Generate one with `openssl rand -hex 32` and set it as a server-side environment variable — never commit it.",
    );
  }
  return crypto.scryptSync(secret, SALT, 32);
}

export interface EncryptedValue {
  ciphertext: string;
  iv: string;
  authTag: string;
}

export function encrypt(plaintext: string): EncryptedValue {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decrypt(value: EncryptedValue): string {
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(value.iv, "base64"));
  decipher.setAuthTag(Buffer.from(value.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

/** Never return a raw secret from an API response — only this. */
export function maskSecret(plaintext: string): string {
  if (plaintext.length <= 8) return "••••••••";
  return `${plaintext.slice(0, 4)}••••••••${plaintext.slice(-4)}`;
}
