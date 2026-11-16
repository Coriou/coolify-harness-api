/**
 * Output redaction. Coolify API payloads carry live secrets in places that look harmless:
 * `manual_webhook_secret_*` and `http_basic_auth_password` on every application, `sentinel_token`
 * in server settings, `internal_db_url` (with the DB password) on databases, build / start
 * commands, and whole docker-compose documents (`docker_compose_raw`, the proxy `configuration`)
 * that may hold literal credentials. Everything the CLI prints goes through here first. Values are
 * never echoed — only their length, so an operator can still tell "set" from "empty".
 *
 * The document redactor is line-based on purpose (it must return one line per input line so a
 * diff can be printed), and it errs on the side of hiding: anything it cannot classify inside a
 * secret-bearing construct is replaced.
 */
/** Names (object keys, compose keys, flags, directives) whose value is always secret. */
const SENSITIVE_NAME = 'pass(?:word|wd|phrase)?|secret|token|api[_-]?key|private[_-]?key|license[_-]?key|access[_-]?key|credential|' +
    'auth[_-]?(?:user|header|hash)|basic[_-]?auth|digestauth|masterauth|requirepass|hmac|dsn|salt|cookie|signature|' +
    'customrequestheaders|customresponseheaders';
/** Object keys whose string values are always secret. */
const SENSITIVE_KEY_RE = new RegExp(`(${SENSITIVE_NAME}|^value$|^values$|^real_value$|custom_labels|custom_docker_run_options|init_scripts|health_check_response_text)`, 'i');
/** A name inside a document / command line that marks its value as secret. */
const SENSITIVE_NAME_RE = new RegExp(`(${SENSITIVE_NAME}|pwd|authorization|x-api-key)`, 'i');
/** Object keys whose string values are docker-compose / config documents: redact line by line. */
const DOCUMENT_KEY_RE = /^(compose|docker_compose(_raw)?|configuration|last_saved_proxy_configuration|dockerfile|custom_nginx_configuration|logdrain_custom_config|proxy_error_page|[a-z]+_conf)$/i;
/** Object keys whose string values are shell commands / docker options: redact inline secrets. */
const COMMAND_KEY_RE = /(_command$|^command$)/i;
/** An env-style key inside a compose document: UPPER_SNAKE_CASE. */
const ENV_KEY_RE = /^[A-Z][A-Z0-9_]*$/;
/** A value that is only a reference to another variable (`$VAR`, `${VAR}`) — safe to show. */
const PURE_REF_RE = /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/;
/** Values that carry no secret and are useful to see (ports, flags). */
const BORING_RE = /^(true|false|yes|no|on|off|null|~|\d{1,6})$/i;
/**
 * `scheme://user:password@host` — keep the user (may be empty, as in `redis://:pw@host`), drop the
 * password. The password may itself contain `@` or `/`: an `@` ends it only when what follows is
 * the host (`host[:port]` then `/`, `?`, `#`, a quote, whitespace or the end).
 */
const URL_CREDS_RE = /([a-z][a-z0-9+.-]*:\/\/)([^\s:/@'"]*):((?:[^\s'"@]|@(?![A-Za-z0-9.\-[\]]+(?::\d+)?(?:[/?#\s'"]|$)))*)@/gi;
/** `https://TOKEN@host` — a lone userinfo on http(s) is a token (git remotes), not a username. */
const URL_TOKEN_RE = /(https?:\/\/)([^\s:/@'"]{8,})@/gi;
/** `?password=…&token=…` in a URL or a connection string. */
const URL_QUERY_SECRET_RE = /([?&;](?:password|passwd|pwd|token|secret|api[_-]?key|access[_-]?key|sig|signature)=)([^&\s'"#;]+)/gi;
/** `Authorization: Bearer xyz` / `Basic xyz` / `token xyz`. A Coolify token contains `|`, so: any non-space run. */
const AUTH_SCHEME_RE = /\b(bearer|basic|token)(\s+)([^\s'"]{8,})/gi;
/** YAML block scalar header: `|`, `>`, with chomping / indentation indicators and an optional comment. */
const BLOCK_SCALAR_RE = /^[|>][+-]?\d*[+-]?\s*(#.*)?$/;
const PEM_BEGIN_RE = /-----BEGIN [A-Z0-9 ]+-----/;
const PEM_END_RE = /-----END [A-Z0-9 ]+-----/;
/** Compose keys whose value is a command line (inline or as a list of arguments). */
const COMMAND_YAML_KEY_RE = /^(command|entrypoint|test)$/i;
/** Flow collections under these keys carry no secret and are worth reading. */
const SAFE_FLOW_KEY_RE = /^(ports|expose|networks|depends_on|dns|cap_add|cap_drop|profiles|aliases|tmpfs)$/i;
/** A command flag whose NEXT argument is a secret (`--requirepass x`, `-a x`, `-p x`, `-u user:pass`). */
const SECRET_LONG_FLAG_RE = new RegExp(`^--?[A-Za-z0-9._-]*(${SENSITIVE_NAME}|pwd|key)[A-Za-z0-9._-]*$`, 'i');
/** Short flags are case-sensitive: `-p` is a password (mysql, sshpass), `-P` a port; `-h` a host. */
const SECRET_SHORT_FLAG_RE = /^(-a|-p)$/;
const isSecretFlag = (flag) => SECRET_SHORT_FLAG_RE.test(flag) || SECRET_LONG_FLAG_RE.test(flag);
const PORT_MAPPING_RE = /^[\d.:[\]-]+(\/(tcp|udp|sctp))?$/;
export const REDACTED = '[REDACTED]';
export function redactValue(value) {
    return `${REDACTED} (${value.length} chars)`;
}
/** Strip credentials embedded in URLs, secret query parameters and auth-scheme tokens anywhere in `text`. */
export function redactUrlCredentials(text) {
    return text
        .replace(URL_CREDS_RE, (_m, scheme, user) => `${scheme}${user}:${REDACTED}@`)
        .replace(URL_TOKEN_RE, (_m, scheme) => `${scheme}${REDACTED}@`)
        .replace(URL_QUERY_SECRET_RE, (_m, lead) => `${lead}${REDACTED}`)
        .replace(AUTH_SCHEME_RE, (_m, scheme, gap) => `${scheme}${gap}${REDACTED}`);
}
const isHarmless = (inner) => inner === '' || PURE_REF_RE.test(inner) || BORING_RE.test(inner);
function redactAssignedValue(raw) {
    const quoted = /^(['"])(.*)\1$/.exec(raw.trim());
    const q = quoted?.[1] ?? '';
    const inner = quoted?.[2] ?? raw.trim();
    if (isHarmless(inner))
        return raw;
    // `${VAR:-default}` / `${VAR:?msg}`: keep the reference, hide the literal default.
    const withDefault = /^\$\{([A-Za-z_][A-Za-z0-9_]*)(:?[-?=+])(.*)\}$/.exec(inner);
    if (withDefault) {
        return withDefault[3] === '' ? raw : `${q}\${${withDefault[1]}${withDefault[2]}${REDACTED}}${q}`;
    }
    return `${q}${REDACTED}${q}`;
}
/** A shell word: double-quoted (with escapes), single-quoted, or a bare run. */
const WORD = String.raw `"(?:[^"\\]|\\.)*"|'[^']*'|[^\s'";,\]]+`;
const unquoteWord = (w) => w.replace(/^(['"])([\s\S]*)\1$/, '$2');
/**
 * Redact the secrets a shell command or a docker option string can carry: `KEY=value`
 * assignments, `--password=…` / `--token …` flags, `-p…` / `-a …` / `-u user:pass`, header values,
 * auth-scheme tokens and URL credentials. The command itself stays readable.
 */
export function redactCommandLine(text) {
    let out = redactUrlCredentials(text);
    // name=value where the name is UPPER_SNAKE or looks sensitive (env prefix, export, -e, --build-arg, npm :_authToken=)
    out = out.replace(new RegExp(String.raw `([A-Za-z_][A-Za-z0-9_.-]*)=(${WORD})`, 'g'), (m, key, value) => {
        if (!(ENV_KEY_RE.test(key) || SENSITIVE_NAME_RE.test(key)))
            return m;
        return isHarmless(unquoteWord(value)) ? m : `${key}=${REDACTED}`;
    });
    // --some-secret-flag=value / --some-secret-flag value (also across a JSON-style `", "` separator)
    // A flag starts a word (`redis-cli` is not `-cli`), and its value is not itself a flag.
    out = out.replace(new RegExp(String.raw `(?<=^|[\s'"\[,(])(--?[A-Za-z][A-Za-z0-9._-]*)((?:=|\s+|["']\s*,\s*["']?)+)(?!-)(${WORD})`, 'g'), (m, flag, sep, value) => {
        if (isHarmless(unquoteWord(value)))
            return m;
        // docker `-p 8080:80` / `-p 127.0.0.1:80:80/tcp` is a port mapping, not a password.
        if (flag === '-p' && PORT_MAPPING_RE.test(unquoteWord(value)))
            return m;
        if (/^(-H|--header)$/.test(flag)) {
            // -H "Name: value": hide the value of a sensitive header, keep the others.
            const header = /^(['"]?)([^:'"]+):\s*([\s\S]*?)\1$/.exec(value);
            return header && SENSITIVE_NAME_RE.test(header[2] ?? '') ? `${flag}${sep}${header[1]}${header[2]}: ${REDACTED}${header[1]}` : m;
        }
        if (flag === '-u') {
            // curl -u user:password — keep the user
            const cred = /^(['"]?)([^:'"]+):([\s\S]+?)\1$/.exec(value);
            return cred ? `${flag}${sep}${cred[1]}${cred[2]}:${REDACTED}${cred[1]}` : m;
        }
        return isSecretFlag(flag) ? `${flag}${sep}${REDACTED}` : m;
    });
    // -pSECRET (mysql, sshpass): an attached value that is not just digits / a port mapping
    out = out.replace(/(^|[\s'"])(-p)([^\s'"-][^\s'"]*)/g, (m, lead, flag, value) => (PORT_MAPPING_RE.test(value) || value === REDACTED ? m : `${lead}${flag}${REDACTED}`));
    return out;
}
const indentOf = (line) => line.length - line.trimStart().length;
const startsFlow = (v) => v.startsWith('{') || v.startsWith('[');
/** A quoted scalar that does not close on its own line (continues on the following lines). */
const opensMultiline = (v) => {
    const q = v[0];
    if (q !== '"' && q !== "'")
        return false;
    const rest = v.slice(1);
    return !(q === '"' ? /(^|[^\\])"/.test(rest) : rest.includes("'"));
};
/** A `name value…` directive line (redis.conf, fluent-bit, nginx) or a bare list item. */
function redactDirective(line) {
    const m = /^(\s*(?:-\s+)?)(.*)$/.exec(line);
    const lead = m?.[1] ?? '';
    const tokens = (m?.[2] ?? '').split(/(\s+)/); // keeps the separators at odd indexes
    for (let i = 0; i < tokens.length; i += 2) {
        const name = (tokens[i] ?? '').replace(/[:;]+$/, '');
        const next = tokens[i + 2];
        if (next === undefined)
            break;
        if (SENSITIVE_NAME_RE.test(name) && !isHarmless(next.replace(/;$/, ''))) {
            return `${lead}${tokens.slice(0, i + 2).join('')}${REDACTED}`;
        }
        // redis ACL: `user name on >password ~* +@all`
        if (i === 0 && name === 'user') {
            return `${lead}${tokens.map((t, k) => (k > 0 && /^[>#]/.test(t) ? `${t[0]}${REDACTED}` : t)).join('')}`;
        }
    }
    return redactUrlCredentials(line);
}
/**
 * Redact a docker-compose / dotenv / Dockerfile / config document and return one output line per
 * input line (so a diff of the original can be printed with the redacted text). Rules:
 * - `KEY=value` / `KEY: value` (list items and maps, quoted or not, quoted keys, JSON style) where
 *   KEY is UPPER_SNAKE, looks sensitive, or sits under an `environment:` block → value replaced,
 *   unless it is a pure `${VAR}` reference, a number or a boolean;
 * - a multi-line value under such a key (block scalar, value on the next lines, quoted scalar
 *   spanning lines) and any PEM block → every content line replaced;
 * - flow collections (`{ … }`, `[ … ]`) are replaced whole, except under keys known to be harmless;
 * - `command:` / `entrypoint:` / `test:` and Dockerfile `RUN` / `ENV` / `ARG` lines are treated as
 *   command lines: secret flags, their next argument, and assignments are replaced;
 * - `name value` directives whose name looks sensitive (`requirepass x`, `http_Passwd x`);
 * - credentials embedded in URLs and `Bearer …` tokens anywhere.
 * Line endings may be `\n` or `\r\n`.
 * Structure (service names, `image:` lines, ports, labels without secrets) stays readable, which is
 * what an agent needs to review an image bump or a diff.
 */
export function redactDocumentLines(text) {
    const out = [];
    let envIndent = -1; // indent of an open `environment:` key, -1 when outside
    let blockIndent = -1; // indent of a secret key whose multi-line value is being swallowed
    let cmdIndent = -1; // indent of an open `command:` / `entrypoint:` / `test:` list
    let cmdSecretNext = false; // the previous command argument was a flag that takes a secret
    let inPem = false;
    for (const rawLine of text.split('\n')) {
        // `.` does not match `\r`: without this, CRLF documents slipped past every pattern below.
        const cr = rawLine.endsWith('\r') ? '\r' : '';
        const line = cr ? rawLine.slice(0, -1) : rawLine;
        const push = (s) => { out.push(`${s}${cr}`); };
        const blank = line.trim() === '';
        const indent = indentOf(line);
        const hide = () => { push(blank ? line : `${line.slice(0, indent)}${REDACTED}`); };
        if (inPem) {
            if (PEM_END_RE.test(line))
                inPem = false;
            hide();
            continue;
        }
        if (blockIndent >= 0) {
            if (blank || indent > blockIndent) {
                hide();
                continue;
            }
            blockIndent = -1;
        }
        const isItem = /^\s*-(\s|$)/.test(line);
        // A list may sit at the same indent as its key (`environment:\n- A=b`), so only a non-item
        // line at that indent closes the block.
        if (envIndent >= 0 && !blank && (indent < envIndent || (indent === envIndent && !isItem)))
            envIndent = -1;
        if (cmdIndent >= 0 && !blank && (indent < cmdIndent || (indent === cmdIndent && !isItem))) {
            cmdIndent = -1;
            cmdSecretNext = false;
        }
        if (PEM_BEGIN_RE.test(line) && !PEM_END_RE.test(line)) {
            inPem = true;
            hide();
            continue;
        }
        const env = /^(\s*(?:-\s*)?(['"]?)environment\2\s*:\s*)(.*)$/.exec(line);
        if (env) {
            const inline = (env[3] ?? '').trim();
            // Empty, a comment, an anchor (`&env`) or a merge / alias: the variables follow on their own lines.
            // A lone opening bracket (JSON-style compose) also means the variables follow line by line.
            if (inline === '' || inline.startsWith('#') || inline === '{' || inline === '[' || /^[&*][A-Za-z0-9_-]+\s*(#.*)?$/.test(inline)) {
                envIndent = indent;
                push(line);
            }
            else {
                // Inline flow form (`environment: { KEY: value }`): no per-key structure to keep.
                push(`${env[1]}${REDACTED}`);
            }
            continue;
        }
        // Dockerfile: `ENV KEY=value …` / `ARG KEY=value` / legacy `ENV KEY value`; RUN / CMD / ENTRYPOINT are command lines.
        const df = /^(\s*(?:ENV|ARG)\s+)(.*)$/.exec(line);
        if (df) {
            const rest = df[2] ?? '';
            const legacy = /^([A-Za-z_][A-Za-z0-9_]*)(\s+)(\S.*)$/.exec(rest);
            push(`${df[1]}${legacy && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(rest)
                ? `${legacy[1]}${legacy[2]}${redactAssignedValue(legacy[3] ?? '')}`
                : rest.replace(/([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|\S+)/g, (_m, k, v) => `${k}=${redactAssignedValue(v)}`)}`);
            continue;
        }
        const run = /^(\s*(?:RUN|CMD|ENTRYPOINT|HEALTHCHECK)\s+)(.*)$/.exec(line);
        if (run) {
            push(`${run[1]}${redactCommandLine(run[2] ?? '')}`);
            continue;
        }
        // `"KEY": value` (quoted key, JSON-style compose) or `KEY: value` / `KEY=value` / `- 'KEY=value'`.
        const quotedKey = /^(\s*(?:-\s*)?)(['"])([^'"]+)\2(\s*:\s*)(.*)$/.exec(line);
        const plainKey = quotedKey ? null : /^(\s*(?:-\s*)?)(['"]?)(-{0,2}[A-Za-z_][A-Za-z0-9_.\-/]*)(\s*[=:]\s*)(.*)$/.exec(line);
        const m = quotedKey ?? plainKey;
        if (m) {
            const lead = m[1] ?? '';
            const key = m[3] ?? '';
            const sep = m[4] ?? '';
            let value = m[5] ?? '';
            const keyOpen = quotedKey ? `${quotedKey[2]}` : (m[2] ?? '');
            const keyText = quotedKey ? `${keyOpen}${key}${keyOpen}` : `${keyOpen}${key}`;
            // A quoted list item (`- 'KEY=value'`) closes its quote after the value.
            const trail = !quotedKey && keyOpen !== '' && value.endsWith(keyOpen) ? keyOpen : '';
            if (trail !== '')
                value = value.slice(0, -1);
            const v = value.trim();
            if (COMMAND_YAML_KEY_RE.test(key) && sep.includes(':')) {
                if (v === '' || v.startsWith('#')) {
                    cmdIndent = indent;
                    cmdSecretNext = false;
                    push(line);
                }
                else if (BLOCK_SCALAR_RE.test(v)) {
                    blockIndent = indent;
                    push(line);
                }
                else
                    push(`${lead}${keyText}${sep}${redactCommandLine(value)}${trail}`);
                continue;
            }
            const secretKey = ENV_KEY_RE.test(key) || SENSITIVE_NAME_RE.test(key) || (envIndent >= 0 && indent >= envIndent);
            if (secretKey) {
                if (BLOCK_SCALAR_RE.test(v) || v === '' || v.startsWith('#')) {
                    // Block scalar, or a value that starts on the next line: swallow what is indented under it.
                    blockIndent = indent;
                    push(line);
                    continue;
                }
                // A quoted scalar or a flow collection that continues on the next lines: swallow them too.
                if (opensMultiline(v) || (startsFlow(v) && !/[}\]]\s*,?\s*(#.*)?$/.test(v)))
                    blockIndent = indent;
                push(`${lead}${keyText}${sep}${startsFlow(v) ? REDACTED : redactAssignedValue(value)}${trail}`);
                continue;
            }
            if (startsFlow(v) && !SAFE_FLOW_KEY_RE.test(key)) {
                // `services: {app: {environment: {…}}}`: a flow collection can hide anything.
                push(`${lead}${keyText}${sep}${REDACTED}${trail}`);
                continue;
            }
            push(redactUrlCredentials(line));
            continue;
        }
        if (cmdIndent >= 0 && isItem) {
            // One argument of a command given as a YAML list.
            const item = /^(\s*-\s*)(.*)$/.exec(line);
            const body = (item?.[2] ?? '').trim();
            const bare = unquoteWord(body);
            const q = body !== bare ? (body[0] ?? '') : '';
            if (cmdSecretNext && !bare.startsWith('-') && !isHarmless(bare)) {
                push(`${item?.[1] ?? ''}${q}${REDACTED}${q}`);
                cmdSecretNext = false;
            }
            else {
                cmdSecretNext = isSecretFlag(bare);
                push(`${item?.[1] ?? ''}${redactCommandLine(body)}`);
            }
            continue;
        }
        if (envIndent >= 0 && isItem && indent >= envIndent) {
            // `- KEY` (pass-through) is fine; anything else in an env list that is not KEY=value is hidden.
            push(/^\s*-\s*['"]?[A-Za-z_][A-Za-z0-9_]*['"]?\s*(#.*)?$/.test(line) ? line : `${line.slice(0, indent)}- ${REDACTED}`);
            continue;
        }
        push(redactDirective(line));
    }
    return out;
}
/** `redactDocumentLines` joined back into one document. */
export function redactDocument(text) {
    return redactDocumentLines(text).join('\n');
}
/**
 * Deep-copy `input` with secrets redacted. Strings under sensitive keys become `[REDACTED] (N chars)`
 * — including every string nested under such a key; compose/config documents are redacted line by
 * line; commands keep their shape but lose inline secrets; credentials inside any URL are stripped.
 * `logs` is deliberately left alone — logs are an explicit, `read:sensitive`-scoped request and
 * Coolify already masks env values in them.
 */
export function redactDeep(input) {
    const walk = (value, key, forced) => {
        if (typeof value === 'string') {
            if (forced)
                return value === '' ? value : redactValue(value);
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
            return value.map((v) => walk(v, key, forced));
        if (value !== null && typeof value === 'object') {
            const out = {};
            // Everything under a sensitive key is secret (`secrets: { db: '…' }`), documents excepted.
            const inherit = forced || (SENSITIVE_KEY_RE.test(key) && !DOCUMENT_KEY_RE.test(key));
            for (const [k, v] of Object.entries(value))
                out[k] = walk(v, k, inherit);
            return out;
        }
        return value;
    };
    return walk(input, '', false); // reason: walk preserves the structural shape of T; only string leaves change
}
