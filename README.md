# coolify-harness

[![CI](https://github.com/Coriou/coolify-harness-api/actions/workflows/ci.yml/badge.svg)](https://github.com/Coriou/coolify-harness-api/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/Coriou/coolify-harness-api/blob/main/LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D24-339933?logo=node.js)](https://nodejs.org/)

**Coolify harness for AI agents.** A lightweight CLI + fully-typed TypeScript library that gives agents (Claude Code, Cursor, Windsurf, Aider, etc.) working *inside your project directory* a super clean, safe, and auditable way to interact with Coolify: manage env vars, trigger (force) deploys/restarts and wait for them, edit service composes, change the proxy (Traefik) version, toggle database exposure, inspect status + logs, and generate living env catalogs directly from your Zod schemas.

- **Safe by default**: every mutation except `deploy` is a dry-run unless you pass `--apply`. Every mutation is audit-logged (keys only, never values). Redeploy is always an explicit separate step.
- **Secrets never printed**: env values are never shown; every JSON output (and human compose/proxy output) is redacted — webhook secrets, tokens, basic-auth hashes, URL passwords and literal env values in compose documents.
- **Env catalogs from code**: Walk live Zod schemas → committed Markdown + JSON + `.env.example`. CI gate ensures they never go stale.
- **Agent-first primitives**: `--json` everywhere, `wait`, latest-deployment SHA comparison to avoid redundant deploys, typed `CoolifyClient`, rich error taxonomy.
- **Works with real Coolify hazards**: no auto-redeploy on env change, compose-locked vars, duplicate-key drift detection + repair, bulk upsert quirks — all encoded.

Not a full MCP server (see comparison below). Complements the excellent community Coolify MCP tools (e.g. [StuMason/coolify-mcp](https://github.com/StuMason/coolify-mcp)) and Coolify's built-in read-only MCP.

---

> **Pinned contract:** Coolify API **4.5.0** (verified 2026-10-26 against two live instances; fixtures in `test/fixtures/coolify/v4.5/`). Endpoint-by-endpoint coverage, scopes and what the API does *not* expose: [`docs/coolify-4.5-api-coverage.md`](docs/coolify-4.5-api-coverage.md). If you upgrade Coolify, re-record the fixtures and re-verify before cutting a release.

---

## Quick start for agents (and humans)

```bash
# In your project
pnpm add -D coolify-harness

# Create coolify-harness.config.ts (see full example below)
# Set COOLIFY_PROD_TOKEN in your shell / agent env / CI secrets

# Read what would change (always safe)
coolify-harness env diff --app my-app --from-file .env

# Actually write (with audit + confirmation)
coolify-harness env apply --app my-app --from-file .env --apply

# Redeploy (explicit!) — exits 7 if the deployment fails
coolify-harness deploy --app my-app --wait --json
# Rebuild without cache (e.g. to pick up a patched base image)
coolify-harness deploy --app my-app --force --wait

# Inspect (read-only, great for agents)
coolify-harness status --app my-app --json
coolify-harness logs --app my-app --json

# Instance-level: version, servers, proxy (Traefik) version change
coolify-harness instance info --instance prod
coolify-harness proxy set --instance prod --server <uuid> --image traefik:v3.6.4          # dry-run diff
coolify-harness proxy set --instance prod --server <uuid> --image traefik:v3.6.4 --apply --restart

coolify-harness help
```

Generate + gate your env catalog:

```bash
coolify-harness catalog gen
coolify-harness catalog check   # exits 3 if stale (perfect CI gate)
```

See the full config + command reference below.

---

## Install

```bash
pnpm add -D coolify-harness
```

For reproducible git dependency (recommended):

```bash
pnpm add -D coolify-harness@github:Coriou/coolify-harness-api#v0.4.0
```

Requires **Node.js >= 24**, **pnpm**, ESM, Zod 3.24+.

See `CHANGELOG.md` for release notes.

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
      kind: 'application',  // 'application' | 'service' | 'database'
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
- `targets` — one entry per Coolify application, service or standalone database. `kind` must match the Coolify resource type (`application`, `service` or `database`); `uuid` comes from the Coolify UI (or `coolify-harness databases --instance prod` / `servers` for discovery).
- Instance-wide commands (`instance info`, `servers`, `proxy …`, `databases`, `deployments --instance`) take `--instance <name>` — a key of `instances` — or infer it from `--app`.

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
# Keys, scope (prod/preview), flags and value LENGTH — values are never printed
coolify-harness env list --app my-app [--json]

# Shows a diff between your desired env (from --from-file and/or --set) and what Coolify has live
coolify-harness env diff --app my-app [--from-file .env] [--set KEY=VALUE] [--json] [--fail-on-drift]
```

- `env diff` is **read-only**. It never writes anything.
- `--from-file <path>` loads a `.env` file as the desired base.
- `--set K=V` overrides individual keys (applied on top of `--from-file`).
- `--fail-on-drift` causes exit 4 if any drift is detected.
- `--json` emits machine-readable JSON output.
- `env diff` / `env apply` need `read:sensitive`; without it Coolify withholds values and the harness exits 5 rather than planning against empty values.

### Apply (write env vars)

```bash
# Dry-run by default — shows what would change, writes nothing
coolify-harness env apply --app my-app [--from-file .env] [--set KEY=VALUE] [--json]

# Actually write (upsert-by-key, atomic bulk)
coolify-harness env apply --app my-app --from-file .env --apply [--yes]
```

- **Dry-run is the default.** Without `--apply`, `env apply` prints what it would do and exits 0.
- `--apply` performs the actual bulk upsert. Coolify variables are upserted by key — existing keys are updated, missing keys are inserted. Keys that exist in Coolify but are absent from your desired set are left untouched (use `env delete`).
- Every mutation is audit-logged to `.coolify-harness/audit.jsonl` — keys only, never values.
- After `--apply`, the tool re-reads to confirm the write landed. A confirmation mismatch is reported on stdout but still exits 0 (the write itself succeeded).

### Delete env vars

```bash
coolify-harness env delete --app my-app --key OLD_KEY [--key OTHER] [--preview]          # dry-run
coolify-harness env delete --app my-app --key OLD_KEY --apply
```

- Deletes the production rows of each key (`--preview` targets preview rows instead); duplicate rows of a key are all deleted.
- **Refuses with exit 6** when a key is Coolify-managed (`is_coolify`) or still referenced by the resource's docker-compose (`${KEY}`, `KEY=`, `KEY:`, `- KEY`): Coolify re-creates such rows on its next parse, so the delete would not stick. Remove the reference first (`compose set`), or pass `--force`.
- Coolify injects **every** row in a service's env list into the container whether or not the compose references it — deleting stale rows is the only way to get rid of them.

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
coolify-harness deploy --app my-app [--force] [--wait [--timeout SEC]] [--json]   # application build
coolify-harness deploy --app my-svc --restart [--latest]                          # service restart (--latest pulls images)
```

- `deploy` triggers a redeploy (applications) or a start (services, databases). It is the one mutation that is not dry-run: invoking it *is* the explicit step.
- `--force` rebuilds an application **without the Docker cache**. A plain redeploy of an unchanged commit reuses the existing image — use `--force` when the point is to pick up a patched base image. (Digest-pinned `FROM …@sha256:` bases never change, forced or not.)
- `--restart` restarts instead; for services, `--latest` pulls fresh images first. `--force` on a service or `--latest` on an application is a usage error (exit 2) and nothing is sent.
- `--wait` polls the application deployment until it is `finished`, `failed` or `cancelled-by-user`, printing transitions on stderr. Exit **7** if it did not finish successfully, **8** on timeout (default 10 min). Services and databases create no deployment record, so `--wait` says so and returns.

### Live status, logs, and deployment history (read-only)

```bash
# Current resource details + latest deployment summary (services: every sub-container's status/image)
coolify-harness status --app my-app [--json]

# Runtime (container) logs — requires read:sensitive
coolify-harness logs --app my-app [--lines 200] [--timestamps] [--json]
coolify-harness logs --app my-compose-app --service clickhouse        # one compose service
coolify-harness logs --app my-svc --service postgresql                # services: sub-service name required

# Build / deploy logs from the latest (or specific) deployment
coolify-harness logs --app my-app --build [--deployment DEPLOY_UUID] [--json]

# Recent deployments (build history) / everything queued or running on the instance
coolify-harness deployments --app my-app [--take 5] [--skip 0] [--json]
coolify-harness deployments --instance prod [--json]

# Full details + logs for one deployment; cancel one
coolify-harness deployment DEPLOY_UUID (--app my-app | --instance prod) [--json]
coolify-harness deployment cancel DEPLOY_UUID --instance prod [--apply]
```

**Important notes for agents:**
- Always prefer `--json` — every command prints exactly one JSON document (redacted), no prose.
- `status` + `getLatestDeployment` (via library) lets agents avoid redundant deploys by comparing `git_commit_sha`.
- `deployment cancel` on a deployment that already ended is reported and exits 0.
- The parser accepts `--flag=value`, `env-diff` / `env:diff` spellings and flags before the command.

---

## Service compose

```bash
coolify-harness compose get --app my-svc                  # redacted compose + image summary
coolify-harness compose get --app my-svc --out svc.yml    # raw document to a 0600 file (keep it out of git)

# Bump an image: dry-run shows a redacted diff; --apply saves and confirms by re-reading
coolify-harness compose set --app my-svc --image umami=ghcr.io/umami-software/umami:3.4.0
coolify-harness compose set --app my-svc --image umami=ghcr.io/umami-software/umami:3.4.0 --apply --restart

# Or replace the whole document
coolify-harness compose set --app my-svc --from-file svc.yml --apply
```

- Only `image:` lines are rewritten for `--image`, so comments, quoting and ordering survive byte for byte.
- Coolify validates and re-parses the compose but **does not restart**; `--restart` restarts with `latest=true` so the new tag is pulled.
- `compose set` is for services. A `dockercompose` *application* deploys its compose from git — change it in the repository.
- Back up any database a service runs before an image bump that may migrate it (e.g. `pg_dump`).

---

## Instance, servers and proxy (Traefik)

```bash
coolify-harness instance info --instance prod          # Coolify version + health (alias: version)
coolify-harness servers --instance prod
coolify-harness server get --instance prod --server <uuid>     # resources, proxy type/status/image

coolify-harness proxy get --instance prod --server <uuid> [--out proxy.yml]
coolify-harness proxy set --instance prod --server <uuid> --image traefik:v3.6.4               # dry-run
coolify-harness proxy set --instance prod --server <uuid> --image traefik:v3.6.4 --apply --restart
coolify-harness proxy restart --instance prod --server <uuid> --apply
```

- **Changing the Traefik version is possible through the API**, but not through `PATCH /servers/{uuid}/proxy` (that only takes redirect / exact-labels / cert-resolver / proxy type). The image lives in the proxy docker-compose: `proxy set` fetches it, edits only the `image:` line, `PUT`s it back (Coolify keeps 10 backups of the old file) and, with `--restart`, restarts the proxy, which pulls the new image. Warns on a repository or major-version change.
- A proxy restart briefly interrupts **every site on that server**.
- The proxy configuration is only returned to a `read:sensitive` token whose user is a team admin/owner.

### What the Coolify API does not expose

The dashboard also nags you to **update Coolify**, **install server package updates** and **reboot**. Coolify 4.5.0 has **no API endpoint** for any of these — they are dashboard-only actions:

| Need | Where |
|---|---|
| Update Coolify | Settings → Updates (`/settings/updates`) |
| Server package updates | Servers → *server* → Security → Patches (`/server/<uuid>/security/patches`) |
| Reboot server | the same Patches page |

`coolify-harness server patch`, `server reboot` and `instance upgrade` exist only to say this (exit 2). The harness never SSHes into servers or writes Coolify's database to fake a missing endpoint.

---

## Standalone databases

```bash
coolify-harness databases --instance prod
coolify-harness database get --instance prod --database <uuid>        # or --app <target of kind database>
coolify-harness database set --instance prod --database <uuid> --public false             # dry-run
coolify-harness database set --instance prod --database <uuid> --public false --apply
coolify-harness database backups --instance prod --database <uuid>
coolify-harness database backup  --instance prod --database <uuid> [--backup <uuid>] --apply   # run a schedule now
```

- `database set` supports `--public true|false`, `--public-port N` and `--image REF`. Changing `is_public` needs the `deploy` ability too (Coolify starts/stops the public port proxy).
- `env list/diff/apply/delete`, `deploy` / `--restart` and `logs` also work on `database` targets.
- Databases that belong to a service (a template's postgres) use different endpoints and are not covered yet.

---

**Library usage (for MCP adapters, direct import, or advanced scripts):**

```ts
import { CoolifyClient, CoolifyInstanceClient, redactDeep } from 'coolify-harness';

const client = new CoolifyClient(target, { fetchImpl: globalThis.fetch, logger: myLogger });
const app = await client.get();                    // status + git info + fqdn etc. (contains secrets → redactDeep before printing)
const ack = await client.deploy({ force: true });  // no-cache rebuild
const final = await client.waitForDeployment(ack.deploymentUuid!, { timeoutMs: 900_000, onStatus: console.error });
await client.restart({ latest: true });            // services: pull images
await client.deleteEnv(envUuid);
const logs = await client.getRuntimeLogs(100, { service: 'umami' });

const inst = client.instance();                    // or new CoolifyInstanceClient({ instanceUrl, token }, deps)
await inst.getVersion();                           // '4.5.0'
const proxy = await inst.getServerProxy(serverUuid);
await inst.saveServerProxyConfiguration(serverUuid, setServiceImage(proxy.configuration!, 'traefik', 'traefik:v3.6.4'));
await inst.restartServerProxy(serverUuid);
await inst.updateDatabase(dbUuid, { is_public: false });
```

---


## Coolify hazards encoded

- **No auto-redeploy on env change** — env changes are inert until you explicitly run `deploy`.
- **Compose-locked vars** — `env delete` refuses (exit 6) to delete a var the compose still references or Coolify manages, because Coolify would re-create it on the next parse.
- **Duplicate-key drift** — if Coolify has multiple entries with the same key (can occur with some bulk operations), the library detects this, surfaces the duplicates, and repairs them by setting all copies to the single desired value.
- **Bulk merge** — `env apply` uses Coolify's bulk upsert endpoint. On a Coolify upgrade, re-record fixtures and re-run live-smoke to confirm the bulk endpoint contract has not changed.
- **Build-time flag rename** — Coolify ≥ 4.0.0-beta.463 renamed the env-var build-time flag on reads from `is_build_time` to `is_buildtime` (and added `is_runtime`). The read schema accepts either and normalizes to a canonical `is_build_time`. Build-time is **not settable via the API** — the write endpoints reject any build-time field with HTTP 422 — so the harness never sends one.
- **Nullable columns** — Coolify sends unset fields as JSON `null` (e.g. `git_full_url`, `health_check_port`, and `commit_message` on a queued deployment). All response schemas accept `null`, which is what fixed `status`, `deploy --wait` and `deployment` on 4.3.16+.
- **Redeploy reuses images** — an unchanged commit redeploys from the cached image; use `deploy --force`.
- **Compose changes do not restart** — `compose set` / `proxy set` save; `--restart` applies.

---

## Token scope table

Abilities come from Coolify's `routes/api.php` middleware (4.5.0).

| Operation | Required token abilities |
|---|---|
| `env list` | `read` (`read:sensitive` to see value lengths) |
| `env diff` | `read` + `read:sensitive` |
| `env apply` / `env delete` | `read` + `read:sensitive` + `write` |
| `deploy` / `--restart` / `deployment cancel` | `deploy` (+ `read` for `--wait`) |
| `status`, `deployments`, `deployment`, `servers`, `server get`, `databases`, `database get/backups`, `instance info` | `read` |
| `logs` (runtime or build) | `read` + `read:sensitive` |
| `compose get` / `compose set` | `read` / `write` (+ `deploy` for `--restart`) |
| `proxy get` | `read`; the configuration (image) needs `read:sensitive` **and** a team admin/owner user |
| `proxy set` | `read:sensitive` + `write` + `deploy` |
| `proxy restart` | `deploy` |
| `database set` | `write`; `+ deploy` when changing `--public` |
| `database backup` | `write` + `deploy` |
| `catalog gen` / `catalog check` | No token required (local only) |
| `config doctor` | none (checks config + token presence) |

`tokenEnv` in the config holds the **name** of the env var, never the token value itself. Set the actual token in your shell or CI secrets.

See CHANGELOG.md for detailed release notes and history.

---

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success; dry-run clean; catalog fresh |
| 1 | Internal / Coolify request error (the server's message is included) |
| 2 | Usage / argument / config error; operation not supported by the Coolify API |
| 3 | Catalog stale (re-run `catalog gen`) |
| 4 | Drift detected (with `--fail-on-drift`) |
| 5 | Auth / scope error (token missing, rejected or lacking an ability) |
| 6 | Refused to delete a compose-locked / Coolify-managed env var (`env delete` without `--force`) |
| 7 | `deploy --wait`: the deployment ended `failed` or `cancelled-by-user` |
| 8 | `deploy --wait`: timed out (`--timeout`, default 600 s) |

---

## Positioning vs Coolify MCP servers

coolify-harness is **not an MCP server** and is **not redundant** with Coolify's ecosystem tools:

- **Official Coolify MCP** (v4.1+): built-in read-only instance visibility tools (~10 tools) exposed at the Coolify server's `/mcp` endpoint.
- **Community MCP servers** (StuMason/coolify-mcp and forks): full-featured, long-running stdio/SSE servers with dozens of tools for natural-language management of your whole Coolify instance from Claude Desktop, Cursor, Windsurf, Claude Code, etc.

**coolify-harness** is the *in-repo harness* for agents that are already editing code in your directory. It is deliberately lightweight (no daemon), project-specific, and obsessively safe for the operations agents do most often on a single app/service:

- Dry-run-by-default env writes + keys-only audit logs
- Explicit separate deploy step (Coolify does not auto-redeploy)
- Zod schema → committed, CI-gated env catalog (Markdown/JSON/.env.example)
- Agent-ergonomic observability (`--json`, `wait`, SHA diffing to skip redundant deploys)

Use MCP servers for broad chat-driven overview and cross-resource actions. Use coolify-harness (shell or library) when the agent needs *precise, safe, auditable* control of *this project's* deployment surface with strong guardrails and documentation that lives in code.

The core was designed with an "MCP adapter seam" — any MCP server can import the same functions (`CoolifyClient`, catalog generators, `planEnvWrite`/`applyEnvWrite`, etc.) instead of reimplementing.

## MCP adapter seam (library surface)

All capabilities are implemented as pure-ish typed library functions importable without touching `cli/`:

```ts
import { CoolifyClient } from 'coolify-harness/client';
import { generateCatalog, buildArtifacts } from 'coolify-harness/catalog';
import { defineConfig, loadConfigModule } from 'coolify-harness/config';
import { planEnvWrite, applyEnvWrite, buildAuditRecord, waitForDeployment } from 'coolify-harness';
import { CoolifyInstanceClient, redactDeep, setServiceImage, isTerminalDeploymentStatus } from 'coolify-harness';
import type { Application, Deployment, Service, Server, ServerProxy, Database } from 'coolify-harness';
```

The CLI (`coolify-harness/cli`) is a thin orchestration layer. An MCP adapter (or custom script) can import directly from the subpath exports.

**v0.4.0:** Coolify 4.5 contract fixes, `CoolifyInstanceClient` (servers, proxy, databases, deployments), force deploy, env delete, service compose edits and output redaction. See CHANGELOG.md.

---

## Subpath exports

| Import | Entry point |
|---|---|
| `coolify-harness` | `dist/index.js` — full public surface |
| `coolify-harness/client` | `dist/client/coolify.js` — `CoolifyClient` (instance client via `client.instance()`; `CoolifyInstanceClient` from the root) |
| `coolify-harness/catalog` | `dist/catalog/generate.js` — catalog generation |
| `coolify-harness/config` | `dist/config/load.js` — `defineConfig`, `loadConfigModule` |
| `coolify-harness/cli` | `dist/cli/main.js` — CLI entry point |
