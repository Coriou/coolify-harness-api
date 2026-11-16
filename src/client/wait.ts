import { isTerminalDeploymentStatus, type Deployment } from './schemas.js';
import {
  CoolifyAuthError, CoolifyAuthScopeError, CoolifyContractError, CoolifyNotFoundError, CoolifyRequestError,
  CoolifyWaitTimeoutError,
} from '../errors/index.js';

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
   * queue worker restarts or Coolify itself upgrades). Auth, not-found, contract and 4xx request
   * errors are never retried. Default: 5.
   */
  maxConsecutiveErrors?: number;
  /** Abort the wait (e.g. on SIGINT). The deployment itself keeps running in Coolify. */
  signal?: AbortSignal;
}

const DEFAULT_INTERVAL_MS = 2000;
const DEFAULT_MAX_INTERVAL_MS = 5000;
const INTERVAL_GROWTH = 1.25;

function isFatal(err: unknown): boolean {
  if (err instanceof CoolifyAuthError || err instanceof CoolifyAuthScopeError) return true;
  if (err instanceof CoolifyNotFoundError || err instanceof CoolifyContractError) return true;
  // A 4xx answer will not fix itself; a 5xx or 429 may.
  return err instanceof CoolifyRequestError && err.status < 500 && err.status !== 429;
}

function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error ? reason : new Error('waitForDeployment aborted');
}

/** Sleep that ends early (rejecting) when the signal aborts. */
function sleepOrAbort(sleep: (ms: number) => Promise<void>, ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (!signal) return sleep(ms);
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => { reject(abortError(signal)); };
    signal.addEventListener('abort', onAbort, { once: true });
    sleep(ms).then(
      () => { signal.removeEventListener('abort', onAbort); resolve(); },
      (err: unknown) => { signal.removeEventListener('abort', onAbort); reject(err instanceof Error ? err : new Error(String(err))); },
    );
  });
}

/**
 * Pure-ish polling helper. Repeatedly calls getDeployment until a terminal status
 * (finished | failed | cancelled-by-user) or timeout.
 *
 * - Does not know about the client; you pass a getter (enables easy injection in tests).
 * - Sleep and clock are injectable.
 * - Resolves with the terminal deployment whatever its outcome; callers decide what `failed` means.
 * - Never sleeps past the deadline: the last poll happens at the timeout, not one interval later.
 */
export async function waitForDeployment(
  getDeployment: (deploymentUuid: string) => Promise<Deployment>,
  deploymentUuid: string,
  opts: WaitOptions = {},
): Promise<Deployment> {
  const fixed = opts.intervalMs !== undefined && opts.maxIntervalMs === undefined;
  const firstInterval = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const maxInterval = fixed ? firstInterval : Math.max(firstInterval, opts.maxIntervalMs ?? DEFAULT_MAX_INTERVAL_MS);
  const timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? ((): number => Date.now());
  const maxErrors = opts.maxConsecutiveErrors ?? 5;
  const signal = opts.signal;

  const start = now();
  let interval = firstInterval;
  let lastStatus: string | undefined;
  let consecutiveErrors = 0;
  while (true) {
    if (signal?.aborted) throw abortError(signal);
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
    const remaining = timeoutMs - (now() - start);
    if (remaining <= 0) {
      throw new CoolifyWaitTimeoutError(deploymentUuid, timeoutMs, lastStatus);
    }
    await sleepOrAbort(sleep, Math.min(interval, remaining), signal);
    interval = Math.min(maxInterval, Math.round(interval * INTERVAL_GROWTH));
  }
}
