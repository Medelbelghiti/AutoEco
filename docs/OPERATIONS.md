# Operations

Operational notes for running AutoEco in production.

## `GET /api/health`

Liveness + configuration readiness probe. Safe to hit from uptime monitors.

- **Healthy** (database reachable and schema matches the code): `200`.
- **Unhealthy** (database unreachable, or a required `information_schema`
  column is missing): `503`.
- **Degraded** (email transport, Paddle credentials, cron secret, storage not
  configured): still `200` — the app serves requests fine; the missing
  dependency is listed in the detailed report.

### Access

By default the endpoint is anonymous and returns **only** a single boolean so
that public monitors cannot use it for reconnaissance:

```json
{ "ok": true }
```

`{ "ok": false }` is returned with `503` when unhealthy.

The full per-dependency report is available to callers that present the shared
secret:

```
Authorization: Bearer <HEALTH_SECRET>
```

The detailed report includes `status`, `checks`, `degraded`, and — with
`?verbose=1` — the production configuration warnings.

`HEALTH_SECRET` is **optional**:

- **Set it** to allow your own tooling (and only your tooling) to see the
  detailed report. Generate a value with:

  ```sh
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

- **Leave it unset** to disable the detailed view for everyone. Anonymous
  callers still get `{ "ok": boolean }`.

The secret is compared in constant time and is never written to logs or echoed
in any response. Rotating it (or removing it) takes effect immediately — no
restart required.

### What is never disclosed

Even the authorized report contains no secret values, no connection strings, no
database hostnames, and no object-storage bucket name or endpoint host. The
storage check reports *which configuration keys are missing*, not their values.

### Performance

Each dependency probe is bounded by a short timeout (~2s) and the database
round trips run concurrently, so a single slow query cannot hold the request
open.
