# AutoEco — Frequently Asked Questions

> **This document is a template placeholder and does not constitute legal counsel. The user-facing FAQ lives at `/faq`; keep the two consistent.**

**Last updated:** 2026-01-01

---

### 1. What is AutoEco?

AutoEco is a financial tracking and calculation tool for car owners. You record what you actually
spend on a vehicle — fuel, maintenance, repairs, insurance, tyres, parking, tolls — and AutoEco
computes your **true cost per month**, your **true cost per kilometer**, a category breakdown, and a
forecast of what the next 12 months will cost.

### 2. Is AutoEco a diagnostic or safety tool?

No. AutoEco is a financial tool. It does not inspect your vehicle, diagnose faults, or tell you
whether a car is safe or roadworthy. Maintenance and safety decisions remain entirely your
responsibility.

### 3. How does AutoEco calculate cost per kilometer?

It divides your total cost for a period by the distance you drove in that period. Distance comes
from the odometer reading you record on each fuel entry. The more complete your fill-up history, the
more accurate the figure.

### 4. How is depreciation treated?

Where you have recorded a purchase price and a current or estimated resale value, AutoEco treats the
difference as depreciation over the period you have owned the vehicle. It is shown as its own line so
you can see how much of your total cost is the car losing value rather than money leaving your
account.

### 5. What are forecasts?

Forecasts extrapolate your own recorded averages over a future period, using the assumptions shown
next to the result. They are **estimates, not predictions of future market conditions**. Fuel prices,
insurance rates and repair costs can all change in ways your history cannot anticipate.

### 6. How accurate is the fuel consumption figure?

Consumption is computed from full-tank entries: the distance between two fill-ups divided by the
litres added at the later fill-up. Partial fills and missed entries reduce accuracy. AutoEco marks
entries it could not use rather than silently estimating.

### 7. What is Ask Your Car?

A feature that answers questions about **your own figures** — cost per kilometer, average monthly
cost, totals for a category, which category is largest, the 12-month forecast, and fuel price
scenarios. If AutoEco does not have enough of your data to answer, it tells you instead of inventing
a number. It is included from the Pro plan and is available during a free trial.

### 8. What export formats are available?

**CSV**, available directly in the product at Settings → Your data, or via
`GET /api/export?dataset=all|vehicles|fuel|expenses`. The export contains your vehicles, expenses
and fuel entries. Receipt images are not included — only their references. Rows flagged
`isDemo=true` are sample data seeded into your account, not entries you typed.

### 9. Is there a free trial?

Paid plans may include a free trial, as shown at sign-up. You are not charged unless payment details
were provided and you did not cancel before the trial ends; otherwise your account falls back to the
Free plan. One trial per person.

### 10. What plans are available?

- **Free** — one vehicle, expense tracking.
- **Pro** — up to 5 vehicles, AI receipt scan, Financial Twin, advanced scenarios.
- **Family** — up to 12 vehicles, family sharing.
- **Pro Plus** — up to 50 vehicles and API access.

Current prices and limits are always shown on the pricing page and in the product.

### 11. Can I cancel my subscription?

Yes, any time, from Settings → Subscription. Cancellation takes effect at the end of the current
billing period — you keep access until then and are not charged again.

### 12. What is the refund policy?

Subscriptions can be cancelled any time. Prorated refunds are not issued by default but may be
considered case by case (for example a duplicate charge or a verified service failure). One-time
purchases have a refund window as stated in our [Refund Policy](refund-policy.md). Trials are not
charged until they end.

### 13. Is API access available?

Yes, on the Pro Plus plan. API keys are hashed at rest, revocable, and rate limited. Check the
pricing page or contact `[CONTACT EMAIL]` for documentation.

### 14. Can I delete my account and my data?

Yes, from Settings → Danger zone. Your name and email address are permanently erased and all API
keys are revoked, and access ends immediately. Anonymized billing and expense records are retained
because tax and accounting law requires it; they are no longer linked to you. See our
[Privacy Policy](privacy.md).

### 15. Do you sell my data?

No. We do not sell personal data and we do not run advertising or ad tracking. See our
[Privacy Policy](privacy.md).

### 16. Do you offer referral or affiliate programs?

Referral rewards may be offered in the product. The affiliate program is not currently open for
applications — see the [Affiliate Program Terms](affiliate-terms.md).

---

Still have questions? Contact us at `[CONTACT EMAIL]`.