import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { channel } from 'node:diagnostics_channel';
import { parseArgs } from '../src/cli/args.js';
import { deployCmd } from '../src/cli/commands/deploy.js';
import { composeSet } from '../src/cli/commands/compose.js';
import { statusCmd } from '../src/cli/commands/status.js';
import { CoolifyClient } from '../src/client/coolify.js';
import { CoolifyInstanceClient } from '../src/client/instance.js';
import { CircuitBreaker, httpRequest } from '../src/client/http.js';
import { planEnvWrite } from '../src/client/safe-write.js';
import { waitForDeployment } from '../src/client/wait.js';
import { loadSchemas, preloadSchemasOnceRequestIsSent } from '../src/client/lazy-schemas.js';
import { noopLogger } from '../src/logging/index.js';
import type { Deployment, EnvVar } from '../src/client/schemas.js';
import {
  CoolifyAuthError, CoolifyBulkUnmarshalError, CoolifyContractError, CoolifyDeployNotQueuedError, CoolifyNetworkError,
  CoolifyNotFoundError, CoolifyRequestError, InvalidInputError,
} from '../src/errors/index.js';
import type { CmdDeps } from '../src/cli/deps.js';
import type { AuditRecord } from '../src/client/safe-write.js';
import type { ResolvedTarget } from '../src/config/schema.js';

let out: string[];
let err: string[];
const realOut = process.stdout.write.bind(process.stdout);
const realErr = process.stderr.write.bind(process.stderr);
beforeEach(() => {
  out = []; err = [];
  process.stdout.write = ((c: string | Uint8Array) => { out.push(String(c)); return true; }) as typeof process.stdout.write;
  process.stderr.write = ((c: string | Uint8Array) => { err.push(String(c)); return true; }) as typeof process.stderr.write;
});
afterEach(() => { process.stdout.write = realOut; process.stderr.write = realErr; });
const stdout = (): string => out.join('');
const stderr = (): string => err.join('');
const oneJson = (): Record<string, unknown> => JSON.parse(stdout()) as Record<string, unknown>;

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const html = (): Response => new Response('<!doctype html><title>Sign in</title>', { status: 200, headers: { 'content-type': 'text/html' } });
const appTarget: ResolvedTarget = { instanceUrl: 'https://c.example', kind: 'application', uuid: 'app-1', token: 't' };
const svcTarget: ResolvedTarget = { ...appTarget, kind: 'service', uuid: 'svc-1' };
const clientDeps = (fetchImpl: unknown, maxRetries = 0) => ({ fetchImpl: fetchImpl as never, logger: noopLogger(), maxRetries, sleep: async () => {} });
const httpOpts = (fetchImpl: unknown, maxRetries = 3) => ({
  fetchImpl: fetchImpl as never, logger: noopLogger(), maxRetries, sleep: async () => {},
  breaker: new CircuitBreaker({ failureThreshold: 50, resetTimeoutMs: 1000 }),
});
const row = (key: string, value: string, over: Partial<EnvVar> = {}): EnvVar => ({
  uuid: `env-${key}`, key, value, value_hidden: false, value_null: false, is_preview: false,
  is_build_time: true, is_literal: false, is_multiline: false, is_shown_once: false, ...over,
});
const dep = (status: string, uuid: string, over: Partial<Deployment> = {}): Deployment => ({ deployment_uuid: uuid, status, ...over });

function cmdDeps(client: Record<string, unknown>, target: ResolvedTarget = appTarget): { deps: CmdDeps; audits: AuditRecord[] } {
  const audits: AuditRecord[] = [];
  return {
    audits,
    deps: {
      resolveTargetFor: () => target,
      clientFactory: () => client as unknown as ReturnType<CmdDeps['clientFactory']>,
      actor: 'test',
      auditSink: vi.fn(async (r: AuditRecord) => { audits.push(r); }),
      now: () => new Date('2026-11-16T00:00:00Z'),
    },
  };
}

describe('deploy: "queued" is checked, because Coolify says it even when its queue is full', () => {
  // ApplicationsController::action_deploy only tests for 'skipped': a 'queue_full' result is
  // answered 200 "Deployment request queued." with a uuid that was never created.
  it('a uuid Coolify does not know is NOT a queued deployment: typed error, audit failure', async () => {
    const client = {
      deploy: vi.fn(async () => ({ message: 'Deployment request queued.', deploymentUuid: 'never-created' })),
      getDeployment: vi.fn(async () => { throw new CoolifyNotFoundError('Coolify resource not found (404)'); }),
    };
    const { deps, audits } = cmdDeps(client);
    const e = await deployCmd(parseArgs(['deploy', '--app', 'web', '--json']), deps).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(CoolifyDeployNotQueuedError);
    expect((e as CoolifyDeployNotQueuedError).code).toBe('DEPLOY_NOT_QUEUED');
    expect((e as Error).message).toMatch(/created no deployment never-created.*queue is full.*Nothing was queued/);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: 'deploy', outcome: 'failure' });
    expect(stdout()).toBe(''); // no document claims a deployment
  });

  it('a deployment Coolify does know is reported as before, with one audit record', async () => {
    const client = {
      deploy: vi.fn(async () => ({ message: 'Deployment request queued.', deploymentUuid: 'dep-1' })),
      getDeployment: vi.fn(async () => dep('queued', 'dep-1')),
    };
    const { deps, audits } = cmdDeps(client);
    expect(await deployCmd(parseArgs(['deploy', '--app', 'web', '--json']), deps)).toBe(0);
    expect(oneJson()).toEqual({ action: 'deploy', message: 'Deployment request queued.', deploymentUuid: 'dep-1' });
    expect(client.getDeployment).toHaveBeenCalledWith('dep-1');
    expect(audits.map((a) => a.outcome)).toEqual(['success']);
  });

  it('a check that cannot be made (a deploy-only token, a network blip) leaves the acknowledgement standing', async () => {
    for (const failure of [new CoolifyAuthError('Coolify auth failed (403)', { status: 403 }), new CoolifyNetworkError('Cannot reach Coolify', { reason: 'ECONNRESET' })]) {
      out = [];
      const client = {
        restart: vi.fn(async () => ({ message: 'Restart request queued.', deploymentUuid: 'dep-2' })),
        getDeployment: vi.fn(async () => { throw failure; }),
      };
      const { deps, audits } = cmdDeps(client);
      expect(await deployCmd(parseArgs(['deploy', '--app', 'web', '--restart', '--json']), deps)).toBe(0);
      expect(oneJson()).toMatchObject({ action: 'restart', deploymentUuid: 'dep-2' });
      expect(audits.map((a) => a.outcome)).toEqual(['success']);
    }
  });

  it('a service has no deployment record: nothing is checked', async () => {
    const client = { deploy: vi.fn(async () => ({ message: 'Service starting request queued.' })), getDeployment: vi.fn() };
    expect(await deployCmd(parseArgs(['deploy', '--app', 'svc', '--json']), cmdDeps(client, svcTarget).deps)).toBe(0);
    expect(client.getDeployment).not.toHaveBeenCalled();
  });
});

describe('deploy --wait after a skipped request: which deployment is "the one already queued"', () => {
  const skipped = { message: 'Deployment already queued for this commit.' };

  it('several are queued or building: the one for the commit a plain deploy asks for, not simply the newest', async () => {
    const client = {
      deploy: vi.fn(async () => skipped),
      // newest first: a webhook push of another commit, then the HEAD deployment that made Coolify skip
      listDeployments: vi.fn(async () => [dep('queued', 'dep-webhook', { commit: 'abc123' }), dep('in_progress', 'dep-head', { commit: 'HEAD' })]),
      get: vi.fn(async () => ({ uuid: 'app-1', git_commit_sha: 'HEAD' })),
      waitForDeployment: vi.fn(async (uuid: string) => dep('finished', uuid)),
    };
    expect(await deployCmd(parseArgs(['deploy', '--app', 'web', '--wait', '--json']), cmdDeps(client).deps)).toBe(0);
    expect(client.waitForDeployment).toHaveBeenCalledWith('dep-head', expect.anything());
    expect(oneJson()).toMatchObject({ deploymentUuid: 'dep-head', followedExisting: true, finalStatus: 'finished' });
  });

  it('an application pinned to a commit: the deployment of THAT commit', async () => {
    const client = {
      deploy: vi.fn(async () => skipped),
      listDeployments: vi.fn(async () => [dep('queued', 'dep-other', { commit: 'HEAD' }), dep('in_progress', 'dep-pinned', { commit: 'f00dfeed' })]),
      get: vi.fn(async () => ({ uuid: 'app-1', git_commit_sha: 'f00dfeed' })),
      waitForDeployment: vi.fn(async (uuid: string) => dep('finished', uuid)),
    };
    await deployCmd(parseArgs(['deploy', '--app', 'web', '--wait', '--json']), cmdDeps(client).deps);
    expect(client.waitForDeployment).toHaveBeenCalledWith('dep-pinned', expect.anything());
  });

  it('a single running production deployment needs no second look (no application read)', async () => {
    const client = {
      deploy: vi.fn(async () => skipped),
      listDeployments: vi.fn(async () => [dep('in_progress', 'dep-only')]),
      get: vi.fn(),
      waitForDeployment: vi.fn(async (uuid: string) => dep('finished', uuid)),
    };
    await deployCmd(parseArgs(['deploy', '--app', 'web', '--wait', '--json']), cmdDeps(client).deps);
    expect(client.get).not.toHaveBeenCalled();
    expect(client.listDeployments).toHaveBeenCalledTimes(1);
  });

  it('a burst of preview builds fills the first page: the next page is read before giving up', async () => {
    const previews = Array.from({ length: 10 }, (_, i) => dep('finished', `dep-pr-${i}`, { pull_request_id: 7 }));
    const client = {
      deploy: vi.fn(async () => skipped),
      listDeployments: vi.fn(async (page: { skip: number; take: number }) => (page.skip === 0 ? previews : [dep('in_progress', 'dep-prod')])),
      waitForDeployment: vi.fn(async (uuid: string) => dep('finished', uuid)),
    };
    expect(await deployCmd(parseArgs(['deploy', '--app', 'web', '--wait', '--json']), cmdDeps(client).deps)).toBe(0);
    expect(client.listDeployments.mock.calls.map((c) => c[0])).toEqual([{ skip: 0, take: 10 }, { skip: 10, take: 20 }]);
    expect(client.waitForDeployment).toHaveBeenCalledWith('dep-prod', expect.anything());
  });

  it('no production deployment at all: an error that says so, with what was acknowledged (not exit 0)', async () => {
    const client = {
      deploy: vi.fn(async () => skipped),
      listDeployments: vi.fn(async () => [dep('in_progress', 'dep-pr-1', { pull_request_id: 3 })]),
      waitForDeployment: vi.fn(),
    };
    const e = await deployCmd(parseArgs(['deploy', '--app', 'web', '--wait', '--json']), cmdDeps(client).deps).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(CoolifyNotFoundError);
    expect((e as Error).message).toMatch(/queued nothing new.*nothing to follow/);
    expect(oneJson()).toMatchObject({ deploymentUuid: null, waitFailed: true });
    expect(client.waitForDeployment).not.toHaveBeenCalled();
  });
});

describe('an acknowledgement is JSON from Coolify, or it is not an acknowledgement', () => {
  it('database update and backup: an HTML 200 is an error, not "updated" / "queued"', async () => {
    const inst = new CoolifyInstanceClient({ instanceUrl: 'https://c.example', token: 't' }, clientDeps(vi.fn(async () => html())));
    await expect(inst.updateDatabase('db-1', { is_public: false })).rejects.toBeInstanceOf(CoolifyContractError);
    await expect(inst.runDatabaseBackup('db-1', 'bk-1')).rejects.toThrow(/not a JSON object.*check before retrying/);
  });

  it('database update and backup: the real acknowledgement, and one in another JSON shape, are both accepted', async () => {
    for (const body of [{ message: 'Database updated.' }, { ok: true }]) {
      const inst = new CoolifyInstanceClient({ instanceUrl: 'https://c.example', token: 't' }, clientDeps(vi.fn(async () => json(200, body))));
      await expect(inst.updateDatabase('db-1', { is_public: false })).resolves.toBeUndefined();
      await expect(inst.runDatabaseBackup('db-1', 'bk-1')).resolves.toBeUndefined();
    }
  });

  it('an EMPTY 200 to a deploy is not "accepted" (it used to become exit 0 under --wait)', async () => {
    const client = new CoolifyClient(appTarget, clientDeps(vi.fn(async () => new Response('', { status: 200 }))));
    await expect(client.deploy()).rejects.toThrow(/an empty answer/);
  });

  it('JSON scalars and null are not acknowledgements either', async () => {
    for (const body of [null, 'ok', true, 42]) {
      const client = new CoolifyClient(appTarget, clientDeps(vi.fn(async () => json(200, body))));
      await expect(client.deploy()).rejects.toBeInstanceOf(CoolifyContractError);
    }
  });
});

describe('transport', () => {
  const lostBody = (status: number): Response => ({
    status, headers: new Headers(), text: async () => { throw new TypeError('terminated'); },
  }) as unknown as Response;

  it('an idempotent write answered 2xx whose body is lost on EVERY attempt was carried out (it used to be a network failure)', async () => {
    const fetchImpl = vi.fn(async () => lostBody(201));
    const res = await httpRequest('https://c/x', { method: 'PATCH', token: 't', jsonBody: { data: [] }, idempotent: true }, httpOpts(fetchImpl, 2));
    expect(res).toEqual({ status: 201, body: undefined, bodyLost: true });
    expect(fetchImpl).toHaveBeenCalledTimes(3); // replayed first: it is safe to
  });

  it('a READ whose body is lost is still a network error: there is nothing to return', async () => {
    const fetchImpl = vi.fn(async () => lostBody(200));
    await expect(httpRequest('https://c/x', { method: 'GET', token: 't' }, httpOpts(fetchImpl, 1))).rejects.toBeInstanceOf(CoolifyNetworkError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('the unmarshal text on a READ is an ordinary answer: one request, the real status', async () => {
    const fetchImpl = vi.fn(async () => json(403, { message: 'json: cannot unmarshal array into Go value' }));
    const res = await httpRequest('https://c/x', { method: 'GET', token: 't' }, httpOpts(fetchImpl));
    expect(res.status).toBe(403);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const client = new CoolifyClient(appTarget, clientDeps(fetchImpl, 3));
    await expect(client.listEnvs()).rejects.toBeInstanceOf(CoolifyAuthError);
  });

  it('…and on the idempotent bulk write it is still the quirk', async () => {
    const fetchImpl = vi.fn(async () => json(500, { message: 'cannot unmarshal array' }));
    await expect(httpRequest('https://c/x', { method: 'PATCH', token: 't', jsonBody: { data: [] }, idempotent: true }, httpOpts(fetchImpl, 1)))
      .rejects.toBeInstanceOf(CoolifyBulkUnmarshalError);
  });

  it('a status below 200 (the 0 of an opaque answer from an injected fetch) is not a success', async () => {
    const opaque = { status: 0, headers: new Headers(), text: async () => '' } as unknown as Response;
    const client = new CoolifyClient(appTarget, clientDeps(vi.fn(async () => opaque)));
    await expect(client.deploy()).rejects.toThrow(/unusable answer \(status 0\)/);
  });

  it('the version is read as the text it is: 4.10 is not 4.1, 5.0 is a version', async () => {
    for (const [body, expected] of [['4.10', '4.10'], ['4.70\n', '4.70'], ['5.0', '5.0'], ['"4.7.5"', '4.7.5'], ['v4.7.5', 'v4.7.5']] as const) {
      const inst = new CoolifyInstanceClient({ instanceUrl: 'https://c.example', token: 't' }, clientDeps(vi.fn(async () => new Response(body, { status: 200 }))));
      await expect(inst.getVersion()).resolves.toBe(expected);
    }
    const page = new CoolifyInstanceClient({ instanceUrl: 'https://c.example', token: 't' }, clientDeps(vi.fn(async () => html())));
    await expect(page.getVersion()).rejects.toBeInstanceOf(CoolifyContractError);
  });
});

describe('env planning', () => {
  it('trimming is linear: a value with a long inner run of blanks does not hang the plan', () => {
    const value = `a${' '.repeat(400_000)}b`;
    const started = performance.now();
    const plan = planEnvWrite([row('K', value)], { values: { K: value, OTHER: ` ${value} ` } });
    expect(performance.now() - started).toBeLessThan(500);
    expect(plan.unchanged).toEqual(['K']);
    expect(plan.creates.map((c) => c.key)).toEqual(['OTHER']);
  });

  it('trims exactly what PHP trim() does, at both ends, and nothing inside', () => {
    const plan = planEnvWrite([row('A', 'x y'), row('B', 'x')], { values: { A: ' \t\n\r\0\x0Bx y\x0B\0\r\n\t ', B: ' x' } });
    expect(plan.unchanged).toEqual(['A']);
    expect(plan.updates.map((u) => u.key)).toEqual(['B']); // a no-break space is not trimmed by PHP
  });

  it('a flag the caller asks for and the row lacks is a change, even when the value is the same', () => {
    const current = [row('K', 'v'), row('L', 'v', { is_shown_once: true })];
    const plan = planEnvWrite(current, { values: { K: 'v', L: 'v' }, flags: { K: { is_shown_once: true }, L: { is_shown_once: true } } });
    expect(plan.updates).toEqual([{ key: 'K', value: 'v', is_shown_once: true }]);
    expect(plan.unchanged).toEqual(['L']);
    // Without flags, the same value stays unchanged (the 0.4 behaviour).
    expect(planEnvWrite(current, { values: { K: 'v' } }).unchanged).toEqual(['K']);
  });

  it('a key with edge whitespace is refused before anything is sent: Coolify stores it under another name', async () => {
    const fetchImpl = vi.fn(async () => json(201, []));
    const client = new CoolifyClient(appTarget, clientDeps(fetchImpl));
    await expect(client.upsertEnvs([{ key: ' K', value: 'x' }])).rejects.toBeInstanceOf(InvalidInputError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('waitForDeployment', () => {
  const d = (status: string): Deployment => ({ deployment_uuid: 'd1', status });

  it('an abort ends the wait while a poll is still in flight', async () => {
    const abort = new AbortController();
    const hang = vi.fn((): Promise<Deployment> => new Promise(() => {}));
    const started = Date.now();
    setTimeout(() => { abort.abort(new Error('interrupted')); }, 20);
    await expect(waitForDeployment(hang, 'd1', { signal: abort.signal })).rejects.toThrow('interrupted');
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('the poll issued at the deadline still gets to answer (a deployment that finished during the last sleep is not a timeout)', async () => {
    let clock = 0;
    let polls = 0;
    const get = vi.fn(async (): Promise<Deployment> => {
      polls += 1;
      if (polls === 1) return d('in_progress');
      await new Promise((r) => setTimeout(r, 30)); // a real request takes time, even at the deadline
      return d('finished');
    });
    const result = await waitForDeployment(get, 'd1', { timeoutMs: 400, intervalMs: 400, now: () => clock, sleep: async (ms) => { clock += ms; } });
    expect(result.status).toBe('finished');
    expect(clock).toBe(400);
  });

  it('…but a poll that hangs does not hold the wait past its grace', async () => {
    const hang = vi.fn((): Promise<Deployment> => new Promise(() => {}));
    const started = Date.now();
    await expect(waitForDeployment(hang, 'd1', { timeoutMs: 10, pollGraceMs: 50 })).rejects.toThrow(/timed out/);
    const took = Date.now() - started;
    expect(took).toBeGreaterThanOrEqual(45);
    expect(took).toBeLessThan(1500);
  });

  it('options that could never time out, or would spin, are refused', async () => {
    const get = vi.fn(async () => d('in_progress'));
    await expect(waitForDeployment(get, 'd1', { timeoutMs: Number.NaN })).rejects.toBeInstanceOf(RangeError);
    await expect(waitForDeployment(get, 'd1', { timeoutMs: -5 })).rejects.toBeInstanceOf(RangeError);
    await expect(waitForDeployment(get, 'd1', { intervalMs: Number.NaN })).rejects.toBeInstanceOf(RangeError);
    await expect(waitForDeployment(get, 'd1', { intervalMs: -1 })).rejects.toBeInstanceOf(RangeError);
    expect(get).not.toHaveBeenCalled();
  });

  it("what the caller's onStatus throws is the caller's error: not swallowed, not counted as a failed poll", async () => {
    const boom = new Error('onStatus failed');
    const get = vi.fn(async () => d('finished'));
    await expect(waitForDeployment(get, 'd1', { sleep: async () => {}, onStatus: () => { throw boom; } })).rejects.toBe(boom);
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe('the latest deployment of an application is a production one', () => {
  const list = (rows: Deployment[]) => vi.fn(async (url: string) => {
    const take = Number(new URL(url).searchParams.get('take') ?? 10);
    return json(200, rows.slice(0, take));
  });

  it('a preview build on top: one more request finds the newest production deployment', async () => {
    const fetchImpl = list([dep('failed', 'dep-pr', { pull_request_id: 42 }), dep('finished', 'dep-prod', { pull_request_id: 0 })]);
    const client = new CoolifyClient(appTarget, clientDeps(fetchImpl));
    expect((await client.getLatestDeployment())?.deployment_uuid).toBe('dep-prod');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('the usual case stays one request for one row', async () => {
    const fetchImpl = list([dep('finished', 'dep-prod'), dep('failed', 'dep-older')]);
    const client = new CoolifyClient(appTarget, clientDeps(fetchImpl));
    expect((await client.getLatestDeployment())?.deployment_uuid).toBe('dep-prod');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]![0])).toContain('take=1');
  });

  it('only preview builds exist: the newest one is returned, and `status` says what it is', async () => {
    const fetchImpl = list([dep('failed', 'dep-pr', { pull_request_id: 42 })]);
    const client = new CoolifyClient(appTarget, clientDeps(fetchImpl));
    const latest = await client.getLatestDeployment();
    expect(latest?.deployment_uuid).toBe('dep-pr');
    const fake = { get: vi.fn(async () => ({ uuid: 'app-1', name: 'web', status: 'running:healthy' })), getLatestDeployment: vi.fn(async () => latest) };
    expect(await statusCmd(parseArgs(['status', '--app', 'web']), cmdDeps(fake).deps)).toBe(0);
    expect(stdout()).toContain('dep-pr [failed] (preview of pull request #42; no production deployment found)');
  });
});

describe('a document write that fails without a definite "no" says what Coolify holds now', () => {
  const before = 'services:\n  app:\n    image: nginx:1\n';
  const after = 'services:\n  app:\n    image: nginx:2\n';
  const run = async (storedAfter: string | Error, failure: Error): Promise<{ error: Error & { stored?: string }; audits: AuditRecord[]; client: Record<string, ReturnType<typeof vi.fn>> }> => {
    const getService = vi.fn()
      .mockResolvedValueOnce({ uuid: 'svc-1', docker_compose_raw: before });
    if (storedAfter instanceof Error) getService.mockRejectedValueOnce(storedAfter);
    else getService.mockResolvedValueOnce({ uuid: 'svc-1', docker_compose_raw: storedAfter });
    const client = { getService, updateServiceCompose: vi.fn(async () => { throw failure; }) };
    const { deps, audits } = cmdDeps(client, svcTarget);
    const error = await composeSet(parseArgs(['compose', 'set', '--app', 'svc', '--image', 'app=nginx:2', '--apply', '--json']), deps).catch((x: unknown) => x);
    return { error: error as Error & { stored?: string }, audits, client };
  };
  const http500 = (): Error => new CoolifyRequestError('Coolify request PATCH … failed with status 500', { status: 500 });

  it('500 after Coolify saved (it saves before it re-parses): "stored: new", do not send it again', async () => {
    const { error, audits } = await run(after, http500());
    expect(error).toBeInstanceOf(CoolifyRequestError);
    expect(error.stored).toBe('new');
    expect(error.message).toMatch(/failed with status 500 — Coolify DID store the new document.*do not send it again.*compose get --app svc/);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: 'compose.update', outcome: 'failure' });
    expect(audits[0]!.error).toContain('DID store the new document');
  });

  it('500 with the old document still stored: "stored: old"', async () => {
    const { error } = await run(before, http500());
    expect(error.stored).toBe('old');
    expect(error.message).toContain('nothing was saved');
  });

  it('a lost connection, and a re-read that fails too: "stored: unknown"', async () => {
    const { error } = await run(new Error('still down'), new CoolifyNetworkError('Cannot reach Coolify', { reason: 'ECONNRESET' }));
    expect(error.stored).toBe('unknown');
    expect(error.message).toContain('could not be checked');
  });

  it('a 4xx is a refusal: nothing is re-read, the message is left alone', async () => {
    const { error, client } = await run(before, new CoolifyRequestError('Coolify request PATCH … failed with status 422', { status: 422 }));
    expect(error.stored).toBeUndefined();
    expect(error.message).toBe('Coolify request PATCH … failed with status 422');
    expect(client['getService']).toHaveBeenCalledTimes(1);
  });
});

describe('lazy validators', () => {
  it('the diagnostics-channel subscription does not outlive the first load (an injected fetch never fires it)', async () => {
    const sendHeaders = channel('undici:client:sendHeaders');
    const before = sendHeaders.hasSubscribers;
    preloadSchemasOnceRequestIsSent();
    await loadSchemas();
    expect(sendHeaders.hasSubscribers).toBe(before);
  });
});
