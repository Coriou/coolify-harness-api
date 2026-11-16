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
 * secret-bearing construct is replaced. It is a heuristic, not a parser: it knows the shapes
 * compose files, Dockerfiles, dotenv files and proxy configurations really take.
 *
 * Every scan here is linear in the input (anchored patterns, single passes, bounded look-behind):
 * the input is whatever a compose file or a start command contains, and a pattern that backtracks
 * would hang `status`. `test/redaction-round3.test.ts` times each entry point on hostile input.
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
 * key rule: here a name ENDING in `key` (`Jwt__Key`, `widget.key`, `sharedkey`) counts too, which
 * would be wrong for API payloads, where `key` is the field holding a variable's name.
 */
const SENSITIVE_NAME_RE = new RegExp(`(${SENSITIVE_NAME}|pwd|(^|[._-])pw$|authorization|conninfo|key$)`, 'i');

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
/** `?password=…&access_token=…&X-Amz-Signature=…` in a URL or a connection string. */
const URL_QUERY_SECRET_RE = /([?&;][^=&\s'"#;]{0,40}(?:pass|pwd|token|secret|key|sig|credential)[^=&\s'"#;]{0,40}=)([^&\s'"#;]+)/gi;
/** `<password>…</password>` (XML configuration embedded in a document or a command). */
const XML_SECRET_RE = /<([A-Za-z][A-Za-z0-9_.:-]{0,60})>([^<\s][^<]{0,2000})<\//g;
/**
 * `Bearer xyz` anywhere. A Coolify token contains `|`, so: any non-space run — including one
 * wrapped in escaped quotes (`Bearer \"xyz\"` inside a JSON or YAML string), which must go with
 * it: cutting at the backslash left the token standing behind a broken quote.
 */
const BEARER_RE = /\b(bearer)([ \t]+)((?:\\.|[^\s'"\\]){8,})/gi;
/** `Basic dXNlcjpwYXNz…` in running text: the word is ordinary, so only before a long base64-like run. */
const BASIC_RE = /\b(basic)([ \t]+)([A-Za-z0-9+/=_-]{16,})(?![A-Za-z0-9+/=_-])/gi;
/** `Authorization: Basic xyz` / `Authorization: token xyz` (only after the header name: both are plain words too). */
const AUTH_HEADER_RE = /(authorization["']?[ \t]*[:=][ \t]*(?:\\?["'])?)(basic|token|bearer)([ \t]+)((?:\\.|[^\s'"\\])+)/gi;
/** YAML block scalar header: `|`, `>`, with chomping / indentation indicators and an optional comment. */
const BLOCK_SCALAR_RE = /^[|>][+-]?\d*[+-]?\s*(#.*)?$/;
const PEM_BEGIN_RE = /-----BEGIN [A-Z0-9 ]+-----/;
const PEM_END_RE = /-----END [A-Z0-9 ]+-----/;
/**
 * What cannot be a line of a PEM body: a list item, a `key: value` / `key:` mapping line or a
 * `NAME=value` assignment (base64 has no `:` and `=` only as trailing padding) — the two RFC 1421
 * headers of an encrypted key excepted.
 */
const NOT_PEM_BODY_RE = /^\s*(-\s|(?!Proc-Type:|DEK-Info:)['"]?[A-Za-z_][A-Za-z0-9_.\-/]*['"]?\s*(:(\s|$)|=[^=\s]))/;
/** Compose keys whose value is a command line (inline or as a list of arguments). */
const COMMAND_YAML_KEY_RE = /^(command|entrypoint|test)$/i;
/** Flow collections under these keys carry no secret and are worth reading. */
const SAFE_FLOW_KEY_RE = /^(ports|expose|networks|depends_on|dns|cap_add|cap_drop|profiles|aliases|tmpfs)$/i;
/** A long command flag whose value is a secret: `--requirepass`, `--api-key`, `--password`. */
const FLAG_SHAPE_RE = /^--?[A-Za-z0-9._-]+$/;
const SECRET_FLAG_NAME_RE = new RegExp(`(${SENSITIVE_NAME}|pwd|key)`, 'i');
/** Short flags are case-sensitive: `-p` is a password (mysql, sshpass), `-P` a port; `-h` a host. */
const SECRET_SHORT_FLAG_RE = /^(-a|-p)$/;
const isSecretFlag = (flag: string): boolean =>
  SECRET_SHORT_FLAG_RE.test(flag) || (FLAG_SHAPE_RE.test(flag) && SECRET_FLAG_NAME_RE.test(flag));
/** Flags taking `user:password` (curl). */
const USERPASS_FLAG_RE = /^(-u|--user|--proxy-user)$/;
const HEADER_FLAG_RE = /^(-H|--header)$/;
/** A plain word that names the secret after it inside a quoted command (`… login x password y`). */
const PLAIN_SECRET_WORD_RE = /^(pass|password|passwd|passphrase|requirepass|masterauth|secret|token)$/i;
/** Flags whose value is a `name=value` pair that sets a variable: its value is hidden whatever the name. */
const ASSIGN_FLAG_RE = /^(-e|--env|--build-arg|--set|--set-string|--from-literal)$/;
/** Shell words after which `name=value` words are still variable assignments. */
const ASSIGN_WORD_RE = /^(export|env|declare|local|readonly|typeset)$/;
/** Where a new command starts inside a command line. */
const COMMAND_BREAK_RE = /^(;|&&|\|\||\||then|do|else)$/;
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Top-level compose sections whose direct children are NAMES (of services, volumes, secrets…). */
const SECTION_RE = /^(services|volumes|networks|configs|secrets)[ \t]*:[ \t]*(#.*)?$/;
/** Header names that carry a credential beyond the general list (`X-Custom-Auth`, `X-Session-Id`). */
const HEADER_SECRET_RE = /(auth|session|csrf|xsrf)/i;
/** Password hashes (bcrypt, apr1, sha-crypt, argon2), also with compose's doubled `$$`. */
const HASH_RE = /\$\$?(?:2[abxy]|apr1|5|6|argon2(?:id|i|d)?)\$\$?[^\s'"]{8,}/g;
/** Webhook URLs whose PATH is the credential. */
const WEBHOOK_RE = /(hooks\.slack\.com\/services\/|discord(?:app)?\.com\/api\/webhooks\/|api\.telegram\.org\/bot)[^\s'"]+/gi;
/** Lone userinfo on these schemes is a user name (`ssh://git@host`), not a token. */
const USER_ONLY_SCHEME_RE = /^(ssh|sftp|scp|rsync|git|git\+ssh|ssh\+git)$/i;

export const REDACTED = '[REDACTED]';

export function redactValue(value: string): string {
  return `${REDACTED} (${value.length} chars)`;
}

/**
 * docker `-p 8080:80` / `-p 127.0.0.1:80:80/tcp` is a port mapping, not a password. A bare number
 * counts only up to five digits: `-p12345678` is a numeric password, not a port.
 */
function isPortMapping(v: string): boolean {
  const proto = /\/(tcp|udp|sctp)$/.exec(v);
  const body = proto ? v.slice(0, proto.index) : v;
  if (body === '' || !/^[\d.:[\]-]+$/.test(body)) return false;
  return body.includes(':') || /^\d{1,5}(-\d{1,5})?$/.test(body);
}

const isSchemeChar = (c: number): boolean =>
  (c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a) || (c >= 0x30 && c <= 0x39) || c === 0x2b || c === 0x2e || c === 0x2d;
const isLetter = (c: number): boolean => (c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a);
/** Whitespace or a quote: where a URL written in running text ends. */
const endsUrl = (c: number): boolean => c === 0x20 || (c >= 0x09 && c <= 0x0d) || c === 0x22 || c === 0x27;

/**
 * A userinfo without a password: on http(s) anything of 8+ characters is a token (git remotes).
 * Elsewhere it is usually a user name (`postgres://readonly@db`), unless it reads like a secret:
 * long, or letters and digits mixed (`redis://s3cr3tValue99@cache`).
 */
function isLoneToken(userinfo: string, scheme: string): boolean {
  if (USER_ONLY_SCHEME_RE.test(scheme)) return false;
  if (/^https?$/i.test(scheme)) return userinfo.length >= 8;
  return userinfo.length >= 20 || (userinfo.length >= 12 && /\d/.test(userinfo) && /[A-Za-z]/.test(userinfo));
}

/**
 * `scheme://user:password@host` — keep the user (may be empty, as in `redis://:pw@host`, or hold
 * an `@`, as in `smtp://me@example.com:pw@host`), drop the password. The password runs to the LAST
 * `@` of the URL: passwords contain `@`, `/`, `?`, and cutting too late only hides more of the
 * URL. A lone userinfo is a token when it reads like one (see isLoneToken).
 *
 * One pass: each `://` is found with indexOf, its scheme read backwards over at most 32
 * characters, and the rest of the URL scanned once.
 */
function redactUrlUserinfo(text: string): string {
  let out = '';
  let pos = 0;
  for (;;) {
    const sep = text.indexOf('://', pos);
    if (sep < 0) break;
    let s = sep;
    while (s > pos && sep - s < 32 && isSchemeChar(text.charCodeAt(s - 1))) s -= 1;
    while (s < sep && !isLetter(text.charCodeAt(s))) s += 1;
    let end = sep + 3;
    while (end < text.length && !endsUrl(text.charCodeAt(end))) end += 1;
    const run = text.slice(sep + 3, end);
    const at = run.lastIndexOf('@');
    let replaced: string | undefined;
    if (s < sep && at >= 0) {
      const userinfo = run.slice(0, at);
      const colon = userinfo.indexOf(':');
      if (colon >= 0) {
        const user = userinfo.slice(0, colon);
        if (!user.includes('/')) replaced = `${user}:${REDACTED}${run.slice(at)}`;
      } else if (!userinfo.includes('/') && !userinfo.includes('@') && isLoneToken(userinfo, text.slice(s, sep))) {
        replaced = `${REDACTED}${run.slice(at)}`;
      }
    }
    out += text.slice(pos, sep + 3) + (replaced ?? run);
    pos = end;
  }
  return pos === 0 ? text : out + text.slice(pos);
}

/**
 * `user:password@tcp(host:3306)/db` (a Go DSN: no scheme to anchor on). Each `@tcp(` / `@unix(` is
 * found with indexOf and the `user:` before it read backwards once; the result is built in one go.
 */
function redactGoDsn(text: string): string {
  let out = '';
  let pos = 0;
  // Each marker's next position is searched again only once it has been passed: looking for an
  // absent one from every position would re-read the rest of the text each time.
  let tcp = text.indexOf('@tcp(');
  let unix = text.indexOf('@unix(');
  for (;;) {
    if (tcp >= 0 && tcp < pos) tcp = text.indexOf('@tcp(', pos);
    if (unix >= 0 && unix < pos) unix = text.indexOf('@unix(', pos);
    const at = tcp < 0 ? unix : unix < 0 ? tcp : Math.min(tcp, unix);
    if (at < 0) break;
    let start = at;
    while (start > pos && !endsUrl(text.charCodeAt(start - 1)) && text.charAt(start - 1) !== '=') start -= 1;
    const colon = text.slice(start, at).indexOf(':');
    out += colon < 0 ? text.slice(pos, at + 1) : `${text.slice(pos, start + colon + 1)}${REDACTED}@`;
    pos = at + 1;
  }
  return pos === 0 ? text : out + text.slice(pos);
}

/** Secrets one word can hold by itself: URL credentials, secret query parameters, XML elements, hashes. */
function scrubWord(text: string): string {
  let out = redactUrlUserinfo(text);
  if (out.includes('$')) out = out.replace(HASH_RE, REDACTED);
  if (out.includes('(')) out = redactGoDsn(out);
  if (out.includes('/')) out = out.replace(WEBHOOK_RE, (_m, lead: string) => `${lead}${REDACTED}`);
  if (out.includes('=')) out = out.replace(URL_QUERY_SECRET_RE, (_m, lead: string) => `${lead}${REDACTED}`);
  if (out.includes('</')) {
    out = out.replace(XML_SECRET_RE, (m, name: string) => (SENSITIVE_NAME_RE.test(name) ? `<${name}>${REDACTED}</` : m));
  }
  return out;
}

/** Secrets that span two words: `Authorization: Basic xyz`, `Bearer xyz`. */
function scrubSchemes(text: string): string {
  return text
    .replace(AUTH_HEADER_RE, (_m, lead: string, scheme: string, gap: string) => `${lead}${scheme}${gap}${REDACTED}`)
    .replace(BEARER_RE, (_m, scheme: string, gap: string) => `${scheme}${gap}${REDACTED}`)
    .replace(BASIC_RE, (_m, scheme: string, gap: string) => `${scheme}${gap}${REDACTED}`);
}

/** Strip credentials embedded in URLs, secret query parameters and auth-scheme tokens anywhere in `text`. */
export function redactUrlCredentials(text: string): string {
  return scrubSchemes(scrubWord(text));
}

/**
 * Nothing to hide: empty, a pure `${VAR}` reference, a boolean or a small number.
 * `strict` (the name says "password", "secret", "token", …) does not let numbers through: a
 * numeric password is still a password. `refs: false` where `$WORD` is not expanded (a directive
 * file, a single-quoted shell word): there it is a literal that merely starts with `$`.
 */
function isHarmless(inner: string, strict = false, refs = true): boolean {
  if (inner === '' || inner === REDACTED) return true;
  if (refs && PURE_REF_RE.test(inner)) return true;
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

/** `s` without the trailing characters in `chars` (a loop: `/[:;]+$/` re-scans from every position). */
function trimTrailing(s: string, chars: string): string {
  let end = s.length;
  while (end > 0 && chars.includes(s.charAt(end - 1))) end -= 1;
  return end === s.length ? s : s.slice(0, end);
}

// ── command lines ───────────────────────────────────────────────────────────

interface Token {
  /** The token as written, quotes included. */
  text: string;
  kind: 'space' | 'word';
  /** Content without the surrounding quotes (and without a `\"` escape of the quotes). */
  value: string;
  /** Opening delimiter (`"`, `'`, `\"`) or '' for a bare or composite word. */
  open: string;
  /** Closing delimiter; '' when the quote never closes. */
  close: string;
}

/** What a command line leaves for the next line / list item: a flag still waiting for its value. */
interface Carry {
  pending?: 'secret' | 'userpass' | 'header' | 'assign';
  flag: string;
}

const isBlank = (c: string): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v';
/** Whitespace and the punctuation of an exec-form array (`["a", "b"]`). */
const isSeparator = (c: string): boolean => isBlank(c) || c === ',' || c === '[' || c === ']';

/**
 * Index just after the quote opened at `i`, and whether it closed. Double quotes honour `\`, and
 * so does an ANSI-C `$'…'` string (`escapes`).
 */
function endOfQuote(text: string, i: number, escapes = false): { end: number; closed: boolean } {
  const q = text.charAt(i);
  let j = i + 1;
  while (j < text.length) {
    if ((q === '"' || escapes) && text.charAt(j) === '\\') { j += 2; continue; }
    if (text.charAt(j) === q) return { end: j + 1, closed: true };
    j += 1;
  }
  return { end: text.length, closed: false };
}

/**
 * Index of the `\"` that closes a string opened by `\"` (a string nested in a double-quoted one),
 * searching from `from`; -1 when there is none. One level deeper, quotes are written `\\\"`: a
 * run of three or more backslashes before a quote belongs to the content, not to the delimiter.
 */
function closingEscapedQuote(text: string, from: number): number {
  let j = from;
  while (j < text.length) {
    if (text.charAt(j) !== '\\') { j += 1; continue; }
    let run = 1;
    while (text.charAt(j + run) === '\\') run += 1;
    if (text.charAt(j + run) === '"') {
      if (run === 1) return j;
      j += run + 1;
    } else {
      j += run;
    }
  }
  return -1;
}

/**
 * Split a command line into words and separators, in one pass. A word is what a shell would call
 * one: a quoted string, a bare run, or both glued together (`--flag="a b"`, `'it'\''s'`, `a\ b`,
 * `$'x'`) up to the next unquoted whitespace. A quoted string that stands alone keeps its quotes
 * apart (`open` / `close`) so its content can be judged; the escaped `\"…\"` of a command nested
 * in a string counts as one.
 */
function tokenize(text: string): Token[] {
  const out: Token[] = [];
  const n = text.length;
  let i = 0;
  // Once a search for a closing `\"` has run to the end without finding one, no later search
  // will: searching again from every `\"` would re-read the rest of the line each time.
  let noClosingEscapedQuote = false;
  const closeOf = (from: number): number => {
    if (noClosingEscapedQuote) return -1;
    const at = closingEscapedQuote(text, from);
    if (at < 0) noClosingEscapedQuote = true;
    return at;
  };
  while (i < n) {
    const c = text.charAt(i);
    // What an earlier pass already hid is one harmless word, not array punctuation around a word.
    if (c === '[' && text.startsWith(REDACTED, i)) {
      out.push({ text: REDACTED, kind: 'word', value: REDACTED, open: '', close: '' });
      i += REDACTED.length;
      continue;
    }
    if (isSeparator(c)) {
      let j = i + 1;
      while (j < n && isSeparator(text.charAt(j))) j += 1;
      out.push({ text: text.slice(i, j), kind: 'space', value: '', open: '', close: '' });
      i = j;
      continue;
    }
    if (c === '\\' && text.charAt(i + 1) === '"') {
      const at = closeOf(i + 2);
      const closed = at >= 0;
      const j = closed ? at : n;
      const end = closed ? j + 2 : n;
      out.push({ text: text.slice(i, end), kind: 'word', value: text.slice(i + 2, closed ? j : n), open: '\\"', close: closed ? '\\"' : '' });
      i = end;
      continue;
    }
    let j = i;
    if (c === '"' || c === "'") {
      const q = endOfQuote(text, i);
      // Alone (followed by a separator or the end): a quoted word, judged by its content.
      if (!q.closed || q.end >= n || isSeparator(text.charAt(q.end))) {
        out.push({ text: text.slice(i, q.end), kind: 'word', value: text.slice(i + 1, q.closed ? q.end - 1 : n), open: c, close: q.closed ? c : '' });
        i = q.end;
        continue;
      }
      j = q.end;
    }
    while (j < n) {
      const d = text.charAt(j);
      if (d === '\\') {
        // `--header=\"X-Api-Key: value\"` (a command inside a string): up to the closing `\"`.
        const close = text.charAt(j + 1) === '"' ? closeOf(j + 2) : -1;
        j = close >= 0 ? close + 2 : j + 2;
        continue;
      }
      if (d === '"' || d === "'") { j = endOfQuote(text, j, d === "'" && text.charAt(j - 1) === '$').end; continue; }
      // `$(…)` and backticks hold a command with its own blanks: one word (`X=$(cat f)`).
      if (d === '$' && text.charAt(j + 1) === '(') {
        let depth = 0;
        for (j += 1; j < n; j += 1) {
          if (text.charAt(j) === '(') depth += 1;
          else if (text.charAt(j) === ')') { depth -= 1; if (depth === 0) { j += 1; break; } }
        }
        continue;
      }
      if (d === '`') { const close = text.indexOf('`', j + 1); j = close < 0 ? n : close + 1; continue; }
      if (isBlank(d)) break;
      j += 1;
    }
    j = Math.min(j, n);
    // Trailing array punctuation (`x,` / `x]`) is a separator, not part of the word.
    let end = j;
    while (end > i + 1 && (text.charAt(end - 1) === ',' || text.charAt(end - 1) === ']')) end -= 1;
    const word = text.slice(i, end);
    out.push({ text: word, kind: 'word', value: word, open: '', close: '' });
    i = end;
  }
  return out;
}

const hidden = (t: Token): string => `${t.open}${REDACTED}${t.close}`;
/** Without its surrounding quotes: `'…'`, `"…"`, or the `\"…\"` of a string nested in a string. */
const stripQuotes = (v: string): string =>
  (v.length >= 4 && v.startsWith('\\"') && v.endsWith('\\"') ? v.slice(2, -2) : v.replace(/^(['"])([\s\S]*)\1$/, '$2'));

/**
 * A word glued from quoted and bare parts (`'echo hi'\''; redis-cli -a "x"'`, `sh -c 'a'"b c"`):
 * each quoted part that holds blanks is a command of its own, judged by its content.
 */
function redactComposite(v: string, depth: number): string {
  let out = '';
  let bare = 0;
  let i = 0;
  while (i < v.length) {
    const c = v.charAt(i);
    if (c === '\\') { i += 2; continue; }
    if (c !== '"' && c !== "'") { i += 1; continue; }
    const q = endOfQuote(v, i, c === "'" && v.charAt(i - 1) === '$');
    const inner = v.slice(i + 1, q.closed ? q.end - 1 : q.end);
    const close = q.closed ? c : '';
    out += scrubWord(v.slice(bare, i));
    if (/\s/.test(inner)) out += depth < 3 ? `${c}${redactCommand(inner, depth + 1)}${close}` : `${c}${REDACTED}${close}`;
    else out += `${c}${scrubWord(inner)}${close}`;
    i = q.end;
    bare = i;
  }
  return out + scrubWord(v.slice(bare));
}

/** `Name: value` of a header whose name is sensitive, with the value hidden; else undefined. */
function hiddenHeader(line: string): string | undefined {
  const header = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(\S[\s\S]*)$/.exec(line);
  const name = header?.[1] ?? '';
  return header && (SENSITIVE_NAME_RE.test(name) || HEADER_SECRET_RE.test(name)) ? `${name}: ${REDACTED}` : undefined;
}

/** `name=value` with the value hidden (anything else is hidden whole: it stood where an assignment belongs). */
function hiddenAssignment(word: string): string {
  const eq = word.indexOf('=');
  // `-e NAME` passes a variable through by name: nothing to hide.
  if (eq <= 0) return IDENT_RE.test(word) || isHarmless(word, true) ? word : REDACTED;
  return isHarmless(stripQuotes(word.slice(eq + 1))) ? word : `${word.slice(0, eq)}=${REDACTED}`;
}

/** One word of a command line that is not the value of a preceding flag. */
function redactWord(t: Token, depth: number): string {
  const v = t.value;
  // -pSECRET (mysql, sshpass), quoted or not: an attached value that is not a port mapping.
  if (/^-p[^-\s=]/.test(v) && !isPortMapping(v.slice(2))) return `${t.open}-p${REDACTED}${t.close}`;
  // -uUSER:PASSWORD (curl).
  if (v.startsWith('-u') && v.length > 3 && v.charAt(2) !== '-' && v.charAt(2) !== '=') {
    const colon = v.indexOf(':');
    if (colon > 2) return `${t.open}${v.slice(0, colon)}:${REDACTED}${t.close}`;
  }
  // JSON / YAML flow text that names a secret (`--config '{"password":"…"}'`): hidden whole.
  if (v.length > 2 && /^\s*[{[]/.test(v) && SENSITIVE_NAME_RE.test(v)) return hidden(t);
  if (t.open !== '' && /\s/.test(v)) {
    // `"--header=Authorization: Bearer x"` / `"X-Api-Key: x"`: a header line in one quoted word.
    const flagged = /^(-H|--header)=([\s\S]*)$/.exec(v);
    const header = hiddenHeader(flagged ? (flagged[2] ?? '') : v);
    if (header !== undefined) return `${t.open}${flagged ? `${flagged[1]}=` : ''}${header}${t.close}`;
    // A whole command (`sh -c "export X=… && psql"`).
    return depth < 3 ? `${t.open}${redactCommand(v, depth + 1)}${t.close}` : hidden(t);
  }
  // name=value: an env assignment, `--flag=value`, npm `…:_authToken=value`.
  const eq = v.indexOf('=');
  if (eq > 0) {
    const name = v.slice(0, eq);
    const value = v.slice(eq + 1);
    if (HEADER_FLAG_RE.test(name)) {
      const header = hiddenHeader(stripQuotes(value));
      if (header !== undefined) return `${t.open}${name}=${header}${t.close}`;
    }
    // `--user=name:password`
    if (USERPASS_FLAG_RE.test(name) && value.includes(':')) return `${t.open}${name}=${value.slice(0, value.indexOf(':'))}:${REDACTED}${t.close}`;
    // `--env=name=value`, `--from-literal=name=value`
    if (ASSIGN_FLAG_RE.test(name)) return `${t.open}${name}=${hiddenAssignment(value)}${t.close}`;
    const bare = name.replace(/^.*[:/]/, ''); // `//registry/:_authToken` → `_authToken`
    const sensitive = SENSITIVE_NAME_RE.test(bare) || isSecretFlag(name);
    // In single quotes the shell expands nothing: `'$WORD'` is a literal there.
    if ((sensitive || ENV_KEY_RE.test(bare)) && !isHarmless(stripQuotes(value), sensitive, !value.startsWith("'"))) {
      return `${t.open}${name}=${REDACTED}${t.close}`;
    }
    // `registry=//host/:_authToken=value`: the name that matters is the one before the LAST `=`.
    const lastEq = v.lastIndexOf('=');
    if (lastEq > eq && SENSITIVE_NAME_RE.test(v.slice(eq + 1, lastEq).replace(/^.*[:/&?;,]/, '')) && !isHarmless(stripQuotes(v.slice(lastEq + 1)), true)) {
      return `${t.open}${v.slice(0, lastEq)}=${REDACTED}${t.close}`;
    }
  }
  // `--password:value`
  const colon = v.indexOf(':');
  if (colon > 1 && v.startsWith('-') && isSecretFlag(v.slice(0, colon)) && !isHarmless(v.slice(colon + 1), true)) {
    return `${t.open}${v.slice(0, colon)}:${REDACTED}${t.close}`;
  }
  // Blanks in a bare word mean quoted parts glued together: each is judged by its content.
  if (t.open === '' && /\s/.test(v)) return redactComposite(v, depth);
  const cleaned = scrubWord(v);
  return cleaned === v ? t.text : `${t.open}${cleaned}${t.close}`;
}

/**
 * `comments`: an unquoted ` # …` ends the command (shell and YAML agree on that); the comment is
 * redacted as text and does not take the place of a flag's value. Off inside a comment, so a line
 * of `#` words cannot recurse.
 */
function redactCommand(text: string, depth: number, carry: Carry = { flag: '' }, comments = true): string {
  const tokens = tokenize(text);
  let lastWord = -1;
  for (let k = tokens.length - 1; k >= 0; k -= 1) if (tokens[k]?.kind === 'word') { lastWord = k; break; }
  let out = '';
  /** The flag whose value the next word is, if any. */
  let pending = carry.pending;
  let pendingFlag = carry.flag;
  /** At the start of a command, where `name=value` words set variables for it (`A=1 b=2 node x`). */
  let leading = carry.pending === undefined;
  /** The program being run, as far as it matters here (`redis-cli -aSECRET`). */
  let program = '';
  for (let k = 0; k < tokens.length; k += 1) {
    const t = tokens[k];
    if (t === undefined) break;
    if (t.kind === 'space') { out += t.text; continue; }
    const v = t.value;
    // A line continuation is not the value of the flag before it: that value is on the next line.
    if (k === lastWord && t.open === '' && v === '\\') { out += t.text; continue; }
    // `--password = value`: the separator is not the value.
    if (pending !== undefined && t.open === '' && (v === '=' || v === ':')) { out += t.text; continue; }
    if (comments && depth === 0 && t.open === '' && v.startsWith('#') && (k === 0 || tokens[k - 1]?.kind === 'space')) {
      out += redactComment(tokens.slice(k).map((x) => x.text).join(''), false);
      break;
    }
    if (pending !== undefined && !(t.open === '' && v.startsWith('-'))) {
      const kind = pending;
      pending = undefined;
      if (kind === 'secret') {
        // Only docker's `-p 8080:80` is a port mapping; a number after `--requirepass` is a
        // password. A `$WORD` in single quotes is a literal, not a reference.
        out += isHarmless(v, true, t.open !== "'") || (pendingFlag === '-p' && isPortMapping(v)) ? t.text : hidden(t);
        continue;
      }
      if (kind === 'userpass') {
        const colon = v.indexOf(':');
        out += colon > 0 ? `${t.open}${v.slice(0, colon)}:${REDACTED}${t.close}` : t.text;
        continue;
      }
      if (kind === 'assign') { out += `${t.open}${hiddenAssignment(v)}${t.close}`; continue; }
      // header: hide the value of a sensitive header, keep the others
      const header = hiddenHeader(v);
      out += header !== undefined ? `${t.open}${header}${t.close}` : redactWord(t, depth);
      continue;
    }
    pending = undefined;
    if (t.open === '' && COMMAND_BREAK_RE.test(v)) { leading = true; program = ''; out += t.text; continue; }
    if (leading && t.open === '') {
      // `NAME=value` before the program (or after `export` / `env`): an assignment, whatever its case.
      const eq = v.indexOf('=');
      if (eq > 0 && IDENT_RE.test(v.slice(0, eq))) {
        const sensitive = SENSITIVE_NAME_RE.test(v.slice(0, eq));
        out += isHarmless(stripQuotes(v.slice(eq + 1)), sensitive) ? redactWord(t, depth) : `${v.slice(0, eq)}=${REDACTED}`;
        continue;
      }
      if (!ASSIGN_WORD_RE.test(v)) { leading = false; program = v; }
    } else if (leading) {
      leading = false;
    }
    if (!v.includes('=')) {
      if (HEADER_FLAG_RE.test(v)) pending = 'header';
      else if (USERPASS_FLAG_RE.test(v)) pending = 'userpass';
      else if (ASSIGN_FLAG_RE.test(v)) pending = 'assign';
      else if (isSecretFlag(v) || (depth > 0 && PLAIN_SECRET_WORD_RE.test(v))) pending = 'secret';
      pendingFlag = v;
    }
    // redis-cli takes its password attached: `-aSECRET` (elsewhere `-al`, `-aux` are switches).
    if (t.open === '' && /redis-cli$/.test(program) && /^-a[^-=\s]/.test(v)) { out += `-a${REDACTED}`; continue; }
    out += redactWord(t, depth);
  }
  carry.flag = pendingFlag;
  if (pending === undefined) delete carry.pending;
  else carry.pending = pending;
  return out;
}

/**
 * Redact the secrets a shell command or a docker option string can carry: `KEY=value`
 * assignments, `--password=…` / `--token …` flags, `-p…` / `-a …` / `-u user:pass`, header values,
 * auth-scheme tokens and URL credentials — in shell form and in exec form (`["a", "--pw", "x"]`).
 * The command itself stays readable.
 */
export function redactCommandLine(text: string): string {
  return redactCommandPart(text, { flag: '' });
}

/**
 * A command line that may continue a previous one (a YAML list of arguments, a `\` continuation).
 * Scheme tokens (`Bearer x`) are scrubbed before the words are judged — a word pass that hides
 * `…authorization=Bearer` would leave the token after it standing — and once more after.
 */
function redactCommandPart(text: string, carry: Carry, comments = true): string {
  return scrubSchemes(redactCommand(scrubSchemes(text), 0, carry, comments));
}

// ── documents ───────────────────────────────────────────────────────────────

const indentOf = (line: string): number => line.length - line.trimStart().length;
const startsFlow = (v: string): boolean => v.startsWith('{') || v.startsWith('[');
/** Does a flow collection that starts on this line also end on it? */
const flowCloses = (v: string): boolean => /[}\]]$/.test(trimTrailing(v.trimEnd(), ',').trimEnd());

/**
 * Index of the quote that closes a YAML / dotenv quoted scalar in `text` (which starts AFTER the
 * opening quote), or -1 when it does not close here. `\x` is an escape in double quotes, `''` in
 * single quotes.
 */
function closingQuoteIndex(text: string, q: string): number {
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charAt(i);
    if (q === '"' && c === '\\') { i += 1; continue; }
    if (c !== q) continue;
    if (q === "'" && text.charAt(i + 1) === "'") { i += 1; continue; }
    return i;
  }
  return -1;
}

/** `key:` with nothing after it, or a list item: the start of a nested mapping / sequence. */
const NESTED_RE = /^\s*(-(\s|$)|['"]?[A-Za-z0-9_.\-/]+['"]?\s*:(\s|$))/;
/** A directive NAME is a plain word: not an assignment, a URL or a flag (those are command words). */
const PLAIN_NAME_RE = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

/** A `name value…` directive line (redis.conf, fluent-bit, nginx, .netrc), else a line of a command. */
function redactDirective(line: string, comments = true): string {
  const lead = /^\s*(?:-\s+)?/.exec(line)?.[0] ?? '';
  const tokens = line.slice(lead.length).split(/(\s+)/); // keeps the separators at odd indexes
  for (let i = 0; i < tokens.length; i += 2) {
    const raw = tokens[i] ?? '';
    if (comments && raw.startsWith('#')) break; // the rest is a comment: the command pass redacts it
    // `"password" x`, `set $api_key "x";`, `password: x`, `@password x`
    const name = stripQuotes(trimTrailing(raw, ':;')).replace(/^[$@]/, '');
    const next = tokens[i + 2];
    if (next === undefined) break;
    // In a directive file `$WORD` is not expanded: it is a literal that happens to start with `$`.
    if (PLAIN_NAME_RE.test(name) && SENSITIVE_NAME_RE.test(name) && !isHarmless(stripQuotes(trimTrailing(next, ';')), true, false)) {
      return `${lead}${tokens.slice(0, i + 2).join('')}${REDACTED}`;
    }
    // redis ACL: `user name on >password ~* +@all`, `ACL SETUSER name on >password`
    if ((i === 0 && name === 'user') || /^setuser$/i.test(name)) {
      return `${lead}${tokens.map((t, k) => (k > 0 && /^[>#]/.test(t) ? `${t.charAt(0)}${REDACTED}` : t)).join('')}`;
    }
  }
  return redactCommandPart(line, { flag: '' }, comments);
}

/**
 * A comment (`# …`, from the `#`). It changes no state; what it comments out is redacted like a
 * live line: a commented `KEY=value`, a directive, a command.
 */
function redactComment(text: string, hideAll: boolean): string {
  let i = 0;
  while (i < text.length && text.charAt(i) === '#') i += 1;
  while (i < text.length && (text.charAt(i) === ' ' || text.charAt(i) === '\t')) i += 1;
  const marker = text.slice(0, i);
  const body = text.slice(i);
  if (body === '') return text;
  if (hideAll) return `${marker}${REDACTED}`;
  const kv = /^(?:-\s*)?(['"]?)([A-Za-z_][A-Za-z0-9_.\-/]*)\1\s*[=:]\s*\S/.exec(body);
  if (kv && (ENV_KEY_RE.test(kv[2] ?? '') || SENSITIVE_NAME_RE.test(kv[2] ?? ''))) return `${marker}${REDACTED}`;
  return `${marker}${redactDirective(body, false)}`;
}

/**
 * The arguments of a Dockerfile `ENV` / `ARG` instruction, or one of its continuation lines:
 * every `NAME=value` loses its value (whatever the name), the legacy `ENV NAME value…` too.
 */
function redactEnvInstruction(rest: string, continuation: boolean): string {
  const tokens = tokenize(rest);
  const words = tokens.filter((t) => t.kind === 'word');
  const first = words[0];
  const legacy = !continuation && first !== undefined && !first.value.includes('=') && words.length > 1;
  let out = '';
  let seen = 0;
  for (const t of tokens) {
    if (t.kind === 'space') { if (!(legacy && seen >= 2)) out += t.text; continue; }
    seen += 1;
    const v = t.value;
    if (legacy) {
      // `ENV NAME some value`: the first word is the name, everything after it the value.
      if (seen === 1) out += t.text;
      else if (seen === 2) out += words.length === 2 && isHarmless(stripQuotes(v), true) ? t.text : REDACTED;
      continue;
    }
    if (t.open === '' && v === '\\') { out += t.text; continue; }
    const eq = v.indexOf('=');
    if (eq > 0) out += isHarmless(stripQuotes(v.slice(eq + 1)), true) ? t.text : `${t.open}${v.slice(0, eq)}=${REDACTED}${t.close}`;
    else out += continuation || t.open !== '' ? hidden(t) : t.text;
  }
  return out;
}

/** The value of a compose `command:` given inline. A YAML single-quoted scalar doubles its quotes. */
function redactYamlCommand(value: string): string {
  const lead = value.length - value.trimStart().length;
  const v = value.trim();
  if (v.length >= 2 && v.startsWith("'") && closingQuoteIndex(v.slice(1), "'") === v.length - 2) {
    const inner = v.slice(1, -1).replace(/''/g, "'");
    return `${value.slice(0, lead)}'${redactCommandLine(inner).replace(/'/g, "''")}'${value.slice(lead + v.length)}`;
  }
  return redactCommandLine(value);
}

/**
 * Redact a docker-compose / dotenv / Dockerfile / config document and return one output line per
 * input line (so a diff of the original can be printed with the redacted text). Rules:
 * - `KEY=value` / `KEY: value` (list items and maps, quoted or not, quoted keys, JSON style) where
 *   KEY is UPPER_SNAKE, looks sensitive, or sits under an `environment:` block → value replaced,
 *   unless it is a pure `${VAR}` reference, a boolean or (for a non-sensitive name) a small number;
 * - what follows such a value is hidden while it can only be its continuation: deeper lines (a
 *   block scalar, a plain scalar folded over several lines) and, for a quoted scalar that does not
 *   close on its line, every line up to the closing quote;
 * - a mapping or list nested under a sensitive key keeps its structure and loses its leaves
 *   (`passwords:\n  admin: …`, `users:\n  - "admin:$apr1$…"`); only the names directly under a
 *   top-level compose section (a service called `supertokens`) and the top-level `secrets:` /
 *   `configs:` sections are not "sensitive keys";
 * - any line holding a PEM `BEGIN` marker, and the PEM body after it;
 * - flow collections (`{ … }`, `[ … ]`) are replaced whole, except under keys known to be harmless;
 * - `command:` / `entrypoint:` / `test:` (inline, YAML list, flow list over several lines) and
 *   Dockerfile `RUN` / `CMD` / `ENV` / `ARG` lines with their continuations are command lines:
 *   secret flags, the argument after them — also when it sits on the next line or list item — and
 *   assignments are replaced;
 * - `name value` directives whose name looks sensitive (`requirepass x`, `http_Passwd x`);
 * - credentials embedded in URLs and `Bearer …` tokens anywhere;
 * - a comment (a whole line or the end of one) never opens or closes anything, and is redacted
 *   like the line it comments out.
 * Line breaks may be `\n`, `\r\n` or a lone `\r` (a YAML line break too).
 * Structure (service names, `image:` lines, ports, labels without secrets) stays readable, which is
 * what an agent needs to review an image bump or a diff.
 */
export function redactDocumentLines(text: string): string[] {
  // One entry per `\n` line in the result; a `\r` inside it separates pieces that are lines too.
  const rawLines = text.split('\n');
  const pieces: string[] = [];
  const owner: number[] = [];
  rawLines.forEach((raw, n) => {
    if (!raw.includes('\r')) { pieces.push(raw); owner.push(n); return; }
    for (const piece of raw.split('\r')) { pieces.push(piece); owner.push(n); }
  });
  const done: string[] = [];

  let envIndent = -1; // indent of an open `environment:` key (or sensitive key with nested content), -1 outside
  let envForced = false; // …opened by a sensitive key: list items are values, not variable names
  let blockIndent = -1; // column of a key whose multi-line value is being swallowed
  let quote = ''; // inside a quoted scalar that did not close on its own line
  let quoteLines = 0;
  let cmdIndent = -1; // indent of an open `command:` / `entrypoint:` / `test:` list
  let cmdFlow = false; // …written as a flow list `[ … ]` that is still open
  const cmdCarry: Carry = { flag: '' };
  let inPem = false;
  let pemIndent = 0; // indent of the BEGIN line
  let continues: '' | 'run' | 'env' = ''; // inside a Dockerfile instruction continued with `\`
  const runCarry: Carry = { flag: '' };
  let section = ''; // the top-level compose section we are in
  let sectionChildIndent = -1; // indent of the names directly under it

  /** Is the first non-blank line after `from` a nested mapping / sequence indented deeper than `indent`? */
  const nestedFollows = (from: number, indent: number): boolean => {
    for (let k = from; k < pieces.length; k += 1) {
      const next = pieces[k] ?? '';
      if (next.trim() === '' || next.trimStart().startsWith('#')) continue;
      return indentOf(next) > indent && NESTED_RE.test(next);
    }
    return false;
  };
  const endsWithBackslash = (line: string): boolean => line.trimEnd().endsWith('\\');

  for (let idx = 0; idx < pieces.length; idx += 1) {
    const line = pieces[idx] ?? '';
    const push = (s: string): void => { done.push(s); };
    const blank = line.trim() === '';
    const indent = indentOf(line);
    const hide = (): void => { push(blank ? line : `${line.slice(0, indent)}${REDACTED}`); };

    if (quote !== '') {
      // Up to the closing quote, whatever the indent. Bounded: a stray quote must not hide a document.
      quoteLines += 1;
      if (closingQuoteIndex(line, quote) >= 0 || quoteLines >= 400) quote = '';
      hide();
      continue;
    }
    if (inPem) {
      if (PEM_END_RE.test(line)) { inPem = false; hide(); continue; }
      if (blank || (indent >= pemIndent && !NOT_PEM_BODY_RE.test(line))) { hide(); continue; }
      // A dedent or a line of YAML structure: the marker was text (a label, a note), or the block
      // never closed. Hiding on would swallow the rest of the document — and with it whatever a
      // diff should show.
      inPem = false;
    }
    if (blockIndent >= 0) {
      if (blank || indent > blockIndent) { hide(); continue; }
      blockIndent = -1;
    }
    if (continues !== '') {
      const mode: 'run' | 'env' = continues;
      continues = endsWithBackslash(line) ? mode : '';
      push(mode === 'env' ? `${line.slice(0, indent)}${redactEnvInstruction(line.slice(indent), true)}` : redactCommandPart(line, runCarry));
      continue;
    }
    // A PEM marker anywhere on the line — also in a comment, also with its END on the same line.
    if (PEM_BEGIN_RE.test(line)) {
      inPem = !PEM_END_RE.test(line);
      pemIndent = indent;
      hide();
      continue;
    }
    // A comment changes no state. What it comments out is redacted like a live line.
    if (/^\s*#/.test(line)) {
      push(`${line.slice(0, indent)}${redactComment(line.slice(indent), envIndent >= 0 || cmdIndent >= 0)}`);
      continue;
    }
    const isItem = /^\s*-(\s|$)/.test(line);
    // A list may sit at the same indent as its key (`environment:\n- A=b`), so only a non-item
    // line at that indent closes the block.
    if (envIndent >= 0 && !blank && (indent < envIndent || (indent === envIndent && !isItem))) { envIndent = -1; envForced = false; }
    if (cmdIndent >= 0 && !blank && (indent < cmdIndent || (indent === cmdIndent && !isItem && !/^\s*[\]}]/.test(line)))) {
      cmdIndent = -1; cmdFlow = false; delete cmdCarry.pending;
    }
    if (!blank && indent === 0) {
      section = SECTION_RE.test(line) ? (/^[a-z]+/.exec(line)?.[0] ?? '') : '';
      sectionChildIndent = -1;
    } else if (!blank && section !== '' && sectionChildIndent < 0) {
      sectionChildIndent = indent;
    }

    if (cmdIndent >= 0 && !blank) {
      // Inside a command given as a YAML list (`- x`) or a flow list over several lines (`"x",`).
      // BEFORE the key rules: an argument is an argument even when it looks like `key=value`, and
      // the flag on the previous item may be waiting for it (`- --requirepass` / `- secret`).
      const leadLen = (/^\s*(?:-\s*)?/.exec(line)?.[0] ?? '').length;
      const body = trimTrailing(line.slice(leadLen).trimEnd(), ',').trimEnd();
      const tail = line.slice(leadLen + body.length);
      if (cmdFlow && body.endsWith(']')) { cmdFlow = false; cmdIndent = -1; }
      if (body === '' || body === '[' || body === ']' || BLOCK_SCALAR_RE.test(body)) { push(line); continue; }
      push(`${line.slice(0, leadLen)}${redactCommandPart(body, cmdCarry)}${tail}`);
      if (cmdIndent < 0) delete cmdCarry.pending;
      continue;
    }

    // `environment:` and the keys that hold variables the same way: build `args:`, a k8s / CI
    // style `env:`, and extension fields meant to be merged in (`x-common-env: &env`).
    const env = /^(\s*(?:-\s*)?(['"]?)(?:environment|env|args|x-[A-Za-z0-9_.-]*(?:environment|env|envs|variables))\2\s*:\s*)([\s\S]*)$/.exec(line);
    if (env) {
      const inline = (env[3] ?? '').trim();
      // Empty, a comment, a lone opening bracket (JSON-style compose), an anchor (`&env`), an
      // alias or a tag (`!override`): the variables follow on their own lines.
      if (inline === '' || inline.startsWith('#') || inline === '{' || inline === '[' || /^[&*!][^\s{[]*\s*(#.*)?$/.test(inline)) {
        envIndent = indent;
        envForced = false;
        push(line);
      } else {
        // Inline flow form (`environment: { KEY: value }`): no per-key structure to keep; what
        // follows deeper is the rest of it.
        blockIndent = indent;
        push(`${env[1]}${REDACTED}`);
      }
      continue;
    }
    // Dockerfile: `ENV KEY=value …` / `ARG KEY=value` / legacy `ENV KEY value`; RUN / CMD / ENTRYPOINT are command lines.
    const df = /^(\s*(?:ONBUILD\s+)?(?:ENV|ARG)\s+)([\s\S]*)$/i.exec(line);
    if (df) {
      push(`${df[1]}${redactEnvInstruction(df[2] ?? '', false)}`);
      continues = endsWithBackslash(line) ? 'env' : '';
      continue;
    }
    const run = /^(\s*(?:ONBUILD\s+)?(?:RUN|CMD|ENTRYPOINT|HEALTHCHECK)\s+)([\s\S]*)$/i.exec(line);
    if (run) {
      delete runCarry.pending;
      push(`${run[1]}${redactCommandPart(run[2] ?? '', runCarry)}`);
      continues = endsWithBackslash(line) ? 'run' : '';
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
      // Deeper than the key's own column there can only be the rest of its value.
      const keyColumn = lead.length;
      const swallowRest = (): void => {
        blockIndent = keyColumn;
        const q = v.charAt(0);
        // A quoted scalar left open continues on the next lines at ANY indent — the value's own
        // quote, or the one that opened the whole list item (`- "KEY=line1`).
        if (trail === '' && (q === '"' || q === "'") && closingQuoteIndex(v.slice(1), q) < 0) { quote = q; quoteLines = 0; }
        else if (trail === '' && !quotedKey && keyOpen !== '' && closingQuoteIndex(value, keyOpen) < 0) { quote = keyOpen; quoteLines = 0; }
      };

      // Inside `environment:`, a variable may be NAMED `command` or `test`: it is still a variable.
      if (!inEnv && COMMAND_YAML_KEY_RE.test(key) && sep.includes(':')) {
        delete cmdCarry.pending;
        if (v === '' || v.startsWith('#') || /^[&!][^\s[{]*\s*(#.*)?$/.test(v)) {
          // The arguments follow as a list (after a comment, an anchor or a tag).
          cmdIndent = indent; cmdFlow = false; push(line);
        } else if (BLOCK_SCALAR_RE.test(v)) {
          blockIndent = keyColumn; push(line);
        } else if (v.startsWith('[') && !flowCloses(v)) {
          // A flow list that goes on over the next lines: the last flag may wait for its value.
          cmdIndent = indent; cmdFlow = true;
          push(`${lead}${keyText}${sep}${redactCommandPart(value, cmdCarry)}${trail}`);
        } else {
          push(`${lead}${keyText}${sep}${redactYamlCommand(value)}${trail}`);
          swallowRest();
        }
        continue;
      }
      // In the top-level `secrets:` section the literal of a definition is the secret itself.
      const sensitiveName = SENSITIVE_NAME_RE.test(key) || (section === 'secrets' && /^(content|value|data)$/.test(key));
      if (ENV_KEY_RE.test(key) || sensitiveName || inEnv) {
        if (BLOCK_SCALAR_RE.test(v)) { blockIndent = keyColumn; push(line); continue; }
        if (v === '' || v.startsWith('#')) {
          // Nothing on this line. A plain continuation below is the value itself, swallowed. A
          // nested mapping / list keeps its shape and loses its leaves — unless this key is a
          // NAME (a service called `supertokens`) or the top-level `secrets:` / `configs:`
          // section, whose children are definitions, not values.
          const isName = (section !== '' && indent === sectionChildIndent) || (indent === 0 && /^(secrets|configs)$/.test(key));
          if (inEnv || !nestedFollows(idx + 1, indent)) blockIndent = keyColumn;
          else if (!isName) { envIndent = indent; envForced = true; }
          push(line);
          continue;
        }
        push(`${lead}${keyText}${sep}${startsFlow(v) ? REDACTED : redactAssignedValue(value, sensitiveName)}${trail}`);
        swallowRest();
        continue;
      }
      if (startsFlow(v) && v.length > 1 && !SAFE_FLOW_KEY_RE.test(key)) {
        // `services: {app: {environment: {…}}}`: a flow collection can hide anything.
        push(`${lead}${keyText}${sep}${REDACTED}${trail}`);
        if (!flowCloses(v)) blockIndent = keyColumn;
        continue;
      }
      // An ordinary key: its value may still be a directive (`caddy…header_up: X-Api-Key …`) or
      // hold a command with secrets.
      push(redactDirective(line));
      continue;
    }

    if (envIndent >= 0 && isItem && indent >= envIndent) {
      // `- KEY` (pass-through) is fine in an environment list; anything else that is not
      // KEY=value is hidden — and under a sensitive key every item is a value.
      const passThrough = !envForced && /^\s*-\s*['"]?[A-Za-z_][A-Za-z0-9_]*['"]?\s*(#.*)?$/.test(line);
      push(passThrough ? line : `${line.slice(0, indent)}- ${REDACTED}`);
      continue;
    }
    // A whole document on one line (minified JSON compose) or a stray flow collection.
    const trimmed = line.trim();
    if (startsFlow(trimmed) && trimmed.length > 2) { hide(); continue; }
    push(redactDirective(line));
  }

  // Back to one entry per `\n` line.
  const out: string[] = [];
  for (let k = 0; k < done.length; k += 1) {
    const n = owner[k] ?? 0;
    if (out.length === n) out.push(done[k] ?? '');
    else out[n] = `${out[n] ?? ''}\r${done[k] ?? ''}`;
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
