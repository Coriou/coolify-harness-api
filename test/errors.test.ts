import { describe, it, expect } from 'vitest';
import {
  CoolifyHarnessError,
  CoolifyAuthScopeError,
  MissingTokenError,
  CatalogStaleError,
  CoolifyWaitTimeoutError,
} from '../src/errors/index.js';

describe('error taxonomy', () => {
  it('subclasses carry a stable code and extend the base', () => {
    const e = new CoolifyAuthScopeError('needs write', { requiredScope: 'write' });
    expect(e).toBeInstanceOf(CoolifyHarnessError);
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe('COOLIFY_AUTH_SCOPE');
    expect(e.requiredScope).toBe('write');
    expect(e.name).toBe('CoolifyAuthScopeError');
  });

  it('carries typed payloads', () => {
    expect(new MissingTokenError('unset', { tokenEnv: 'COOLIFY_PROD_TOKEN' }).tokenEnv).toBe(
      'COOLIFY_PROD_TOKEN',
    );
    expect(new CatalogStaleError('stale', { staleFiles: ['a.md'] }).staleFiles).toEqual(['a.md']);
    const w = new CoolifyWaitTimeoutError('dep-xyz', 1234, 'in_progress');
    expect(w.code).toBe('COOLIFY_WAIT_TIMEOUT');
    expect(w.deploymentUuid).toBe('dep-xyz');
    expect(w.timeoutMs).toBe(1234);
    expect(w.lastStatus).toBe('in_progress');
    expect(w).toBeInstanceOf(CoolifyHarnessError);
  });
});
