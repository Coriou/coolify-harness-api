# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2026-11-16

Verified against **Coolify 4.7.5** (latest stable; two live instances, read-only). Tested range:
**4.5.0 – 4.7.5**. What changed in Coolify and what the API still cannot do:
`docs/coolify-api-coverage.md`.

### Upgrading from 0.4.x

No config change is needed, and no command or flag was removed. Check these:

- **`env delete` on Coolify ≥ 4.7 needs a token with the `delete` ability** (a Coolify change).
- **`config doctor` now calls Coolify** (`GET /version`) and exits non-zero when a token is set
  but rejected (5), the instance cannot be reached or is not a Coolify (1), or no token is set at
  all (5). `--offline` keeps the old local-only check and its exit codes.
- **`--from-file` strips the quotes around a value.** The first `env diff --from-file` after
  upgrading lists the keys 0.4 wrote *with* their quotes as updates; applying fixes them.
- **Variable names are validated** (letters, digits, `_`, `.`): a bad name is exit 2 before any
  request, instead of a half-applied write.
- `compose get` / `compose set` need `read:sensitive` (they printed an empty document without it),
  and so does `env delete` on a service or a docker-compose application (it reads the compose to
  check the key is not referenced; `--force` skips the check).
- `database set --public true` on a database that has no port stored is exit 2: add `--public-port`.
- `compose set`, `proxy set`, `database set` `--json`: `confirmed` may be `null` (the re-read failed).
- `env diff --json` / `env apply --json`: every `value` is redacted (they were printed in clear).
- If you parse `env apply --json` / `flag set --json`: it is now ONE document (plan + `dryRun`,
  `applied`, `confirmed`); it used to be JSON followed by prose.
- Library: invalid input raises `InvalidInputError`, not a `ZodError`; `DEFAULT_LATEST_TAKE` is 1.

### Security
- **`env diff --json` and `env apply --json` printed env values in clear**: the desired values
  (`creates[].value`, `updates[].value`) and, on a key with duplicate rows, the LIVE values
  (`duplicateKeyDrift[].values`). Every value in a plan is now `[REDACTED] (N chars)`. Human
  output was never affected.
- **Redaction bypasses closed.** A compose with Windows line endings (CRLF) was not redacted at
  all. Also now covered: quoted keys and JSON-style compose, flow mappings, a list at the indent
  of `environment:`, anchors, values spanning lines (block scalars with indicators, a value on the
  next line, multi-line quoted scalars), PEM blocks, every value under `environment:` whatever the
  key case, `command:` / `entrypoint:` / `test:` and Dockerfile `RUN` / `ENV` / `ARG` (flags such as
  `--requirepass x`, `-a x`, `-pSECRET`, `-u user:pass`, header values, `export token=…`),
  `requirepass` / `http_Passwd` style directives in `*_conf` documents, Traefik / Caddy auth
  labels, URL passwords after an empty user or containing `@`, `?password=` query parameters,
  token-only URLs, `Bearer` tokens in Coolify's own format, and everything nested under a
  sensitive key. The compose diff redacts each document as a whole.
- The API token can no longer reach an error message: a token with a line break is refused
  without being quoted, and the runtime's own message is scrubbed.
- Redirects are not followed, so a token or a request body never travels to another address.
- A `--set` argument without `=`, a stray argument, an invalid variable name and a malformed
  dotenv line are described in errors, never quoted (they are often a secret out of place).
- Server error messages are sanitised before they reach stderr or the audit log: anything that
  repeats a value or a line of a document sent in the request, URL credentials and tokens.
- `--out FILE` refuses to write through a symlink and sets mode 0600 before writing; the audit
  log is 0600 (also when an older version created it).
- The config refuses an instance URL with credentials and a `tokenEnv` that is not a variable name.

### Fixed
- **`flag set --redeploy` without `--apply` triggered a real deploy** after its dry-run.
- **Mutations were retried after a lost answer.** A network error or 5xx on `POST …/start`,
  `…/restart`, a cancel, a delete or a proxy save was replayed up to 3 times, which could queue a
  second deployment. Only reads, the env bulk upsert, the service compose save and 429 answers are
  retried now.
- **A mutation that landed could be reported as failed**: an acknowledgement in an unexpected
  JSON shape (creating a key on a service or database answers a row without its flags), an
  acknowledgement whose body was lost, or a failing confirmation read after `compose set` /
  `proxy set` / `database set`. The write is now reported as done, "not confirmed" when the
  re-read failed, and `--restart` still runs. A 2xx that is not JSON at all (a login page) stays
  an error.
- **`deploy --wait` returned at once (exit 0) when Coolify skipped the request** because the same
  commit was already queued or building. It now follows that production deployment (preview
  deployments are ignored), and fails if it cannot look.
- **`deploy --wait` gave up after ~6 s of Coolify being unreachable** (and again after 20 s once
  the circuit breaker opened). It rides out 5 failed polls, does not count polls refused by the
  open breaker, treats a 404 as fatal only before the deployment was first seen, stops at once on
  other 4xx answers, and never runs past its timeout.
- **No request timeout**: a hung connection hung the command forever. Every attempt has a 30 s
  timeout, and a `Retry-After` longer than 30 s is reported instead of slept through.
- **`status` downloaded 20 build logs** (megabytes) to show one deployment: it now asks for one
  row, in parallel with the resource. `logs --build` reuses that row.
- `status` hid any error on the latest deployment behind "(none found)"; it now says why
  (`latestDeploymentError` in the JSON).
- `env apply --json` printed the plan followed by prose; `flag set --json --redeploy` printed two
  documents; `env delete --apply --json` printed its document before deleting.
- **`--preview` on a service or database wrote the production row** (Coolify drops `is_preview`
  there). It is refused before any request.
- **A locked ("shown once") variable made `env diff` / `env apply` fail** with a misleading
  "token lacks read:sensitive". Locked rows are listed as `len=locked` and rewritten with a warning.
- `env diff` never came back clean for a key with duplicate rows that all held the desired value,
  nor for a single-line value with leading or trailing whitespace (Coolify trims it on save).
- An env update on Coolify 4.5 reset `is_literal` / `is_multiline` / the lock; the flags a row has
  set are now sent back with the update.
- One invalid variable name in a bulk write left the keys before it written and the command
  reported as failed. Names are validated before anything is sent.
- A dotenv value in quotes was written to Coolify **with its quotes**. `--from-file` now removes
  matching quotes (also after `KEY = `), expands `\n` / `\r` in double quotes and reads multi-line
  quoted values. Unquoted values are unchanged; an unterminated quote is an error.
- `compose get` / `compose set` / the `env delete` lock check treated a compose Coolify withheld
  (no `read:sensitive`) as an empty one; they now fail with exit 5.
- `database set --public true` flipped the column without opening the port: Coolify needs
  `is_public` and `public_port` in one request. A port change on an already-public database now
  comes with a note (Coolify does not move the proxy).
- `env delete` with several keys said nothing about the rows deleted before a failure.
- A failing audit log (read-only checkout, full disk) turned a successful mutation into an error;
  a closed pipe (`… | head`) killed a command mid-mutation with exit 0.
- A missing config file, an unreadable `--from-file`, and `--app --json` (a flag swallowed as a
  value) are usage/config errors (exit 2) with a clear message, not raw runtime errors.
- 403 errors show Coolify's own reason (`Missing required permissions: delete`, a token limited to
  some projects); network failures say which host and why; contract errors name the failing
  fields and types.
- pnpm refused to install the package from git (`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`) and Bun
  skipped its `prepare` script: the script is gone, `dist/` is committed and checked in CI.
- The `coolify-harness` bin had no shebang: under Bun it was run by the shell.

### Added
- **Coolify 4.7.5 contract**: `env delete` asks for the new `delete` token ability; fixtures in
  `test/fixtures/coolify/v4.7/`; `proxy_error_page`, `is_buildtime` / `is_runtime` / `comment` on
  env writes (library).
- **Compatibility check**: `TESTED_COOLIFY`, `coolifyCompatibility()`, `compatibilityWarning()`.
  `instance info` and `config doctor` warn (never fail) when the live Coolify is outside the
  tested range; `coolify-harness --version` prints the harness version and the range.
- `config doctor` checks every instance that has a token (`GET /version`): reachability, token,
  version. `--offline`, `--json`, `--instance`.
- With `--json`, a failure is one JSON document on stderr:
  `{ "error": { "code", "message", "exitCode", … } }`, for every non-zero exit; `help` and
  `catalog gen` / `catalog check` honour `--json` too.
- `--token-file FILE`: read the API token(s) from a dotenv file (a variable set in the
  environment wins; a missing file is not an error), so
  `"coolify": "coolify-harness --token-file .env"` is the whole wrapper script.
- `deploy --dry-run`; `env diff --fail-on-changes` (exit 4 when anything would be written);
  `--no-logs` on `status`, `deployments`, `deployment`, `deploy --wait` (`logs_length` instead of
  the build log).
- `env apply --json`: `dryRun`, `applied`, `confirmed`, `confirmError`. `env delete --json`:
  `deleted`, `confirmed`.
- Catalog: **zod 4 and zod mini schemas** (a zod 4 schema used to throw "not a ZodObject"), next
  to zod 3, whose output is unchanged. `SchemaInput.schema` accepts any of them.
- Config: `coolify-harness.config.{mts,mjs,js}` are found automatically; clearer validation errors.
- `waitForDeployment`: `signal` (abort), `maxIntervalMs`; Ctrl-C during `deploy --wait` prints how
  to follow or cancel the deployment (exit 130).
- Unknown commands suggest the nearest one.
- Library: `CoolifyNetworkError`, `UsageError`, `InvalidInputError`, `EnvChangesPendingError`,
  `isLockedRow`, `findConfigFile`, `redactCommandLine`, `redactUrlCredentials`, the `EnvVar` /
  `EnvWriteItem` / `EnvWriteResult` types, `CoolifyClientDeps.timeoutMs` / `maxRetryDelayMs`.
- Onboarding: README rewritten (install from GitHub with pnpm or Bun, 5-minute quick start, "For
  AI agents", troubleshooting, compatibility table), `CONTRIBUTING.md`, `SECURITY.md`, issue
  template, GitHub releases.

### Changed
- **zod 4** internally (was zod 3), loaded only while a request is in flight: `help` and usage
  errors no longer load it at all. The config is validated without zod.
- `config doctor` contacts Coolify and its exit code reflects what it found (see Upgrading).
- `catalog check` on stale artifacts and `catalog gen` on a schema that is not an object are
  typed errors (exit 3 and exit 2; the second was exit 1).
- `DEFAULT_LATEST_TAKE` is 1 (was 20) and `getLatestDeployment()` returns the newest deployment by
  creation time.
- HTTP defaults: first retry after 250 ms (was 50 ms); `deploy --wait` polls every 2 s growing to
  5 s (a fixed `intervalMs` is honoured as before); 5 consecutive poll failures tolerated (was 3).
- Requests send `Accept: application/json` and `User-Agent: coolify-harness/<version>`; redirects
  are not followed.
- An env update carries `is_literal` / `is_multiline` / `is_shown_once` when the existing row has
  them set (visible in the plan JSON).
- `--take 0` is a usage error (Coolify requires at least 1).
- Toolchain: pnpm 12, TypeScript 6, vitest 5, ESLint 10 + typescript-eslint, zod 4. CI runs on
  Node 24 and 26. No `prepare` script; `prepublishOnly` runs the checks.
- `docs/coolify-4.5-api-coverage.md` is now `docs/coolify-api-coverage.md` (pinned to 4.7.5).

[0.5.0]: https://github.com/Coriou/coolify-harness-api/compare/v0.4.1...v0.5.0

## [0.4.1] - 2026-11-16

Verified against **Coolify 4.7.5** (env commands; two live instances, read-only).

### Fixed
- **`env list` / `env diff` / `env apply` / `env delete` failed with `Coolify response (listEnvs)
  failed contract validation` on Coolify 4.7.** Coolify 4.7.5 stores a compose-declared blank
  variable (`${VAR:-}`) with no value and serialises `value: null` (also `real_value: null`,
  `order: null`); the read schema only accepted a string or an absent key. `value` is now
  `nullish`: a null value reads as `''` and the row carries `value_null: true`.
  - A null value is **not** a withheld one. `value_hidden` still means only "the token lacks
    `read:sensitive`" (key absent); `env diff` / `env apply` are refused (exit 5) for withheld
    values only.
  - A null row compares equal to an empty desired value: `KEY=` in `--from-file` / `--set KEY=`
    against a null row is `unchanged`, never an update, and a null row next to an empty-string row
    of the same key and scope is not duplicate-key drift.
  - `env list` prints `len=0 (null)` and `--json` rows gain `value_null` (boolean, additive);
    `value_length` stays `null` for withheld values only.

### Added
- `EnvVar.value_null` (optional in the type, always set by the parser).
- `test/fixtures/coolify/v4.7/envs-compose-blank.json`: synthetic, 4.7.5-shaped env payload.

[0.4.1]: https://github.com/Coriou/coolify-harness-api/compare/v0.4.0...v0.4.1

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
- **`env apply` reported "confirmation mismatch" and `env diff` never converged for keys with
  both a production and a preview row** (seen live on 4.5.0). Coolify's bulk write touches one
  scope only (no `is_preview` → production), but planning and confirmation merged both scopes.
  Plans are now scoped (`DesiredEnv.scope`, default `production`; CLI `--preview`), confirmation
  checks every row of the key in that scope, and a differing other-scope row is reported as
  `otherScope` / "not written", not as a pending update. Same-scope duplicates now warn
  correctly that Coolify updates only one of the rows.
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
