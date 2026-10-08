/**
 * Screenshot capture for the RTL (Arabic) and LTR (French) UI.
 *
 * Run:   set DATABASE_URL + SCREENSHOT_DEMO_PASSWORD, then `npm run screenshots`
 * Output: docs/screenshots/<locale>/<locale>-<viewport>-<page>.png (git-ignored)
 *
 * It logs into the seeded demo user via the real login API, walks the public
 * and authenticated pages with each locale cookie, waits for fonts and network
 * idle, and records programmatic checks (document direction, horizontal
 * overflow, elements beyond the viewport) for every capture. A page that
 * errors or bounces back to /login fails the run loudly.
 */
import { test, expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const DEMO_EMAIL = (process.env.SCREENSHOT_DEMO_EMAIL || "demo@autoeco.app").toLowerCase();
const DEMO_PASSWORD = process.env.SCREENSHOT_DEMO_PASSWORD ?? "";
const OUT_DIR = "docs/screenshots";

const AUTH_REQUIRED = new Set(["/dashboard", "/garage", "/expenses", "/fuel", "/trips", "/reports", "/settings"]);

type Checks = {
  dir: string | null;
  bodyDirection: string;
  locale: string | null;
  overflowX: boolean;
  scrollWidth: number;
  viewportWidth: number;
  elementsBeyondViewport: number;
};

async function analyze(page: Page): Promise<Checks> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const vw = doc.clientWidth;
    let beyond = 0;
    for (const el of Array.from(document.querySelectorAll("body *")) as HTMLElement[]) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > vw + 1) beyond += 1;
    }
    return {
      dir: doc.getAttribute("dir"),
      bodyDirection: getComputedStyle(document.body).direction,
      locale: doc.getAttribute("lang"),
      overflowX: doc.scrollWidth > vw + 1,
      scrollWidth: doc.scrollWidth,
      viewportWidth: vw,
      elementsBeyondViewport: beyond,
    };
  });
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
}

async function capture(page: Page, path: string, label: string): Promise<Checks> {
  const t0 = Date.now();
  const response = await page.goto(path, { waitUntil: "networkidle", timeout: 90_000 });
  await settle(page);

  // Fail loudly: a page that bounced to /login was not rendered authenticated.
  const finalUrl = new URL(page.url());
  if (AUTH_REQUIRED.has(path) && finalUrl.pathname.startsWith("/login")) {
    throw new Error(`[${label}] ${path} bounced to /login — session did not apply.`);
  }
  if (!response || response.status() >= 400) {
    throw new Error(`[${label}] ${path} responded ${response?.status() ?? "no-response"}.`);
  }

  const checks = await analyze(page);
  const pngName = path === "/" ? "home" : path.slice(1).replace(/\//g, "-");
  console.log(
    `  [${label}] /${pngName} -> dir=${checks.dir} body=${checks.bodyDirection} ` +
      `overflowX=${checks.overflowX} beyondViewport=${checks.elementsBeyondViewport} ` +
      `(${Date.now() - t0}ms)`
  );
  await page.screenshot({
    path: `${OUT_DIR}/${label}-${viewportSlug(page)}-${pngName}.png`,
    fullPage: false,
    animations: "disabled",
  });
  return checks;
}

function viewportSlug(page: Page): string {
  return page.viewportSize() && page.viewportSize()!.width < 768 ? "mobile" : "desktop";
}

function attachPageHandlers(page: Page, pageErrors: string[]): void {
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") pageErrors.push(`console: ${m.text()}`);
  });
}

for (const { locale, label, expectDir } of [
  { locale: "ar", label: "ar", expectDir: "rtl" },
  { locale: "fr", label: "fr", expectDir: "ltr" },
]) {
  test(`capture ${label} (rtl=${expectDir === "rtl"})`, async ({ browser, baseURL, request }, testInfo) => {
    expect(DEMO_PASSWORD.length).toBeGreaterThan(0);
    const base = new URL(baseURL ?? "http://127.0.0.1:3210");
    const viewport = testInfo.project.use.viewport ?? { width: 1280, height: 800 };
    const setLocale = (ctx: import("@playwright/test").BrowserContext) =>
      ctx.addCookies([{ name: "lg_locale", value: locale, domain: base.hostname, path: "/" }]);

    const prisma = new PrismaClient();
    try {
      const demo = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
      if (!demo) throw new Error(`Demo user ${DEMO_EMAIL} was not seeded (see e2e/seed-global.ts).`);
      const vehicle = await prisma.vehicle.findFirst({ where: { userId: demo.id }, select: { id: true } });
      const garageDetail = vehicle ? (`/garage/${vehicle.id}` as const) : null;

      const publicRoutes: Array<[string, string]> = [
        ["/", "home"],
        ["/login", "login"],
        ["/signup", "signup"],
        ["/pricing", "pricing"],
      ];
      const appRoutes: Array<[string, string]> = [
        ["/dashboard", "dashboard"],
        ["/garage", "garage"],
        ...(garageDetail ? [[garageDetail, "garage-detail"] as [string, string]] : []),
        ["/expenses", "expenses"],
        ["/fuel", "fuel"],
        ["/trips", "trips"],
        ["/reports", "reports"],
        ["/settings", "settings"],
      ];

      const report: Array<{ page: string; checks: Checks }> = [];
      const pageErrors: string[] = [];
      const publicCtx = await browser.newContext({ viewport });
      await setLocale(publicCtx);
      const publicPage = await publicCtx.newPage();
      attachPageHandlers(publicPage, pageErrors);

      // Anonymous visitor: marketing/auth pages, no session cookie (a signed-in
      // user is redirected away from /login and /signup by the middleware).
      for (const [path, name] of publicRoutes) {
        const checks = await capture(publicPage, path, label);
        report.push({ page: name, checks });
      }

      // Signed-in visitor: navigate the app pages. Log in through the real API
      // and forward issued cookies into the app context. The login handler
      // re-issues `lg_locale` from the user's saved profile, so forward only
      // the session cookie and then re-apply the locale under test on top.
      const login = await request.post("/api/auth/login", {
        data: { email: DEMO_EMAIL, password: DEMO_PASSWORD },
      });
      expect(login.ok(), `login as ${DEMO_EMAIL} failed (${login.status()})`).toBeTruthy();
      const issued: Array<{ name: string; value: string }> = [];
      for (const h of login.headersArray()) {
        if (h.name.toLowerCase() !== "set-cookie") continue;
        const [pair] = h.value.split(";");
        const eq = pair.indexOf("=");
        if (eq > 0) issued.push({ name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim() });
      }
      expect(issued.some((c) => c.name === "autoeco_session"), "login issued a session cookie").toBeTruthy();
      const appCtx = await browser.newContext({ viewport });
      await appCtx.addCookies(
        issued
          .filter((c) => c.name !== "lg_locale")
          .map((c) => ({ name: c.name, value: c.value, domain: base.hostname, path: "/" }))
      );
      await setLocale(appCtx);
      const appPage = await appCtx.newPage();
      attachPageHandlers(appPage, pageErrors);

      try {
        for (const [path, name] of appRoutes) {
          const checks = await capture(appPage, path, label);
          report.push({ page: name, checks });
        }

        // Open states: the two mobile nav drawers.
        if (viewport.width < 768) {
          await publicPage.goto("/", { waitUntil: "networkidle", timeout: 60_000 });
          await settle(publicPage);
          await publicPage.locator('button[aria-controls="mobile-nav"]').click();
          await publicPage.waitForTimeout(300);
          const marketingOpen = await analyze(publicPage);
          console.log(
            `  [${label}] open-drawer-marketing -> dir=${marketingOpen.dir} ` +
              `overflowX=${marketingOpen.overflowX} beyondViewport=${marketingOpen.elementsBeyondViewport}`
          );
          await publicPage.screenshot({
            path: `${OUT_DIR}/${label}-mobile-open-drawer-marketing.png`,
            animations: "disabled",
          });
          await publicPage.keyboard.press("Escape");
          await publicPage.waitForTimeout(150);

          await appPage.goto("/dashboard", { waitUntil: "networkidle", timeout: 60_000 });
          await settle(appPage);
          await appPage.locator('button[aria-controls="app-drawer"]').click();
          await appPage.waitForTimeout(300);
          const appOpen = await analyze(appPage);
          console.log(
            `  [${label}] open-drawer-app -> dir=${appOpen.dir} overflowX=${appOpen.overflowX} ` +
              `beyondViewport=${appOpen.elementsBeyondViewport}`
          );
          await appPage.screenshot({
            path: `${OUT_DIR}/${label}-mobile-open-drawer-app.png`,
            animations: "disabled",
          });
        }

        // Hard expectations for the locale under test.
        const oddDir = report.filter((r) => r.checks.dir !== expectDir);
        expect(oddDir, `pages with unexpected dir: ${oddDir.map((r) => r.page).join(", ")}`).toEqual([]);
        expect(report.every((r) => r.checks.bodyDirection === expectDir)).toBeTruthy();

        const overflow = report.filter((r) => r.checks.overflowX);
        if (overflow.length > 0) {
          const detail = overflow
            .map((r) => `${r.page}: scrollWidth=${r.checks.scrollWidth} vw=${r.checks.viewportWidth}`)
            .join("\n  ");
          throw new Error(`Horizontal overflow on ${overflow.length} page(s):\n  ${detail}`);
        }
        if (pageErrors.length > 0) {
          throw new Error(`Page errors while capturing ${label}:\n  ${Array.from(new Set(pageErrors)).join("\n  ")}`);
        }

        console.log(`  [${label}] OK — ${report.length} pages render without overflow.\n`);
      } finally {
        await publicCtx.close();
        await appCtx.close();
      }
    } finally {
      await prisma.$disconnect();
    }
  });
}