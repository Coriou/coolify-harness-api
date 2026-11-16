# Coolify 4.7.5 fixtures

Recorded on 2026-11-16 from a live Coolify **4.7.5** instance with read-only `GET` requests, then
sanitised: every key, JSON type, `null` and boolean is exactly what Coolify sent; every string is
replaced by a synthetic value (`fake-<key>`, `fixture-…`, `example.com`, TEST-NET addresses), ids
are `1`, and compose / proxy documents are small synthetic documents with planted fake secrets
that the redaction tests look for.

| File | Endpoint |
|---|---|
| `application.json` | `GET /applications/{uuid}` (docker-compose build pack) |
| `application-envs.json` | `GET /applications/{uuid}/envs` — includes rows with `value: null` |
| `service.json`, `service-envs.json` | `GET /services/{uuid}`, `…/envs` |
| `servers.json`, `server.json` | `GET /servers`, `GET /servers/{uuid}` |
| `server-resources.json`, `server-domains.json`, `server-proxy.json` | `GET /servers/{uuid}/resources`, `/domains`, `/proxy` |
| `databases.json`, `database.json`, `database-envs.json` | `GET /databases`, `GET /databases/{uuid}`, `…/envs` |
| `deployments-for-app.json` | `GET /deployments/applications/{uuid}?take=2` (`{ count, deployments }`) |
| `deployment.json` | `GET /deployments/{uuid}` (finished, with the embedded `application`) |
| `deployments-running.json` | `GET /deployments` (nothing queued at recording time) |
| `runtime-logs.json` | `GET /applications/{uuid}/logs?lines=3` |

Not recordings, built by hand in the same shape:

- `deployment-queued.json` — a list row turned into a queued one (the nullable columns Coolify
  leaves `null` until the build starts).
- `envs-compose-blank.json` — the `value: null` case that broke 0.4.0, with a preview twin and an
  empty-string row.
- `envs-locked.json` — a locked (`is_shown_once`) row: Coolify omits `value` / `real_value` for it
  whatever the token can read.

No database on the recorded instances has a scheduled backup, so the backup payloads are still
covered by the 4.5 fixtures only (the handlers did not change between 4.5.0 and 4.7.5).
