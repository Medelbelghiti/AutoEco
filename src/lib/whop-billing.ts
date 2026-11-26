/**
 * Shared billing state helpers for the Whop integration — server side only.
 *
 * A Founder Lifetime purchase is a normal `Subscription` row with status
 * `lifetime` on the `lifetime` Plan, so `getEntitlements()` and every quota
 * check work unchanged. The cap counts those rows (whatever provider created
 * them), so historic PayPal grants still count against it.
 */
import { db } from "./db";
import { lifetimeMaxGrants, whopPlanPurchasable, LIFETIME_PLAN_KEY } from "./whop";

export async function countLifetimeGrants(): Promise<number> {
  return db.subscription.count({ where: { status: "lifetime", plan: { key: LIFETIME_PLAN_KEY } } });
}

/**
 * The lifetime offer can be shown and sold right now: Whop is configured with a
 * lifetime plan id, a positive cap is set, and a slot is left.
 */
export async function lifetimeGrantAvailable(): Promise<boolean> {
  if (!whopPlanPurchasable(LIFETIME_PLAN_KEY)) return false;
  const cap = lifetimeMaxGrants();
  if (cap <= 0) return false;
  return (await countLifetimeGrants()) < cap;
}

export async function isLifetimeUser(userId: string): Promise<boolean> {
  return (await db.subscription.count({ where: { userId, status: "lifetime" } })) > 0;
}

/** Drop the user to the Free plan when none of their subscriptions grants access any more. */
export async function downgradeToFreeIfInactive(userId: string): Promise<void> {
  const stillActive = await db.subscription.count({
    where: { userId, status: { in: ["active", "trialing", "lifetime"] } },
  });
  if (stillActive > 0) return;
  const free = await db.plan.findFirst({ where: { key: "free" } });
  if (free) await db.user.update({ where: { id: userId }, data: { planId: free.id } });
}

/** The user's current recurring Whop membership that can still be canceled or resumed. */
export async function findActiveWhopSubscription(userId: string) {
  return db.subscription.findFirst({
    where: { userId, whopMembershipId: { not: null }, status: { in: ["active", "trialing", "past_due"] } },
    orderBy: { createdAt: "desc" },
  });
}
