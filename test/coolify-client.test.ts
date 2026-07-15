import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CoolifyClient } from '../src/client/coolify.js';
import { noopLogger } from '../src/logging/index.js';
import { CoolifyAuthError, CoolifyNotFoundError, CoolifyFeatureNotSupportedError, CoolifyWaitTimeoutError } from '../src/errors/index.js';
import type { ResolvedTarget } from '../src/config/schema.js';
import { waitForDeployment } from '../src/client/wait.js';

const fxText = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/coolify/${name}`, import.meta.url)), 'utf8');
const resp = (status: number, text: string): Response =>
  new Response(text, { status, headers: { 'content-type': 'application/json' } });

const appTarget: ResolvedTarget = { instanceUrl: 'https://c.example.com', kind: 'application', uuid: 'app-1', token: 'tok' };
const svcTarget: ResolvedTarget = { instanceUrl: 'https://c.example.com', kind: 'service', uuid: 'svc-1', token: 'tok' };
const deps = (fetchImpl: ReturnType<typeof vi.fn>) => ({
  fetchImpl: fetchImpl as unknown as (u: string, i: RequestInit) => Promise<Response>,
  logger: noopLogger(),
  backoffBaseMs: 1,
  sleep: async () => {},
});

describe('CoolifyClient', () => {
  it('lists envs hitting the applications endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(resp(200, fxText('envs-list.json')));
    const client = new CoolifyClient(appTarget, deps(fetchImpl));
    const envs = await client.listEnvs();
    expect(envs).toHaveLength(2);
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://c.example.com/api/v1/applications/app-1/envs');
  });

  it('upsertEnvs PATCHes the bulk endpoint with { data: [...] }', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(resp(200, fxText('bulk-upsert-response.json')));
    const client = new CoolifyClient(appTarget, deps(fetchImpl));
    await client.upsertEnvs([{ key: 'NODE_ENV', value: 'production' }]);
    const [url, init] = fetchImpl.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('https://c.example.com/api/v1/applications/app-1/envs/bulk');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ data: [{ key: 'NODE_ENV', value: 'production' }] });
  });

  // Bug 1 (write): the current Coolify env-write API accepts only key/value/is_preview/is_literal/
  // is_multiline/is_shown_once and 422s ("This field is not allowed.") on any build-time field. The
  // client Zod-validates the outgoing bulk body so a non-writable field can never reach the wire,
  // even if an untyped caller injects one.
  it('upsertEnvs strips non-writable fields (build-time) from the bulk body it sends', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(resp(200, fxText('bulk-upsert-response.json')));
    const client = new CoolifyClient(appTarget, deps(fetchImpl));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await client.upsertEnvs([{ key: 'NODE_ENV', value: 'production', is_preview: true, is_build_time: true } as any]);
    const [, init] = fetchImpl.mock.calls[0]! as [string, RequestInit];
    const sent = JSON.parse(init.body as string);
    // is_preview is a valid write field and is kept; the build-time field is dropped entirely.
    expect(sent).toEqual({ data: [{ key: 'NODE_ENV', value: 'production', is_preview: true }] });
    expect(JSON.stringify(sent)).not.toMatch(/build/i);
  });

  it('deploy on an application returns deploymentUuid', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(resp(200, fxText('deploy-ack-application.json')));
    const ack = await new CoolifyClient(appTarget, deps(fetchImpl)).deploy();
    expect(ack.deploymentUuid).toBe('deploy-123');
  });

  it('restart on a service returns no deploymentUuid and hits the services endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(resp(200, fxText('deploy-ack-service.json')));
    const ack = await new CoolifyClient(svcTarget, deps(fetchImpl)).restart();
    expect(ack.deploymentUuid).toBeUndefined();
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://c.example.com/api/v1/services/svc-1/restart');
  });

  it('maps 401 to CoolifyAuthError and 404 to CoolifyNotFoundError', async () => {
    const f401 = vi.fn().mockResolvedValue(resp(401, JSON.stringify({ message: 'no' })));
    await expect(new CoolifyClient(appTarget, deps(f401)).listEnvs()).rejects.toBeInstanceOf(CoolifyAuthError);
    const f404 = vi.fn().mockResolvedValue(resp(404, JSON.stringify({ message: 'gone' })));
    await expect(new CoolifyClient(appTarget, deps(f404)).listEnvs()).rejects.toBeInstanceOf(CoolifyNotFoundError);
  });

  it('get() hits the resource root and parses with passthrough', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(resp(200, fxText('application.json')));
    const client = new CoolifyClient(appTarget, deps(fetchImpl));
    const app = await client.get();
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://c.example.com/api/v1/applications/app-1');
    expect(app.name).toBe('my-api');
    expect((app as any).unknown_passthrough_field).toBe('should be retained');
  });

  it('getRuntimeLogs appends ?lines and requires application kind', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(resp(200, fxText('runtime-logs.json')));
    const client = new CoolifyClient(appTarget, deps(fetchImpl));
    const r = await client.getRuntimeLogs(50);
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://c.example.com/api/v1/applications/app-1/logs?lines=50');
    expect(r.logs).toContain('Listening');

    const svcClient = new CoolifyClient(svcTarget, deps(vi.fn()));
    await expect(svcClient.getRuntimeLogs()).rejects.toBeInstanceOf(CoolifyFeatureNotSupportedError);
  });

  it('listDeployments uses /deployments/applications/{uuid} for apps and normalizes array response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(resp(200, fxText('deployments-for-app.json')));
    const client = new CoolifyClient(appTarget, deps(fetchImpl));
    const list = await client.listDeployments({ take: 5 });
    expect(fetchImpl.mock.calls[0]![0]).toMatch(/\/deployments\/applications\/app-1\?take=5$/);
    expect(list).toHaveLength(3);
    expect(list[1].status).toBe('in_progress');
  });

  it('listDeployments normalizes wrapped {deployments: [...]} shape', async () => {
    const wrapped = { count: 1, deployments: [{ deployment_uuid: 'd1', status: 'queued' }] };
    const fetchImpl = vi.fn().mockResolvedValue(resp(200, JSON.stringify(wrapped)));
    const client = new CoolifyClient(appTarget, deps(fetchImpl));
    const list = await client.listDeployments();
    expect(list).toHaveLength(1);
    expect(list[0].deployment_uuid).toBe('d1');
  });

  it('getDeployment hits the global deployments/{uuid} path (instance scoped)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(resp(200, fxText('deployment.json')));
    const client = new CoolifyClient(appTarget, deps(fetchImpl));
    const d = await client.getDeployment('deploy-uuid-9876');
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://c.example.com/api/v1/deployments/deploy-uuid-9876');
    expect(d.status).toBe('finished');
  });

  it('getLatestDeployment sorts by updated_at desc then created_at and returns top', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(resp(200, fxText('deployments-for-app.json')));
    const client = new CoolifyClient(appTarget, deps(fetchImpl));
    const latest = await client.getLatestDeployment();
    // From fixture: in_progress has most recent updated, then finished, then failed
    expect(latest?.deployment_uuid).toBe('deploy-inprog-2');
  });

  it('getLatestBuildLogs falls back to full getDeployment when list logs missing', async () => {
    // Use a modified list where recent has no logs
    const listNoLogs = [
      { deployment_uuid: 'd-no-logs', status: 'finished', commit: 'c1', created_at: '2026', updated_at: '2026' },
    ];
    const fetchList = vi.fn().mockResolvedValue(resp(200, JSON.stringify(listNoLogs)));
    const fetchOne = vi.fn().mockResolvedValue(resp(200, fxText('deployment.json')));
    const combined = vi.fn().mockImplementation((u: string) => (u.includes('/deployments/') && !u.includes('applications') ? fetchOne() : fetchList()));
    const client = new CoolifyClient(appTarget, deps(combined as any));
    const logs = await client.getLatestBuildLogs();
    expect(logs).toContain('build complete');
    expect(fetchOne).toHaveBeenCalled();
  });
});

describe('waitForDeployment (pure + client wrapper)', () => {
  it('returns immediately on terminal status', async () => {
    const calls: string[] = [];
    const getter = async (uuid: string) => {
      calls.push(uuid);
      return { deployment_uuid: uuid, status: 'finished' as const, logs: null };
    };
    const res = await waitForDeployment(getter, 'd1', { intervalMs: 1, timeoutMs: 100, sleep: async () => {} });
    expect(res.status).toBe('finished');
    expect(calls).toEqual(['d1']);
  });

  it('polls until terminal and stops', async () => {
    const seq = ['queued', 'in_progress', 'finished'];
    let i = 0;
    const getter = async () => ({ deployment_uuid: 'd2', status: seq[i++] as any, logs: null });
    const sleeps: number[] = [];
    const res = await waitForDeployment(getter, 'd2', {
      intervalMs: 5,
      timeoutMs: 1000,
      sleep: async (ms) => { sleeps.push(ms); },
    });
    expect(res.status).toBe('finished');
    expect(sleeps.length).toBe(2); // polled twice before terminal
  });

  it('times out with clear message', async () => {
    const getter = async () => ({ deployment_uuid: 'd3', status: 'in_progress' as const, logs: '...' });
    await expect(
      waitForDeployment(getter, 'd3', { intervalMs: 1, timeoutMs: 10, sleep: async () => {} }),
    ).rejects.toThrow(/waitForDeployment\(d3\) timed out/);
    await expect(
      waitForDeployment(getter, 'd3', { intervalMs: 1, timeoutMs: 10, sleep: async () => {} }),
    ).rejects.toBeInstanceOf(CoolifyWaitTimeoutError);
  });

  it('client.waitForDeployment uses injected sleep and getDeployment', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(resp(200, JSON.stringify({ deployment_uuid: 'dw', status: 'queued' })))
      .mockResolvedValueOnce(resp(200, JSON.stringify({ deployment_uuid: 'dw', status: 'finished', logs: 'done' })));
    const client = new CoolifyClient(appTarget, deps(fetchImpl));
    const d = await client.waitForDeployment('dw', { intervalMs: 1, timeoutMs: 100 });
    expect(d.status).toBe('finished');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
