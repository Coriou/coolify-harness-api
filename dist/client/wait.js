import { isTerminalDeploymentStatus } from './deployment-status.js';
import { CoolifyAuthError, CoolifyAuthScopeError, CoolifyContractError, CoolifyNotFoundError, CoolifyRequestError, CoolifyWaitTimeoutError, } from '../errors/index.js';
const DEFAULT_INTERVAL_MS = 2000;
const DEFAULT_MAX_INTERVAL_MS = 5000;
const INTERVAL_GROWTH = 1.25;
function isFatal(err) {
    if (err instanceof CoolifyAuthError || err instanceof CoolifyAuthScopeError)
        return true;
    if (err instanceof CoolifyNotFoundError || err instanceof CoolifyContractError)
        return true;
    // A 4xx answer will not fix itself; a 5xx or 429 may.
    return err instanceof CoolifyRequestError && err.status < 500 && err.status !== 429;
}
function abortError(signal) {
    const reason = signal.reason;
    return reason instanceof Error ? reason : new Error('waitForDeployment aborted');
}
/** Sleep that ends early (rejecting) when the signal aborts. */
function sleepOrAbort(sleep, ms, signal) {
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
 * - Does not know about the client; you pass a getter (enables easy injection in tests).
 * - Sleep and clock are injectable.
 * - Resolves with the terminal deployment whatever its outcome; callers decide what `failed` means.
 * - Never sleeps past the deadline: the last poll happens at the timeout, not one interval later.
 */
export async function waitForDeployment(getDeployment, deploymentUuid, opts = {}) {
    const fixed = opts.intervalMs !== undefined && opts.maxIntervalMs === undefined;
    const firstInterval = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
    const maxInterval = fixed ? firstInterval : Math.max(firstInterval, opts.maxIntervalMs ?? DEFAULT_MAX_INTERVAL_MS);
    const timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000;
    const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    const now = opts.now ?? (() => Date.now());
    const maxErrors = opts.maxConsecutiveErrors ?? 5;
    const signal = opts.signal;
    const start = now();
    let interval = firstInterval;
    let lastStatus;
    let consecutiveErrors = 0;
    while (true) {
        if (signal?.aborted)
            throw abortError(signal);
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
        }
        catch (err) {
            consecutiveErrors += 1;
            if (isFatal(err) || consecutiveErrors > maxErrors)
                throw err;
        }
        const remaining = timeoutMs - (now() - start);
        if (remaining <= 0) {
            throw new CoolifyWaitTimeoutError(deploymentUuid, timeoutMs, lastStatus);
        }
        await sleepOrAbort(sleep, Math.min(interval, remaining), signal);
        interval = Math.min(maxInterval, Math.round(interval * INTERVAL_GROWTH));
    }
}
