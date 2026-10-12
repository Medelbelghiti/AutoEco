# Privacy Policy

> **This document is a template placeholder and does not constitute legal advice. Have it reviewed by qualified legal counsel before public launch. Every `[SQUARE_BRACKET]` value below must be replaced before launch.**

**Last updated:** 2026-01-01

This Privacy Policy explains how `[LEGAL ENTITY NAME]` ("we", "us", "our") collects, uses, and
protects personal data when you use AutoEco (the "Service"). This policy is drafted with the EU
General Data Protection Regulation (GDPR) and similar privacy laws in mind.

AutoEco is a financial record-keeping and calculation tool for vehicle ownership. It is **not** a
vehicle diagnostic or safety service.

## 1. Data We Collect

**Account data.** When you register we collect your email address, a hashed password, an optional
name, your locale, and your preferences (currency, distance unit, fuel unit). We never store your
password in plain text.

**Vehicle and cost data you enter.** This is the core of the Service, and it belongs to you:

- Vehicles you add (make, model, year, trim, engine, drivetrain, mileage, optional license plate
  and VIN, optional notes);
- Fuel entries (date, amount, currency, litres or kWh, price per unit, odomometer reading, station,
  computed consumption);
- Expenses (date, category, amount, currency, merchant, mileage, notes, recurrence flag);
- Receipt images you upload for scanning;
- Generated reports, forecasts and scenarios.

**Billing data.** Paid plans are processed by our payment processor, Paddle. They receive your
payment details and return subscription status, invoices and transaction identifiers.
**We do not store full card numbers.**

**Technical data.** IP address, user agent, request timestamps, authentication events, failed login
attempts, and audit logs used to operate, secure and debug the Service.

**Analytics events.** We record product events (signup, login, checkout started, subscription
changed, export created) internally. Event metadata is filtered to strip anything that could
contain personal data such as email addresses, names or vehicle identifiers. External analytics
forwarding is not enabled by default.

## 2. How We Use Data

We use collected data to:

- Provide, operate and maintain the Service (calculating cost per month, cost per kilometer and
  forecasts from the data you enter);
- Manage accounts, subscriptions, trials, invoices, referrals and plan limits;
- Answer your questions in **Ask Your Car**, using figures computed from your own records;
- Enforce quotas and our Acceptable Use Policy, and prevent fraud and abuse;
- Improve the Service through internal, de-identified analytics;
- Communicate with you about your account and service changes;
- Comply with legal, tax and accounting obligations.

Legal bases under GDPR include: performance of a contract (providing the Service), legitimate
interests (security, fraud prevention, service improvement), consent (where required), and legal
obligation.

### Ask Your Car and AI

Ask Your Car answers questions using figures **computed from your own recorded expenses, fuel
entries and distance**. When no LLM key is configured, answers are produced by a deterministic
engine that only performs arithmetic on your data. If an LLM is configured, it receives the same
verified figures to phrase the response; it is not given your raw records and it is not permitted
to invent numbers. If AutoEco does not have enough of your data to answer, it says so.

## 3. Cookies

We use a deliberately small set of cookies:

- **Essential — always on.** Session authentication (`lg_session`), your locale preference
  (`lg_locale`), and referral attribution (`lg_aff`). These cannot be disabled because the Service
  cannot function without them.
- **Analytics — optional.** Where required by law, aggregate usage measurement is only enabled with
  consent. You can decline without losing any functionality.

## 4. Third Parties

We share data only as needed to operate the Service:

- **Payment processing:** Paddle, our payment processor, handles payments and
  returns subscription and invoice status.
- **Email delivery:** our SMTP provider, for transactional email such as password reset and
  billing notices.
- **Infrastructure:** database hosting, application hosting and email delivery, acting as
  processors.
- **Optional AI:** if configured, an LLM provider receives computed financial figures in order to
  phrase an answer.

We do **not** sell your personal data and we do not run advertising or ad tracking.

## 5. Data Retention and Export

**Export.** You can download everything you have entered as CSV at any time from
**Settings → Your data**, or via `GET /api/export`. The export includes vehicles, expenses and fuel
entries. Receipt images are not included in the CSV — only their references. Rows marked
`isDemo=true` are sample data seeded into your account, not entries you typed.

**Deletion.** You can delete your account from **Settings → Danger zone**. When you do:

- your name and email address are permanently erased (the email address is replaced with a
  non-routable placeholder);
- all of your API keys are immediately revoked;
- your session is terminated and you lose access to the Service immediately.

**Retained records.** Anonymized billing records and expense rows are retained after deletion
because tax and accounting law requires us to retain financial records. These retained rows are
no longer linked to your email address, name or account.

## 6. Your Rights

Subject to applicable law (including GDPR), you have the right to:

- **Access** the personal data we hold about you;
- **Rectify** inaccurate data;
- **Export** your data in a portable format — available directly in the product as CSV;
- **Delete** your account and data, available directly in the product;
- **Restrict or object** to certain processing, and withdraw consent where processing relies on it;
- **Lodge a complaint** with your local data protection authority.

To exercise these rights, use the in-product export and delete features, or contact
`[PRIVACY EMAIL]`. We may need to verify your identity before acting on a request.

## 7. Security Measures

We apply technical and organizational measures appropriate to the risk, including encryption in
transit (TLS), hashed password storage, hashed API keys, access controls on a need-to-know basis,
per-account authorization checks on every request, rate limiting, and monitoring for abuse. No
method of transmission or storage is 100% secure; if a breach affecting your data occurs, we will
notify you and authorities as required by law.

## 8. International Transfers

Your data may be processed in countries other than your own, including where our providers operate.
Where personal data is transferred outside the EEA/UK, we rely on appropriate safeguards such as
Standard Contractual Clauses or adequacy decisions, as required by applicable law.

## 9. Children

The Service is not directed at children, and we do not knowingly collect personal data from anyone
under 18.

## 10. Changes to This Policy

We may update this policy from time to time. Material changes will be announced via the Service or
email with reasonable advance notice. The "Last updated" date reflects the latest revision.

## 11. Contact

Privacy questions and data requests: `[PRIVACY EMAIL]`

Data Controller: `[LEGAL ENTITY NAME]` — `[REGISTERED ADDRESS]`