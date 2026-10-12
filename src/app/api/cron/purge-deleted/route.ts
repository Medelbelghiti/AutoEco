/**
 * POST /api/cron/purge-deleted
 *
 * Completes the "right to erasure" that account deletion starts.
 *
 * `DELETE /api/auth/account` performs the erasure immediately: name and
 * email are overwritten, API keys are revoked, and the row is flagged
 * `deletedAt`. What it deliberately does NOT do is drop the financial
 * history — invoices are accounting records we are required to retain, and
 * the tombstones keep referential integrity for support/audit purposes.
 *
 * This job handles the residue that is personal data with no legal
 * retention reason to keep it:
 *   - uploaded receipt files on disk and their Document rows
 *   - sessions / verification tokens
 *   - in-app notifications and Ask-Your-Car conversation history
 *   - API keys, share links and saved reports
 *   - expenses, fuel entries, scenarios, forecasts and vehicles
 *
 * It then completes the de-identification by dropping every link back to a
 * real person or to a payment processor.
 *
 * It deliberately does NOT hard-delete the User row. `Invoice` and
 * `Subscription` are both `onDelete: Cascade` from `User` in the schema, so
 * `db.user.delete()` would cascade away the very accounting records that tax
 * and consumer law require us to keep. The retained row is already anonymous:
 * `name`/`email` were overwritten at deletion time, `passwordHash` and
 * `emailVerifyToken` are cleared, and this job nulls the processor customer
 * ids. Keeping an opaque tombstone preserves both the legal retention duty
 * and the foreign keys that make the retained invoices meaningful.
 *
 * Retention window: PURGE_AFTER_DAYS (default 30). Nothing is touched before
 * that, so a mistaken deletion is recoverable by support in the meantime.
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { deleteFile } from "@/lib/storage";
import { verifyCronRequest } from "@/lib/cron";
import { auditLog } from "@/lib/audit";
import { captureException } from "@/lib/error-capture";
import { hashPassword } from "@/lib/auth";
import { randomBytes } from "node:crypto";

export const dynamic = "force-dynamic";

const DEFAULT_RETENTION_DAYS = 30;

function retentionDays(): number {
  const raw = Number(process.env.PURGE_AFTER_DAYS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RETENTION_DAYS;
}

export async function POST(req: Request): Promise<NextResponse> {
  const denied = await verifyCronRequest(req);
  if (denied) return denied;

  const days = retentionDays();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const summary = {
    days,
    cutoff: cutoff.toISOString(),
    candidates: 0,
    scrubbed: 0,
    /** Anonymous tombstones kept on purpose to hold the retained invoices. */
    retained: 0,
    filesRemoved: 0,
    fileErrors: 0,
    failed: 0,
  };

  const candidates = await db.user.findMany({
    where: { deletedAt: { not: null, lte: cutoff } },
    select: { id: true, deletedAt: true },
    take: 200,
    orderBy: { deletedAt: "asc" },
  });
  summary.candidates = candidates.length;

  for (const user of candidates) {
    try {
      // --- Delete uploaded receipt files first: once the rows are gone the
      // --- paths are unrecoverable, so this must happen before the DB write.
      const docs = await db.document.findMany({
        where: { userId: user.id },
        select: { id: true, storageKey: true },
      });
      for (const doc of docs) {
        if (!doc.storageKey) continue;
        try {
          // The storage adapter validates the key and resolves it inside the
          // storage root, so this works for both the local and the S3 driver
          // and does not repeat the traversal check here.
          await deleteFile(doc.storageKey);
          summary.filesRemoved++;
        } catch (e) {
          // The Document row is deleted further down regardless, so the DB is
          // consistent — but the orphaned object would linger. Surface it.
          summary.fileErrors++;
          await auditLog({
            action: "cron.purge_file_failed",
            metadata: { documentId: doc.id, error: e instanceof Error ? e.message.slice(0, 200) : "unknown" },
          });
        }
      }

      // --- Purge personal data with no statutory retention requirement.
      await db.$transaction([
        db.document.deleteMany({ where: { userId: user.id } }),
        db.notification.deleteMany({ where: { userId: user.id } }),
        db.conversation.deleteMany({ where: { userId: user.id } }),
        db.verificationToken.deleteMany({ where: { userId: user.id } }),
        db.apiKey.deleteMany({ where: { userId: user.id } }),
        db.shareLink.deleteMany({ where: { userId: user.id } }),
        db.report.deleteMany({ where: { userId: user.id } }),
        db.achievement.deleteMany({ where: { userId: user.id } }),
        db.savingsGoal.deleteMany({ where: { userId: user.id } }),
        // Personal financial history the user asked us to forget.
        db.expense.deleteMany({ where: { userId: user.id } }),
        db.fuelEntry.deleteMany({ where: { userId: user.id } }),
        db.scenario.deleteMany({ where: { userId: user.id } }),
        db.forecast.deleteMany({ where: { userId: user.id } }),
        db.vehicle.deleteMany({ where: { userId: user.id } }),
        // Analytics events are keyed by userId but not FK-bound; clear them too.
        db.analyticsEvent.deleteMany({ where: { userId: user.id } }),
        // Strip the remaining free-text PII from audit rows.
        db.auditLog.updateMany({
          where: { userId: user.id },
          data: { userId: null, metadata: JSON.stringify({ purged: true }) },
        }),
      ]);
      summary.scrubbed++;

      // --- Break every remaining link back to a natural person or to a
      // --- payment processor. The row itself is RETAINED, not deleted:
      // --- `db.user.delete()` would cascade to Invoice and Subscription
      // --- (schema: `onDelete: Cascade`), destroying the accounting records
      // --- we are legally required to retain. See the note at the top.
      await db.user.update({
        where: { id: user.id },
        data: {
          paddleCustomerId: null,
          stripeCustomerId: null,
          // The deletion route already blanked these; enforce it here so a
          // partially-failed earlier run is repaired on the next pass.
          name: null,
          email: `deleted-${user.id}@deleted.invalid`,
          passwordHash: await hashPassword(randomBytes(32).toString("hex")),
        },
      });
      summary.retained++;

      await auditLog({
        action: "cron.purged_deleted_user",
        metadata: {
          // The tombstone id itself is not personal data any more, but it is
          // also useless to a third party: keep it only as a support handle.
          tombstoneId: user.id,
          deletedAt: user.deletedAt?.toISOString() ?? null,
        },
      });
    } catch (e) {
      summary.failed++;
      await captureException(e, { scope: "cron.purge-deleted", userId: user.id });
    }
  }

  await auditLog({ action: "cron.purge_completed", metadata: summary as unknown as Record<string, unknown> });

  return NextResponse.json({
    ok: summary.failed === 0 && summary.fileErrors === 0,
    ...summary,
  });
}