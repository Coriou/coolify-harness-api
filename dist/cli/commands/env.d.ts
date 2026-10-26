import type { ParsedArgs } from '../args.js';
import { type CmdDeps } from '../deps.js';
/** Kept for backwards compatibility; every command now shares CmdDeps. */
export type EnvCmdDeps = CmdDeps;
/** Parse dotenv-style KEY=VALUE text into a record. Ignores blank lines and comments (#). */
export declare function parseDotenv(text: string): Record<string, string>;
export declare function envDiff(args: ParsedArgs, deps: EnvCmdDeps): Promise<number>;
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
 */
export declare function envDelete(args: ParsedArgs, deps: CmdDeps): Promise<number>;
