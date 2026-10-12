# Screenshots (RTL / LTR capture)

Generated UI screenshots are **not committed**. This directory is git-ignored and is
regenerated on demand so it always reflects the current code without stale pixels
in the repo.

## What is captured

- Locales: `ar` (Arabic — right-to-left, real Arabic copy via the preview seam)
  and `fr` (French — left-to-right control).
- Viewports: desktop `1280x800` (project `desktop`) and mobile `390x844`
  (project `mobile`).
- Pages: home, login, signup, pricing, dashboard, garage, garage detail,
  expenses, fuel, trips, reports, settings.
- Open states (mobile only): the marketing nav drawer (`open-drawer-marketing`)
  and the app drawer (`open-drawer-app`).

The capture also asserts, per page: the `<html dir>` matches the locale
(`rtl` for ar, `ltr` for fr), there is no horizontal overflow, and no page
error or bounce to `/login` happened — so a broken RTL layout fails the run
instead of producing a misleading PNG. Visual judgement is still yours: the
script reports checks, it does not decide what "looks right".

## How to regenerate

```powershell
# 1. Start your local Postgres and make sure the test database exists.
# 2. Tell the capture where the database is and the demo password to use.
$env:DATABASE_URL = "postgresql://autoeco:autoeco@127.0.0.1:5432/autoeco_test"
$env:SCREENSHOT_DEMO_PASSWORD = "<a dev-only password>"

# 3. Run.
npm run screenshots
```

PNGs land in `docs/screenshots/`.

## What the setup does (printed at run start)

1. Uses `DATABASE_URL` (the local test database, same one vitest uses).
2. Upserts the demo user `demo@autoeco.app` with the password from
   `SCREENSHOT_DEMO_PASSWORD` (never hard-coded) plus a demo vehicle and six
   months of fuel/expenses if missing — the same fake data the repo seed
   creates.
3. Starts `next dev` on http://127.0.0.1:3210 with `PREVIEW_PENDING_LOCALES=1`
   and its client twin `NEXT_PUBLIC_PREVIEW_PENDING_LOCALES=1`, which lets the
   **pending** `ar` locale render its real Arabic copy and `dir="rtl"` (the
   production send path is unaffected — Arabic stays English until
   `LOCALE_STATUS["ar"]` flips to `ready`). The `NEXT_PUBLIC_` twin must be set
   alongside: Next only inlines `NEXT_PUBLIC_*` into the client bundle, so a
   server-only flag would make the server render Arabic while the hydrated
   client reverted to English.
4. Uses an anonymous browser context for home/login/signup/pricing (so `/login`
   and `/signup` capture real anonymous views instead of the signed-in redirect
   to the dashboard) and a second, authenticated context for the app pages,
   logging in through the real `/api/auth/login`.
5. Walks every page, runs the programmatic checks, and saves the screenshots.

## Files

- `playwright.config.ts` — server orchestration and the two viewport projects.
- `e2e/seed-global.ts` — global setup: idempotent demo-user/data seeding.
- `e2e/screens.capture.ts` — the capture walk + programmatic checks.
- `@playwright/test` is a **dev-only** dependency; `npm run screenshots` is the
  only command that touches it. Vitest's `include` (tests/**/*.test.ts) never
  sees these files and no CI hook runs them.