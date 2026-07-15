import { describe, it, expect } from 'vitest';
import { planEnvWrite } from '../src/client/safe-write.js';
import type { EnvVar } from '../src/client/schemas.js';

const ev = (key: string, value: string, uuid = key): EnvVar => ({
  uuid, key, value, is_preview: false, is_build_time: false, is_literal: false,
  is_multiline: false, is_shown_once: false,
});

// Like ev(), but lets a test set is_preview to exercise prod/preview drift identity (Bug 3).
const evp = (key: string, value: string, is_preview: boolean, uuid = `${key}:${String(is_preview)}`): EnvVar => ({
  uuid, key, value, is_preview, is_build_time: false, is_literal: false,
  is_multiline: false, is_shown_once: false,
});

describe('planEnvWrite', () => {
  it('classifies creates / updates / unchanged', () => {
    const current = [ev('A', '1'), ev('B', '2')];
    const plan = planEnvWrite(current, { values: { A: '1', B: '9', C: '3' } });
    expect(plan.unchanged).toEqual(['A']);
    expect(plan.updates).toEqual([{ key: 'B', value: '9' }]);
    expect(plan.creates).toEqual([{ key: 'C', value: '3' }]);
  });

  it('detects duplicate-key drift even for keys not being written', () => {
    const current = [ev('A', '1', 'u1'), ev('A', '2', 'u2'), ev('B', '5')];
    const plan = planEnvWrite(current, { values: { B: '5' } });
    expect(plan.duplicateKeyDrift).toEqual([{ key: 'A', values: ['1', '2'] }]);
  });

  it('repairs duplicate-key drift on write by setting all copies to the same value', () => {
    const current = [ev('A', '1', 'u1'), ev('A', '2', 'u2')];
    const plan = planEnvWrite(current, { values: { A: '7' } });
    expect(plan.updates).toEqual([{ key: 'A', value: '7' }]);
    expect(plan.warnings.some((w) => w.kind === 'duplicate-key-repair')).toBe(true);
  });

  it('threads flag overrides into the write item', () => {
    const plan = planEnvWrite([], { values: { K: 'pem' }, flags: { K: { is_multiline: true } } });
    expect(plan.creates).toEqual([{ key: 'K', value: 'pem', is_multiline: true }]);
  });

  // Bug 3: duplicate-key drift identity must include is_preview. A prod row and a preview row can
  // legitimately share a key with different values; that is not drift.
  it('does NOT flag a legit prod/preview pair (same key, different is_preview) as drift', () => {
    const current = [evp('API_URL', 'https://prod', false), evp('API_URL', 'https://preview', true)];
    const plan = planEnvWrite(current, { values: {} });
    expect(plan.duplicateKeyDrift).toEqual([]);
  });

  it('still flags true drift within the SAME scope (two prod rows, differing values)', () => {
    const current = [evp('SECRET', 'a', false, 'u1'), evp('SECRET', 'b', false, 'u2')];
    const plan = planEnvWrite(current, { values: {} });
    expect(plan.duplicateKeyDrift).toEqual([{ key: 'SECRET', values: ['a', 'b'] }]);
  });

  it('flags drift for a same-scope preview pair but not across scopes', () => {
    const current = [
      evp('K', 'p1', true, 'u1'), // preview
      evp('K', 'p2', true, 'u2'), // preview (conflicts with the other preview row)
      evp('K', 'prod', false, 'u3'), // prod (single in its scope — not drift)
    ];
    const plan = planEnvWrite(current, { values: {} });
    expect(plan.duplicateKeyDrift).toEqual([{ key: 'K', values: ['p1', 'p2'] }]);
  });
});
