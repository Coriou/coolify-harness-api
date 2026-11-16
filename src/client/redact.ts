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
 * secret-bearing construct is replaced. Every pattern here is linear-time: the input is whatever
 * a compose file or a start command contains, and a slow pattern would hang `status`.
 */

/** Names (object keys, compose keys, flags, directives) whose value is always secret. */
const SENSITIVE_NAME =
  'pass(?:word|wd|phrase)?|secret|token|api[_-]?key|private[_-]?key|license[_-]?key|access[_-]?key|credential|' +
  'auth[_-]?(?:user|header|hash)|basic[_-]?auth|digestauth|masterauth|requirepass|hmac|dsn|salt|cookie|signature|' +
  'customrequestheaders|customresponseheaders';

/** Object keys whose string values are always secret. */
const SENSITIVE_KEY_RE = new RegExp(
  `(${SENSITIVE_NAME}|^value$|^values$|^real_value$|custom_labels|custom_docker_run_options|init_scripts|health_check_response_text)`,
  'i',
);

/**
 * A name inside a document / command line that marks its value as secret. Wider than the object
 * key rule: here a name ENDING in `key` (`Jwt__Key`, `widget.key`, `X-Auth-Key`) counts too, which
 * would be wrong for API payloads, where `key` is the field holding a variable's name.
 */
const SENSITIVE_NAME_RE = new RegExp(`(${SENSITIVE_NAME}|pwd|authorization|conninfo|(^|[._-])key$)`, 'i');

/** Object keys whose string values are docker-compose / config documents: redact line by line. */
const DOCUMENT_KEY_RE =
  /^(compose|docker_compose(_raw)?|configuration|last_saved_proxy_configuration|dockerfile|custom_nginx_configuration|logdrain_custom_config|proxy_error_page|[a-z]+_conf)$/i;

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
 * password. The password runs to the LAST `@` of the URL: passwords contain `@`, `/`, `?`, and
 * cutting too late only hides more of the URL.
 */
const URL_CREDS_RE = /([a-z][a-z0-9+.-]*:\/\/)([^\s:/@'"]*):([^\s'"]*)@/gi;
/** `https://TOKEN@host` — a lone userinfo on http(s) is a token (git remotes), not a username. */
const URL_TOKEN_RE = /(https?:\/\/)([^\s:/@'"]{8,})@/gi;
/** `?password=…&access_token=…&X-Amz-Signature=…` in a URL or a connection string. */
const URL_QUERY_SECRET_RE = /([?&;][^=&\s'"#;]{0,40}(?:pass|pwd|token|secret|key|sig|credential)[^=&\s'"#;]{0,40}=)([^&\s'"#;]+)/gi;
/** `Bearer xyz` anywhere. A Coolify token contains `|`, so: any non-space run. */
const BEARER_RE = /\b(bearer)([ \t]+)([^\s'"]{8,})/gi;
/** `Authorization: Basic xyz` / `Authorization: token xyz` (only after the header name: both are plain words too). */
const AUTH_HEADER_RE = /(authorization["']?[ \t]*[:=][ \t]*["']?)(basic|token|bearer)([ \t]+)([^\s'"]+)/gi;
/** YAML block scalar header: `|`, `>`, with chomping / indentation indicators and an optional comment. */
const BLOCK_SCALAR_RE = /^[|>][+-]?\d*[+-]?\s*(#.*)?$/;
const PEM_BEGIN_RE = /-----BEGIN [A-Z0-9 ]+-----/;
const PEM_END_RE = /-----END [A-Z0-9 ]+-----/;
/** Compose keys whose value is a command line (inline or as a list of arguments). */
const COMMAND_YAML_KEY_RE = /^(command|entrypoint|test)$/i;
/** Flow collections under these keys carry no secret and are worth reading. */
const SAFE_FLOW_KEY_RE = /^(ports|expose|networks|depends_on|dns|cap_add|cap_drop|profiles|aliases|tmpfs)$/i;
/** A long command flag whose value is a secret: `--requirepass`, `--api-key`, `--password`. */
const SECRET_LONG_FLAG_RE = new RegExp(`^--?[A-Za-z0-9._-]*(${SENSITIVE_NAME}|pwd|key)[A-Za-z0-9._-]*$`, 'i');
/** Short flags are case-sensitive: `-p` is a password (mysql, sshpass), `-P` a port; `-h` a host. */
const SECRET_SHORT_FLAG_RE = /^(-a|-p)$/;
const isSecretFlag = (flag: string): boolean => SECRET_SHORT_FLAG_RE.test(flag) || SECRET_LONG_FLAG_RE.test(flag);
/** docker `-p 8080:80` / `-p 127.0.0.1:80:80/tcp` is a port mapping, not a password. */
const PORT_MAPPING_RE = /^[\d.:[\]-]+(\/(tcp|udp|sctp))?$/;
/** Flags taking `user:password` (curl). */
const USERPASS_FLAG_RE = /^(-u|--user|--proxy-user)$/;
const HEADER_FLAG_RE = /^(-H|--header)$/;

export const REDACTED = '[REDACTED]';

export function redactValue(value: string): string {
  return `${REDACTED} (${value.length} chars)`;
}

/** Strip credentials embedded in URLs, secret query parameters and auth-scheme tokens anywhere in `text`. */
export function redactUrlCredentials(text: string): string {
  return text
    .replace(URL_CREDS_RE, (_m, scheme: string, user: string) => `${scheme}${user}:${REDACTED}@`)
    .replace(URL_TOKEN_RE, (_m, scheme: string) => `${scheme}${REDACTED}@`)
    .replace(URL_QUERY_SECRET_RE, (_m, lead: string) => `${lead}${REDACTED}`)
    .replace(AUTH_HEADER_RE, (_m, lead: string, scheme: string, gap: string) => `${lead}${scheme}${gap}${REDACTED}`)
    .replace(BEARER_RE, (_m, scheme: string, gap: string) => `${scheme}${gap}${REDACTED}`);
}

/**
 * Nothing to hide: empty, a pure `${VAR}` reference, a boolean or a small number.
 * `strict` (the name says "password", "secret", "token", …) does not let numbers through: a
 * numeric password is still a password.
 */
function isHarmless(inner: string, strict = false): boolean {
  if (inner === '' || inner === REDACTED || PURE_REF_RE.test(inner)) return true;
  return strict ? /^(true|false|null|~)$/i.test(inner) : BORING_RE.test(inner);
}

function redactAssignedValue(raw: string, strict = false): string {
  const quoted = /^(['"])(.*)\1$/s.exec(raw.trim());
  const q = quoted?.[1] ?? '';
  const inner = quoted?.[2] ?? raw.trim();
  if (isHarmless(inner, strict)) return raw;
  // `${VAR:-default}` / `${VAR:?msg}`: keep the reference, hide the literal default.
  const withDefault = /^\$\{([A-Za-z_][A-Za-z0-9_]*)(:?[-?=+])(.*)\}$/s.exec(inner);
  if (withDefault) {
    return withDefault[3] === '' ? raw : `${q}\${${withDefault[1]}${withDefault[2]}${REDACTED}}${q}`;
  }
  return `${q}${REDACTED}${q}`;
}

// ── command lines ───────────────────────────────────────────────────────────

interface Token {
  /** The token as written, quotes included. */
  text: string;
  kind: 'space' | 'word';
  /** Content without the surrounding quotes (and without a `\"` escape of the quotes). */
  value: string;
  /** Opening delimiter (`"`, `'`, `\"`) or '' for a bare word. */
  open: string;
  /** Closing delimiter; '' when the quote never closes. */
  close: string;
}

/**
 * Split a command line into words and separators, in one pass. Separators are whitespace and the
 * punctuation of an exec-form array (`["a", "b"]`): `[`, `]`, `,`. A word is a quoted string
 * (single, double with escapes, or the escaped `\"…\"` of a command nested in a string) or a bare
 * run up to the next whitespace.
 */
function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i]!;
    if (/[\s,[\]]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\s,[\]]/.test(text[j]!)) j += 1;
      out.push({ text: text.slice(i, j), kind: 'space', value: '', open: '', close: '' });
      i = j;
      continue;
    }
    const open = c === '"' || c === "'" ? c : (c === '\\' && text[i + 1] === '"' ? '\\"' : '');
    if (open !== '') {
      let j = i + open.length;
      let closed = false;
      while (j < n) {
        if (open === '\\"') { if (text[j] === '\\' && text[j + 1] === '"') { closed = true; break; } }
        else if (open === '"' && text[j] === '\\') { j += 2; continue; }
        else if (text[j] === open) { closed = true; break; }
        j += 1;
      }
      const end = closed ? j + open.length : n;
      out.push({ text: text.slice(i, end), kind: 'word', value: text.slice(i + open.length, closed ? j : n), open, close: closed ? open : '' });
      i = end;
      continue;
    }
    let j = i;
    // A bare word runs to whitespace; `--flag="quoted value"` keeps its quoted part.
    while (j < n && !/\s/.test(text[j]!)) {
      if (text[j] === '"' || text[j] === "'") {
        const q = text[j]!;
        let k = j + 1;
        while (k < n && text[k] !== q) k += (q === '"' && text[k] === '\\') ? 2 : 1;
        j = Math.min(n, k + 1);
        continue;
      }
      j += 1;
    }
    // Trailing array punctuation (`x,` / `x]`) is a separator, not part of the word.
    let end = j;
    while (end > i + 1 && /[,\]]/.test(text[end - 1]!)) end -= 1;
    const word = text.slice(i, end);
    out.push({ text: word, kind: 'word', value: word, open: '', close: '' });
    i = end;
  }
  return out;
}

const hidden = (t: Token): string => `${t.open}${REDACTED}${t.close}`;
const stripQuotes = (v: string): string => v.replace(/^(['"])([\s\S]*)\1$/, '$2');

/** One word of a command line that is not the value of a preceding flag. */
function redactWord(t: Token, depth: number): string {
  const v = t.value;
  // A quoted word holding a whole command (`sh -c "export X=… && psql"`) or a header line.
  if (t.open !== '' && /\s/.test(v)) {
    const header = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(\S[\s\S]*)$/.exec(v);
    if (header && SENSITIVE_NAME_RE.test(header[1] ?? '')) return `${t.open}${header[1]}: ${REDACTED}${t.close}`;
    return depth < 3 ? `${t.open}${redactCommand(v, depth + 1)}${t.close}` : hidden(t);
  }
  // name=value: an env assignment, `--flag=value`, npm `…:_authToken=value`.
  const eq = v.indexOf('=');
  if (eq > 0) {
    const name = v.slice(0, eq);
    const value = v.slice(eq + 1);
    const bare = name.replace(/^.*[:/]/, ''); // `//registry/:_authToken` → `_authToken`
    const sensitive = SENSITIVE_NAME_RE.test(bare) || isSecretFlag(name);
    if ((sensitive || ENV_KEY_RE.test(bare)) && !isHarmless(stripQuotes(value), sensitive)) {
      return `${t.open}${name}=${REDACTED}${t.close}`;
    }
  }
  // -pSECRET (mysql, sshpass): an attached value that is not a port mapping.
  if (t.open === '' && /^-p[^-]/.test(v) && !PORT_MAPPING_RE.test(v.slice(2))) return `-p${REDACTED}`;
  const cleaned = redactUrlCredentials(v);
  return cleaned === v ? t.text : `${t.open}${cleaned}${t.close}`;
}

function redactCommand(text: string, depth: number): string {
  const tokens = tokenize(text);
  let out = '';
  /** The flag whose value the next word is, if any. */
  let pending: 'secret' | 'userpass' | 'header' | undefined;
  let pendingFlag = '';
  for (const t of tokens) {
    if (t.kind === 'space') { out += t.text; continue; }
    const v = t.value;
    if (pending !== undefined && !(t.open === '' && v.startsWith('-'))) {
      const kind = pending;
      pending = undefined;
      // Only docker's `-p 8080:80` is a port mapping; a number after `--requirepass` is a password.
      if (kind === 'secret') { out += isHarmless(v, true) || (pendingFlag === '-p' && PORT_MAPPING_RE.test(v)) ? t.text : hidden(t); continue; }
      if (kind === 'userpass') {
        const colon = v.indexOf(':');
        out += colon > 0 ? `${t.open}${v.slice(0, colon)}:${REDACTED}${t.close}` : t.text;
        continue;
      }
      // header: hide the value of a sensitive header, keep the others
      const header = /^([^:]+):[ \t]*([\s\S]*)$/.exec(v);
      out += header && SENSITIVE_NAME_RE.test(header[1] ?? '') ? `${t.open}${header[1]}: ${REDACTED}${t.close}` : redactWord(t, depth);
      continue;
    }
    pending = undefined;
    if (!v.includes('=')) {
      if (HEADER_FLAG_RE.test(v)) pending = 'header';
      else if (USERPASS_FLAG_RE.test(v)) pending = 'userpass';
      else if (isSecretFlag(v)) pending = 'secret';
      pendingFlag = v;
    }
    out += redactWord(t, depth);
  }
  return out;
}

/**
 * Redact the secrets a shell command or a docker option string can carry: `KEY=value`
 * assignments, `--password=…` / `--token …` flags, `-p…` / `-a …` / `-u user:pass`, header values,
 * auth-scheme tokens and URL credentials — in shell form and in exec form (`["a", "--pw", "x"]`).
 * The command itself stays readable.
 */
export function redactCommandLine(text: string): string {
  return redactCommand(text, 0);
}

// ── documents ───────────────────────────────────────────────────────────────

const indentOf = (line: string): number => line.length - line.trimStart().length;
const startsFlow = (v: string): boolean => v.startsWith('{') || v.startsWith('[');
/** A quoted scalar that does not close on its own line (continues on the following lines). */
const opensMultiline = (v: string): boolean => {
  const q = v[0];
  if (q !== '"' && q !== "'") return false;
  const rest = v.slice(1);
  return !(q === '"' ? /(^|[^\\])"/.test(rest) : rest.includes("'"));
};
/** `key:` with nothing after it, or a list item: the start of a nested mapping / sequence. */
const NESTED_RE = /^\s*(-(\s|$)|['"]?[A-Za-z0-9_.\-/]+['"]?\s*:(\s|$))/;

/** A `name value…` directive line (redis.conf, fluent-bit, nginx), else a line of a command. */
function redactDirective(line: string): string {
  const m = /^(\s*(?:-\s+)?)([\s\S]*)$/.exec(line);
  const lead = m?.[1] ?? '';
  const tokens = (m?.[2] ?? '').split(/(\s+)/); // keeps the separators at odd indexes
  for (let i = 0; i < tokens.length; i += 2) {
    const raw = tokens[i] ?? '';
    const name = raw.replace(/[:;]+$/, '');
    const next = tokens[i + 2];
    if (next === undefined) break;
    // A directive NAME is a plain word: not an assignment, a URL or a flag (those are command words).
    if (/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name) && SENSITIVE_NAME_RE.test(name) && !isHarmless(next.replace(/;$/, ''), true)) {
      return `${lead}${tokens.slice(0, i + 2).join('')}${REDACTED}`;
    }
    // redis ACL: `user name on >password ~* +@all`
    if (i === 0 && name === 'user') {
      return `${lead}${tokens.map((t, k) => (k > 0 && /^[>#]/.test(t) ? `${t[0]}${REDACTED}` : t)).join('')}`;
    }
  }
  return redactCommandLine(line);
}

/**
 * Redact a docker-compose / dotenv / Dockerfile / config document and return one output line per
 * input line (so a diff of the original can be printed with the redacted text). Rules:
 * - `KEY=value` / `KEY: value` (list items and maps, quoted or not, quoted keys, JSON style) where
 *   KEY is UPPER_SNAKE, looks sensitive, or sits under an `environment:` block → value replaced,
 *   unless it is a pure `${VAR}` reference, a boolean or (for a non-sensitive name) a small number;
 * - a multi-line value under such a key (block scalar, value on the next lines, quoted scalar
 *   spanning lines) and any PEM block → every content line replaced;
 * - flow collections (`{ … }`, `[ … ]`) are replaced whole, except under keys known to be harmless;
 * - `command:` / `entrypoint:` / `test:` (inline, YAML list, flow list over several lines) and
 *   Dockerfile `RUN` / `CMD` / `ENV` / `ARG` lines with their continuations are command lines:
 *   secret flags, the argument after them, and assignments are replaced;
 * - `name value` directives whose name looks sensitive (`requirepass x`, `http_Passwd x`);
 * - credentials embedded in URLs and `Bearer …` tokens anywhere;
 * - a comment never opens or closes anything, and is redacted like the line it comments out.
 * Line endings may be `\n` or `\r\n`.
 * Structure (service names, `image:` lines, ports, labels without secrets) stays readable, which is
 * what an agent needs to review an image bump or a diff.
 */
export function redactDocumentLines(text: string): string[] {
  const lines = text.split('\n');
  const out: string[] = [];
  let envIndent = -1; // indent of an open `environment:` key, -1 when outside
  let blockIndent = -1; // indent of a secret key whose multi-line value is being swallowed
  let cmdIndent = -1; // indent of an open `command:` / `entrypoint:` / `test:` list
  let cmdSecretNext = false; // the previous command argument was a flag that takes a secret
  let inPem = false;
  let runContinues = false; // inside a Dockerfile RUN / CMD continued with a trailing backslash

  /** Is the first non-blank line after `from` a nested mapping / sequence indented deeper than `indent`? */
  const nestedFollows = (from: number, indent: number): boolean => {
    for (let k = from; k < lines.length; k += 1) {
      const next = (lines[k] ?? '').replace(/\r$/, '');
      if (next.trim() === '' || next.trimStart().startsWith('#')) continue;
      return indentOf(next) > indent && NESTED_RE.test(next);
    }
    return false;
  };

  for (let idx = 0; idx < lines.length; idx += 1) {
    const rawLine = lines[idx] ?? '';
    // `.` does not match `\r`: without this, CRLF documents slipped past every pattern below.
    const cr = rawLine.endsWith('\r') ? '\r' : '';
    const line = cr ? rawLine.slice(0, -1) : rawLine;
    const push = (s: string): void => { out.push(`${s}${cr}`); };
    const blank = line.trim() === '';
    const indent = indentOf(line);
    const hide = (): void => { push(blank ? line : `${line.slice(0, indent)}${REDACTED}`); };

    if (inPem) {
      if (PEM_END_RE.test(line)) inPem = false;
      hide();
      continue;
    }
    if (blockIndent >= 0) {
      if (blank || indent > blockIndent) { hide(); continue; }
      blockIndent = -1;
    }
    if (runContinues) {
      runContinues = /\\\s*$/.test(line);
      push(redactCommandLine(line));
      continue;
    }
    // A comment changes no state. What it comments out is redacted like a live line.
    if (/^\s*#/.test(line)) {
      const body = /^(\s*#+\s*)([\s\S]*)$/.exec(line);
      const inside = envIndent >= 0 || cmdIndent >= 0;
      const kv = /^(['"]?)([A-Za-z_][A-Za-z0-9_.\-/]*)\1\s*[=:]\s*\S/.exec(body?.[2] ?? '');
      push(inside || (kv && (ENV_KEY_RE.test(kv[2] ?? '') || SENSITIVE_NAME_RE.test(kv[2] ?? '')))
        ? `${body?.[1] ?? '# '}${REDACTED}`
        : redactCommandLine(line));
      continue;
    }
    const isItem = /^\s*-(\s|$)/.test(line);
    // A list may sit at the same indent as its key (`environment:\n- A=b`), so only a non-item
    // line at that indent closes the block.
    if (envIndent >= 0 && !blank && (indent < envIndent || (indent === envIndent && !isItem))) envIndent = -1;
    if (cmdIndent >= 0 && !blank && (indent < cmdIndent || (indent === cmdIndent && !isItem && !/^\s*[\]}]/.test(line)))) { cmdIndent = -1; cmdSecretNext = false; }
    if (PEM_BEGIN_RE.test(line) && !PEM_END_RE.test(line)) {
      inPem = true;
      hide();
      continue;
    }

    const env = /^(\s*(?:-\s*)?(['"]?)environment\2\s*:\s*)([\s\S]*)$/.exec(line);
    if (env) {
      const inline = (env[3] ?? '').trim();
      // Empty, a comment, a lone opening bracket (JSON-style compose), an anchor (`&env`), an
      // alias or a tag (`!override`): the variables follow on their own lines.
      if (inline === '' || inline.startsWith('#') || inline === '{' || inline === '[' || /^[&*!][^\s{[]*\s*(#.*)?$/.test(inline)) {
        envIndent = indent;
        push(line);
      } else {
        // Inline flow form (`environment: { KEY: value }`): no per-key structure to keep.
        push(`${env[1]}${REDACTED}`);
      }
      continue;
    }
    // Dockerfile: `ENV KEY=value …` / `ARG KEY=value` / legacy `ENV KEY value`; RUN / CMD / ENTRYPOINT are command lines.
    const df = /^(\s*(?:ENV|ARG)\s+)([\s\S]*)$/.exec(line);
    if (df) {
      const rest = df[2] ?? '';
      const legacy = /^([A-Za-z_][A-Za-z0-9_]*)(\s+)(\S[\s\S]*)$/.exec(rest);
      push(`${df[1]}${legacy && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(rest)
        ? `${legacy[1]}${legacy[2]}${redactAssignedValue(legacy[3] ?? '', true)}`
        : rest.replace(/([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|\S+)/g, (_m, k: string, v: string) => `${k}=${redactAssignedValue(v, true)}`)}`);
      runContinues = /\\\s*$/.test(line);
      continue;
    }
    const run = /^(\s*(?:RUN|CMD|ENTRYPOINT|HEALTHCHECK)\s+)([\s\S]*)$/.exec(line);
    if (run) {
      push(`${run[1]}${redactCommandLine(run[2] ?? '')}`);
      runContinues = /\\\s*$/.test(line);
      continue;
    }

    // `"KEY": value` (quoted key, JSON-style compose) or `KEY: value` / `KEY=value` / `- 'KEY=value'`.
    const quotedKey = /^(\s*(?:-\s*)?)(['"])([^'"]+)\2(\s*:\s*)([\s\S]*)$/.exec(line);
    const plainKey = quotedKey ? null : /^(\s*(?:-\s*)?)(['"]?)(-{0,2}[A-Za-z_][A-Za-z0-9_.\-/]*)(\s*[=:]\s*)([\s\S]*)$/.exec(line);
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
      if (trail !== '') value = value.slice(0, -1);
      const v = value.trim();
      const inEnv = envIndent >= 0 && indent >= envIndent;

      // Inside `environment:`, a variable may be NAMED `command` or `test`: it is still a variable.
      if (!inEnv && COMMAND_YAML_KEY_RE.test(key) && sep.includes(':')) {
        if (v === '' || v.startsWith('#') || v === '[') { cmdIndent = indent; cmdSecretNext = false; push(line); }
        else if (BLOCK_SCALAR_RE.test(v)) { blockIndent = indent; push(line); }
        else push(`${lead}${keyText}${sep}${redactCommandLine(value)}${trail}`);
        continue;
      }
      const sensitiveName = SENSITIVE_NAME_RE.test(key);
      if (ENV_KEY_RE.test(key) || sensitiveName || inEnv) {
        if (BLOCK_SCALAR_RE.test(v)) { blockIndent = indent; push(line); continue; }
        if (v === '' || v.startsWith('#')) {
          // Nothing on this line. A nested mapping / list below (a service called `supertokens`,
          // the top-level `secrets:` section) is structure, kept readable line by line; a plain
          // continuation is the value itself, swallowed.
          if (inEnv || !nestedFollows(idx + 1, indent)) blockIndent = indent;
          push(line);
          continue;
        }
        // A quoted scalar or a flow collection that continues on the next lines: swallow them too.
        if (opensMultiline(v) || (startsFlow(v) && !/[}\]]\s*,?\s*(#.*)?$/.test(v))) blockIndent = indent;
        push(`${lead}${keyText}${sep}${startsFlow(v) ? REDACTED : redactAssignedValue(value, sensitiveName)}${trail}`);
        continue;
      }
      if (startsFlow(v) && v.length > 1 && !SAFE_FLOW_KEY_RE.test(key)) {
        // `services: {app: {environment: {…}}}`: a flow collection can hide anything.
        push(`${lead}${keyText}${sep}${REDACTED}${trail}`);
        continue;
      }
      push(redactCommandLine(line));
      continue;
    }

    if (cmdIndent >= 0 && !blank) {
      // One argument of a command given as a YAML list (`- x`) or a flow list over several lines
      // (`"x",`); anything else in there (a `- |` script) is a command line.
      const item = /^(\s*(?:-\s*)?)([\s\S]*?)(\s*,?\s*)$/.exec(line);
      const body = (item?.[2] ?? '').trim();
      if (/^[[\]]$/.test(body) || body === '') { push(line); continue; }
      const words = tokenize(body).filter((t) => t.kind === 'word');
      const single = words.length === 1 ? words[0] : undefined;
      if (single) {
        const bare = single.value;
        if (cmdSecretNext && !(single.open === '' && bare.startsWith('-')) && !isHarmless(bare, true)) {
          push(`${item?.[1] ?? ''}${single.open}${REDACTED}${single.close}${item?.[3] ?? ''}`);
          cmdSecretNext = false;
        } else {
          cmdSecretNext = !bare.includes('=') && isSecretFlag(bare);
          push(`${item?.[1] ?? ''}${redactCommandLine(body)}${item?.[3] ?? ''}`);
        }
      } else {
        cmdSecretNext = false;
        push(`${item?.[1] ?? ''}${redactCommandLine(body)}${item?.[3] ?? ''}`);
      }
      continue;
    }
    if (envIndent >= 0 && isItem && indent >= envIndent) {
      // `- KEY` (pass-through) is fine; anything else in an env list that is not KEY=value is hidden.
      push(/^\s*-\s*['"]?[A-Za-z_][A-Za-z0-9_]*['"]?\s*(#.*)?$/.test(line) ? line : `${line.slice(0, indent)}- ${REDACTED}`);
      continue;
    }
    // A whole document on one line (minified JSON compose) or a stray flow collection.
    const trimmed = line.trim();
    if (startsFlow(trimmed) && trimmed.length > 2) { hide(); continue; }
    push(redactDirective(line));
  }
  return out;
}

/** `redactDocumentLines` joined back into one document. */
export function redactDocument(text: string): string {
  return redactDocumentLines(text).join('\n');
}

/**
 * Deep-copy `input` with secrets redacted. Strings under sensitive keys become `[REDACTED] (N chars)`
 * — including every string nested under such a key; compose/config documents are redacted line by
 * line; commands keep their shape but lose inline secrets; credentials inside any URL are stripped.
 * `logs` is deliberately left alone — logs are an explicit, `read:sensitive`-scoped request and
 * Coolify already masks env values in them.
 */
export function redactDeep<T>(input: T): T {
  const walk = (value: unknown, key: string, forced: boolean): unknown => {
    if (typeof value === 'string') {
      if (forced) return value === '' ? value : redactValue(value);
      if (key === 'logs') return value;
      if (DOCUMENT_KEY_RE.test(key)) return redactDocument(value);
      if (SENSITIVE_KEY_RE.test(key)) return value === '' ? value : redactValue(value);
      if (COMMAND_KEY_RE.test(key)) return redactCommandLine(value);
      return redactUrlCredentials(value);
    }
    if (Array.isArray(value)) return value.map((v) => walk(v, key, forced));
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      // Everything under a sensitive key is secret (`secrets: { db: '…' }`), documents excepted.
      const inherit = forced || (SENSITIVE_KEY_RE.test(key) && !DOCUMENT_KEY_RE.test(key));
      for (const [k, v] of Object.entries(value)) out[k] = walk(v, k, inherit);
      return out;
    }
    return value;
  };
  return walk(input, '', false) as T; // reason: walk preserves the structural shape of T; only string leaves change
}
