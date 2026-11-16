import type { ParsedArgs } from '../args.js';
export interface DoctorDeps {
    env?: Record<string, string | undefined>;
    /** Injected in tests; the real one calls `GET /version` with the instance token. */
    getVersion?: (instance: {
        instanceUrl: string;
        token: string;
    }) => Promise<string>;
}
/**
 * `config doctor`: is this project wired up? Validates the config, says which token variables are
 * set (never their value), and — unless `--offline` — calls `GET /version` on every instance that
 * has a token to prove the URL and token work and to compare the live Coolify version with the
 * range this release is tested against (outside the range is a warning, not a failure).
 *
 * Exit code (0 means "you can use what was checked"):
 * - an instance whose token is set but which cannot be reached, or rejects the token → 1 / 5;
 * - the instance you named (`--app` / `--instance`) has no token → 5;
 * - no instance at all has a token → 5 (nothing is usable);
 * - otherwise 0: an instance without a token is only reported when another one works, so a
 *   machine that holds one of several tokens is not an error.
 */
export declare function configDoctor(args: ParsedArgs, deps?: DoctorDeps): Promise<number>;
