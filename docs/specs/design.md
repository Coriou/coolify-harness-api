# coolify-harness-api — Design Spec

> **Date:** 2026-06-17
> **Status:** Approved design (hands-free brainstorm run) — ready for implementation plan.
> **Repo:** new standalone project at `~/Projects/coolify-harness-api`.
> **First consumer:** example-consumer (this repo). example-consumer is *consumer #1*, not the home.
> **Production bar:** inherits example-consumer's CLAUDE.md bar verbatim (strict TS, no `any`,
> Zod at every boundary, hand-rolled breaker+retry, structured logging, ≥90% core coverage).

---

## 1. Problem statement, jobs, non-goals

### The pain

We deploy a lot via Coolify (v4), which auto-deploys on push/merge to `main`. Operating these
deployments means constantly hand-editing `.env` feature flags in the Coolify UI. example-consumer alone
has ~129 env keys across ~2000 lines of Zod validators spread over four services, most undocumented,
and a long tail of default-off feature flags shipped one-per-PR. There is no machine-readable catalog
of what each key does, and no safe, auditable, agent-drivable way to read/diff/set live env vars or
trigger a redeploy. AI agents (our Claude Code harness) currently cannot operate Coolify cleanly.

### Two jobs

1. **Flag catalog generation.** Generate a committed, human + machine catalog of every env key — its
   type, default, required-ness, owning service(s), and a `.describe()`-authored description — directly
   from each consumer repo's *live* Zod env schema objects. Regenerate the consumer's `.env.example`
   from the same source of truth. A CI check fails when any artifact is stale.

2. **Safe Coolify env/deploy interface.** A typed client + CLI letting agents (and humans) read, diff,
   and set live Coolify env vars and trigger redeploys — default dry-run, explicit `--apply`, audit-logged,
   redeploy as a separate explicit step, with the Coolify operational hazards (no auto-redeploy on env
   change, locked compose-referenced vars, duplicate-key merge drift) encoded into the write primitive.

### Product surface (LOCKED)

**Library core + thin CLI.** A pure, fully-tested TypeScript library; a thin CLI on top that agents
invoke via Bash. No server to run. Works inside any repo's Claude Code session. Portable.

### Non-goals (v1)

- **No MCP server.** The core is designed so an MCP adapter is a thin later wrapper (§10), but v1 ships
  CLI only.
- **No Coolify-UI-comment sync.** The Coolify v4 public API has **no** `comment`/`description` field on
  env endpoints (confirmed against the OpenAPI spec — see §3). The committed catalog *is* the documentation;
  we never attempt to write descriptions into the Coolify UI.
- **No "900 projects" / no source-text schema parsing.** We walk the live Zod schema object, never parse
  `.ts` source. We do not attempt to discover schemas automatically across an org.
- **No multi-instance fan-out engine.** Multi-instance is supported by *config* (the registry models the
  instance as first-class) but v1 operates against one addressed instance per invocation. No rewrite needed
  to add a second.
- **No secret rotation / no Coolify resource provisioning.** We touch env vars and deploy triggers only.

---

## 2. Package layout

Single npm package, ESM-only, Node 24 LTS, pnpm 10. **Not** a monorepo (user: "don't over-engineer").
Clean internal module boundaries via **subpath exports** so it can graduate to a workspace later without
a consumer-facing change.

```
coolify-harness-api/
├── package.json            # "exports" map: ".", "./client", "./catalog", "./config", "./cli"
├── tsconfig.json           # strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes
├── eslint.config.js        # no-any, no-bare-as, no floating promises, no console in lib
├── vitest.config.ts        # globals: false, node env
├── src/
│   ├── index.ts            # re-exports the stable public surface
│   ├── errors/             # typed error taxonomy (§9) — zero deps, imported everywhere
│   │   └── index.ts
│   ├── logging/            # structured JSON logger interface + default pino-style impl
│   │   └── index.ts
│   ├── config/             # project/instance/app registry loader + Zod validation (§6)
│   │   ├── schema.ts       # ResolvedTargetSchema, ProjectRegistrySchema
│   │   └── load.ts         # loadConfig(): reads coolify-harness.config.ts + env, fails loud
│   ├── client/             # Coolify HTTP client (§3) + safe-write primitive (§4)
│   │   ├── http.ts         # native fetch + CircuitBreaker + retryWithBackoff
│   │   ├── schemas.ts      # Zod schemas for every Coolify request/response
│   │   ├── coolify.ts      # CoolifyClient: listEnvs / upsertEnvs / deploy / restart
│   │   └── safe-write.ts   # planEnvWrite() → EnvWritePlan (pure); applyEnvWrite() (effectful)
│   ├── catalog/            # Zod-schema walker + emitters (§5)
│   │   ├── walk.ts         # walkEnvSchema(schema, opts) → CatalogModel (PURE)
│   │   ├── emit-markdown.ts
│   │   ├── emit-json.ts
│   │   ├── emit-dotenv.ts  # regenerates .env.example
│   │   └── stale-check.ts  # generate-and-diff for CI
│   └── cli/
│       ├── main.ts         # arg parsing (Zod-validated), command dispatch, exit codes
│       └── commands/       # env-diff, env-apply, deploy, catalog-gen, catalog-check, config-doctor
├── test/
│   ├── fixtures/coolify/   # recorded Coolify API responses (pretty JSON), per endpoint
│   └── fixtures/schemas/   # representative Zod schemas mirroring example-consumer's constructs
└── README.md
```

**Module boundaries (each independently testable, one purpose):**

| Module     | Does                                                        | Depends on        |
| ---------- | ---------------------------------------------------------- | ----------------- |
| `errors`   | the typed error classes                                    | nothing           |
| `logging`  | structured logger interface + default impl                 | nothing           |
| `config`   | resolve logical target name → instance URL + uuid + token  | errors, zod       |
| `client`   | wrap Coolify HTTP + the safe-write plan/apply primitive    | errors, logging, config, zod |
| `catalog`  | walk a live Zod schema → MD/JSON/.env.example; stale check  | errors, zod       |
| `cli`      | parse args, orchestrate the above, format stdout, exit codes | all of the above |

The `catalog` module has **zero dependency on `client`** and vice versa — the two jobs are independent
and separately consumable.

---

## 3. The Coolify HTTP client

### 3.1 Coolify facts (GROUND TRUTH, settled against the OpenAPI spec)

- **Auth:** Laravel Sanctum Bearer token. Scopes: `read`, `read:sensitive` (required to read env *values*),
  `write`, `deploy`, `root`.
- **Env endpoints (applications):**
  - `GET  /api/v1/applications/{uuid}/envs` — list env vars.
  - `POST /api/v1/applications/{uuid}/envs` — create one.
  - `PATCH /api/v1/applications/{uuid}/envs` — update one.
  - `PATCH /api/v1/applications/{uuid}/envs/bulk` — atomic bulk upsert, body `{"data":[{key,value,…}]}`.
  - `DELETE /api/v1/applications/{uuid}/envs/{env_uuid}` — delete one (we **avoid** this — see §4).
- **Services** have parallel endpoints under `/api/v1/services/{uuid}/envs…`.
- **Deploy/restart:** `GET|POST /api/v1/applications/{uuid}/start` and `…/restart`; service equivalents under
  `/api/v1/services/{uuid}/…`. **Editing env does NOT auto-redeploy** — redeploy is a separate trigger.
- **Env write fields accepted (the ONLY ones):** `key`, `value`, `is_preview`, `is_literal`,
  `is_multiline`, `is_shown_once`. There is **no build-time field on the write path** (neither
  `is_build_time` nor `is_buildtime`); Coolify 422s ("This field is not allowed.", #6847) on any
  extra field. Build-time is not settable via the API. **No `comment`/`description` field exists.**
  Do not design around it. `upsertEnvs` Zod-validates the request body to enforce exactly this set.
- **Env READ field (build-time rename):** Coolify >= 4.0.0-beta.463 renamed the response flag
  `is_build_time` → `is_buildtime` (and added `is_runtime`). The read schema accepts either and
  normalizes onto a canonical `is_build_time`; older instances still work.
- **Known upstream quirk:** the bulk endpoint can return a `cannot unmarshal array` error. Treat bulk as
  potentially flaky: Zod-validate the request *and* response, and wrap it in retry + breaker.

### 3.2 HTTP layer (`client/http.ts`)

Hand-rolled, native `fetch` only — no axios (matches example-consumer ADR 0010 ethos).

- **`CircuitBreaker`** per `(instanceUrl)` — opens after N consecutive failures, half-open probe, configurable.
- **`retryWithBackoff`** on transient failures (network error, 5xx, 429 honouring `Retry-After`, and the
  bulk-unmarshal quirk). 4xx other than 429 are terminal (no retry).
- Bearer token injected from the resolved target (§6); **never logged**. Every request/response logged
  structurally with the token redacted and the body field-count (not values) at debug level.
- Every response body parsed through a Zod schema (§3.3) at the boundary — a shape mismatch throws
  `CoolifyContractError` (caught by the contract-drift test suite and surfaced to operators).

### 3.3 Response schemas (`client/schemas.ts`)

Zod schemas for: the env-list item (`{ uuid, key, value, is_build_time, is_preview, is_literal,
is_multiline, is_shown_once, … }`), the bulk-upsert request (`{ data: EnvWriteItem[] }`) and its response,
the create/update item, and the deploy/restart acknowledgement. Unknown extra fields are **allowed**
(`.passthrough()` where Coolify may add fields) but known fields are strictly typed. The version this
contract is validated against is pinned and recorded (see §11 open question on exact version).

### 3.4 `CoolifyClient` surface (`client/coolify.ts`)

A small, target-scoped class — constructed from a `ResolvedTarget` (§6), so it already knows instance URL,
resource kind (`application` | `service`), uuid, and token. Methods:

- `listEnvs(): Promise<EnvVar[]>`
- `upsertEnvs(items: EnvWriteItem[]): Promise<BulkResult>` — **the only write path** (bulk, atomic).
- `deploy(): Promise<DeployAck>` / `restart(): Promise<DeployAck>` — explicit, separate.

It does **not** know about diffs or plans — that's the safe-write primitive's job. It is a thin, typed,
resilient transport over Coolify. Typed errors (§9) for auth failure, not-found, locked var, contract drift,
bulk-unmarshal quirk exhaustion.

---

## 4. The safe-write primitive (`client/safe-write.ts`)

This is the heart of write safety. **Two functions:** a *pure* planner and an *effectful* applier.

### 4.1 `planEnvWrite(current: EnvVar[], desired: DesiredEnv): EnvWritePlan` — PURE

Computes a plan without touching the network. `DesiredEnv` is a `key → value` map plus optional flag
overrides. The plan contains:

```ts
interface EnvWritePlan {
  readonly creates: EnvWriteItem[];      // keys not present upstream
  readonly updates: EnvWriteItem[];      // keys present, value differs
  readonly unchanged: string[];          // keys present, value identical
  readonly duplicateKeyDrift: DuplicateKeyDrift[]; // SAME key, MULTIPLE upstream rows, divergent values
  readonly lockedSkips: LockedVarSkip[];           // requested delete of a compose-locked var (refused)
  readonly warnings: PlanWarning[];
}
```

### 4.2 Encoded Coolify operational invariants (these cost the user hours — non-negotiable)

1. **Upsert-by-key, never delete-then-recreate.** Compose-referenced env vars are **locked** by Coolify and
   cannot be deleted via API/UI. The primitive only ever creates or edits-in-place. Deletion is **not a
   supported operation** in v1; a desired-delete request produces a `lockedSkips`/refusal entry in the plan,
   never a `DELETE` call.

2. **Duplicate-key drift detection + repair.** Coolify's bulk-paste editor *merges* rather than replaces,
   so duplicate rows with divergent values accumulate and the resolved value becomes nondeterministic. The
   planner: (a) **detects** every key with >1 upstream row and surfaces it in `duplicateKeyDrift` (always
   shown in the dry-run output, even for keys we aren't changing); (b) when we *do* write such a key, emits
   an upsert that sets **all copies to the same value** so the result is deterministic.

3. **Redeploy is separate.** `applyEnvWrite` never deploys. Deploy is its own CLI step / `CoolifyClient.deploy()`.
   The plan output reminds the operator that changes are inert until a redeploy.

### 4.3 `applyEnvWrite(client, plan): Promise<EnvWriteResult>` — EFFECTFUL

Requires an explicit `apply` intent (the CLI gates this behind `--apply`). It calls `client.upsertEnvs()`
with the combined creates+updates (bulk, atomic), re-reads to confirm, and writes an **audit record**:

```ts
interface AuditRecord {
  ts: string;                 // ISO 8601
  actor: string;              // resolved from env (USER / CI actor) — best-effort, never a secret
  instanceUrl: string;
  resourceKind: 'application' | 'service';
  resourceUuid: string;
  action: 'env.apply' | 'deploy' | 'restart';
  planSummary: { creates: number; updates: number; unchanged: number; duplicateKeyDrift: number };
  keysAffected: string[];     // KEYS only — never values (secrets)
  outcome: 'success' | 'failure';
  error?: string;
}
```

Audit records are emitted through the structured logger **and** appended to a local JSONL audit file
(path configurable, default `.coolify-harness/audit.jsonl`, gitignored in the consumer). Values are never
recorded — keys only.

### Lifecycle (the safe-write contract)

```
read live  →  plan (pure, dry-run by default)  →  show diff + drift + warnings
           →  [explicit --apply]  →  upsert-by-key (bulk, atomic)  →  re-read confirm  →  audit
           →  [separate explicit --redeploy / deploy command]  →  audit
```

---

## 5. The catalog generator (`catalog/`)

### 5.1 The walker contract — `walkEnvSchema(schema, opts)` (PURE)

**Input:** a *live* Zod schema **object** (e.g. the `EnvSchema` exported from a consumer's `env.ts`) plus
`opts: { service: string }` (the owning service name). **Never** parse source text — shared
`.extend(notifierEnvSchema.shape)` + cross-field `.superRefine()` rules are only resolvable at the object
level (confirmed: example-consumer's `apps/api/src/env.ts` and `apps/mcp-server/src/env.ts` both use
`BaseEnvSchema.extend(notifierEnvSchema.shape).superRefine(...)`).

**Output:** a `CatalogModel` — an array of `CatalogEntry`:

```ts
interface CatalogEntry {
  key: string;
  services: string[];          // owning service(s) — MERGED across walks (many-per-key, §5.3)
  type: string;                // normalized: 'string' | 'number' | 'boolean' | 'enum' | 'list' | 'duration' | …
  enumValues?: string[];
  required: boolean;           // optional()/default() ⇒ not required
  default?: string;            // serialized default, when present
  description?: string;        // from .describe() — the net-new authored doc
  coerced: boolean;            // z.coerce.* present
  transformed: boolean;        // .transform() present (e.g. CSV → string[])
  multiline: boolean;          // heuristic for PEM/multiline values (informs is_multiline on write later)
}
```

**Constructs the walker MUST handle** (all present in example-consumer today):
`z.object().shape` traversal; `.extend()` (resolved because we walk the post-extend `.shape`);
`z.coerce.number()/.boolean()`; `.transform()` (record the *input* type, mark `transformed`);
`.default(x)` (⇒ not required, record serialized default); `.optional()` (⇒ not required);
`z.enum([...])` (record `enumValues`); `.superRefine()` cross-field rules (the wrapped inner object is
unwrapped to reach `.shape`; cross-field constraints are surfaced as a `description` note where a
`.describe()` is absent but a refine exists — best-effort, documented as a known limitation in §11).
Unwrapping walks `ZodDefault`, `ZodOptional`, `ZodEffects` (transform/refine), `ZodCoerce`-wrapped, and
`ZodCatch` `_def.innerType` chains until it reaches a base type.

> **Net-new authoring note:** there are **zero** `.describe()` calls in example-consumer's env schemas today
> (confirmed by reading `apps/api/src/env.ts` and `apps/mcp-server/src/env.ts`). Adding `.describe()` to each
> field is net-new authoring work the consumer does once; the walker reads whatever is there and emits a
> "missing description" entry for keys lacking one (and the CI check can be configured to warn or fail on
> missing descriptions). Existing leading `//` comments are *not* read — only `.describe()`.

### 5.2 Emitters

- `emit-markdown.ts` → committed human catalog: one table grouped by service (or a unified table with a
  Services column), columns `Key | Type | Required | Default | Services | Description`, plus a section for
  keys missing a description.
- `emit-json.ts` → committed machine catalog (`CatalogModel` serialized), for tooling and the future MCP
  adapter.
- `emit-dotenv.ts` → regenerates the consumer's `.env.example`: each key as `KEY=<default-or-blank>` preceded
  by a comment block from its description + type + required-ness. Deterministic ordering (by service, then key)
  so the generate-and-diff is stable.

### 5.3 Owning-service model (many-per-key)

A key can belong to multiple services (confirmed: `NODE_ENV`, `LOG_LEVEL`, `DATABASE_URL`, `REDIS_URL`,
`PG_POOL_*` appear in both `apps/api/src/env.ts` and `apps/mcp-server/src/env.ts`). The consumer's invocation
script walks **each** service schema and the toolkit **merges** entries by key, unioning the `services` array.
Where the same key has divergent type/default across services, the merge records a `conflict` note in the
entry (surfaced in the catalog and as a CI warning) rather than silently picking one.

### 5.4 The ~10-line consumer invocation script (the HYBRID seam)

All the hard, reusable logic lives in the toolkit. The consumer ships a tiny script that imports its *own*
live schemas and hands them over:

```ts
// example-consumer: scripts/gen-env-catalog.ts (illustrative shape)
import { generateCatalog } from 'coolify-harness/catalog';
import { EnvSchema as apiEnv } from '../apps/api/src/env.js';
import { EnvSchema as mcpEnv } from '../apps/mcp-server/src/env.js';
import { EnvSchema as webEnv } from '../apps/web/src/env.js';
import { EnvSchema as workerEnv } from '../apps/research-worker/src/env.js';

await generateCatalog({
  schemas: [
    { service: 'api', schema: apiEnv },
    { service: 'mcp-server', schema: mcpEnv },
    { service: 'web', schema: webEnv },
    { service: 'research-worker', schema: workerEnv },
  ],
  out: {
    markdown: 'docs/env-catalog.md',
    json: 'docs/env-catalog.json',
    dotenvExample: '.env.example',
  },
});
```

> **Prerequisite for example-consumer consumer #1:** the env schema objects must be *exported* (the walker needs the
> object, not the loader function). example-consumer's `env.ts` files currently export the loader (`loadEnv`) and the
> inferred type but **not** the schema object — exporting `EnvSchema` is a one-line additive change per service,
> flagged here as a consumer-side onboarding step, not toolkit work.

### 5.5 CI stale-check (`catalog/stale-check.ts`)

`checkCatalogFresh(opts)` regenerates all three artifacts in memory and diffs them against the committed files.
Returns a structured result `{ fresh: boolean, staleFiles: string[], diff: string }`. The CLI `catalog check`
maps a stale result to a non-zero exit (§7) so it gates CI ("generate-and-diff"). No live Coolify access —
purely local, fast, deterministic.

---

## 6. Config model (the reuse story)

### 6.1 Project registry — `coolify-harness.config.ts` in the consumer repo

A small, first-class, **config-driven** registry mapping logical names → addressable Coolify targets, so no
box is ever hardcoded:

```ts
// example-consumer: coolify-harness.config.ts (illustrative)
import { defineConfig } from 'coolify-harness/config';

export default defineConfig({
  instances: {
    prod: {
      url: 'https://coolify.example.com',
      tokenEnv: 'COOLIFY_PROD_TOKEN',   // name of the env var holding the Sanctum token
    },
  },
  targets: {
    'my-api':     { instance: 'prod', kind: 'application', uuid: '…' },
    'my-mcp':     { instance: 'prod', kind: 'application', uuid: '…' },
    'my-web':     { instance: 'prod', kind: 'application', uuid: '…' },
    'my-worker':  { instance: 'prod', kind: 'service',     uuid: '…' },
  },
});
```

- **Multi-instance is a config addition, not a rewrite** — add another `instances` entry + its `tokenEnv`.
- **Resource kind is first-class** (`application` | `service`) — the client picks the right endpoint family.
- `loadConfig()` validates the file shape with Zod and resolves a logical target name (`--app my-api`) into
  a `ResolvedTarget { instanceUrl, kind, uuid, token }`, failing loudly on unknown names or a missing token.

### 6.2 Token handling (LOCKED)

- Tokens are **never** in the config file — the file holds only the *name* of the env var (`tokenEnv`).
- Tokens are read from `process.env`, validated at boot via Zod, **fail loudly if missing**, **never committed**,
  **never logged** (redacted in all log lines). Per-project / per-instance token (matches the user's existing
  per-project Coolify service-token practice).
- **Minimum scope documented per operation:** `read` + `read:sensitive` for `env diff` (values needed);
  `+ write` for `env apply`; `+ deploy` for `deploy`/`restart`. The CLI surfaces a clear typed error when the
  token lacks the scope an operation requires (`CoolifyAuthScopeError`).

### 6.3 Onboarding a SECOND project (end-to-end reuse)

1. `pnpm add -D coolify-harness` (or workspace link).
2. Add `coolify-harness.config.ts` mapping that project's instance + targets.
3. Export the project's Zod env schema object(s) and add the ~10-line `gen-env-catalog` script.
4. Set the per-project `COOLIFY_*_TOKEN` env var(s) in the shell/CI.
5. Wire `catalog gen` into a script and `catalog check` into CI.

No toolkit code changes. That is the cross-project reuse requirement satisfied structurally.

---

## 7. CLI command surface

Invoked by agents via Bash. Dry-run is the default for every mutating verb. Exit codes are CI-meaningful.

| Command | Purpose | Key flags |
| ------- | ------- | --------- |
| `coolify-harness catalog gen` | Walk schemas, write MD + JSON + `.env.example`. | `--config <path>` |
| `coolify-harness catalog check` | Generate-and-diff; non-zero if stale (CI gate). | `--config <path>` |
| `coolify-harness env diff --app <name>` | Read live envs, compute plan vs a desired set, print diff + duplicate-key drift. **Read-only, dry-run.** | `--set K=V…` / `--from-file <env>` / `--json` |
| `coolify-harness env apply --app <name>` | Apply a plan (upsert-by-key, atomic). Refuses without `--apply`. Audit-logged. **Does NOT redeploy.** | `--apply`, `--set K=V…` / `--from-file`, `--yes` (non-interactive confirm) |
| `coolify-harness flag set K=V --app <name>` | Sugar over `env apply` for a single flag. Dry-run unless `--apply`. | `--apply`, `--redeploy` |
| `coolify-harness deploy --app <name>` | Trigger a redeploy (separate explicit step). Audit-logged. | `--restart` (restart instead of full deploy), `--yes` |
| `coolify-harness config doctor` | Validate config + token presence + scope probe (read-only). | `--app <name>` |

### Flag semantics

- **No `--apply` ⇒ dry-run.** Every mutating command computes and prints the plan/diff and exits 0 without
  touching Coolify.
- **`--apply` performs the write.** Interactive sessions get a confirm prompt unless `--yes`; agents pass
  `--apply --yes` (or `--apply` is sufficient in non-interactive mode — decided: in a non-TTY, `--apply`
  implies confirmed, matching agent-via-Bash usage; `--yes` is the explicit form).
- **`--redeploy` is never implied.** It is a separate verb (`deploy`) or an explicit opt-in flag on `flag set`.
  Env changes are inert until then; the dry-run output says so.
- **`--json`** on read commands emits machine-readable output for agent consumption.

### Exit codes

| Code | Meaning |
| ---- | ------- |
| 0 | success / dry-run clean / catalog fresh |
| 1 | unexpected/internal error |
| 2 | usage error (bad args — caught by Zod arg validation) |
| 3 | catalog stale (`catalog check`) |
| 4 | drift detected and `--fail-on-drift` set (duplicate-key drift in `env diff`) |
| 5 | Coolify auth/scope failure |
| 6 | locked-var refusal (a requested delete of a compose-locked var) |

---

## 8. Testing strategy

Tool-first principle: deterministic, unit-testable functions; agent prompts nowhere in the toolkit.

- **Client (`client/`):** faked `fetch` (injected transport) returns recorded fixtures from
  `test/fixtures/coolify/` (pretty-printed JSON, one per endpoint — matches example-consumer ADR 0012 ethos).
  Test: list parsing, bulk upsert success, the bulk-unmarshal quirk → retry → breaker, 429 + `Retry-After`,
  4xx terminal, auth/scope failures, contract-drift (a fixture with a missing field throws `CoolifyContractError`).
  **No live Coolify instance required** — fixtures are recorded once and committed; a separate, optional,
  manually-run "live smoke" script (not in CI) re-records them against a real instance to catch schema drift.
- **Safe-write primitive:** `planEnvWrite` is pure → exhaustive table-driven tests (creates/updates/unchanged,
  duplicate-key drift detection, the set-all-copies repair, locked-var refusal). `applyEnvWrite` tested against
  the faked client (asserts upsert-by-key, re-read confirm, audit record shape, never-emits-DELETE).
- **Catalog walker:** `test/fixtures/schemas/` holds representative Zod schemas mirroring every example-consumer
  construct (`coerce`, `transform`, `default`, `optional`, `enum`, `extend(...).superRefine(...)`, PEM/multiline,
  shared keys across two services). Assert the `CatalogModel`, the many-per-key merge + conflict note, and each
  emitter's deterministic output. A golden-file test pins MD/JSON/.env.example output.
- **Stale-check:** generate twice → assert idempotent; mutate a committed artifact → assert detected + exit 3.
- **CLI:** integration tests invoking `cli/main.ts` with a faked client + temp dirs; assert dry-run vs `--apply`
  behaviour, exit codes, and `--json` shape.
- **Coverage:** **≥90% line coverage** on the pure core (`client` logic minus transport, `safe-write`, `catalog`,
  `config`). Same script set as example-consumer (`dev/build/lint/typecheck/test/test:coverage/clean`).

---

## 9. Error taxonomy + observability/audit

### Typed error classes (`errors/`)

Typed errors for expected failures (throw exceptions only for the unexpected):

| Class | When |
| ----- | ---- |
| `CoolifyAuthError` | 401/403 — bad or missing token |
| `CoolifyAuthScopeError` | token present but lacks the scope the op needs (read:sensitive/write/deploy) |
| `CoolifyNotFoundError` | 404 — unknown app/service uuid |
| `CoolifyContractError` | response failed Zod validation (schema drift) — feeds the drift suite |
| `CoolifyBulkUnmarshalError` | the known bulk array quirk, after retry exhaustion |
| `LockedVarError` | attempted operation on a compose-locked var that the API forbids |
| `DuplicateKeyDriftError` | divergent duplicate keys when `--fail-on-drift` is set |
| `ConfigError` | bad/missing `coolify-harness.config.ts` or unresolved target name |
| `MissingTokenError` | the `tokenEnv` var is unset at boot |
| `CatalogStaleError` | stale artifacts in `catalog check` |

### Observability

- **Structured JSON logging** through a logger interface (default pino-style impl); **never `console.log`**
  in library code. CLI user-facing output goes to stdout via a dedicated presenter; internal logging is separate
  and routed through the logger (level via `LOG_LEVEL`). Tokens and env *values* are always redacted.
- **Audit:** every mutation (`env.apply`, `deploy`, `restart`) writes the `AuditRecord` (§4.3) — keys only,
  never values — to the structured log and a local JSONL audit file.

---

## 10. The documented seam for a future MCP adapter

The MCP adapter is **not built in v1** but the core is shaped so it is a thin wrapper, not a rewrite:

- All capabilities are exposed as **pure-ish, typed library functions** with Zod-described inputs/outputs:
  `loadConfig`, `CoolifyClient.{listEnvs,upsertEnvs,deploy,restart}`, `planEnvWrite` (pure), `applyEnvWrite`,
  `walkEnvSchema`, the emitters, `checkCatalogFresh`. The CLI is already a thin orchestration layer over these —
  an MCP server would be a *second* thin orchestration layer over the **same** functions.
- The JSON catalog (`emit-json`) is the machine-readable description an MCP `catalog` resource would serve
  directly.
- The dry-run/plan/apply split maps cleanly onto MCP tool design: `env_diff` (read-only tool) and `env_apply`
  (a write tool gated by an explicit `apply: true` argument) reuse `planEnvWrite`/`applyEnvWrite` verbatim.
- **Action item for v1:** keep `cli/` free of business logic (it only parses args, calls core functions, formats
  output, maps errors→exit codes). The litmus test: an MCP adapter must be able to import everything it needs from
  `coolify-harness/client` + `coolify-harness/catalog` + `coolify-harness/config` without touching `cli/`.

---

## 11. Open questions / risks

1. **Coolify version pinning.** The OpenAPI contract (endpoint shapes, env fields) is validated against a specific
   Coolify v4 release. We must record the exact version the fixtures were recorded against in the README and
   re-run the live-smoke re-record on a Coolify upgrade. *Mitigation:* `CoolifyContractError` + the contract-drift
   test surface drift loudly the moment a response shape changes.
2. **The bulk-unmarshal quirk.** `PATCH …/envs/bulk` can return `cannot unmarshal array`. We retry + breaker and
   Zod-validate, but the exact trigger is upstream and not fully characterized. *Risk:* if bulk is unreliable for a
   given instance, fall back to per-key `PATCH …/envs` (single) loops — designed as a config switch
   (`bulkStrategy: 'bulk' | 'per-key'`), defaulting to bulk. Documented but per-key fallback is a small, bounded
   addition.
3. **Service vs application deploy trigger.** Applications and services have parallel env endpoints; confirm the
   deploy/restart trigger for **services** is identical in shape (`/api/v1/services/{uuid}/start|restart`) before
   relying on it. *Mitigation:* `config doctor` probes the resolved target's deploy endpoint read-side where possible;
   live-smoke covers the rest.
4. **`.superRefine` description extraction is best-effort.** Cross-field constraints (e.g. "one of JWT_PRIVATE_KEY /
   JWT_PRIVATE_KEY_PATH must be set") cannot always be derived from the schema object; the walker surfaces what it
   can and the consumer authors a `.describe()` for the rest. Documented limitation, not a blocker.
5. **Consumer prerequisite:** schema objects must be exported (one-line additive change per service) and `.describe()`
   authoring is net-new one-time work. Tracked as a consumer onboarding step, not toolkit scope.

---

## Self-review notes (passed)

- Date `2026-06-17` in filename + header. No TBD/TODO/placeholders.
- Internally consistent: the no-`comment`-field fact (§1 non-goals, §3.1) drives the "committed catalog is the doc"
  decision (§1 job 1, §5); the safe-write invariants (§4) trace to the documented Coolify hazards; module boundaries
  (§2) match the per-job sections (§3–§6).
- Scope: focused on the two agreed capabilities; MCP/multi-instance-fanout/UI-comment-sync explicitly out (§1).
- Voice: matches example-consumer's production-grade, tool-first, "drag forward zero debt" register; guardrails inherited.
- Every cited path is real (verified `apps/api/src/env.ts`, `apps/mcp-server/src/env.ts`, `.env.example`).
