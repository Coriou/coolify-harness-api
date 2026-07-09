import type { Deployment } from './schemas.js';
export interface WaitOptions {
    /** Polling interval in milliseconds. Default: 2000. */
    intervalMs?: number;
    /** Overall timeout in milliseconds. Default: 300000 (5 minutes). */
    timeoutMs?: number;
    /** Injected sleep for test determinism. */
    sleep?: (ms: number) => Promise<void>;
}
/**
 * Pure-ish polling helper. Repeatedly calls getDeployment until a terminal status
 * (finished | failed | cancelled-by-user) or timeout.
 *
 * - Does not know about the client; you pass a getter (enables easy injection in tests).
 * - Sleep is injectable.
 */
export declare function waitForDeployment(getDeployment: (deploymentUuid: string) => Promise<Deployment>, deploymentUuid: string, opts?: WaitOptions): Promise<Deployment>;
