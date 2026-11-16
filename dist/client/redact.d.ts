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
export declare const REDACTED = "[REDACTED]";
export declare function redactValue(value: string): string;
/** Strip credentials embedded in URLs, secret query parameters and auth-scheme tokens anywhere in `text`. */
export declare function redactUrlCredentials(text: string): string;
/**
 * Redact the secrets a shell command or a docker option string can carry: `KEY=value`
 * assignments, `--password=…` / `--token …` flags, `-p…` / `-a …` / `-u user:pass`, header values,
 * auth-scheme tokens and URL credentials — in shell form and in exec form (`["a", "--pw", "x"]`).
 * The command itself stays readable.
 */
export declare function redactCommandLine(text: string): string;
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
export declare function redactDocumentLines(text: string): string[];
/** `redactDocumentLines` joined back into one document. */
export declare function redactDocument(text: string): string;
/**
 * Deep-copy `input` with secrets redacted. Strings under sensitive keys become `[REDACTED] (N chars)`
 * — including every string nested under such a key; compose/config documents are redacted line by
 * line; commands keep their shape but lose inline secrets; credentials inside any URL are stripped.
 * `logs` is deliberately left alone — logs are an explicit, `read:sensitive`-scoped request and
 * Coolify already masks env values in them.
 */
export declare function redactDeep<T>(input: T): T;
