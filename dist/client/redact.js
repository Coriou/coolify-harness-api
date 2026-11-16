/**
 * Output redaction. Coolify API payloads carry live secrets in places that look harmless:
 * `manual_webhook_secret_*` and `http_basic_auth_password` on every application, `sentinel_token`
 * in server settings, `internal_db_url` (with the DB password) on databases, build / start
 * commands, and whole docker-compose documents (`docker_compose_raw`, the proxy `configuration`)
 * that may hold literal credentials. Everything the CLI prints goes through here first. Values are
 * never echoed — only their length, so an operator can still tell "set" from "empty".
 */
/** Object keys whose string values are always secret. */
const SENSITIVE_KEY_RE = /(pass(word|wd|phrase)?|secret|token|api[_-]?key|private[_-]?key|license[_-]?key|access[_-]?key|credential|auth[_-]?(user|header|hash)|basicauth|dsn|salt|cookie|signature|^value$|^values$|^real_value$|custom_labels|custom_docker_run_options|init_scripts|health_check_response_text)/i;
/** Object keys whose string values are docker-compose / config documents: redact line by line. */
const DOCUMENT_KEY_RE = /^(compose|docker_compose(_raw)?|configuration|last_saved_proxy_configuration|dockerfile|custom_nginx_configuration|logdrain_custom_config|proxy_error_page|[a-z]+_conf)$/i;
/** Object keys whose string values are shell commands / docker options: redact inline secrets. */
const COMMAND_KEY_RE = /(_command$|^command$)/i;
/** An env-style key inside a compose document: UPPER_SNAKE_CASE. */
const ENV_KEY_RE = /^[A-Z][A-Z0-9_]*$/;
/** A value that is only a reference to another variable (`$VAR`, `${VAR}`) — safe to show. */
const PURE_REF_RE = /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/;
/** Values that carry no secret and are useful to see (ports, flags). */
const BORING_RE = /^(true|false|yes|no|on|off|null|\d{1,6})$/i;
/** `scheme://user:password@host` — keep the user (may be empty, as in `redis://:pw@host`), drop the password. */
const URL_CREDS_RE = /([a-z][a-z0-9+.-]*:\/\/)([^\s:/@'"]*):([^\s@/'"]+)@/gi;
/** `https://TOKEN@host` — a lone userinfo on http(s) is a token (git remotes), not a username. */
const URL_TOKEN_RE = /(https?:\/\/)([^\s:/@'"]{8,})@/gi;
/** `Authorization: Bearer xyz` / `Basic xyz` inside a command or header value. */
const AUTH_SCHEME_RE = /\b(Bearer|Basic|Token)\s+([A-Za-z0-9._~+/=-]{8,})/g;
/** YAML block scalar indicators (`|`, `>`, with chomping / indentation hints). */
const BLOCK_SCALAR_RE = /^[|>][+-]?\d*$/;
const PEM_BEGIN_RE = /-----BEGIN [A-Z0-9 ]+-----/;
const PEM_END_RE = /-----END [A-Z0-9 ]+-----/;
export const REDACTED = '[REDACTED]';
export function redactValue(value) {
    return `${REDACTED} (${value.length} chars)`;
}
/** Strip credentials embedded in URLs and auth-scheme tokens anywhere in `text`. */
export function redactUrlCredentials(text) {
    return text
        .replace(URL_CREDS_RE, (_m, scheme, user) => `${scheme}${user}:${REDACTED}@`)
        .replace(URL_TOKEN_RE, (_m, scheme) => `${scheme}${REDACTED}@`)
        .replace(AUTH_SCHEME_RE, (_m, scheme) => `${scheme} ${REDACTED}`);
}
function redactAssignedValue(raw) {
    const quoted = /^(['"])(.*)\1$/.exec(raw.trim());
    const q = quoted?.[1] ?? '';
    const inner = quoted?.[2] ?? raw.trim();
    if (inner === '' || PURE_REF_RE.test(inner) || BORING_RE.test(inner))
        return raw;
    // `${VAR:-default}` / `${VAR:?msg}`: keep the reference, hide the literal default.
    const withDefault = /^\$\{([A-Za-z_][A-Za-z0-9_]*)(:?[-?=+])(.*)\}$/.exec(inner);
    if (withDefault) {
        return withDefault[3] === '' ? raw : `${q}\${${withDefault[1]}${withDefault[2]}${REDACTED}}${q}`;
    }
    return `${q}${REDACTED}${q}`;
}
/**
 * Redact the secrets a shell command or a docker option string can carry: inline `KEY=value`
 * assignments, `--password=…` / `--token …` style flags, auth-scheme tokens and URL credentials.
 * The command itself stays readable.
 */
export function redactCommandLine(text) {
    return redactUrlCredentials(text)
        // KEY=value tokens (env prefix, `-e KEY=value`, `--env KEY=value`, `--build-arg KEY=value`)
        .replace(/(^|[\s'"])([A-Z][A-Z0-9_]*)=("[^"]*"|'[^']*'|[^\s'"]+)/g, (m, lead, key, value) => {
        const inner = value.replace(/^(['"])(.*)\1$/, '$2');
        return inner === '' || PURE_REF_RE.test(inner) || BORING_RE.test(inner) ? m : `${lead}${key}=${REDACTED}`;
    })
        // --some-secret-flag=value / --some-secret-flag value
        .replace(/(--?[A-Za-z][A-Za-z0-9._-]*)([=\s]+)("[^"]*"|'[^']*'|[^\s'"]+)/g, (m, flag, sep, value) => (SENSITIVE_KEY_RE.test(flag) && !value.startsWith('-') ? `${flag}${sep}${REDACTED}` : m));
}
const indentOf = (line) => line.length - line.trimStart().length;
/**
 * Redact a docker-compose / dotenv / Dockerfile-like document and return one output line per input
 * line (so a diff of the original can be printed with the redacted text). Rules:
 * - `KEY=value` / `KEY: value` (list items and maps, quoted or not) where KEY is UPPER_SNAKE, looks
 *   sensitive, or sits under an `environment:` block → value replaced, unless it is a pure
 *   `${VAR}` reference, a number or a boolean;
 * - a YAML block scalar (`KEY: |`) under such a key, and any PEM block → every content line replaced;
 * - `--flag=value` list items (proxy command arguments) whose flag name looks sensitive → value replaced;
 * - credentials embedded in URLs and `Bearer …` tokens anywhere → replaced.
 * Structure (service names, `image:` lines, ports, labels without secrets) stays readable, which is
 * what an agent needs to review an image bump or a diff.
 */
export function redactDocumentLines(text) {
    const out = [];
    let envIndent = -1; // indent of an open `environment:` key, -1 when outside
    let blockIndent = -1; // indent of a secret block-scalar key whose content is being swallowed
    let inPem = false;
    for (const line of text.split('\n')) {
        const blank = line.trim() === '';
        const indent = indentOf(line);
        if (inPem) {
            if (PEM_END_RE.test(line))
                inPem = false;
            out.push(`${line.slice(0, indent)}${REDACTED}`);
            continue;
        }
        if (blockIndent >= 0) {
            if (blank || indent > blockIndent) {
                out.push(blank ? line : `${line.slice(0, indent)}${REDACTED}`);
                continue;
            }
            blockIndent = -1;
        }
        if (envIndent >= 0 && !blank && indent <= envIndent)
            envIndent = -1;
        if (PEM_BEGIN_RE.test(line) && !PEM_END_RE.test(line)) {
            inPem = true;
            out.push(`${line.slice(0, indent)}${REDACTED}`);
            continue;
        }
        const env = /^(\s*environment:\s*)(.*)$/.exec(line);
        if (env) {
            const inline = (env[2] ?? '').trim();
            if (inline === '' || inline.startsWith('#')) {
                envIndent = indent;
                out.push(line);
            }
            else {
                // Inline flow form (`environment: { KEY: value }`): no per-key structure to keep.
                out.push(`${env[1]}${REDACTED}`);
            }
            continue;
        }
        // Dockerfile `ENV KEY=value …` / `ARG KEY=value` / legacy `ENV KEY value`.
        const df = /^(\s*(?:ENV|ARG)\s+)(.*)$/.exec(line);
        if (df) {
            const rest = df[2] ?? '';
            const legacy = /^([A-Za-z_][A-Za-z0-9_]*)(\s+)(\S.*)$/.exec(rest);
            out.push(`${df[1]}${legacy && !legacy[1].includes('=') && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(rest)
                ? `${legacy[1]}${legacy[2]}${redactAssignedValue(legacy[3])}`
                : rest.replace(/([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|\S+)/g, (_m, k, v) => `${k}=${redactAssignedValue(v)}`)}`);
            continue;
        }
        const m = /^(\s*(?:-\s*)?)(['"]?)(-{0,2}[A-Za-z_][A-Za-z0-9_.\-/]*)(\s*[=:]\s*)(.*)$/.exec(line);
        if (m) {
            const [, lead = '', openQuote = '', key = '', sep = ''] = m;
            let value = m[5] ?? '';
            // A quoted list item (`- 'KEY=value'`) closes its quote after the value.
            const trail = openQuote !== '' && value.endsWith(openQuote) ? openQuote : '';
            if (trail !== '')
                value = value.slice(0, -1);
            const secretKey = ENV_KEY_RE.test(key) || SENSITIVE_KEY_RE.test(key) || (envIndent >= 0 && indent > envIndent);
            if (secretKey) {
                const v = value.trim();
                if (BLOCK_SCALAR_RE.test(v)) {
                    blockIndent = indent;
                    out.push(line);
                    continue;
                }
                if (v !== '') {
                    out.push(`${lead}${openQuote}${key}${sep}${redactAssignedValue(value)}${trail}`);
                    continue;
                }
            }
        }
        out.push(redactUrlCredentials(line));
    }
    return out;
}
/** `redactDocumentLines` joined back into one document. */
export function redactDocument(text) {
    return redactDocumentLines(text).join('\n');
}
/**
 * Deep-copy `input` with secrets redacted. Strings under sensitive keys become `[REDACTED] (N chars)`;
 * compose/config documents are redacted line by line; commands keep their shape but lose inline
 * secrets; credentials inside any URL are stripped.
 * `logs` is deliberately left alone — logs are an explicit, `read:sensitive`-scoped request and
 * Coolify already masks env values in them.
 */
export function redactDeep(input) {
    const walk = (value, key) => {
        if (typeof value === 'string') {
            if (key === 'logs')
                return value;
            if (DOCUMENT_KEY_RE.test(key))
                return redactDocument(value);
            if (SENSITIVE_KEY_RE.test(key))
                return value === '' ? value : redactValue(value);
            if (COMMAND_KEY_RE.test(key))
                return redactCommandLine(value);
            return redactUrlCredentials(value);
        }
        if (Array.isArray(value))
            return value.map((v) => walk(v, key));
        if (value !== null && typeof value === 'object') {
            const out = {};
            for (const [k, v] of Object.entries(value))
                out[k] = walk(v, k);
            return out;
        }
        return value;
    };
    return walk(input, ''); // reason: walk preserves the structural shape of T; only string leaves change
}
