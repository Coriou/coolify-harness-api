# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.2.0]: https://github.com/.../compare/v0.1.0...v0.2.0
