import { describe, it, expect, vi } from 'vitest';
import { CircuitBreaker, httpRequest } from '../src/client/http.js';
import { noopLogger } from '../src/logging/index.js';
import { CoolifyBulkUnmarshalError } from '../src/errors/index.js';

const mkResponse = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const baseOpts = (fetchImpl: typeof fetch) => ({
  fetchImpl: fetchImpl as unknown as (u: string, i: RequestInit) => Promise<Response>,
  breaker: new CircuitBreaker({ failureThreshold: 5, resetTimeoutMs: 1000, now: () => 0 }),
  logger: noopLogger(),
  backoffBaseMs: 1,
  sleep: async () => {},
});

describe('httpRequest', () => {
  it('returns parsed body on 200', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mkResponse(200, [{ key: 'X' }]));
    const res = await httpRequest('https://c/x', { method: 'GET', token: 't' }, baseOpts(fetchImpl as unknown as typeof fetch));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ key: 'X' }]);
    // token is sent as a Bearer header
    const init = (fetchImpl.mock.calls[0]![1]) as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t');
  });

  it('retries on 5xx then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mkResponse(503, { message: 'down' }))
      .mockResolvedValueOnce(mkResponse(200, { ok: true }));
    const res = await httpRequest('https://c/x', { method: 'GET', token: 't' }, baseOpts(fetchImpl as unknown as typeof fetch));
    expect(res.body).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('retries the bulk-unmarshal quirk then throws CoolifyBulkUnmarshalError on exhaustion', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => mkResponse(500, { message: 'cannot unmarshal array into Go value' }));
    await expect(
      httpRequest('https://c/x', { method: 'PATCH', token: 't', jsonBody: { data: [] } }, { ...baseOpts(fetchImpl as unknown as typeof fetch), maxRetries: 2 }),
    ).rejects.toBeInstanceOf(CoolifyBulkUnmarshalError);
  });

  it('does not retry a 401', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mkResponse(401, { message: 'unauthorized' }));
    const res = await httpRequest('https://c/x', { method: 'GET', token: 't' }, baseOpts(fetchImpl as unknown as typeof fetch));
    expect(res.status).toBe(401);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('honours Retry-After header on 429', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(mkResponse(429, { message: 'slow down' }, { 'retry-after': '2' }))
      .mockResolvedValueOnce(mkResponse(200, { ok: true }));
    const res = await httpRequest('https://c/x', { method: 'GET', token: 't' }, {
      ...baseOpts(fetchImpl as unknown as typeof fetch),
      sleep,
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('throws immediately when circuit is open', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1000, now: () => 0 });
    breaker.recordFailure(); // Open the circuit
    const fetchImpl = vi.fn();
    await expect(
      httpRequest('https://c/x', { method: 'GET', token: 't' }, {
        ...baseOpts(fetchImpl as unknown as typeof fetch),
        breaker,
      }),
    ).rejects.toThrow(/Circuit open/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('throws when fetch rejects (network error) after exhausting retries', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network failure'));
    await expect(
      httpRequest('https://c/x', { method: 'GET', token: 't' }, {
        ...baseOpts(fetchImpl as unknown as typeof fetch),
        maxRetries: 1,
      }),
    ).rejects.toThrow('network failure');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('wraps non-Error fetch rejection as Error', async () => {
    const fetchImpl = vi.fn().mockRejectedValue('string error');
    await expect(
      httpRequest('https://c/x', { method: 'GET', token: 't' }, {
        ...baseOpts(fetchImpl as unknown as typeof fetch),
        maxRetries: 0,
      }),
    ).rejects.toThrow('string error');
  });

  it('returns 5xx status after exhausting retries without unmarshal quirk', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => mkResponse(503, { message: 'service unavailable' }));
    const res = await httpRequest('https://c/x', { method: 'GET', token: 't' }, {
      ...baseOpts(fetchImpl as unknown as typeof fetch),
      maxRetries: 1,
    });
    expect(res.status).toBe(503);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
