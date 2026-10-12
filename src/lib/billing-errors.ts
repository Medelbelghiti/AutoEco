/**
 * Provider-neutral billing errors.
 *
 * These used to live in `stripe-client.ts`, which meant the generic error
 * mapper in `http.ts` imported a Stripe module just to recognise an error
 * class. Paddle is the only billing provider now, so the class has no provider
 * in its name and no provider in its message.
 */
export class BillingNotConfiguredError extends Error {
  constructor(provider = "Billing") {
    super(`${provider} billing is not configured on this server.`);
  }
}