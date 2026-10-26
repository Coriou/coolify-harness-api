/**
 * Output redaction. Coolify API payloads carry live secrets in places that look harmless:
 * `manual_webhook_secret_*` and `http_basic_auth_password` on every application, `sentinel_token`
 * in server settings, `internal_db_url` (with the DB password) on databases, and whole
 * docker-compose documents (`docker_compose_raw`, the proxy `configuration`) that may hold literal
 * credentials. Everything the CLI prints goes through here first. Values are never echoed — only
 * their length, so an operator can still tell "set" from "empty".
 */

/** Object keys whose string values are always secret. */
const SENSITIVE_KEY_RE =
  /(pass(word|wd|phrase)?|secret|token|api[_-]?key|private[_-]?key|license[_-]?key|credential|auth[_-]?(user|header|hash)|basicauth|dsn|salt|cookie|signature|^value$|^real_value$|custom_labels|custom_docker_run_options)/i;

/** Object keys whose string values are docker-compose / config documents: redact line by line. */
const DOCUMENT_KEY_RE = /^(docker_compose(_raw)?|configuration|last_saved_proxy_configuration|dockerfile|redis_conf|custom_nginx_configuration|logdrain_custom_config)$/i;

/** An env-style key inside a compose document: UPPER_SNAKE_CASE. */
const ENV_KEY_RE = /^[A-Z][A-Z0-9_]*$/;
/** A value that is only a reference to another variable (`$VAR`, `${VAR}`) — safe to show. */
const PURE_REF_RE = /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/;
/** Values that carry no secret and are useful to see (ports, flags). */
const BORING_RE = /^(true|false|yes|no|on|off|\d{1,6})$/i;
/** `scheme://user:password@host` — keep the user, drop the password. */
const URL_CREDS_RE = /([a-z][a-z0-9+.-]*:\/\/)([^\s:/@'"]+):([^\s@/'"]+)@/gi;

export const REDACTED = '[REDACTED]';

export function redactValue(value: string): string {
  return `${REDACTED} (${value.length} chars)`;
}

function redactUrlCredentials(text: string): string {
  return text.replace(URL_CREDS_RE, (_m, scheme: string, user: string) => `${scheme}${user}:${REDACTED}@`);
}

function redactAssignedValue(raw: string): string {
  const quoted = /^(['"])(.*)\1$/.exec(raw.trim());
  const q = quoted?.[1] ?? '';
  const inner = quoted?.[2] ?? raw.trim();
  if (inner === '' || PURE_REF_RE.test(inner) || BORING_RE.test(inner)) return raw;
  // `${VAR:-default}` / `${VAR:?msg}`: keep the reference, hide the literal default.
  const withDefault = /^\$\{([A-Za-z_][A-Za-z0-9_]*)(:?[-?=+])(.*)\}$/.exec(inner);
  if (withDefault) return `${q}\${${withDefault[1]}${withDefault[2]}${REDACTED}}${q}`;
  return `${q}${REDACTED}${q}`;
}

/**
 * Redact a docker-compose / dotenv / Dockerfile-like document line by line:
 * - `KEY=value` / `KEY: value` (list items and maps, quoted or not) where KEY is UPPER_SNAKE or
 *   looks sensitive → value replaced, unless it is a pure `${VAR}` reference, a number or a boolean;
 * - credentials embedded in URLs anywhere on the line → password replaced.
 * Structure (service names, `image:` lines, ports, labels without secrets) stays readable, which is
 * what an agent needs to review an image bump or a diff.
 */
export function redactDocument(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const m = /^(\s*(?:-\s*)?)(['"]?)([A-Za-z_][A-Za-z0-9_.\-/]*)(\s*[=:]\s*)(.*)$/.exec(line);
      if (m) {
        const [, lead = '', openQuote = '', key = '', sep = ''] = m;
        let value = m[5] ?? '';
        // A quoted list item (`- 'KEY=value'`) closes its quote after the value.
        const trail = openQuote !== '' && value.endsWith(openQuote) ? openQuote : '';
        if (trail !== '') value = value.slice(0, -1);
        if ((ENV_KEY_RE.test(key) || SENSITIVE_KEY_RE.test(key)) && !['', '|', '>', '|-', '>-'].includes(value.trim())) {
          return `${lead}${openQuote}${key}${sep}${redactAssignedValue(value)}${trail}`;
        }
      }
      return redactUrlCredentials(line);
    })
    .join('\n');
}

/**
 * Deep-copy `input` with secrets redacted. Strings under sensitive keys become `[REDACTED] (N chars)`;
 * compose/config documents are redacted line by line; credentials inside any URL are stripped.
 * `logs` is deliberately left alone — logs are an explicit, `read:sensitive`-scoped request and
 * Coolify already masks env values in them.
 */
export function redactDeep<T>(input: T): T {
  const walk = (value: unknown, key: string): unknown => {
    if (typeof value === 'string') {
      if (key === 'logs') return value;
      if (DOCUMENT_KEY_RE.test(key)) return redactDocument(value);
      if (SENSITIVE_KEY_RE.test(key)) return value === '' ? value : redactValue(value);
      return redactUrlCredentials(value);
    }
    if (Array.isArray(value)) return value.map((v) => walk(v, key));
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) out[k] = walk(v, k);
      return out;
    }
    return value;
  };
  return walk(input, '') as T; // reason: walk preserves the structural shape of T; only string leaves change
}
