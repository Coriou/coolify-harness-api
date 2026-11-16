# coolify-harness

[![CI](https://github.com/Coriou/coolify-harness-api/actions/workflows/ci.yml/badge.svg)](https://github.com/Coriou/coolify-harness-api/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Coriou/coolify-harness-api)](https://github.com/Coriou/coolify-harness-api/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/Coriou/coolify-harness-api/blob/main/LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D24-339933?logo=node.js)](https://nodejs.org/)

**An agent control plane for [Coolify](https://coolify.io).** A small CLI and typed TypeScript
library that lets an AI agent (Claude Code, Cursor, Codex, …) or a human operate the apps you host
on Coolify from inside the project directory: deploy and wait, read status and logs, manage env
vars, edit service composes, the proxy (Traefik) and databases.

- **Safe by default.** Every command that changes Coolify is a dry-run until you add `--apply`.
  `deploy` is the one exception: running it *is* the explicit step (preview it with `--dry-run`).
- **Secrets never printed.** Env values are never shown, only their length. Every output is
  redacted: tokens, webhook secrets, URL passwords, literals in compose files, basic-auth hashes.
  (Redaction of free-form documents is a heuristic: see [SECURITY.md](SECURITY.md) for what it
  covers and what it cannot know.)
- **Built for agents.** `--json` prints exactly one document. Errors are typed, with precise exit
  codes. Every mutation is appended to a local audit log (keys only, never values).
- **Knows Coolify's traps.** No auto-redeploy on env change, production vs preview rows,
  compose-locked variables, duplicate keys, cached images: all encoded, all tested.
- **Light.** One runtime dependency (zod). No daemon, no server.

It also generates an env catalog (Markdown + JSON + `.env.example`) from your Zod schemas, zod 3
or zod 4.

## Compatibility

| coolify-harness | Coolify verified live | Tested range | Notes |
|---|---|---|---|
| **0.5.0** | 4.7.5 | 4.5.0 – 4.7.5 | `env delete` needs the `delete` token ability on Coolify ≥ 4.7 |
| 0.4.1 | 4.7.5 (env commands) | 4.5.0 | fixes env rows with `value: null` (Coolify 4.7) |
| 0.4.0 | 4.5.0 | 4.5.0 | env commands fail on Coolify 4.7 when a variable is blank in the compose file |
| 0.3.0 | — | 4.1 – 4.3.15 | `status` and `deploy --wait` fail from Coolify 4.3.16 |

The harness has its own version number: it does **not** follow Coolify's. The range it is tested
against is exported (`TESTED_COOLIFY`), printed by `coolify-harness --version`, and checked at
runtime: `instance info` and `config doctor` warn when the live Coolify is outside it. A warning is
not a failure; it tells you where to look first if a command reports a contract error. Details:
[Versioning](#versioning-and-compatibility), [`docs/coolify-api-coverage.md`](docs/coolify-api-coverage.md).

## Install

coolify-harness is distributed from GitHub only: it is not on a package registry. Pin a tag:

```bash
pnpm add -D coolify-harness@github:Coriou/coolify-harness-api#v0.5.0
```

```bash
bun add -d coolify-harness@github:Coriou/coolify-harness-api#v0.5.0
```

Or install the tarball attached to each [GitHub release](https://github.com/Coriou/coolify-harness-api/releases).
Same content, and the machine needs no git (a CI image, a Docker build):

```bash
pnpm add -D https://github.com/Coriou/coolify-harness-api/releases/download/v0.5.0/coolify-harness-0.5.0.tgz
```

```bash
bun add -d https://github.com/Coriou/coolify-harness-api/releases/download/v0.5.0/coolify-harness-0.5.0.tgz
```

Needs **Node.js ≥ 24** (or Bun). Both forms ship the built `dist/`, so the install runs no build
and no `prepare` script: nothing to allow-list in pnpm, nothing for Bun to block.

## Quick start (5 minutes)

**1. Create an API token** in Coolify (*Keys & Tokens → API tokens*; the API must be enabled in the
instance settings). Abilities: `read`, `read:sensitive`, `write`, `deploy`, and `delete` if you
want `env delete` (Coolify ≥ 4.7). Put it in a git-ignored `.env`:

```bash
# .env — quoted: Coolify tokens contain a "|"
COOLIFY_PROD_TOKEN="12|xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

**2. Describe your instance and apps** in `coolify-harness.config.ts` at the project root:

```ts
import { defineConfig } from 'coolify-harness/config';

export default defineConfig({
  instances: {
    // tokenEnv is the NAME of the env var holding the token. Never the token itself.
    prod: { url: 'https://coolify.example.com', tokenEnv: 'COOLIFY_PROD_TOKEN' },
  },
  targets: {
    // kind: 'application' | 'service' | 'database'. The uuid is in the resource's URL in Coolify.
    'my-app': { instance: 'prod', kind: 'application', uuid: 'xxxxxxxxxxxxxxxxxxxxxxxx' },
  },
});
```

`.mts`, `.mjs` and `.js` configs work too (`coolify-harness.config.mjs`, same content without types).

**3. Add a script** to `package.json` so the token is loaded and the command is short:

```json
{
  "scripts": {
    "coolify": "coolify-harness --token-file .env"
  }
}
```

`--token-file` reads the token from that dotenv file (only `KEY=VALUE` lines matter; a variable
already set in your environment wins; a missing file is fine when the token comes from the
environment, as in CI). On a machine with Bun and no Node, use
`"coolify": "bun node_modules/coolify-harness/dist/cli/main.js"` instead: Bun loads `.env` itself.

**4. Check the wiring, then look around:**

```bash
pnpm --silent coolify config doctor          # config valid? token set? instance reachable? version tested?
pnpm --silent coolify status --app my-app    # state + latest deployment
pnpm --silent coolify env list --app my-app  # keys, flags and value LENGTHS — never values
pnpm --silent coolify help
```

With Bun: `bun run --silent coolify config doctor`, and so on. Keep `--silent`: without it the
script runner prints the command line (and, on older pnpm, a banner) around the tool's output.

<details>
<summary>Alternative: a tiny entry script (handy when you want to load env your own way)</summary>

```ts
// scripts/coolify.ts
import { run } from 'coolify-harness/cli';

await run(); // what the `coolify-harness` bin does: reads process.argv, prints, sets the exit code
```

Run it with `bun scripts/coolify.ts status --app my-app` (Bun loads `.env`), or
`node --env-file=.env scripts/coolify.ts status --app my-app` (Node ≥ 24 runs TypeScript natively;
`--env-file` is Node's own flag here, placed before the script).

`run()` also survives a closed pipe (`… | head`) and exits as soon as the output is flushed.
`main(argv)` is the same command without those: it returns the exit code and never exits the
process, for embedding in a larger program.

</details>

## For AI agents

Everything an agent needs to drive a deployment safely. The examples write `coolify-harness`; use
the script from the quick start (`pnpm --silent coolify …`) so the token is loaded and nothing but the
tool's own output reaches stdout.

**The loop**

```bash
coolify-harness config doctor --app my-app --json      # 1. wiring OK? (exit 0)
coolify-harness status --app my-app --json --no-logs   # 2. what is running, last deployment
coolify-harness env diff --app my-app --from-file .env.production --fail-on-changes
                                                       # 3. exit 0 = in sync, exit 4 = changes pending
coolify-harness env apply --app my-app --from-file .env.production --apply --json
                                                       # 4. write (check "confirmed": true)
coolify-harness deploy --app my-app --wait --json --no-logs
                                                       # 5. exit 0 finished · 7 failed · 8 timed out
coolify-harness logs --app my-app --build              #    on failure: the build log
```

`deploy --wait` waits up to **600 s** (`--timeout <seconds>`; a poll in flight at the deadline gets
up to 10 s more). Give the shell that runs it a longer timeout than that, or pass a shorter
`--timeout`: a wait that is killed (SIGTERM) or interrupted still prints its document with the
`deploymentUuid`, exit 130, and the deployment keeps running.

**Safety model**

- A command marked `*` in `help` changes Coolify. Without `--apply` it only reports what it would
  do (exit 0, unless the request could not be carried out anyway: an unknown key, a locked
  variable, a missing ability). Add `--apply` to do it.
- `deploy` (and `deploy --restart`) acts immediately; `deploy --dry-run` sends nothing.
- `--help` wins wherever it stands on the line: nothing else runs. `--version` stands alone
  (global flags such as `--token-file` aside); beside a command it is refused (exit 2) and
  nothing runs.
- Env changes do nothing until a redeploy. That step is always explicit.
- `compose get` / `proxy get` print a redacted document. `--out FILE` writes the real one (mode
  0600): keep it out of git and out of your context.
- The harness never prints a token or an env value, and never SSHes into a server.
- **Pass secret values with `--from-file`, never with `--set`.** A command line is visible to
  script runners, process lists and shell history, outside the harness's control. `--set` is for
  flags and other non-secret values.
- Every mutation is appended to `.coolify-harness/audit.jsonl` (who, what, which keys, outcome).
  Git-ignore that directory.

**Output contract**

- `--json`: stdout is exactly one JSON document (redacted), on every command including `help`.
  On success stderr is empty: warnings and notes are fields of the document (also `auditError`,
  when the local audit record could not be written).
- On failure (any non-zero exit) with `--json`, stderr is one JSON document:
  `{ "error": { "code": "COOLIFY_AUTH_SCOPE", "message": "…", "exitCode": 5 } }`.
  When part of the work was done before the failure (a deployment queued, rows deleted, a compose
  saved), stdout still carries the document saying so.
- Build logs are large (hundreds of kB per deployment). Use `--no-logs` on `status`, `deployments`,
  `deployment` and `deploy --wait`: you get `logs_length` instead, and the application record
  Coolify embeds in every deployment is left out too.
- A request gets 30 s. A read that fails is retried (once after a timeout: about a minute at
  worst). A deploy, restart, cancel, delete, proxy or database write is **never** sent twice;
  the env bulk write and the service compose save give the same result when repeated and are
  retried like reads, and a 429 (rate limited: not processed) is retried for any request. When a
  write fails after it may have reached Coolify (a timeout, a dropped connection, a 5xx), the
  error says so and carries `"outcomeUnknown": true` or the HTTP status: check what happened
  (`deployments`, `env diff`, `compose get`) before running it again.

**Exit codes**

| Code | Meaning | What to do |
|---|---|---|
| 0 | Success (including a clean dry-run) | — |
| 1 | Coolify answered with an error, could not be reached, or sent an unexpected payload | Read `error.code`: `COOLIFY_REQUEST`, `COOLIFY_NOT_FOUND`, `COOLIFY_NETWORK`, `COOLIFY_CONTRACT`, `DEPLOY_NOT_QUEUED` (Coolify's deployment queue is full: retry later) |
| 2 | Bad command, flag, config, or something the Coolify API cannot do | Fix the invocation; `help` lists everything |
| 3 | Catalog is stale | `catalog gen`, commit |
| 4 | Drift: duplicate keys (`--fail-on-drift`) or pending changes (`--fail-on-changes`) | Review the plan |
| 5 | Token missing, rejected, or lacking an ability | The message names the ability |
| 6 | Refused to delete an env var Coolify would re-create | Remove it from the compose first, or `--force` |
| 7 | `deploy --wait`: the deployment failed or was cancelled | `logs --build` |
| 8 | `deploy --wait`: timed out (`--timeout`, default 600 s) | The deployment is still running: `deployment <uuid>` |
| 130 | `deploy` interrupted while it checks or waits (Ctrl-C or SIGTERM) | The deployment is still running; the message says how to follow or cancel it |

**Copy-paste for your `CLAUDE.md` / `AGENTS.md`**

```md
## Deploys (Coolify)

This project is operated with `coolify-harness` (config: `coolify-harness.config.ts`, token in the
git-ignored `.env`). Run it as `pnpm --silent coolify <command>`; `pnpm --silent coolify help` lists everything.

- Look first: `pnpm --silent coolify config doctor`, `pnpm --silent coolify status --app <target> --json --no-logs`.
- Env: `env list` shows keys and lengths only. `env diff --from-file <file>` shows what would
  change; `env apply --from-file <file> --apply` writes it. Env changes are inert until a redeploy.
- Deploy: `pnpm --silent coolify deploy --app <target> --wait` (exit 0 finished, 7 failed, 8 timed out;
  `--force` rebuilds without the Docker cache). It waits up to 600 s: run it with a longer shell
  timeout, or pass `--timeout <seconds>`. On failure: `pnpm --silent coolify logs --app <target> --build`.
- A failed deploy is never retried by the tool. If an error says the request may have reached
  Coolify, check (`deployments`, `env diff`) before running it again.
- Commands that change Coolify are a dry-run without `--apply`. `deploy` is the exception: it acts
  immediately. Ask before deploying to production unless told otherwise.
- Never print, log or commit a token or an env value. Put secret values in a file and use
  `--from-file`, never `--set`. Never write `compose get --out` / `proxy get --out` files inside
  the repository.
- Exit codes: 0 ok, 1 Coolify/network error, 2 usage/config, 3 catalog stale, 4 drift, 5 auth,
  6 locked env var, 7 deploy failed, 8 wait timeout, 130 wait interrupted. With `--json`, errors
  are `{ "error": { "code", "message" } }` on stderr.
```

## Commands

Targets come from the config (`--app <target>`). Instance-wide commands take `--instance <name>`
(a key of `instances`) or infer it from `--app`. `--config <path>` picks another config file.
The parser accepts `--flag=value`, `env-diff` / `env:diff` spellings and flags before the command.

### Env vars

```bash
coolify-harness env list   --app my-app [--json]
coolify-harness env diff   --app my-app [--from-file .env] [--set KEY=VALUE]... [--preview] [--fail-on-changes] [--fail-on-drift]
coolify-harness env apply  --app my-app [--from-file .env] [--set KEY=VALUE]... [--preview] [--apply]
coolify-harness env delete --app my-app --key OLD_KEY [--key OTHER]... [--preview] [--force] [--apply]
coolify-harness flag set   --app my-app --set KEY=VALUE [--apply] [--redeploy [--wait]]
```

- `env list` prints the key, scope, flags and value **length**. `len=0 (null)` is a variable with
  no value at all (Coolify 4.7 stores a compose-declared `${VAR:-}` that way); `len=hidden` means
  the token lacks `read:sensitive`; `len=locked` is a variable locked in Coolify ("shown once").
- `env diff` is read-only. The desired values come from `--from-file` (dotenv; quotes around a
  value are removed, an unquoted value is taken as is), overridden by `--set`.
- `env apply` upserts by key. Keys you do not mention are left alone (use `env delete`). After
  `--apply` it re-reads to confirm. With `--json` the document has `dryRun`, `applied`, `confirmed`.
- **Production and preview rows are separate.** `env diff` / `apply` / `delete` work on
  production rows; `--preview` switches to preview rows (applications only: services and databases
  have none). A differing row in the other scope is reported as "not written", never changed.
- `env delete` refuses (exit 6) a key that Coolify manages or that the compose file still
  references: Coolify would re-create it. Remove the reference first, or pass `--force`.
- `flag set` is `env apply` plus, with `--redeploy`, a deploy. The deploy only happens together
  with `--apply` (and then even if the value was already set: you asked for a redeploy). It needs
  something to set: without `--set` / `--from-file` it is a usage error, not a bare deploy.
- A variable name must start with a letter or `_` and contain only letters, digits, `_` and `.`;
  anything else is refused (exit 2) before a request is sent.
- `env diff` / `apply` need `read:sensitive`; without it Coolify withholds values and the harness
  stops (exit 5) instead of planning against blanks.

### Deploy

```bash
coolify-harness deploy --app my-app [--force] [--wait [--timeout SEC]] [--dry-run] [--json]
coolify-harness deploy --app my-svc --restart [--latest]
```

- Applications: queues a build. Services and databases: starts them. `--restart` restarts instead.
- `--force` rebuilds an application **without the Docker cache**. A plain redeploy of an unchanged
  commit reuses the image, so use `--force` to pick up a patched base image.
- `--restart --latest` pulls fresh images for a service.
- `--wait` follows an application deployment to its end, printing status changes on stderr.
  Ctrl-C (or SIGTERM) stops the wait, not the deployment, and prints how to follow or cancel it.
- A network error or a 5xx on a deploy request is **not** retried: Coolify may have queued it.
  Check `deployments --app my-app` before running it again.
- Coolify answers "queued" even when its deployment queue is full and nothing was created. The
  harness checks that the deployment exists (one read of at most 10 s; with `--wait` the first
  poll is that check) and fails with `DEPLOY_NOT_QUEUED` if Coolify says it does not.
- When Coolify skips the request because that commit is already queued or building, `--wait`
  reports on **that** production deployment (`"followedExisting": true`): it follows it, or, if it
  ended moments ago, returns its outcome (exit 0 finished, 7 otherwise). If it cannot tell which
  deployment that is, it fails (exit 1) rather than report an older one.
- If Coolify accepts the request but its acknowledgement cannot be read (`"unrecognised": true`),
  `--wait` fails the same way: check `deployments` before deploying again.

### Status, logs, deployment history (read-only)

```bash
coolify-harness status --app my-app [--json] [--no-logs]
coolify-harness logs --app my-app [--lines 200] [--timestamps]            # runtime logs
coolify-harness logs --app my-svc --service postgresql                    # a service needs --service
coolify-harness logs --app my-app --build [--deployment UUID]             # build log
coolify-harness deployments --app my-app [--take 5] [--skip 0] [--no-logs]
coolify-harness deployments --instance prod                               # queued + in progress, whole team
coolify-harness deployments --app my-app --running                        # the same, instance taken from the target
coolify-harness deployment UUID (--app my-app | --instance prod) [--no-logs]
coolify-harness deployment cancel UUID (--app my-app | --instance prod) [--apply]
```

`status` and `logs --build` show the latest **production** deployment: a pull-request preview
build on top of the list is skipped (and labelled, when the newest ten are all previews).

### Service compose

```bash
coolify-harness compose get --app my-svc [--out svc.yml]                 # needs read:sensitive
coolify-harness compose set --app my-svc --image umami=ghcr.io/umami-software/umami:3.4.0 [--apply] [--restart]
coolify-harness compose set --app my-svc --from-file svc.yml [--apply]
```

- `--image` rewrites only that service's `image:` line; comments, quoting and order survive.
- Coolify saves and re-parses the compose but does not restart; `--restart` restarts with fresh
  images. Nothing changed means nothing saved and nothing restarted (the output says so).
- `--from-file` must be a compose document (a top-level `services:`); anything else is refused.
- The dry-run prints a diff with secrets redacted on both sides. A line shown as `+ [REDACTED]`
  (or `~ [REDACTED]`) is an added or changed line you cannot review there: the output says how
  many there are (`"hiddenAddedLines"` with `--json`, a `NOTE:` line otherwise). Read them in
  your own `--from-file` document before `--apply`. `proxy set` does the same.
- If the save fails with a 5xx or a dropped connection, the stored compose is read back and the
  error says whether it is the new one (`"stored": "new" | "old" | "changed" | "unknown"`):
  Coolify saves before it re-parses, so a 500 can leave the new document in place.
- For services only. A docker-compose *application* deploys its compose from git.

### Instance, servers, proxy (Traefik)

```bash
coolify-harness instance info --instance prod            # Coolify version, health, tested-range check
coolify-harness servers --instance prod
coolify-harness server get --instance prod --server UUID
coolify-harness proxy get --instance prod --server UUID [--out proxy.yml]
coolify-harness proxy set --instance prod --server UUID --image traefik:v3.6.4 [--apply] [--restart]
coolify-harness proxy restart --instance prod --server UUID [--apply]
```

- The Traefik version is changed by editing the proxy compose: `proxy set --image` fetches it,
  changes the `image:` line and saves it; `--restart` pulls and runs it. A proxy restart briefly
  interrupts **every site on that server**. Pass `--image` or `--from-file`, not both.
- The proxy configuration is only returned to a `read:sensitive` token of a team admin/owner.

### Standalone databases

```bash
coolify-harness databases --instance prod
coolify-harness database get     --instance prod --database UUID      # or --app <database target>
coolify-harness database set     --instance prod --database UUID --public false [--public-port N] [--image REF] [--apply]
coolify-harness database backups --instance prod --database UUID
coolify-harness database backup  --instance prod --database UUID [--backup UUID] [--apply]   # run a schedule now
```

`env …`, `deploy` / `--restart` and `logs` also work on `database` targets. Databases inside a
service (a template's postgres) use other endpoints and are not covered yet.

### What the Coolify API cannot do

Coolify (checked up to 4.7.5) has **no API** to update Coolify itself, install server package
updates, or reboot a server. `instance upgrade`, `server patch` and `server reboot` exist only to
say so (exit 2) and point to the dashboard page. The harness will not SSH into servers or write
Coolify's database to fake them. There is also no API to wait for a deployment (the harness polls)
or to read one without its build log (`--no-logs` only trims the output).

### Env catalog from Zod schemas

```ts
// coolify-harness.config.ts
import type { SchemaInput } from 'coolify-harness/catalog';
import { ApiEnvSchema } from './src/env.ts';

export const catalog = {
  schemas: [{ service: 'api', schema: ApiEnvSchema }] satisfies SchemaInput[],
  out: { markdown: 'docs/env-catalog.md', json: 'docs/env-catalog.json', dotenvExample: '.env.example' },
};
```

```bash
coolify-harness catalog gen     # writes the three files
coolify-harness catalog check   # exit 3 when they are stale: a CI gate
```

The walker reads your schema objects directly, so it works with **zod 4, zod mini and zod 3**,
whatever zod the harness itself uses. It follows defaults, optionals, coercion, enums, transforms,
refinements and intersections (and, on zod 4, pipes and `z.stringbool()`), and takes descriptions
from `.describe()` / `.meta()`. Output for zod 3 schemas is unchanged from 0.4.
The config is loaded by your runtime: if it imports TypeScript sources with `.js` specifiers, run
the CLI through Bun or `tsx`.

## Token abilities

| Command | Abilities |
|---|---|
| `config doctor`, `instance info`, `status`, `deployments`, `deployment`, `servers`, `server get`, `databases`, `database get/backups` | `read` |
| `env list` | `read` (`read:sensitive` to see value lengths) |
| `env diff`, `logs` (runtime or build) | `read` + `read:sensitive` |
| `env apply`, `flag set` | `read` + `read:sensitive` + `write` (`flag set --redeploy`: + `deploy`) |
| `env delete` | `read` + `delete` (Coolify ≥ 4.7; `write` on older versions); `read:sensitive` too on a service or a docker-compose application (the compose is read to check the key is not referenced) |
| `deploy`, `deploy --restart` | `deploy` (+ `read` for `--wait` and for the check that the deployment was queued. Without `read` the check is skipped, at the cost of one 403 per deploy, which Coolify 4.7 counts toward its failed-request limit) |
| `deployment cancel` | `read` + `deploy` |
| `compose get` | `read` + `read:sensitive` |
| `compose set` | `read` + `read:sensitive` + `write` (+ `deploy` for `--restart`) |
| `proxy get` | `read`; the configuration needs `read:sensitive` |
| `proxy set` | `read` + `read:sensitive` + `write` + `deploy` |
| `proxy restart` | `read` + `deploy` |
| `database set` | `read` + `write` (+ `deploy` when `--public` changes) |
| `database backup` | `read` + `write` + `deploy` |
| `catalog gen` / `catalog check`, `help`, `--version` | none (local) |

`read:sensitive` only works when the token's user is an admin or owner of the team. A token
limited to some projects cannot use server-level commands (`servers`, `server get`, `proxy …`).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Coolify response (listEnvs) failed contract validation` on `env list` | coolify-harness ≤ 0.4.0 with Coolify 4.7: a variable left blank in the compose (`${VAR:-}`) comes back as `value: null` | Upgrade to ≥ 0.4.1. It is listed as `len=0 (null)` |
| `… failed contract validation: <field>: …` on another command | Coolify changed a payload | Run `instance info`: is the version outside the tested range? Upgrade coolify-harness, or open an issue with the message (it contains field names and types only) |
| Exit 5, `Coolify refused the request (403) … Missing required permissions: delete` | Coolify ≥ 4.7 needs the `delete` ability for `env delete` | Create a token that has `delete` |
| Exit 5, `… lacks 'read:sensitive'` although the token has it | `read:sensitive` needs an admin/owner user | Create the token as a team admin/owner |
| Exit 5, `This API token is limited to selected projects…` | Scoped token on a server-level command | Use a team-wide token for `servers` / `proxy` |
| Exit 5, `Env var 'X' … is not set` | The token is not in the environment | `--token-file .env` (see the quick start), or export the variable |
| `Unknown flag: --env-file`, or `node: .env: not found` (exit 9) | Node reserves `--env-file` for itself, anywhere on the command line, and stops before the tool starts when the file is missing | Use `--token-file` |
| Exit 1, `DEPLOY_NOT_QUEUED` | Coolify said "queued" but created no deployment: the server's deployment queue is full | Wait for it to drain (`deployments --instance …`), then deploy again |
| Exit 1, `… may have reached Coolify` / `"outcomeUnknown": true` | A write timed out or lost its connection after it may have been sent | Check its effect first (`deployments`, `env diff`, `compose get`); the tool never re-sends a deploy |
| Exit 1 after `deploy --wait`: `… could not be identified` or `acknowledgement could not be read` | Coolify queued nothing new, or its answer was unreadable, and no running or just-ended deployment matches | `deployments --app …` shows what is there; deploy again only if nothing is queued |
| Exit 6 on `env delete` | Coolify manages the key or the compose still references it | Remove the reference (`compose set` or git), or `--force` |
| Exit 5, `Coolify did not return the docker-compose document` | Coolify hides the compose from a token without `read:sensitive` (or a non-admin user) | Use such a token |
| `… answered … with a redirect (301)` | The instance `url` in the config is not the final address (http → https, another host) | Put the final URL in the config. Redirects are never followed: the token would travel |
| Exit 2, `variable name(s) are not valid` | A name with a dash or a space, or a multi-line value that is not quoted in the dotenv file | Quote multi-line values (`KEY="line1\nline2"`), fix the name |
| JSON on stdout is preceded by `> pkg@1.0.0 coolify …` | The script runner's banner | `pnpm --silent coolify …` / `bun run --silent coolify …` |
| `env apply` says "confirmation mismatch" | Two rows of the same key in one scope: Coolify updates only one | `env list`, then `env delete` the extra row |
| `env diff` keeps listing a key as an update | The key is locked (`len=locked`): Coolify never returns its value, so it cannot be compared | Expected; it is rewritten each time |
| Env changed but the app did not | Coolify never redeploys on an env change | `deploy --app … --wait` |
| Redeploy did not pick up a new base image | An unchanged commit reuses the cached image | `deploy --force` |
| `Cannot reach Coolify at …` (exit 1, `COOLIFY_NETWORK`) | DNS, TLS, VPN, or Coolify is restarting | Retry reads freely. For a deploy, check `deployments` first |
| `Could not load config …` | The runtime cannot import the config | Node ≥ 24 runs a self-contained `.ts`; otherwise use Bun / `tsx`, or a `.mjs` config |
| `deploy --wait` says it is "following the deployment already in progress" (`"followedExisting": true`) | Coolify skipped the request: the same commit is already queued or building | Nothing: it reports on that deployment |
| `deploy --wait` exits 130 after about two minutes | The shell that ran it timed out and sent SIGTERM | Raise the shell timeout above 600 s or pass `--timeout`; the deployment itself kept running |
| pnpm: `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` installing ≤ 0.4.1 | Old versions had a `prepare` script | Install ≥ 0.5.0, or the 0.4.1 release tarball |

Set `COOLIFY_HARNESS_DEBUG=1` to print a stack trace with an error (text mode only; `0` and
`false` mean off).

## Coolify hazards encoded

- **No auto-redeploy on env change.** Env changes are inert until you run `deploy`.
- **Compose-locked variables.** A variable the compose references, or that Coolify manages, comes
  back after a delete; `env delete` refuses it (exit 6).
- **Production vs preview rows.** A bulk write touches one scope. Plans and confirmations are
  scoped the same way; services and databases have no preview rows at all.
- **Duplicate keys.** Two rows of a key in one scope with different values are reported as drift;
  Coolify's bulk write updates only one of them.
- **Null and locked values.** `value: null` is an empty value, not a hidden one; a locked row is
  never returned and never compared.
- **Flags on update.** Coolify 4.5 reset `is_literal` / `is_multiline` / the lock when a bulk
  update omitted them; the harness sends back the flags a row has set.
- **Redeploy reuses images.** Use `deploy --force`.
- **Compose and proxy saves do not restart.** `--restart` applies them.
- **Lost answers.** A mutation whose HTTP answer was lost is not replayed; reads and idempotent
  writes are retried with backoff. Every attempt has a 30 s timeout. A mutation Coolify accepted
  is never reported as failed because its acknowledgement or the confirmation read went wrong,
  and one that may have been carried out is never reported as "nothing happened".
- **Skipped deploys.** Coolify answers "already queued for this commit" without a deployment id;
  `deploy --wait` then reports on the production deployment in progress instead of returning at
  once.
- **A full queue answers "queued".** `POST …/start` returns a deployment id that was never
  created when the server's queue is full; the harness checks.
- **Preview builds in the deployment list.** A pull-request preview is not the state of the
  application: "latest deployment" means the latest production one.
- **Saved, then failed.** Coolify stores a service compose before it re-parses it, and records a
  proxy configuration before it writes the file on the server; a 500 from the second step leaves
  the new document stored. The harness reads it back and says which one is there.
- **Trimmed values.** Coolify trims a value when it saves it; values are compared the same way.
- **The public port of a database** only opens when `is_public` and `public_port` arrive in one
  request, and only for a database that was not public: `database set` sends both, and tells you
  when a port change needs an off/on cycle.
- **A 2xx that is not JSON** (a login or maintenance page in front of Coolify) is not treated as
  an acknowledgement.

## Library

```ts
import { CoolifyClient, CoolifyInstanceClient, redactDeep, TESTED_COOLIFY } from 'coolify-harness';

const client = new CoolifyClient(target, { fetchImpl: globalThis.fetch, logger: myLogger });
const app = await client.get();                    // contains secrets → redactDeep() before printing
const ack = await client.deploy({ force: true });  // no-cache rebuild
const final = await client.waitForDeployment(ack.deploymentUuid!, { timeoutMs: 900_000, onStatus: (status) => console.error(status) });
await client.restart({ latest: true });            // services: pull images
const logs = await client.getRuntimeLogs(100, { service: 'umami' });

const inst = client.instance();                    // or new CoolifyInstanceClient({ instanceUrl, token }, deps)
await inst.getVersion();                           // '4.7.5'
await inst.updateDatabase(dbUuid, { is_public: false });
```

`planEnvWrite` / `applyEnvWrite` (the env planner and writer), `waitForDeployment`, the compose
helpers, the catalog functions and every typed error are exported from the package root. Errors
extend `CoolifyHarnessError` and carry a stable `code`.

| Import | Contents |
|---|---|
| `coolify-harness` | the clients, the env planner and writer, `waitForDeployment`, redaction, compose helpers, catalog, config and every typed error |
| `coolify-harness/client` | `CoolifyClient` |
| `coolify-harness/catalog` | `generateCatalog`, `buildArtifacts`, `SchemaInput` |
| `coolify-harness/config` | `defineConfig`, `loadConfigModule`, `resolveTarget`, … |
| `coolify-harness/cli` | `run()`, `main(argv)`, `EXIT`, `errorToExitCode` |

## Versioning and compatibility

- coolify-harness follows semver on its own surface: commands and flags, `--json` shapes, exit
  codes and the exported API. Its version does not mirror Coolify's: a Coolify patch release must
  not force a harness release, and a harness fix must not wait for one.
- Each release states the Coolify version it was verified against (CHANGELOG, GitHub release,
  the table at the top) and the range it is tested against: `TESTED_COOLIFY` in code,
  `coolify-harness --version` on the command line.
- At runtime, `instance info` and `config doctor` compare the live version with that range and
  warn outside it. Coolify payloads are validated at the boundary, so drift shows up as a
  `COOLIFY_CONTRACT` error naming the field, never as silently wrong data.
- On a Coolify upgrade: re-record the fixtures, re-verify, bump `TESTED_COOLIFY` (see
  [CONTRIBUTING](CONTRIBUTING.md)).
- Releases are git tags on GitHub, each with a GitHub release that carries the packed tarball.
  There is no package-registry release.

## Not an MCP server

coolify-harness is a CLI and a library, not an MCP server. It complements Coolify's built-in MCP
endpoint and community servers such as [StuMason/coolify-mcp](https://github.com/StuMason/coolify-mcp):
use those for chat-driven overviews of a whole instance, and this for precise, guarded, auditable
control of one project's deployment surface from the repository. The library is importable on its
own, so an MCP adapter can reuse the same functions.

## Contributing, security, license

[CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) (how to report a leak of a token or
env value) · [CHANGELOG.md](CHANGELOG.md) · MIT license.
