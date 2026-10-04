import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";

/**
 * Public, indexable marketing + calculator routes only.
 * Authenticated app routes under the `(app)` group are intentionally absent —
 * they are not linked publicly and must not be indexed. `/login` and
 * `/signup` are also excluded because `robots.ts` disallows them.
 */
const ROUTES: Array<{ path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }> = [
  { path: "/", priority: 1.0, changeFrequency: "weekly" },
  { path: "/calculators/car-cost", priority: 0.9, changeFrequency: "monthly" },
  { path: "/features", priority: 0.8, changeFrequency: "monthly" },
  { path: "/pricing", priority: 0.8, changeFrequency: "weekly" },
  { path: "/faq", priority: 0.7, changeFrequency: "monthly" },
  { path: "/docs", priority: 0.6, changeFrequency: "monthly" },
  { path: "/car-comparison", priority: 0.6, changeFrequency: "monthly" },
  { path: "/calculators/fuel-cost", priority: 0.6, changeFrequency: "monthly" },
  { path: "/calculators/depreciation", priority: 0.6, changeFrequency: "monthly" },
  { path: "/calculators/ev-vs-gas", priority: 0.5, changeFrequency: "monthly" },
  { path: "/calculators/repair-vs-replace", priority: 0.5, changeFrequency: "monthly" },
  { path: "/terms", priority: 0.2, changeFrequency: "yearly" },
  { path: "/privacy", priority: 0.2, changeFrequency: "yearly" },
  { path: "/acceptable-use", priority: 0.2, changeFrequency: "yearly" },
  { path: "/refund-policy", priority: 0.2, changeFrequency: "yearly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return ROUTES.map((r) => ({
    url: absoluteUrl(r.path),
    lastModified: now,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
}