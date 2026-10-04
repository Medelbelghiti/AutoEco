# AutoEco

> **Track & calculate your true car ownership cost.**

AutoEco is a financial tool for car owners. You record what you actually spend on your vehicle —
fuel, maintenance, repairs, insurance, tyres, parking, tolls — and AutoEco turns that into the
numbers that matter: **true cost per month**, **true cost per kilometer**, and a **12-month
forecast** of what owning the car will cost, with every assumption shown.

AutoEco is **not** a vehicle diagnostic or safety service and never tells you whether a car is
safe to drive.

---

## What it actually does

| Area | Detail |
| ---- | ------ |
| Garage | Track one or many vehicles (make, model, year, trim, engine, drivetrain, mileage). |
| Fuel | Log fill-ups with litres/kWh, price and odometer; consumption is computed from full-tank entries. |
| Expenses | 14 categories: fuel, maintenance, repair, insurance, tax, registration, tires, parking, tolls, cleaning, accessories, financing, charging, other. |
| Financial Twin | Cost per month, cost per year, cost per kilometer, and a category breakdown. |
| Forecast | Projects the next 12 months from your own recorded averages and prints the assumptions. |
| Scenarios | Financial what-ifs (e.g. fuel price change). Financial comparison only. |
| Reports | Ownership reports with retention limits per plan. |
| Ask Your Car | Answers questions from your own recorded data. |
| Receipts | Receipt scanning/OCR, quota-limited per plan. |
| Data export | Download vehicles, fuel entries and expenses as CSV from Settings. |
| API | Hashed, revocable, rate-limited API keys on the highest plan. |
| i18n | English and French (`src/locales`). |

### Ask Your Car

`/api/ai` answers questions from the user's **own** expenses, fuel entries and distance:

- cost per kilometer, average monthly cost, total spend
- totals for a specific category (fuel, maintenance, insurance…)
- which category is the largest
- 12-month forecast, and its assumptions
- fuel price scenario

If the required data is missing it says so instead of inventing a number. Setting
`OPENAI_API_KEY` enables an optional LLM phrasing layer over the same verified facts; it does not
change what the numbers are. Without a key the endpoint is fully deterministic.

---

## Architecture

```
Visitor
  ↓
Landing page → Free calculators (no signup) → Signup → Dashboard
                                                    ↓
                       Vehicles + Fuel + Expenses  (Prisma)
                                                    ↓
                    Cost engine → Financial Twin / Insights / Forecast
                                                    ↓
                     Ask Your Car   ·   Reports   ·   Export
```

### Tech stack

| Layer | Choice |
| ----- | ------ |
| Framework | Next.js 14 (App Router) + React 18 |
| Language | TypeScript (strict) |
| Database | Prisma 5 — SQLite (dev) / PostgreSQL (prod) |
| Auth | Custom JWT (`jose`) in `HttpOnly` cookies + bcryptjs |
| Payments | Paddle (primary) — client-side Paddle.js checkout, server-verified webhooks |
| Payments (legacy) | Stripe — retained for existing subscriptions and webhook handling |
| Styling | Tailwind CSS |
| Email | Nodemailer (`console` default, or SMTP) |
| Exports | CSV (hand-rolled) |
| Tests | Vitest |

### Plans

Plans live in the database and are seeded idempotently by `prisma/seed.ts`. The pricing page
renders whatever is active in the DB — it never hardcodes prices.

| Key | Price | Vehicles | Notes |
| --- | ----- | -------- | ----- |
| `free` | $0 | 1 | Expense tracking only |
| `pro` | $6.99/mo | 5 | AI receipt scan, Financial Twin, scenarios |
| `family` | $12.99/mo | 12 | Family sharing |
| `pro_plus` | $19.99/mo | 50 | API access |

To change a price, edit `prisma/seed.ts` and re-run `npm run prisma:seed`.

### Entitlements

`src/lib/plans.ts` → `getEntitlements(user)` is the **single authority** for what a user is
allowed to do. It resolves the active subscription, honours trial expiry, cancels paid access when
`currentPeriodEnd` passes, and grants a bounded 14-day grace window on `past_due`. A stale
`User.planId` never grants paid access on its own.

---

## Quick start

### Prerequisites

* Node.js ≥ 20
* npm ≥ 10

### Installation

```bash
git clone https://github.com/Medelbelghiti/LeadGen-2
cd LeadGen
npm install
cp .env.example .env
# Edit .env and set AUTH_SECRET (32+ random bytes):
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npm run prisma:deploy
npm run prisma:seed
npm run dev
```

Open <http://localhost:3000>.

### Seeded accounts

| Role | Email | Password |
| ---- | ----- | -------- |
| Admin | value of `SEED_ADMIN_EMAIL` (default `admin@example.com`) | value of `SEED_ADMIN_PASSWORD` |
| Demo | `demo@example.com` | `demo-password` |

The demo account contains clearly-labelled sample data (`isDemo = true`). **Change or remove both
accounts in any non-development environment.**

---

## Environment variables

See `.env.example`. The core app — tracking, cost engine, calculators, export — works with only
`DATABASE_URL`, `AUTH_SECRET` and `NEXT_PUBLIC_APP_URL`.

| Variable | Required | Purpose |
| -------- | -------- | ------- |
| `DATABASE_URL` | yes | Prisma connection string |
| `AUTH_SECRET` | yes | 32+ byte random hex for session signing |
| `NEXT_PUBLIC_APP_URL` | yes | Public base URL (emails, redirects, sitemap, robots) |
| `PADDLE_API_KEY` | for paid plans | Paddle API key (server only) |
| `PADDLE_WEBHOOK_SECRET` | for paid plans | Paddle webhook signing secret |
| `PADDLE_SELLER_ID` | for paid plans | Paddle seller id |
| `PADDLE_PRO_PRICE_ID` | for the Pro plan | Paddle price id |
| `PADDLE_FAMILY_PRICE_ID` | for the Family plan | Paddle price id |
| `PADDLE_BUSINESS_PRICE_ID` | for Pro Plus | Paddle price id for the top tier |
| `PADDLE_LIFETIME_PRICE_ID` | optional | One-off top-tier price |
| `PADDLE_ENV` / `NEXT_PUBLIC_PADDLE_ENV` | no | `sandbox` (default) or `live` |
| `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` | for browser checkout | Paddle.js client token (public) |
| `STRIPE_*` | no | Legacy Stripe subscriptions |
| `EMAIL_PROVIDER` | no | `console` (default) or `smtp` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | for SMTP | Email delivery |
| `OPENAI_API_KEY` | no | Optional LLM phrasing layer for Ask Your Car |

Paddle.js refuses to open a live checkout unless `NEXT_PUBLIC_PADDLE_ENV=live`, so sandbox by
default is a safety feature, not an oversight.

---

## Testing & verification

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

---

## Production deployment

1. Set `NODE_ENV=production`.
2. Set `NEXT_PUBLIC_APP_URL` to the public HTTPS origin.
3. Set `AUTH_SECRET` to 32+ random bytes. The app refuses to boot in production without it.
4. Configure Paddle: API key, webhook secret, seller id, price ids, and `PADDLE_ENV=live` /
   `NEXT_PUBLIC_PADDLE_ENV=live` when you are ready to charge real money.
5. Point a Paddle webhook at `https://yourdomain.com/api/paddle/webhook` and subscribe it to
   subscription and transaction events.
6. Configure SMTP (`EMAIL_PROVIDER=smtp`) — otherwise all transactional email is only logged.
7. `npm run build` (runs migrations via `scripts/build-with-migrate.js`).
8. `npm run prisma:seed` on first run (idempotent).
9. Ensure your proxy sets a correct `X-Forwarded-For`; IP-based rate limiting depends on it.

---

## Security

* Passwords are bcrypt-hashed (12 rounds).
* Sessions are JWT (`jose`) in `HttpOnly`, `Secure` (production), `SameSite=Lax` cookies.
* API keys are HMAC-SHA-256-hashed at rest and never stored in plaintext.
* Every API route enforces auth (`requireUser` / `requireAdmin`) and ownership checks.
* Rate limiting is DB-backed and applied to signup, login and data export.
* Paddle webhook signatures are verified with a constant-time HMAC compare plus a timestamp
  tolerance check.
* Unexpected API errors are logged server-side and returned to the client only as
  `Something went wrong. Reference: ref_xxx` — never with internals.
* Secrets live only in environment variables. `assertProdOnBoot()` refuses to start a production
  server with a missing or weak `AUTH_SECRET`.

---

## Data ownership

* **Export:** Settings → Your data → Download everything (CSV). Also
  `GET /api/export?dataset=all|vehicles|fuel|expenses`.
* **Delete:** Settings → Danger zone → Delete my account. Your name and email are erased and all
  API keys are revoked. Anonymized billing and expense rows are retained because tax and
  accounting law requires it; they are no longer linked to you.
* Receipt images are **not** included in the CSV export — only their references.

---

## Known limitations

* Receipt OCR and Ask Your Car quotas are per plan and reset monthly.
* The default email provider is `console`. Configure SMTP for production.
* Paid plans require Paddle to be configured; without it the pricing page shows real prices but
  checkout is unavailable rather than pretending to work.
* Financial projections are estimates from your own averages. They are labeled as estimates
  throughout the UI.

---

## License

Proprietary — all rights reserved by the copyright holder.