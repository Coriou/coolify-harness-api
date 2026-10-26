# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] - 2026-10-26

Verified against **Coolify 4.5.0** (two live instances, read-only). Endpoint coverage, scopes and
the operations the API does not expose: `docs/coolify-4.5-api-coverage.md`.

### Fixed
- **`status` failed contract validation on every application (since 4.3.16).** Coolify sends unset
  columns as `null` (`git_full_url`, `health_check_port`); response schemas now use `.nullish()`.
- **`deploy --wait` and `deployment <uuid>` failed on in-flight deployments.** A queued row has
  `commit_message`, `finished_at`, `server_name`, … = `null`. Deployment `status` is now a plain
  string (`DEPLOYMENT_STATUSES` / `isTerminalDeploymentStatus` exported) so an upstream enum
  addition cannot abort a wait.
- `/version` and `/health` return plain text; the transport no longer throws on non-JSON bodies.
- Env listing with a token lacking `read:sensitive` (Coolify omits `value`) no longer fails the
  contract; `env diff`/`env apply` exit 5 with a clear scope message instead.
- CLI parsing: `--flag=value`, `env-diff` / `env:diff` spellings, flags before the command,
  `help` / `--help`.

### Added
- `deploy --force` (no-cache rebuild, `POST /applications/{uuid}/start?force=true`),
  `deploy --restart --latest` (services pull images), `deploy --wait --timeout SEC` with status
  transitions; exit **7** when the deployment fails/cancels, **8** on wait timeout.
- `env list` (never values) and `env delete` (dry-run; refuses compose-locked / Coolify-managed
  keys with exit 6 unless `--force`).
- `compose get` / `compose set` for services (`--image svc=ref` or `--from-file`, redacted diff,
  read-back confirmation, `--restart` with `latest=true`).
- `instance info` (`version`), `servers`, `server get`, `proxy get` / `proxy set` /
  `proxy restart` — `proxy set --image traefik:vX --apply --restart` changes the Traefik version
  through the API (`PUT /servers/{uuid}/proxy/configuration` + restart).
- `databases`, `database get` / `set` (`--public`, `--public-port`, `--image`) / `backups` /
  `backup` (run a schedule now); targets may now be `kind: 'database'`.
- `deployments --instance` (team queue), `deployment … --instance`, `deployment cancel`.
- `logs --service` (services' sub-containers via `/services/{uuid}/logs`, compose apps'
  `service_name` filter) and `--timestamps`; database runtime logs.
- `server patch`, `server reboot`, `instance upgrade`: explicit exit 2 explaining that the Coolify
  API has no such endpoint and where in the dashboard to do it. No SSH / DB workarounds.
- Library: `CoolifyInstanceClient`, `client.instance()`, `deleteEnv`, `getService`,
  `getDatabase`, `updateServiceCompose`, `cancelDeployment`, `deploy({ force })`,
  `restart({ latest })`, `resolveInstance`, `redactDeep` / `redactDocument`, compose image helpers,
  `CoolifyRequestError` (carries Coolify's message and 422 field names).
- Output redaction everywhere: webhook secrets, sentinel token, basic-auth hashes, URL passwords,
  literal env values in compose documents. `status --json` previously printed them verbatim.
- Audit records cover every new mutation (`env.delete`, `compose.update`, `proxy.*`,
  `database.*`, `deployment.cancel`) with keys and non-secret options only, including failures.

### Changed
- `listDeployments()` for services and databases returns `[]` (they never create deployment rows)
  instead of the team-wide running list.
- `waitForDeployment` default timeout 5 → 10 minutes; tolerates up to 3 consecutive transient poll
  errors (auth / 404 / contract errors stay fatal).
- `CoolifyWaitTimeoutError` exits **8** (was 1); `ConfigError` exits 2 and a missing token 5 (were 1).
- `getRuntimeLogs` on a service no longer throws "not supported"; it needs a sub-service name and
  lists the valid ones when missing.

[0.4.0]: https://github.com/Coriou/coolify-harness-api/compare/v0.3.0...v0.4.0

## [0.3.0] - 2026-07-15

> Minor bump (not patch) under 0.x semver: the write-surface fix removes the never-valid
> `is_build_time` field from the `EnvWriteItemSchema` / `EnvFlags` public types (see below), a
> compile-only breaking change for the narrow case of code that set build-time on a write.

### Fixed

- **Env reads no longer break on newer Coolify (`is_build_time` → `is_buildtime`).** Coolify
  >= 4.0.0-beta.463 renamed the build-time flag on env responses (and added `is_runtime`), which
  made `EnvVarSchema` fail contract validation, breaking `env diff` / `env apply`. The read schema
  now accepts either spelling and normalizes onto a canonical, always-present `is_build_time`
  (older instances keep working). The raw field is retained via passthrough. (coollabsio/coolify
  read model rename; consumer repos previously patched or worked around this.)
- **Env writes only ever send fields the API accepts.** The current Coolify write API
  (`POST`/`PATCH .../envs` and `.../envs/bulk`) accepts only `key`, `value`, `is_preview`,
  `is_literal`, `is_multiline`, `is_shown_once` and rejects anything else with HTTP 422
  ("This field is not allowed.", coollabsio/coolify#6847) — there is no build-time field on the
  write path in any Coolify version. `is_build_time` has been removed from `EnvWriteItemSchema`
  and `EnvFlags`, and `upsertEnvs` now Zod-validates the outgoing bulk body (fulfilling the
  design's "validate the request" contract) so a stray non-writable field can never reach the wire.
- **CLI bin-entry guard now fires under pnpm symlinks + tsx.** The entry check
  (`import.meta.url === file://${process.argv[1]}`) never matched when the bin was invoked through
  a `node_modules/.bin` symlink, so every command silently no-opped and exited 0. Replaced with
  an exported, unit-tested `isMainModule()` predicate that realpath-resolves both sides.
- **Duplicate-key drift detector no longer false-positives on prod/preview pairs.** Drift identity
  now includes `is_preview`, so a production row and a preview row that share a key with different
  values are not flagged as drift. True same-scope duplicates are still detected.

### Notes

- Verified against the Coolify OpenAPI (`coollabsio/coolify` main) — env read model
  (`EnvironmentVariable`) vs. env write request bodies — and issue #6847.
- **BREAKING (types only):** the never-valid `is_build_time` field was removed from the write
  surface (`EnvWriteItemSchema` / `EnvFlags`). This only affects code that constructs a write item
  or flags object literal explicitly typed as those and sets `is_build_time` — such code was
  already getting a runtime 422 from Coolify. The CLI never sent it and no known consumer sets it.
- Git tag: `v0.3.0`

[0.3.0]: https://github.com/Coriou/coolify-harness-api/compare/v0.2.0...v0.3.0

## [0.2.0] - 2026-07-09

### Added
- Agent-friendly live observability for Coolify apps/services:
  - CLI: `status`, `logs` (build/runtime), `deployments`, `deployment <uuid>`, `deploy --wait`
  - Library surface: `CoolifyClient.get()`, `getRuntimeLogs()`, `listDeployments()`, `getDeployment()`, `getLatestDeployment()`, `getLatestBuildLogs()`, `waitForDeployment()`
  - Full `--json` structured output (first-class for agents/MCP); human prose only when not `--json`
  - `read:sensitive` scope enforced for logs + deployment data
  - Service targets: get() works; logs throw `CoolifyFeatureNotSupportedError`; deployments fall back gracefully
- `CoolifyWaitTimeoutError` (extends `CoolifyHarnessError`) for typed timeout handling on wait
- `DEFAULT_LATEST_TAKE` const exported from client for the latest-deployment list size
- `CHANGELOG.md`

### Fixed / Improved (per deep review of 0.1+feat)
- Status latestDeployment now attempts `read:sensitive` (consistent with logs/deployments/wait paths; non-fatal)
- `deployments`/`deployment` error message now dynamic based on singular vs plural command
- Eliminated prose/stdout writes on `--json` for `deploy` (ack + `--wait` case now emits clean JSON with `finalStatus` + `finalDeployment`) and ensured logs paths
- Wait timeout now throws typed `CoolifyWaitTimeoutError` (not plain Error); mapped in CLI exit codes; tests updated
- Removed dead no-op if-block/comment in logs command
- Improved comment for service fallback in `listDeployments()`
- Updated error taxonomy tests, CLI error mapping tests, wait tests
- Scope table / docs refreshed for status + new features

### Notes
- Version bump 0.1.0 → 0.2.0 (first feature release with observability)
- See `README.md` (scope table, examples) and `docs/coolify-api-verified.md`
- All changes additive; strict Zod passthrough, injected deps, thin CLI preserved
- Git tag: `v0.2.0`

[0.2.0]: https://github.com/Coriou/coolify-harness-api/compare/v0.1.0...v0.2.0
