import type { EnvVar, EnvWriteItem } from './schemas.js';

export interface EnvFlags {
  is_preview: boolean;
  is_build_time: boolean;
  is_literal: boolean;
  is_multiline: boolean;
  is_shown_once: boolean;
}

export interface DesiredEnv {
  values: Record<string, string>;
  flags?: Record<string, Partial<EnvFlags>>;
}

export interface DuplicateKeyDrift {
  key: string;
  values: string[];
}

export interface LockedVarSkip {
  key: string;
  reason: string;
}

export interface PlanWarning {
  kind: string;
  message: string;
}

export interface EnvWritePlan {
  readonly creates: EnvWriteItem[];
  readonly updates: EnvWriteItem[];
  readonly unchanged: string[];
  readonly duplicateKeyDrift: DuplicateKeyDrift[];
  readonly lockedSkips: LockedVarSkip[];
  readonly warnings: PlanWarning[];
}

function groupByKey(current: EnvVar[]): Map<string, EnvVar[]> {
  const map = new Map<string, EnvVar[]>();
  for (const row of current) {
    const existing = map.get(row.key);
    if (existing) existing.push(row);
    else map.set(row.key, [row]);
  }
  return map;
}

function withFlags(key: string, value: string, desired: DesiredEnv): EnvWriteItem {
  const flags = desired.flags?.[key];
  return flags ? { key, value, ...flags } : { key, value };
}

export function planEnvWrite(current: EnvVar[], desired: DesiredEnv): EnvWritePlan {
  const byKey = groupByKey(current);
  const creates: EnvWriteItem[] = [];
  const updates: EnvWriteItem[] = [];
  const unchanged: string[] = [];
  const duplicateKeyDrift: DuplicateKeyDrift[] = [];
  const warnings: PlanWarning[] = [];

  // Surface ALL duplicate-key drift, write or not.
  for (const [key, rows] of byKey) {
    if (rows.length > 1) {
      const values = rows.map((r) => r.value);
      if (new Set(values).size > 1) {
        duplicateKeyDrift.push({ key, values });
      }
    }
  }

  for (const [key, value] of Object.entries(desired.values)) {
    const rows = byKey.get(key);
    if (!rows || rows.length === 0) {
      creates.push(withFlags(key, value, desired));
      continue;
    }
    const allSame = rows.every((r) => r.value === value);
    if (allSame && rows.length === 1) {
      unchanged.push(key);
      continue;
    }
    if (rows.length > 1) {
      warnings.push({
        kind: 'duplicate-key-repair',
        message: `Key '${key}' has ${rows.length} upstream rows; writing sets all copies to one value`,
      });
    }
    updates.push(withFlags(key, value, desired));
  }

  return { creates, updates, unchanged, duplicateKeyDrift, lockedSkips: [], warnings };
}
