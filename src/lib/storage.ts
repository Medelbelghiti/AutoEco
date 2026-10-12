/**
 * Upload storage.
 *
 * Two drivers behind one interface:
 *
 *   local — a directory on local disk. Fine for development. On serverless
 *           hosts the disk is ephemeral, so every redeploy silently loses
 *           every receipt while the database row still points at it.
 *   s3    — any S3-compatible object store (AWS S3, Cloudflare R2, MinIO).
 *           This is what production should use.
 *
 * The driver comes from STORAGE_DRIVER, or is inferred from whether a bucket
 * and credentials are configured.
 *
 * Every key that enters the module is validated before it is used, whichever
 * driver is active. A key is not a filesystem path, but validating it anyway
 * keeps the two drivers sharing one rule and means a poisoned `Document.storageKey`
 * can never be turned into an object outside the bucket, or a local path
 * outside the storage root.
 */
import { randomToken } from "./utils";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "./env";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

const STORAGE_DIR = process.env.STORAGE_DIR ?? path.join(process.cwd(), "uploads");

/** Object keys are bounded so a bad value cannot become an unbounded request. */
const MAX_KEY_LENGTH = 300;

export type StorageDriver = "local" | "s3";

/**
 * Which driver is in force.
 *
 * STORAGE_DRIVER wins when set, so an operator can force local even with S3
 * credentials present (useful to drain a migration). Otherwise a configured
 * bucket plus credentials selects s3.
 */
export function storageDriver(): StorageDriver {
  const forced = env.storageDriver.trim().toLowerCase();
  if (forced === "local" || forced === "s3") return forced;
  return s3Configured() ? "s3" : "local";
}

/** True when the S3 driver has everything it needs to talk to the store. */
export function s3Configured(): boolean {
  return Boolean(env.s3Bucket && env.s3AccessKeyId && env.s3SecretAccessKey);
}

/** Names of the S3 settings that are missing, for /api/health. Empty when usable. */
export function s3MissingConfig(): string[] {
  const missing: string[] = [];
  if (!env.s3Bucket) missing.push("S3_BUCKET");
  if (!env.s3AccessKeyId) missing.push("S3_ACCESS_KEY_ID");
  if (!env.s3SecretAccessKey) missing.push("S3_SECRET_ACCESS_KEY");
  return missing;
}

// --------------------------- key handling ------------------------------

/**
 * Validate a storage key that came from the database or a request.
 *
 * Applied on read and delete as well as write: a key is untrusted input
 * regardless of where it originated.
 */
export function assertSafeKey(storageKey: string): string {
  if (typeof storageKey !== "string" || storageKey.length === 0) {
    throw new Error("Invalid storage key");
  }
  if (storageKey.length > MAX_KEY_LENGTH) throw new Error("Invalid storage key");
  if (storageKey.includes("\0")) throw new Error("Invalid storage key");
  // Reject traversal rather than trying to normalise it away: a key that needs
  // cleaning is a key we did not write.
  if (storageKey.split(/[\\/]/).includes("..")) throw new Error("Path traversal detected");
  if (path.isAbsolute(storageKey) || storageKey.startsWith("/") || /^[A-Za-z]:/.test(storageKey)) {
    throw new Error("Invalid storage key");
  }
  // buildKey collapses these, so an empty segment means the key did not come
  // from us.
  if (storageKey.includes("//")) throw new Error("Invalid storage key");
  return storageKey;
}

/** Resolve a storage key to an absolute path inside STORAGE_DIR. */
function safeResolve(storageKey: string): string {
  assertSafeKey(storageKey);
  const resolved = path.resolve(STORAGE_DIR, storageKey);
  const root = path.resolve(STORAGE_DIR) + path.sep;
  if (!resolved.startsWith(root)) throw new Error("Path traversal detected");
  return resolved;
}

/**
 * Build a storage key from a caller-supplied prefix and extension.
 *
 * Both are sanitised to a strict character set and the random token means two
 * uploads of the same filename can never collide.
 */
export function buildKey(prefix: string, ext: string): string {
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").slice(0, 8) || "bin";
  // Strip anything outside the allowlist, then collapse the empty path segments
  // that stripping leaves behind: "receipts/../../etc" would otherwise become
  // "receipts///etc". A prefix that was nothing but traversal sanitises to an
  // empty string, which is rejected.
  const safePrefix = prefix
    .replace(/[^a-z0-9\-_/]/gi, "")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  if (!safePrefix) throw new Error("Invalid storage prefix");
  return assertSafeKey(`${safePrefix}/${randomToken(16)}.${safeExt}`);
}

// ------------------------------ s3 client ------------------------------

let cachedClient: S3Client | null = null;

/**
 * Built lazily and cached. `forcePathStyle` is required for R2 and MinIO,
 * which do not serve virtual-hosted-style bucket subdomains.
 */
function s3Client(): S3Client {
  if (cachedClient) return cachedClient;
  const missing = s3MissingConfig();
  if (missing.length > 0) {
    throw new Error(`Object storage is not configured: missing ${missing.join(", ")}`);
  }
  cachedClient = new S3Client({
    region: env.s3Region || "auto",
    endpoint: env.s3Endpoint || undefined,
    forcePathStyle: Boolean(env.s3Endpoint),
    credentials: {
      accessKeyId: env.s3AccessKeyId,
      secretAccessKey: env.s3SecretAccessKey,
    },
  });
  return cachedClient;
}

/** Drop the cached client. Used by tests that change the environment. */
export function resetStorageClient(): void {
  cachedClient = null;
}

// ------------------------------- the API -------------------------------

export async function saveFile(
  prefix: string,
  ext: string,
  bytes: Buffer,
  mime?: string
): Promise<{ storageKey: string; sizeBytes: number }> {
  const key = buildKey(prefix, ext);

  if (storageDriver() === "s3") {
    await s3Client().send(
      new PutObjectCommand({
        Bucket: env.s3Bucket,
        Key: key,
        Body: bytes,
        // ContentType is set from our own allowlist, never from the client's
        // declared type, so a download is served with a type we validated.
        ...(mime ? { ContentType: mime } : {}),
      })
    );
  } else {
    const fullPath = safeResolve(key);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, bytes);
  }

  return { storageKey: key, sizeBytes: bytes.length };
}

export async function readFile(storageKey: string): Promise<Buffer> {
  const key = assertSafeKey(storageKey);

  if (storageDriver() === "s3") {
    const res = await s3Client().send(
      new GetObjectCommand({ Bucket: env.s3Bucket, Key: key })
    );
    if (!res.Body) throw new Error("Object has no body");
    const bytes = await res.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  return fs.readFile(safeResolve(key));
}

export async function deleteFile(storageKey: string): Promise<void> {
  const key = assertSafeKey(storageKey);

  if (storageDriver() === "s3") {
    await s3Client().send(new DeleteObjectCommand({ Bucket: env.s3Bucket, Key: key }));
    return;
  }

  try {
    await fs.unlink(safeResolve(key));
  } catch {
    /* idempotent */
  }
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
 * Whether uploads written now will still be readable after a redeploy.
 *
 * Object storage is durable by construction. Local disk is not: on Vercel and
 * Lambda the filesystem is ephemeral, so `false` unless STORAGE_DIR points at a
 * mounted volume.
 */
export function storageIsPersistent(): boolean {
  if (storageDriver() === "s3") return true;
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