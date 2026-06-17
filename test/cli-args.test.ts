import { describe, it, expect } from 'vitest';
import { parseArgs } from '../src/cli/args.js';
import { errorToExitCode } from '../src/cli/main.js';
import { CatalogStaleError, CoolifyAuthError, LockedVarError } from '../src/errors/index.js';

describe('CLI args', () => {
  it('parses catalog gen with default config', () => {
    const a = parseArgs(['catalog', 'gen']);
    expect(a.command).toBe('catalog-gen');
    expect(a.config).toBe('coolify-harness.config.ts');
  });

  it('parses env apply with --app, repeated --set, and --apply', () => {
    const a = parseArgs(['env', 'apply', '--app', 'my-api', '--set', 'A=1', '--set', 'B=2', '--apply']);
    expect(a.command).toBe('env-apply');
    expect(a.app).toBe('my-api');
    expect(a.set).toEqual({ A: '1', B: '2' });
    expect(a.apply).toBe(true);
  });

  it('throws on an unknown command (usage error)', () => {
    expect(() => parseArgs(['frobnicate'])).toThrow();
  });
});

describe('errorToExitCode', () => {
  it('maps typed errors to CI-meaningful codes', () => {
    expect(errorToExitCode(new CatalogStaleError('x', { staleFiles: [] }))).toBe(3);
    expect(errorToExitCode(new CoolifyAuthError('x'))).toBe(5);
    expect(errorToExitCode(new LockedVarError('x', { key: 'K' }))).toBe(6);
    expect(errorToExitCode(new Error('boom'))).toBe(1);
  });
});
