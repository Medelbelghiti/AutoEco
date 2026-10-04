import { db } from "./db";
import { sendEmail, tplUsageLimitReached } from "./email";
import { env } from "./env";

export type NotificationType =
  | "SEARCH_COMPLETE" | "USAGE_WARNING" | "USAGE_LIMIT" | "TRIAL_ENDING"
  | "PAYMENT_SUCCESS" | "PAYMENT_FAILED" | "SUBSCRIPTION_CANCELED"
  | "GENERAL" | "FORECAST_READY" | "ACHIEVEMENT";

export async function createNotification(params: {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
}): Promise<void> {
  await db.notification.create({
    data: { userId: params.userId, type: params.type, title: params.title, body: params.body, link: params.link },
  });
}

/** Human labels for the quota metrics tracked in `QuotaUsage`. */
const METRIC_LABELS: Record<string, string> = {
  ai_conversations: "AI questions",
  ocr_scans: "receipt scans",
  expenses: "expenses",
  vehicles: "vehicles",
};

/**
 * Tell the user they have consumed their entire allowance for this period.
 *
 * Called from `quota.tryConsume` the moment usage reaches the limit. That
 * makes it inherently once-per-period: the reservation is
 * `UPDATE ... WHERE used < limit`, so `used` can only ever equal the limit on
 * the single increment that arrives at it. No extra bookkeeping is needed to
 * avoid duplicate emails.
 *
 * Never throws: a failed notification must not turn a successful, already
 * billed API call into an error.
 */
export async function notifyQuotaLimitReached(params: {
  userId: string;
  metric: string;
  limit: number;
}): Promise<void> {
  try {
    const label = METRIC_LABELS[params.metric] ?? params.metric.replace(/_/g, " ");

    // In-app notification is the durable record; the email is best-effort.
    await createNotification({
      userId: params.userId,
      type: "USAGE_LIMIT",
      title: `You have used all your ${label} this period`,
      body: `Your allowance of ${params.limit} ${label} is now used up. Upgrade your plan to continue, or wait for the next billing period.`,
      link: "/settings/billing",
    });

    const user = await db.user.findUnique({
      where: { id: params.userId },
      select: { email: true, name: true, deletedAt: true },
    });

    // A deleted account still holds retained QuotaUsage rows; do not email it.
    if (!user || user.deletedAt) return;

    await sendEmail({
      ...tplUsageLimitReached(user.name, label, env.appUrl),
      to: user.email,
    });
  } catch {
    // Best-effort by design.
  }
}