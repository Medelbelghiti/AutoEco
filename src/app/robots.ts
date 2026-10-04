import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Authenticated app routes, API endpoints and the account actions
        // must never be crawled or indexed.
        disallow: [
          "/api/",
          "/app/",
          "/dashboard",
          "/garage",
          "/expenses",
          "/fuel",
          "/insights",
          "/financial-twin",
          "/scenarios",
          "/reports",
          "/receipts",
          "/assistant",
          "/share",
          "/settings",
          "/onboarding",
          "/login",
          "/signup",
          "/reset-password",
          "/verify-email",
        ],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: absoluteUrl("/"),
  };
}