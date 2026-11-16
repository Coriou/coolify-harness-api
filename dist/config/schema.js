/**
 * The project registry (`coolify-harness.config.*` default export) and its validation.
 *
 * Validated by hand rather than with zod: the shape is two small records, and loading zod here
 * would delay every command by the cost of its import before the first request can even be sent
 * (see client/lazy-schemas.ts).
 */
const KINDS = ['application', 'service', 'database'];
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const typeName = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
function isPlainInstanceUrl(value) {
    try {
        const u = new URL(value);
        return (u.protocol === 'https:' || u.protocol === 'http:') && u.username === '' && u.password === '';
    }
    catch {
        return false;
    }
}
/**
 * Validate a raw config object. Returns the registry (instance URLs without trailing slashes, and
 * only the known fields) or the list of problems as `path: message`. Messages name types, never
 * values: a token pasted into the config must not be echoed back.
 */
export function parseRegistry(raw) {
    const issues = [];
    if (!isRecord(raw))
        return { ok: false, issues: [`(root): expected an object, received ${typeName(raw)}`] };
    const registry = { instances: {}, targets: {} };
    const instances = raw['instances'];
    if (!isRecord(instances))
        issues.push(`instances: expected an object, received ${typeName(instances)}`);
    else {
        for (const [name, inst] of Object.entries(instances)) {
            const at = `instances.${name}`;
            if (!isRecord(inst)) {
                issues.push(`${at}: expected an object, received ${typeName(inst)}`);
                continue;
            }
            const { url, tokenEnv } = inst;
            let ok = true;
            if (typeof url !== 'string') {
                issues.push(`${at}.url: expected a string, received ${typeName(url)}`);
                ok = false;
            }
            else if (!isPlainInstanceUrl(url)) {
                issues.push(`${at}.url: must be an http(s) URL without credentials (the token goes in the env var named by tokenEnv)`);
                ok = false;
            }
            if (typeof tokenEnv !== 'string') {
                issues.push(`${at}.tokenEnv: expected a string, received ${typeName(tokenEnv)}`);
                ok = false;
            }
            // A Coolify token looks like `12|AbC…`: refuse it here so it never lands in a committed config.
            else if (tokenEnv === '' || /[|\s]/.test(tokenEnv)) {
                issues.push(`${at}.tokenEnv: must be the NAME of an environment variable, never the token itself`);
                ok = false;
            }
            if (ok)
                registry.instances[name] = { url: url.replace(/\/+$/, ''), tokenEnv: tokenEnv }; // reason: both narrowed to string by the checks above
        }
    }
    const targets = raw['targets'];
    if (!isRecord(targets))
        issues.push(`targets: expected an object, received ${typeName(targets)}`);
    else {
        for (const [name, target] of Object.entries(targets)) {
            const at = `targets.${name}`;
            if (!isRecord(target)) {
                issues.push(`${at}: expected an object, received ${typeName(target)}`);
                continue;
            }
            const { instance, kind, uuid } = target;
            let ok = true;
            if (typeof instance !== 'string' || instance === '') {
                issues.push(`${at}.instance: expected the name of an instance`);
                ok = false;
            }
            if (typeof kind !== 'string' || !KINDS.includes(kind)) { // reason: membership test of an arbitrary string against the literal union
                issues.push(`${at}.kind: expected one of ${KINDS.map((k) => `'${k}'`).join(', ')}`);
                ok = false;
            }
            if (typeof uuid !== 'string' || uuid === '') {
                issues.push(`${at}.uuid: expected the resource uuid (a non-empty string)`);
                ok = false;
            }
            if (ok)
                registry.targets[name] = { instance: instance, kind: kind, uuid: uuid }; // reason: all three narrowed by the checks above
        }
    }
    return issues.length > 0 ? { ok: false, issues } : { ok: true, registry };
}
