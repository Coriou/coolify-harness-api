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
    /**
     * Overall timeout in milliseconds. Default: 600000 (10 minutes — Docker builds are slow).
     * `Infinity` waits for ever. A poll in flight at the deadline may still answer (`pollGraceMs`),
     * so the wait can end that much later.
     */
    timeoutMs?: number;
    /**
     * The least time one poll gets to answer, deadline or not. The last sleep ends AT the deadline:
     * without it the final poll had no time at all, and a deployment that finished during that last
     * sleep was reported as timed out. Default: 10000, and never more than `timeoutMs`.
     */
    pollGraceMs?: number;
    /** Injected sleep for test determinism. */
    sleep?: (ms: number) => Promise<void>;
    /** Injected clock for test determinism. Default: Date.now. */
    now?: () => number;
    /** Called on the first observation and every time the status changes. What it throws ends the wait. */
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
 * - Does not know about the client; you pass a getter (enables easy injection in tests). It is
 *   handed an AbortSignal that fires when the poll is given up on (deadline, abort): pass it to
 *   the request so nothing is left running behind the wait.
 * - Sleep and clock are injectable.
 * - Resolves with the terminal deployment whatever its outcome; callers decide what `failed` means.
 * - Never sleeps past the deadline: the last poll happens at the timeout, not one interval later.
 *   A poll gets at least `pollGraceMs` (10 s) to answer, so the wait ends at most that long after
 *   the timeout.
 * - An abort ends the wait at once, also while a poll is in flight.
 */
export declare function waitForDeployment(getDeployment: (deploymentUuid: string, poll: {
    signal: AbortSignal;
}) => Promise<Deployment>, deploymentUuid: string, opts?: WaitOptions): Promise<Deployment>;
