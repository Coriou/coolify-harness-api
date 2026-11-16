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
 * `config doctor`: is this project wired up? Validates the config, says which tokens are present
 * (never their value), and — unless `--offline` — calls `GET /version` on every instance that has
 * a token to prove the URL and token work and to compare the live Coolify version with the range
 * this release is tested against (a warning, not a failure).
 *
 * Exit code: a problem with the target/instance you NAMED (`--app` / `--instance`) fails the
 * command (5 missing or rejected token, 1 unreachable). Without a name it reports every instance
 * and exits 0 as long as the config itself is valid, so a machine holding only one of several
 * tokens is not an error.
 */
export declare function configDoctor(args: ParsedArgs, deps?: DoctorDeps): Promise<number>;
