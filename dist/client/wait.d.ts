import type { Deployment } from './schemas.js';
export interface WaitOptions {
    /**
     * Polling interval in milliseconds. When set, the interval is fixed (unless `maxIntervalMs` is
     * also given). Default: starts at 2000 and grows ×1.25 per poll up to `maxIntervalMs` — every
     * poll downloads the whole build log so far, and nobody needs 2 s precision on a 5-minute build.
     */
    intervalMs?: number;
    /** Upper bound of the growing interval. Default: 5000 (or `intervalMs` when only that is set). */
    maxIntervalMs?: number;
    /** Overall timeout in milliseconds. Default: 600000 (10 minutes — Docker builds are slow). */
    timeoutMs?: number;
    /** Injected sleep for test determinism. */
    sleep?: (ms: number) => Promise<void>;
    /** Injected clock for test determinism. Default: Date.now. */
    now?: () => number;
    /** Called on the first observation and every time the status changes. */
    onStatus?: (status: string, deployment: Deployment) => void;
    /**
     * Consecutive poll failures tolerated before giving up (network blips, a 5xx while Coolify's
     * queue worker restarts or Coolify itself upgrades). A poll refused locally by the open circuit
     * breaker is not a failure: the loop just waits for it to close. Auth, contract and 4xx request
     * errors are never retried; a 404 is fatal only before the deployment has been seen once.
     * Default: 5.
     */
    maxConsecutiveErrors?: number;
    /** Abort the wait (e.g. on SIGINT). The deployment itself keeps running in Coolify. */
    signal?: AbortSignal;
}
/**
 * Pure-ish polling helper. Repeatedly calls getDeployment until a terminal status
 * (finished | failed | cancelled-by-user) or timeout.
 *
 * - Does not know about the client; you pass a getter (enables easy injection in tests).
 * - Sleep and clock are injectable.
 * - Resolves with the terminal deployment whatever its outcome; callers decide what `failed` means.
 * - Never sleeps past the deadline: the last poll happens at the timeout, not one interval later,
 *   and a poll that is still in flight at the deadline is abandoned.
 */
export declare function waitForDeployment(getDeployment: (deploymentUuid: string) => Promise<Deployment>, deploymentUuid: string, opts?: WaitOptions): Promise<Deployment>;
