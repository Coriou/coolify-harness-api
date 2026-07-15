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
function withFlags(key, value, desired) {
    const flags = desired.flags?.[key];
    return flags ? { key, value, ...flags } : { key, value };
}
export function planEnvWrite(current, desired) {
    const byKey = groupByKey(current);
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
export function buildAuditRecord(args) {
    const base = {
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
export async function applyEnvWrite(plan, deps) {
    const now = (deps.now ?? (() => new Date()))();
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
    }
    catch (err) {
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
