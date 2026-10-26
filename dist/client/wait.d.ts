import { type Deployment } from './schemas.js';
export interface WaitOptions {
    /** Polling interval in milliseconds. Default: 2000. */
    intervalMs?: number;
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
     * queue worker restarts). Auth, not-found and contract errors are never retried. Default: 3.
     */
    maxConsecutiveErrors?: number;
}
/**
 * Pure-ish polling helper. Repeatedly calls getDeployment until a terminal status
 * (finished | failed | cancelled-by-user) or timeout.
 *
 * - Does not know about the client; you pass a getter (enables easy injection in tests).
 * - Sleep and clock are injectable.
 * - Resolves with the terminal deployment whatever its outcome; callers decide what `failed` means.
 */
export declare function waitForDeployment(getDeployment: (deploymentUuid: string) => Promise<Deployment>, deploymentUuid: string, opts?: WaitOptions): Promise<Deployment>;
