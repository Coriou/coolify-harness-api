import { isTerminalDeploymentStatus, type Deployment } from './schemas.js';
import {
  CoolifyAuthError, CoolifyContractError, CoolifyNotFoundError, CoolifyWaitTimeoutError,
} from '../errors/index.js';

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

function isFatal(err: unknown): boolean {
  return err instanceof CoolifyAuthError || err instanceof CoolifyNotFoundError || err instanceof CoolifyContractError;
}

/**
 * Pure-ish polling helper. Repeatedly calls getDeployment until a terminal status
 * (finished | failed | cancelled-by-user) or timeout.
 *
 * - Does not know about the client; you pass a getter (enables easy injection in tests).
 * - Sleep and clock are injectable.
 * - Resolves with the terminal deployment whatever its outcome; callers decide what `failed` means.
 */
export async function waitForDeployment(
  getDeployment: (deploymentUuid: string) => Promise<Deployment>,
  deploymentUuid: string,
  opts: WaitOptions = {},
): Promise<Deployment> {
  const intervalMs = opts.intervalMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = opts.now ?? ((): number => Date.now());
  const maxErrors = opts.maxConsecutiveErrors ?? 3;

  const start = now();
  let lastStatus: string | undefined;
  let consecutiveErrors = 0;
  while (true) {
    try {
      const d = await getDeployment(deploymentUuid);
      consecutiveErrors = 0;
      if (d.status !== lastStatus) {
        lastStatus = d.status;
        opts.onStatus?.(d.status, d);
      }
      if (isTerminalDeploymentStatus(d.status)) {
        return d;
      }
    } catch (err) {
      consecutiveErrors += 1;
      if (isFatal(err) || consecutiveErrors > maxErrors) throw err;
    }
    if (now() - start > timeoutMs) {
      throw new CoolifyWaitTimeoutError(deploymentUuid, timeoutMs, lastStatus);
    }
    await sleep(intervalMs);
  }
}
