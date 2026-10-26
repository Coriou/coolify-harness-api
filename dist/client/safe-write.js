function groupByKey(current) {
    const map = new Map();
    for (const row of current) {
        const existing = map.get(row.key);
        if (existing)
            existing.push(row);
        else
            map.set(row.key, [row]);
    }
    return map;
}
const scopeOf = (row) => (row.is_preview ? 'preview' : 'production');
function withFlags(key, value, desired) {
    const flags = desired.flags?.[key];
    const item = flags ? { key, value, ...flags } : { key, value };
    // Production items omit is_preview (Coolify defaults it to false); preview items must carry it.
    return desired.scope === 'preview' ? { ...item, is_preview: true } : item;
}
export function planEnvWrite(current, desired) {
    const scope = desired.scope ?? 'production';
    // Compare only rows of the scope being written: a preview row of the same key is a different
    // variable to Coolify, and folding it in made a correct production write look like a mismatch
    // forever (the bulk write never touches it).
    const byKey = groupByKey(current.filter((r) => scopeOf(r) === scope));
    const otherByKey = groupByKey(current.filter((r) => scopeOf(r) !== scope));
    const creates = [];
    const updates = [];
    const unchanged = [];
    const duplicateKeyDrift = [];
    const warnings = [];
    // Surface ALL duplicate-key drift, write or not. Drift identity is (key, is_preview): a prod
    // row and a preview row may legitimately share a key with different values, so they are NOT
    // drift. Only two rows in the SAME scope with the same key but differing values are drift.
    const byScopedKey = new Map();
    for (const row of current) {
        const id = `${row.is_preview ? 'preview' : 'prod'} ${row.key}`;
        const entry = byScopedKey.get(id);
        if (entry)
            entry.values.push(row.value);
        else
            byScopedKey.set(id, { key: row.key, values: [row.value] });
    }
    for (const { key, values } of byScopedKey.values()) {
        if (values.length > 1 && new Set(values).size > 1) {
            duplicateKeyDrift.push({ key, values });
        }
    }
    const otherScope = [];
    for (const [key, value] of Object.entries(desired.values)) {
        const other = otherByKey.get(key);
        if (other && other.some((r) => r.value !== value)) {
            otherScope.push({ key, scope: scope === 'production' ? 'preview' : 'production' });
        }
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
                // Coolify's bulk handler updates `->where('key', …)->first()`: only ONE of the duplicate
                // rows changes, so confirmation will report a mismatch until the extras are deleted.
                message: `Key '${key}' has ${rows.length} ${scope} rows; the bulk write updates only one of them — remove the extras with \`env delete\` and re-apply`,
            });
        }
        updates.push(withFlags(key, value, desired));
    }
    return { scope, otherScope, creates, updates, unchanged, duplicateKeyDrift, lockedSkips: [], warnings };
}
export const EMPTY_PLAN = {
    creates: [], updates: [], unchanged: [], duplicateKeyDrift: [], lockedSkips: [], warnings: [],
};
export function buildAuditRecord(args) {
    const plan = args.plan ?? EMPTY_PLAN;
    const base = {
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
export async function applyEnvWrite(plan, deps) {
    const now = (deps.now ?? (() => new Date()))();
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
    try {
        await deps.client.upsertEnvs(items);
        const after = await deps.client.listEnvs();
        // Confirm against the written scope only, and require EVERY row of the key in that scope to
        // hold the value (a surviving duplicate is a real mismatch).
        const scope = plan.scope ?? 'production';
        const inScope = groupByKey(after.filter((e) => scopeOf(e) === scope));
        const confirmed = items.every((i) => {
            const rows = inScope.get(i.key) ?? [];
            return rows.length > 0 && rows.every((r) => r.value === i.value);
        });
        const audit = buildAuditRecord({
            now, actor: deps.actor, target: deps.target, action: 'env.apply', plan, options: { scope: plan.scope ?? 'production' },
            keysAffected, outcome: 'success',
        });
        deps.logger.info('coolify.env.apply', { action: 'env.apply', keysAffected, confirmed });
        await deps.writeAudit(audit);
        return { applied: items, confirmed, audit };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const audit = buildAuditRecord({
            now, actor: deps.actor, target: deps.target, action: 'env.apply', plan, options: { scope: plan.scope ?? 'production' },
            keysAffected, outcome: 'failure', error: message,
        });
        deps.logger.error('coolify.env.apply.failed', { action: 'env.apply', keysAffected, error: message });
        await deps.writeAudit(audit);
        throw err;
    }
}
