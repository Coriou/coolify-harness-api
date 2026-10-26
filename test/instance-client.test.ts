import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CoolifyInstanceClient } from '../src/client/instance.js';
import { noopLogger } from '../src/logging/index.js';
import { CoolifyRequestError } from '../src/errors/index.js';

const fxText = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/coolify/v4.5/${name}`, import.meta.url)), 'utf8');
const json = (status: number, body: string): Response =>
  new Response(body, { status, headers: { 'content-type': 'application/json' } });
const text = (body: string): Response => new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });

const make = (fetchImpl: ReturnType<typeof vi.fn>): CoolifyInstanceClient =>
  new CoolifyInstanceClient(
    { instanceUrl: 'https://c.example.com', token: 'tok' },
    {
      fetchImpl: fetchImpl as unknown as (u: string, i: RequestInit) => Promise<Response>,
      logger: noopLogger(), backoffBaseMs: 1, sleep: async () => {},
    },
  );
const call = (f: ReturnType<typeof vi.fn>, n = 0): { url: string; method: string; body: unknown } => {
  const [url, init] = f.mock.calls[n]! as [string, RequestInit];
  return { url, method: init.method ?? 'GET', body: init.body === undefined ? undefined : JSON.parse(init.body as string) };
};
const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64');

describe('CoolifyInstanceClient — instance', () => {
  it('reads the plain-text /version and /health bodies', async () => {
    const f = vi.fn().mockResolvedValueOnce(text('4.5.0')).mockResolvedValueOnce(text('OK'));
    const c = make(f);
    expect(await c.getVersion()).toBe('4.5.0');
    expect(await c.getHealth()).toBe('OK');
    expect(call(f, 0).url).toBe('https://c.example.com/api/v1/version');
  });
});

describe('CoolifyInstanceClient — servers and proxy', () => {
  it('lists servers and reads one server, its resources and its proxy', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json(200, fxText('servers.json')))
      .mockResolvedValueOnce(json(200, fxText('server-resources.json')))
      .mockResolvedValueOnce(json(200, fxText('server-proxy.json')));
    const c = make(f);
    expect((await c.listServers())[0]!.uuid).toBe('srv-1');
    expect((await c.getServerResources('srv-1')).length).toBeGreaterThan(0);
    expect((await c.getServerProxy('srv-1')).configuration).toContain('traefik:v3.6');
    expect(call(f, 1).url).toBe('https://c.example.com/api/v1/servers/srv-1/resources');
    expect(call(f, 2).url).toBe('https://c.example.com/api/v1/servers/srv-1/proxy');
  });

  it('saves the proxy compose base64-encoded with PUT, and restarts with POST', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json(200, JSON.stringify({ message: 'Proxy configuration saved.', proxy_type: 'TRAEFIK' })))
      .mockResolvedValueOnce(json(200, JSON.stringify({ message: 'Proxy restart queued.' })));
    const c = make(f);
    await c.saveServerProxyConfiguration('srv-1', 'services: {}\n');
    expect(call(f, 0)).toEqual({
      url: 'https://c.example.com/api/v1/servers/srv-1/proxy/configuration', method: 'PUT',
      body: { configuration: b64('services: {}\n') },
    });
    expect((await c.restartServerProxy('srv-1')).message).toBe('Proxy restart queued.');
    expect(call(f, 1)).toMatchObject({ url: 'https://c.example.com/api/v1/servers/srv-1/proxy/restart', method: 'POST' });
  });

  it('PATCH /proxy only sends the fields Coolify accepts (an image is not one of them)', async () => {
    const f = vi.fn().mockResolvedValue(json(200, JSON.stringify({ proxy_type: 'TRAEFIK' })));
    const c = make(f);
    await c.updateServerProxy('srv-1', { redirect_enabled: false });
    expect(call(f).body).toEqual({ redirect_enabled: false });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(c.updateServerProxy('srv-1', { image: 'traefik:v3' } as any)).rejects.toThrow();
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('CoolifyInstanceClient — databases', () => {
  it('PATCHes is_public and refuses fields the harness does not expose (credentials)', async () => {
    const f = vi.fn().mockResolvedValue(json(200, JSON.stringify({ message: 'Database updated.' })));
    const c = make(f);
    await c.updateDatabase('db-1', { is_public: false });
    expect(call(f)).toEqual({ url: 'https://c.example.com/api/v1/databases/db-1', method: 'PATCH', body: { is_public: false } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(c.updateDatabase('db-1', { postgres_password: 'x' } as any)).rejects.toThrow();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('lists backups + executions and runs a backup now via backup_now', async () => {
    const backups = [{ uuid: 'bk-1', frequency: 'daily', enabled: true, executions: [{ uuid: 'ex-1', status: 'success', message: null }] }];
    const f = vi.fn()
      .mockResolvedValueOnce(json(200, JSON.stringify(backups)))
      .mockResolvedValueOnce(json(200, JSON.stringify({ executions: backups[0]!.executions })))
      .mockResolvedValueOnce(json(200, JSON.stringify({ message: 'Database backup configuration updated' })));
    const c = make(f);
    expect((await c.listDatabaseBackups('db-1'))[0]!.executions?.[0]?.status).toBe('success');
    expect(await c.listBackupExecutions('db-1', 'bk-1')).toHaveLength(1);
    await c.runDatabaseBackup('db-1', 'bk-1');
    expect(call(f, 1).url).toBe('https://c.example.com/api/v1/databases/db-1/backups/bk-1/executions');
    expect(call(f, 2)).toEqual({ url: 'https://c.example.com/api/v1/databases/db-1/backups/bk-1', method: 'PATCH', body: { backup_now: true } });
  });
});

describe('CoolifyInstanceClient — deployments', () => {
  it('lists running deployments (array) and parses queued rows with null columns', async () => {
    const f = vi.fn().mockResolvedValue(json(200, `[${fxText('deployment-queued.json')}]`));
    const list = await make(f).listRunningDeployments();
    expect(list[0]!.status).toBe('queued');
  });

  it('cancels with POST and surfaces Coolify\'s own 400 message as CoolifyRequestError', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(json(200, JSON.stringify({ message: 'Deployment cancelled successfully.', deployment_uuid: 'd1', status: 'cancelled-by-user' })))
      .mockResolvedValueOnce(json(400, JSON.stringify({ message: 'Deployment cannot be cancelled. Current status: finished' })));
    const c = make(f);
    expect((await c.cancelDeployment('d1')).status).toBe('cancelled-by-user');
    expect(call(f, 0)).toMatchObject({ url: 'https://c.example.com/api/v1/deployments/d1/cancel', method: 'POST' });
    const err = await c.cancelDeployment('d1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CoolifyRequestError);
    expect((err as CoolifyRequestError).status).toBe(400);
    expect((err as Error).message).toContain('Current status: finished');
  });

  it('reports 422 field names (never values)', async () => {
    const f = vi.fn().mockResolvedValue(json(422, JSON.stringify({ message: 'Validation failed.', errors: { configuration: ['The container_name must be coolify-proxy.'] } })));
    const err = await make(f).saveServerProxyConfiguration('srv-1', 'x: 1').catch((e: unknown) => e);
    expect((err as CoolifyRequestError).fields).toEqual(['configuration']);
  });
});
