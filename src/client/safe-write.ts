import type { EnvVar, EnvWriteItem } from './schemas.js';
import type { Logger } from '../logging/index.js';
import type { CoolifyClient } from './coolify.js';

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

export interface AuditRecord {
  ts: string;
  actor: string;
  instanceUrl: string;
  resourceKind: 'application' | 'service';
  resourceUuid: string;
  action: 'env.apply' | 'deploy' | 'restart';
  planSummary: { creates: number; updates: number; unchanged: number; duplicateKeyDrift: number };
  keysAffected: string[];
  outcome: 'success' | 'failure';
  error?: string;
}

export interface EnvWriteResult {
  applied: EnvWriteItem[];
  confirmed: boolean;
  audit: AuditRecord;
}

export interface ApplyDeps {
  client: Pick<CoolifyClient, 'upsertEnvs' | 'listEnvs'>;
  logger: Logger;
  target: { instanceUrl: string; kind: 'application' | 'service'; uuid: string };
  actor: string;
  writeAudit: (record: AuditRecord) => Promise<void>;
  now?: () => Date;
}

export function buildAuditRecord(args: {
  now: Date;
  actor: string;
  target: ApplyDeps['target'];
  action: AuditRecord['action'];
  plan: EnvWritePlan;
  keysAffected: string[];
  outcome: AuditRecord['outcome'];
  error?: string;
}): AuditRecord {
  const base: AuditRecord = {
    ts: args.now.toISOString(),
    actor: args.actor,
    instanceUrl: args.target.instanceUrl,
    resourceKind: args.target.kind,
    resourceUuid: args.target.uuid,
    action: args.action,
    planSummary: {
      creates: args.plan.creates.length,
      updates: args.plan.updates.length,
      unchanged: args.plan.unchanged.length,
      duplicateKeyDrift: args.plan.duplicateKeyDrift.length,
    },
    keysAffected: args.keysAffected,
    outcome: args.outcome,
  };
  return args.error === undefined ? base : { ...base, error: args.error };
}

export async function applyEnvWrite(plan: EnvWritePlan, deps: ApplyDeps): Promise<EnvWriteResult> {
  const now = (deps.now ?? ((): Date => new Date()))();
  const items = [...plan.creates, ...plan.updates];
  const keysAffected = items.map((i) => i.key);

  if (items.length === 0) {
    const audit = buildAuditRecord({
      now, actor: deps.actor, target: deps.target, action: 'env.apply', plan,
      keysAffected: [], outcome: 'success',
    });
    deps.logger.info('coolify.env.apply', { action: 'env.apply', keysAffected: [] });
    await deps.writeAudit(audit);
    return { applied: [], confirmed: true, audit };
  }

  try {
    await deps.client.upsertEnvs(items);
    const after = await deps.client.listEnvs();
    const byKey = new Map(after.map((e) => [e.key, e.value]));
    const confirmed = items.every((i) => byKey.get(i.key) === i.value);
    const audit = buildAuditRecord({
      now, actor: deps.actor, target: deps.target, action: 'env.apply', plan,
      keysAffected, outcome: 'success',
    });
    deps.logger.info('coolify.env.apply', { action: 'env.apply', keysAffected, confirmed });
    await deps.writeAudit(audit);
    return { applied: items, confirmed, audit };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const audit = buildAuditRecord({
      now, actor: deps.actor, target: deps.target, action: 'env.apply', plan,
      keysAffected, outcome: 'failure', error: message,
    });
    deps.logger.error('coolify.env.apply.failed', { action: 'env.apply', keysAffected, error: message });
    await deps.writeAudit(audit);
    throw err;
  }
}
