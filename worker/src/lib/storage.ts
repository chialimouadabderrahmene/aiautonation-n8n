import fs from "node:fs/promises";
import path from "node:path";

/**
 * Minimal storage abstraction so swapping local disk for S3/R2 later is a
 * one-file change (see docs/VIDEO_PIPELINE.md "Storage"). No object-storage
 * credentials exist yet, so this ships as the local-disk implementation
 * only; `VideoAsset.url` stores whatever `save()` returns.
 */
export interface StorageProvider {
  save(relativePath: string, data: Buffer): Promise<string>;
}

class LocalStorageProvider implements StorageProvider {
  private readonly root: string;
  private readonly publicBaseUrl: string;

  constructor() {
    this.root = process.env.STORAGE_LOCAL_DIR ?? path.resolve(__dirname, "../../storage");
    this.publicBaseUrl = process.env.STORAGE_PUBLIC_BASE_URL ?? "";
  }

  async save(relativePath: string, data: Buffer): Promise<string> {
    const fullPath = path.join(this.root, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, data);
    return this.publicBaseUrl ? `${this.publicBaseUrl.replace(/\/+$/, "")}/${relativePath}` : fullPath;
  }
}

export const storage: StorageProvider = new LocalStorageProvider();
