import { describe, it, expect, vi } from 'vitest';
import { envDiff, envApply } from '../src/cli/commands/env.js';
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
});

const deps = (client: ReturnType<typeof fakeClient>) => ({
  resolveTargetFor: () => ({ instanceUrl: 'https://c', kind: 'application' as const, uuid: 'app-1', token: 't' }),
  clientFactory: () => client,
  actor: 'test', auditSink: vi.fn().mockResolvedValue(undefined), now: () => new Date('2026-06-17T00:00:00Z'),
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
});
