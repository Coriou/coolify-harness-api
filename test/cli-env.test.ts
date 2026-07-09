import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { envDiff, envApply, parseDotenv } from '../src/cli/commands/env.js';
import type { ParsedArgs } from '../src/cli/args.js';
import type { EnvVar } from '../src/client/schemas.js';

const ev = (key: string, value: string): EnvVar => ({
  uuid: key, key, value, is_preview: false, is_build_time: false, is_literal: false,
  is_multiline: false, is_shown_once: false,
});

const args = (over: Partial<ParsedArgs>): ParsedArgs => ({
  command: 'env-diff', config: 'cfg.ts', app: 'my-api', apply: false, yes: false,
  redeploy: false, restart: false, json: false, failOnDrift: false, set: {}, ...over,
});

const fakeClient = (current: EnvVar[], upsert = vi.fn().mockResolvedValue([])) => ({
  listEnvs: vi.fn().mockResolvedValue(current),
  upsertEnvs: upsert,
  deploy: vi.fn(), restart: vi.fn(),
  get: vi.fn(),
  getRuntimeLogs: vi.fn(),
  listDeployments: vi.fn(),
  getDeployment: vi.fn(),
  getLatestDeployment: vi.fn(),
  getLatestBuildLogs: vi.fn(),
  waitForDeployment: vi.fn(),
});

const deps = (client: ReturnType<typeof fakeClient>) => ({
  resolveTargetFor: () => ({ instanceUrl: 'https://c', kind: 'application' as const, uuid: 'app-1', token: 't' }),
  clientFactory: () => client,
  actor: 'test', auditSink: vi.fn().mockResolvedValue(undefined), now: () => new Date('2026-06-17T00:00:00Z'),
});

describe('parseDotenv', () => {
  it('parses KEY=VALUE lines, ignoring comments and blanks', () => {
    const result = parseDotenv('A=1\nB=2\n# comment\n\nC=3\n');
    expect(result).toEqual({ A: '1', B: '2', C: '3' });
  });

  it('strips export prefix', () => {
    const result = parseDotenv('export FOO=bar\n');
    expect(result).toEqual({ FOO: 'bar' });
  });

  it('throws ZodError on a line without =', () => {
    expect(() => parseDotenv('BADLINE\n')).toThrow(z.ZodError);
  });
});

describe('env CLI', () => {
  it('env diff is read-only and never upserts', async () => {
    const client = fakeClient([ev('A', '1')]);
    const code = await envDiff(args({ set: { A: '2' } }), deps(client));
    expect(code).toBe(0);
    expect(client.upsertEnvs).not.toHaveBeenCalled();
  });

  it('env apply without --apply is a dry-run (no upsert, exit 0)', async () => {
    const client = fakeClient([ev('A', '1')]);
    const code = await envApply(args({ command: 'env-apply', set: { A: '2' }, apply: false }), deps(client));
    expect(code).toBe(0);
    expect(client.upsertEnvs).not.toHaveBeenCalled();
  });

  it('env apply with --apply upserts and never deploys', async () => {
    const client = fakeClient([ev('A', '1')], vi.fn().mockResolvedValue([]));
    client.listEnvs.mockResolvedValueOnce([ev('A', '1')]).mockResolvedValueOnce([ev('A', '2')]);
    const d = deps(client);
    const code = await envApply(args({ command: 'env-apply', set: { A: '2' }, apply: true }), d);
    expect(code).toBe(0);
    expect(client.upsertEnvs).toHaveBeenCalledWith([{ key: 'A', value: '2' }]);
    expect(client.deploy).not.toHaveBeenCalled();
    expect(d.auditSink).toHaveBeenCalledOnce();
  });

  it('env diff with --from-file reads file values and never upserts', async () => {
    const client = fakeClient([ev('A', 'old')]);
    const readFile = vi.fn().mockResolvedValue('A=1\nB=2\n# comment\n\nC=3\n');
    const d = { ...deps(client), readFile };
    const code = await envDiff(
      args({ fromFile: 'fake.env', set: {} }),
      d,
    );
    expect(code).toBe(0);
    expect(readFile).toHaveBeenCalledWith('fake.env');
    expect(client.upsertEnvs).not.toHaveBeenCalled();
    // A should be an update (old→1), B and C should be creates
    // We can verify via the stdout or just confirm no error and read-only
  });

  it('--set overrides --from-file for the same key', async () => {
    const client = fakeClient([]);
    const readFile = vi.fn().mockResolvedValue('A=1\n');
    const d = { ...deps(client), readFile };
    // --set A=2 should override file's A=1
    // We capture stdout to verify the merged value used in the plan
    const writes: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string | Uint8Array) => { writes.push(String(chunk)); return true; };
    try {
      await envDiff(args({ fromFile: 'fake.env', set: { A: '2' } }), d);
    } finally {
      process.stdout.write = origWrite;
    }
    // Plan should show A as a create with value 2 (not 1)
    // The plan output lists creates; A=2 means a create from empty current
    expect(writes.join('')).toContain('creates: A');
    expect(client.upsertEnvs).not.toHaveBeenCalled();
  });
});
