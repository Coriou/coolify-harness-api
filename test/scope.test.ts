import { describe, it, expect } from 'vitest';
import { withScope } from '../src/cli/scope.js';
import { CoolifyAuthError, CoolifyAuthScopeError } from '../src/errors/index.js';

describe('withScope', () => {
  it('returns the value from the op on success', async () => {
    const result = await withScope('read:sensitive', async () => 'ok');
    expect(result).toBe('ok');
  });

  it('converts 403 CoolifyAuthError to CoolifyAuthScopeError with requiredScope', async () => {
    const err = new CoolifyAuthError('no', { status: 403 });
    await expect(
      withScope('read:sensitive', () => Promise.reject(err)),
    ).rejects.toSatisfy((e: unknown) => {
      if (!(e instanceof CoolifyAuthScopeError)) return false;
      expect(e.requiredScope).toBe('read:sensitive');
      expect(e.message).toContain("'read:sensitive'");
      expect(e.message).toContain('403');
      return true;
    });
  });

  it('passes through a 401 CoolifyAuthError unchanged', async () => {
    const err = new CoolifyAuthError('unauth', { status: 401 });
    await expect(
      withScope('write', () => Promise.reject(err)),
    ).rejects.toBe(err);
  });

  it('passes through a CoolifyAuthError with no status unchanged', async () => {
    const err = new CoolifyAuthError('no status');
    await expect(
      withScope('write', () => Promise.reject(err)),
    ).rejects.toBe(err);
  });

  it('passes through non-auth errors unchanged', async () => {
    const err = new TypeError('boom');
    await expect(
      withScope('deploy', () => Promise.reject(err)),
    ).rejects.toBe(err);
  });
});
