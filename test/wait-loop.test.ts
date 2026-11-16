import { describe, it, expect, vi } from 'vitest';
import { waitForDeployment } from '../src/client/wait.js';
import type { Deployment } from '../src/client/schemas.js';
import {
  CoolifyAuthScopeError, CoolifyNetworkError, CoolifyRequestError, CoolifyWaitTimeoutError,
} from '../src/errors/index.js';

const dep = (status: string): Deployment => ({ deployment_uuid: 'd1', status });

/** A clock that only moves when the loop sleeps. */
function fakeTime() {
  let t = 0;
  const sleeps: number[] = [];
  return { now: () => t, sleep: vi.fn(async (ms: number) => { sleeps.push(ms); t += ms; }), sleeps };
}

describe('waitForDeployment: pacing', () => {
  it('starts at 2 s and backs off to 5 s by default', async () => {
    const time = fakeTime();
    let polls = 0;
    await waitForDeployment(async () => { polls += 1; return dep(polls > 8 ? 'finished' : 'in_progress'); }, 'd1', time);
    expect(time.sleeps).toEqual([2000, 2500, 3125, 3906, 4883, 5000, 5000, 5000]);
  });

  it('keeps a fixed interval when the caller sets intervalMs (0.4 behaviour)', async () => {
    const time = fakeTime();
    let polls = 0;
    await waitForDeployment(async () => { polls += 1; return dep(polls > 3 ? 'finished' : 'queued'); }, 'd1', { ...time, intervalMs: 700 });
    expect(time.sleeps).toEqual([700, 700, 700]);
  });

  it('never sleeps past the deadline, polls once more at it, then times out with the last status', async () => {
    const time = fakeTime();
    const get = vi.fn(async () => dep('in_progress'));
    const err = await waitForDeployment(get, 'd1', { ...time, intervalMs: 4000, timeoutMs: 10_000 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CoolifyWaitTimeoutError);
    expect((err as CoolifyWaitTimeoutError).lastStatus).toBe('in_progress');
    expect(time.sleeps).toEqual([4000, 4000, 2000]);
    expect(get).toHaveBeenCalledTimes(4);
    expect(time.now()).toBe(10_000);
  });
});

describe('waitForDeployment: failures', () => {
  it('rides out a Coolify restart (5 failed polls) and still returns the result', async () => {
    const time = fakeTime();
    const get = vi.fn<() => Promise<Deployment>>();
    for (let i = 0; i < 5; i += 1) get.mockRejectedValueOnce(new CoolifyNetworkError('down', { reason: 'ECONNREFUSED' }));
    get.mockResolvedValue(dep('finished'));
    await expect(waitForDeployment(get, 'd1', time)).resolves.toMatchObject({ status: 'finished' });
  });

  it('gives up after more consecutive failures than allowed', async () => {
    const time = fakeTime();
    const get = vi.fn(async (): Promise<Deployment> => { throw new CoolifyRequestError('bad gateway', { status: 502 }); });
    await expect(waitForDeployment(get, 'd1', { ...time, maxConsecutiveErrors: 2 })).rejects.toBeInstanceOf(CoolifyRequestError);
    expect(get).toHaveBeenCalledTimes(3);
  });

  it('stops at once on an answer that will not fix itself (4xx, missing scope)', async () => {
    for (const fatal of [new CoolifyRequestError('bad request', { status: 400 }), new CoolifyAuthScopeError('no', { requiredScope: 'read' })]) {
      const get = vi.fn(async (): Promise<Deployment> => { throw fatal; });
      await expect(waitForDeployment(get, 'd1', fakeTime())).rejects.toBe(fatal);
      expect(get).toHaveBeenCalledTimes(1);
    }
  });

  it('keeps polling through a 429', async () => {
    const get = vi.fn<() => Promise<Deployment>>().mockRejectedValueOnce(new CoolifyRequestError('slow down', { status: 429 })).mockResolvedValue(dep('finished'));
    await expect(waitForDeployment(get, 'd1', fakeTime())).resolves.toMatchObject({ status: 'finished' });
  });
});

describe('waitForDeployment: cancellation', () => {
  it('an aborted signal stops the wait immediately, during a sleep', async () => {
    const abort = new AbortController();
    const get = vi.fn(async () => dep('in_progress'));
    const never = (): Promise<void> => new Promise(() => {});
    const p = waitForDeployment(get, 'd1', { sleep: never, signal: abort.signal });
    await new Promise((r) => setTimeout(r, 5));
    abort.abort(new Error('interrupted'));
    await expect(p).rejects.toThrow('interrupted');
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('does not poll at all when already aborted', async () => {
    const abort = new AbortController();
    abort.abort();
    const get = vi.fn(async () => dep('finished'));
    await expect(waitForDeployment(get, 'd1', { signal: abort.signal })).rejects.toThrow(/aborted/);
    expect(get).not.toHaveBeenCalled();
  });

  it('reports each status change once', async () => {
    const seen: string[] = [];
    const statuses = ['queued', 'queued', 'in_progress', 'in_progress', 'finished'];
    let i = 0;
    await waitForDeployment(async () => dep(statuses[i++]!), 'd1', { ...fakeTime(), onStatus: (s) => seen.push(s) });
    expect(seen).toEqual(['queued', 'in_progress', 'finished']);
  });
});
