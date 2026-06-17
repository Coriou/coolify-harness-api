import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CoolifyClient } from '../src/client/coolify.js';
import { noopLogger } from '../src/logging/index.js';
import { CoolifyAuthError, CoolifyNotFoundError } from '../src/errors/index.js';
import type { ResolvedTarget } from '../src/config/schema.js';

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
});
