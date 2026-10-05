/**
 * Phase 2.5 - observability.
 *
 * The Sentry adapter talks to Sentry's documented envelope endpoint over
 * `fetch`, so `fetch` is stubbed here and no network call is ever made. What is
 * under test is the adapter's own logic: that it is completely inert without a
 * DSN, that the envelope it produces is well formed, and above all that no PII
 * can leave the process.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";

const SENTRY_KEYS = ["SENTRY_DSN", "SENTRY_ENVIRONMENT", "SENTRY_RELEASE"];
const DSN = "https://abc123def456@o1.ingest.sentry.io/1";

/** Every fetch the adapter attempts, with its request init. */
let calls: Array<{ url: string; init: RequestInit }> = [];
/** Set to make the sink fail, mimicking an unreachable or rejecting ingest. */
let fetchBehaviour: "ok" | "reject" | "hang" = "ok";

const realFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  fetchBehaviour = "ok";
  globalThis.fetch = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    if (fetchBehaviour === "reject") throw new TypeError("fetch failed");
    if (fetchBehaviour === "hang")
      await new Promise((_, reject) => setTimeout(() => reject(new Error("aborted")), 5000));
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

type Captured = typeof import("@/lib/error-capture");

/** A fresh module registry: env.ts snapshots process.env at import time. */
async function loadWith(env: Record<string, string>): Promise<Captured> {
  for (const k of SENTRY_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  vi.resetModules();
  return import("@/lib/error-capture");
}

/** Let the fire-and-forget sink settle before asserting on it. */
const flush = () => new Promise((r) => setTimeout(r, 25));

/**
 * The sink is fire-and-forget and sits behind a database write, so how long
 * it takes to appear is the database's business, not the test's.
 */
async function waitForSink(predicate: () => boolean = () => calls.length > 0): Promise<void> {
  for (let i = 0; i < 100 && !predicate(); i++) {
    await new Promise((r) => setTimeout(r, 20));
  }
}

function sentPayload(): Record<string, unknown> {
  const body = String(calls[0].init.body);
  const lines = body.split("\n");
  // envelope header, item header, payload
  return JSON.parse(lines[2]) as Record<string, unknown>;
}

function sentLines(): string[] {
  return sentLinesOf(calls[0]);
}

function sentLinesOf(call: { init: RequestInit }): string[] {
  return String(call.init.body).split("\n");
}

describe("Phase 2.5 - Sentry adapter", () => {
  // --- inert without configuration ----------------------------------------

  it("25a. with no SENTRY_DSN the adapter makes no network call at all", async () => {
    const cap = await loadWith({});
    expect(cap.parseDsn("")).toBeNull();

    await cap.captureException(new Error("db pool exhausted"), {
      scope: "TEST 25a",
      userId: "cm_1",
    });
    await flush();

    expect(calls).toHaveLength(0);
  });

  it("25b. with no SENTRY_DSN the error is still logged locally", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const cap = await loadWith({});

    await cap.captureException(new Error("pool exhausted"), { scope: "TEST 25b" });
    expect(spy.mock.calls.flat().join(" ")).toContain("pool exhausted");
    spy.mockRestore();
  });

  // --- DSN parsing ---------------------------------------------------------

  it("25c. parseDsn reads the key, host and project from a well formed DSN", async () => {
    const cap = await loadWith({});
    expect(cap.parseDsn(DSN)).toEqual({
      publicKey: "abc123def456",
      host: "o1.ingest.sentry.io",
      projectId: "1",
    });
  });

  it("25d. parseDsn rejects a malformed DSN instead of throwing", async () => {
    const cap = await loadWith({});
    for (const bad of ["", "not-a-url", "https://o1.ingest.sentry.io/", "https://o1.ingest.sentry.io"]) {
      expect(cap.parseDsn(bad)).toBeNull();
    }
  });

  // --- envelope format -----------------------------------------------------

  it("25e. an event is POSTed as a valid three part envelope", async () => {
    const cap = await loadWith({ SENTRY_DSN: DSN, SENTRY_RELEASE: "723320e" });

    await cap.captureException(new Error("boom"), { scope: "TEST 25e", userId: "cm_42" });
    await flush();

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://o1.ingest.sentry.io/api/1/envelope/");
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>)["x-sentry-auth"]).toContain(
      "sentry_key=abc123def456"
    );

    const [headerLine, itemLine, payloadLine] = sentLines();
    const header = JSON.parse(headerLine) as Record<string, unknown>;
    expect(header.event_id).toMatch(/^[0-9a-f]{32}$/);
    expect(header.dsn).toBe(DSN);
    expect(header.release).toBe("723320e");

    // The item header must declare the payload's real byte length, or Sentry
    // rejects the envelope.
    const item = JSON.parse(itemLine) as { type: string; content_type: string; length: number };
    expect(item.type).toBe("event");
    expect(item.content_type).toBe("application/json");
    expect(Buffer.byteLength(payloadLine, "utf8")).toBe(item.length);

    const payload = sentPayload();
    expect(payload.level).toBe("error");
    expect(payload.release).toBeUndefined();
    expect(payload.user).toEqual({ id: "cm_42" });
    expect(payload.transaction).toBe("TEST 25e");
    const values = (payload.exception as { values: Array<{ type: string; value: string }> }).values;
    expect(values[0].type).toBe("Error");
    expect(values[0].value).toBe("boom");
  });

  it("25f. a non-Error throw still produces a usable event", async () => {
    const cap = await loadWith({ SENTRY_DSN: DSN });

    await cap.captureException("just a string", { scope: "TEST 25f" });
    await flush();

    const payload = sentPayload();
    const values = (payload.exception as { values: Array<{ type: string; value: string }> }).values;
    expect(values[0].type).toBe("NonError");
    expect(values[0].value).toBe("just a string");
  });

  it("25g. a chained error keeps its cause", async () => {
    const cap = await loadWith({ SENTRY_DSN: DSN });

    await cap.captureException(new Error("outer", { cause: new Error("inner") }), {
      scope: "TEST 25g",
    });
    await flush();

    const values = (sentPayload().exception as { values: Array<Record<string, unknown>> }).values;
    expect(JSON.stringify(values[0])).toContain("inner");
  });

  // --- PII -----------------------------------------------------------------

  it("25h. email addresses in the message are scrubbed", async () => {
    const cap = await loadWith({ SENTRY_DSN: DSN });

    await cap.captureException(new Error("login failed for jean.dupont@example.com"), {
      scope: "TEST 25h",
    });
    await flush();

    const values = (sentPayload().exception as { values: Array<{ value: string }> }).values;
    expect(values[0].value).not.toContain("@");
    expect(values[0].value).toContain("[email]");
  });

  it("25i. secrets are dropped from extra, safe fields survive", async () => {
    const cap = await loadWith({ SENTRY_DSN: DSN });

    await cap.captureException(new Error("payment failed"), {
      scope: "TEST 25i",
      extra: {
        paddleCustomerId: "ctm_123",
        email: "victim@example.com",
        password: "hunter2",
        authorization: "Bearer sk_live_secret",
        sessionToken: "abc",
        apiKey: "sk_live_abc",
        cvv: "123",
        stripeSecret: "sk_live_xyz",
        amountMinor: 4900,
        durationMs: 812,
        isRetry: true,
      },
    });
    await flush();

    const extra = sentPayload().extra as Record<string, unknown>;
    expect(extra).toEqual({ amountMinor: 4900, durationMs: 812, isRetry: true });

    // And nothing anywhere in the envelope leaks it.
    const envelope = JSON.stringify(sentPayload());
    for (const secret of [
      "hunter2",
      "sk_live_secret",
      "sk_live_abc",
      "sk_live_xyz",
      "victim@example.com",
      "ctm_123",
      "123",
    ]) {
      expect(envelope).not.toContain(secret);
    }
  });

  it("25j. nested objects and arrays are dropped rather than flattened", async () => {
    const cap = await loadWith({ SENTRY_DSN: DSN });

    await cap.captureException(new Error("validation"), {
      scope: "TEST 25j",
      extra: {
        user: { email: "a@b.com", name: "Ada" },
        items: [{ sku: "x" }],
        count: 3,
      },
    });
    await flush();

    expect(sentPayload().extra).toEqual({ count: 3 });
  });

  it("25k. long strings are truncated so one error cannot flood the project", async () => {
    const cap = await loadWith({ SENTRY_DSN: DSN });

    await cap.captureException(new Error("A".repeat(5000)), { scope: "TEST 25k" });
    await flush();

    const values = (sentPayload().exception as { values: Array<{ value: string }> }).values;
    expect(values[0].value.length).toBeLessThanOrEqual(300);
  });

  it("25l. scrub keeps an explicit userId and drops an email address", async () => {
    const cap = await loadWith({});
    expect(cap.scrub({ userId: "cm_9", email: "a@b.com", password: "x", durationMs: 3 })).toEqual({
      userId: "cm_9",
      durationMs: 3,
    });
  });

  // --- resilience ----------------------------------------------------------

  it("25m. an unreachable Sentry does not break the caller", async () => {
    const cap = await loadWith({ SENTRY_DSN: DSN });
    fetchBehaviour = "reject";

    await expect(
      cap.captureException(new Error("still fine"), { scope: "TEST 25m" })
    ).resolves.toBeUndefined();
    await flush();
  });

  it("25n. a hanging Sentry is abandoned, and the abort is bounded", async () => {
    const cap = await loadWith({ SENTRY_DSN: DSN });
    fetchBehaviour = "hang";
    vi.useFakeTimers();

    // The request must carry an AbortSignal: the sink gives up rather than
    // holding a serverless invocation open.
    const p = cap.captureException(new Error("slow"), { scope: "TEST 25n" });
    await vi.advanceTimersByTimeAsync(3000);
    await p;
    await vi.advanceTimersByTimeAsync(10);

    expect(calls[0].init.signal).toBeDefined();
    vi.useRealTimers();
  });

  it("25o. process handlers install once, and a crash is still forwarded", async () => {
    const cap = await loadWith({ SENTRY_DSN: DSN });
    const before = process.listenerCount("unhandledRejection");
    cap.installProcessHandlers();
    cap.installProcessHandlers();
    expect(process.listenerCount("unhandledRejection")).toBe(before + 1);

    process.emit("unhandledRejection", new Error("stranded"), Promise.resolve());
    await waitForSink(() => calls.some((c) => c.init.body !== undefined && sentLinesOf(c).includes("process.unhandledRejection")));
    expect(calls).toHaveLength(1);

    process.removeAllListeners("unhandledRejection");
  });

  // --- the DB sink ---------------------------------------------------------

  it("25p. the error is persisted to AuditLog with the scrubbed context", async () => {
    const cap = await loadWith({});
    const before = await db.auditLog.count({
      where: { metadata: { contains: "TEST 25p" } },
    });

    await cap.captureException(new Error("stored", { cause: new Error("root cause") }), {
      scope: "TEST 25p",
      extra: { email: "someone@example.com", durationMs: 12 },
    });

    const row = await db.auditLog.findFirst({
      where: { metadata: { contains: "TEST 25p" } },
      orderBy: { createdAt: "desc" },
    });
    expect(row).toBeTruthy();
    expect(await db.auditLog.count({ where: { metadata: { contains: "TEST 25p" } } })).toBe(
      before + 1
    );

    const meta = JSON.parse(row!.metadata!) as Record<string, unknown>;
    expect(meta.name).toBe("Error");
    expect(meta.message).toBe("stored");
    expect(meta.cause).toContain("root cause");
    expect(meta.durationMs).toBe(12);
    expect(row!.metadata).not.toContain("someone@example.com");
    expect(row!.action).toBe("error.unhandled");
  });

  it("25q. a stale userId does not cost us the audit record", async () => {
    const cap = await loadWith({});

    // `AuditLog.userId` is a foreign key: an id that no longer exists would
    // otherwise fail the insert and silently drop the error.
    await cap.captureException(new Error("orphaned"), {
      scope: "TEST 25q",
      userId: "cm_does_not_exist_000000000",
    });

    const row = await db.auditLog.findFirst({
      where: { metadata: { contains: "TEST 25q" } },
      orderBy: { createdAt: "desc" },
    });
    expect(row).toBeTruthy();
    expect(row!.userId).toBeNull();
    const meta = JSON.parse(row!.metadata!) as Record<string, unknown>;
    expect(meta.message).toBe("orphaned");
    expect(meta.userIdDropped).toBe("cm_does_not_exist_000000000");
  });

  it("25r. a failing database sink does not reject the caller", async () => {
    const cap = await loadWith({});
    vi.resetModules();
    vi.doMock("@/lib/db", () => ({
      db: {
        auditLog: {
          create: async () => {
            throw new Error("database is on fire");
          },
          findFirst: async () => null,
        },
      },
    }));
    try {
      const broken = await import("@/lib/error-capture");
      await expect(
        broken.captureException(new Error("db gone"), { scope: "TEST 25r" })
      ).resolves.toBeUndefined();
    } finally {
      vi.doUnmock("@/lib/db");
      vi.resetModules();
    }
  });
});