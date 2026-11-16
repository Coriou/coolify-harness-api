import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as api from '../src/index.js';
import { HARNESS_VERSION, TESTED_COOLIFY, compareVersions, compatibilityWarning, coolifyCompatibility } from '../src/version.js';

const root = (file: string): string => readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), 'utf8');

describe('version bookkeeping', () => {
  it('HARNESS_VERSION is the package.json version', () => {
    expect(HARNESS_VERSION).toBe((JSON.parse(root('package.json')) as { version: string }).version);
  });

  it('the README and CHANGELOG state the same harness version and tested Coolify range', () => {
    const readme = root('README.md');
    expect(readme).toContain(`coolify-harness-api#v${HARNESS_VERSION}`);
    expect(readme).toContain(`| **${HARNESS_VERSION}** |`);
    expect(readme).toContain(`${TESTED_COOLIFY.min} – ${TESTED_COOLIFY.max}`);
    const changelog = root('CHANGELOG.md');
    expect(changelog).toContain(`## [${HARNESS_VERSION}]`);
    expect(changelog).toMatch(new RegExp(`## \\[${HARNESS_VERSION.replace(/\./g, '\\.')}\\][^\\n]*\\n\\n(?:.*\\n)*?.*Verified against \\*\\*Coolify ${TESTED_COOLIFY.max.replace(/\./g, '\\.')}\\*\\*`));
  });

  it('there is a recorded fixture directory for both ends of the tested range', () => {
    for (const v of [TESTED_COOLIFY.min, TESTED_COOLIFY.max]) {
      const dir = `test/fixtures/coolify/v${v.split('.').slice(0, 2).join('.')}/application.json`;
      expect(() => root(dir), dir).not.toThrow();
    }
  });
});

describe('Coolify compatibility', () => {
  it('compares versions numerically, not as strings', () => {
    expect(compareVersions('4.10.0', '4.9.9')).toBe(1);
    expect(compareVersions('v4.7.5', '4.7.5')).toBe(0);
    expect(compareVersions('4.7.5-beta.2', '4.7.5')).toBe(0);
    expect(compareVersions('4.0.0', '4.5.0')).toBe(-1);
    expect(compareVersions('not a version', '4.5.0')).toBeUndefined();
  });

  it('classifies a live version against the tested range', () => {
    expect(coolifyCompatibility(TESTED_COOLIFY.min)).toBe('tested');
    expect(coolifyCompatibility(TESTED_COOLIFY.max)).toBe('tested');
    expect(coolifyCompatibility('4.6.0')).toBe('tested');
    expect(coolifyCompatibility('4.7.6')).toBe('newer');
    expect(coolifyCompatibility('5.0.0')).toBe('newer');
    expect(coolifyCompatibility('4.4.7')).toBe('older');
    expect(coolifyCompatibility('<html>login</html>')).toBe('unknown');
  });

  it('warns only outside the range, and says what to do', () => {
    expect(compatibilityWarning(TESTED_COOLIFY.max)).toBeUndefined();
    expect(compatibilityWarning('4.8.0')).toMatch(/newer than the range .* tested against \(4\.5\.0–4\.7\.5\).*newer coolify-harness release/);
    expect(compatibilityWarning('4.3.16')).toMatch(/older than the range/);
    expect(compatibilityWarning('x'.repeat(500))!.length).toBeLessThan(200);
  });
});

describe('public surface', () => {
  it('keeps every export consumers of 0.4.x import, and adds the new ones', () => {
    const names = Object.keys(api).sort();
    for (const n of [
      // 0.4.x
      'CoolifyClient', 'CoolifyInstanceClient', 'planEnvWrite', 'applyEnvWrite', 'buildAuditRecord', 'redactDeep', 'redactDocument',
      'listServiceImages', 'setServiceImage', 'splitImageRef', 'isValidImageRef', 'formatRedactedDiff', 'generateCatalog', 'buildArtifacts',
      'checkCatalogFresh', 'walkEnvSchema', 'mergeCatalogs', 'DEPLOYMENT_STATUSES', 'TERMINAL_DEPLOYMENT_STATUSES', 'isTerminalDeploymentStatus',
      'waitForDeployment', 'defineConfig', 'loadConfig', 'loadConfigModule', 'resolveTarget', 'resolveInstance', 'createLogger',
      'CoolifyHarnessError', 'CoolifyAuthError', 'CoolifyAuthScopeError', 'CoolifyNotFoundError', 'CoolifyContractError', 'CoolifyBulkUnmarshalError',
      'LockedVarError', 'DuplicateKeyDriftError', 'ConfigError', 'MissingTokenError', 'CatalogStaleError', 'CoolifyFeatureNotSupportedError',
      'CoolifyWaitTimeoutError', 'CoolifyRequestError',
      // 0.5.0
      'TESTED_COOLIFY', 'HARNESS_VERSION', 'coolifyCompatibility', 'compatibilityWarning', 'compareVersions', 'CoolifyNetworkError', 'UsageError',
      'InvalidInputError', 'isLockedRow', 'findConfigFile', 'redactCommandLine', 'redactUrlCredentials',
    ]) {
      expect(names, n).toContain(n);
    }
  });

  it('package.json exposes the same subpaths as before, plus types', () => {
    const pkg = JSON.parse(root('package.json')) as { exports: Record<string, { default?: string } | string>; scripts: Record<string, string>; bin: Record<string, string> };
    const target = (k: string): string => { const e = pkg.exports[k]; return typeof e === 'string' ? e : e?.default ?? ''; };
    expect([target('.'), target('./client'), target('./catalog'), target('./config'), target('./cli')]).toEqual([
      './dist/index.js', './dist/client/coolify.js', './dist/catalog/generate.js', './dist/config/load.js', './dist/cli/main.js',
    ]);
    expect(pkg.bin['coolify-harness']).toBe('./dist/cli/main.js');
    // A git install must run no build script: pnpm and Bun both refuse or skip them.
    for (const hook of ['prepare', 'preinstall', 'install', 'postinstall', 'prepack']) expect(pkg.scripts[hook], hook).toBeUndefined();
  });
});

describe('start-up budget', () => {
  const src = fileURLToPath(new URL('../src/', import.meta.url));
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? files(`${dir}${e.name}/`) : e.name.endsWith('.ts') ? [`${dir}${e.name}`] : []));

  it('only client/schemas.ts imports zod, and nothing imports it eagerly', () => {
    const offenders: string[] = [];
    for (const file of files(src)) {
      const text = readFileSync(file, 'utf8');
      const rel = file.slice(src.length);
      if (/from 'zod/.test(text) && rel !== 'client/schemas.ts') offenders.push(`${rel}: imports zod`);
      // A value import of schemas.js would load zod (and its ~60 locale files) at start-up.
      for (const m of text.matchAll(/^(import|export) (?!type\b)[^;]*from '[^']*\/schemas\.js';/gm)) {
        if (rel !== 'client/schemas.ts') offenders.push(`${rel}: ${m[0].slice(0, 60)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
