/**
 * Cloudflare Turnstile verification (server side).
 *
 * Behaviour:
 *  - CAPTCHA_PROVIDER !== "turnstile"  => disabled, always passes (dev / not yet configured).
 *  - CAPTCHA_PROVIDER === "turnstile"  => a valid token is REQUIRED; a missing or
 *    rejected token fails closed. If Cloudflare itself is unreachable we also fail
 *    closed so a bot cannot bypass the check by making the verify call time out.
 */
import { env } from "./env";

export function captchaEnabled(): boolean {
  return env.captchaProvider === "turnstile" && Boolean(env.turnstileSecretKey);
}

export async function verifyCaptcha(token: string | null | undefined, ip?: string): Promise<boolean> {
  if (!captchaEnabled()) return true;
  if (!token || typeof token !== "string" || token.length > 4096) return false;
  try {
    const body = new URLSearchParams({ secret: env.turnstileSecretKey, response: token });
    if (ip && ip !== "unknown") body.set("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { success?: boolean };
    return json.success === true;
  } catch {
    return false;
  }
}
