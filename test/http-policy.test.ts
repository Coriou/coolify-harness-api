import { describe, it, expect, vi } from 'vitest';
import { CircuitBreaker, httpRequest } from '../src/client/http.js';
import { CoolifyApi, sanitizeServerMessage } from '../src/client/base.js';
import { CoolifyClient } from '../src/client/coolify.js';
import { noopLogger } from '../src/logging/index.js';
import {
  CoolifyAuthError, CoolifyAuthScopeError, CoolifyNetworkError, CoolifyRequestError, InvalidInputError,
  CoolifyFeatureNotSupportedError,
} from '../src/errors/index.js';
import { withScope } from '../src/cli/scope.js';
import { HARNESS_VERSION } from '../src/version.js';

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const opts = (fetchImpl: unknown, over: Record<string, unknown> = {}) => ({
  fetchImpl: fetchImpl as (u: string, i: RequestInit) => Promise<Response>,
  breaker: new CircuitBreaker({ failureThreshold: 50, resetTimeoutMs: 1000, now: () => 0 }),
  logger: noopLogger(),
  backoffBaseMs: 1,
  sleep: vi.fn(async () => {}),
  ...over,
});

describe('retry policy: a mutation whose answer was lost is never replayed', () => {
  it('does NOT retry a POST on a network error (a second POST …/start would queue a second deployment)', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }));
    await expect(httpRequest('https://c/api/v1/applications/a/start', { method: 'POST', token: 't' }, opts(fetchImpl)))
      .rejects.toBeInstanceOf(CoolifyNetworkError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry a POST / DELETE / PATCH on a 5xx', async () => {
    for (const method of ['POST', 'DELETE', 'PATCH', 'PUT']) {
      const fetchImpl = vi.fn().mockImplementation(async () => json(502, { message: 'bad gateway' }));
      const res = await httpRequest('https://c/x', { method, token: 't' }, opts(fetchImpl));
      expect(res.status).toBe(502);
      expect(fetchImpl, method).toHaveBeenCalledTimes(1);
    }
  });

  it('retries a GET on a network error and on a 5xx', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(json(503, { message: 'down' }))
      .mockResolvedValueOnce(json(200, { ok: true }));
    const res = await httpRequest('https://c/x', { method: 'GET', token: 't' }, opts(fetchImpl));
    expect(res.body).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('retries a write only when the caller marks it idempotent', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(503, {})).mockResolvedValueOnce(json(201, []));
    const res = await httpRequest('https://c/x', { method: 'PATCH', token: 't', jsonBody: { data: [] }, idempotent: true }, opts(fetchImpl));
    expect(res.status).toBe(201);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('retries a 429 for every method (the request was not processed) and honours Retry-After', async () => {
    const o = opts(vi.fn().mockResolvedValueOnce(json(429, { message: 'slow down' }, { 'retry-after': '3' })).mockResolvedValueOnce(json(200, { message: 'queued' })));
    const res = await httpRequest('https://c/x', { method: 'POST', token: 't' }, o);
    expect(res.status).toBe(200);
    expect(o.sleep).toHaveBeenCalledWith(3000);
  });

  it('reports a 429 at once when Retry-After is longer than it is willing to wait, instead of hanging', async () => {
    const o = opts(vi.fn().mockResolvedValue(json(429, { message: 'Deployment queue is full.' }, { 'retry-after': '60' })));
    const res = await httpRequest('https://c/x', { method: 'POST', token: 't' }, o);
    expect(res.status).toBe(429);
    expect(o.sleep).not.toHaveBeenCalled();
    expect(o.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('ignores a Retry-After it cannot read (HTTP-date) and backs off exponentially, capped', async () => {
    const o = opts(vi.fn().mockImplementation(async () => json(429, {}, { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' })), { backoffBaseMs: 100, maxRetryDelayMs: 250 });
    await httpRequest('https://c/x', { method: 'GET', token: 't' }, o);
    expect(o.sleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual([100, 200, 250]);
  });
});

describe('timeouts and unreachable hosts', () => {
  it('passes an abort signal to fetch and turns a timeout into CoolifyNetworkError(reason=timeout)', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.signal).toBeInstanceOf(AbortSignal);
      throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    });
    const err = await httpRequest('https://c.example/api/v1/version', { method: 'GET', token: 't' }, opts(fetchImpl, { maxRetries: 0, timeoutMs: 5000 })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CoolifyNetworkError);
    expect((err as CoolifyNetworkError).reason).toBe('timeout');
    expect((err as Error).message).toContain('within 5s');
  });

  it('names the host and the system error code when Coolify cannot be reached', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }));
    const err = await httpRequest('https://nope.example/api/v1/version', { method: 'GET', token: 'secret-token' }, opts(fetchImpl, { maxRetries: 0 })).catch((e: unknown) => e);
    expect((err as CoolifyNetworkError).reason).toBe('ENOTFOUND');
    expect((err as Error).message).toContain('https://nope.example');
    expect((err as Error).message).not.toContain('secret-token');
  });

  it('counts a connection dropped while reading the body as a network error', async () => {
    const res = { status: 200, headers: new Headers(), text: async () => { throw new TypeError('terminated'); } } as unknown as Response;
    await expect(httpRequest('https://c/x', { method: 'GET', token: 't' }, opts(vi.fn().mockResolvedValue(res), { maxRetries: 0 })))
      .rejects.toBeInstanceOf(CoolifyNetworkError);
  });

  it('raises a typed error when the circuit is open', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1000, now: () => 0 });
    breaker.recordFailure();
    const err = await httpRequest('https://c/x', { method: 'GET', token: 't' }, opts(vi.fn(), { breaker })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CoolifyNetworkError);
    expect((err as CoolifyNetworkError).reason).toBe('circuit-open');
  });
});

describe('request headers', () => {
  it('asks for JSON and identifies the client, without any user or project detail', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, {}));
    await httpRequest('https://c/x', { method: 'GET', token: 't' }, opts(fetchImpl));
    const headers = (fetchImpl.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers).toEqual({ Authorization: 'Bearer t', Accept: 'application/json', 'User-Agent': `coolify-harness/${HARNESS_VERSION}` });
  });
});

describe('error mapping carries what Coolify said', () => {
  const api = (fetchImpl: unknown): CoolifyApi => new CoolifyApi('https://c.example/', 'tok', { fetchImpl: fetchImpl as never, logger: noopLogger(), maxRetries: 0 });

  it('normalises a trailing slash in the instance URL', () => {
    expect(api(vi.fn()).url('/version')).toBe('https://c.example/api/v1/version');
  });

  it('a 403 keeps Coolify\'s reason, and withScope turns it into an actionable scope error', async () => {
    const a = api(vi.fn().mockImplementation(async () => json(403, { message: 'Missing required permissions: delete' })));
    const raw = await a.request('/applications/a/envs/e', 'DELETE').catch((e: unknown) => e);
    expect(raw).toBeInstanceOf(CoolifyAuthError);
    expect((raw as CoolifyAuthError).serverMessage).toBe('Missing required permissions: delete');
    const scoped = await withScope('delete', () => a.request('/applications/a/envs/e', 'DELETE')).catch((e: unknown) => e);
    expect(scoped).toBeInstanceOf(CoolifyAuthScopeError);
    expect((scoped as Error).message).toContain("needs a token with 'delete'");
    expect((scoped as Error).message).toContain('Coolify says: Missing required permissions: delete');
  });

  it('a 401 is an auth error, not a scope error', async () => {
    const a = api(vi.fn().mockResolvedValue(json(401, { message: 'Unauthenticated.' })));
    const err = await withScope('read', () => a.request('/version', 'GET')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CoolifyAuthError);
    expect((err as Error).message).toContain('Unauthenticated.');
  });

  it('a 422 lists the rejected field NAMES', async () => {
    const a = api(vi.fn().mockResolvedValue(json(422, { message: 'Validation failed.', errors: { public_port: ['taken'] } })));
    const err = await a.request('/databases/d', 'PATCH', { public_port: 5432 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CoolifyRequestError);
    expect((err as CoolifyRequestError).fields).toEqual(['public_port']);
  });

  it('never echoes a sent secret, URL credentials or a wall of text from a server error', async () => {
    const leak = 'SQLSTATE[23505]: insert into environment_variables (value) values (sup3r-s3cret-value) via postgres://coolify:dbpass@db:5432/coolify ' + 'x'.repeat(2000);
    const a = api(vi.fn().mockResolvedValue(json(500, { message: leak })));
    const err = await a.request('/applications/a/envs/bulk', 'PATCH', { data: [] }, { secrets: ['sup3r-s3cret-value'] }).catch((e: unknown) => e);
    const message = (err as Error).message;
    expect(message).not.toContain('sup3r-s3cret-value');
    expect(message).not.toContain('dbpass');
    expect(message.length).toBeLessThan(700);
    expect(sanitizeServerMessage('a\n  b', [])).toBe('a b');
  });
});

describe('client input validation', () => {
  const target = { instanceUrl: 'https://c', kind: 'application' as const, uuid: 'app-1', token: 't' };
  const deps = (fetchImpl: unknown) => ({ fetchImpl: fetchImpl as never, logger: noopLogger(), maxRetries: 0 });

  it('rejects a malformed env item before any request, with a harness error that names the field only', async () => {
    const fetchImpl = vi.fn();
    const err = await new CoolifyClient(target, deps(fetchImpl)).upsertEnvs([{ key: '', value: 'sup3r-s3cret' }]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidInputError);
    expect((err as InvalidInputError).issues[0]).toMatch(/^data\[0\]\.key: /);
    expect((err as Error).message).not.toContain('sup3r-s3cret');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('strips fields the bulk endpoint does not take and sends the ones it does', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(201, []));
    await new CoolifyClient(target, deps(fetchImpl)).upsertEnvs([
      { key: 'A', value: '1', is_runtime: true, is_buildtime: false, comment: 'why', is_build_time: true } as never,
    ]);
    expect(JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string)).toEqual({
      data: [{ key: 'A', value: '1', is_runtime: true, is_buildtime: false, comment: 'why' }],
    });
  });

  it('refuses a preview item for a service or database: Coolify would write the production row', async () => {
    for (const kind of ['service', 'database'] as const) {
      const fetchImpl = vi.fn();
      await expect(new CoolifyClient({ ...target, kind }, deps(fetchImpl)).upsertEnvs([{ key: 'A', value: '1', is_preview: true }]))
        .rejects.toBeInstanceOf(CoolifyFeatureNotSupportedError);
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it('asks Coolify for ONE deployment row to find the latest (each row embeds a full build log)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, { count: 45, deployments: [{ deployment_uuid: 'd1', status: 'finished' }] }));
    const latest = await new CoolifyClient(target, deps(fetchImpl)).getLatestDeployment();
    expect(latest?.deployment_uuid).toBe('d1');
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://c/api/v1/deployments/applications/app-1?take=1');
  });
});
