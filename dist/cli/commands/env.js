import { readFile as nodeReadFile } from 'fs/promises';
import { z } from 'zod';
import { planEnvWrite, applyEnvWrite } from '../../client/safe-write.js';
import { createLogger } from '../../logging/index.js';
import { CoolifyAuthScopeError, DuplicateKeyDriftError, LockedVarError } from '../../errors/index.js';
import { EXIT } from '../main.js';
import { withScope } from '../scope.js';
import { audited, print, printJson, warn } from '../deps.js';
const defaultReadFile = (path) => nodeReadFile(path, 'utf8');
/** Parse dotenv-style KEY=VALUE text into a record. Ignores blank lines and comments (#). */
export function parseDotenv(text) {
    const result = {};
    for (const rawLine of text.split('\n')) {
        const line = rawLine.replace(/\r$/, ''); // trim trailing CR
        const trimmed = line.trimStart();
        if (trimmed === '' || trimmed.startsWith('#'))
            continue; // blank or comment
        // Strip optional `export ` prefix
        const withoutExport = trimmed.startsWith('export ') ? trimmed.slice(7) : trimmed;
        const eqIdx = withoutExport.indexOf('=');
        if (eqIdx < 0) {
            throw new z.ZodError([{
                    code: 'custom', path: [],
                    message: `Invalid dotenv line (missing '='): ${JSON.stringify(line)}`,
                }]);
        }
        const key = withoutExport.slice(0, eqIdx).trim();
        const value = withoutExport.slice(eqIdx + 1); // preserve internal content; no trim
        result[key] = value;
    }
    return result;
}
async function resolveValues(args, deps) {
    if (!args.fromFile)
        return args.set;
    const fileText = await (deps.readFile ?? defaultReadFile)(args.fromFile);
    const fileValues = parseDotenv(fileText);
    // --set overrides file values for the same key
    return { ...fileValues, ...args.set };
}
/** A diff against withheld values would call every key "changed"; refuse instead. */
function requireValues(current) {
    if (current.some((e) => e.value_hidden)) {
        throw new CoolifyAuthScopeError("Coolify withheld env values: the token lacks 'read:sensitive', so a diff/apply cannot be planned", { requiredScope: 'read:sensitive' });
    }
}
function printPlan(plan, json) {
    if (json) {
        process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
        return;
    }
    process.stdout.write(`scope: ${plan.scope ?? 'production'}\n`);
    process.stdout.write(`creates: ${plan.creates.map((c) => c.key).join(', ') || '(none)'}\n`);
    process.stdout.write(`updates: ${plan.updates.map((u) => u.key).join(', ') || '(none)'}\n`);
    process.stdout.write(`unchanged: ${plan.unchanged.length}\n`);
    if (plan.duplicateKeyDrift.length > 0) {
        process.stdout.write(`DUPLICATE-KEY DRIFT: ${plan.duplicateKeyDrift.map((d) => d.key).join(', ')}\n`);
    }
    for (const w of plan.warnings)
        process.stdout.write(`warning: ${w.message}\n`);
    const other = plan.otherScope ?? [];
    if (other.length > 0) {
        const otherName = other[0].scope;
        process.stdout.write(`not written (${otherName} row differs): ${other.map((o) => o.key).join(', ')} — ${otherName === 'preview' ? 're-run with --preview to update preview rows' : 'drop --preview to update production rows'}\n`);
    }
    process.stdout.write('NOTE: env changes are inert until a separate redeploy.\n');
}
export async function envDiff(args, deps) {
    const target = deps.resolveTargetFor(args);
    const client = deps.clientFactory(target);
    const current = await withScope('read:sensitive', () => client.listEnvs());
    requireValues(current);
    const merged = await resolveValues(args, deps);
    const plan = planEnvWrite(current, { values: merged, scope: args.preview ? 'preview' : 'production' });
    printPlan(plan, args.json);
    if (args.failOnDrift && plan.duplicateKeyDrift.length > 0) {
        throw new DuplicateKeyDriftError('Duplicate-key drift detected', {
            keys: plan.duplicateKeyDrift.map((d) => d.key),
        });
    }
    return EXIT.ok;
}
export async function envApply(args, deps) {
    const target = deps.resolveTargetFor(args);
    const client = deps.clientFactory(target);
    const current = await withScope('read:sensitive', () => client.listEnvs());
    requireValues(current);
    const merged = await resolveValues(args, deps);
    const plan = planEnvWrite(current, { values: merged, scope: args.preview ? 'preview' : 'production' });
    printPlan(plan, args.json);
    if (args.failOnDrift && plan.duplicateKeyDrift.length > 0) {
        throw new DuplicateKeyDriftError('Duplicate-key drift detected', {
            keys: plan.duplicateKeyDrift.map((d) => d.key),
        });
    }
    if (!args.apply) {
        process.stdout.write('Dry-run. Re-run with --apply to write.\n');
        return EXIT.ok;
    }
    const result = await withScope('write', () => applyEnvWrite(plan, {
        client, logger: createLogger({ sink: () => { } }),
        target: { instanceUrl: target.instanceUrl, kind: target.kind, uuid: target.uuid },
        actor: deps.actor, writeAudit: deps.auditSink, ...(deps.now ? { now: deps.now } : {}),
    }));
    process.stdout.write(result.confirmed ? 'Applied and confirmed.\n' : 'Applied (confirmation mismatch — re-check).\n');
    return EXIT.ok;
}
const scopeOf = (e) => (e.is_preview ? 'preview' : 'prod');
const flag = (e, k) => e[k] === true; // reason: passthrough fields (is_runtime, is_coolify, ...) are not in the static type
/** `env list`: keys, scope, flags and value LENGTH only — values are never printed. */
export async function envList(args, deps) {
    const target = deps.resolveTargetFor(args);
    const client = deps.clientFactory(target);
    const rows = await withScope('read', () => client.listEnvs());
    const view = rows
        .map((e) => ({
        uuid: e.uuid,
        key: e.key,
        scope: scopeOf(e),
        value_length: e.value_hidden ? null : e.value.length,
        is_build_time: e.is_build_time,
        is_runtime: flag(e, 'is_runtime'),
        is_literal: e.is_literal,
        is_multiline: e.is_multiline,
        is_shown_once: e.is_shown_once,
        is_coolify: flag(e, 'is_coolify'),
    }))
        .sort((a, b) => a.key.localeCompare(b.key) || a.scope.localeCompare(b.scope));
    if (args.json) {
        printJson(view);
        return EXIT.ok;
    }
    for (const v of view) {
        const flags = ['build_time', 'runtime', 'literal', 'multiline', 'shown_once', 'coolify']
            .filter((f) => v[`is_${f}`] === true); // reason: iterating the boolean flag columns built just above
        print(`${v.key}  [${v.scope}]  len=${v.value_length ?? 'hidden'}${flags.length ? `  ${flags.join(',')}` : ''}  ${v.uuid}`);
    }
    print(`${view.length} variable row(s). Values are never printed${view.some((v) => v.value_length === null) ? '; lengths need read:sensitive' : ''}.`);
    return EXIT.ok;
}
/** True when the compose document still references KEY (`${KEY}`, `$KEY`, `KEY=`, `KEY:` or a bare `- KEY`). */
export function composeReferences(compose, key) {
    const k = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\$\\{?${k}\\b|^\\s*-?\\s*['"]?${k}(\\s*[=:]|['"]?\\s*$)`, 'm').test(compose);
}
/**
 * `env delete`: delete env rows by key. Dry-run unless --apply.
 * Refuses (exit 6, LockedVarError) when a key is Coolify-managed (`is_coolify`) or still referenced
 * by the resource's docker-compose — Coolify would re-create such a row on its next parse, so the
 * delete would silently not stick. Remove the reference first (`compose set`) or pass --force.
 */
export async function envDelete(args, deps) {
    if (args.keys.length === 0) {
        warn('env delete: at least one --key <KEY> is required');
        return EXIT.usage;
    }
    const target = deps.resolveTargetFor(args);
    const client = deps.clientFactory(target);
    const rows = await withScope('read', () => client.listEnvs());
    const wantScope = args.preview ? 'preview' : 'prod';
    const matches = rows.filter((e) => args.keys.includes(e.key) && scopeOf(e) === wantScope);
    const missing = args.keys.filter((k) => !matches.some((e) => e.key === k));
    let compose;
    if (target.kind === 'service')
        compose = (await withScope('read', () => client.getService())).docker_compose_raw;
    else if (target.kind === 'application') {
        const app = await withScope('read', () => client.get());
        if (app.build_pack === 'dockercompose')
            compose = app.docker_compose_raw;
    }
    const locked = [...new Set(matches.filter((e) => flag(e, 'is_coolify') || (compose ? composeReferences(compose, e.key) : false)).map((e) => e.key))];
    const plan = { scope: wantScope, delete: matches.map((e) => ({ key: e.key, uuid: e.uuid })), notFound: missing, locked };
    if (args.json)
        printJson({ dryRun: !args.apply, ...plan });
    else {
        for (const m of plan.delete)
            print(`delete: ${m.key} [${wantScope}] ${m.uuid}`);
        for (const k of missing)
            print(`not found [${wantScope}]: ${k}`);
        for (const k of locked)
            print(`LOCKED: ${k} is Coolify-managed or still referenced by the compose file`);
    }
    if (matches.length === 0) {
        warn(`env delete: no ${wantScope} rows match ${args.keys.join(', ')}`);
        return EXIT.usage;
    }
    if (locked.length > 0 && !args.force) {
        throw new LockedVarError(`Refusing to delete ${locked.join(', ')}: Coolify would re-create ${locked.length > 1 ? 'them' : 'it'} on the next compose parse. Remove the reference from the compose first (compose set), or pass --force.`, { key: locked[0] });
    }
    if (!args.apply) {
        if (!args.json)
            print('Dry-run. Re-run with --apply to delete. NOTE: a running container keeps its env until redeploy/restart.');
        return EXIT.ok;
    }
    const keysAffected = [...new Set(matches.map((e) => e.key))];
    await audited(deps, {
        instanceUrl: target.instanceUrl, kind: target.kind, uuid: target.uuid, action: 'env.delete', keysAffected,
        options: { scope: wantScope, rows: matches.length, ...(args.force ? { force: true } : {}) },
    }, () => withScope('write', async () => {
        for (const m of matches)
            await client.deleteEnv(m.uuid);
    }));
    const after = await withScope('read', () => client.listEnvs());
    const remaining = after.filter((e) => matches.some((m) => m.uuid === e.uuid));
    if (!args.json) {
        print(remaining.length === 0 ? `Deleted ${matches.length} row(s) and confirmed.` : `Deleted, but ${remaining.length} row(s) still listed — re-check.`);
        print('NOTE: env changes are inert until a separate redeploy / restart.');
    }
    return EXIT.ok;
}
