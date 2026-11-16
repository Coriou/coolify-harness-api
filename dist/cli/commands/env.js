import { readFile as nodeReadFile } from 'node:fs/promises';
import { planEnvWrite, applyEnvWrite, isLockedRow } from '../../client/safe-write.js';
import { createLogger } from '../../logging/index.js';
import { CoolifyAuthScopeError, CoolifyFeatureNotSupportedError, DuplicateKeyDriftError, LockedVarError, UsageError, } from '../../errors/index.js';
import { EXIT } from '../exit.js';
import { withScope } from '../scope.js';
import { audited, print, printJson, warn, writeAuditSafely, usageFail } from '../deps.js';
const defaultReadFile = (path) => nodeReadFile(path, 'utf8');
/** Coolify 4.7's own rule for env keys (ValidationPatterns::environmentVariableKeyRules). */
const COOLIFY_KEY_RE = /^[A-Za-z_][A-Za-z0-9_.]*$/;
/**
 * Parse dotenv-style text into a record.
 * - blank lines and `#` comment lines are ignored; an optional `export ` prefix is dropped;
 * - a value wrapped in matching quotes loses them (`KEY="a b"` → `a b`), as every dotenv loader
 *   does; a double-quoted value also expands `\n`, `\r`, `\t`, `\"` and `\\`, and a quoted value
 *   may span several lines (PEM keys);
 * - an UNQUOTED value is taken verbatim up to the end of the line (no trimming, no inline-comment
 *   stripping: a secret containing ` #` must not be silently cut).
 * A line that is not `KEY=VALUE` is a usage error; its content is never echoed.
 */
export function parseDotenv(text) {
    const result = {};
    const lines = text.split('\n');
    for (let n = 0; n < lines.length; n += 1) {
        const line = (lines[n] ?? '').replace(/\r$/, ''); // trim trailing CR
        const trimmed = line.trimStart();
        if (trimmed === '' || trimmed.startsWith('#'))
            continue; // blank or comment
        const withoutExport = trimmed.startsWith('export ') ? trimmed.slice(7).trimStart() : trimmed;
        const eqIdx = withoutExport.indexOf('=');
        const key = eqIdx < 0 ? '' : withoutExport.slice(0, eqIdx).trim();
        if (eqIdx < 0 || key === '' || /\s/.test(key)) {
            throw new UsageError(`Invalid dotenv line ${n + 1}: expected KEY=VALUE${eqIdx < 0 ? " (missing '=')" : ''}`);
        }
        let value = withoutExport.slice(eqIdx + 1);
        const quote = value[0];
        if (quote === '"' || quote === "'") {
            // Find the closing quote, on this line or a later one (multi-line value).
            let body = value.slice(1);
            let close = closingQuote(body, quote);
            const firstLine = n;
            while (close < 0 && n + 1 < lines.length) {
                n += 1;
                body += `\n${(lines[n] ?? '').replace(/\r$/, '')}`;
                close = closingQuote(body, quote);
            }
            if (close < 0) {
                throw new UsageError(`Invalid dotenv value for ${key} (line ${firstLine + 1}): unterminated ${quote === '"' ? 'double' : 'single'} quote`);
            }
            // Text after the closing quote (`"a" b`) means this was not a quoted value: keep it verbatim.
            if (body.slice(close + 1).trim().replace(/^#.*/, '') === '') {
                value = quote === '"' ? unescapeDouble(body.slice(0, close)) : body.slice(0, close);
            }
            else if (n !== firstLine) {
                throw new UsageError(`Invalid dotenv value for ${key} (line ${firstLine + 1}): unexpected text after the closing quote`);
            }
        }
        result[key] = value;
    }
    return result;
}
function closingQuote(body, quote) {
    for (let i = 0; i < body.length; i += 1) {
        if (quote === '"' && body[i] === '\\') {
            i += 1;
            continue;
        }
        if (body[i] === quote)
            return i;
    }
    return -1;
}
function unescapeDouble(body) {
    return body.replace(/\\([nrt"\\])/g, (_m, c) => ({ n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' })[c] ?? c);
}
async function resolveValues(args, deps) {
    if (!args.fromFile)
        return args.set;
    let fileText;
    try {
        fileText = await (deps.readFile ?? defaultReadFile)(args.fromFile);
    }
    catch (err) {
        const code = err.code; // reason: probing the optional errno code of an unknown error
        throw new UsageError(`Cannot read --from-file ${args.fromFile}${typeof code === 'string' ? ` (${code})` : ''}`);
    }
    const fileValues = parseDotenv(fileText);
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
function keyWarnings(values) {
    return Object.keys(values)
        .filter((k) => !COOLIFY_KEY_RE.test(k))
        .map((k) => `Key '${k}' is not a valid Coolify variable name (letters, digits, _ and ., not starting with a digit); Coolify 4.7 rejects it`);
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
    for (const w of plan.keyWarnings ?? [])
        print(`warning: ${w}`);
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
    const plan = planEnvWrite(current, { values: merged, scope });
    const kw = keyWarnings(merged);
    return { target, client, plan: kw.length > 0 ? { ...plan, keyWarnings: kw } : plan };
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
    const pending = plan.creates.length + plan.updates.length;
    if (args.failOnChanges && pending > 0) {
        if (!args.json)
            warn(`env diff: ${pending} key(s) differ from the desired values (--fail-on-changes)`);
        return EXIT.drift;
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
        return { code: EXIT.ok, doc: { ...base, dryRun: true, applied: [], confirmed: null }, wrote: false };
    }
    const result = await withScope('write', () => applyEnvWrite(plan, {
        client, logger: createLogger({ sink: () => { } }),
        target: { instanceUrl: target.instanceUrl, kind: target.kind, uuid: target.uuid },
        actor: deps.actor,
        writeAudit: (record) => writeAuditSafely(deps, record),
        ...(deps.now ? { now: deps.now } : {}),
    }));
    if (!args.json) {
        if (result.confirmError !== undefined)
            warn(`WARNING: the write succeeded but could not be re-read: ${result.confirmError}`);
        print(result.confirmed ? 'Applied and confirmed.' : 'Applied (confirmation mismatch — re-check).');
    }
    return {
        code: EXIT.ok,
        doc: {
            ...base,
            dryRun: false,
            applied: result.applied.map((i) => i.key),
            confirmed: result.confirmed,
            ...(result.confirmError !== undefined ? { confirmError: result.confirmError } : {}),
        },
        wrote: result.applied.length > 0,
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
 * With `--json` it prints one document: the plan, then (after --apply) `deleted` and `confirmed`.
 */
export async function envDelete(args, deps) {
    if (args.keys.length === 0) {
        return usageFail(args, 'env delete: at least one --key <KEY> is required');
    }
    const target = deps.resolveTargetFor(args);
    scopeFor(args, target);
    const client = deps.clientFactory(target);
    const rows = await withScope('read', () => client.listEnvs());
    const wantScope = args.preview ? 'preview' : 'prod';
    const matches = rows.filter((e) => args.keys.includes(e.key) && scopeOf(e) === wantScope);
    const missing = args.keys.filter((k) => !matches.some((e) => e.key === k));
    // The compose is only needed to decide whether a MATCHED row would be re-created.
    let compose;
    if (matches.length > 0) {
        if (target.kind === 'service')
            compose = (await withScope('read', () => client.getService())).docker_compose_raw;
        else if (target.kind === 'application') {
            const app = await withScope('read', () => client.get());
            if (app.build_pack === 'dockercompose')
                compose = app.docker_compose_raw;
        }
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
        return usageFail(args, `env delete: no ${wantScope} rows match ${args.keys.join(', ')}`);
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
    await audited(deps, {
        instanceUrl: target.instanceUrl, kind: target.kind, uuid: target.uuid, action: 'env.delete', keysAffected,
        options: { scope: wantScope, rows: matches.length, ...(args.force ? { force: true } : {}) },
    }, () => withScope('delete', async () => {
        for (const m of matches) {
            await client.deleteEnv(m.uuid);
            deleted += 1;
        }
    }));
    let confirmed = null;
    let remaining = 0;
    try {
        const after = await withScope('read', () => client.listEnvs());
        remaining = after.filter((e) => matches.some((m) => m.uuid === e.uuid)).length;
        confirmed = remaining === 0;
    }
    catch (err) {
        warn(`WARNING: the rows were deleted but the confirmation read failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (args.json) {
        printJson({ dryRun: false, ...plan, deleted, confirmed });
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
