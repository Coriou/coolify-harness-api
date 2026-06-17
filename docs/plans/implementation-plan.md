# coolify-harness-api Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone, fully-tested TypeScript library + thin CLI that (a) generates a committed env-flag catalog (Markdown + JSON + `.env.example`) from a consumer's live Zod env schemas, and (b) safely reads/diffs/sets live Coolify v4 env vars and triggers redeploys with a plan→confirm→apply discipline.

**Architecture:** Single ESM package at `~/Projects/coolify-harness-api` with subpath exports (`./client`, `./catalog`, `./config`, `./cli`). Two independent job-modules (`catalog` and `client`) share only `errors`, `logging`, and `config`. The Coolify HTTP transport is a hand-rolled native-`fetch` client wrapped in a circuit breaker + retry-with-backoff, with every request/response Zod-validated. The catalog walker operates on a **live Zod schema object** (never source text), unwrapping the Zod 3.24 `_def` wrapper chain to a normalized `CatalogModel`. Write safety is a pure planner (`planEnvWrite`) plus an effectful applier (`applyEnvWrite`) gated behind explicit `--apply`; deploy is always a separate step. pfi-sniper is consumer #1 — this repo is NOT the package's home, so all package files live under `~/Projects/coolify-harness-api`, and the only pfi-sniper-side artifacts are the consumer onboarding files (§ Task 21).

**Tech Stack:** Node 24 LTS, ESM-only, pnpm 10, TypeScript (strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`), Zod 3.24, Vitest (`globals: false`, node env), native `fetch` (no axios), ESLint 9 flat config.

**Spec:** `docs/superpowers/specs/2026-06-17-coolify-harness-api-design.md` (in the pfi-sniper repo; this plan implements it).

---

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from the spec + project guardrails.

- **Repo location:** all package code lives at `~/Projects/coolify-harness-api` (a NEW standalone git repo). Only Task 21 touches the pfi-sniper repo (consumer onboarding). Never create the package as a package inside pfi-sniper.
- **Packaging:** single npm package, NOT a monorepo. Subpath exports: `.`, `./client`, `./catalog`, `./config`, `./cli`. Do not over-engineer.
- **Runtime:** Node 24 LTS, ESM-only (`"type": "module"`). Relative imports MUST carry the `.js` extension (TS verbatim ESM). Internal modules never import from `cli/` — `cli/` is a leaf.
- **Package manager:** pnpm 10 only. Never npm/yarn.
- **TypeScript:** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. **No `any`** (lint-blocked). **No `as`** casts without a `// reason:` comment.
- **Zod at every boundary:** Coolify responses, CLI args, config file, env vars. Env validated at boot; **fail loudly** on missing values. **No fallback secrets in code, ever.** The Sanctum token is **never logged** (redacted everywhere).
- **Zod version:** 3.24.x. The walker relies on the 3.24 `_def` layout (coercion lives on `ZodNumber._def.coerce` / `ZodBoolean._def.coerce`, NOT a separate `ZodCoerce` wrapper).
- **Logging:** structured JSON via a logger interface in **all library code** — never `console.log` in `src/` except inside `cli/` presenters writing user-facing stdout. CLI internal logging still routes through the logger.
- **HTTP client:** hand-rolled native `fetch`, no axios. Hand-rolled `CircuitBreaker` + `retryWithBackoff` (matches pfi-sniper ADR 0010 ethos).
- **Errors:** typed error classes for expected failures (auth, scope, not-found, locked var, contract drift, bulk-unmarshal quirk, drift detected, config, missing token, catalog stale). Throw plain exceptions only for the unexpected.
- **Testing:** Vitest, `globals: false` (explicit imports), node env. **≥90% line coverage** on the pure core (`client` logic minus transport, `safe-write`, `catalog`, `config`). Fixtures are pretty-printed JSON, committed (matches pfi-sniper ADR 0012).
- **Script set (identical to pfi-sniper):** `dev`, `build`, `lint`, `lint:fix`, `typecheck`, `test`, `test:watch`, `test:coverage`, `clean`.
- **Coolify ground truth (pinned to v4.1.2 — record this version in the README):**
  - Auth: Laravel Sanctum Bearer token. Scopes: `read`, `read:sensitive`, `write`, `deploy`, `root`.
  - Env write fields the API accepts: `key`, `value`, `is_preview`, `is_build_time`, `is_literal`, `is_multiline`, `is_shown_once`. The v4.1.2 model ALSO carries a nullable `comment` field (≤256 chars) — we never author it, but inbound schemas MUST `.passthrough()` it so a present-or-absent `comment` does not trip contract validation. We never WRITE `comment` (catalog is the doc).
  - Editing env does NOT auto-redeploy. Redeploy is a separate explicit trigger.
  - Compose-referenced env vars are LOCKED — never delete-then-recreate. Upsert-by-key only. No DELETE calls in v1.
  - Bulk-paste MERGES rather than replaces → duplicate-key rows with divergent values accumulate; detect + surface + set-all-copies-to-same-value on write.
  - Known upstream quirk: `PATCH …/envs/bulk` can return `cannot unmarshal array` → Zod-validate request + response, retry + breaker, with a `bulkStrategy: 'bulk' | 'per-key'` config fallback (default `'bulk'`).
  - **Deploy/restart response shapes differ by kind:** applications return `{ message: string, deployment_uuid?: string }`; services return `{ message: string }` (no `deployment_uuid`). The client must branch on resource kind when parsing the ack.
- **Write-safety discipline:** dry-run is the default for every mutating verb; real writes require explicit `--apply`; redeploy/restart is a SEPARATE explicit step; every mutation audit-logged (keys only, never values).
- **MCP seam:** keep `cli/` free of business logic — only arg parsing, core-function calls, stdout formatting, error→exit-code mapping. Litmus: an MCP adapter must import everything from `client` + `catalog` + `config` without touching `cli/`.

---

## File Structure

All paths below are relative to `~/Projects/coolify-harness-api` unless they start with `pfi-sniper:`.

| File | Responsibility |
| ---- | -------------- |
| `package.json` | exports map, scripts, deps (`zod` only as runtime dep) |
| `tsconfig.json` | strict TS config |
| `eslint.config.js` | no-any, no-bare-as, no-floating-promises, no-console-in-lib |
| `vitest.config.ts` | `globals:false`, node env, coverage thresholds |
| `src/index.ts` | re-exports stable public surface |
| `src/errors/index.ts` | typed error taxonomy |
| `src/logging/index.ts` | `Logger` interface + default JSON impl + redaction |
| `src/config/schema.ts` | `ProjectRegistrySchema`, `ResolvedTarget` types |
| `src/config/load.ts` | `defineConfig`, `loadConfig`, `resolveTarget` |
| `src/client/schemas.ts` | Zod schemas for Coolify request/response shapes |
| `src/client/http.ts` | `CircuitBreaker`, `retryWithBackoff`, `httpRequest` (injectable fetch) |
| `src/client/coolify.ts` | `CoolifyClient` (listEnvs/upsertEnvs/deploy/restart) |
| `src/client/safe-write.ts` | `planEnvWrite` (pure) + `applyEnvWrite` (effectful) + audit |
| `src/catalog/walk.ts` | `walkEnvSchema` (pure) → `CatalogModel`; merge logic |
| `src/catalog/emit-markdown.ts` | Markdown catalog emitter |
| `src/catalog/emit-json.ts` | JSON catalog emitter |
| `src/catalog/emit-dotenv.ts` | `.env.example` emitter |
| `src/catalog/generate.ts` | `generateCatalog` (orchestrates walk+merge+emit+write) |
| `src/catalog/stale-check.ts` | `checkCatalogFresh` (generate-and-diff) |
| `src/cli/main.ts` | arg parse (Zod), dispatch, exit codes, presenters |
| `src/cli/commands/*.ts` | one file per command |
| `test/fixtures/coolify/*.json` | recorded Coolify responses (pretty JSON) |
| `test/fixtures/schemas/*.ts` | representative Zod schemas |
| `README.md` | usage + pinned Coolify version + scope table |
| `pfi-sniper: scripts/gen-env-catalog.ts` | ~10-line consumer invocation script |
| `pfi-sniper: coolify-harness.config.ts` | consumer target registry |
| `pfi-sniper: apps/*/src/env.ts` | additive `export const EnvSchema = …` per service |

---

## Task ordering rationale

Tasks 1–4 build the dependency-free foundation (scaffold, errors, logging, config). Tasks 5–10 build the Coolify client + safe-write (one job). Tasks 11–17 build the catalog walker + emitters + stale-check (the other, independent job). Tasks 18–20 build the CLI over both. Task 21 is the pfi-sniper consumer onboarding. Catalog and client are independent — Tasks 11–17 do not depend on Tasks 5–10.

---

### Task 1: Project scaffold

**Files:**
- Create: `~/Projects/coolify-harness-api/package.json`
- Create: `~/Projects/coolify-harness-api/tsconfig.json`
- Create: `~/Projects/coolify-harness-api/eslint.config.js`
- Create: `~/Projects/coolify-harness-api/vitest.config.ts`
- Create: `~/Projects/coolify-harness-api/.gitignore`
- Create: `~/Projects/coolify-harness-api/src/index.ts`
- Create: `~/Projects/coolify-harness-api/README.md`

**Interfaces:**
- Produces: a buildable, lintable, testable empty package; the `exports` map other tasks rely on.

- [ ] **Step 1: Initialize the repo and package.json**

```bash
mkdir -p ~/Projects/coolify-harness-api/src
cd ~/Projects/coolify-harness-api && git init
corepack enable pnpm
```

Create `package.json`:

```json
{
  "name": "coolify-harness",
  "version": "0.1.0",
  "type": "module",
  "packageManager": "pnpm@10.0.0",
  "engines": { "node": ">=24" },
  "exports": {
    ".": "./dist/index.js",
    "./client": "./dist/client/coolify.js",
    "./catalog": "./dist/catalog/generate.js",
    "./config": "./dist/config/load.js",
    "./cli": "./dist/cli/main.js"
  },
  "bin": { "coolify-harness": "./dist/cli/main.js" },
  "files": ["dist"],
  "scripts": {
    "dev": "tsc --watch",
    "build": "tsc -p tsconfig.json",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "clean": "rm -rf dist node_modules/.cache"
  },
  "dependencies": { "zod": "^3.24.0" },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "@vitest/coverage-v8": "^3.0.0",
    "eslint": "^9.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"],
  "exclude": ["dist", "node_modules", "test"]
}
```

- [ ] **Step 3: Create eslint.config.js (flat config)**

```js
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  {
    files: ['src/**/*.ts'],
    languageOptions: { parser: tsparser, parserOptions: { project: './tsconfig.json' } },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      'no-console': 'error',
    },
  },
  {
    // CLI presenters may write to stdout; internal logging still uses the logger.
    files: ['src/cli/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
];
```

- [ ] **Step 4: Create vitest.config.ts, .gitignore, placeholder index.ts, README**

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/cli/**', 'src/index.ts', 'src/logging/**'],
      thresholds: { lines: 90 },
    },
  },
});
```

`.gitignore`:

```
node_modules
dist
*.log
.coolify-harness/
coverage
```

`src/index.ts`:

```ts
export {};
```

`README.md`: a stub with title `# coolify-harness` and a line `Pinned Coolify API contract version: v4.1.2`.

- [ ] **Step 5: Install and verify the toolchain**

Run: `cd ~/Projects/coolify-harness-api && pnpm install && pnpm typecheck && pnpm lint && pnpm test`
Expected: install succeeds; typecheck/lint pass; `pnpm test` reports "No test files found" (exit 0 with `--passWithNoTests`? if it errors, add `"test": "vitest run --passWithNoTests"` for now and tighten later — but prefer adding the first real test in Task 2).

- [ ] **Step 6: Commit**

```bash
cd ~/Projects/coolify-harness-api && git add -A && git commit -m "chore: scaffold coolify-harness package"
```

---

### Task 2: Error taxonomy

**Files:**
- Create: `src/errors/index.ts`
- Test: `test/errors.test.ts`

**Interfaces:**
- Produces: error classes imported everywhere. Each extends a shared `CoolifyHarnessError` base with a readonly `code: string`.

```ts
class CoolifyHarnessError extends Error { readonly code: string }
// Subclasses (code in parens):
CoolifyAuthError            // 'COOLIFY_AUTH'
CoolifyAuthScopeError       // 'COOLIFY_AUTH_SCOPE' — carries readonly requiredScope: string
CoolifyNotFoundError        // 'COOLIFY_NOT_FOUND'
CoolifyContractError        // 'COOLIFY_CONTRACT' — carries readonly zodIssues: string
CoolifyBulkUnmarshalError   // 'COOLIFY_BULK_UNMARSHAL'
LockedVarError              // 'LOCKED_VAR' — carries readonly key: string
DuplicateKeyDriftError      // 'DUPLICATE_KEY_DRIFT' — carries readonly keys: string[]
ConfigError                 // 'CONFIG'
MissingTokenError           // 'MISSING_TOKEN' — carries readonly tokenEnv: string
CatalogStaleError           // 'CATALOG_STALE' — carries readonly staleFiles: string[]
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import {
  CoolifyHarnessError,
  CoolifyAuthScopeError,
  MissingTokenError,
  CatalogStaleError,
} from '../src/errors/index.js';

describe('error taxonomy', () => {
  it('subclasses carry a stable code and extend the base', () => {
    const e = new CoolifyAuthScopeError('needs write', { requiredScope: 'write' });
    expect(e).toBeInstanceOf(CoolifyHarnessError);
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe('COOLIFY_AUTH_SCOPE');
    expect(e.requiredScope).toBe('write');
    expect(e.name).toBe('CoolifyAuthScopeError');
  });

  it('carries typed payloads', () => {
    expect(new MissingTokenError('unset', { tokenEnv: 'COOLIFY_PROD_TOKEN' }).tokenEnv).toBe(
      'COOLIFY_PROD_TOKEN',
    );
    expect(new CatalogStaleError('stale', { staleFiles: ['a.md'] }).staleFiles).toEqual(['a.md']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Projects/coolify-harness-api && pnpm vitest run test/errors.test.ts`
Expected: FAIL — cannot find module `../src/errors/index.js`.

- [ ] **Step 3: Write the implementation**

```ts
export class CoolifyHarnessError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class CoolifyAuthError extends CoolifyHarnessError {
  constructor(message: string) { super(message, 'COOLIFY_AUTH'); }
}

export class CoolifyAuthScopeError extends CoolifyHarnessError {
  readonly requiredScope: string;
  constructor(message: string, opts: { requiredScope: string }) {
    super(message, 'COOLIFY_AUTH_SCOPE');
    this.requiredScope = opts.requiredScope;
  }
}

export class CoolifyNotFoundError extends CoolifyHarnessError {
  constructor(message: string) { super(message, 'COOLIFY_NOT_FOUND'); }
}

export class CoolifyContractError extends CoolifyHarnessError {
  readonly zodIssues: string;
  constructor(message: string, opts: { zodIssues: string }) {
    super(message, 'COOLIFY_CONTRACT');
    this.zodIssues = opts.zodIssues;
  }
}

export class CoolifyBulkUnmarshalError extends CoolifyHarnessError {
  constructor(message: string) { super(message, 'COOLIFY_BULK_UNMARSHAL'); }
}

export class LockedVarError extends CoolifyHarnessError {
  readonly key: string;
  constructor(message: string, opts: { key: string }) {
    super(message, 'LOCKED_VAR');
    this.key = opts.key;
  }
}

export class DuplicateKeyDriftError extends CoolifyHarnessError {
  readonly keys: string[];
  constructor(message: string, opts: { keys: string[] }) {
    super(message, 'DUPLICATE_KEY_DRIFT');
    this.keys = opts.keys;
  }
}

export class ConfigError extends CoolifyHarnessError {
  constructor(message: string) { super(message, 'CONFIG'); }
}

export class MissingTokenError extends CoolifyHarnessError {
  readonly tokenEnv: string;
  constructor(message: string, opts: { tokenEnv: string }) {
    super(message, 'MISSING_TOKEN');
    this.tokenEnv = opts.tokenEnv;
  }
}

export class CatalogStaleError extends CoolifyHarnessError {
  readonly staleFiles: string[];
  constructor(message: string, opts: { staleFiles: string[] }) {
    super(message, 'CATALOG_STALE');
    this.staleFiles = opts.staleFiles;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/Projects/coolify-harness-api && pnpm vitest run test/errors.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/coolify-harness-api && git add -A && git commit -m "feat: typed error taxonomy"
```

---

### Task 3: Structured logger with redaction

**Files:**
- Create: `src/logging/index.ts`
- Test: `test/logging.test.ts`

**Interfaces:**
- Produces:

```ts
interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}
function createLogger(opts?: { level?: 'debug' | 'info' | 'warn' | 'error'; sink?: (line: string) => void }): Logger;
function redactSecrets(fields: Record<string, unknown>): Record<string, unknown>;
```

`redactSecrets` replaces the value of any field whose key matches `/token|secret|authorization|bearer|password/i` with `'[REDACTED]'`. `createLogger` emits one JSON line per call (`{ ts, level, msg, ...redactedFields }`), filtered by level, to `sink` (default `process.stdout.write`). This is the only file allowed to touch `process.stdout` in library code; it is `no-console`-clean because it uses `process.stdout.write`, not `console.*`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { createLogger, redactSecrets } from '../src/logging/index.js';

describe('logger', () => {
  it('redacts secret-shaped fields', () => {
    expect(redactSecrets({ token: 'abc', port: 3001 })).toEqual({ token: '[REDACTED]', port: 3001 });
  });

  it('emits one JSON line per call respecting level', () => {
    const lines: string[] = [];
    const log = createLogger({ level: 'info', sink: (l) => lines.push(l) });
    log.debug('hidden');
    log.info('shown', { token: 'secret', key: 'NODE_ENV' });
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed.level).toBe('info');
    expect(parsed.msg).toBe('shown');
    expect(parsed.token).toBe('[REDACTED]');
    expect(parsed.key).toBe('NODE_ENV');
    expect(typeof parsed.ts).toBe('string');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Projects/coolify-harness-api && pnpm vitest run test/logging.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const SECRET_RE = /token|secret|authorization|bearer|password/i;

export function redactSecrets(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = SECRET_RE.test(k) ? '[REDACTED]' : v;
  }
  return out;
}

export function createLogger(
  opts: { level?: Level; sink?: (line: string) => void } = {},
): Logger {
  const level = opts.level ?? 'info';
  const sink = opts.sink ?? ((line: string): void => { process.stdout.write(line + '\n'); });
  const emit = (lvl: Level, msg: string, fields?: Record<string, unknown>): void => {
    if (ORDER[lvl] < ORDER[level]) return;
    const base = { ts: new Date().toISOString(), level: lvl, msg };
    const payload = fields ? { ...base, ...redactSecrets(fields) } : base;
    sink(JSON.stringify(payload));
  };
  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
  };
}

export function noopLogger(): Logger {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/Projects/coolify-harness-api && pnpm vitest run test/logging.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/coolify-harness-api && git add -A && git commit -m "feat: structured logger with secret redaction"
```

---

### Task 4: Config registry + target resolution

**Files:**
- Create: `src/config/schema.ts`
- Create: `src/config/load.ts`
- Test: `test/config.test.ts`

**Interfaces:**
- Consumes: `ConfigError`, `MissingTokenError` from `errors`.
- Produces:

```ts
// schema.ts
const InstanceSchema = z.object({ url: z.string().url(), tokenEnv: z.string().min(1) });
const TargetSchema = z.object({
  instance: z.string().min(1),
  kind: z.enum(['application', 'service']),
  uuid: z.string().min(1),
});
const ProjectRegistrySchema = z.object({
  instances: z.record(InstanceSchema),
  targets: z.record(TargetSchema),
});
type ProjectRegistry = z.infer<typeof ProjectRegistrySchema>;
interface ResolvedTarget {
  instanceUrl: string;
  kind: 'application' | 'service';
  uuid: string;
  token: string;
}

// load.ts
function defineConfig(c: ProjectRegistry): ProjectRegistry;          // identity, for typed authoring
function loadRegistry(raw: unknown): ProjectRegistry;                // Zod-validate a config object
function resolveTarget(
  registry: ProjectRegistry,
  targetName: string,
  env: Record<string, string | undefined>,
): ResolvedTarget;  // throws ConfigError (unknown target/instance) / MissingTokenError (unset tokenEnv)
```

`loadConfig(configPath)` (also exported) dynamically `import()`s the consumer's `coolify-harness.config.ts` default export and runs `loadRegistry`. The pure `loadRegistry` + `resolveTarget` are what tests exercise (no filesystem).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { loadRegistry, resolveTarget, defineConfig } from '../src/config/load.js';
import { ConfigError, MissingTokenError } from '../src/errors/index.js';

const registry = defineConfig({
  instances: { prod: { url: 'https://coolify.example.com', tokenEnv: 'COOLIFY_PROD_TOKEN' } },
  targets: { 'pfi-api': { instance: 'prod', kind: 'application', uuid: 'abc-uuid' } },
});

describe('config', () => {
  it('validates a well-formed registry', () => {
    expect(() => loadRegistry(registry)).not.toThrow();
  });

  it('rejects a malformed registry with ConfigError', () => {
    expect(() => loadRegistry({ instances: {}, targets: { x: { instance: 'p' } } })).toThrow(ConfigError);
  });

  it('resolves a target to instance url + kind + uuid + token', () => {
    const r = resolveTarget(registry, 'pfi-api', { COOLIFY_PROD_TOKEN: 'tok' });
    expect(r).toEqual({ instanceUrl: 'https://coolify.example.com', kind: 'application', uuid: 'abc-uuid', token: 'tok' });
  });

  it('throws ConfigError on unknown target name', () => {
    expect(() => resolveTarget(registry, 'nope', { COOLIFY_PROD_TOKEN: 'tok' })).toThrow(ConfigError);
  });

  it('throws MissingTokenError when the tokenEnv is unset', () => {
    expect(() => resolveTarget(registry, 'pfi-api', {})).toThrow(MissingTokenError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Projects/coolify-harness-api && pnpm vitest run test/config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write schema.ts**

```ts
import { z } from 'zod';

export const InstanceSchema = z.object({
  url: z.string().url(),
  tokenEnv: z.string().min(1),
});

export const TargetSchema = z.object({
  instance: z.string().min(1),
  kind: z.enum(['application', 'service']),
  uuid: z.string().min(1),
});

export const ProjectRegistrySchema = z.object({
  instances: z.record(InstanceSchema),
  targets: z.record(TargetSchema),
});

export type ProjectRegistry = z.infer<typeof ProjectRegistrySchema>;

export interface ResolvedTarget {
  instanceUrl: string;
  kind: 'application' | 'service';
  uuid: string;
  token: string;
}
```

- [ ] **Step 4: Write load.ts**

```ts
import { ProjectRegistrySchema, type ProjectRegistry, type ResolvedTarget } from './schema.js';
import { ConfigError, MissingTokenError } from '../errors/index.js';

export function defineConfig(c: ProjectRegistry): ProjectRegistry {
  return c;
}

export function loadRegistry(raw: unknown): ProjectRegistry {
  const parsed = ProjectRegistrySchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigError(`Invalid coolify-harness config: ${parsed.error.message}`);
  }
  return parsed.data;
}

export function resolveTarget(
  registry: ProjectRegistry,
  targetName: string,
  env: Record<string, string | undefined>,
): ResolvedTarget {
  const target = registry.targets[targetName];
  if (!target) {
    const known = Object.keys(registry.targets).join(', ');
    throw new ConfigError(`Unknown target '${targetName}'. Known targets: ${known}`);
  }
  const instance = registry.instances[target.instance];
  if (!instance) {
    throw new ConfigError(`Target '${targetName}' references unknown instance '${target.instance}'`);
  }
  const token = env[instance.tokenEnv];
  if (token === undefined || token === '') {
    throw new MissingTokenError(
      `Env var '${instance.tokenEnv}' (token for instance '${target.instance}') is not set`,
      { tokenEnv: instance.tokenEnv },
    );
  }
  return { instanceUrl: instance.url, kind: target.kind, uuid: target.uuid, token };
}

export async function loadConfig(configPath: string): Promise<ProjectRegistry> {
  const mod: unknown = await import(configPath);
  const def = (mod as { default?: unknown }).default;
  return loadRegistry(def);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd ~/Projects/coolify-harness-api && pnpm vitest run test/config.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
cd ~/Projects/coolify-harness-api && git add -A && git commit -m "feat: config registry + target resolution"
```

---

### Task 5: Coolify Zod request/response schemas + fixtures

**Files:**
- Create: `src/client/schemas.ts`
- Create: `test/fixtures/coolify/envs-list.json`
- Create: `test/fixtures/coolify/bulk-upsert-response.json`
- Create: `test/fixtures/coolify/deploy-ack-application.json`
- Create: `test/fixtures/coolify/deploy-ack-service.json`
- Create: `test/fixtures/coolify/bulk-unmarshal-error.json`
- Test: `test/client-schemas.test.ts`

**Interfaces:**
- Consumes: `CoolifyContractError` from `errors`.
- Produces:

```ts
const EnvVarSchema;       // env-list item, .passthrough() (comment etc. tolerated)
type EnvVar = { uuid: string; key: string; value: string; is_preview: boolean;
                is_build_time: boolean; is_literal: boolean; is_multiline: boolean;
                is_shown_once: boolean };
const EnvWriteItemSchema; // { key, value, is_preview?, is_build_time?, is_literal?, is_multiline?, is_shown_once? }
type EnvWriteItem = z.infer<typeof EnvWriteItemSchema>;
const BulkRequestSchema;  // { data: EnvWriteItem[] }
const BulkResponseSchema; // EnvVar[]  (.passthrough() per item)
const DeployAckApplicationSchema; // { message: string, deployment_uuid?: string }
const DeployAckServiceSchema;     // { message: string }
type DeployAck = { message: string; deploymentUuid?: string };
function parseOrContractError<T>(schema, raw, ctx): T;  // throws CoolifyContractError on failure
```

Fixtures must reflect Coolify **v4.1.2** shapes, including a nullable `comment` field on env items to prove `.passthrough()` tolerance.

- [ ] **Step 1: Create the fixtures**

`test/fixtures/coolify/envs-list.json` (note `comment` present — proves passthrough):

```json
[
  {
    "uuid": "env-1",
    "key": "NODE_ENV",
    "value": "production",
    "is_preview": false,
    "is_build_time": false,
    "is_literal": false,
    "is_multiline": false,
    "is_shown_once": false,
    "comment": null
  },
  {
    "uuid": "env-2",
    "key": "LOG_LEVEL",
    "value": "info",
    "is_preview": false,
    "is_build_time": false,
    "is_literal": false,
    "is_multiline": false,
    "is_shown_once": false,
    "comment": "set by ops"
  }
]
```

`test/fixtures/coolify/bulk-upsert-response.json`:

```json
[
  {
    "uuid": "env-1",
    "key": "NODE_ENV",
    "value": "production",
    "is_preview": false,
    "is_build_time": false,
    "is_literal": false,
    "is_multiline": false,
    "is_shown_once": false
  }
]
```

`test/fixtures/coolify/deploy-ack-application.json`:

```json
{ "message": "Deployment request queued.", "deployment_uuid": "deploy-123" }
```

`test/fixtures/coolify/deploy-ack-service.json`:

```json
{ "message": "Service restart request queued." }
```

`test/fixtures/coolify/bulk-unmarshal-error.json`:

```json
{ "message": "cannot unmarshal array into Go value of type ..." }
```

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  EnvVarSchema,
  BulkResponseSchema,
  DeployAckApplicationSchema,
  DeployAckServiceSchema,
  parseOrContractError,
} from '../src/client/schemas.js';
import { CoolifyContractError } from '../src/errors/index.js';

const fx = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/coolify/${name}`, import.meta.url)), 'utf8'));

describe('coolify schemas', () => {
  it('parses an env-list item including an extra comment field (passthrough)', () => {
    const list = fx('envs-list.json') as unknown[];
    const item = EnvVarSchema.parse(list[0]);
    expect(item.key).toBe('NODE_ENV');
    expect(item.is_build_time).toBe(false);
  });

  it('parses the application deploy ack with deployment_uuid', () => {
    const ack = DeployAckApplicationSchema.parse(fx('deploy-ack-application.json'));
    expect(ack.deployment_uuid).toBe('deploy-123');
  });

  it('parses the service deploy ack without deployment_uuid', () => {
    const ack = DeployAckServiceSchema.parse(fx('deploy-ack-service.json'));
    expect('deployment_uuid' in ack).toBe(false);
  });

  it('parseOrContractError throws CoolifyContractError on shape mismatch', () => {
    expect(() => parseOrContractError(BulkResponseSchema, { not: 'an array' }, 'bulk')).toThrow(
      CoolifyContractError,
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd ~/Projects/coolify-harness-api && pnpm vitest run test/client-schemas.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write schemas.ts**

```ts
import { z } from 'zod';
import { CoolifyContractError } from '../errors/index.js';

export const EnvVarSchema = z
  .object({
    uuid: z.string(),
    key: z.string(),
    value: z.string(),
    is_preview: z.boolean(),
    is_build_time: z.boolean(),
    is_literal: z.boolean(),
    is_multiline: z.boolean(),
    is_shown_once: z.boolean(),
  })
  .passthrough();
export type EnvVar = z.infer<typeof EnvVarSchema>;

export const EnvWriteItemSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
  is_preview: z.boolean().optional(),
  is_build_time: z.boolean().optional(),
  is_literal: z.boolean().optional(),
  is_multiline: z.boolean().optional(),
  is_shown_once: z.boolean().optional(),
});
export type EnvWriteItem = z.infer<typeof EnvWriteItemSchema>;

export const BulkRequestSchema = z.object({ data: z.array(EnvWriteItemSchema) });
export type BulkRequest = z.infer<typeof BulkRequestSchema>;

export const BulkResponseSchema = z.array(EnvVarSchema);

export const DeployAckApplicationSchema = z
  .object({ message: z.string(), deployment_uuid: z.string().optional() })
  .passthrough();
export const DeployAckServiceSchema = z.object({ message: z.string() }).passthrough();

export interface DeployAck {
  message: string;
  deploymentUuid?: string;
}

export function parseOrContractError<T>(schema: z.ZodType<T>, raw: unknown, ctx: string): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new CoolifyContractError(`Coolify response (${ctx}) failed contract validation`, {
      zodIssues: parsed.error.message,
    });
  }
  return parsed.data;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd ~/Projects/coolify-harness-api && pnpm vitest run test/client-schemas.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
cd ~/Projects/coolify-harness-api && git add -A && git commit -m "feat: coolify request/response schemas + v4.1.2 fixtures"
```

---

### Task 6: Circuit breaker

**Files:**
- Create: `src/client/http.ts` (breaker portion)
- Test: `test/circuit-breaker.test.ts`

**Interfaces:**
- Produces:

```ts
interface CircuitBreakerOptions { failureThreshold: number; resetTimeoutMs: number; now?: () => number }
class CircuitBreaker {
  constructor(opts: CircuitBreakerOptions);
  get state(): 'closed' | 'open' | 'half-open';
  canRequest(): boolean;
  recordSuccess(): void;
  recordFailure(): void;
}
```

Opens after `failureThreshold` consecutive failures. After `resetTimeoutMs`, `canRequest()` returns true once (half-open probe). A success in half-open closes; a failure re-opens. `now` is injectable for deterministic tests.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { CircuitBreaker } from '../src/client/http.js';

describe('CircuitBreaker', () => {
  it('opens after the failure threshold and blocks requests', () => {
    let t = 0;
    const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 1000, now: () => t });
    expect(cb.canRequest()).toBe(true);
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.state).toBe('open');
    expect(cb.canRequest()).toBe(false);
  });

  it('half-opens after the reset timeout and closes on a probe success', () => {
    let t = 0;
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1000, now: () => t });
    cb.recordFailure();
    expect(cb.canRequest()).toBe(false);
    t = 1001;
    expect(cb.canRequest()).toBe(true);
    expect(cb.state).toBe('half-open');
    cb.recordSuccess();
    expect(cb.state).toBe('closed');
  });

  it('re-opens if the half-open probe fails', () => {
    let t = 0;
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1000, now: () => t });
    cb.recordFailure();
    t = 1001;
    expect(cb.canRequest()).toBe(true);
    cb.recordFailure();
    expect(cb.state).toBe('open');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Projects/coolify-harness-api && pnpm vitest run test/circuit-breaker.test.ts`
Expected: FAIL — module not found / `CircuitBreaker` not exported.

- [ ] **Step 3: Write the breaker in http.ts**

```ts
export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeoutMs: number;
  now?: () => number;
}

type BreakerState = 'closed' | 'open' | 'half-open';

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private internalState: BreakerState = 'closed';
  private readonly now: () => number;

  constructor(private readonly opts: CircuitBreakerOptions) {
    this.now = opts.now ?? ((): number => Date.now());
  }

  get state(): BreakerState {
    return this.internalState;
  }

  canRequest(): boolean {
    if (this.internalState === 'open') {
      if (this.now() - this.openedAt >= this.opts.resetTimeoutMs) {
        this.internalState = 'half-open';
        return true;
      }
      return false;
    }
    return true;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.internalState = 'closed';
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.internalState === 'half-open' || this.failures >= this.opts.failureThreshold) {
      this.internalState = 'open';
      this.openedAt = this.now();
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/Projects/coolify-harness-api && pnpm vitest run test/circuit-breaker.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/coolify-harness-api && git add -A && git commit -m "feat: hand-rolled circuit breaker"
```

---

### Task 7: retryWithBackoff + httpRequest transport

**Files:**
- Modify: `src/client/http.ts` (add retry + httpRequest)
- Test: `test/http-request.test.ts`

**Interfaces:**
- Consumes: `CircuitBreaker` (Task 6); `CoolifyAuthError`, `CoolifyNotFoundError`, `CoolifyBulkUnmarshalError` from `errors`; `Logger` from `logging`.
- Produces:

```ts
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
interface HttpRequestOptions {
  fetchImpl: FetchLike;
  breaker: CircuitBreaker;
  logger: Logger;
  maxRetries?: number;   // default 3
  backoffBaseMs?: number; // default 50 (small for tests; CLI uses larger)
  sleep?: (ms: number) => Promise<void>; // injectable; default real
}
interface HttpResult { status: number; body: unknown }
async function httpRequest(
  url: string,
  init: { method: string; token: string; jsonBody?: unknown },
  opts: HttpRequestOptions,
): Promise<HttpResult>;
```

Behavior:
- Injects `Authorization: Bearer <token>` (token never logged — log line uses field-count, not body).
- Retries on: network throw, HTTP 5xx, HTTP 429 (honour `Retry-After` header seconds), and a 4xx/5xx body containing `cannot unmarshal array`.
- Terminal (no retry): 401/403 → caller maps to auth errors; 404 → caller maps to not-found; other 4xx.
- On 429 honour `Retry-After` (seconds) when present, else backoff.
- On retry exhaustion of the unmarshal quirk specifically, throw `CoolifyBulkUnmarshalError`.
- Records breaker success/failure; if `breaker.canRequest()` is false, throw immediately (a plain `Error` with a clear message — circuit open).
- Returns `{ status, body }` where `body` is the parsed JSON (or `undefined` for empty bodies). Schema validation is the caller's job (the `CoolifyClient`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { CircuitBreaker, httpRequest } from '../src/client/http.js';
import { noopLogger } from '../src/logging/index.js';
import { CoolifyBulkUnmarshalError } from '../src/errors/index.js';

const mkResponse = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const baseOpts = (fetchImpl: typeof fetch) => ({
  fetchImpl: fetchImpl as unknown as (u: string, i: RequestInit) => Promise<Response>,
  breaker: new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 1000, now: () => 0 }),
  logger: noopLogger(),
  backoffBaseMs: 1,
  sleep: async () => {},
});

describe('httpRequest', () => {
  it('returns parsed body on 200', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mkResponse(200, [{ key: 'X' }]));
    const res = await httpRequest('https://c/x', { method: 'GET', token: 't' }, baseOpts(fetchImpl as unknown as typeof fetch));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ key: 'X' }]);
    // token is sent as a Bearer header
    const init = (fetchImpl.mock.calls[0]![1]) as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t');
  });

  it('retries on 5xx then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mkResponse(503, { message: 'down' }))
      .mockResolvedValueOnce(mkResponse(200, { ok: true }));
    const res = await httpRequest('https://c/x', { method: 'GET', token: 't' }, baseOpts(fetchImpl as unknown as typeof fetch));
    expect(res.body).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('retries the bulk-unmarshal quirk then throws CoolifyBulkUnmarshalError on exhaustion', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mkResponse(500, { message: 'cannot unmarshal array into Go value' }));
    await expect(
      httpRequest('https://c/x', { method: 'PATCH', token: 't', jsonBody: { data: [] } }, { ...baseOpts(fetchImpl as unknown as typeof fetch), maxRetries: 2 }),
    ).rejects.toBeInstanceOf(CoolifyBulkUnmarshalError);
  });

  it('does not retry a 401', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mkResponse(401, { message: 'unauthorized' }));
    const res = await httpRequest('https://c/x', { method: 'GET', token: 't' }, baseOpts(fetchImpl as unknown as typeof fetch));
    expect(res.status).toBe(401);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Projects/coolify-harness-api && pnpm vitest run test/http-request.test.ts`
Expected: FAIL — `httpRequest` not exported.

- [ ] **Step 3: Implement retry + httpRequest in http.ts**

Append to `http.ts`:

```ts
import { CoolifyBulkUnmarshalError } from '../errors/index.js';
import type { Logger } from '../logging/index.js';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface HttpRequestOptions {
  fetchImpl: FetchLike;
  breaker: CircuitBreaker;
  logger: Logger;
  maxRetries?: number;
  backoffBaseMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface HttpResult {
  status: number;
  body: unknown;
}

const UNMARSHAL_RE = /cannot unmarshal array/i;
const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function bodyHasUnmarshalQuirk(body: unknown): boolean {
  if (body && typeof body === 'object' && 'message' in body) {
    const msg = (body as { message: unknown }).message;
    return typeof msg === 'string' && UNMARSHAL_RE.test(msg);
  }
  return false;
}

export async function httpRequest(
  url: string,
  init: { method: string; token: string; jsonBody?: unknown },
  opts: HttpRequestOptions,
): Promise<HttpResult> {
  const { fetchImpl, breaker, logger } = opts;
  const maxRetries = opts.maxRetries ?? 3;
  const backoffBaseMs = opts.backoffBaseMs ?? 50;
  const sleep = opts.sleep ?? defaultSleep;

  if (!breaker.canRequest()) {
    throw new Error(`Circuit open for ${url}; refusing request`);
  }

  let lastUnmarshal = false;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const headers: Record<string, string> = { Authorization: `Bearer ${init.token}` };
    let requestInit: RequestInit = { method: init.method, headers };
    if (init.jsonBody !== undefined) {
      headers['content-type'] = 'application/json';
      requestInit = { ...requestInit, body: JSON.stringify(init.jsonBody) };
    }
    logger.debug('coolify.request', {
      url,
      method: init.method,
      attempt,
      bodyFieldCount: init.jsonBody && typeof init.jsonBody === 'object'
        ? Object.keys(init.jsonBody).length
        : 0,
    });

    let response: Response;
    try {
      response = await fetchImpl(url, requestInit);
    } catch (err) {
      breaker.recordFailure();
      if (attempt < maxRetries) {
        await sleep(backoffBaseMs * 2 ** attempt);
        continue;
      }
      throw err instanceof Error ? err : new Error(String(err));
    }

    const status = response.status;
    const text = await response.text();
    const body: unknown = text.length > 0 ? JSON.parse(text) : undefined;

    if (status >= 200 && status < 300) {
      breaker.recordSuccess();
      return { status, body };
    }

    // Terminal 4xx (except 429): no retry, return to caller for typed-error mapping.
    if (status >= 400 && status < 500 && status !== 429) {
      if (!bodyHasUnmarshalQuirk(body)) {
        breaker.recordSuccess(); // a definitive answer from upstream is not a transport failure
        return { status, body };
      }
    }

    breaker.recordFailure();
    lastUnmarshal = bodyHasUnmarshalQuirk(body);
    if (attempt < maxRetries) {
      const retryAfter = response.headers.get('retry-after');
      const waitMs =
        status === 429 && retryAfter ? Number(retryAfter) * 1000 : backoffBaseMs * 2 ** attempt;
      await sleep(Number.isFinite(waitMs) ? waitMs : backoffBaseMs * 2 ** attempt);
      continue;
    }

    if (lastUnmarshal) {
      throw new CoolifyBulkUnmarshalError('Coolify bulk endpoint returned the unmarshal-array quirk after retries');
    }
    return { status, body };
  }
  // Unreachable, but the type system needs a return.
  throw new Error('httpRequest exhausted without resolution');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/Projects/coolify-harness-api && pnpm vitest run test/http-request.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/coolify-harness-api && git add -A && git commit -m "feat: retry-with-backoff transport over native fetch"
```

---

### Task 8: CoolifyClient

**Files:**
- Create: `src/client/coolify.ts`
- Test: `test/coolify-client.test.ts`

**Interfaces:**
- Consumes: `ResolvedTarget` (config); `httpRequest`, `CircuitBreaker`, `FetchLike` (http); schemas + `parseOrContractError` + `EnvVar` + `EnvWriteItem` + `DeployAck` (schemas); `Logger`; auth/scope/not-found errors.
- Produces:

```ts
interface CoolifyClientDeps { fetchImpl: FetchLike; logger: Logger; breaker?: CircuitBreaker;
  maxRetries?: number; backoffBaseMs?: number; sleep?: (ms: number) => Promise<void> }
class CoolifyClient {
  constructor(target: ResolvedTarget, deps: CoolifyClientDeps);
  listEnvs(): Promise<EnvVar[]>;
  upsertEnvs(items: EnvWriteItem[]): Promise<EnvVar[]>;  // bulk PATCH, the only write path
  deploy(): Promise<DeployAck>;
  restart(): Promise<DeployAck>;
}
```

URL construction uses the resource kind: `${instanceUrl}/api/v1/${kind === 'application' ? 'applications' : 'services'}/${uuid}/...`. `deploy`/`restart` parse with `DeployAckApplicationSchema` for applications and `DeployAckServiceSchema` for services, normalizing to `{ message, deploymentUuid? }`. Status→error mapping: 401/403 → `CoolifyAuthError`; 404 → `CoolifyNotFoundError`. (Scope-specific 403 messages are refined into `CoolifyAuthScopeError` in Task 18's CLI layer where the required scope per operation is known; the client throws the generic `CoolifyAuthError` here.)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CoolifyClient } from '../src/client/coolify.js';
import { noopLogger } from '../src/logging/index.js';
import { CoolifyAuthError, CoolifyNotFoundError } from '../src/errors/index.js';
import type { ResolvedTarget } from '../src/config/schema.js';

const fxText = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/coolify/${name}`, import.meta.url)), 'utf8');
const resp = (status: number, text: string): Response =>
  new Response(text, { status, headers: { 'content-type': 'application/json' } });

const appTarget: ResolvedTarget = { instanceUrl: 'https://c.example.com', kind: 'application', uuid: 'app-1', token: 'tok' };
const svcTarget: ResolvedTarget = { instanceUrl: 'https://c.example.com', kind: 'service', uuid: 'svc-1', token: 'tok' };
const deps = (fetchImpl: ReturnType<typeof vi.fn>) => ({
  fetchImpl: fetchImpl as unknown as (u: string, i: RequestInit) => Promise<Response>,
  logger: noopLogger(),
  backoffBaseMs: 1,
  sleep: async () => {},
});

describe('CoolifyClient', () => {
  it('lists envs hitting the applications endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(resp(200, fxText('envs-list.json')));
    const client = new CoolifyClient(appTarget, deps(fetchImpl));
    const envs = await client.listEnvs();
    expect(envs).toHaveLength(2);
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://c.example.com/api/v1/applications/app-1/envs');
  });

  it('upsertEnvs PATCHes the bulk endpoint with { data: [...] }', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(resp(200, fxText('bulk-upsert-response.json')));
    const client = new CoolifyClient(appTarget, deps(fetchImpl));
    await client.upsertEnvs([{ key: 'NODE_ENV', value: 'production' }]);
    const [url, init] = fetchImpl.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('https://c.example.com/api/v1/applications/app-1/envs/bulk');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ data: [{ key: 'NODE_ENV', value: 'production' }] });
  });

  it('deploy on an application returns deploymentUuid', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(resp(200, fxText('deploy-ack-application.json')));
    const ack = await new CoolifyClient(appTarget, deps(fetchImpl)).deploy();
    expect(ack.deploymentUuid).toBe('deploy-123');
  });

  it('restart on a service returns no deploymentUuid and hits the services endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(resp(200, fxText('deploy-ack-service.json')));
    const ack = await new CoolifyClient(svcTarget, deps(fetchImpl)).restart();
    expect(ack.deploymentUuid).toBeUndefined();
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://c.example.com/api/v1/services/svc-1/restart');
  });

  it('maps 401 to CoolifyAuthError and 404 to CoolifyNotFoundError', async () => {
    const f401 = vi.fn().mockResolvedValue(resp(401, JSON.stringify({ message: 'no' })));
    await expect(new CoolifyClient(appTarget, deps(f401)).listEnvs()).rejects.toBeInstanceOf(CoolifyAuthError);
    const f404 = vi.fn().mockResolvedValue(resp(404, JSON.stringify({ message: 'gone' })));
    await expect(new CoolifyClient(appTarget, deps(f404)).listEnvs()).rejects.toBeInstanceOf(CoolifyNotFoundError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Projects/coolify-harness-api && pnpm vitest run test/coolify-client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write coolify.ts**

```ts
import type { ResolvedTarget } from '../config/schema.js';
import { CircuitBreaker, httpRequest, type FetchLike, type HttpResult } from './http.js';
import type { Logger } from '../logging/index.js';
import {
  BulkResponseSchema,
  DeployAckApplicationSchema,
  DeployAckServiceSchema,
  EnvVarSchema,
  parseOrContractError,
  type DeployAck,
  type EnvVar,
  type EnvWriteItem,
} from './schemas.js';
import { CoolifyAuthError, CoolifyNotFoundError } from '../errors/index.js';
import { z } from 'zod';

export interface CoolifyClientDeps {
  fetchImpl: FetchLike;
  logger: Logger;
  breaker?: CircuitBreaker;
  maxRetries?: number;
  backoffBaseMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class CoolifyClient {
  private readonly breaker: CircuitBreaker;
  constructor(
    private readonly target: ResolvedTarget,
    private readonly deps: CoolifyClientDeps,
  ) {
    this.breaker = deps.breaker ?? new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 30_000 });
  }

  private base(): string {
    const family = this.target.kind === 'application' ? 'applications' : 'services';
    return `${this.target.instanceUrl}/api/v1/${family}/${this.target.uuid}`;
  }

  private async request(path: string, method: string, jsonBody?: unknown): Promise<HttpResult> {
    const res = await httpRequest(
      `${this.base()}${path}`,
      jsonBody === undefined
        ? { method, token: this.target.token }
        : { method, token: this.target.token, jsonBody },
      {
        fetchImpl: this.deps.fetchImpl,
        logger: this.deps.logger,
        breaker: this.breaker,
        ...(this.deps.maxRetries !== undefined ? { maxRetries: this.deps.maxRetries } : {}),
        ...(this.deps.backoffBaseMs !== undefined ? { backoffBaseMs: this.deps.backoffBaseMs } : {}),
        ...(this.deps.sleep !== undefined ? { sleep: this.deps.sleep } : {}),
      },
    );
    this.assertOk(res, path);
    return res;
  }

  private assertOk(res: HttpResult, ctx: string): void {
    if (res.status === 401 || res.status === 403) {
      throw new CoolifyAuthError(`Coolify auth failed (${res.status}) on ${ctx}`);
    }
    if (res.status === 404) {
      throw new CoolifyNotFoundError(`Coolify resource not found (404) on ${ctx}`);
    }
    if (res.status >= 400) {
      throw new Error(`Coolify request to ${ctx} failed with status ${res.status}`);
    }
  }

  async listEnvs(): Promise<EnvVar[]> {
    const res = await this.request('/envs', 'GET');
    return parseOrContractError(BulkResponseSchema, res.body, 'listEnvs');
  }

  async upsertEnvs(items: EnvWriteItem[]): Promise<EnvVar[]> {
    const res = await this.request('/envs/bulk', 'PATCH', { data: items });
    return parseOrContractError(BulkResponseSchema, res.body, 'upsertEnvs');
  }

  async deploy(): Promise<DeployAck> {
    return this.ackFor(await this.request('/start', 'POST'), 'deploy');
  }

  async restart(): Promise<DeployAck> {
    return this.ackFor(await this.request('/restart', 'POST'), 'restart');
  }

  private ackFor(res: HttpResult, ctx: string): DeployAck {
    if (this.target.kind === 'application') {
      const parsed = parseOrContractError(DeployAckApplicationSchema, res.body, ctx) as z.infer<
        typeof DeployAckApplicationSchema
      >;
      return parsed.deployment_uuid === undefined
        ? { message: parsed.message }
        : { message: parsed.message, deploymentUuid: parsed.deployment_uuid };
    }
    const parsed = parseOrContractError(DeployAckServiceSchema, res.body, ctx);
    return { message: parsed.message };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/Projects/coolify-harness-api && pnpm vitest run test/coolify-client.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/coolify-harness-api && git add -A && git commit -m "feat: CoolifyClient (list/upsert/deploy/restart, kind-aware)"
```

---

### Task 9: planEnvWrite (pure planner)

**Files:**
- Create: `src/client/safe-write.ts` (planner portion)
- Test: `test/plan-env-write.test.ts`

**Interfaces:**
- Consumes: `EnvVar`, `EnvWriteItem` from schemas.
- Produces:

```ts
interface DesiredEnv { values: Record<string, string>; flags?: Record<string, Partial<EnvFlags>> }
interface EnvFlags { is_preview: boolean; is_build_time: boolean; is_literal: boolean;
  is_multiline: boolean; is_shown_once: boolean }
interface DuplicateKeyDrift { key: string; values: string[] }
interface LockedVarSkip { key: string; reason: string }
interface PlanWarning { kind: string; message: string }
interface EnvWritePlan {
  readonly creates: EnvWriteItem[];
  readonly updates: EnvWriteItem[];
  readonly unchanged: string[];
  readonly duplicateKeyDrift: DuplicateKeyDrift[];
  readonly lockedSkips: LockedVarSkip[];
  readonly warnings: PlanWarning[];
}
function planEnvWrite(current: EnvVar[], desired: DesiredEnv): EnvWritePlan;
```

Rules (the encoded Coolify invariants):
1. A key not present upstream and in `desired.values` → `creates`.
2. A key present upstream with a differing value → `updates`. Same value → `unchanged`.
3. Any key with >1 upstream row AND divergent values → `duplicateKeyDrift` (surfaced even if not being written).
4. When writing a key that has duplicate upstream rows, emit ONE upsert item setting all copies to the same desired value (set-all-copies-to-same-value); add a `PlanWarning` noting the repair.
5. There is no delete path. `DesiredEnv` has no "remove" concept in v1; a future delete request surfaces as a `LockedVarSkip`. (No delete input exists in this signature — `lockedSkips` stays empty in v1 and exists for forward-compat; the CLI never feeds a delete.)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { planEnvWrite } from '../src/client/safe-write.js';
import type { EnvVar } from '../src/client/schemas.js';

const ev = (key: string, value: string, uuid = key): EnvVar => ({
  uuid, key, value, is_preview: false, is_build_time: false, is_literal: false,
  is_multiline: false, is_shown_once: false,
});

describe('planEnvWrite', () => {
  it('classifies creates / updates / unchanged', () => {
    const current = [ev('A', '1'), ev('B', '2')];
    const plan = planEnvWrite(current, { values: { A: '1', B: '9', C: '3' } });
    expect(plan.unchanged).toEqual(['A']);
    expect(plan.updates).toEqual([{ key: 'B', value: '9' }]);
    expect(plan.creates).toEqual([{ key: 'C', value: '3' }]);
  });

  it('detects duplicate-key drift even for keys not being written', () => {
    const current = [ev('A', '1', 'u1'), ev('A', '2', 'u2'), ev('B', '5')];
    const plan = planEnvWrite(current, { values: { B: '5' } });
    expect(plan.duplicateKeyDrift).toEqual([{ key: 'A', values: ['1', '2'] }]);
  });

  it('repairs duplicate-key drift on write by setting all copies to the same value', () => {
    const current = [ev('A', '1', 'u1'), ev('A', '2', 'u2')];
    const plan = planEnvWrite(current, { values: { A: '7' } });
    expect(plan.updates).toEqual([{ key: 'A', value: '7' }]);
    expect(plan.warnings.some((w) => w.kind === 'duplicate-key-repair')).toBe(true);
  });

  it('threads flag overrides into the write item', () => {
    const plan = planEnvWrite([], { values: { K: 'pem' }, flags: { K: { is_multiline: true } } });
    expect(plan.creates).toEqual([{ key: 'K', value: 'pem', is_multiline: true }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Projects/coolify-harness-api && pnpm vitest run test/plan-env-write.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the planner in safe-write.ts**

```ts
import type { EnvVar, EnvWriteItem } from './schemas.js';

export interface EnvFlags {
  is_preview: boolean;
  is_build_time: boolean;
  is_literal: boolean;
  is_multiline: boolean;
  is_shown_once: boolean;
}

export interface DesiredEnv {
  values: Record<string, string>;
  flags?: Record<string, Partial<EnvFlags>>;
}

export interface DuplicateKeyDrift {
  key: string;
  values: string[];
}

export interface LockedVarSkip {
  key: string;
  reason: string;
}

export interface PlanWarning {
  kind: string;
  message: string;
}

export interface EnvWritePlan {
  readonly creates: EnvWriteItem[];
  readonly updates: EnvWriteItem[];
  readonly unchanged: string[];
  readonly duplicateKeyDrift: DuplicateKeyDrift[];
  readonly lockedSkips: LockedVarSkip[];
  readonly warnings: PlanWarning[];
}

function groupByKey(current: EnvVar[]): Map<string, EnvVar[]> {
  const map = new Map<string, EnvVar[]>();
  for (const row of current) {
    const existing = map.get(row.key);
    if (existing) existing.push(row);
    else map.set(row.key, [row]);
  }
  return map;
}

function withFlags(key: string, value: string, desired: DesiredEnv): EnvWriteItem {
  const flags = desired.flags?.[key];
  return flags ? { key, value, ...flags } : { key, value };
}

export function planEnvWrite(current: EnvVar[], desired: DesiredEnv): EnvWritePlan {
  const byKey = groupByKey(current);
  const creates: EnvWriteItem[] = [];
  const updates: EnvWriteItem[] = [];
  const unchanged: string[] = [];
  const duplicateKeyDrift: DuplicateKeyDrift[] = [];
  const warnings: PlanWarning[] = [];

  // Surface ALL duplicate-key drift, write or not.
  for (const [key, rows] of byKey) {
    if (rows.length > 1) {
      const values = rows.map((r) => r.value);
      if (new Set(values).size > 1) {
        duplicateKeyDrift.push({ key, values });
      }
    }
  }

  for (const [key, value] of Object.entries(desired.values)) {
    const rows = byKey.get(key);
    if (!rows || rows.length === 0) {
      creates.push(withFlags(key, value, desired));
      continue;
    }
    const allSame = rows.every((r) => r.value === value);
    if (allSame && rows.length === 1) {
      unchanged.push(key);
      continue;
    }
    if (rows.length > 1) {
      warnings.push({
        kind: 'duplicate-key-repair',
        message: `Key '${key}' has ${rows.length} upstream rows; writing sets all copies to one value`,
      });
    }
    updates.push(withFlags(key, value, desired));
  }

  return { creates, updates, unchanged, duplicateKeyDrift, lockedSkips: [], warnings };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/Projects/coolify-harness-api && pnpm vitest run test/plan-env-write.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/coolify-harness-api && git add -A && git commit -m "feat: pure planEnvWrite with duplicate-key drift detection + repair"
```

---

### Task 10: applyEnvWrite (effectful) + audit record

**Files:**
- Modify: `src/client/safe-write.ts` (add applier + audit)
- Test: `test/apply-env-write.test.ts`

**Interfaces:**
- Consumes: `CoolifyClient` (the `upsertEnvs`/`listEnvs` surface, structurally typed so a fake satisfies it), `EnvWritePlan`, `Logger`.
- Produces:

```ts
interface AuditRecord {
  ts: string; actor: string; instanceUrl: string;
  resourceKind: 'application' | 'service'; resourceUuid: string;
  action: 'env.apply' | 'deploy' | 'restart';
  planSummary: { creates: number; updates: number; unchanged: number; duplicateKeyDrift: number };
  keysAffected: string[]; outcome: 'success' | 'failure'; error?: string;
}
interface EnvWriteResult { applied: EnvWriteItem[]; confirmed: boolean; audit: AuditRecord }
interface ApplyDeps {
  client: Pick<CoolifyClient, 'upsertEnvs' | 'listEnvs'>;
  logger: Logger;
  target: { instanceUrl: string; kind: 'application' | 'service'; uuid: string };
  actor: string;
  writeAudit: (record: AuditRecord) => Promise<void>;  // JSONL sink, injected
  now?: () => Date;
}
async function applyEnvWrite(plan: EnvWritePlan, deps: ApplyDeps): Promise<EnvWriteResult>;
function buildAuditRecord(...): AuditRecord;  // exported for the deploy/restart audit path
```

`applyEnvWrite`: combines `creates + updates`; if empty, no-ops with a success audit (`keysAffected: []`). Otherwise calls `client.upsertEnvs(items)`, re-reads via `listEnvs`, sets `confirmed` true iff every written key now matches its desired value. Emits the audit record through `logger.info` AND `writeAudit`. **Never** records values — `keysAffected` is keys only. On `upsertEnvs` throw, writes a `failure` audit (re-throwing the original error after).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { applyEnvWrite } from '../src/client/safe-write.js';
import { noopLogger } from '../src/logging/index.js';
import type { EnvVar } from '../src/client/schemas.js';
import type { EnvWritePlan } from '../src/client/safe-write.js';

const ev = (key: string, value: string): EnvVar => ({
  uuid: key, key, value, is_preview: false, is_build_time: false, is_literal: false,
  is_multiline: false, is_shown_once: false,
});

const plan: EnvWritePlan = {
  creates: [{ key: 'C', value: '3' }],
  updates: [{ key: 'B', value: '9' }],
  unchanged: ['A'], duplicateKeyDrift: [], lockedSkips: [], warnings: [],
};

describe('applyEnvWrite', () => {
  it('upserts creates+updates, re-reads to confirm, and writes a keys-only audit', async () => {
    const upsertEnvs = vi.fn().mockResolvedValue([]);
    const listEnvs = vi.fn().mockResolvedValue([ev('A', '1'), ev('B', '9'), ev('C', '3')]);
    const writeAudit = vi.fn().mockResolvedValue(undefined);
    const result = await applyEnvWrite(plan, {
      client: { upsertEnvs, listEnvs },
      logger: noopLogger(),
      target: { instanceUrl: 'https://c', kind: 'application', uuid: 'app-1' },
      actor: 'ci', writeAudit, now: () => new Date('2026-06-17T00:00:00Z'),
    });
    expect(upsertEnvs).toHaveBeenCalledWith([{ key: 'C', value: '3' }, { key: 'B', value: '9' }]);
    expect(result.confirmed).toBe(true);
    expect(result.audit.outcome).toBe('success');
    expect(result.audit.keysAffected.sort()).toEqual(['B', 'C']);
    // values never recorded
    expect(JSON.stringify(result.audit)).not.toContain('"9"');
    expect(writeAudit).toHaveBeenCalledOnce();
  });

  it('writes a failure audit and rethrows on upsert error', async () => {
    const upsertEnvs = vi.fn().mockRejectedValue(new Error('boom'));
    const writeAudit = vi.fn().mockResolvedValue(undefined);
    await expect(
      applyEnvWrite(plan, {
        client: { upsertEnvs, listEnvs: vi.fn() },
        logger: noopLogger(),
        target: { instanceUrl: 'https://c', kind: 'application', uuid: 'app-1' },
        actor: 'ci', writeAudit, now: () => new Date('2026-06-17T00:00:00Z'),
      }),
    ).rejects.toThrow('boom');
    expect(writeAudit.mock.calls[0]![0].outcome).toBe('failure');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Projects/coolify-harness-api && pnpm vitest run test/apply-env-write.test.ts`
Expected: FAIL — `applyEnvWrite` not exported.

- [ ] **Step 3: Append the applier to safe-write.ts**

```ts
import type { Logger } from '../logging/index.js';
import type { CoolifyClient } from './coolify.js';

export interface AuditRecord {
  ts: string;
  actor: string;
  instanceUrl: string;
  resourceKind: 'application' | 'service';
  resourceUuid: string;
  action: 'env.apply' | 'deploy' | 'restart';
  planSummary: { creates: number; updates: number; unchanged: number; duplicateKeyDrift: number };
  keysAffected: string[];
  outcome: 'success' | 'failure';
  error?: string;
}

export interface EnvWriteResult {
  applied: EnvWriteItem[];
  confirmed: boolean;
  audit: AuditRecord;
}

export interface ApplyDeps {
  client: Pick<CoolifyClient, 'upsertEnvs' | 'listEnvs'>;
  logger: Logger;
  target: { instanceUrl: string; kind: 'application' | 'service'; uuid: string };
  actor: string;
  writeAudit: (record: AuditRecord) => Promise<void>;
  now?: () => Date;
}

export function buildAuditRecord(args: {
  now: Date;
  actor: string;
  target: ApplyDeps['target'];
  action: AuditRecord['action'];
  plan: EnvWritePlan;
  keysAffected: string[];
  outcome: AuditRecord['outcome'];
  error?: string;
}): AuditRecord {
  const base: AuditRecord = {
    ts: args.now.toISOString(),
    actor: args.actor,
    instanceUrl: args.target.instanceUrl,
    resourceKind: args.target.kind,
    resourceUuid: args.target.uuid,
    action: args.action,
    planSummary: {
      creates: args.plan.creates.length,
      updates: args.plan.updates.length,
      unchanged: args.plan.unchanged.length,
      duplicateKeyDrift: args.plan.duplicateKeyDrift.length,
    },
    keysAffected: args.keysAffected,
    outcome: args.outcome,
  };
  return args.error === undefined ? base : { ...base, error: args.error };
}

export async function applyEnvWrite(plan: EnvWritePlan, deps: ApplyDeps): Promise<EnvWriteResult> {
  const now = (deps.now ?? ((): Date => new Date()))();
  const items = [...plan.creates, ...plan.updates];
  const keysAffected = items.map((i) => i.key);

  if (items.length === 0) {
    const audit = buildAuditRecord({
      now, actor: deps.actor, target: deps.target, action: 'env.apply', plan,
      keysAffected: [], outcome: 'success',
    });
    deps.logger.info('coolify.env.apply', { action: 'env.apply', keysAffected: [] });
    await deps.writeAudit(audit);
    return { applied: [], confirmed: true, audit };
  }

  try {
    await deps.client.upsertEnvs(items);
    const after = await deps.client.listEnvs();
    const byKey = new Map(after.map((e) => [e.key, e.value]));
    const confirmed = items.every((i) => byKey.get(i.key) === i.value);
    const audit = buildAuditRecord({
      now, actor: deps.actor, target: deps.target, action: 'env.apply', plan,
      keysAffected, outcome: 'success',
    });
    deps.logger.info('coolify.env.apply', { action: 'env.apply', keysAffected, confirmed });
    await deps.writeAudit(audit);
    return { applied: items, confirmed, audit };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const audit = buildAuditRecord({
      now, actor: deps.actor, target: deps.target, action: 'env.apply', plan,
      keysAffected, outcome: 'failure', error: message,
    });
    deps.logger.error('coolify.env.apply.failed', { action: 'env.apply', keysAffected, error: message });
    await deps.writeAudit(audit);
    throw err;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/Projects/coolify-harness-api && pnpm vitest run test/apply-env-write.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/coolify-harness-api && git add -A && git commit -m "feat: applyEnvWrite (effectful, re-read confirm, keys-only audit)"
```

---

### Task 11: Zod schema walker — unwrap chain + base types

**Files:**
- Create: `src/catalog/walk.ts`
- Create: `test/fixtures/schemas/representative.ts`
- Test: `test/walk-base.test.ts`

**Interfaces:**
- Produces:

```ts
interface CatalogEntry {
  key: string; services: string[]; type: string; enumValues?: string[];
  required: boolean; default?: string; description?: string;
  coerced: boolean; transformed: boolean; multiline: boolean; conflict?: string;
}
type CatalogModel = CatalogEntry[];
function walkEnvSchema(schema: z.ZodTypeAny, opts: { service: string }): CatalogEntry[];
```

**The unwrap recipe (Zod 3.24, per research finding [4]) — process in this order until a base type:**
1. `ZodDefault` → `_def.innerType`; mark `required = false`, read default via `_def.defaultValue()`.
2. `ZodOptional` → `_def.innerType`; mark `required = false`.
3. `ZodEffects` → `_def.schema`; if `_def.effect.type === 'transform'` mark `transformed = true`.
4. `ZodCatch` → `_def.innerType`.
5. Base type: `ZodNumber`/`ZodBoolean` read `_def.coerce` → `coerced`; `ZodEnum` read `_def.values` → `enumValues`; `ZodString` → `'string'`.

The TOP-LEVEL schema is itself often a `ZodEffects` (the backend services wrap `BaseEnvSchema.extend(...).superRefine(...)`). To reach the field shape: if the top schema is `ZodEffects`, unwrap `_def.schema` repeatedly until a `ZodObject`, then read `_def.shape()`. Web's `PublicEnvSchema` is a plain `ZodObject` (research finding [1]) — handle both. `multiline` heuristic: a field whose key matches `/KEY|PEM|CERT|PRIVATE/i` OR whose string schema has no max → `multiline = false` unless key matches the PEM-shaped regex (keep simple: `/_KEY$|_PEM$|PRIVATE_KEY/i` → `multiline = true`).

Detect the Zod typeName via `schema._def.typeName` (e.g. `'ZodDefault'`, `'ZodEffects'`). Use a typed helper; cast through `unknown` with a `// reason:` comment where Zod's `_def` is `any`-typed internally.

- [ ] **Step 1: Create the representative fixture schema**

```ts
// test/fixtures/schemas/representative.ts
import { z } from 'zod';

// Mirrors pfi-sniper constructs: coerce, transform, default, optional, enum, superRefine wrap, PEM.
const Base = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development').describe('Runtime mode'),
  LOG_LEVEL: z.string().default('info').describe('Pino log level'),
  PORT: z.coerce.number().int().positive().default(3001).describe('HTTP listen port'),
  FEATURE_X_ENABLED: z.coerce.boolean().default(false).describe('Toggle feature X'),
  CORS_ORIGINS: z
    .string()
    .transform((s) => s.split(','))
    .describe('Comma-separated allowlist'),
  OPTIONAL_FLAG: z.string().optional().describe('Set if present'),
  JWT_PRIVATE_KEY: z.string().optional().describe('Ed25519 PEM'),
  NO_DESCRIPTION_KEY: z.string().default('x'),
});

export const RepresentativeSchema = Base.superRefine((_val, _ctx) => {
  // cross-field rule placeholder; the walker must unwrap past this.
});

export const WebLikeSchema = z.object({
  NEXT_PUBLIC_API_BASE_URL: z.string().url().default('http://localhost:3001').describe('API base URL'),
  LOG_LEVEL: z.string().default('debug').describe('Web log level'), // shared key, divergent default
});
```

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { walkEnvSchema } from '../src/catalog/walk.js';
import { RepresentativeSchema } from './fixtures/schemas/representative.js';

describe('walkEnvSchema base traversal', () => {
  const entries = walkEnvSchema(RepresentativeSchema, { service: 'api' });
  const byKey = new Map(entries.map((e) => [e.key, e]));

  it('unwraps a superRefine-wrapped object to reach every field', () => {
    expect(entries.map((e) => e.key).sort()).toEqual(
      ['CORS_ORIGINS', 'FEATURE_X_ENABLED', 'JWT_PRIVATE_KEY', 'LOG_LEVEL', 'NODE_ENV', 'NO_DESCRIPTION_KEY', 'OPTIONAL_FLAG', 'PORT'],
    );
  });

  it('records enum values and default for NODE_ENV', () => {
    const e = byKey.get('NODE_ENV')!;
    expect(e.type).toBe('enum');
    expect(e.enumValues).toEqual(['development', 'production', 'test']);
    expect(e.required).toBe(false);
    expect(e.default).toBe('development');
    expect(e.description).toBe('Runtime mode');
  });

  it('marks coerced number and boolean', () => {
    expect(byKey.get('PORT')!.coerced).toBe(true);
    expect(byKey.get('PORT')!.type).toBe('number');
    expect(byKey.get('FEATURE_X_ENABLED')!.coerced).toBe(true);
    expect(byKey.get('FEATURE_X_ENABLED')!.type).toBe('boolean');
  });

  it('marks transformed for CSV→array', () => {
    expect(byKey.get('CORS_ORIGINS')!.transformed).toBe(true);
  });

  it('marks optional() as not required', () => {
    expect(byKey.get('OPTIONAL_FLAG')!.required).toBe(false);
  });

  it('flags PEM-shaped keys as multiline', () => {
    expect(byKey.get('JWT_PRIVATE_KEY')!.multiline).toBe(true);
    expect(byKey.get('PORT')!.multiline).toBe(false);
  });

  it('leaves description undefined when no .describe()', () => {
    expect(byKey.get('NO_DESCRIPTION_KEY')!.description).toBeUndefined();
  });

  it('attaches the owning service', () => {
    expect(byKey.get('NODE_ENV')!.services).toEqual(['api']);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd ~/Projects/coolify-harness-api && pnpm vitest run test/walk-base.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write walk.ts**

```ts
import { z } from 'zod';

export interface CatalogEntry {
  key: string;
  services: string[];
  type: string;
  enumValues?: string[];
  required: boolean;
  default?: string;
  description?: string;
  coerced: boolean;
  transformed: boolean;
  multiline: boolean;
  conflict?: string;
}

export type CatalogModel = CatalogEntry[];

const PEM_KEY_RE = /_KEY$|_PEM$|PRIVATE_KEY/i;

// reason: Zod's internal `_def` is loosely typed; we read documented fields and narrow by typeName.
type AnyDef = { typeName?: string; innerType?: unknown; schema?: unknown; effect?: { type?: string };
  defaultValue?: () => unknown; coerce?: boolean; values?: readonly string[]; shape?: () => Record<string, unknown> };

function def(schema: unknown): AnyDef {
  // reason: accessing the documented Zod runtime `_def` shape requires an unknown cast.
  return (schema as { _def: AnyDef })._def;
}

function typeNameOf(schema: unknown): string | undefined {
  return def(schema).typeName;
}

interface Unwrapped {
  base: unknown;
  required: boolean;
  defaultValue?: unknown;
  transformed: boolean;
  coerced: boolean;
}

function unwrapField(schema: unknown): Unwrapped {
  let current = schema;
  let required = true;
  let defaultValue: unknown;
  let transformed = false;
  for (;;) {
    const tn = typeNameOf(current);
    const d = def(current);
    if (tn === 'ZodDefault') {
      required = false;
      defaultValue = d.defaultValue ? d.defaultValue() : undefined;
      current = d.innerType;
      continue;
    }
    if (tn === 'ZodOptional' || tn === 'ZodNullable') {
      required = false;
      current = d.innerType;
      continue;
    }
    if (tn === 'ZodEffects') {
      if (d.effect?.type === 'transform') transformed = true;
      current = d.schema;
      continue;
    }
    if (tn === 'ZodCatch') {
      current = d.innerType;
      continue;
    }
    break;
  }
  const coerced = def(current).coerce === true;
  const result: Unwrapped = { base: current, required, transformed, coerced };
  return defaultValue === undefined ? result : { ...result, defaultValue };
}

function baseType(schema: unknown): { type: string; enumValues?: string[] } {
  const tn = typeNameOf(schema);
  switch (tn) {
    case 'ZodNumber': return { type: 'number' };
    case 'ZodBoolean': return { type: 'boolean' };
    case 'ZodEnum': return { type: 'enum', enumValues: [...(def(schema).values ?? [])] };
    case 'ZodString': return { type: 'string' };
    default: return { type: tn ? tn.replace(/^Zod/, '').toLowerCase() : 'unknown' };
  }
}

function serializeDefault(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function descriptionOf(schema: unknown): string | undefined {
  // reason: `.describe()` writes to `_def.description`, untyped in the runtime def.
  const d = (schema as { _def: { description?: string } })._def;
  return d.description;
}

function unwrapToObject(schema: unknown): Record<string, unknown> {
  let current = schema;
  for (;;) {
    const tn = typeNameOf(current);
    if (tn === 'ZodObject') {
      const shapeFn = def(current).shape;
      return shapeFn ? shapeFn() : {};
    }
    if (tn === 'ZodEffects') { current = def(current).schema; continue; }
    if (tn === 'ZodDefault' || tn === 'ZodOptional' || tn === 'ZodCatch') {
      current = def(current).innerType;
      continue;
    }
    throw new Error(`walkEnvSchema: top-level schema is not a ZodObject (got ${tn ?? 'unknown'})`);
  }
}

export function walkEnvSchema(schema: z.ZodTypeAny, opts: { service: string }): CatalogEntry[] {
  const shape = unwrapToObject(schema);
  const entries: CatalogEntry[] = [];
  for (const [key, fieldSchema] of Object.entries(shape)) {
    // .describe() may live on any wrapper level; check the field then its unwrapped base.
    const topDescription = descriptionOf(fieldSchema);
    const u = unwrapField(fieldSchema);
    const baseDescription = descriptionOf(u.base);
    const { type, enumValues } = baseType(u.base);
    const description = topDescription ?? baseDescription;
    const def: CatalogEntry = {
      key,
      services: [opts.service],
      type,
      required: u.required,
      coerced: u.coerced,
      transformed: u.transformed,
      multiline: PEM_KEY_RE.test(key),
    };
    const serializedDefault = serializeDefault(u.defaultValue);
    const entry: CatalogEntry = {
      ...def,
      ...(enumValues ? { enumValues } : {}),
      ...(serializedDefault !== undefined ? { default: serializedDefault } : {}),
      ...(description !== undefined ? { description } : {}),
    };
    entries.push(entry);
  }
  return entries;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd ~/Projects/coolify-harness-api && pnpm vitest run test/walk-base.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
cd ~/Projects/coolify-harness-api && git add -A && git commit -m "feat: pure Zod schema walker (3.24 _def unwrap chain)"
```

---

### Task 12: Catalog merge across services (many-per-key + conflict)

**Files:**
- Modify: `src/catalog/walk.ts` (add `mergeCatalogs`)
- Test: `test/catalog-merge.test.ts`

**Interfaces:**
- Produces:

```ts
function mergeCatalogs(perService: CatalogEntry[][]): CatalogModel;
```

Merges entries by key, unioning `services`. When two entries for the same key have a divergent `type` or `default`, set `conflict` to a human note (e.g. `"LOG_LEVEL: default differs across services (info vs debug)"`) and keep the first-seen `type`/`default`. Deterministic output: sorted by key.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { walkEnvSchema, mergeCatalogs } from '../src/catalog/walk.js';
import { RepresentativeSchema, WebLikeSchema } from './fixtures/schemas/representative.js';

describe('mergeCatalogs', () => {
  it('unions services for a shared key and flags divergent defaults', () => {
    const api = walkEnvSchema(RepresentativeSchema, { service: 'api' });
    const web = walkEnvSchema(WebLikeSchema, { service: 'web' });
    const merged = mergeCatalogs([api, web]);
    const log = merged.find((e) => e.key === 'LOG_LEVEL')!;
    expect(log.services.sort()).toEqual(['api', 'web']);
    expect(log.conflict).toContain('default differs');
  });

  it('produces key-sorted deterministic output', () => {
    const merged = mergeCatalogs([walkEnvSchema(RepresentativeSchema, { service: 'api' })]);
    const keys = merged.map((e) => e.key);
    expect(keys).toEqual([...keys].sort());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Projects/coolify-harness-api && pnpm vitest run test/catalog-merge.test.ts`
Expected: FAIL — `mergeCatalogs` not exported.

- [ ] **Step 3: Append mergeCatalogs to walk.ts**

```ts
export function mergeCatalogs(perService: CatalogEntry[][]): CatalogModel {
  const byKey = new Map<string, CatalogEntry>();
  for (const entries of perService) {
    for (const entry of entries) {
      const existing = byKey.get(entry.key);
      if (!existing) {
        byKey.set(entry.key, { ...entry, services: [...entry.services] });
        continue;
      }
      for (const svc of entry.services) {
        if (!existing.services.includes(svc)) existing.services.push(svc);
      }
      const notes: string[] = [];
      if (existing.type !== entry.type) {
        notes.push(`${entry.key}: type differs across services (${existing.type} vs ${entry.type})`);
      }
      if (existing.default !== entry.default) {
        notes.push(
          `${entry.key}: default differs across services (${existing.default ?? '∅'} vs ${entry.default ?? '∅'})`,
        );
      }
      if (notes.length > 0) {
        existing.conflict = existing.conflict ? `${existing.conflict}; ${notes.join('; ')}` : notes.join('; ');
      }
    }
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/Projects/coolify-harness-api && pnpm vitest run test/catalog-merge.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/coolify-harness-api && git add -A && git commit -m "feat: merge per-service catalogs with conflict notes"
```

---

### Task 13: Markdown + JSON emitters

**Files:**
- Create: `src/catalog/emit-markdown.ts`
- Create: `src/catalog/emit-json.ts`
- Test: `test/emit-md-json.test.ts`

**Interfaces:**
- Produces:

```ts
function emitMarkdown(model: CatalogModel): string;
function emitJson(model: CatalogModel): string;
```

`emitMarkdown`: a table with columns `Key | Type | Required | Default | Services | Description`, rows sorted by key, plus a trailing `## Keys missing a description` section listing keys with no `description`, and a `## Conflicts` section for any entry with `conflict`. `emitJson`: `JSON.stringify(model, null, 2) + '\n'` (deterministic, key-sorted by construction).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { emitMarkdown } from '../src/catalog/emit-markdown.js';
import { emitJson } from '../src/catalog/emit-json.js';
import type { CatalogModel } from '../src/catalog/walk.js';

const model: CatalogModel = [
  { key: 'A_FLAG', services: ['api'], type: 'boolean', required: false, default: 'false',
    description: 'Toggle A', coerced: true, transformed: false, multiline: false },
  { key: 'NO_DESC', services: ['api', 'web'], type: 'string', required: true,
    coerced: false, transformed: false, multiline: false },
];

describe('emitters', () => {
  it('emits a markdown table + missing-description section', () => {
    const md = emitMarkdown(model);
    expect(md).toContain('| Key | Type | Required | Default | Services | Description |');
    expect(md).toContain('| A_FLAG | boolean | no | false | api | Toggle A |');
    expect(md).toContain('## Keys missing a description');
    expect(md).toContain('NO_DESC');
  });

  it('emits deterministic pretty JSON ending in a newline', () => {
    const json = emitJson(model);
    expect(json.endsWith('\n')).toBe(true);
    expect(JSON.parse(json)).toEqual(model);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Projects/coolify-harness-api && pnpm vitest run test/emit-md-json.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write emit-json.ts**

```ts
import type { CatalogModel } from './walk.js';

export function emitJson(model: CatalogModel): string {
  return `${JSON.stringify(model, null, 2)}\n`;
}
```

- [ ] **Step 4: Write emit-markdown.ts**

```ts
import type { CatalogModel } from './walk.js';

export function emitMarkdown(model: CatalogModel): string {
  const lines: string[] = ['# Environment Variable Catalog', ''];
  lines.push('| Key | Type | Required | Default | Services | Description |');
  lines.push('| --- | ---- | -------- | ------- | -------- | ----------- |');
  for (const e of model) {
    const type = e.enumValues ? `enum(${e.enumValues.join('|')})` : e.type;
    lines.push(
      `| ${e.key} | ${type} | ${e.required ? 'yes' : 'no'} | ${e.default ?? ''} | ${e.services.join(', ')} | ${e.description ?? ''} |`,
    );
  }

  const missing = model.filter((e) => e.description === undefined).map((e) => e.key);
  if (missing.length > 0) {
    lines.push('', '## Keys missing a description', '');
    for (const k of missing) lines.push(`- ${k}`);
  }

  const conflicts = model.filter((e) => e.conflict !== undefined);
  if (conflicts.length > 0) {
    lines.push('', '## Conflicts', '');
    for (const e of conflicts) lines.push(`- ${e.conflict ?? ''}`);
  }

  return `${lines.join('\n')}\n`;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd ~/Projects/coolify-harness-api && pnpm vitest run test/emit-md-json.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
cd ~/Projects/coolify-harness-api && git add -A && git commit -m "feat: markdown + json catalog emitters"
```

---

### Task 14: .env.example emitter

**Files:**
- Create: `src/catalog/emit-dotenv.ts`
- Test: `test/emit-dotenv.test.ts`

**Interfaces:**
- Produces:

```ts
function emitDotenv(model: CatalogModel): string;
```

Each key preceded by a comment block (`# <description>` / `# type: <type> | required: yes|no | services: …`) then `KEY=<default-or-blank>`. Deterministic order (already key-sorted in the model). One blank line between keys.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { emitDotenv } from '../src/catalog/emit-dotenv.js';
import type { CatalogModel } from '../src/catalog/walk.js';

const model: CatalogModel = [
  { key: 'PORT', services: ['api'], type: 'number', required: false, default: '3001',
    description: 'HTTP listen port', coerced: true, transformed: false, multiline: false },
  { key: 'SECRET', services: ['api'], type: 'string', required: true,
    coerced: false, transformed: false, multiline: false },
];

describe('emitDotenv', () => {
  it('emits a documented .env.example', () => {
    const out = emitDotenv(model);
    expect(out).toContain('# HTTP listen port');
    expect(out).toContain('# type: number | required: no | services: api');
    expect(out).toContain('PORT=3001');
    expect(out).toContain('SECRET=');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Projects/coolify-harness-api && pnpm vitest run test/emit-dotenv.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write emit-dotenv.ts**

```ts
import type { CatalogModel } from './walk.js';

export function emitDotenv(model: CatalogModel): string {
  const blocks = model.map((e) => {
    const lines: string[] = [];
    if (e.description) lines.push(`# ${e.description}`);
    lines.push(`# type: ${e.type} | required: ${e.required ? 'yes' : 'no'} | services: ${e.services.join(', ')}`);
    lines.push(`${e.key}=${e.default ?? ''}`);
    return lines.join('\n');
  });
  return `${blocks.join('\n\n')}\n`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/Projects/coolify-harness-api && pnpm vitest run test/emit-dotenv.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/coolify-harness-api && git add -A && git commit -m "feat: .env.example emitter"
```

---

### Task 15: generateCatalog orchestrator

**Files:**
- Create: `src/catalog/generate.ts`
- Test: `test/generate-catalog.test.ts`

**Interfaces:**
- Consumes: `walkEnvSchema`, `mergeCatalogs`, all three emitters.
- Produces:

```ts
interface SchemaInput { service: string; schema: z.ZodTypeAny }
interface CatalogArtifacts { markdown: string; json: string; dotenv: string; model: CatalogModel }
interface GenerateOptions {
  schemas: SchemaInput[];
  out?: { markdown?: string; json?: string; dotenvExample?: string };
  writeFile?: (path: string, content: string) => Promise<void>; // injected; default node fs
}
async function generateCatalog(opts: GenerateOptions): Promise<CatalogArtifacts>;
function buildArtifacts(schemas: SchemaInput[]): CatalogArtifacts;  // pure, exported for tests + stale-check
```

`buildArtifacts` walks each schema, merges, emits all three. `generateCatalog` calls it then writes each provided `out` path via `writeFile`. Returns the artifacts regardless.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { generateCatalog, buildArtifacts } from '../src/catalog/generate.js';
import { RepresentativeSchema, WebLikeSchema } from './fixtures/schemas/representative.js';

describe('generateCatalog', () => {
  it('builds all three artifacts deterministically', () => {
    const a = buildArtifacts([
      { service: 'api', schema: RepresentativeSchema },
      { service: 'web', schema: WebLikeSchema },
    ]);
    const b = buildArtifacts([
      { service: 'api', schema: RepresentativeSchema },
      { service: 'web', schema: WebLikeSchema },
    ]);
    expect(a.markdown).toBe(b.markdown);
    expect(a.json).toBe(b.json);
    expect(a.dotenv).toBe(b.dotenv);
    expect(a.model.find((e) => e.key === 'LOG_LEVEL')!.services.sort()).toEqual(['api', 'web']);
  });

  it('writes only the provided out paths', async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    await generateCatalog({
      schemas: [{ service: 'api', schema: RepresentativeSchema }],
      out: { markdown: 'docs/cat.md', json: 'docs/cat.json' },
      writeFile,
    });
    const paths = writeFile.mock.calls.map((c) => c[0]);
    expect(paths).toEqual(['docs/cat.md', 'docs/cat.json']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Projects/coolify-harness-api && pnpm vitest run test/generate-catalog.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write generate.ts**

```ts
import { writeFile as fsWriteFile } from 'node:fs/promises';
import { z } from 'zod';
import { walkEnvSchema, mergeCatalogs, type CatalogModel } from './walk.js';
import { emitMarkdown } from './emit-markdown.js';
import { emitJson } from './emit-json.js';
import { emitDotenv } from './emit-dotenv.js';

export interface SchemaInput {
  service: string;
  schema: z.ZodTypeAny;
}

export interface CatalogArtifacts {
  markdown: string;
  json: string;
  dotenv: string;
  model: CatalogModel;
}

export interface GenerateOptions {
  schemas: SchemaInput[];
  out?: { markdown?: string; json?: string; dotenvExample?: string };
  writeFile?: (path: string, content: string) => Promise<void>;
}

export function buildArtifacts(schemas: SchemaInput[]): CatalogArtifacts {
  const perService = schemas.map((s) => walkEnvSchema(s.schema, { service: s.service }));
  const model = mergeCatalogs(perService);
  return { markdown: emitMarkdown(model), json: emitJson(model), dotenv: emitDotenv(model), model };
}

export async function generateCatalog(opts: GenerateOptions): Promise<CatalogArtifacts> {
  const artifacts = buildArtifacts(opts.schemas);
  const write = opts.writeFile ?? ((p: string, c: string): Promise<void> => fsWriteFile(p, c, 'utf8'));
  if (opts.out?.markdown) await write(opts.out.markdown, artifacts.markdown);
  if (opts.out?.json) await write(opts.out.json, artifacts.json);
  if (opts.out?.dotenvExample) await write(opts.out.dotenvExample, artifacts.dotenv);
  return artifacts;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/Projects/coolify-harness-api && pnpm vitest run test/generate-catalog.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/coolify-harness-api && git add -A && git commit -m "feat: generateCatalog orchestrator"
```

---

### Task 16: Golden-file test for the catalog

**Files:**
- Create: `test/golden/catalog.md`
- Create: `test/golden/catalog.json`
- Create: `test/golden/.env.example`
- Test: `test/catalog-golden.test.ts`

**Interfaces:**
- Consumes: `buildArtifacts`, the representative schemas.
- Produces: pinned golden output (regression lock on emitter format).

- [ ] **Step 1: Write the golden test (reads committed golden files, asserts equality)**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildArtifacts } from '../src/catalog/generate.js';
import { RepresentativeSchema, WebLikeSchema } from './fixtures/schemas/representative.js';

const golden = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./golden/${name}`, import.meta.url)), 'utf8');

describe('catalog golden output', () => {
  const a = buildArtifacts([
    { service: 'api', schema: RepresentativeSchema },
    { service: 'web', schema: WebLikeSchema },
  ]);
  it('matches the golden markdown', () => expect(a.markdown).toBe(golden('catalog.md')));
  it('matches the golden json', () => expect(a.json).toBe(golden('catalog.json')));
  it('matches the golden .env.example', () => expect(a.dotenv).toBe(golden('.env.example')));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Projects/coolify-harness-api && pnpm vitest run test/catalog-golden.test.ts`
Expected: FAIL — golden files don't exist.

- [ ] **Step 3: Generate the golden files from current output**

Write a throwaway script and run it to materialize the golden files, then delete the script:

```bash
cd ~/Projects/coolify-harness-api && mkdir -p test/golden && cat > /tmp/gen-golden.mjs <<'EOF'
import { buildArtifacts } from './src/catalog/generate.ts';
EOF
```

Instead of a script, run via a one-off Vitest that writes the files: temporarily change the golden test's three assertions to write the files (`writeFileSync(path, a.markdown)`), run it once, then revert the test to assertions. Concretely: change each `expect(...)` to `writeFileSync(fileURLToPath(new URL('./golden/<name>', import.meta.url)), a.<field>)`, run the test, confirm files exist, revert to the assertion form from Step 1.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/Projects/coolify-harness-api && pnpm vitest run test/catalog-golden.test.ts`
Expected: PASS (3 tests). Inspect the golden files to confirm they look correct before committing.

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/coolify-harness-api && git add -A && git commit -m "test: golden-file lock on catalog output"
```

---

### Task 17: Stale-check (generate-and-diff)

**Files:**
- Create: `src/catalog/stale-check.ts`
- Test: `test/stale-check.test.ts`

**Interfaces:**
- Consumes: `buildArtifacts`, `CatalogStaleError`.
- Produces:

```ts
interface StaleCheckResult { fresh: boolean; staleFiles: string[]; diff: string }
interface StaleCheckOptions {
  schemas: SchemaInput[];
  files: { markdown?: string; json?: string; dotenvExample?: string };
  readFile?: (path: string) => Promise<string>;  // injected; default node fs (missing → '')
}
async function checkCatalogFresh(opts: StaleCheckOptions): Promise<StaleCheckResult>;
```

Regenerates artifacts in memory, reads each committed file (missing file = empty string = stale), compares string-equal. `diff` is a short human summary listing which files differ. No live Coolify access.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { checkCatalogFresh } from '../src/catalog/stale-check.js';
import { buildArtifacts } from '../src/catalog/generate.js';
import { RepresentativeSchema } from './fixtures/schemas/representative.js';

const schemas = [{ service: 'api', schema: RepresentativeSchema }];

describe('checkCatalogFresh', () => {
  it('reports fresh when committed files match generated output', async () => {
    const a = buildArtifacts(schemas);
    const res = await checkCatalogFresh({
      schemas,
      files: { markdown: 'cat.md', json: 'cat.json' },
      readFile: async (p) => (p === 'cat.md' ? a.markdown : a.json),
    });
    expect(res.fresh).toBe(true);
    expect(res.staleFiles).toEqual([]);
  });

  it('reports stale and names the drifted file', async () => {
    const a = buildArtifacts(schemas);
    const res = await checkCatalogFresh({
      schemas,
      files: { markdown: 'cat.md', json: 'cat.json' },
      readFile: async (p) => (p === 'cat.md' ? 'OUTDATED' : a.json),
    });
    expect(res.fresh).toBe(false);
    expect(res.staleFiles).toEqual(['cat.md']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Projects/coolify-harness-api && pnpm vitest run test/stale-check.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write stale-check.ts**

```ts
import { readFile as fsReadFile } from 'node:fs/promises';
import { buildArtifacts, type SchemaInput } from './generate.js';

export interface StaleCheckResult {
  fresh: boolean;
  staleFiles: string[];
  diff: string;
}

export interface StaleCheckOptions {
  schemas: SchemaInput[];
  files: { markdown?: string; json?: string; dotenvExample?: string };
  readFile?: (path: string) => Promise<string>;
}

export async function checkCatalogFresh(opts: StaleCheckOptions): Promise<StaleCheckResult> {
  const artifacts = buildArtifacts(opts.schemas);
  const read =
    opts.readFile ??
    (async (p: string): Promise<string> => {
      try {
        return await fsReadFile(p, 'utf8');
      } catch {
        return '';
      }
    });

  const checks: { path: string; expected: string }[] = [];
  if (opts.files.markdown) checks.push({ path: opts.files.markdown, expected: artifacts.markdown });
  if (opts.files.json) checks.push({ path: opts.files.json, expected: artifacts.json });
  if (opts.files.dotenvExample) checks.push({ path: opts.files.dotenvExample, expected: artifacts.dotenv });

  const staleFiles: string[] = [];
  for (const c of checks) {
    const actual = await read(c.path);
    if (actual !== c.expected) staleFiles.push(c.path);
  }

  return {
    fresh: staleFiles.length === 0,
    staleFiles,
    diff: staleFiles.length === 0 ? '' : `Stale artifacts: ${staleFiles.join(', ')}. Run 'coolify-harness catalog gen'.`,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/Projects/coolify-harness-api && pnpm vitest run test/stale-check.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/Projects/coolify-harness-api && git add -A && git commit -m "feat: catalog stale-check (generate-and-diff)"
```

---

### Task 18: CLI arg parsing + presenters + exit codes

**Files:**
- Create: `src/cli/main.ts`
- Create: `src/cli/args.ts`
- Test: `test/cli-args.test.ts`

**Interfaces:**
- Consumes: all error classes.
- Produces:

```ts
// args.ts — pure, Zod-validated
interface ParsedArgs {
  command: 'catalog-gen' | 'catalog-check' | 'env-diff' | 'env-apply' | 'flag-set' | 'deploy' | 'config-doctor';
  config: string;          // --config, default 'coolify-harness.config.ts'
  app?: string;            // --app
  apply: boolean;          // --apply
  yes: boolean;            // --yes
  redeploy: boolean;       // --redeploy
  restart: boolean;        // --restart
  json: boolean;           // --json
  failOnDrift: boolean;    // --fail-on-drift
  set: Record<string, string>; // repeated --set K=V
  fromFile?: string;       // --from-file
}
function parseArgs(argv: string[]): ParsedArgs;  // throws on usage error (mapped to exit 2)

// main.ts
const EXIT = { ok: 0, internal: 1, usage: 2, catalogStale: 3, drift: 4, authScope: 5, lockedVar: 6 } as const;
function errorToExitCode(err: unknown): number;
async function main(argv: string[]): Promise<number>;  // returns exit code, never calls process.exit directly
```

`errorToExitCode` maps: `CatalogStaleError`→3, `DuplicateKeyDriftError`→4, `CoolifyAuthScopeError`/`CoolifyAuthError`→5, `LockedVarError`→6, Zod/usage→2, else 1. `parseArgs` is the first command-positional + a small flag parser, Zod-validated (a `ParsedArgsSchema`). This task wires parsing + the exit-code map; command bodies land in Tasks 19–20.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { parseArgs } from '../src/cli/args.js';
import { errorToExitCode } from '../src/cli/main.js';
import { CatalogStaleError, CoolifyAuthError, LockedVarError } from '../src/errors/index.js';

describe('CLI args', () => {
  it('parses catalog gen with default config', () => {
    const a = parseArgs(['catalog', 'gen']);
    expect(a.command).toBe('catalog-gen');
    expect(a.config).toBe('coolify-harness.config.ts');
  });

  it('parses env apply with --app, repeated --set, and --apply', () => {
    const a = parseArgs(['env', 'apply', '--app', 'pfi-api', '--set', 'A=1', '--set', 'B=2', '--apply']);
    expect(a.command).toBe('env-apply');
    expect(a.app).toBe('pfi-api');
    expect(a.set).toEqual({ A: '1', B: '2' });
    expect(a.apply).toBe(true);
  });

  it('throws on an unknown command (usage error)', () => {
    expect(() => parseArgs(['frobnicate'])).toThrow();
  });
});

describe('errorToExitCode', () => {
  it('maps typed errors to CI-meaningful codes', () => {
    expect(errorToExitCode(new CatalogStaleError('x', { staleFiles: [] }))).toBe(3);
    expect(errorToExitCode(new CoolifyAuthError('x'))).toBe(5);
    expect(errorToExitCode(new LockedVarError('x', { key: 'K' }))).toBe(6);
    expect(errorToExitCode(new Error('boom'))).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Projects/coolify-harness-api && pnpm vitest run test/cli-args.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write args.ts**

```ts
import { z } from 'zod';

const COMMANDS = {
  'catalog gen': 'catalog-gen',
  'catalog check': 'catalog-check',
  'env diff': 'env-diff',
  'env apply': 'env-apply',
  'flag set': 'flag-set',
  deploy: 'deploy',
  'config doctor': 'config-doctor',
} as const;

export interface ParsedArgs {
  command:
    | 'catalog-gen' | 'catalog-check' | 'env-diff' | 'env-apply'
    | 'flag-set' | 'deploy' | 'config-doctor';
  config: string;
  app?: string;
  apply: boolean;
  yes: boolean;
  redeploy: boolean;
  restart: boolean;
  json: boolean;
  failOnDrift: boolean;
  set: Record<string, string>;
  fromFile?: string;
}

const FlagSchema = z.object({
  command: z.enum([
    'catalog-gen', 'catalog-check', 'env-diff', 'env-apply', 'flag-set', 'deploy', 'config-doctor',
  ]),
  config: z.string().default('coolify-harness.config.ts'),
});

function resolveCommand(tokens: string[]): { command: ParsedArgs['command']; rest: string[] } {
  const two = tokens.slice(0, 2).join(' ');
  const one = tokens[0] ?? '';
  if (two in COMMANDS) {
    return { command: COMMANDS[two as keyof typeof COMMANDS], rest: tokens.slice(2) };
  }
  if (one in COMMANDS) {
    return { command: COMMANDS[one as keyof typeof COMMANDS], rest: tokens.slice(1) };
  }
  throw new z.ZodError([{ code: 'custom', path: [], message: `Unknown command: ${tokens.join(' ')}` }]);
}

export function parseArgs(argv: string[]): ParsedArgs {
  const { command, rest } = resolveCommand(argv);
  const out: ParsedArgs = {
    command, config: 'coolify-harness.config.ts',
    apply: false, yes: false, redeploy: false, restart: false, json: false, failOnDrift: false, set: {},
  };
  for (let i = 0; i < rest.length; i += 1) {
    const tok = rest[i]!;
    const next = (): string => {
      const v = rest[i + 1];
      if (v === undefined) throw new z.ZodError([{ code: 'custom', path: [], message: `Missing value for ${tok}` }]);
      i += 1;
      return v;
    };
    switch (tok) {
      case '--config': out.config = next(); break;
      case '--app': out.app = next(); break;
      case '--apply': out.apply = true; break;
      case '--yes': out.yes = true; break;
      case '--redeploy': out.redeploy = true; break;
      case '--restart': out.restart = true; break;
      case '--json': out.json = true; break;
      case '--fail-on-drift': out.failOnDrift = true; break;
      case '--from-file': out.fromFile = next(); break;
      case '--set': {
        const pair = next();
        const eq = pair.indexOf('=');
        if (eq < 0) throw new z.ZodError([{ code: 'custom', path: [], message: `--set expects K=V, got ${pair}` }]);
        out.set[pair.slice(0, eq)] = pair.slice(eq + 1);
        break;
      }
      default:
        throw new z.ZodError([{ code: 'custom', path: [], message: `Unknown flag: ${tok}` }]);
    }
  }
  FlagSchema.parse({ command: out.command, config: out.config });
  return out;
}
```

- [ ] **Step 4: Write main.ts (parse + exit-code map; command dispatch stub filled in Tasks 19–20)**

```ts
import { z } from 'zod';
import { parseArgs } from './args.js';
import {
  CatalogStaleError, DuplicateKeyDriftError, CoolifyAuthError, CoolifyAuthScopeError, LockedVarError,
} from '../errors/index.js';

export const EXIT = {
  ok: 0, internal: 1, usage: 2, catalogStale: 3, drift: 4, authScope: 5, lockedVar: 6,
} as const;

export function errorToExitCode(err: unknown): number {
  if (err instanceof CatalogStaleError) return EXIT.catalogStale;
  if (err instanceof DuplicateKeyDriftError) return EXIT.drift;
  if (err instanceof CoolifyAuthScopeError || err instanceof CoolifyAuthError) return EXIT.authScope;
  if (err instanceof LockedVarError) return EXIT.lockedVar;
  if (err instanceof z.ZodError) return EXIT.usage;
  return EXIT.internal;
}

export async function main(argv: string[]): Promise<number> {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`usage error: ${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT.usage;
  }
  try {
    const { dispatch } = await import('./dispatch.js');
    return await dispatch(args);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return errorToExitCode(err);
  }
}

// Bin entrypoint: run main and set the process exit code.
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch(() => { process.exitCode = EXIT.internal; });
}
```

Also create a placeholder `src/cli/dispatch.ts` so the import resolves (filled in Tasks 19–20):

```ts
import type { ParsedArgs } from './args.js';
export async function dispatch(_args: ParsedArgs): Promise<number> {
  throw new Error('dispatch not yet implemented');
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd ~/Projects/coolify-harness-api && pnpm vitest run test/cli-args.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
cd ~/Projects/coolify-harness-api && git add -A && git commit -m "feat: CLI arg parsing + exit-code taxonomy"
```

---

### Task 19: CLI catalog commands (gen + check) + config doctor

**Files:**
- Create: `src/cli/dispatch.ts` (replace placeholder)
- Create: `src/cli/commands/catalog.ts`
- Create: `src/cli/commands/config-doctor.ts`
- Test: `test/cli-catalog.test.ts`

**Interfaces:**
- Consumes: `loadConfig`/`resolveTarget` (config), `generateCatalog`/`checkCatalogFresh` (catalog), `CatalogStaleError`, `ParsedArgs`.
- Produces: `dispatch(args)` routing `catalog-gen`, `catalog-check`, `config-doctor`. The catalog commands need a way to obtain the consumer's schemas. **Decision:** the consumer's `coolify-harness.config.ts` may export an optional `catalog` field (`{ schemas: SchemaInput[]; out: {...} }`); `catalog gen`/`check` read it. Extend `ProjectRegistrySchema` is NOT done (schemas aren't Zod-serializable) — instead `loadConfig` returns the raw module and the CLI reads `module.catalog`. Add a `loadConfigModule(path)` returning `{ registry, catalog? }`.

Add to config (Task 4 extension, done here): `loadConfigModule(configPath)` dynamically imports and returns `{ registry: ProjectRegistry, catalog?: { schemas: SchemaInput[]; out: { markdown?: string; json?: string; dotenvExample?: string } } }`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { dispatch } from '../src/cli/dispatch.js';
import type { ParsedArgs } from '../src/cli/args.js';
import { RepresentativeSchema } from './fixtures/schemas/representative.js';

const baseArgs = (over: Partial<ParsedArgs>): ParsedArgs => ({
  command: 'catalog-gen', config: 'cfg.ts', apply: false, yes: false, redeploy: false,
  restart: false, json: false, failOnDrift: false, set: {}, ...over,
});

vi.mock('../src/config/load.js', async (orig) => {
  const actual = await orig<typeof import('../src/config/load.js')>();
  return {
    ...actual,
    loadConfigModule: vi.fn().mockResolvedValue({
      registry: { instances: {}, targets: {} },
      catalog: {
        schemas: [{ service: 'api', schema: RepresentativeSchema }],
        out: { markdown: 'docs/cat.md' },
      },
    }),
  };
});

describe('catalog CLI', () => {
  it('catalog check returns exit 3 when stale', async () => {
    const code = await dispatch(baseArgs({ command: 'catalog-check' }));
    expect(code).toBe(3); // committed docs/cat.md does not exist → stale
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Projects/coolify-harness-api && pnpm vitest run test/cli-catalog.test.ts`
Expected: FAIL — `loadConfigModule`/`dispatch` not implemented.

- [ ] **Step 3: Add loadConfigModule to config/load.ts**

```ts
import type { SchemaInput } from '../catalog/generate.js';

export interface ConfigModule {
  registry: ProjectRegistry;
  catalog?: { schemas: SchemaInput[]; out: { markdown?: string; json?: string; dotenvExample?: string } };
}

export async function loadConfigModule(configPath: string): Promise<ConfigModule> {
  const mod: unknown = await import(configPath);
  const def = (mod as { default?: unknown }).default;
  const registry = loadRegistry(def);
  const catalog = (mod as { catalog?: ConfigModule['catalog'] }).catalog;
  return catalog === undefined ? { registry } : { registry, catalog };
}
```

(The consumer config exports `default defineConfig(...)` AND a named `export const catalog = { schemas, out }`.)

- [ ] **Step 4: Write commands/catalog.ts**

```ts
import { resolve } from 'node:path';
import type { ParsedArgs } from '../args.js';
import { loadConfigModule } from '../../config/load.js';
import { generateCatalog } from '../../catalog/generate.js';
import { checkCatalogFresh } from '../../catalog/stale-check.js';
import { EXIT } from '../main.js';
import { ConfigError } from '../../errors/index.js';

export async function catalogGen(args: ParsedArgs): Promise<number> {
  const mod = await loadConfigModule(resolve(args.config));
  if (!mod.catalog) throw new ConfigError(`Config '${args.config}' has no 'catalog' export`);
  await generateCatalog({ schemas: mod.catalog.schemas, out: mod.catalog.out });
  process.stdout.write('Catalog regenerated.\n');
  return EXIT.ok;
}

export async function catalogCheck(args: ParsedArgs): Promise<number> {
  const mod = await loadConfigModule(resolve(args.config));
  if (!mod.catalog) throw new ConfigError(`Config '${args.config}' has no 'catalog' export`);
  const res = await checkCatalogFresh({ schemas: mod.catalog.schemas, files: mod.catalog.out });
  if (!res.fresh) {
    process.stderr.write(`${res.diff}\n`);
    return EXIT.catalogStale;
  }
  process.stdout.write('Catalog is fresh.\n');
  return EXIT.ok;
}
```

- [ ] **Step 5: Write commands/config-doctor.ts**

```ts
import { resolve } from 'node:path';
import type { ParsedArgs } from '../args.js';
import { loadConfigModule, resolveTarget } from '../../config/load.js';
import { EXIT } from '../main.js';

export async function configDoctor(args: ParsedArgs): Promise<number> {
  const mod = await loadConfigModule(resolve(args.config));
  const targets = Object.keys(mod.registry.targets);
  process.stdout.write(`Config OK. Instances: ${Object.keys(mod.registry.instances).join(', ')}\n`);
  process.stdout.write(`Targets: ${targets.join(', ')}\n`);
  if (args.app) {
    // Validates the chosen target resolves + its token is present (throws MissingTokenError otherwise).
    resolveTarget(mod.registry, args.app, process.env);
    process.stdout.write(`Target '${args.app}' resolves and its token is present.\n`);
  }
  return EXIT.ok;
}
```

- [ ] **Step 6: Write dispatch.ts**

```ts
import type { ParsedArgs } from './args.js';
import { catalogGen, catalogCheck } from './commands/catalog.js';
import { configDoctor } from './commands/config-doctor.js';

export async function dispatch(args: ParsedArgs): Promise<number> {
  switch (args.command) {
    case 'catalog-gen': return catalogGen(args);
    case 'catalog-check': return catalogCheck(args);
    case 'config-doctor': return configDoctor(args);
    default:
      // env/flag/deploy commands wired in Task 20.
      throw new Error(`Command '${args.command}' not yet wired`);
  }
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd ~/Projects/coolify-harness-api && pnpm vitest run test/cli-catalog.test.ts`
Expected: PASS (1 test).

- [ ] **Step 8: Commit**

```bash
cd ~/Projects/coolify-harness-api && git add -A && git commit -m "feat: CLI catalog gen/check + config doctor"
```

---

### Task 20: CLI env diff/apply/deploy commands

**Files:**
- Create: `src/cli/commands/env.ts`
- Create: `src/cli/commands/deploy.ts`
- Create: `src/cli/audit-sink.ts`
- Modify: `src/cli/dispatch.ts` (add env-diff/env-apply/flag-set/deploy)
- Test: `test/cli-env.test.ts`

**Interfaces:**
- Consumes: `loadConfigModule`/`resolveTarget`, `CoolifyClient`, `planEnvWrite`/`applyEnvWrite`, `buildAuditRecord`, the logger, errors.
- Produces:

```ts
// audit-sink.ts
function makeAuditSink(path: string): (record: AuditRecord) => Promise<void>;  // appends JSONL, mkdir -p
// env.ts
async function envDiff(args, deps): Promise<number>;   // read-only; prints plan + drift; --fail-on-drift→4
async function envApply(args, deps): Promise<number>;  // refuses without --apply (exit 0 dry-run); applies; never redeploys
// deploy.ts
async function deployCmd(args, deps): Promise<number>; // --restart picks restart; audit-logged
```

`deps` injects a `clientFactory(target): CoolifyClient` and a `now`/`actor`/`auditSink` so tests use fakes. Desired env comes from `--set` (and optionally `--from-file` parsed as KEY=VALUE lines). Dry-run is the default: `env apply` without `--apply` prints the plan and exits 0. `--fail-on-drift` + nonempty `duplicateKeyDrift` → throw `DuplicateKeyDriftError` (exit 4). `flag-set` is `env-apply` with a single `--set` (+ optional `--redeploy` chaining a deploy after a successful apply).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { envDiff, envApply } from '../src/cli/commands/env.js';
import type { ParsedArgs } from '../src/cli/args.js';
import type { EnvVar } from '../src/client/schemas.js';

const ev = (key: string, value: string): EnvVar => ({
  uuid: key, key, value, is_preview: false, is_build_time: false, is_literal: false,
  is_multiline: false, is_shown_once: false,
});

const args = (over: Partial<ParsedArgs>): ParsedArgs => ({
  command: 'env-diff', config: 'cfg.ts', app: 'pfi-api', apply: false, yes: false,
  redeploy: false, restart: false, json: false, failOnDrift: false, set: {}, ...over,
});

const fakeClient = (current: EnvVar[], upsert = vi.fn().mockResolvedValue([])) => ({
  listEnvs: vi.fn().mockResolvedValue(current),
  upsertEnvs: upsert,
  deploy: vi.fn(), restart: vi.fn(),
});

const deps = (client: ReturnType<typeof fakeClient>) => ({
  resolveTargetFor: () => ({ instanceUrl: 'https://c', kind: 'application' as const, uuid: 'app-1', token: 't' }),
  clientFactory: () => client,
  actor: 'test', auditSink: vi.fn().mockResolvedValue(undefined), now: () => new Date('2026-06-17T00:00:00Z'),
});

describe('env CLI', () => {
  it('env diff is read-only and never upserts', async () => {
    const client = fakeClient([ev('A', '1')]);
    const code = await envDiff(args({ set: { A: '2' } }), deps(client));
    expect(code).toBe(0);
    expect(client.upsertEnvs).not.toHaveBeenCalled();
  });

  it('env apply without --apply is a dry-run (no upsert, exit 0)', async () => {
    const client = fakeClient([ev('A', '1')]);
    const code = await envApply(args({ command: 'env-apply', set: { A: '2' }, apply: false }), deps(client));
    expect(code).toBe(0);
    expect(client.upsertEnvs).not.toHaveBeenCalled();
  });

  it('env apply with --apply upserts and never deploys', async () => {
    const client = fakeClient([ev('A', '1')], vi.fn().mockResolvedValue([]));
    client.listEnvs.mockResolvedValueOnce([ev('A', '1')]).mockResolvedValueOnce([ev('A', '2')]);
    const d = deps(client);
    const code = await envApply(args({ command: 'env-apply', set: { A: '2' }, apply: true }), d);
    expect(code).toBe(0);
    expect(client.upsertEnvs).toHaveBeenCalledWith([{ key: 'A', value: '2' }]);
    expect(client.deploy).not.toHaveBeenCalled();
    expect(d.auditSink).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/Projects/coolify-harness-api && pnpm vitest run test/cli-env.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write audit-sink.ts**

```ts
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AuditRecord } from '../client/safe-write.js';

export function makeAuditSink(path: string): (record: AuditRecord) => Promise<void> {
  return async (record: AuditRecord): Promise<void> => {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(record)}\n`, 'utf8');
  };
}
```

- [ ] **Step 4: Write commands/env.ts**

```ts
import type { ParsedArgs } from '../args.js';
import type { CoolifyClient } from '../../client/coolify.js';
import type { ResolvedTarget } from '../../config/schema.js';
import type { AuditRecord } from '../../client/safe-write.js';
import { planEnvWrite, applyEnvWrite } from '../../client/safe-write.js';
import { createLogger } from '../../logging/index.js';
import { DuplicateKeyDriftError } from '../../errors/index.js';
import { EXIT } from '../main.js';

export interface EnvCmdDeps {
  resolveTargetFor: (args: ParsedArgs) => ResolvedTarget;
  clientFactory: (target: ResolvedTarget) => Pick<CoolifyClient, 'listEnvs' | 'upsertEnvs' | 'deploy' | 'restart'>;
  actor: string;
  auditSink: (record: AuditRecord) => Promise<void>;
  now?: () => Date;
}

function printPlan(plan: ReturnType<typeof planEnvWrite>, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }
  process.stdout.write(`creates: ${plan.creates.map((c) => c.key).join(', ') || '(none)'}\n`);
  process.stdout.write(`updates: ${plan.updates.map((u) => u.key).join(', ') || '(none)'}\n`);
  process.stdout.write(`unchanged: ${plan.unchanged.length}\n`);
  if (plan.duplicateKeyDrift.length > 0) {
    process.stdout.write(`DUPLICATE-KEY DRIFT: ${plan.duplicateKeyDrift.map((d) => d.key).join(', ')}\n`);
  }
  for (const w of plan.warnings) process.stdout.write(`warning: ${w.message}\n`);
  process.stdout.write('NOTE: env changes are inert until a separate redeploy.\n');
}

export async function envDiff(args: ParsedArgs, deps: EnvCmdDeps): Promise<number> {
  const target = deps.resolveTargetFor(args);
  const client = deps.clientFactory(target);
  const current = await client.listEnvs();
  const plan = planEnvWrite(current, { values: args.set });
  printPlan(plan, args.json);
  if (args.failOnDrift && plan.duplicateKeyDrift.length > 0) {
    throw new DuplicateKeyDriftError('Duplicate-key drift detected', {
      keys: plan.duplicateKeyDrift.map((d) => d.key),
    });
  }
  return EXIT.ok;
}

export async function envApply(args: ParsedArgs, deps: EnvCmdDeps): Promise<number> {
  const target = deps.resolveTargetFor(args);
  const client = deps.clientFactory(target);
  const current = await client.listEnvs();
  const plan = planEnvWrite(current, { values: args.set });
  printPlan(plan, args.json);
  if (args.failOnDrift && plan.duplicateKeyDrift.length > 0) {
    throw new DuplicateKeyDriftError('Duplicate-key drift detected', {
      keys: plan.duplicateKeyDrift.map((d) => d.key),
    });
  }
  if (!args.apply) {
    process.stdout.write('Dry-run. Re-run with --apply to write.\n');
    return EXIT.ok;
  }
  const result = await applyEnvWrite(plan, {
    client, logger: createLogger({ sink: () => {} }),
    target: { instanceUrl: target.instanceUrl, kind: target.kind, uuid: target.uuid },
    actor: deps.actor, writeAudit: deps.auditSink, ...(deps.now ? { now: deps.now } : {}),
  });
  process.stdout.write(result.confirmed ? 'Applied and confirmed.\n' : 'Applied (confirmation mismatch — re-check).\n');
  return EXIT.ok;
}
```

- [ ] **Step 5: Write commands/deploy.ts**

```ts
import type { ParsedArgs } from '../args.js';
import type { EnvCmdDeps } from './env.js';
import { buildAuditRecord } from '../../client/safe-write.js';
import { EXIT } from '../main.js';

const EMPTY_PLAN = { creates: [], updates: [], unchanged: [], duplicateKeyDrift: [], lockedSkips: [], warnings: [] } as const;

export async function deployCmd(args: ParsedArgs, deps: EnvCmdDeps): Promise<number> {
  const target = deps.resolveTargetFor(args);
  const client = deps.clientFactory(target);
  const now = (deps.now ?? ((): Date => new Date()))();
  const action = args.restart ? 'restart' : 'deploy';
  const ack = args.restart ? await client.restart() : await client.deploy();
  await deps.auditSink(
    buildAuditRecord({
      now, actor: deps.actor,
      target: { instanceUrl: target.instanceUrl, kind: target.kind, uuid: target.uuid },
      action, plan: EMPTY_PLAN, keysAffected: [], outcome: 'success',
    }),
  );
  process.stdout.write(`${action}: ${ack.message}${ack.deploymentUuid ? ` (${ack.deploymentUuid})` : ''}\n`);
  return EXIT.ok;
}
```

- [ ] **Step 6: Wire dispatch.ts to construct real deps and route env/flag/deploy**

Add to `dispatch.ts`: build `EnvCmdDeps` from `loadConfigModule` + `resolveTarget` + a real `CoolifyClient` factory (using `globalThis.fetch`, `createLogger`, `makeAuditSink('.coolify-harness/audit.jsonl')`, actor from `process.env.USER ?? process.env.GITHUB_ACTOR ?? 'unknown'`). Route `env-diff`→`envDiff`, `env-apply`/`flag-set`→`envApply` (and if `flag-set` + `--redeploy` succeeded, call `deployCmd`), `deploy`→`deployCmd`. The construction is integration glue (covered by the contract tests in Tasks 8/10/20 unit-level; the glue itself is thin and exempt from coverage via the `src/cli/**` exclude).

```ts
import { CoolifyClient } from '../client/coolify.js';
import { createLogger } from '../logging/index.js';
import { loadConfigModule, resolveTarget } from '../config/load.js';
import { makeAuditSink } from './audit-sink.js';
import { envDiff, envApply, type EnvCmdDeps } from './commands/env.js';
import { deployCmd } from './commands/deploy.js';
// ... existing catalog imports

async function buildEnvDeps(configPath: string): Promise<EnvCmdDeps> {
  const mod = await loadConfigModule(configPath);
  const logger = createLogger({ sink: () => {} });
  return {
    resolveTargetFor: (a) => {
      if (!a.app) throw new Error('--app is required for this command');
      return resolveTarget(mod.registry, a.app, process.env);
    },
    clientFactory: (target) =>
      new CoolifyClient(target, { fetchImpl: globalThis.fetch, logger }),
    actor: process.env.USER ?? process.env.GITHUB_ACTOR ?? 'unknown',
    auditSink: makeAuditSink('.coolify-harness/audit.jsonl'),
  };
}
```

Then extend the `switch` with the four new cases (resolve `configPath` via `node:path`'s `resolve(args.config)`), and for `flag-set` with `args.redeploy`, await `deployCmd` after `envApply` returns `EXIT.ok`.

- [ ] **Step 7: Run test to verify it passes**

Run: `cd ~/Projects/coolify-harness-api && pnpm vitest run test/cli-env.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Run the whole suite + coverage + lint + typecheck + build**

Run: `cd ~/Projects/coolify-harness-api && pnpm typecheck && pnpm lint && pnpm test:coverage && pnpm build`
Expected: all green; coverage ≥90% lines on the included core (the `src/cli/**`, `src/index.ts`, `src/logging/**` excludes per vitest config keep the bar on pure core). If coverage on `client`/`catalog`/`config`/`safe-write` is below 90%, add targeted tests before committing.

- [ ] **Step 9: Populate src/index.ts re-exports**

```ts
export * from './errors/index.js';
export { createLogger, type Logger } from './logging/index.js';
export { defineConfig, loadConfig, loadConfigModule, resolveTarget } from './config/load.js';
export type { ProjectRegistry, ResolvedTarget } from './config/schema.js';
export { CoolifyClient } from './client/coolify.js';
export { planEnvWrite, applyEnvWrite, buildAuditRecord } from './client/safe-write.js';
export type { EnvWritePlan, AuditRecord, DesiredEnv } from './client/safe-write.js';
export { generateCatalog, buildArtifacts, type SchemaInput } from './catalog/generate.js';
export { checkCatalogFresh } from './catalog/stale-check.js';
export { walkEnvSchema, mergeCatalogs, type CatalogModel, type CatalogEntry } from './catalog/walk.js';
```

- [ ] **Step 10: Commit**

```bash
cd ~/Projects/coolify-harness-api && git add -A && git commit -m "feat: CLI env diff/apply/deploy + public surface re-exports"
```

---

### Task 21: pfi-sniper consumer onboarding

**Files (all in the pfi-sniper repo):**
- Modify: `pfi-sniper: apps/api/src/env.ts` (export `EnvSchema`)
- Modify: `pfi-sniper: apps/mcp-server/src/env.ts` (export `EnvSchema`)
- Modify: `pfi-sniper: apps/research-worker/src/env.ts` (export `EnvSchema`)
- Create: `pfi-sniper: apps/web/src/env-schema.ts` (side-effect-free `export const PublicEnvSchema`)
- Modify: `pfi-sniper: apps/web/src/env.ts` (import the schema from `env-schema.ts`; keep boot validation)
- Create: `pfi-sniper: coolify-harness.config.ts`
- Create: `pfi-sniper: scripts/gen-env-catalog.ts`
- Modify: `pfi-sniper: .gitignore` (add `.coolify-harness/`)

**Interfaces:**
- Consumes: the published/linked `coolify-harness` package.
- Produces: a working `pnpm exec coolify-harness catalog gen` in pfi-sniper.

**Research note (finding [1]):** three backend services (`api`, `mcp-server`, `research-worker`) follow the identical pattern `BaseEnvSchema.extend(notifierEnvSchema.shape).superRefine(...)`, build that schema **inside `loadEnv()`**, and currently export only `loadEnv` + the inferred type — NOT the schema object. Because the backends defer all validation into `loadEnv()`, their modules are side-effect-free to import: extracting a module-level `export const EnvSchema` adds no top-level side effect. `web` is different in two ways: (a) `PublicEnvSchema` is a plain `ZodObject` (no `superRefine`, no notifier extend), and (b) **its `env.ts` validates at module load** — `apps/web/src/env.ts` line 116 runs `PublicEnvSchema.safeParse(rawEnv)` and lines 117–123 `throw` when the web `NEXT_PUBLIC_*` env is unset/invalid (the intended Next boot-fail). That top-level `throw` is a hard hazard for the catalog path: the config statically imports `{ PublicEnvSchema }` and `gen-env-catalog.ts` imports the config, so `pnpm env:catalog` (Step 6) and `pnpm env:catalog:check` (Task 22 Step 3 in CI) would execute web's top-level validation and HARD-THROW in any shell where the web env is not fully populated — the normal case in CI and on a dev box. That contradicts spec §5.5 ("purely local, fast, deterministic, no live access"). **Fix:** extract the schema *object* into a new side-effect-free module `apps/web/src/env-schema.ts` and have the catalog import the schema from there, NEVER from `env.ts`. `env.ts` keeps its module-load validation (the web app's boot-fail behaviour is preserved byte-for-byte). The walker (Task 11) already handles both `ZodEffects` and `ZodObject` top-levels, so the only remaining work is exporting the objects and naming them correctly in the config.

- [ ] **Step 1: Export the schema object from each backend service**

In `apps/api/src/env.ts`, `apps/mcp-server/src/env.ts`, `apps/research-worker/src/env.ts`: the file already builds `BaseEnvSchema.extend(notifierEnvSchema.shape).superRefine(...)` inline inside `loadEnv`. Extract it to a module-level `export const EnvSchema = BaseEnvSchema.extend(notifierEnvSchema.shape).superRefine(...)` and have `loadEnv` call `EnvSchema.parse(...)`. (Read each file first to match the exact superRefine body; this is a pure refactor — no behavior change.)

- [ ] **Step 2: Extract the web schema into a side-effect-free module**

`apps/web/src/env.ts` validates at module load (line 116 `PublicEnvSchema.safeParse(rawEnv)`; lines 117–123 `throw` on failure). Importing `PublicEnvSchema` from `env.ts` therefore runs that `throw` whenever the web `NEXT_PUBLIC_*` env is unset/invalid — which is the normal state in a CI catalog-check shell or a dev box, and would crash `pnpm env:catalog` / `env:catalog:check`. To keep the catalog path side-effect-free (spec §5.5) **without** weakening the web app's intended boot-fail, split the schema object out:

1. **Create `apps/web/src/env-schema.ts`** — a new module containing ONLY the side-effect-free schema object (and its `Locale`/`isSupportedLocale` import). Read the current `apps/web/src/env.ts` first and move the `const PublicEnvSchema = z.object({ ... })` block verbatim (lines 31–80) into this file, exporting it:

   ```ts
   // apps/web/src/env-schema.ts
   import { isSupportedLocale, type Locale } from '@pfi-sniper/i18n';
   import { z } from 'zod';

   /** Schema for the publicly-inlined NEXT_PUBLIC_* env vars. Pure value —
    *  importing this module performs NO validation and NO process.env read,
    *  so it is safe to import from the env-catalog generator (spec §5.5). The
    *  module-load boot-fail lives in env.ts, which imports this object. */
   export const PublicEnvSchema = z.object({
     // ...exact field block moved verbatim from env.ts...
   });
   ```

2. **Edit `apps/web/src/env.ts`** to import the schema instead of declaring it: delete the local `const PublicEnvSchema = z.object({...})` block and add `import { PublicEnvSchema } from './env-schema.js';` near the top. Leave EVERYTHING ELSE in `env.ts` untouched — `rawEnv`, the `PublicEnvSchema.safeParse(rawEnv)` call, the `throw`, the `umamiConfig` derivation, and the exported `env` object all stay exactly as they are. (The `Locale`/`isSupportedLocale`/`DEFAULT_LOCALE` imports `env.ts` still needs for `parsedLocale`/`defaultLocale` stay in `env.ts`; `env-schema.ts` carries its own `Locale`/`isSupportedLocale` import for the `.refine`.)

This mirrors the backend services, whose schemas already live free of module-load validation (all validation is inside `loadEnv()`). After this step, `env.ts` is byte-for-byte equivalent at runtime (the web app still boot-fails on bad env), but `env-schema.ts` can be imported by the catalog config with zero side effects.

- [ ] **Step 3: Link the package and verify backend + web schemas still behave**

Run: `cd ~/Projects/pfi-sniper && pnpm install && pnpm --filter @pfi-sniper/api typecheck && pnpm --filter @pfi-sniper/api test && pnpm --filter @pfi-sniper/web typecheck && pnpm --filter @pfi-sniper/web test`
Expected: green. The backend extraction is behavior-preserving; the web split is import-only — `apps/web/src/env.test.ts` (which re-imports `./env` under varied `process.env`) must still pass unchanged, proving the module-load validation still fires from `env.ts`.

- [ ] **Step 4: Create coolify-harness.config.ts**

```ts
// pfi-sniper: coolify-harness.config.ts
import { defineConfig } from 'coolify-harness/config';
import type { SchemaInput } from 'coolify-harness/catalog';
import { EnvSchema as apiEnv } from './apps/api/src/env.js';
import { EnvSchema as mcpEnv } from './apps/mcp-server/src/env.js';
import { EnvSchema as workerEnv } from './apps/research-worker/src/env.js';
// Import the schema from the side-effect-free env-schema.ts, NOT env.ts —
// env.ts validates at module load and would throw when the web env is
// unset (the normal case for `catalog gen`/`check`). See Task 21 Step 2.
import { PublicEnvSchema as webEnv } from './apps/web/src/env-schema.js';

export default defineConfig({
  instances: {
    prod: { url: 'https://coolify.stonks.cloud', tokenEnv: 'COOLIFY_PROD_TOKEN' },
  },
  targets: {
    'pfi-api': { instance: 'prod', kind: 'application', uuid: 'TODO-fill-from-coolify' },
    'pfi-mcp': { instance: 'prod', kind: 'application', uuid: 'TODO-fill-from-coolify' },
    'pfi-web': { instance: 'prod', kind: 'application', uuid: 'TODO-fill-from-coolify' },
    'pfi-worker': { instance: 'prod', kind: 'service', uuid: 'TODO-fill-from-coolify' },
  },
});

export const catalog: { schemas: SchemaInput[]; out: { markdown: string; json: string; dotenvExample: string } } = {
  schemas: [
    { service: 'api', schema: apiEnv },
    { service: 'mcp-server', schema: mcpEnv },
    { service: 'web', schema: webEnv },
    { service: 'research-worker', schema: workerEnv },
  ],
  out: { markdown: 'docs/env-catalog.md', json: 'docs/env-catalog.json', dotenvExample: '.env.example' },
};
```

(The `uuid` values are filled from the Coolify UI by the operator before any `env` command is used; `catalog gen`/`check` do not need them.)

- [ ] **Step 5: Create the gen-env-catalog script + wire pnpm scripts**

`pfi-sniper: scripts/gen-env-catalog.ts`:

```ts
import { catalog } from '../coolify-harness.config.js';
import { generateCatalog } from 'coolify-harness/catalog';

await generateCatalog({ schemas: catalog.schemas, out: catalog.out });
```

Add to pfi-sniper root `package.json` scripts: `"env:catalog": "tsx scripts/gen-env-catalog.ts"` and `"env:catalog:check": "coolify-harness catalog check"`.

- [ ] **Step 6: Generate the catalog and verify it round-trips**

Run: `cd ~/Projects/pfi-sniper && pnpm env:catalog && pnpm env:catalog:check`
Expected: `catalog gen` writes `docs/env-catalog.md` + `docs/env-catalog.json` + `.env.example`; `catalog check` reports fresh (exit 0). Spot-check `docs/env-catalog.md` — keys with no `.describe()` appear under "Keys missing a description". (Authoring `.describe()` for each key is net-new, tracked separately — not in this plan's scope per spec §11.5.)

- [ ] **Step 7: Add .coolify-harness/ to .gitignore and commit**

```bash
cd ~/Projects/pfi-sniper && git checkout -b chore/coolify-harness-onboarding
# add `.coolify-harness/` to .gitignore
git add -A && git commit -m "chore: onboard pfi-sniper as coolify-harness consumer #1"
```

---

### Task 22: CI stale-check wiring + README finalize

**Files:**
- Create: `~/Projects/coolify-harness-api/.github/workflows/ci.yml`
- Modify: `~/Projects/coolify-harness-api/README.md`
- Modify: `pfi-sniper: .github/workflows/<existing CI>` (add an env-catalog freshness step)

**Interfaces:**
- Produces: CI gates for both repos.

- [ ] **Step 1: Write the toolkit CI workflow**

`~/Projects/coolify-harness-api/.github/workflows/ci.yml`:

```yaml
name: CI
on: [push, pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: corepack enable pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test:coverage
      - run: pnpm build
```

- [ ] **Step 2: Finalize the README**

Document: install, the config file shape, the `catalog gen`/`check` flow, the `env diff`/`apply`/`deploy` flow, the safe-write discipline (dry-run → `--apply` → separate deploy), the token scope table (`read`+`read:sensitive` for diff, `+write` for apply, `+deploy` for deploy), the exit-code table, and — prominently — **"Coolify API contract pinned to v4.1.2; re-record fixtures + re-run live-smoke on a Coolify upgrade."** Note the documented MCP-adapter seam (§10 of the spec).

- [ ] **Step 3: Add the pfi-sniper CI freshness gate**

Add a step to pfi-sniper's existing Verify workflow that runs `pnpm env:catalog:check` (after install + build of the env modules, so the dynamic import resolves). A stale catalog fails CI with exit 3.

- [ ] **Step 4: Commit both**

```bash
cd ~/Projects/coolify-harness-api && git add -A && git commit -m "ci: verify pipeline + finalize README"
cd ~/Projects/pfi-sniper && git add -A && git commit -m "ci: gate env-catalog freshness"
```

---

## Self-Review

**1. Spec coverage:**

| Spec section | Task(s) |
| ------------ | ------- |
| §2 package layout / subpath exports | 1 (exports map), 20 (index re-exports) |
| §3.1 Coolify ground truth (fields, scopes, no-comment, bulk quirk) | 5 (schemas + passthrough comment), 7 (bulk quirk retry), Global Constraints |
| §3.2 HTTP layer (breaker, retry, redaction, contract Zod) | 3 (redaction), 5 (parseOrContractError), 6 (breaker), 7 (retry) |
| §3.3 response schemas (.passthrough) | 5 |
| §3.4 CoolifyClient (kind-aware deploy ack) | 8 |
| §4.1 planEnvWrite (pure) | 9 |
| §4.2 encoded invariants (upsert-by-key, dup-drift detect+repair, redeploy-separate) | 9 (detect+repair), 10 (no DELETE), 20 (deploy separate) |
| §4.3 applyEnvWrite + AuditRecord (keys-only) | 10 |
| §5.1 walker + Zod 3.24 unwrap chain | 11 |
| §5.2 emitters (MD/JSON/dotenv) | 13, 14 |
| §5.3 many-per-key merge + conflict | 12 |
| §5.4 ~10-line consumer script + export prereq | 21 |
| §5.5 stale-check | 17, 19 (CLI), 22 (CI) |
| §6 config registry + token handling + scope docs | 4, 19 (config doctor), 22 (README scope table) |
| §7 CLI surface + flag semantics + exit codes | 18, 19, 20 |
| §8 testing strategy (faked fetch, golden, coverage ≥90%) | 5–20 (per-task tests), 16 (golden), 20 step 8 (coverage gate) |
| §9 error taxonomy + observability/audit | 2, 3, 10 |
| §10 MCP seam (cli free of business logic) | 18–20 (thin cli), 20 step 9 (index re-exports) |
| §11 risks: version pinning / bulk fallback / service deploy / superRefine best-effort / export prereq | 5 (v4.1.2 fixtures), Global Constraints (bulkStrategy noted), 8 (service ack shape), 11 (superRefine unwrap), 21 |

**Gaps consciously deferred (documented in spec §11, out of plan scope):**
- Authoring `.describe()` text for pfi-sniper's ~129 keys (net-new content authoring — spec §11.5; Task 21 step 6 surfaces the missing-description list but does not author them).
- The `bulkStrategy: 'per-key'` fallback switch is noted in Global Constraints as a small bounded addition (spec §11.2 calls it "documented but a bounded addition"); the v1 path is bulk-only. If the orchestrator wants it in v1, add a per-key loop in `CoolifyClient.upsertEnvs` gated by a config flag — flagged here as an explicit assumption that it is deferred.
- Live-smoke re-record script (spec §8 "separate, optional, manually-run") — documented in README (Task 22) as an operator step; a stub script is not built in v1.

**2. Placeholder scan:** No "TBD/handle errors/similar to Task N" — every code step has full code. The only literal `TODO` strings are the Coolify `uuid` values in Task 21's config (operator fills from the Coolify UI; explicitly noted as not needed for catalog commands).

**3. Type consistency:** `EnvWriteItem`, `EnvVar`, `EnvWritePlan`, `AuditRecord`, `CatalogEntry`, `CatalogModel`, `SchemaInput`, `ResolvedTarget`, `DeployAck`, `EnvCmdDeps` are defined once and referenced with matching shapes across tasks. `CoolifyClient` method names (`listEnvs`/`upsertEnvs`/`deploy`/`restart`) are consistent in client, safe-write deps, and CLI deps. `buildAuditRecord`/`applyEnvWrite`/`planEnvWrite` signatures match between definition (Tasks 9, 10) and use (Task 20).

## Explicit assumptions (spec gaps resolved without blocking)

1. **Catalog schemas are surfaced via a named `export const catalog` in the consumer config module** (not the Zod registry — schemas aren't serializable). Resolved in Task 19; the spec's §5.4 script shape is honored, just sourced through the config module so `catalog gen`/`check` can find the schemas without a second script path. (Alternative: pass schemas only via the standalone `gen-env-catalog.ts` and have `catalog check` import it — rejected because CLI `catalog check` needs the schemas too.)
2. **`bulkStrategy: 'per-key'` fallback deferred from v1** (spec §11.2 frames it as optional). v1 ships bulk-only with the retry+breaker+`CoolifyBulkUnmarshalError`. Flagged above.
3. **Coolify v4.1.2 is the pinned contract version** (research finding [2]); recorded in README + Global Constraints. The `comment` field present in v4.1.2's model is tolerated via `.passthrough()` and never written.
