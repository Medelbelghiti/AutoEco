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

/**
 * Uploads are written to local disk. On serverless hosts (Vercel) that disk is
 * ephemeral: every redeploy / cold instance silently loses every receipt while
 * the database row still points at it. Refuse to accept uploads there unless
 * STORAGE_DIR points at a mounted persistent volume.
 */
export function storageIsPersistent(): boolean {
  const serverless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  if (!serverless) return true;
  return Boolean(process.env.STORAGE_DIR);
}

/** The client-declared MIME type is untrusted: confirm the leading bytes agree with it. */
export function bytesMatchMime(head: Buffer, mime: string): boolean {
  const startsWith = (sig: number[], off = 0) => sig.every((b, i) => head[off + i] === b);
  switch (mime) {
    case "image/jpeg": return startsWith([0xff, 0xd8, 0xff]);
    case "image/png": return startsWith([0x89, 0x50, 0x4e, 0x47]);
    case "application/pdf": return startsWith([0x25, 0x50, 0x44, 0x46]); // %PDF
    case "image/webp": return startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8);
    case "image/heic": return startsWith([0x66, 0x74, 0x79, 0x70], 4); // "ftyp"
    default: return false;
  }
}
