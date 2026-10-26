import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { planEnvWrite, applyEnvWrite } from '../src/client/safe-write.js';
import { BulkResponseSchema, type EnvVar, type EnvWriteItem } from '../src/client/schemas.js';
import { envApply, envDiff } from '../src/cli/commands/env.js';
import { parseArgs } from '../src/cli/args.js';
import { noopLogger } from '../src/logging/index.js';
import type { CmdDeps } from '../src/cli/deps.js';

// Live bug (Coolify 4.5.0, langfuse): REDIS_AUTH had a production AND a preview row. `env apply`
// wrote the production row (correct — a bulk item without is_preview only touches production),
// then reported "confirmation mismatch" and `env diff` kept showing `updates: REDIS_AUTH`, because
// planning and confirmation folded both scopes into one key.
const fixture = (): EnvVar[] => BulkResponseSchema.parse(JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/coolify/v4.5/envs-prod-and-preview.json', import.meta.url)), 'utf8'),
));

/**
 * Mimics Coolify 4.5's PATCH …/envs/bulk handler: `is_preview` picks the relation
 * (environment_variables vs environment_variables_preview), then `where('key')->first()` is
 * updated, else a row is created in that scope.
 */
function fakeCoolify(initial: EnvVar[]) {
  let rows = initial.map((r) => ({ ...r }));
  let n = 0;
  return {
    rows: () => rows,
    listEnvs: vi.fn(async () => rows.map((r) => ({ ...r }))),
    upsertEnvs: vi.fn(async (items: EnvWriteItem[]) => {
      for (const item of items) {
        const preview = item.is_preview ?? false;
        const hit = rows.find((r) => r.key === item.key && r.is_preview === preview);
        if (hit) hit.value = item.value;
        else rows = [...rows, { ...rows[0]!, uuid: `new-${n += 1}`, key: item.key, value: item.value, is_preview: preview }];
      }
      return rows;
    }),
  };
}

let out: string[];
const realOut = process.stdout.write.bind(process.stdout);
beforeEach(() => { out = []; process.stdout.write = ((c: string | Uint8Array) => { out.push(String(c)); return true; }) as typeof process.stdout.write; });
afterEach(() => { process.stdout.write = realOut; });

function deps(api: ReturnType<typeof fakeCoolify>): CmdDeps {
  return {
    resolveTargetFor: () => ({ instanceUrl: 'https://c', kind: 'application', uuid: 'app-1', token: 't' }),
    clientFactory: () => api as unknown as ReturnType<CmdDeps['clientFactory']>,
    actor: 'test', auditSink: vi.fn().mockResolvedValue(undefined), now: () => new Date('2026-10-26T00:00:00Z'),
  };
}

describe('env scope: production vs preview rows of the same key', () => {
  it('plans against production rows only and reports the differing preview row separately', () => {
    const plan = planEnvWrite(fixture(), { values: { REDIS_AUTH: 'new-value', NODE_ENV: 'production' } });
    expect(plan.scope).toBe('production');
    expect(plan.updates).toEqual([{ key: 'REDIS_AUTH', value: 'new-value' }]); // no is_preview: production
    expect(plan.unchanged).toEqual(['NODE_ENV']);
    expect(plan.warnings).toEqual([]); // a prod+preview pair is not a duplicate
    expect(plan.otherScope).toEqual([{ key: 'REDIS_AUTH', scope: 'preview' }]);
  });

  it('reproduces the live sequence: apply confirms, and the follow-up diff is clean', async () => {
    const api = fakeCoolify(fixture());
    await envApply(parseArgs(['env', 'apply', '--app', 'langfuse', '--set', 'REDIS_AUTH=new-value', '--apply']), deps(api));
    expect(out.join('')).toContain('Applied and confirmed.');
    expect(api.rows().find((r) => r.is_preview)!.value).toBe('old-preview-fixture'); // preview untouched

    out = [];
    await envDiff(parseArgs(['env', 'diff', '--app', 'langfuse', '--set', 'REDIS_AUTH=new-value']), deps(api));
    const diff = out.join('');
    expect(diff).toContain('updates: (none)');
    expect(diff).toContain('not written (preview row differs): REDIS_AUTH — re-run with --preview');
  });

  it('--preview writes and confirms the preview row only', async () => {
    const api = fakeCoolify(fixture());
    await envApply(parseArgs(['env', 'apply', '--app', 'langfuse', '--set', 'REDIS_AUTH=new-value', '--preview', '--apply']), deps(api));
    expect(api.upsertEnvs).toHaveBeenCalledWith([{ key: 'REDIS_AUTH', value: 'new-value', is_preview: true }]);
    expect(out.join('')).toContain('Applied and confirmed.');
    expect(api.rows().find((r) => r.key === 'REDIS_AUTH' && !r.is_preview)!.value).toBe('old-prod-fixture');
  });

  it('creates a preview-only key in preview scope', () => {
    const plan = planEnvWrite(fixture(), { values: { NEW_KEY: 'x' }, scope: 'preview' });
    expect(plan.creates).toEqual([{ key: 'NEW_KEY', value: 'x', is_preview: true }]);
  });

  it('still flags a real same-scope duplicate: Coolify updates only one row, so confirmation fails honestly', async () => {
    const rows = fixture();
    const dup = [...rows, { ...rows[0]!, uuid: 'env-redis-prod-2', value: 'stale' }];
    const plan = planEnvWrite(dup, { values: { REDIS_AUTH: 'new-value' } });
    expect(plan.warnings[0]!.message).toMatch(/updates only one of them.*env delete/);
    const api = fakeCoolify(dup);
    const result = await applyEnvWrite(plan, {
      client: api, logger: noopLogger(), target: { instanceUrl: 'https://c', kind: 'application', uuid: 'app-1' },
      actor: 't', writeAudit: vi.fn().mockResolvedValue(undefined),
    });
    expect(result.confirmed).toBe(false);
    expect(result.audit.options).toEqual({ scope: 'production' });
  });
});
