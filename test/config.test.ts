import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { loadRegistry, resolveTarget, resolveInstance, defineConfig, loadConfig, loadConfigModule } from '../src/config/load.js';
import { ConfigError, MissingTokenError } from '../src/errors/index.js';

const registry = defineConfig({
  instances: { prod: { url: 'https://coolify.example.com', tokenEnv: 'COOLIFY_PROD_TOKEN' } },
  targets: { 'my-api': { instance: 'prod', kind: 'application', uuid: 'abc-uuid' } },
});

describe('config', () => {
  it('validates a well-formed registry', () => {
    expect(() => loadRegistry(registry)).not.toThrow();
  });

  it('rejects a malformed registry with ConfigError', () => {
    expect(() => loadRegistry({ instances: {}, targets: { x: { instance: 'p' } } })).toThrow(ConfigError);
  });

  it('resolves a target to instance url + kind + uuid + token', () => {
    const r = resolveTarget(registry, 'my-api', { COOLIFY_PROD_TOKEN: 'tok' });
    expect(r).toEqual({ instanceUrl: 'https://coolify.example.com', kind: 'application', uuid: 'abc-uuid', token: 'tok' });
  });

  it('resolves an instance by name (for instance-scoped commands) with the same token rules', () => {
    expect(resolveInstance(registry, 'prod', { COOLIFY_PROD_TOKEN: 'tok' })).toEqual({ instanceUrl: 'https://coolify.example.com', token: 'tok' });
    expect(() => resolveInstance(registry, 'staging', { COOLIFY_PROD_TOKEN: 'tok' })).toThrow(/Known instances: prod/);
    expect(() => resolveInstance(registry, 'prod', {})).toThrow(MissingTokenError);
  });

  it('accepts standalone database targets', () => {
    const withDb = loadRegistry({ ...registry, targets: { pg: { instance: 'prod', kind: 'database', uuid: 'db-1' } } });
    expect(resolveTarget(withDb, 'pg', { COOLIFY_PROD_TOKEN: 'tok' }).kind).toBe('database');
  });

  it('throws ConfigError on unknown target name', () => {
    expect(() => resolveTarget(registry, 'nope', { COOLIFY_PROD_TOKEN: 'tok' })).toThrow(ConfigError);
  });

  it('throws MissingTokenError when the tokenEnv is unset', () => {
    expect(() => resolveTarget(registry, 'my-api', {})).toThrow(MissingTokenError);
  });

  it('throws ConfigError on unknown target instance', () => {
    const r = defineConfig({
      instances: {},
      targets: { 'my-api': { instance: 'missing', kind: 'application', uuid: 'x' } },
    });
    expect(() => resolveTarget(r, 'my-api', {})).toThrow(ConfigError);
  });

  it('loadConfig resolves a project registry from a file', async () => {
    const path = resolve(import.meta.dirname, 'fixtures/config/basic.config.ts');
    const r = await loadConfig(path);
    expect(r.targets['my-api']?.kind).toBe('application');
  });

  it('loadConfigModule resolves registry + catalog from a file', async () => {
    const path = resolve(import.meta.dirname, 'fixtures/config/basic.config.ts');
    const mod = await loadConfigModule(path);
    expect(mod.registry.targets['my-api']?.uuid).toBe('abc-uuid');
    expect(mod.catalog).toBeDefined();
  });
});
