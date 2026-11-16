import { readFile as nodeReadFile } from 'node:fs/promises';
import { planEnvWrite, applyEnvWrite, isLockedRow } from '../../client/safe-write.js';
import { createLogger } from '../../logging/index.js';
import { CoolifyAuthScopeError, CoolifyFeatureNotSupportedError, DuplicateKeyDriftError, EnvChangesPendingError, LockedVarError, UsageError, } from '../../errors/index.js';
import { EXIT } from '../exit.js';
import { withScope } from '../scope.js';
import { audited, print, printJson, warn, writeAuditSafely, usageFail } from '../deps.js';
import { describePath, parseDotenv } from '../dotenv.js';
export { parseDotenv } from '../dotenv.js';
const defaultReadFile = (path) => nodeReadFile(path, 'utf8');
/** Coolify 4.7's own rule for env keys (ValidationPatterns::environmentVariableKeyRules). */
const COOLIFY_KEY_RE = /^[A-Za-z_][A-Za-z0-9_.]*$/;
async function resolveValues(args, deps) {
    if (!args.fromFile) {
        requireValidKeys(args, {});
        return args.set;
    }
    let fileText;
    try {
        fileText = await (deps.readFile ?? defaultReadFile)(args.fromFile);
    }
    catch (err) {
        const code = err.code; // reason: probing the optional errno code of an unknown error
        throw new UsageError(`Cannot read --from-file ${describePath(args.fromFile)}${typeof code === 'string' ? ` (${code})` : ''}`);
    }
    const fileValues = parseDotenv(fileText);
    requireValidKeys(args, fileValues);
    // --set overrides file values for the same key
    return { ...fileValues, ...args.set };
}
/**
 * A diff against withheld values would call every key "changed"; refuse instead. A LOCKED row
 * (`is_shown_once`) is different: Coolify never returns its value to anyone, so it is not a scope
 * problem and the plan handles it (rewritten with a warning).
 */
function requireValues(current) {
    if (current.some((e) => e.value_hidden && !isLockedRow(e))) {
        throw new CoolifyAuthScopeError("Coolify withheld env values: the token lacks 'read:sensitive', so a diff/apply cannot be planned", { requiredScope: 'read:sensitive' });
    }
}
/** Services and standalone databases have no preview rows: Coolify would write production instead. */
function scopeFor(args, target) {
    if (args.preview && target.kind !== 'application') {
        throw new CoolifyFeatureNotSupportedError(`--preview only applies to applications: a ${target.kind} has no preview env rows (Coolify would write the production row instead). Drop --preview.`);
    }
    return args.preview ? 'preview' : 'production';
}
/**
 * Refuse a key Coolify would reject, before anything is sent. Coolify validates and writes a bulk
 * request item by item with no transaction: one bad key in the middle left the keys before it
 * written and the whole command reported as failed. The key is not echoed: a "key" that fails
 * this test is often a stray line of a secret (a wrapped base64 value in a dotenv file).
 */
function requireValidKeys(args, fileValues) {
    const invalid = (k) => !COOLIFY_KEY_RE.test(k) || k.length > 255;
    // The tail of a wrapped base64 value (`…Zm9v==`) parses as a "name" with the value `=`: a long
    // mixed-case, digit-bearing name whose value is nothing but `=` is that, not a variable.
    const remnant = (k, v) => /^=*$/.test(v) && k.length >= 16 && /[a-z]/.test(k) && /[A-Z]/.test(k) && /\d/.test(k);
    const badSet = Object.keys(args.set).filter(invalid).length;
    const badFile = Object.entries(fileValues).filter(([k, v]) => invalid(k) || remnant(k, v)).length;
    if (badSet + badFile === 0)
        return;
    const where = [badSet > 0 ? `${badSet} from --set` : '', badFile > 0 ? `${badFile} from ${args.fromFile ?? '--from-file'}` : ''].filter(Boolean).join(', ');
    throw new UsageError(`${badSet + badFile} variable name(s) are not valid (${where}): a name starts with a letter or _, contains only letters, digits, _ and ., and is at most 255 characters — nothing was sent. (Names are not echoed: a multi-line value that is not quoted reads as extra names.)`);
}
function printPlanText(plan) {
    print(`scope: ${plan.scope ?? 'production'}`);
    print(`creates: ${plan.creates.map((c) => c.key).join(', ') || '(none)'}`);
    print(`updates: ${plan.updates.map((u) => u.key).join(', ') || '(none)'}`);
    print(`unchanged: ${plan.unchanged.length}`);
    if (plan.duplicateKeyDrift.length > 0) {
        print(`DUPLICATE-KEY DRIFT: ${plan.duplicateKeyDrift.map((d) => d.key).join(', ')}`);
    }
    for (const w of plan.warnings)
        print(`warning: ${w.message}`);
    const other = plan.otherScope ?? [];
    if (other.length > 0) {
        const otherName = other[0].scope;
        print(`not written (${otherName} row differs): ${other.map((o) => o.key).join(', ')} — ${otherName === 'preview' ? 're-run with --preview to update preview rows' : 'drop --preview to update production rows'}`);
    }
    print('NOTE: env changes are inert until a separate redeploy.');
}
async function buildPlan(args, deps) {
    const target = deps.resolveTargetFor(args);
    const scope = scopeFor(args, target);
    // Read the desired values first: a bad --from-file is a usage error, not worth a request.
    const merged = await resolveValues(args, deps);
    const client = deps.clientFactory(target);
    const current = await withScope('read:sensitive', () => client.listEnvs());
    requireValues(current);
    return { target, client, plan: planEnvWrite(current, { values: merged, scope }) };
}
function failOnDrift(args, plan) {
    if (args.failOnDrift && plan.duplicateKeyDrift.length > 0) {
        throw new DuplicateKeyDriftError('Duplicate-key drift detected', {
            keys: plan.duplicateKeyDrift.map((d) => d.key),
        });
    }
}
/**
 * `env diff`: read-only plan. JSON: the plan, with every value redacted (creates/updates keep
 * their keys and flags; `value` becomes `[REDACTED] (N chars)`).
 * `--fail-on-drift` exits 4 on duplicate-key drift; `--fail-on-changes` exits 4 when anything
 * would be created or updated (a CI / agent "is the live env in sync?" check).
 */
export async function envDiff(args, deps) {
    const { plan } = await buildPlan(args, deps);
    if (args.json)
        printJson(plan);
    else
        printPlanText(plan);
    failOnDrift(args, plan);
    const pending = [...plan.creates, ...plan.updates].map((i) => i.key);
    if (args.failOnChanges && pending.length > 0) {
        throw new EnvChangesPendingError(`${pending.length} key(s) differ from the desired values (--fail-on-changes)`, { keys: pending });
    }
    return EXIT.ok;
}
export async function runEnvApply(args, deps) {
    const { target, client, plan } = await buildPlan(args, deps);
    if (!args.json)
        printPlanText(plan);
    const base = { ...plan };
    if (args.failOnDrift && plan.duplicateKeyDrift.length > 0) {
        if (args.json)
            printJson({ ...base, dryRun: !args.apply, applied: [], confirmed: null });
        failOnDrift(args, plan);
    }
    if (!args.apply) {
        if (!args.json)
            print('Dry-run. Re-run with --apply to write.');
        return { code: EXIT.ok, doc: { ...base, dryRun: true, applied: [], confirmed: null } };
    }
    let result;
    try {
        result = await withScope('write', () => applyEnvWrite(plan, {
            client, logger: createLogger({ sink: () => { } }),
            target: { instanceUrl: target.instanceUrl, kind: target.kind, uuid: target.uuid },
            actor: deps.actor,
            writeAudit: (record) => writeAuditSafely(deps, record),
            ...(deps.now ? { now: deps.now } : {}),
        }));
    }
    catch (err) {
        // Coolify applies a bulk write item by item, with no transaction: when it rejects one, the
        // keys before it are already written. Say so; `env diff` shows where things stand.
        const note = 'Coolify writes a bulk request key by key: keys before the rejected one may have been written. Run `env diff` to see the current state.';
        if (args.json)
            printJson({ ...base, dryRun: false, applied: null, confirmed: null, failed: true, note });
        else if (plan.creates.length + plan.updates.length > 1)
            warn(`env apply failed. ${note}`);
        if (err && typeof err === 'object')
            Object.assign(err, { printed: true });
        throw err;
    }
    if (!args.json) {
        if (result.confirmError !== undefined)
            warn(`WARNING: the write succeeded but could not be re-read: ${result.confirmError}`);
        print(result.applied.length === 0
            ? 'Nothing to write: every key already holds its value.'
            : result.confirmError !== undefined
                ? 'Applied; not confirmed (the re-read failed) — check with `env diff`.'
                : result.confirmed ? 'Applied and confirmed.' : 'Applied (confirmation mismatch — re-check).');
    }
    return {
        code: EXIT.ok,
        doc: {
            ...base,
            dryRun: false,
            applied: result.applied.map((i) => i.key),
            // null = could not be checked (the re-read failed), as for compose / proxy / database set.
            confirmed: result.confirmError !== undefined ? null : result.confirmed,
            ...(result.confirmError !== undefined ? { confirmError: result.confirmError } : {}),
        },
    };
}
/**
 * `env apply`: dry-run unless --apply. With `--json` it prints exactly one document: the plan
 * (values redacted) plus `dryRun`, `applied` (keys) and `confirmed` (null on a dry-run).
 */
export async function envApply(args, deps) {
    const outcome = await runEnvApply(args, deps);
    if (args.json)
        printJson(outcome.doc);
    return outcome.code;
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
        // null = Coolify did not return the value: the token lacks read:sensitive, or the row is
        // locked (`is_shown_once`). A row whose value is JSON null is known and empty: length 0
        // with value_null, never "hidden".
        value_length: e.value_hidden ? null : e.value.length,
        value_null: e.value_null === true,
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
        const len = v.value_length === null
            ? (v.is_shown_once ? 'locked' : 'hidden')
            : `${v.value_length}${v.value_null ? ' (null)' : ''}`;
        print(`${v.key}  [${v.scope}]  len=${len}${flags.length ? `  ${flags.join(',')}` : ''}  ${v.uuid}`);
    }
    const withheld = view.some((v) => v.value_length === null && !v.is_shown_once);
    print(`${view.length} variable row(s). Values are never printed${withheld ? '; lengths need read:sensitive' : ''}.`);
    return EXIT.ok;
}
/**
 * A key the caller typed and that matched nothing, for output: echoed when it reads like a
 * variable name, described otherwise. A long run of lower-case letters and digits (`sk-…`,
 * `glpat-…`, a token pasted after --key) is a value, not a name.
 */
function describeKey(key) {
    const name = /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key);
    const tokenLike = key.length >= 16 && /[a-z]/.test(key) && /\d/.test(key);
    return name && !tokenLike ? key : `<${key.length}-character key>`;
}
/** True when the compose document still references KEY (`${KEY}`, `$KEY`, `KEY=`, `KEY:` or a bare `- KEY`). */
export function composeReferences(compose, key) {
    const k = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // `[ \t]*` rather than `\s*`: with the `m` flag `\s` also eats line breaks, and a run of blank
    // lines was re-scanned from each of them.
    return new RegExp(`\\$\\{?${k}\\b|^[ \\t]*(?:-[ \\t]*)?['"]?${k}([ \\t]*[=:]|['"]?[ \\t]*$)`, 'm').test(compose);
}
/**
 * `env delete`: delete env rows by key. Dry-run unless --apply.
 * Refuses (exit 6, LockedVarError) when a key is Coolify-managed (`is_coolify`) or still referenced
 * by the resource's docker-compose — Coolify would re-create such a row on its next parse, so the
 * delete would silently not stick. Remove the reference first (`compose set`) or pass --force.
 * With `--json` it prints one document: the plan, then (after --apply) `deleted` and `confirmed`.
 */
export async function envDelete(args, deps) {
    if (args.keys.length === 0) {
        return usageFail(args, 'env delete: at least one --key <KEY> is required');
    }
    // `--key NAME=value` cannot be a key, and would be echoed back as "not found". A key that
    // merely breaks today's naming rule may still exist (rows created by older Coolify versions):
    // it is looked up like any other.
    const impossible = args.keys.filter((k) => k.includes('=') || /\s/.test(k) || k.length > 255).length;
    if (impossible > 0) {
        return usageFail(args, `env delete: ${impossible} --key value(s) cannot be variable names (they hold \`=\` or a blank, or exceed 255 characters). Pass the name only. Not echoed: they may be secret.`);
    }
    const target = deps.resolveTargetFor(args);
    scopeFor(args, target);
    const client = deps.clientFactory(target);
    const rows = await withScope('read', () => client.listEnvs());
    const wantScope = args.preview ? 'preview' : 'prod';
    const matches = rows.filter((e) => args.keys.includes(e.key) && scopeOf(e) === wantScope);
    // A key that was not found is echoed only when it reads like a name: it is what the caller
    // typed, and a secret pasted after --key must not come back in the output.
    const missing = args.keys.filter((k) => !matches.some((e) => e.key === k)).map(describeKey);
    // The compose is only needed to decide whether a MATCHED row would be re-created.
    let compose;
    let composeExpected = false;
    if (matches.length > 0) {
        if (target.kind === 'service') {
            composeExpected = true;
            compose = (await withScope('read', () => client.getService())).docker_compose_raw;
        }
        else if (target.kind === 'application') {
            const app = await withScope('read', () => client.get());
            if (app.build_pack === 'dockercompose') {
                composeExpected = true;
                compose = app.docker_compose_raw;
            }
        }
    }
    // Coolify only returns the compose to a read:sensitive token of a team admin/owner. Without it
    // the lock check cannot run: refuse rather than delete a row Coolify would silently re-create.
    if (composeExpected && compose == null && !args.force) {
        throw new CoolifyAuthScopeError("Coolify withheld the docker-compose document (the token needs 'read:sensitive' and a team admin/owner user), so env delete cannot check whether the compose still references the key. Use such a token, or pass --force to delete without the check.", { requiredScope: 'read:sensitive' });
    }
    const locked = [...new Set(matches.filter((e) => flag(e, 'is_coolify') || (compose ? composeReferences(compose, e.key) : false)).map((e) => e.key))];
    const plan = { scope: wantScope, delete: matches.map((e) => ({ key: e.key, uuid: e.uuid })), notFound: missing, locked };
    const willDelete = args.apply && matches.length > 0 && (locked.length === 0 || args.force);
    if (!args.json) {
        for (const m of plan.delete)
            print(`delete: ${m.key} [${wantScope}] ${m.uuid}`);
        for (const k of missing)
            print(`not found [${wantScope}]: ${k}`);
        for (const k of locked)
            print(`LOCKED: ${k} is Coolify-managed or still referenced by the compose file`);
    }
    else if (!willDelete) {
        printJson({ dryRun: !args.apply, ...plan });
    }
    if (matches.length === 0) {
        return usageFail(args, `env delete: no ${wantScope} rows match ${missing.join(', ')}`);
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
    let deleted = 0;
    try {
        await audited(deps, {
            instanceUrl: target.instanceUrl, kind: target.kind, uuid: target.uuid, action: 'env.delete', keysAffected,
            options: { scope: wantScope, rows: matches.length, ...(args.force ? { force: true } : {}) },
        }, () => withScope('delete', async () => {
            for (const m of matches) {
                await client.deleteEnv(m.uuid);
                deleted += 1;
            }
        }));
    }
    catch (err) {
        // Rows deleted before the failure are gone: say how many, so the caller does not assume none.
        if (args.json)
            printJson({ dryRun: false, ...plan, deleted, confirmed: null, failed: true });
        else if (deleted > 0)
            warn(`env delete: ${deleted} of ${matches.length} row(s) were deleted before the failure below.`);
        throw err;
    }
    let confirmed = null;
    let confirmError;
    let remaining = 0;
    try {
        const after = await withScope('read', () => client.listEnvs());
        remaining = after.filter((e) => matches.some((m) => m.uuid === e.uuid)).length;
        confirmed = remaining === 0;
    }
    catch (err) {
        confirmError = err instanceof Error ? err.message : String(err);
        if (!args.json)
            warn(`WARNING: the rows were deleted but the confirmation read failed: ${confirmError}`);
    }
    if (args.json) {
        printJson({ dryRun: false, ...plan, deleted, confirmed, ...(confirmError !== undefined ? { confirmError } : {}) });
    }
    else {
        if (confirmed === true)
            print(`Deleted ${matches.length} row(s) and confirmed.`);
        else if (confirmed === false)
            print(`Deleted, but ${remaining} row(s) still listed — re-check.`);
        else
            print(`Deleted ${deleted} row(s); not confirmed.`);
        print('NOTE: env changes are inert until a separate redeploy / restart.');
    }
    return EXIT.ok;
}
