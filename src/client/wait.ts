import { isTerminalDeploymentStatus } from './deployment-status.js';
import type { Deployment } from './schemas.js';
import {
  CoolifyAuthError, CoolifyAuthScopeError, CoolifyContractError, CoolifyNetworkError, CoolifyNotFoundError,
  CoolifyRequestError, CoolifyWaitTimeoutError,
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
  /**
   * Overall timeout in milliseconds. Default: 600000 (10 minutes — Docker builds are slow).
   * `Infinity` waits for ever. A poll in flight at the deadline may still answer (`pollGraceMs`),
   * so the wait can end that much later.
   */
  timeoutMs?: number;
  /**
   * The least time one poll gets to answer, deadline or not. The last sleep ends AT the deadline:
   * without it the final poll had no time at all, and a deployment that finished during that last
   * sleep was reported as timed out. Default: 10000.
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

const DEFAULT_INTERVAL_MS = 2000;
const DEFAULT_MAX_INTERVAL_MS = 5000;
const INTERVAL_GROWTH = 1.25;
const MAX_TIMER_MS = 2 ** 31 - 1;
const DEFAULT_POLL_GRACE_MS = 10_000;

function isFatal(err: unknown, seen: boolean): boolean {
  if (err instanceof CoolifyAuthError || err instanceof CoolifyAuthScopeError) return true;
  if (err instanceof CoolifyContractError) return true;
  // Unknown from the first poll: it was never queued. After it has been seen, a 404 is what a
  // reverse proxy answers while Coolify restarts.
  if (err instanceof CoolifyNotFoundError) return !seen;
  // A 4xx answer will not fix itself; a 5xx or 429 may.
  return err instanceof CoolifyRequestError && err.status < 500 && err.status !== 429;
}

/** Refused locally because the circuit breaker is open: no request was made. */
const isCircuitOpen = (err: unknown): boolean => err instanceof CoolifyNetworkError && err.reason === 'circuit-open';

function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error ? reason : new Error('waitForDeployment aborted');
}

/**
 * `promise`, or a rejection with `timeoutError()` once `ms` have passed, or with the abort reason
 * as soon as the signal aborts (a poll in flight must not hold Ctrl-C back). The abandoned promise
 * stays handled; the timer never holds the process.
 */
function withDeadline<T>(promise: Promise<T>, ms: number, timeoutError: () => Error, signal: AbortSignal | undefined): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    // setTimeout fires at once above 2^31-1 ms: a deadline that far away (or Infinity) needs no timer.
    const timer = ms <= MAX_TIMER_MS ? setTimeout(() => { done(); reject(timeoutError()); }, Math.max(0, ms)) : undefined;
    timer?.unref?.();
    const onAbort = (): void => { done(); reject(abortError(signal!)); }; // reason: only registered when signal is defined
    const done = (): void => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (v) => { done(); resolve(v); },
      (e: unknown) => { done(); reject(e instanceof Error ? e : new Error(String(e))); },
    );
  });
}

/** The default sleep: its timer is cleared on abort, so an interrupted wait does not keep the process alive. */
function timerSleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => { clearTimeout(timer); reject(abortError(signal!)); }; // reason: only registered when signal is defined
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, Math.min(ms, MAX_TIMER_MS));
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Sleep that ends early (rejecting) when the signal aborts. */
function sleepOrAbort(sleep: ((ms: number) => Promise<void>) | undefined, ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (!sleep) return timerSleep(ms, signal);
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
 *   A poll gets at least `pollGraceMs` (10 s) to answer, so the wait ends at most that long after
 *   the timeout.
 * - An abort ends the wait at once, also while a poll is in flight.
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
  const sleep = opts.sleep;
  const now = opts.now ?? ((): number => Date.now());
  const maxErrors = opts.maxConsecutiveErrors ?? 5;
  const signal = opts.signal;
  const pollGraceMs = Math.max(0, opts.pollGraceMs ?? DEFAULT_POLL_GRACE_MS) || 0;
  // NaN compares false with everything: the loop would never time out, or spin without sleeping.
  if (Number.isNaN(timeoutMs) || timeoutMs < 0) throw new RangeError('waitForDeployment: timeoutMs must be a number >= 0 (Infinity waits for ever)');
  if (!Number.isFinite(firstInterval) || firstInterval < 0 || !Number.isFinite(maxInterval)) {
    throw new RangeError('waitForDeployment: intervalMs and maxIntervalMs must be finite numbers >= 0');
  }

  const start = now();
  let interval = firstInterval;
  let lastStatus: string | undefined;
  let consecutiveErrors = 0;
  while (true) {
    if (signal?.aborted) throw abortError(signal);
    let seen: Deployment | undefined;
    try {
      const left = Math.max(pollGraceMs, timeoutMs - (now() - start));
      seen = await withDeadline(getDeployment(deploymentUuid), left, () => new CoolifyWaitTimeoutError(deploymentUuid, timeoutMs, lastStatus), signal);
      consecutiveErrors = 0;
    } catch (err) {
      if (err instanceof CoolifyWaitTimeoutError) throw err;
      if (signal?.aborted) throw abortError(signal);
      if (!isCircuitOpen(err)) consecutiveErrors += 1;
      if (isFatal(err, lastStatus !== undefined) || consecutiveErrors > maxErrors) throw err;
    }
    // Outside the try: an error thrown by the caller's onStatus is the caller's, not a failed poll.
    if (seen) {
      if (seen.status !== lastStatus) {
        lastStatus = seen.status;
        opts.onStatus?.(seen.status, seen);
      }
      if (isTerminalDeploymentStatus(seen.status)) return seen;
    }
    if (signal?.aborted) throw abortError(signal);
    const remaining = timeoutMs - (now() - start);
    if (remaining <= 0) {
      throw new CoolifyWaitTimeoutError(deploymentUuid, timeoutMs, lastStatus);
    }
    await sleepOrAbort(sleep, Math.min(interval, remaining), signal);
    interval = Math.min(maxInterval, Math.max(interval + 1, Math.round(interval * INTERVAL_GROWTH)));
  }
}
