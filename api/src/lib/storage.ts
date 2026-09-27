/**
 * Media storage. IDENTICAL copy in worker/src/lib/storage.ts (the two
 * services deploy separately) — tests/storage-parity checks they match.
 *
 * Drivers:
 *   s3    — any S3-compatible bucket (Railway Buckets, Cloudflare R2, AWS S3,
 *           MinIO). Private bucket; browsers get short-lived presigned URLs.
 *   local — a directory shared by api and worker (docker-compose volume).
 *           Signed URLs point at the API's /api/media/local route and are
 *           HMAC-signed with a key derived from AUTOMATION_SECRET_KEY.
 *   none  — not configured; the Dashboard shows Storage NOT CONFIGURED and
 *           the video pipeline is BLOCKED.
 *
 * Final assets always live here, never only on a container filesystem.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadBucketCommand, CreateBucketCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type StorageDriver = "s3" | "local" | "none";

export interface StorageCheck {
  ok: boolean;
  driver: StorageDriver;
  message: string;
}

export interface MediaStorage {
  readonly driver: StorageDriver;
  describe(): string;
  putFile(key: string, filePath: string, contentType: string): Promise<{ key: string; sizeBytes: number }>;
  putBuffer(key: string, data: Buffer, contentType: string): Promise<{ key: string; sizeBytes: number }>;
  downloadToFile(key: string, filePath: string): Promise<void>;
  signedUrl(key: string, expiresInSec?: number, downloadName?: string): Promise<string>;
  delete(key: string): Promise<void>;
  check(): Promise<StorageCheck>;
}

function resolveDriver(): StorageDriver {
  const explicit = process.env.STORAGE_DRIVER?.toLowerCase();
  if (explicit === "s3" || explicit === "local" || explicit === "none") return explicit;
  if (process.env.S3_BUCKET) return "s3";
  if (process.env.STORAGE_LOCAL_DIR) return "local";
  return "none";
}

function safeKey(key: string): string {
  const normalized = path.posix.normalize(key).replace(/^\/+/, "");
  if (normalized.startsWith("..") || normalized.includes("\0")) throw new Error("Invalid storage key");
  return normalized;
}

function s3Client(endpoint: string | undefined): S3Client {
  return new S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint: endpoint || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials:
      process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
        ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
        : undefined,
  });
}

class S3Storage implements MediaStorage {
  readonly driver = "s3" as const;
  private client: S3Client;
  /** Signs browser-facing URLs. Differs from `client` only when the services
   * reach the bucket on a private address (S3_ENDPOINT) that browsers and
   * platforms like Instagram cannot resolve — then S3_PUBLIC_ENDPOINT is set. */
  private publicClient: S3Client;
  private bucket: string;

  constructor() {
    this.bucket = process.env.S3_BUCKET ?? "";
    this.client = s3Client(process.env.S3_ENDPOINT);
    this.publicClient = process.env.S3_PUBLIC_ENDPOINT ? s3Client(process.env.S3_PUBLIC_ENDPOINT) : this.client;
  }

  describe() {
    return `S3 bucket "${this.bucket}"${process.env.S3_ENDPOINT ? ` at ${new URL(process.env.S3_ENDPOINT).host}` : ""}`;
  }

  async putFile(key: string, filePath: string, contentType: string) {
    const k = safeKey(key);
    const stat = await fsp.stat(filePath);
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: k, Body: fs.createReadStream(filePath), ContentLength: stat.size, ContentType: contentType }),
    );
    return { key: k, sizeBytes: stat.size };
  }

  async putBuffer(key: string, data: Buffer, contentType: string) {
    const k = safeKey(key);
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: k, Body: data, ContentLength: data.length, ContentType: contentType }));
    return { key: k, sizeBytes: data.length };
  }

  async downloadToFile(key: string, filePath: string) {
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }));
    if (!out.Body) throw new Error(`Storage object ${key} has no body`);
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await pipeline(out.Body as Readable, fs.createWriteStream(filePath));
  }

  async signedUrl(key: string, expiresInSec = 3600, downloadName?: string) {
    return getSignedUrl(
      this.publicClient,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: safeKey(key),
        ...(downloadName ? { ResponseContentDisposition: `attachment; filename="${downloadName.replace(/"/g, "")}"` } : {}),
      }),
      { expiresIn: expiresInSec },
    );
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }));
  }

  async check(): Promise<StorageCheck> {
    if (!this.bucket) return { ok: false, driver: this.driver, message: "S3_BUCKET is not set" };
    try {
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      } catch (err) {
        const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status !== 404) throw err;
        // Missing bucket: create it (no-op on providers where it already exists or creation is not allowed).
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      }
      const probeKey = `_healthcheck/${crypto.randomUUID()}.txt`;
      await this.putBuffer(probeKey, Buffer.from("ok"), "text/plain");
      await this.delete(probeKey);
      return { ok: true, driver: this.driver, message: `${this.describe()} — write/delete verified` };
    } catch (err) {
      const name = err instanceof Error ? err.name : "Error";
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, driver: this.driver, message: `${this.describe()} unreachable: ${name}: ${msg.slice(0, 200)}` };
    }
  }
}

function localSigningKey(): Buffer {
  const secret = process.env.AUTOMATION_SECRET_KEY ?? "";
  return crypto.createHash("sha256").update(`local-media-signing:${secret}`).digest();
}

export function signLocalKey(key: string, expiresAt: number): string {
  return crypto.createHmac("sha256", localSigningKey()).update(`${key}|${expiresAt}`).digest("base64url");
}

export function verifyLocalSignature(key: string, expiresAt: number, sig: string): boolean {
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now() / 1000) return false;
  const expected = Buffer.from(signLocalKey(key, expiresAt));
  const given = Buffer.from(sig);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

class LocalStorage implements MediaStorage {
  readonly driver = "local" as const;
  readonly root = path.resolve(process.env.STORAGE_LOCAL_DIR ?? "./storage");

  describe() {
    return `local volume ${this.root}`;
  }

  fullPath(key: string) {
    return path.join(this.root, safeKey(key));
  }

  async putFile(key: string, filePath: string) {
    const dest = this.fullPath(key);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(filePath, dest);
    return { key: safeKey(key), sizeBytes: (await fsp.stat(dest)).size };
  }

  async putBuffer(key: string, data: Buffer) {
    const dest = this.fullPath(key);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(dest, data);
    return { key: safeKey(key), sizeBytes: data.length };
  }

  async downloadToFile(key: string, filePath: string) {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.copyFile(this.fullPath(key), filePath);
  }

  async signedUrl(key: string, expiresInSec = 3600, downloadName?: string) {
    const k = safeKey(key);
    const exp = Math.floor(Date.now() / 1000) + expiresInSec;
    const base = (process.env.PUBLIC_WEB_URL ?? "").replace(/\/+$/, "");
    const q = new URLSearchParams({ key: k, exp: String(exp), sig: signLocalKey(k, exp), ...(downloadName ? { dl: downloadName } : {}) });
    return `${base}/api/media/local?${q.toString()}`;
  }

  async delete(key: string) {
    await fsp.rm(this.fullPath(key), { force: true });
  }

  async check(): Promise<StorageCheck> {
    try {
      const probe = `_healthcheck/${crypto.randomUUID()}.txt`;
      await this.putBuffer(probe, Buffer.from("ok"));
      await this.delete(probe);
      return { ok: true, driver: this.driver, message: `${this.describe()} — write/delete verified (shared volume; not suitable for Railway, use a bucket)` };
    } catch (err) {
      return { ok: false, driver: this.driver, message: `${this.describe()} not writable: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}

class NoStorage implements MediaStorage {
  readonly driver = "none" as const;
  describe() {
    return "not configured";
  }
  private fail(): never {
    throw new Error("Media storage is not configured (set S3_BUCKET and credentials on the api and worker services)");
  }
  async putFile(): Promise<never> {
    this.fail();
  }
  async putBuffer(): Promise<never> {
    this.fail();
  }
  async downloadToFile(): Promise<never> {
    this.fail();
  }
  async signedUrl(): Promise<never> {
    this.fail();
  }
  async delete(): Promise<never> {
    this.fail();
  }
  async check(): Promise<StorageCheck> {
    return { ok: false, driver: "none", message: "Media storage is not configured" };
  }
}

let instance: MediaStorage | null = null;

export function getStorage(): MediaStorage {
  if (!instance) {
    const driver = resolveDriver();
    instance = driver === "s3" ? new S3Storage() : driver === "local" ? new LocalStorage() : new NoStorage();
  }
  return instance;
}

export function localStoragePath(key: string): string | null {
  const s = getStorage();
  return s instanceof LocalStorage ? s.fullPath(key) : null;
}
