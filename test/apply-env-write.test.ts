import { describe, it, expect, vi } from 'vitest';
import { applyEnvWrite } from '../src/client/safe-write.js';
import { noopLogger } from '../src/logging/index.js';
import type { EnvVar } from '../src/client/schemas.js';
import type { EnvWritePlan } from '../src/client/safe-write.js';

const ev = (key: string, value: string): EnvVar => ({
  uuid: key, key, value, is_preview: false, is_build_time: false, is_literal: false,
  is_multiline: false, is_shown_once: false,
});

const plan: EnvWritePlan = {
  creates: [{ key: 'C', value: '3' }],
  updates: [{ key: 'B', value: '9' }],
  unchanged: ['A'], duplicateKeyDrift: [], lockedSkips: [], warnings: [],
};

describe('applyEnvWrite', () => {
  it('upserts creates+updates, re-reads to confirm, and writes a keys-only audit', async () => {
    const upsertEnvs = vi.fn().mockResolvedValue([]);
    const listEnvs = vi.fn().mockResolvedValue([ev('A', '1'), ev('B', '9'), ev('C', '3')]);
    const writeAudit = vi.fn().mockResolvedValue(undefined);
    const result = await applyEnvWrite(plan, {
      client: { upsertEnvs, listEnvs },
      logger: noopLogger(),
      target: { instanceUrl: 'https://c', kind: 'application', uuid: 'app-1' },
      actor: 'ci', writeAudit, now: () => new Date('2026-06-17T00:00:00Z'),
    });
    expect(upsertEnvs).toHaveBeenCalledWith([{ key: 'C', value: '3' }, { key: 'B', value: '9' }]);
    expect(result.confirmed).toBe(true);
    expect(result.audit.outcome).toBe('success');
    expect(result.audit.keysAffected.sort()).toEqual(['B', 'C']);
    // values never recorded
    expect(JSON.stringify(result.audit)).not.toContain('"9"');
    expect(writeAudit).toHaveBeenCalledOnce();
  });

  it('writes a failure audit and rethrows on upsert error', async () => {
    const upsertEnvs = vi.fn().mockRejectedValue(new Error('boom'));
    const writeAudit = vi.fn().mockResolvedValue(undefined);
    await expect(
      applyEnvWrite(plan, {
        client: { upsertEnvs, listEnvs: vi.fn() },
        logger: noopLogger(),
        target: { instanceUrl: 'https://c', kind: 'application', uuid: 'app-1' },
        actor: 'ci', writeAudit, now: () => new Date('2026-06-17T00:00:00Z'),
      }),
    ).rejects.toThrow('boom');
    expect(writeAudit.mock.calls[0]![0].outcome).toBe('failure');
  });
});
