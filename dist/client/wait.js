import { isTerminalDeploymentStatus } from './deployment-status.js';
import { CoolifyAuthError, CoolifyAuthScopeError, CoolifyContractError, CoolifyNetworkError, CoolifyNotFoundError, CoolifyRequestError, CoolifyWaitTimeoutError, } from '../errors/index.js';
const DEFAULT_INTERVAL_MS = 2000;
const DEFAULT_MAX_INTERVAL_MS = 5000;
const INTERVAL_GROWTH = 1.25;
const MAX_TIMER_MS = 2 ** 31 - 1;
const DEFAULT_POLL_GRACE_MS = 10_000;
function isFatal(err, seen) {
    if (err instanceof CoolifyAuthError || err instanceof CoolifyAuthScopeError)
        return true;
    if (err instanceof CoolifyContractError)
        return true;
    // Unknown from the first poll: it was never queued. After it has been seen, a 404 is what a
    // reverse proxy answers while Coolify restarts.
    if (err instanceof CoolifyNotFoundError)
        return !seen;
    // A 4xx answer will not fix itself; a 5xx or 429 may.
    return err instanceof CoolifyRequestError && err.status < 500 && err.status !== 429;
}
/** Refused locally because the circuit breaker is open: no request was made. */
const isCircuitOpen = (err) => err instanceof CoolifyNetworkError && err.reason === 'circuit-open';
function abortError(signal) {
    const reason = signal.reason;
    return reason instanceof Error ? reason : new Error('waitForDeployment aborted');
}
/**
 * `promise`, or a rejection with `timeoutError()` once `ms` have passed, or with the abort reason
 * as soon as the signal aborts (a poll in flight must not hold Ctrl-C back). The abandoned promise
 * stays handled; the timer never holds the process.
 */
function withDeadline(promise, ms, timeoutError, signal) {
    return new Promise((resolve, reject) => {
        // setTimeout fires at once above 2^31-1 ms: a deadline that far away (or Infinity) needs no timer.
        const timer = ms <= MAX_TIMER_MS ? setTimeout(() => { done(); reject(timeoutError()); }, Math.max(0, ms)) : undefined;
        timer?.unref?.();
        const onAbort = () => { done(); reject(abortError(signal)); }; // reason: only registered when signal is defined
        const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); };
        if (signal?.aborted)
            onAbort();
        else
            signal?.addEventListener('abort', onAbort, { once: true });
        promise.then((v) => { done(); resolve(v); }, (e) => { done(); reject(e instanceof Error ? e : new Error(String(e))); });
    });
}
/** The default sleep: its timer is cleared on abort, so an interrupted wait does not keep the process alive. */
function timerSleep(ms, signal) {
    return new Promise((resolve, reject) => {
        const onAbort = () => { clearTimeout(timer); reject(abortError(signal)); }; // reason: only registered when signal is defined
        const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, Math.min(ms, MAX_TIMER_MS));
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}
/** Sleep that ends early (rejecting) when the signal aborts. */
function sleepOrAbort(sleep, ms, signal) {
    if (!sleep)
        return timerSleep(ms, signal);
    if (!signal)
        return sleep(ms);
    return new Promise((resolve, reject) => {
        const onAbort = () => { reject(abortError(signal)); };
        signal.addEventListener('abort', onAbort, { once: true });
        sleep(ms).then(() => { signal.removeEventListener('abort', onAbort); resolve(); }, (err) => { signal.removeEventListener('abort', onAbort); reject(err instanceof Error ? err : new Error(String(err))); });
    });
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
export async function waitForDeployment(getDeployment, deploymentUuid, opts = {}) {
    const fixed = opts.intervalMs !== undefined && opts.maxIntervalMs === undefined;
    const firstInterval = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
    const maxInterval = fixed ? firstInterval : Math.max(firstInterval, opts.maxIntervalMs ?? DEFAULT_MAX_INTERVAL_MS);
    const timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000;
    const sleep = opts.sleep;
    const now = opts.now ?? (() => Date.now());
    const maxErrors = opts.maxConsecutiveErrors ?? 5;
    const signal = opts.signal;
    // NaN compares false with everything: the loop would never time out, or spin without sleeping.
    if (Number.isNaN(timeoutMs) || timeoutMs < 0)
        throw new RangeError('waitForDeployment: timeoutMs must be a number >= 0 (Infinity waits for ever)');
    for (const [name, value] of [['pollGraceMs', opts.pollGraceMs], ['maxConsecutiveErrors', opts.maxConsecutiveErrors]]) {
        if (value !== undefined && !(value >= 0))
            throw new RangeError(`waitForDeployment: ${name} must be a number >= 0`);
    }
    // A short wait must not be stretched by a long grace: `--timeout 2` ends within a few seconds.
    const pollGraceMs = opts.pollGraceMs ?? Math.min(DEFAULT_POLL_GRACE_MS, timeoutMs);
    if (!Number.isFinite(firstInterval) || firstInterval < 0 || !Number.isFinite(maxInterval)) {
        throw new RangeError('waitForDeployment: intervalMs and maxIntervalMs must be finite numbers >= 0');
    }
    const start = now();
    let interval = firstInterval;
    let lastStatus;
    let consecutiveErrors = 0;
    while (true) {
        if (signal?.aborted)
            throw abortError(signal);
        let seen;
        const poll = new AbortController();
        try {
            const left = Math.max(pollGraceMs, timeoutMs - (now() - start));
            seen = await withDeadline(getDeployment(deploymentUuid, { signal: poll.signal }), left, () => new CoolifyWaitTimeoutError(deploymentUuid, timeoutMs, lastStatus), signal);
            consecutiveErrors = 0;
        }
        catch (err) {
            // Given up on (deadline, abort) or failed: either way nothing must keep running behind us.
            poll.abort();
            if (err instanceof CoolifyWaitTimeoutError)
                throw err;
            if (signal?.aborted)
                throw abortError(signal);
            if (!isCircuitOpen(err))
                consecutiveErrors += 1;
            if (isFatal(err, lastStatus !== undefined) || consecutiveErrors > maxErrors)
                throw err;
        }
        // Outside the try: an error thrown by the caller's onStatus is the caller's, not a failed poll.
        if (seen) {
            if (seen.status !== lastStatus) {
                lastStatus = seen.status;
                opts.onStatus?.(seen.status, seen);
            }
            if (isTerminalDeploymentStatus(seen.status))
                return seen;
        }
        if (signal?.aborted)
            throw abortError(signal);
        const remaining = timeoutMs - (now() - start);
        if (remaining <= 0) {
            throw new CoolifyWaitTimeoutError(deploymentUuid, timeoutMs, lastStatus);
        }
        await sleepOrAbort(sleep, Math.min(interval, remaining), signal);
        interval = Math.min(maxInterval, Math.max(interval + 1, Math.round(interval * INTERVAL_GROWTH)));
    }
}
