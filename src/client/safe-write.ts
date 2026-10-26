import type { EnvVar, EnvWriteItem } from './schemas.js';
import type { Logger } from '../logging/index.js';
import type { CoolifyClient } from './coolify.js';

// Only the flags Coolify accepts on the WRITE path. Build-time is intentionally absent: it is
// not settable via the env-write API (the server 422s on it). See EnvWriteItemSchema.
export interface EnvFlags {
  is_preview: boolean;
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

  // Surface ALL duplicate-key drift, write or not. Drift identity is (key, is_preview): a prod
  // row and a preview row may legitimately share a key with different values, so they are NOT
  // drift. Only two rows in the SAME scope with the same key but differing values are drift.
  const byScopedKey = new Map<string, { key: string; values: string[] }>();
  for (const row of current) {
    const id = `${row.is_preview ? 'preview' : 'prod'} ${row.key}`;
    const entry = byScopedKey.get(id);
    if (entry) entry.values.push(row.value);
    else byScopedKey.set(id, { key: row.key, values: [row.value] });
  }
  for (const { key, values } of byScopedKey.values()) {
    if (values.length > 1 && new Set(values).size > 1) {
      duplicateKeyDrift.push({ key, values });
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

export type AuditResourceKind = 'application' | 'service' | 'database' | 'server' | 'deployment';

export type AuditAction =
  | 'env.apply' | 'env.delete'
  | 'deploy' | 'restart'
  | 'compose.update'
  | 'proxy.configuration' | 'proxy.restart'
  | 'database.update' | 'database.backup'
  | 'deployment.cancel';

export interface AuditRecord {
  ts: string;
  actor: string;
  instanceUrl: string;
  resourceKind: AuditResourceKind;
  resourceUuid: string;
  action: AuditAction;
  planSummary: { creates: number; updates: number; unchanged: number; duplicateKeyDrift: number };
  /** Env keys or field names touched — never their values. */
  keysAffected: string[];
  /** Non-secret switches of the call (e.g. force, latest, an image reference). Never env/compose values. */
  options?: Record<string, string | number | boolean>;
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
  target: { instanceUrl: string; kind: AuditResourceKind; uuid: string };
  actor: string;
  writeAudit: (record: AuditRecord) => Promise<void>;
  now?: () => Date;
}

export const EMPTY_PLAN: EnvWritePlan = {
  creates: [], updates: [], unchanged: [], duplicateKeyDrift: [], lockedSkips: [], warnings: [],
};

export function buildAuditRecord(args: {
  now: Date;
  actor: string;
  target: ApplyDeps['target'];
  action: AuditRecord['action'];
  plan?: EnvWritePlan;
  keysAffected: string[];
  options?: Record<string, string | number | boolean>;
  outcome: AuditRecord['outcome'];
  error?: string;
}): AuditRecord {
  const plan = args.plan ?? EMPTY_PLAN;
  const base: AuditRecord = {
    ts: args.now.toISOString(),
    actor: args.actor,
    instanceUrl: args.target.instanceUrl,
    resourceKind: args.target.kind,
    resourceUuid: args.target.uuid,
    action: args.action,
    planSummary: {
      creates: plan.creates.length,
      updates: plan.updates.length,
      unchanged: plan.unchanged.length,
      duplicateKeyDrift: plan.duplicateKeyDrift.length,
    },
    keysAffected: args.keysAffected,
    ...(args.options !== undefined ? { options: args.options } : {}),
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
