const ORDER = { debug: 0, info: 1, warn: 2, error: 3 };
const SECRET_RE = /token|secret|authorization|bearer|password/i;
export function redactSecrets(fields) {
    const out = {};
    for (const [k, v] of Object.entries(fields)) {
        out[k] = SECRET_RE.test(k) ? '[REDACTED]' : v;
    }
    return out;
}
export function createLogger(opts = {}) {
    const level = opts.level ?? 'info';
    const sink = opts.sink ?? ((line) => { process.stdout.write(line + '\n'); });
    const emit = (lvl, msg, fields) => {
        if (ORDER[lvl] < ORDER[level])
            return;
        const base = { ts: new Date().toISOString(), level: lvl, msg };
        const payload = fields ? { ...base, ...redactSecrets(fields) } : base;
        sink(JSON.stringify(payload));
    };
    return {
        debug: (m, f) => emit('debug', m, f),
        info: (m, f) => emit('info', m, f),
        warn: (m, f) => emit('warn', m, f),
        error: (m, f) => emit('error', m, f),
    };
}
export function noopLogger() {
    return { debug: () => { }, info: () => { }, warn: () => { }, error: () => { } };
}
