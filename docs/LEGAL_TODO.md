# AutoEco — Legal & launch TODO

This is the **only remaining `check:launch` blocker**: filled-in placeholders and
a lawyer's eye on the customer-facing legal documents. Nothing else in the code
gate is red.

The automated gate scans `legal/*.md` for `[BRACKETED]` tokens:

```powershell
npm run check:launch
```

It will keep failing until **every** token below is replaced and the documents
are reviewed.

---

## 1. Placeholders to replace

All are of the form `` `[SOMETHING]` ``. Replace the text inside the brackets
(keep your own wording/formatting; these are templates).

| Placeholder | Appears in | What to put |
| --- | --- | --- |
| `[LEGAL ENTITY NAME]` | `legal/terms.md`, `legal/privacy.md`, `legal/refund-policy.md`, `legal/acceptable-use.md`, `legal/affiliate-terms.md` | Your registered company/legal name (the data controller and contracting party). |
| `[REGISTERED ADDRESS]` | `legal/terms.md`, `legal/privacy.md` (Data Controller block) | Full registered business address. |
| `[CONTACT EMAIL]` | `legal/terms.md`, `legal/faq.md` | General support/contact address (e.g. `support@…`). |
| `[PRIVACY EMAIL]` | `legal/privacy.md` | Address for data-subject requests (access, deletion, portability). |
| `[BILLING EMAIL]` | `legal/refund-policy.md` | Address for billing and refund requests. |
| `[ABUSE EMAIL]` | `legal/acceptable-use.md` | Address to report abuse. |
| `[AFFILIATE EMAIL]` | `legal/affiliate-terms.md` | Address for affiliate-program questions. |
| `[REFUND_WINDOW_DAYS]` | `legal/refund-policy.md` | The number of days a customer has to request a refund (must match what you will honour). |
| `[RESPONSE_DAYS]` | `legal/refund-policy.md` | How many days you commit to respond to a request. |

> The exact set the gate checks is whatever `npm run check:launch` prints — run
> it, and treat its list as authoritative if it ever differs from this table.

> Tip: use role mailboxes (`support@`, `privacy@`, `billing@`, `abuse@`) rather
> than a personal address, so the document does not need editing when staff
> change.

---

## 2. Decisions a lawyer needs to confirm

These are not placeholders, but the documents are only as good as the answers.
Confirm each and adjust the wording if needed:

- [ ] **Governing law & jurisdiction** — which country/state's law applies and
      where disputes are heard.
- [ ] **Consumer rights** — EU/UK 14-day withdrawal right vs. the refund window
      stated in `refund-policy.md`. Digital services can waive the withdrawal
      right under conditions; confirm the wording covers you.
- [ ] **Refund window** — the stated window must match what you will actually
      honour (and Paddle's own policies).
- [ ] **VAT / sales tax** — confirm Paddle acts as merchant of record and handles
      tax, or whether you must register and remit yourself.
- [ ] **Data controller / processor roles** — you are the controller; list every
      **sub-processor** actually used (hosting/Vercel, database/Neon, email/SMTP
      provider, storage/S3 or R2, Paddle, and Sentry/analytics **if enabled**),
      with their locations.
- [ ] **International data transfers** — the legal mechanism (e.g. SCCs) for any
      transfer outside the user's region.
- [ ] **Data retention** — align the privacy policy with `PURGE_AFTER_DAYS`
      (default 30) and the soft-delete window.
- [ ] **Children / minimum age** — state and enforce a minimum age.
- [ ] **Cookie / analytics notice** — required **before** setting
      `ANALYTICS_ENDPOINT`. By default analytics are internal-only (stored in
      `AnalyticsEvent`); forwarding to a vendor is a third-party disclosure.
- [ ] **DMCA / takedown** contact, if the AUP implies user content.
- [ ] **Accessibility statement** (EU/UK EAA, ADA expectations) — optional today,
      increasingly expected.

---

## 3. Product/consent facts to keep honest

Marketing and in-app copy currently label these as "Coming soon"; keep it that
way until they ship, or update the legal docs if that changes:

- Receipt **OCR / scanning** — not built.
- **Family sharing** — not built (the Family plan is hidden until it exists).
- **API access** — not built.
- **Arabic** locale is translated but pending native-speaker review; it falls
  back to English in the UI.

---

## 4. Before enabling optional third parties

- [ ] **Sentry** (`SENTRY_DSN`): events are scrubbed before leaving the process
      (no emails/tokens/nested objects), so no privacy review is required to turn
      it on — but disclose the sub-processor in the privacy policy.
- [ ] **Analytics vendor** (`ANALYTICS_ENDPOINT`): requires a published
      analytics/cookie notice and a lawful basis **before** it is set.
- [ ] **AI phrasing** (`OPENAI_API_KEY`): enabling the optional LLM layer over
      the deterministic answers is a new sub-processor; disclose it and confirm
      the data sent (vehicle facts only).

---

## 5. Done definition

- [ ] Every placeholder in §1 replaced.
- [ ] Every decision in §2 confirmed and reflected in the documents.
- [ ] `npm run check:launch` exits **0** (no remaining legal blockers).
- [ ] Documents published at their live URLs and linked from the footer.
