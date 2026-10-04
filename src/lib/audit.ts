import { db } from "./db";

/** Minimum gap between two records sharing the same `throttleKey`. */
const THROTTLE_MS = 60 * 60 * 1000;

export async function auditLog(params: {
  userId?: string | null;
  action: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  /**
   * Optional de-duplication key. When two records share a key, the second is
   * dropped unless at least `THROTTLE_MS` has passed since the first.
   *
   * Use this for events emitted from a hot path — uptime probes, retries,
   * polling — where every occurrence is not worth a row. Distinct actions
   * (login attempts, billing changes, account deletion) must NOT be throttled.
   */
  throttleKey?: string;
}): Promise<void> {
  try {
    if (params.throttleKey) {
      const recent = await db.auditLog.findFirst({
        where: {
          action: params.action,
          metadata: { contains: params.throttleKey },
        },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      if (recent && Date.now() - recent.createdAt.getTime() < THROTTLE_MS) return;
    }

    await db.auditLog.create({
      data: {
        userId: params.userId ?? null,
        action: params.action,
        metadata: params.throttleKey
          ? JSON.stringify({ ...params.metadata, _key: params.throttleKey })
          : params.metadata
            ? JSON.stringify(params.metadata)
            : null,
        ip: params.ip,
      },
    });
  } catch {
    // Audit logging must never break the request path.
  }
}