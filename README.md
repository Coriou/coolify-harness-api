# coolify-harness

Pinned Coolify API contract version: v4.1.2

> **Important:** Coolify API contract is pinned to v4.1.2. If you upgrade Coolify, re-record the HTTP fixtures (`test/fixtures/`) and re-run the live-smoke against your new instance before releasing a new version.

A standalone ESM TypeScript library and thin CLI for:

- **Env-flag catalog generation** — walk live Zod schemas, emit Markdown + JSON + `.env.example` artifacts, gate CI on freshness.
- **Safe Coolify env var management** — read, diff, and bulk-upsert env vars on Coolify v4 applications and services via the Coolify API, with dry-run-by-default discipline, audit logging (keys only, never values), and optional redeploy trigger.
- **Live status, logs & deployment observability** — `status`, runtime & build `logs`, `deployments` history, single `deployment` details, and `wait` polling. All read-only, agent-first via `--json`, fully typed on the library `CoolifyClient`.

---

## Requirements

- **Node.js** >= 24
- **pnpm** >= 10
- **ESM only** (`"type": "module"`)
- **Zod** 3.24+ / 3.25 (peer dependency)

---

## Install

```bash
pnpm add -D coolify-harness
```

---

## Config file

Create `coolify-harness.config.ts` at the root of your project:

```ts
import { defineConfig } from 'coolify-harness/config';
import type { SchemaInput } from 'coolify-harness/catalog';
import { MyAppEnvSchema } from './src/env.js';

// Default export — instance + target registry
export default defineConfig({
  instances: {
    prod: {
      url: 'https://coolify.example.com',
      // tokenEnv holds the NAME of the env var that contains the API token.
      // Never put the token value here.
      tokenEnv: 'COOLIFY_PROD_TOKEN',
    },
  },
  targets: {
    'my-app': {
      instance: 'prod',
      kind: 'application',  // 'application' | 'service'
      uuid: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    },
  },
});

// Named export — catalog schema configuration
export const catalog = {
  schemas: [
    { service: 'MyApp', schema: MyAppEnvSchema },
  ] satisfies SchemaInput[],
  out: {
    markdown: 'docs/env-catalog.md',
    json: 'docs/env-catalog.json',
    dotenvExample: '.env.example',
  },
};
```

- `instances` — one entry per Coolify instance. `tokenEnv` is the name of an environment variable that holds the API token at runtime; the secret is never stored in the config file.
- `targets` — one entry per Coolify application or service. `kind` must match the Coolify resource type (`application` or `service`); `uuid` comes from the Coolify UI.

---

## Catalog flow

### Generate

```bash
# Writes docs/env-catalog.md, docs/env-catalog.json, .env.example
coolify-harness catalog gen [--config coolify-harness.config.ts]
```

Walks all Zod schemas listed in `catalog.schemas`, merges entries, and emits the configured output files.

### Check (CI gate)

```bash
# Exits 0 if artifacts are fresh, exits 3 if stale
coolify-harness catalog check [--config coolify-harness.config.ts]
```

Add this to CI after `pnpm build`. Exit code 3 means the catalog is out of date; regenerate with `catalog gen` and commit the updated artifacts.

---

## Env / deploy flow

### Read and diff

```bash
# Shows a diff between your desired env (from --from-file and/or --set) and what Coolify has live
coolify-harness env diff --app my-app [--from-file .env] [--set KEY=VALUE] [--json] [--fail-on-drift]
```

- `env diff` is **read-only**. It never writes anything.
- `--from-file <path>` loads a `.env` file as the desired base.
- `--set K=V` overrides individual keys (applied on top of `--from-file`).
- `--fail-on-drift` causes exit 4 if any drift is detected.
- `--json` emits machine-readable JSON output.

### Apply (write env vars)

```bash
# Dry-run by default — shows what would change, writes nothing
coolify-harness env apply --app my-app [--from-file .env] [--set KEY=VALUE] [--json]

# Actually write (upsert-by-key, atomic bulk)
coolify-harness env apply --app my-app --from-file .env --apply [--yes]
```

- **Dry-run is the default.** Without `--apply`, `env apply` prints what it would do and exits 0.
- `--apply` performs the actual bulk upsert. Coolify variables are upserted by key — existing keys are updated, missing keys are inserted. Keys that exist in Coolify but are absent from your desired set are left untouched (no deletes).
- `--yes` skips the confirmation prompt (useful for CI).
- Every mutation is audit-logged to `.coolify-harness/audit.jsonl` — keys only, never values.
- After `--apply`, the tool re-reads to confirm the write landed. A confirmation mismatch is reported on stdout but still exits 0 (the write itself succeeded) — CI should check the audit log or output if strict confirmation is required.

### Safe-write discipline

```
env diff        (read-only, always safe)
  ↓
env apply       (dry-run by default; --apply to write)
  ↓
deploy          (EXPLICIT separate step — env changes are inert until redeploy)
```

Coolify does **not** auto-redeploy on env change. You must explicitly trigger a redeploy.

### Redeploy / restart

```bash
# Trigger a redeploy (application) or restart (service)
coolify-harness deploy --app my-app [--restart] [--json]
```

- `deploy` without `--restart` triggers a full redeploy (applications).
- `--restart` triggers a service restart instead.

### Live status, logs, and deployment history (read-only)

These commands are **read-only** and designed for agents and humans to inspect state without side effects. Use `--json` for clean machine output.

```bash
# Current resource details + latest deployment summary
coolify-harness status --app my-app [--json]

# Runtime (container) logs — requires read:sensitive
coolify-harness logs --app my-app [--lines 200] [--json]

# Build / deploy logs from the latest (or specific) deployment
coolify-harness logs --app my-app --build [--deployment DEPLOY_UUID] [--json]

# Recent deployments (build history)
coolify-harness deployments --app my-app [--take 5] [--skip 0] [--json]

# Full details + logs for one deployment
coolify-harness deployment DEPLOY_UUID --app my-app [--json]

# Deploy and wait for completion (still audit-logs the deploy action)
coolify-harness deploy --app my-app --wait [--json]
```

**Important notes for agents:**
- Always prefer `--json` — it emits only the object/array (no extra prose).
- `status` + `getLatestDeployment` (via library) lets agents avoid redundant deploys by comparing `git_commit_sha`.
- `logs --build` and `deployment <uuid>` surface the embedded build logs.
- `deploy --wait` is a convenience; the ack still returns immediately and the wait is polled client-side.
- Runtime logs and any deployment record access require the `read:sensitive` scope.

**Library usage (for MCP adapters, direct import, or advanced scripts):**

```ts
import { CoolifyClient } from 'coolify-harness/client';

const client = new CoolifyClient(target, { fetchImpl: globalThis.fetch, logger: myLogger });

const app = await client.get();                    // status + git info + fqdn etc.
const runtime = await client.getRuntimeLogs(100);  // { logs: string }
const deploys = await client.listDeployments({ take: 5 });
const latest = await client.getLatestDeployment();
const buildLogs = await client.getLatestBuildLogs();
const full = await client.getDeployment(deployUuid);
const final = await client.waitForDeployment(deployUuid, { timeoutMs: 300_000 });
```

---


## Coolify hazards encoded

- **No auto-redeploy on env change** — env changes are inert until you explicitly run `deploy`.
- **Compose-locked vars** — variables locked by Docker Compose are upserted in place; the library never deletes and recreates them. Exit code 6 is reserved for a future explicit delete verb that would refuse to delete a compose-locked var — no delete operation exists in v1.
- **Duplicate-key drift** — if Coolify has multiple entries with the same key (can occur with some bulk operations), the library detects this, surfaces the duplicates, and repairs them by setting all copies to the single desired value.
- **Bulk merge** — `env apply` uses Coolify's bulk upsert endpoint. On a Coolify upgrade, re-record fixtures and re-run live-smoke to confirm the bulk endpoint contract has not changed.

---

## Token scope table

| Operation | Required token scopes |
|---|---|
| `env diff` (with values) | `read` + `read:sensitive` |
| `env apply` | `read` + `read:sensitive` + `write` |
| `deploy` / restart | `read` + `write` + `deploy` |
| `status` | `read` (sufficient for metadata) |
| `logs` (runtime or build) / `deployments` / `deployment <uuid>` | `read` + `read:sensitive` (logs are sensitive) |
| `catalog gen` / `catalog check` | No token required (local only) |
| `config doctor` | `read` (validates connectivity) |

`read:sensitive` is required for **environment variable values** and **logs** (both runtime container logs and build/deployment logs).

`tokenEnv` in the config holds the **name** of the env var, never the token value itself. Set the actual token in your shell or CI secrets.

---

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success; dry-run clean; catalog fresh |
| 1 | Internal error |
| 2 | Usage / argument error |
| 3 | Catalog stale (re-run `catalog gen`) |
| 4 | Drift detected (with `--fail-on-drift`) |
| 5 | Auth / scope error (token missing or insufficient) |
| 6 | Reserved: refusal to delete a compose-locked var (no delete verb in v1) |

---

## MCP adapter seam

All capabilities are implemented as pure-ish typed library functions importable without touching `cli/`:

```ts
import { CoolifyClient } from 'coolify-harness/client';
import { generateCatalog, buildArtifacts } from 'coolify-harness/catalog';
import { defineConfig, loadConfigModule } from 'coolify-harness/config';
import { planEnvWrite, applyEnvWrite, buildAuditRecord, waitForDeployment } from 'coolify-harness';
import type { Application, Deployment } from 'coolify-harness';
```

The CLI (`coolify-harness/cli`) is a thin orchestration layer over these functions. An MCP adapter can import the same functions directly without going through the CLI.

**New in this release (agent-friendly observability):** `CoolifyClient.get()`, `getRuntimeLogs()`, `listDeployments()`, `getDeployment()`, `getLatest*()`, `waitForDeployment()`. All read paths are exercised with Zod contracts, circuit breaker, and injected transport for testing.

---

## Subpath exports

| Import | Entry point |
|---|---|
| `coolify-harness` | `dist/index.js` — full public surface |
| `coolify-harness/client` | `dist/client/coolify.js` — `CoolifyClient` |
| `coolify-harness/catalog` | `dist/catalog/generate.js` — catalog generation |
| `coolify-harness/config` | `dist/config/load.js` — `defineConfig`, `loadConfigModule` |
| `coolify-harness/cli` | `dist/cli/main.js` — CLI entry point |
