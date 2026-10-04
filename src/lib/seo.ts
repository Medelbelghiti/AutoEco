/**
 * Centralised SEO / metadata helpers for AutoEco.
 *
 * Single source of truth for:
 *   - the canonical site origin (used for metadataBase, canonical URLs,
 *     Open Graph URLs and the sitemap)
 *   - the brand name and default title / description
 *   - `pageMeta()` — a small factory so every public page emits a
 *     consistent title / description / canonical / OG / Twitter block.
 *
 * IMPORTANT: the site-wide title template lives in `src/app/layout.tsx`
 * as `%s | AutoEco`. Page titles passed to `pageMeta()` must therefore be
 * the SHORT form ("Car Cost Calculator"), never "… | AutoEco", otherwise
 * the rendered title is double-branded.
 */
import type { Metadata } from "next";

export const BRAND = "AutoEco";

export const DEFAULT_TITLE = "AutoEco — Track & Calculate Your True Car Ownership Cost";

export const DEFAULT_DESCRIPTION =
  "Track fuel, maintenance, repairs, insurance and other vehicle expenses. " +
  "Understand your true cost per month and kilometer and forecast future costs.";

/**
 * Search intent we genuinely serve. Kept short and honest — no stuffing.
 */
export const SITE_KEYWORDS = [
  "car ownership cost calculator",
  "true cost of owning a car",
  "car expense tracker",
  "vehicle cost calculator",
  "cost per kilometer",
  "car maintenance tracker",
  "car cost per mile",
  "fuel cost tracker",
];

/**
 * Resolve the canonical site origin.
 *
 * Order of preference:
 *   1. NEXT_PUBLIC_SITE_URL          — explicit override
 *   2. VERCEL_PROJECT_PRODUCTION_URL — injected by Vercel at build time
 *   3. VERCEL_URL                    — injected by Vercel at build time
 *   4. NEXT_PUBLIC_APP_URL           — shared with the app (emails, redirects)
 *   5. localhost                     — local development fallback
 *
 * Localhost candidates are skipped unless nothing else is available, so a
 * production build that still has the dev default in NEXT_PUBLIC_APP_URL
 * cannot emit `http://localhost:3000` canonicals or OG URLs.
 */
export function siteOrigin(): URL {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) {
    const u = tryUrl(explicit);
    if (u) return u;
  }

  const vercelCandidates = [
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
  ];

  for (const c of vercelCandidates) {
    const u = c ? tryUrl(c) : null;
    if (u && !isLocal(u)) return u;
  }

  const appUrl = tryUrl(process.env.NEXT_PUBLIC_APP_URL ?? "");
  if (appUrl && !isLocal(appUrl)) return appUrl;

  return appUrl ?? new URL("http://localhost:3000");
}

function tryUrl(value: string): URL | null {
  if (!value) return null;
  try {
    const u = new URL(value.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u;
  } catch {
    return null;
  }
}

function isLocal(u: URL): boolean {
  return u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "0.0.0.0";
}

/** Absolute URL for a site-relative path ("/" → "https://…/"). */
export function absoluteUrl(path: string): string {
  const base = siteOrigin();
  const clean = path.startsWith("/") ? path : `/${path}`;
  return new URL(clean, base.origin).toString();
}

interface PageMetaInput {
  /** Short title. Do NOT append the brand — the layout template does it. */
  title: string;
  description: string;
  /** Site-relative path, e.g. "/pricing". Use for canonical + OG url. */
  path: string;
  /** Optional tighter keyword set for this page. */
  keywords?: string[];
  /** Set false for pages that must never be indexed (e.g. auth). */
  index?: boolean;
}

/**
 * Build a consistent Metadata object for a public marketing page.
 * `path` must be the page's own canonical path.
 */
export function pageMeta({
  title,
  description,
  path,
  keywords,
  index = true,
}: PageMetaInput): Metadata {
  const url = absoluteUrl(path);
  return {
    title,
    description,
    keywords: keywords ?? SITE_KEYWORDS,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      siteName: BRAND,
      title: `${title} | ${BRAND}`,
      description,
      url,
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} | ${BRAND}`,
      description,
    },
    robots: index ? { index: true, follow: true } : { index: false, follow: true },
  };
}