import { isTerminalDeploymentStatus } from './schemas.js';
import { CoolifyAuthError, CoolifyContractError, CoolifyNotFoundError, CoolifyWaitTimeoutError, } from '../errors/index.js';
function isFatal(err) {
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
export async function waitForDeployment(getDeployment, deploymentUuid, opts = {}) {
    const intervalMs = opts.intervalMs ?? 2000;
    const timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000;
    const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    const now = opts.now ?? (() => Date.now());
    const maxErrors = opts.maxConsecutiveErrors ?? 3;
    const start = now();
    let lastStatus;
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
        }
        catch (err) {
            consecutiveErrors += 1;
            if (isFatal(err) || consecutiveErrors > maxErrors)
                throw err;
        }
        if (now() - start > timeoutMs) {
            throw new CoolifyWaitTimeoutError(deploymentUuid, timeoutMs, lastStatus);
        }
        await sleep(intervalMs);
    }
}
