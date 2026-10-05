/**
 * Provider-neutral coupon rules.
 *
 * Moved out of `stripe.ts` before that module was deleted. Everything here is
 * database-only: expiry, global and per-user limits, plan restrictions, first
 * purchase only, minimum purchase.
 *
 * What this module deliberately does NOT do any more: mirror coupons into the
 * billing provider. There are no Stripe subscribers, and Paddle applies a
 * discount through its own API at checkout, so creating a "provider coupon" as
 * a side effect of validation was both a Stripe dependency and a write on a
 * read path.
 *
 * Not yet wired into checkout: the Paddle overlay owns discount entry, so these
 * rules are not enforced at purchase time yet. Callers must keep treating a
 * `valid: true` result as a precondition to be checked by the checkout flow,
 * not as a discount that has been applied.
 */
import { db } from "./db";

export interface CouponValidation {
  valid: boolean;
  couponId?: string;
  error?: string;
}

function safeJsonArray<T>(raw: string): T[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

export async function validateCoupon(
  code: string,
  userId: string,
  planId: string
): Promise<CouponValidation> {
  const trimmed = code.trim().toUpperCase();
  const coupon = await db.coupon.findUnique({
    where: { code: trimmed },
    include: { redemptions: { where: { userId } } },
  });
  if (!coupon || !coupon.active) return { valid: false, error: "Coupon not found" };
  if (coupon.expiresAt && coupon.expiresAt < new Date())
    return { valid: false, error: "Coupon has expired" };
  if (coupon.maxRedemptions && coupon.timesRedeemed >= coupon.maxRedemptions)
    return { valid: false, error: "Coupon usage limit reached" };
  if (coupon.redemptions.length >= coupon.perUserLimit)
    return { valid: false, error: "You have already used this coupon" };

  const allowedPlans = safeJsonArray<string>(coupon.planKeys);
  if (allowedPlans.length > 0) {
    const plan = await db.plan.findUnique({ where: { id: planId } });
    if (!plan || !allowedPlans.includes(plan.key))
      return { valid: false, error: "Coupon not valid for this plan" };
  }

  if (coupon.firstPurchaseOnly) {
    const prior = await db.invoice.count({ where: { userId, status: "paid" } });
    if (prior > 0) return { valid: false, error: "Coupon is for first purchase only" };
  }

  if (coupon.minPurchaseCents) {
    const plan = await db.plan.findUnique({ where: { id: planId } });
    if (!plan || plan.priceCents < coupon.minPurchaseCents)
      return { valid: false, error: `Minimum purchase is ${(coupon.minPurchaseCents / 100).toFixed(2)}` };
  }

  return { valid: true, couponId: coupon.id };
}

export async function redeemCoupon(couponId: string, userId: string): Promise<void> {
  await db.coupon.update({
    where: { id: couponId },
    data: { timesRedeemed: { increment: 1 } },
  });
  await db.couponRedemption.create({ data: { couponId, userId } });
}