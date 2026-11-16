# Contributing

Thanks for helping. This tool holds deploy keys to real servers, so the bar is: safe, predictable,
tested.

## Setup

```bash
git clone https://github.com/Coriou/coolify-harness-api && cd coolify-harness-api
pnpm install          # pnpm >= 12 (see "packageManager"); run `pnpm self-update` if yours is older
pnpm check            # lint + typecheck + tests
```

Node 24 or newer. No dependency runs an install script (`pnpm-workspace.yaml`).

| Command | What it does |
|---|---|
| `pnpm test` / `pnpm test:watch` | vitest |
| `pnpm test:coverage` | tests with the coverage threshold CI enforces |
| `pnpm lint` / `pnpm typecheck` | ESLint (type-aware) / `tsc --noEmit` |
| `pnpm build` | compile `src/` to `dist/` |
| `pnpm check:dist` | rebuild and fail if the committed `dist/` differs |

## Rules

- **Tests first.** A bug fix starts with a failing test that reproduces it.
- **`dist/` is committed.** The package is installed straight from GitHub and must work without a
  build step. After changing `src/`, run `pnpm build` and commit `dist/` in its own commit
  (`build: rebuild dist`). CI fails when they are out of sync.
- **Backward compatible.** Commands, flags, `--json` shapes, exit codes and exports only grow.
  Removing or changing one needs a major version and a migration note in the CHANGELOG.
- **Dry-run by default.** A new command that changes Coolify takes `--apply`, audits what it did
  (keys only) and is covered by a test proving nothing is sent without `--apply`.
- **Never print a secret.** Output goes through `printJson` / `redactDocument`. Error messages are
  built from keys, paths and types. Add a redaction test when you add an output.
- **Validate at the boundary.** Every Coolify response is parsed by a schema in
  `src/client/schemas.ts` (loose objects, `.nullish()` fields: Coolify sends `null` freely).
- **One runtime dependency** (zod). Think twice before adding another.
- **Conventional commits** (`fix(env): …`, `feat(cli): …`, `docs: …`), small and focused.

## Never test against a live Coolify with mutations

Read-only commands against your own instance are fine. Mutation paths are tested with fixtures and
mocks only. Never paste a real token, env value, hostname or compose file into a test, a fixture,
an issue or a commit.

## When Coolify releases a new version

1. Diff upstream `openapi.yaml`, `routes/api.php` and the API controllers between the pinned tag
   and the new one (`coollabsio/coolify`), for the endpoints listed in
   `docs/coolify-api-coverage.md`.
2. Re-record the fixtures with read-only `GET`s into `test/fixtures/coolify/v<major.minor>/`,
   sanitised: keep every key, type and `null`; replace every string with a synthetic value.
3. Add the parse tests, fix what breaks, run every read command against the live instance.
4. Bump `TESTED_COOLIFY` in `src/version.ts`, the compatibility table in the README and the
   coverage doc. Say "Verified against Coolify X.Y.Z" in the CHANGELOG entry and the release.

## Releasing (maintainers)

1. `pnpm check && pnpm check:dist`.
2. Bump `version` in `package.json` and `HARNESS_VERSION` in `src/version.ts` (a test keeps them,
   the README and the CHANGELOG in sync). Rebuild and commit `dist/`.
3. `git tag -a vX.Y.Z -m "vX.Y.Z — summary"`, push `main` and the tag.
4. `gh release create vX.Y.Z` with the CHANGELOG entry, starting with "Verified against Coolify X.Y.Z".
