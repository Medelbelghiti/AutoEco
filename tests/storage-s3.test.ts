/**
 * Phase 2.1 — object storage.
 *
 * The S3 client is mocked at the module boundary (`@aws-sdk/client-s3`), so no
 * network call is ever made and no bucket is required. What is under test is
 * the adapter's own logic: which driver is selected, how keys are built and
 * validated, and that the right command is issued with the right arguments.
 *
 * The local driver is exercised against a real temp directory, because the
 * traversal guarantees only mean something against a real filesystem.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// --- capture every command the adapter issues -------------------------------
const sent: Array<{ name: string; input: Record<string, unknown> }> = [];
let bodyToReturn: Buffer = Buffer.from("");
/** Set false to simulate an S3 response with no Body member. */
let returnBody = true;

vi.mock("@aws-sdk/client-s3", () => {
  class FakeS3Client {
    constructor(public config: Record<string, unknown>) {}
    async send(cmd: { constructor: { name: string }; input: Record<string, unknown> }) {
      sent.push({ name: cmd.constructor.name, input: cmd.input });
      if (cmd.constructor.name === "GetObjectCommand") {
        if (!returnBody) return {};
        return { Body: { transformToByteArray: async () => bodyToReturn } };
      }
      return {};
    }
  }
  return {
    S3Client: FakeS3Client,
    PutObjectCommand: class PutObjectCommand {
      constructor(public input: Record<string, unknown>) {}
    },
    GetObjectCommand: class GetObjectCommand {
      constructor(public input: Record<string, unknown>) {}
    },
    DeleteObjectCommand: class DeleteObjectCommand {
      constructor(public input: Record<string, unknown>) {}
    },
  };
});

type Storage = typeof import("@/lib/storage");

const S3_ENV = {
  STORAGE_DRIVER: "s3",
  S3_ENDPOINT: "https://r2.example.cloudflarestorage.com",
  S3_REGION: "auto",
  S3_BUCKET: "autoeco-receipts",
  S3_ACCESS_KEY_ID: "test-access-key",
  S3_SECRET_ACCESS_KEY: "test-secret-key",
};

const STORAGE_ENV_KEYS = [
  "STORAGE_DRIVER",
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "VERCEL",
];

describe("Phase 2.1 — storage drivers", () => {
  let storage: Storage;
  let saved: Record<string, string | undefined> = {};
  let tmpDir = "";

  beforeEach(async () => {
    saved = {};
    for (const k of STORAGE_ENV_KEYS) saved[k] = process.env[k];
    for (const k of STORAGE_ENV_KEYS) delete process.env[k];

    sent.length = 0;
    bodyToReturn = Buffer.from("");
    returnBody = true;

    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "autoeco-storage-"));
    process.env.STORAGE_DIR = tmpDir;

    // A fresh module registry per test: env.ts snapshots process.env at import
    // time and the S3 client is cached.
    vi.resetModules();
    storage = await import("@/lib/storage");
  });

  afterEach(async () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  /** Re-import the adapter with a given environment. */
  async function loadWith(env: Record<string, string>): Promise<Storage> {
    for (const k of STORAGE_ENV_KEYS) delete process.env[k];
    process.env.STORAGE_DIR = tmpDir;
    for (const [k, v] of Object.entries(env)) process.env[k] = v;
    vi.resetModules();
    return import("@/lib/storage");
  }

  // --- driver selection ---------------------------------------------------

  it("11a. STORAGE_DRIVER=s3 selects the s3 driver", async () => {
    const s = await loadWith(S3_ENV);
    expect(s.storageDriver()).toBe("s3");
    expect(s.s3Configured()).toBe(true);
    expect(s.s3MissingConfig()).toEqual([]);
  });

  it("11b. s3 is inferred when a bucket and credentials are present", async () => {
    const s = await loadWith({
      S3_BUCKET: S3_ENV.S3_BUCKET,
      S3_ACCESS_KEY_ID: S3_ENV.S3_ACCESS_KEY_ID,
      S3_SECRET_ACCESS_KEY: S3_ENV.S3_SECRET_ACCESS_KEY,
    });
    expect(s.storageDriver()).toBe("s3");
  });

  it("11c. local is used when nothing is configured", async () => {
    const s = await loadWith({});
    expect(s.storageDriver()).toBe("local");
    expect(s.s3Configured()).toBe(false);
  });

  it("11d. STORAGE_DRIVER overrides inference in both directions", async () => {
    const forced = await loadWith({ ...S3_ENV, STORAGE_DRIVER: "local" });
    expect(forced.storageDriver()).toBe("local");
    // Force local even with a complete S3 config: no S3 command may be issued.
    await forced.saveFile("receipts/u1", "png", Buffer.from("x"));
    expect(sent).toHaveLength(0);
    expect(await fs.readdir(path.join(tmpDir, "receipts", "u1"))).toHaveLength(1);

    const forcedS3 = await loadWith({ S3_BUCKET: "b", STORAGE_DRIVER: "s3" });
    expect(forcedS3.storageDriver()).toBe("s3");
    expect(forcedS3.s3MissingConfig()).toEqual(["S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]);
  });

  it("11e. a driver value that is neither local nor s3 falls back to inference", async () => {
    const s = await loadWith({ ...S3_ENV, STORAGE_DRIVER: "nonsense" });
    expect(s.storageDriver()).toBe("s3");
  });

  // --- persistence --------------------------------------------------------

  it("12a. the s3 driver is always persistent, even on a serverless host", async () => {
    const s = await loadWith({ ...S3_ENV, VERCEL: "1" });
    expect(s.storageIsPersistent()).toBe(true);
  });

  it("12b. the local driver refuses uploads on a serverless host without STORAGE_DIR", async () => {
    const s = await loadWith({ VERCEL: "1" });
    delete process.env.STORAGE_DIR;
    expect(s.storageIsPersistent()).toBe(false);
  });

  it("12c. the local driver accepts uploads on a normal host", async () => {
    const s = await loadWith({});
    expect(s.storageIsPersistent()).toBe(true);
  });

  // --- s3 round trip ------------------------------------------------------

  it("13a. saveFile issues a PutObject with the bucket, key and body", async () => {
    const s = await loadWith(S3_ENV);
    const bytes = Buffer.from("hello world");

    const out = await s.saveFile("receipts/veh-1", "png", bytes, "image/png");

    expect(sent).toHaveLength(1);
    expect(sent[0].name).toBe("PutObjectCommand");
    expect(sent[0].input.Bucket).toBe("autoeco-receipts");
    const key = String(sent[0].input.Key);
    expect(key).toBe(out.storageKey);
    expect(key.startsWith("receipts/veh-1/")).toBe(true);
    expect(key.endsWith(".png")).toBe(true);
    expect(Buffer.from(sent[0].input.Body as Buffer)).toEqual(bytes);
    expect(sent[0].input.ContentType).toBe("image/png");
    expect(out.sizeBytes).toBe(bytes.length);
  });

  it("13b. ContentType comes from our allowlist, not an arbitrary string", async () => {
    const s = await loadWith(S3_ENV);
    // The route validates the type before saving; the adapter simply forwards
    // what it was given. Asserting the wiring here.
    await s.saveFile("receipts/u1", "pdf", Buffer.from("%PDF-1.7"), "application/pdf");
    expect(sent[0].input.ContentType).toBe("application/pdf");
  });

  it("13c. readFile issues a GetObject and returns the body bytes", async () => {
    const s = await loadWith(S3_ENV);
    bodyToReturn = Buffer.from("pdf-bytes-here");

    const buf = await s.readFile("receipts/veh-1/abc.pdf");

    expect(sent).toHaveLength(1);
    expect(sent[0].name).toBe("GetObjectCommand");
    expect(sent[0].input.Bucket).toBe("autoeco-receipts");
    expect(sent[0].input.Key).toBe("receipts/veh-1/abc.pdf");
    expect(buf.toString()).toBe("pdf-bytes-here");
  });

  it("13d. readFile fails loudly instead of returning an empty buffer when the body is missing", async () => {
    const s = await loadWith(S3_ENV);
    // A silently empty Buffer would be served as a corrupt document download.
    returnBody = false;
    await expect(s.readFile("receipts/x/y.bin")).rejects.toThrow(/no body/);
    expect(sent[0].name).toBe("GetObjectCommand");
  });

  it("13e. deleteFile issues a DeleteObject and does not touch the filesystem", async () => {
    const s = await loadWith(S3_ENV);
    await s.deleteFile("receipts/veh-1/abc.png");

    expect(sent).toHaveLength(1);
    expect(sent[0].name).toBe("DeleteObjectCommand");
    expect(sent[0].input).toMatchObject({ Bucket: "autoeco-receipts", Key: "receipts/veh-1/abc.png" });
    expect(await fs.readdir(tmpDir)).toEqual([]);
  });

  it("13f. missing S3 config fails before any command is attempted", async () => {
    const s = await loadWith({ STORAGE_DRIVER: "s3", S3_BUCKET: "b" });
    await expect(s.saveFile("receipts/u1", "png", Buffer.from("x"))).rejects.toThrow(
      /S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY/
    );
    expect(sent).toHaveLength(0);
  });

  // --- key safety ---------------------------------------------------------

  it("14a. buildKey strips characters outside a strict allowlist", async () => {
    const s = await loadWith(S3_ENV);
    await s.saveFile("receipts/../../etc", "pd f", Buffer.from("x"));
    const key = String(sent[0].input.Key);
    expect(key).not.toContain("..");
    expect(key).toMatch(/^receipts\/etc\/[A-Za-z0-9_-]+\.pdf$/);
  });

  it("14b. buildKey refuses a prefix that sanitises to nothing", async () => {
    const s = await loadWith(S3_ENV);
    await expect(s.saveFile("../..", "png", Buffer.from("x"))).rejects.toThrow(/prefix/);
    expect(sent).toHaveLength(0);
  });

  it("14c. two uploads of the same filename never collide", async () => {
    const s = await loadWith(S3_ENV);
    const a = await s.saveFile("receipts/u1", "png", Buffer.from("a"));
    const b = await s.saveFile("receipts/u1", "png", Buffer.from("b"));
    expect(a.storageKey).not.toBe(b.storageKey);
  });

  const hostileKeys = [
    "../../etc/passwd",
    "..\\..\\windows\\system32",
    "/absolute/path.png",
    "C:/windows/system32",
    "receipts/../../outside.png",
    "receipts/\0evil.png",
    "",
  ];

  it("14d. assertSafeKey rejects traversal, absolute paths, nul bytes and empty keys", async () => {
    const s = await loadWith(S3_ENV);
    for (const key of hostileKeys) {
      expect(() => s.assertSafeKey(key), `key should be rejected: ${key}`).toThrow();
    }
  });

  it("14e. assertSafeKey rejects an absurdly long key", async () => {
    const s = await loadWith(S3_ENV);
    expect(() => s.assertSafeKey(`${"a".repeat(400)}.png`)).toThrow(/Invalid storage key/);
  });

  it("14f. a hostile key never reaches the object store", async () => {
    const s = await loadWith(S3_ENV);
    await expect(s.readFile("../../etc/passwd")).rejects.toThrow(/Path traversal/);
    await expect(s.deleteFile("/absolute/path.png")).rejects.toThrow(/Invalid storage key/);
    expect(sent).toHaveLength(0);
  });

  it("14g. a hostile key cannot escape the local storage root", async () => {
    const s = await loadWith({});
    const outside = path.join(tmpDir, "..", "outside.png");
    await fs.writeFile(outside, "secret").catch(() => undefined);
    await expect(s.readFile("../outside.png")).rejects.toThrow(/Path traversal/);
    await expect(s.deleteFile("../outside.png")).rejects.toThrow(/Path traversal/);
  });

  // --- local driver, real filesystem --------------------------------------

  it("15a. the local driver round-trips a file", async () => {
    const s = await loadWith({});
    const bytes = Buffer.from("local bytes");

    const out = await s.saveFile("receipts/u-local", "pdf", bytes, "application/pdf");
    expect(out.storageKey).toMatch(/^receipts\/u-local\/[A-Za-z0-9_-]+\.pdf$/);
    expect(await fs.readFile(path.join(tmpDir, out.storageKey))).toEqual(bytes);
    expect((await s.readFile(out.storageKey)).toString()).toBe("local bytes");

    await s.deleteFile(out.storageKey);
    await expect(s.readFile(out.storageKey)).rejects.toThrow();
  });

  it("15b. the local driver writes nothing outside the storage root", async () => {
    const s = await loadWith({});
    const out = await s.saveFile("receipts/u-local", "png", Buffer.from("x"));
    const resolved = path.resolve(tmpDir, out.storageKey);
    expect(resolved.startsWith(path.resolve(tmpDir) + path.sep)).toBe(true);
    expect(out.storageKey).not.toContain("..");
  });

  it("15c. the local driver issues no S3 commands even when credentials exist", async () => {
    const s = await loadWith({
      S3_BUCKET: "b",
      S3_ACCESS_KEY_ID: "k",
      S3_SECRET_ACCESS_KEY: "s",
      STORAGE_DRIVER: "local",
    });
    await s.saveFile("receipts/u1", "png", Buffer.from("x"));
    await s.readFile("nonexistent.png").catch(() => undefined);
    expect(sent).toHaveLength(0);
  });

  // --- pre-existing guarantees must not regress ---------------------------

  it("16. bytesMatchMime still rejects a client-declared type it cannot confirm", async () => {
    const s = await loadWith({});
    expect(s.bytesMatchMime(Buffer.from([0xff, 0xd8, 0xff, 0x00]), "image/jpeg")).toBe(true);
    expect(s.bytesMatchMime(Buffer.from([0x89, 0x50, 0x4e, 0x47]), "image/jpeg")).toBe(false);
    expect(s.bytesMatchMime(Buffer.from("not a pdf at all"), "application/pdf")).toBe(false);
    expect(s.MAX_BYTES).toBe(10 * 1024 * 1024);
  });
});