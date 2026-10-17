import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  appOrigin,
  absoluteUrl,
  passwordResetUrl,
  emailVerifyUrl,
  pageMeta,
} from "@/lib/seo";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";

/**
 * SEO and transactional emails must never disagree on the origin. Both the
 * canonical host (sitemap, robots, `rel=canonical`, OG) and every emailed link
 * are resolved through the single `appOrigin()` / `absoluteUrl()` helper, which
 * reads `NEXT_PUBLIC_SITE_URL` and `NEXT_PUBLIC_APP_URL` at call time.
 *
 * The owner sets BOTH env vars to the canonical host
 * (`https://www.myautoeco.com`). These tests pin that contract.
 */
const CANONICAL = "https://www.myautoeco.com";

const KEYS = [
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_APP_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_URL",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k] as string;
  }
});

function startsWithOrigin(value: string): boolean {
  return value === appOrigin() || value.startsWith(`${appOrigin()}/`);
}

describe("canonical origin", () => {
  it("resolves the canonical host when both APP_URL and SITE_URL are set to it", () => {
    process.env.NEXT_PUBLIC_SITE_URL = CANONICAL;
    process.env.NEXT_PUBLIC_APP_URL = CANONICAL;
    expect(appOrigin()).toBe(CANONICAL);
  });

  it("keeps SEO and emails on one origin even if the two env vars disagree", () => {
    process.env.NEXT_PUBLIC_SITE_URL = CANONICAL;
    process.env.NEXT_PUBLIC_APP_URL = "https://wrong-host.example.com";

    expect(appOrigin()).toBe(CANONICAL);
    expect(absoluteUrl("/pricing")).toBe(`${CANONICAL}/pricing`);
    // The reset link is the one an operator would actually click in an inbox.
    expect(passwordResetUrl("tok_123")).toBe(`${CANONICAL}/reset-password?token=tok_123`);
  });

  it("falls back to APP_URL when SITE_URL is unset", () => {
    process.env.NEXT_PUBLIC_APP_URL = CANONICAL;
    expect(appOrigin()).toBe(CANONICAL);
    expect(emailVerifyUrl("tok")).toBe(`${CANONICAL}/verify-email?token=tok`);
  });

  it("sitemap, robots, canonical and the reset-password link share one origin", () => {
    process.env.NEXT_PUBLIC_SITE_URL = CANONICAL;
    process.env.NEXT_PUBLIC_APP_URL = "https://wrong-host.example.com";

    const entries = sitemap();
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(startsWithOrigin(entry.url), `sitemap entry ${entry.url}`).toBe(true);
    }

    const r = robots();
    expect(startsWithOrigin(r.sitemap as string)).toBe(true);
    expect(startsWithOrigin(r.host as string)).toBe(true);

    const meta = pageMeta({ title: "Pricing", description: "Plans", path: "/pricing" });
    expect(startsWithOrigin(meta.alternates?.canonical as string)).toBe(true);
    expect(startsWithOrigin((meta.openGraph?.url as string) ?? "")).toBe(true);

    expect(startsWithOrigin(passwordResetUrl("tok_123"))).toBe(true);
  });

  it("URL-encodes tokens in emailed links", () => {
    process.env.NEXT_PUBLIC_SITE_URL = CANONICAL;
    const token = "a b/c+d";
    expect(passwordResetUrl(token)).toBe(
      `${CANONICAL}/reset-password?token=${encodeURIComponent(token)}`
    );
    expect(emailVerifyUrl(token)).toBe(`${CANONICAL}/verify-email?token=${encodeURIComponent(token)}`);
  });
});
