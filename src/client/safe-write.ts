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

export type EnvScope = 'production' | 'preview';

export interface DesiredEnv {
  values: Record<string, string>;
  flags?: Record<string, Partial<EnvFlags>>;
  /**
   * Which rows to compare and write. Coolify keeps production and preview-deployment rows of the
   * same key apart: a bulk item without `is_preview` updates or creates only the production row,
   * one with `is_preview: true` only the preview row. Default: 'production'.
   */
  scope?: EnvScope;
}

/** A key being written whose row in the OTHER scope holds a different value (left untouched). */
export interface OtherScopeDifference {
  key: string;
  scope: EnvScope;
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
  /** Scope the plan compares and writes (absent = production, for plans built by hand). */
  readonly scope?: EnvScope;
  /** Keys whose other-scope row differs from the desired value; reported, never written. */
  readonly otherScope?: OtherScopeDifference[];
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

const scopeOf = (row: EnvVar): EnvScope => (row.is_preview ? 'preview' : 'production');

/** What PHP's `trim()` removes (Coolify's side): space, tab, newline, CR, NUL, vertical tab. */
const phpTrim = (v: string): string => v.replace(/^[ \t\n\r\0\x0B]+|[ \t\n\r\0\x0B]+$/g, '');

/**
 * Would Coolify store `desired` as `stored`? Coolify 4.7 trims a value on save unless its trimmed
 * form spans several lines (a PEM keeps its final newline); 4.5 trimmed everything. Comparing raw
 * made ` x ` an update on every run. A multi-line value is compared exactly: its edge whitespace
 * is real on 4.7 (on 4.5 such a value with a trailing newline never converges).
 */
const sameValue = (stored: string, desired: string): boolean => {
  if (stored === desired) return true;
  const trimmed = phpTrim(desired);
  return !trimmed.includes('\n') && phpTrim(stored) === trimmed;
};

/** A row whose value Coolify never returns: locked (`is_shown_once`), whatever the token can read. */
export const isLockedRow = (row: EnvVar): boolean => row.value_hidden === true && row.is_shown_once;

/**
 * Build the bulk item for one key. On an UPDATE, flags the row has SET (`is_literal`,
 * `is_multiline`, a lock) are sent back explicitly: Coolify 4.5's bulk handler reset every flag
 * the request left out (a value-only update silently turned a multiline or literal variable into
 * a plain one, and unlocked a locked one). Coolify 4.7 keeps omitted flags, where sending them is
 * a no-op; a flag that is off needs nothing on either version. Flags passed in `desired.flags`
 * always win.
 */
function withFlags(key: string, value: string, desired: DesiredEnv, existing?: EnvVar): EnvWriteItem {
  const kept: Partial<EnvFlags> = {
    ...(existing?.is_literal ? { is_literal: true } : {}),
    ...(existing?.is_multiline ? { is_multiline: true } : {}),
    ...(existing?.is_shown_once ? { is_shown_once: true } : {}),
  };
  const item: EnvWriteItem = { key, value, ...kept, ...desired.flags?.[key] };
  // Production items omit is_preview (Coolify defaults it to false); preview items must carry it.
  if (desired.scope === 'preview') return { ...item, is_preview: true };
  const { is_preview: _dropped, ...production } = item;
  return production;
}

export function planEnvWrite(current: EnvVar[], desired: DesiredEnv): EnvWritePlan {
  const scope = desired.scope ?? 'production';
  // Compare only rows of the scope being written: a preview row of the same key is a different
  // variable to Coolify, and folding it in made a correct production write look like a mismatch
  // forever (the bulk write never touches it).
  const byKey = groupByKey(current.filter((r) => scopeOf(r) === scope));
  const otherByKey = groupByKey(current.filter((r) => scopeOf(r) !== scope));
  const creates: EnvWriteItem[] = [];
  const updates: EnvWriteItem[] = [];
  const unchanged: string[] = [];
  const duplicateKeyDrift: DuplicateKeyDrift[] = [];
  const warnings: PlanWarning[] = [];

  // Surface ALL duplicate-key drift, write or not. Drift identity is (key, is_preview): a prod
  // row and a preview row may legitimately share a key with different values, so they are NOT
  // drift. Only two rows in the SAME scope with the same key but differing values are drift.
  // Rows whose value Coolify withheld are left out: an unknown value is not a different value.
  const byScopedKey = new Map<string, { key: string; values: string[] }>();
  for (const row of current) {
    if (row.value_hidden === true) continue;
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

  const otherScope: OtherScopeDifference[] = [];
  for (const [key, value] of Object.entries(desired.values)) {
    const other = otherByKey.get(key);
    if (value !== phpTrim(value) && !phpTrim(value).includes('\n')) {
      warnings.push({ kind: 'trimmed-value', message: `Key '${key}': the value has leading or trailing whitespace, which Coolify removes when it saves` });
    }
    if (other && other.some((r) => r.value_hidden !== true && !sameValue(r.value, value))) {
      otherScope.push({ key, scope: scope === 'production' ? 'preview' : 'production' });
    }
    const rows = byKey.get(key);
    const first = rows?.[0];
    if (!rows || !first) {
      creates.push(withFlags(key, value, desired));
      continue;
    }
    if (rows.length > 1) {
      warnings.push({
        kind: 'duplicate-key-repair',
        // Coolify's bulk handler updates `->where('key', …)->first()`: only ONE of the duplicate
        // rows changes, so confirmation will report a mismatch until the extras are deleted.
        message: `Key '${key}' has ${rows.length} ${scope} rows; the bulk write updates only one of them — remove the extras with \`env delete\` and re-apply`,
      });
    }
    if (rows.some(isLockedRow)) {
      warnings.push({
        kind: 'locked-value',
        message: `Key '${key}' is locked (shown once): Coolify never returns its value, so it cannot be compared and is rewritten`,
      });
      updates.push(withFlags(key, value, desired, first));
      continue;
    }
    if (rows.some((r) => r.value_hidden === true)) {
      warnings.push({
        kind: 'hidden-value',
        message: `Key '${key}': Coolify withheld the current value (the token lacks read:sensitive), so it is planned as an update without being compared`,
      });
      updates.push(withFlags(key, value, desired, first));
      continue;
    }
    // Every row already holds the desired value: nothing to write, however many rows there are.
    // (Duplicates with the same value used to be planned as an update on every run, so a diff
    // never came back clean.)
    if (rows.every((r) => sameValue(r.value, value))) {
      unchanged.push(key);
      continue;
    }
    updates.push(withFlags(key, value, desired, first));
  }

  return { scope, otherScope, creates, updates, unchanged, duplicateKeyDrift, lockedSkips: [], warnings };
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
  /** True when a re-read shows every written key holding its value in the written scope. */
  confirmed: boolean;
  audit: AuditRecord;
  /** Set when the write succeeded but the confirmation re-read failed (then `confirmed` is false). */
  confirmError?: string;
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
      now, actor: deps.actor, target: deps.target, action: 'env.apply', plan, options: { scope: plan.scope ?? 'production' },
      keysAffected: [], outcome: 'success',
    });
    deps.logger.info('coolify.env.apply', { action: 'env.apply', keysAffected: [] });
    await deps.writeAudit(audit);
    return { applied: [], confirmed: true, audit };
  }

  const scope = plan.scope ?? 'production';
  try {
    await deps.client.upsertEnvs(items);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const audit = buildAuditRecord({
      now, actor: deps.actor, target: deps.target, action: 'env.apply', plan, options: { scope },
      keysAffected, outcome: 'failure', error: message,
    });
    deps.logger.error('coolify.env.apply.failed', { action: 'env.apply', keysAffected, error: message });
    await deps.writeAudit(audit);
    throw err;
  }

  // The write is done: record it NOW. The confirmation read below can fail, hang or be cut short
  // (a closed pipe, Ctrl-C) and the audit log must not miss a mutation that happened.
  const audit = buildAuditRecord({
    now, actor: deps.actor, target: deps.target, action: 'env.apply', plan, options: { scope },
    keysAffected, outcome: 'success',
  });
  await deps.writeAudit(audit);

  // A failing confirmation read must not turn the write into a "failed" one (an agent would retry
  // or roll back something that landed): report it as applied, not confirmed.
  let confirmed = false;
  let confirmError: string | undefined;
  try {
    const after = await deps.client.listEnvs();
    // Confirm against the written scope only, and require EVERY row of the key in that scope to
    // hold the value (a surviving duplicate is a real mismatch). A locked row never returns its
    // value, so it can only be confirmed to exist; any other unreadable value is not a confirmation.
    const inScope = groupByKey(after.filter((e) => scopeOf(e) === scope));
    confirmed = items.every((i) => {
      const rows = inScope.get(i.key) ?? [];
      return rows.length > 0 && rows.every((r) => (r.value_hidden === true ? isLockedRow(r) : sameValue(r.value, i.value)));
    });
  } catch (err) {
    confirmError = err instanceof Error ? err.message : String(err);
    deps.logger.warn('coolify.env.apply.unconfirmed', { action: 'env.apply', keysAffected, error: confirmError });
  }
  deps.logger.info('coolify.env.apply', { action: 'env.apply', keysAffected, confirmed });
  return confirmError === undefined
    ? { applied: items, confirmed, audit }
    : { applied: items, confirmed, audit, confirmError };
}
