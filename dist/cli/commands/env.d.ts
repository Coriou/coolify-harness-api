import type { ParsedArgs } from '../args.js';
import { type CmdDeps } from '../deps.js';
export { parseDotenv } from '../dotenv.js';
/** Kept for backwards compatibility; every command now shares CmdDeps. */
export type EnvCmdDeps = CmdDeps;
/**
 * `env diff`: read-only plan. JSON: the plan, with every value redacted (creates/updates keep
 * their keys and flags; `value` becomes `[REDACTED] (N chars)`).
 * `--fail-on-drift` exits 4 on duplicate-key drift; `--fail-on-changes` exits 4 when anything
 * would be created or updated (a CI / agent "is the live env in sync?" check).
 */
export declare function envDiff(args: ParsedArgs, deps: EnvCmdDeps): Promise<number>;
/** Outcome of `env apply`, for callers that fold it into a larger document (`flag set --redeploy`). */
export interface EnvApplyOutcome {
    code: number;
    /** The single JSON document of the run (plan + dryRun/applied/confirmed). Values are redacted on print. */
    doc: Record<string, unknown>;
}
export declare function runEnvApply(args: ParsedArgs, deps: EnvCmdDeps): Promise<EnvApplyOutcome>;
/**
 * `env apply`: dry-run unless --apply. With `--json` it prints exactly one document: the plan
 * (values redacted) plus `dryRun`, `applied` (keys) and `confirmed` (null on a dry-run).
 */
export declare function envApply(args: ParsedArgs, deps: EnvCmdDeps): Promise<number>;
/** `env list`: keys, scope, flags and value LENGTH only — values are never printed. */
export declare function envList(args: ParsedArgs, deps: CmdDeps): Promise<number>;
/** True when the compose document still references KEY (`${KEY}`, `$KEY`, `KEY=`, `KEY:` or a bare `- KEY`). */
export declare function composeReferences(compose: string, key: string): boolean;
/**
 * `env delete`: delete env rows by key. Dry-run unless --apply.
 * Refuses (exit 6, LockedVarError) when a key is Coolify-managed (`is_coolify`) or still referenced
 * by the resource's docker-compose — Coolify would re-create such a row on its next parse, so the
 * delete would silently not stick. Remove the reference first (`compose set`) or pass --force.
 * With `--json` it prints one document: the plan, then (after --apply) `deleted` and `confirmed`.
 */
export declare function envDelete(args: ParsedArgs, deps: CmdDeps): Promise<number>;
