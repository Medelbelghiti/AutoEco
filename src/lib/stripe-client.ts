import Stripe from "stripe";
import { env, stripeConfigured } from "./env";

export function getStripe(): Stripe | null {
  if (!stripeConfigured()) return null;
  return new Stripe(env.stripeSecretKey, {
    apiVersion: "2024-06-20",
    typescript: true,
    appInfo: { name: "AutoEco" },
  });
}

export class BillingNotConfiguredError extends Error {
  constructor() {
    super("Stripe billing is not configured on this server. Set STRIPE_SECRET_KEY in your environment.");
  }
}

export function requireStripe(): Stripe {
  const s = getStripe();
  if (!s) throw new BillingNotConfiguredError();
  return s;
}
