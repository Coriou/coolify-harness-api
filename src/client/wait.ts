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
export async function waitForDeployment(
  getDeployment: (deploymentUuid: string) => Promise<Deployment>,
  deploymentUuid: string,
  opts: WaitOptions = {},
): Promise<Deployment> {
  const intervalMs = opts.intervalMs ?? 2000;
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  const start = Date.now();
  while (true) {
    const d = await getDeployment(deploymentUuid);
    const status = d.status;
    if (status === 'finished' || status === 'failed' || status === 'cancelled-by-user') {
      return d;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `waitForDeployment(${deploymentUuid}) timed out after ${timeoutMs}ms; last status was ${status}`,
      );
    }
    await sleep(intervalMs);
  }
}
