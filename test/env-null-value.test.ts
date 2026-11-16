import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { planEnvWrite, applyEnvWrite } from '../src/client/safe-write.js';
import { BulkResponseSchema, EnvVarSchema, type EnvVar, type EnvWriteItem } from '../src/client/schemas.js';
import { CoolifyClient } from '../src/client/coolify.js';
import { redactDeep } from '../src/client/redact.js';
import { envApply, envDiff, envList, envDelete } from '../src/cli/commands/env.js';
import { parseArgs } from '../src/cli/args.js';
import { noopLogger } from '../src/logging/index.js';
import { CoolifyAuthScopeError } from '../src/errors/index.js';
import type { CmdDeps } from '../src/cli/deps.js';

// Live bug (Coolify 4.7.5): `env list` failed with "Coolify response (listEnvs) failed contract
// validation" on any resource whose compose declares a blank variable (`${VAR:-}`). Coolify stores
// such a row with a NULL value and serialises `value: null`, `real_value: null`, `order: null`.
// The fixture is synthetic but 4.7.5-shaped (keys, JSON types and nulls as the server sends them).
const raw = (): Array<Record<string, unknown>> => JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/coolify/v4.7/envs-compose-blank.json', import.meta.url)), 'utf8'),
) as Array<Record<string, unknown>>;
const fixture = (): EnvVar[] => BulkResponseSchema.parse(raw());

let out: string[];
let err: string[];
const realOut = process.stdout.write.bind(process.stdout);
const realErr = process.stderr.write.bind(process.stderr);
beforeEach(() => {
  out = []; err = [];
  process.stdout.write = ((c: string | Uint8Array) => { out.push(String(c)); return true; }) as typeof process.stdout.write;
  process.stderr.write = ((c: string | Uint8Array) => { err.push(String(c)); return true; }) as typeof process.stderr.write;
});
afterEach(() => { process.stdout.write = realOut; process.stderr.write = realErr; });

/** Mimics Coolify's bulk handler; a written value replaces the NULL. */
function fakeCoolify(initial: EnvVar[]) {
  let rows = initial.map((r) => ({ ...r }));
  return {
    rows: () => rows,
    listEnvs: vi.fn(async () => rows.map((r) => ({ ...r }))),
    upsertEnvs: vi.fn(async (items: EnvWriteItem[]) => {
      for (const item of items) {
        const preview = item.is_preview ?? false;
        const hit = rows.find((r) => r.key === item.key && r.is_preview === preview);
        if (hit) { hit.value = item.value; hit.value_null = false; }
        else rows = [...rows, { ...rows[0]!, uuid: `new-${item.key}`, key: item.key, value: item.value, is_preview: preview, value_null: false }];
      }
      return rows;
    }),
    deleteEnv: vi.fn(async (uuid: string) => { rows = rows.filter((r) => r.uuid !== uuid); return { message: 'deleted' }; }),
    get: vi.fn(async () => ({ uuid: 'app-1', name: 'app', build_pack: 'dockerfile' })),
  };
}

function deps(api: ReturnType<typeof fakeCoolify>): CmdDeps {
  return {
    resolveTargetFor: () => ({ instanceUrl: 'https://c', kind: 'application', uuid: 'app-1', token: 't' }),
    clientFactory: () => api as unknown as ReturnType<CmdDeps['clientFactory']>,
    actor: 'test', auditSink: vi.fn().mockResolvedValue(undefined), now: () => new Date('2026-11-16T00:00:00Z'),
  };
}

describe('env rows with value: null (Coolify 4.7.5, compose-declared blank vars)', () => {
  it('the fixture really carries JSON nulls', () => {
    const blank = raw().find((r) => r['key'] === 'FEATURE_FLAG')!;
    expect(blank['value']).toBeNull();
    expect(blank['real_value']).toBeNull();
    expect(blank['order']).toBeNull();
  });

  it('parses a null value as an empty, NOT hidden, value and marks it value_null', () => {
    const rows = fixture();
    const blank = rows.find((r) => r.key === 'FEATURE_FLAG' && !r.is_preview)!;
    expect(blank.value).toBe('');
    expect(blank.value_null).toBe(true);
    expect(blank.value_hidden).toBe(false);
    const empty = rows.find((r) => r.key === 'EMPTY_STRING')!;
    expect([empty.value, empty.value_null, empty.value_hidden]).toEqual(['', false, false]);
    const set = rows.find((r) => r.key === 'NODE_ENV')!;
    expect([set.value, set.value_null, set.value_hidden]).toEqual(['production', false, false]);
  });

  it('keeps a withheld value (no read:sensitive: key absent) distinct from a null one', () => {
    const { value: _v, real_value: _r, ...withheld } = raw()[0]!;
    const row = EnvVarSchema.parse(withheld);
    expect([row.value, row.value_hidden, row.value_null]).toEqual(['', true, false]);
  });

  it('CoolifyClient.listEnvs accepts the payload instead of failing the contract', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(raw()), { status: 200 }));
    const client = new CoolifyClient(
      { instanceUrl: 'https://c', kind: 'application', uuid: 'app-1', token: 't' },
      { fetchImpl, logger: noopLogger() },
    );
    const rows = await client.listEnvs();
    expect(rows).toHaveLength(5);
    expect(rows.filter((r) => r.value_null).map((r) => r.key)).toEqual(['FEATURE_FLAG', 'FEATURE_FLAG', 'MODEL_PATH']);
  });

  it('env list --json reports length 0 + value_null, never null (= hidden)', async () => {
    const code = await envList(parseArgs(['env', 'list', '--app', 'web', '--json']), deps(fakeCoolify(fixture())));
    expect(code).toBe(0);
    const view = JSON.parse(out.join('')) as Array<{ key: string; scope: string; value_length: number | null; value_null: boolean }>;
    const blank = view.find((v) => v.key === 'FEATURE_FLAG' && v.scope === 'prod')!;
    expect(blank.value_length).toBe(0);
    expect(blank.value_null).toBe(true);
    expect(view.find((v) => v.key === 'EMPTY_STRING')!).toMatchObject({ value_length: 0, value_null: false });
    expect(view.find((v) => v.key === 'NODE_ENV')!).toMatchObject({ value_length: 10, value_null: false });
    expect(view.every((v) => v.value_length !== null)).toBe(true);
  });

  it('env list (human) labels a null row "null", not "hidden", and does not ask for read:sensitive', async () => {
    await envList(parseArgs(['env', 'list', '--app', 'web']), deps(fakeCoolify(fixture())));
    const text = out.join('');
    expect(text).toMatch(/FEATURE_FLAG {2}\[prod\] {2}len=0 \(null\)/);
    expect(text).toMatch(/EMPTY_STRING {2}\[prod\] {2}len=0 {2}/);
    expect(text).not.toContain('hidden');
    expect(text).not.toContain('read:sensitive');
  });

  it('env list still labels a withheld value hidden', async () => {
    const withheld = raw().map(({ value: _v, real_value: _r, ...rest }) => rest);
    await envList(parseArgs(['env', 'list', '--app', 'web']), deps(fakeCoolify(BulkResponseSchema.parse(withheld))));
    expect(out.join('')).toContain('len=hidden');
    expect(out.join('')).toContain('lengths need read:sensitive');
  });

  it('env diff: a blank desired value against a null row is unchanged (no spurious diff, no scope error)', async () => {
    const code = await envDiff(
      parseArgs(['env', 'diff', '--app', 'web', '--set', 'FEATURE_FLAG=', '--set', 'MODEL_PATH=', '--set', 'NODE_ENV=production', '--json', '--fail-on-drift']),
      deps(fakeCoolify(fixture())),
    );
    expect(code).toBe(0);
    const plan = JSON.parse(out.join('')) as { creates: unknown[]; updates: unknown[]; unchanged: string[]; duplicateKeyDrift: unknown[]; otherScope: unknown[]; warnings: unknown[] };
    expect(plan.creates).toEqual([]);
    expect(plan.updates).toEqual([]);
    expect(plan.unchanged).toEqual(['FEATURE_FLAG', 'MODEL_PATH', 'NODE_ENV']);
    expect(plan.duplicateKeyDrift).toEqual([]);
    expect(plan.otherScope).toEqual([]);
    expect(plan.warnings).toEqual([]);
  });

  it('env diff / apply are not refused as "withheld" because of a null row', async () => {
    await expect(envDiff(parseArgs(['env', 'diff', '--app', 'web', '--set', 'A=1']), deps(fakeCoolify(fixture())))).resolves.toBe(0);
    const withheld = BulkResponseSchema.parse(raw().map(({ value: _v, real_value: _r, ...rest }) => rest));
    await expect(envDiff(parseArgs(['env', 'diff', '--app', 'web', '--set', 'A=1']), deps(fakeCoolify(withheld))))
      .rejects.toBeInstanceOf(CoolifyAuthScopeError);
  });

  it('plans an update when a null row gets a real value, and reports the null preview row as other-scope', () => {
    const plan = planEnvWrite(fixture(), { values: { FEATURE_FLAG: 'on' } });
    expect(plan.updates).toEqual([{ key: 'FEATURE_FLAG', value: 'on' }]);
    expect(plan.otherScope).toEqual([{ key: 'FEATURE_FLAG', scope: 'preview' }]);
    expect(plan.duplicateKeyDrift).toEqual([]);
  });

  it('a null row and an empty-string row of the same key and scope are not value drift', () => {
    const rows = fixture();
    const twin: EnvVar = { ...rows.find((r) => r.key === 'FEATURE_FLAG' && !r.is_preview)!, uuid: 'env-blank-prod-2', value: '', value_null: false };
    const plan = planEnvWrite([...rows, twin], { values: {} });
    expect(plan.duplicateKeyDrift).toEqual([]);
  });

  it('env apply --apply writes a real value over a null row and confirms; a blank value writes nothing', async () => {
    const api = fakeCoolify(fixture());
    await envApply(parseArgs(['env', 'apply', '--app', 'web', '--set', 'FEATURE_FLAG=on', '--apply']), deps(api));
    expect(api.upsertEnvs).toHaveBeenCalledWith([{ key: 'FEATURE_FLAG', value: 'on' }]);
    expect(out.join('')).toContain('Applied and confirmed.');

    const untouched = fakeCoolify(fixture());
    const result = await applyEnvWrite(planEnvWrite(fixture(), { values: { MODEL_PATH: '' } }), {
      client: untouched, logger: noopLogger(), target: { instanceUrl: 'https://c', kind: 'application', uuid: 'app-1' },
      actor: 't', writeAudit: vi.fn().mockResolvedValue(undefined),
    });
    expect(result.applied).toEqual([]);
    expect(untouched.upsertEnvs).not.toHaveBeenCalled();
  });

  it('env delete finds and deletes a null-valued row', async () => {
    const api = fakeCoolify(fixture());
    const code = await envDelete(parseArgs(['env', 'delete', '--app', 'web', '--key', 'MODEL_PATH', '--apply', '--json']), deps(api));
    expect(code).toBe(0);
    expect(api.deleteEnv).toHaveBeenCalledWith('env-path-prod');
  });

  it('redaction leaves a null value null (no crash, no fake length)', () => {
    const redacted = redactDeep(raw());
    const blank = redacted.find((r) => r['key'] === 'FEATURE_FLAG')!;
    expect(blank['value']).toBeNull();
    expect(blank['real_value']).toBeNull();
    expect(redacted.find((r) => r['key'] === 'NODE_ENV')!['value']).toBe('[REDACTED] (10 chars)');
  });
});
