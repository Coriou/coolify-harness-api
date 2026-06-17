export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const SECRET_RE = /token|secret|authorization|bearer|password/i;

export function redactSecrets(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = SECRET_RE.test(k) ? '[REDACTED]' : v;
  }
  return out;
}

export function createLogger(
  opts: { level?: Level; sink?: (line: string) => void } = {},
): Logger {
  const level = opts.level ?? 'info';
  const sink = opts.sink ?? ((line: string): void => { process.stdout.write(line + '\n'); });
  const emit = (lvl: Level, msg: string, fields?: Record<string, unknown>): void => {
    if (ORDER[lvl] < ORDER[level]) return;
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

export function noopLogger(): Logger {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
}
