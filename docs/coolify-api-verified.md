# Coolify API Verified Facts (for AI Agents + coolify-harness)

**Date:** 2026-07-09  
**Version context:** Coolify v4 (openapi from main + v4.x; harness contract pinned to v4.1.2)  
**Purpose:** Single source of truth, AI-agent-efficient reference. Factual extraction only. Use as base for planning log access (app + build), status queries, smart/redundant-deploy avoidance, and high-level primitives.  
**Verification method:** Direct fetches of official OpenAPI (`raw.githubusercontent.com/coollabsio/coolify/.../openapi.json`), coolify-cli source (internal/service/*.go + models), official docs (coolify.io/docs/api-reference/authorization and related), routes, enums, and subagent cross-checks. All claims tied to sources.

## Base + Auth
- Base: `https://{instance}/api/v1`
- Auth: `Authorization: Bearer <token>`
- Key scopes (quoted from docs):
  - `read`: View resources
  - `read:sensitive`: "Everything in read, plus access to passwords, private keys, **environment variables, and logs**"
  - `write`, `deploy`, `root`
- `read:sensitive` required for logs (runtime and deployment logs are treated as sensitive; redacted otherwise).
- All relevant paths require bearerAuth. Rate limit default 200/min.
- API must be enabled in Coolify Settings → Advanced.

Sources: https://coolify.io/docs/api-reference/authorization ; OpenAPI security declarations.

## Application Endpoints (Core for Targets)
| Method | Path | Purpose | Query/Notes | Key Response |
|--------|------|---------|-------------|--------------|
| GET | `/applications` | List apps | `?tag=...` (optional) | `Application[]` |
| GET | `/applications/{uuid}` | Get full app details | - | `Application` (see shape below) |
| GET \| POST | `/applications/{uuid}/start` | Trigger deploy (queues) | `?force=...&instant_deploy=...` | `{ message, deployment_uuid? }` |
| GET \| POST | `/applications/{uuid}/restart` | Restart | - | `{ message, deployment_uuid? }` |
| GET \| POST | `/applications/{uuid}/stop` | Stop | `?docker_cleanup=...` | `{ message }` |
| GET | `/applications/{uuid}/logs` | **Runtime / container logs** | `?lines=N` (default ~100) | `{ "logs": "string" }` |

**Application shape highlights** (selected from schema):
- `uuid`, `name`, `status`, `fqdn`
- Git: `git_repository`, `git_branch`, `git_commit_sha`, `git_full_url`
- `build_pack`
- Many healthcheck_*, limits_*, docker_*, etc.
- `is_auto_deploy_enabled` appears in **create/update request bodies** (type boolean, "The flag to indicate if auto-deploy is enabled on git push. Defaults to true."). **Not present in the documented Application response schema properties.**

**Start/Deploy ack** (applications): `{ "message": "...", "deployment_uuid": "..." }` (optional on some responses).

Also: envs (`/envs`, `/envs/bulk`), storages, previews, scheduled-tasks.

## Deployment Endpoints (Build / History / Logs)
| Method | Path | Purpose | Query/Notes | Key Response |
|--------|------|---------|-------------|--------------|
| GET | `/deployments` | List running/queued | - | `ApplicationDeploymentQueue[]` |
| GET | `/deployments/{uuid}` | Get one deployment (includes logs) | - | `ApplicationDeploymentQueue` (logs embedded) |
| GET | `/deployments/applications/{uuid}` | List deployments for app | `?skip=0&take=10` (pagination) | `{ count?, deployments: [...] }` or array |
| GET \| POST | `/deploy` | General deploy trigger (by uuid/tag) | query or body: `uuid`, `force`, `pr`, etc. | `{ deployments: [{ message, resource_uuid, deployment_uuid }] }` |
| POST | `/deployments/{uuid}/cancel` | Cancel | - | `{ message, deployment_uuid, status }` |

**Deployment / ApplicationDeploymentQueue shape highlights**:
- `deployment_uuid`
- `status` (see enum below)
- `logs` (string, nullable; often structured JSON of log entries)
- `commit`, `commit_message`
- `application_name`, `server_name`
- `created_at`, `updated_at`, `finished_at`
- Other: `pull_request_id`, `is_webhook`, `is_api`, `force_rebuild`, etc.

**How CLI obtains build logs (verified practice)**:
- Latest for app: `GET /deployments/applications/{uuid}` (often with `take=1`), client-side sort (UpdatedAt desc → CreatedAt → ID), take [0], then `GET /deployments/{deployment_uuid}` and read `logs`.
- Specific: direct `GET /deployments/{deployment_uuid}`.
- Formatting (table/json, hidden filter via `--debuglogs`) is client-side.

No dedicated `/deployments/{uuid}/logs` path. Logs are embedded.

## Services (Parallel but not Identical)
- Most paths under `/services/{uuid}` mirror applications for envs, start/stop/restart, storages, get, list.
- Lifecycle triggers in CLI source use **POST** for services (vs GET preferred/also-accepted for apps).
- **No** `/services/{uuid}/logs` documented in the extracted OpenAPI.
- Deployments and detailed build logs are primarily modeled around applications; services may surface via general `/deployments` or embedded resources.
- Use `kind: 'service'` in harness config to route correctly for envs + lifecycle.

## Logs: Runtime vs Build/Deploy
- **Runtime / app logs**: `GET /applications/{uuid}/logs` → live container output.
- **Build / deploy logs**: Embedded `logs` field in a `Deployment` object (from `/deployments/{uuid}` or lists). Contains build steps, commands, output.
- Both require `read:sensitive`.
- Compose apps: logs can be aggregated; no first-class per-container filter in base `/logs` (community discussion exists for improvements).
- Follow/polling: Not native streaming in REST. CLI implements by polling every ~2s and diffing output.
- Failed deploy logs: Known upstream issue in some cases (logs may be undefined or missing).

## Auto-Deploy Behavior
- Flag: `is_auto_deploy_enabled` (sent on create/update; defaults to `true`).
- Trigger mechanism:
  - GitHub App integrations: push events to the configured `git_branch` automatically queue a deployment (when enabled).
  - Other providers: Deploy Webhook URL (resource → Webhooks in UI) called from CI or git hooks. Token with `deploy` scope.
- Configured per application/resource + its `git_branch`.
- Manual deploy via API (`/start` or `/deploy`) is still valid and useful even when auto-deploy is on (e.g., force, different branch, env changes).
- Implication for agents: Before calling deploy, it is often useful to inspect the app (`GET /applications/{uuid}` for branch + any settings exposure) + recent deployments (to see last commit/status) + decide based on context. Blind redeploys can be redundant.

## Status Values (Verified)
**Deployment statuses** (from `ApplicationDeploymentStatus` enum):
- `queued`
- `in_progress`
- `finished`
- `failed`
- `cancelled-by-user`

**Application status**: String field on Application (examples from ecosystem: running, stopped, error, starting, etc.). Not a closed enum in the extracted schema. Container health separate.

## Other Useful
- General deploy ack often returns `deployment_uuid` that can be used immediately for status/log polling.
- `GET /applications/{uuid}` after changes or to read current `git_commit_sha`, `status`, `fqdn`, health config, etc.
- Webhook notifications (outbound): Deployment Success, Deployment Failure, Container Status Changes (configured separately).
- No delete of compose-locked things via API in the same way as envs (env safety lessons still apply).

## Current coolify-harness Surface (Summary)
- **v0.2.0**: includes live status/logs/deploy observability + all minor review fixes (typed timeout error, --json cleanliness for deploy/wait/logs, consistent scopes for status latest, dynamic singular/plural error msgs, deadcode removal, DEFAULT_LATEST_TAKE, CHANGELOG, docs).
- Strong: env read/diff/apply (bulk), catalog from Zod, explicit deploy/restart + --wait, safety/audit/dry-run, typed errors (incl. `CoolifyWaitTimeoutError`), contract validation (Zod passthrough), multi-instance config.
- Client methods: `listEnvs`, `upsertEnvs`, `deploy`, `restart`, plus full read surface:
  `get()`, `getRuntimeLogs(lines?)`, `listDeployments({skip,take})`, `getDeployment(uuid)`, `getLatestDeployment()`, `getLatestBuildLogs()`, `waitForDeployment(uuid)`.
- Deploy acks return `deployment_uuid` that is immediately usable with the new `deployment`, `logs --build`, and `wait` primitives.
- `--json` everywhere for agents (structured output e.g. for `deploy --wait --json` includes finalStatus/finalDeployment); human summaries only in non-JSON mode.
- Scope: `read:sensitive` required (and enforced via `withScope`) for logs and deployment records. `status` uses `read` for metadata + `read:sensitive` (non-fatal) for latest.
- **Services**: `get()` works (passthrough), runtime logs throw clear `CoolifyFeatureNotSupportedError`, deployments fall back to the general list (unfiltered).

## Recommended Agent-Friendly Additions (High-Level, for Planning)
- Read primitives first (library + CLI + --json):
  - `getApp(uuid)` or via target
  - `getRuntimeLogs(lines?)`
  - `listDeployments(appUuid, opts?)`
  - `getDeployment(deploymentUuid)`
  - `getLatestBuildLogs(appUuid)` (convenience wrapping list + get)
- Status helpers: current status, last deployment summary, isDeployInProgress.
- Deploy ergonomics: return the deployment id; optional wait/poll helper; note on auto-deploy.
- Scope documentation update (call out `read:sensitive` for logs).
- Handle GET vs POST nuance for start (support both or match CLI).
- Pagination and line limits for logs/deployments.
- Distinguish build logs vs runtime clearly in naming and docs.

## Quirks / Limitations (Verified)
- Logs can be empty/undefined on certain failed deployments.
- Compose multi-service log aggregation.
- `is_auto_deploy_enabled` is input-only in the schema (may be readable via UI or other means; verify per instance).
- No built-in log streaming (polling required for "follow").
- Deployment list pagination is skip/take; sorting for "latest" often client-side.
- Services have reduced observability surface compared to applications in current models.
- Token team scoping: tokens are team-bound.

## References (Primary)
- OpenAPI: https://raw.githubusercontent.com/coollabsio/coolify/main/openapi.json (and v4.x)
- coolify-cli services (authoritative paths): `internal/service/application.go`, `deployment.go`
- Docs:
  - Authorization & scopes: https://coolify.io/docs/api-reference/authorization
  - Applications & auto-deploy: https://coolify.io/docs/applications (and /ci-cd/github/auto-deploy)
  - Notifications/webhooks: https://coolify.io/docs/knowledge-base/notifications
- Source (for enums/routes): coollabsio/coolify repo (routes/api.php, Enums/ApplicationDeploymentStatus.php, ApplicationsController)
- Issues for real behavior (e.g. logs on failure): https://github.com/coollabsio/coolify/issues/5900 etc.

**Next session use**: Treat every claim here as the verified baseline (post 0.2.0 review fixes applied in harness). Re-verify OpenAPI/CLI on major Coolify upgrades. Extend harness client with new methods + schemas + fixtures + tests modeled on existing (envs/deploy acks). Consult CHANGELOG.md + verified.md for current surface.

This document is intentionally concise, tabular, and quote-heavy for efficient context loading by agents.