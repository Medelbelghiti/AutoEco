/**
 * POST /api/cron/trial-ending
 *
 * Sends the "your trial ends in N days" email and in-app notification.
 *
 * This job is what makes `tplTrialEnding` reachable — without a scheduler
 * the template exists but no trial is ever warned, so trial→paid conversion
 * depends entirely on the user remembering.
 *
 * Idempotency: no schema change is needed to guarantee we never double-send.
 * Each send writes an `AuditLog` row keyed by (userId, trialEndsAt); on the
 * next run those pairs are excluded. Re-running the job on the same day is a
 * no-op, and a user who starts a new trial gets a fresh key.
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyCronRequest } from "@/lib/cron";
import { getTrialSettings } from "@/lib/settings";
import { sendEmail, tplTrialEnding } from "@/lib/email";
import { createNotification } from "@/lib/notifications";
import { auditLog } from "@/lib/audit";
import { captureException } from "@/lib/error-capture";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/** How many days ahead of expiry we warn. One email per threshold. */
const THRESHOLDS_DAYS = [3, 1];

export async function POST(req: Request): Promise<NextResponse> {
  const denied = await verifyCronRequest(req);
  if (denied) return denied;

  const summary = { eligible: 0, emailed: 0, notified: 0, failed: 0, skipped: "trial_disabled" as string | number };

  const trial = await getTrialSettings();
  if (!trial.trial_enabled) {
    return NextResponse.json({ ok: true, ...summary, reason: "trials are disabled" });
  }
  summary.skipped = 0;

  const now = new Date();
  const horizon = new Date(now.getTime() + Math.max(...THRESHOLDS_DAYS) * 24 * 60 * 60 * 1000);

  const users = await db.user.findMany({
    where: {
      deletedAt: null,
      trialUsed: false,
      trialEndsAt: { gt: now, lte: horizon },
    },
    select: { id: true, name: true, email: true, trialEndsAt: true },
    take: 500,
  });
  summary.eligible = users.length;

  for (const user of users) {
    if (!user.trialEndsAt) continue;
    const daysLeft = Math.max(0, Math.ceil((user.trialEndsAt.getTime() - now.getTime()) / 86_400_000));
    const threshold = THRESHOLDS_DAYS.find((d) => daysLeft <= d);
    if (threshold === undefined) continue;

    // Dedup key: one notification per user per trial, per threshold.
    const key = `trial_ending:${user.id}:${user.trialEndsAt.toISOString()}:${threshold}`;
    const already = await db.auditLog.findFirst({ where: { action: key } });
    if (already) continue;

    try {
      await createNotification({
        userId: user.id,
        type: "TRIAL_ENDING",
        title: `Your trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
        body: "Upgrade to keep multi-vehicle tracking, forecasts and Ask Your Car.",
        link: "/settings/billing",
      });
      summary.notified++;

      const result = await sendEmail({
        ...tplTrialEnding(user.name, daysLeft, env.appUrl),
        to: user.email,
      });
      if (result.ok) summary.emailed++;

      await auditLog({ action: key, userId: user.id, metadata: { daysLeft, threshold } });
    } catch (e) {
      summary.failed++;
      // One bad row must not abort the whole batch.
      await captureException(e, { scope: "cron.trial-ending", userId: user.id });
    }
  }

  await auditLog({
    action: "cron.trial_ending_completed",
    metadata: summary as unknown as Record<string, unknown>,
  });

  return NextResponse.json({ ok: true, ...summary });
}