import "./globals.css";
import type { Metadata, Viewport } from "next";
import { dirFor } from "@/lib/i18n";
import { getLocale } from "@/lib/server-i18n";
import { LocaleProvider } from "@/components/LocaleProvider";
import { BRAND, DEFAULT_DESCRIPTION, DEFAULT_TITLE, SITE_KEYWORDS, siteOrigin } from "@/lib/seo";

export const metadata: Metadata = {
  metadataBase: siteOrigin(),
  title: {
    default: DEFAULT_TITLE,
    template: `%s | ${BRAND}`,
  },
  description: DEFAULT_DESCRIPTION,
  applicationName: BRAND,
  generator: "Next.js",
  keywords: SITE_KEYWORDS,
  category: "finance",
  referrer: "origin-when-cross-origin",
  formatDetection: { telephone: false, address: false, email: false },
  openGraph: {
    type: "website",
    siteName: BRAND,
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    url: "/",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0c0f" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = getLocale();
  const dir = dirFor(locale);
  return (
    <html lang={locale} dir={dir}>
      <body>
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}