import { randomToken } from "./utils";
import fs from "node:fs/promises";
import path from "node:path";

const STORAGE_DIR = process.env.STORAGE_DIR ?? path.join(process.cwd(), "uploads");

/** Resolve a storage key safely. Rejects any attempt at path traversal. */
function safeResolve(storageKey: string): string {
  // 1) Strip any ".." sequences
  let cleaned = storageKey.replace(/\.\.\//g, "").replace(/\.\.\\/g, "");
  // 2) Reject absolute paths
  if (path.isAbsolute(cleaned)) throw new Error("Invalid storage key");
  // 3) Resolve and ensure result is within STORAGE_DIR
  const resolved = path.resolve(STORAGE_DIR, cleaned);
  const root = path.resolve(STORAGE_DIR) + path.sep;
  if (!resolved.startsWith(root) && resolved !== path.resolve(STORAGE_DIR)) {
    throw new Error("Path traversal detected");
  }
  return resolved;
}

export async function ensureDir(dir: string): Promise<void> { await fs.mkdir(dir, { recursive: true }); }

export async function saveFile(prefix: string, ext: string, bytes: Buffer): Promise<{ storageKey: string; sizeBytes: number }> {
  await ensureDir(STORAGE_DIR);
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").slice(0, 8) || "bin";
  // Strict: keys only contain [a-z0-9-_/]
  const safePrefix = prefix.replace(/[^a-z0-9\-_/]/gi, "");
  const key = `${safePrefix}/${randomToken(16)}.${safeExt}`;
  const fullPath = path.join(STORAGE_DIR, key);
  await ensureDir(path.dirname(fullPath));
  await fs.writeFile(fullPath, bytes);
  return { storageKey: key, sizeBytes: bytes.length };
}

export async function readFile(storageKey: string): Promise<Buffer> {
  const fullPath = safeResolve(storageKey);
  return fs.readFile(fullPath);
}

export async function deleteFile(storageKey: string): Promise<void> {
  const fullPath = safeResolve(storageKey);
  try { await fs.unlink(fullPath); } catch { /* idempotent */ }
}

export const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf",
]);
export const MAX_BYTES = 10 * 1024 * 1024;

export function validateUpload(file: File): string | null {
  if (!ALLOWED_MIME_TYPES.has(file.type)) return `Unsupported file type: ${file.type || "unknown"}`;
  if (file.size > MAX_BYTES) return `File too large (max ${MAX_BYTES / 1024 / 1024} MB)`;
  if (file.size <= 0) return "Empty file";
  return null;
}
