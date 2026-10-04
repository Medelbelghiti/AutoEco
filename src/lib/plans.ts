import { db } from "./db";
import { getTrialSettings, getReferralSettings } from "./settings";
import { safeJsonParse } from "./utils";
import { currentMonthKey } from "./utils";
import type { Plan, User } from "@prisma/client";

export interface Entitlements {
  planKey: string;
  planName: string;
  billingPeriod: string;
  isTrial: boolean;
  isLifetime: boolean;
  trialEndsAt: Date | null;
  subscriptionStatus: string | null;
  currentPeriodEnd: Date | null;

  maxVehicles: number;
  maxExpensesPerMonth: number;
  aiReceiptScansPerMonth: number;
  aiConversationsPerMonth: number;
  reportRetentionDays: number;
  forecastHorizonMonths: number;
  enableAdvancedScenarios: boolean;
  enableShareableReports: boolean;
  enableFamilySharing: boolean;
  enableApiAccess: boolean;

  features: string[];
  periodKey: string;
}

export async function getFreePlan(): Promise<Plan | null> {
  return db.plan.findFirst({ where: { key: "free", active: true } });
}

/**
 * Grace period for a `past_due` subscription (failed renewal payment).
 * Paddle/Stripe will keep retrying; we keep access during dunning but not
 * indefinitely. Without a bound, a permanently failed card would grant paid
 * access forever.
 */
const PAST_DUE_GRACE_DAYS = 14;

export async function getEntitlements(user: User): Promise<Entitlements> {
  const now = new Date();

  const subscription = await db.subscription.findFirst({
    where: { userId: user.id, status: { in: ["active", "trialing", "past_due", "lifetime"] } },
    include: { plan: true },
    orderBy: { createdAt: "desc" },
  });

  if (subscription && subscription.status === "lifetime") {
    return planEntitlements(subscription.plan, {
      subscriptionStatus: "lifetime",
      currentPeriodEnd: null,
      trialEndsAt: null,
    });
  }

  if (subscription && (subscription.status === "active" || subscription.status === "trialing")) {
    const periodEnd = subscription.currentPeriodEnd;
    // `cancelAtPeriodEnd` does NOT extend access past `currentPeriodEnd` —
    // it means "the customer asked us to stop at the end of the period they
    // already paid for". Access therefore requires an unexpired period.
    // (The previous `|| cancelAtPeriodEnd === false` disjunct made this check
    // a no-op, so an expired subscription kept granting paid entitlements.)
    if (!periodEnd || periodEnd > now) {
      return planEntitlements(subscription.plan, {
        subscriptionStatus: subscription.status,
        currentPeriodEnd: periodEnd,
        trialEndsAt: null,
      });
    }
  }

  if (subscription && subscription.status === "past_due") {
    const periodEnd = subscription.currentPeriodEnd;
    const graceEnd = new Date(now.getTime() + PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000);
    if (!periodEnd || periodEnd > graceEnd) {
      return planEntitlements(subscription.plan, {
        subscriptionStatus: "past_due",
        currentPeriodEnd: periodEnd,
        trialEndsAt: null,
      });
    }
  }

  const trial = await getTrialSettings();
  if (trial.trial_enabled && !user.trialUsed && user.trialEndsAt && user.trialEndsAt > now) {
    const free = await getFreePlan();
    const base = free ?? (await db.plan.findFirst({ where: { key: "free" } }));
    if (base) {
      return {
        ...planEntitlements(base, {
          subscriptionStatus: "trialing",
          currentPeriodEnd: user.trialEndsAt,
          trialEndsAt: user.trialEndsAt,
        }),
        planKey: "trial",
        planName: "Free Trial",
        isTrial: true,
        maxVehicles: Math.max(base.maxVehicles, 2),
        maxExpensesPerMonth: Math.max(base.maxExpensesPerMonth, trial.trial_lead_limit ?? 200),
        forecastHorizonMonths: Math.max(base.forecastHorizonMonths, 24),
        aiReceiptScansPerMonth: 10,
        aiConversationsPerMonth: 25,
      };
    }
  }

  // Fallback. `User.planId` alone must NEVER grant paid entitlements: if a
  // subscription lapses, the webhook resets planId — but if it did not run
  // (delivery failure, manual DB edit, provider outage) the stale pointer
  // would silently keep paid limits alive. Only a genuinely free plan is
  // honoured here; anything paid falls back to the free plan.
  const fallback = user.planId
    ? await db.plan.findUnique({ where: { id: user.planId } })
    : await getFreePlan();
  const free = fallback && fallback.priceCents === 0 ? fallback : await getFreePlan();
  if (free) {
    return planEntitlements(free, {
      subscriptionStatus: "free",
      currentPeriodEnd: null,
      trialEndsAt: user.trialEndsAt,
    });
  }

  return {
    planKey: "free",
    planName: "Free",
    billingPeriod: "FREE",
    isTrial: false,
    isLifetime: false,
    trialEndsAt: null,
    subscriptionStatus: "free",
    currentPeriodEnd: null,
    maxVehicles: 1,
    maxExpensesPerMonth: 50,
    aiReceiptScansPerMonth: 0,
    aiConversationsPerMonth: 0,
    reportRetentionDays: 30,
    forecastHorizonMonths: 12,
    enableAdvancedScenarios: false,
    enableShareableReports: false,
    enableFamilySharing: false,
    enableApiAccess: false,
    features: ["1 vehicle", "Basic tracking"],
    periodKey: currentMonthKey(),
  };
}

function planEntitlements(
  plan: Plan,
  extra: { subscriptionStatus: string; currentPeriodEnd: Date | null; trialEndsAt: Date | null }
): Entitlements {
  return {
    planKey: plan.key,
    planName: plan.name,
    billingPeriod: plan.billingPeriod,
    isTrial: false,
    isLifetime: plan.billingPeriod === "LIFETIME",
    trialEndsAt: extra.trialEndsAt,
    subscriptionStatus: extra.subscriptionStatus,
    currentPeriodEnd: extra.currentPeriodEnd,
    maxVehicles: plan.maxVehicles,
    maxExpensesPerMonth: plan.maxExpensesPerMonth,
    aiReceiptScansPerMonth: plan.aiReceiptScansPerMonth,
    aiConversationsPerMonth: plan.aiConversationsPerMonth,
    reportRetentionDays: plan.reportRetentionDays,
    forecastHorizonMonths: plan.forecastHorizonMonths,
    enableAdvancedScenarios: plan.enableAdvancedScenarios,
    enableShareableReports: plan.enableShareableReports,
    enableFamilySharing: plan.enableFamilySharing,
    enableApiAccess: plan.enableApiAccess,
    features: safeJsonParse<string[]>(plan.features, []),
    periodKey: currentMonthKey(),
  };
}

export class LimitReachedError extends Error {
  limitType: "vehicles" | "expenses" | "aiScans" | "aiConversations" | "api";
  constructor(limitType: LimitReachedError["limitType"], message: string) {
    super(message);
    this.limitType = limitType;
  }
}

export const UPGRADE_MESSAGE =
  "You've reached your current plan limit. Upgrade your plan to continue.";

void getReferralSettings;
