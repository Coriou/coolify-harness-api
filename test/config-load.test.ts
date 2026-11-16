import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG_NAMES, findConfigFile, loadConfigModule, loadRegistry } from '../src/config/load.js';
import { configPathFor } from '../src/cli/config-path.js';
import { ConfigError } from '../src/errors/index.js';

let dir: string;
beforeAll(() => { dir = realpathSync(mkdtempSync(join(tmpdir(), 'coolify-harness-config-'))); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const valid = { instances: { prod: { url: 'https://coolify.example.com', tokenEnv: 'COOLIFY_TOKEN' } }, targets: {} };

describe('config validation', () => {
  it('drops trailing slashes from the instance URL', () => {
    expect(loadRegistry({ ...valid, instances: { prod: { url: 'https://coolify.example.com///', tokenEnv: 'T' } } }).instances['prod']!.url)
      .toBe('https://coolify.example.com');
  });

  it('rejects a URL with credentials, a non-http URL, and a token pasted where its env var NAME goes', () => {
    const bad = (instance: Record<string, string>): string => {
      try { loadRegistry({ instances: { prod: instance }, targets: {} }); return ''; } catch (e) { expect(e).toBeInstanceOf(ConfigError); return (e as Error).message; }
    };
    expect(bad({ url: 'https://user:hunter2@coolify.example.com', tokenEnv: 'T' })).toContain('instances.prod.url: must be an http(s) URL without credentials');
    expect(bad({ url: 'ftp://coolify.example.com', tokenEnv: 'T' })).toContain('instances.prod.url');
    const pasted = bad({ url: 'https://coolify.example.com', tokenEnv: '12|sup3rs3crett0ken' });
    expect(pasted).toContain('instances.prod.tokenEnv: must be the NAME of an environment variable');
    expect(pasted).not.toContain('sup3rs3crett0ken');
    expect(bad({ url: 'https://user:hunter2@coolify.example.com', tokenEnv: 'T' })).not.toContain('hunter2');
  });

  it('explains a missing default export and a bad target readably', () => {
    expect(() => loadRegistry(undefined)).toThrow(/has no default export/);
    expect(() => loadRegistry({ ...valid, targets: { web: { instance: 'prod', kind: 'vm', uuid: 'x' } } })).toThrow(/targets\.web\.kind: /);
  });
});

describe('config discovery', () => {
  it('finds the default file names in order, and says where it looked when there is none', () => {
    expect(() => findConfigFile(undefined, dir)).toThrow(new RegExp(`No coolify-harness config found in ${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    writeFileSync(join(dir, DEFAULT_CONFIG_NAMES[2]), 'export default {};\n');
    expect(findConfigFile(undefined, dir)).toBe(join(dir, 'coolify-harness.config.mjs'));
    writeFileSync(join(dir, DEFAULT_CONFIG_NAMES[0]), 'export default {};\n');
    expect(findConfigFile(undefined, dir)).toBe(join(dir, 'coolify-harness.config.ts'));
  });

  it('resolves an explicit path against the cwd and treats a non-default name as explicit', () => {
    expect(findConfigFile('conf/x.ts', dir)).toBe(join(dir, 'conf/x.ts'));
    expect(configPathFor({ config: '/abs/custom.config.ts' })).toBe('/abs/custom.config.ts');
    expect(configPathFor({ config: 'coolify-harness.config.ts', configExplicit: true })).toBe(join(process.cwd(), 'coolify-harness.config.ts'));
  });
});

describe('config loading errors are config errors (exit 2), not stack traces', () => {
  it('a missing file', async () => {
    await expect(loadConfigModule(join(dir, 'nope.config.ts'))).rejects.toThrow(/Config file not found: .*nope\.config\.ts/);
    await expect(loadConfigModule(join(dir, 'nope.config.ts'))).rejects.toBeInstanceOf(ConfigError);
  });

  it('a file that throws while loading, with a hint for TypeScript configs', async () => {
    const file = join(dir, 'broken.config.ts');
    writeFileSync(file, "import './does-not-exist.js';\nexport default {};\n");
    const err = await loadConfigModule(file).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConfigError);
    expect((err as Error).message).toContain(`Could not load config ${file}`);
    expect((err as Error).message).toContain('run the CLI through bun or tsx');
  });

  it('a plain .mjs config loads, with its catalog export', async () => {
    const file = join(dir, 'ok.config.mjs');
    writeFileSync(file, `export default ${JSON.stringify(valid)};\nexport const catalog = { schemas: [], out: {} };\n`);
    const mod = await loadConfigModule(file);
    expect(mod.registry.instances['prod']!.tokenEnv).toBe('COOLIFY_TOKEN');
    expect(mod.catalog).toEqual({ schemas: [], out: {} });
  });
});
