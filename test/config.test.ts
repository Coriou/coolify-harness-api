import { describe, it, expect } from 'vitest';
import { loadRegistry, resolveTarget, defineConfig } from '../src/config/load.js';
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

  it('throws ConfigError on unknown target name', () => {
    expect(() => resolveTarget(registry, 'nope', { COOLIFY_PROD_TOKEN: 'tok' })).toThrow(ConfigError);
  });

  it('throws MissingTokenError when the tokenEnv is unset', () => {
    expect(() => resolveTarget(registry, 'my-api', {})).toThrow(MissingTokenError);
  });
});
