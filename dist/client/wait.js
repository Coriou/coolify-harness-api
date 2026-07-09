import { CoolifyWaitTimeoutError } from '../errors/index.js';
/**
 * Pure-ish polling helper. Repeatedly calls getDeployment until a terminal status
 * (finished | failed | cancelled-by-user) or timeout.
 *
 * - Does not know about the client; you pass a getter (enables easy injection in tests).
 * - Sleep is injectable.
 */
export async function waitForDeployment(getDeployment, deploymentUuid, opts = {}) {
    const intervalMs = opts.intervalMs ?? 2000;
    const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
    const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    const start = Date.now();
    while (true) {
        const d = await getDeployment(deploymentUuid);
        const status = d.status;
        if (status === 'finished' || status === 'failed' || status === 'cancelled-by-user') {
            return d;
        }
        if (Date.now() - start > timeoutMs) {
            throw new CoolifyWaitTimeoutError(deploymentUuid, timeoutMs, status);
        }
        await sleep(intervalMs);
    }
}
