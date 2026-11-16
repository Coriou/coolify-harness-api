/**
 * Output redaction. Coolify API payloads carry live secrets in places that look harmless:
 * `manual_webhook_secret_*` and `http_basic_auth_password` on every application, `sentinel_token`
 * in server settings, `internal_db_url` (with the DB password) on databases, build / start
 * commands, and whole docker-compose documents (`docker_compose_raw`, the proxy `configuration`)
 * that may hold literal credentials. Everything the CLI prints goes through here first. Values are
 * never echoed — only their length, so an operator can still tell "set" from "empty".
 */
export declare const REDACTED = "[REDACTED]";
export declare function redactValue(value: string): string;
/** Strip credentials embedded in URLs and auth-scheme tokens anywhere in `text`. */
export declare function redactUrlCredentials(text: string): string;
/**
 * Redact the secrets a shell command or a docker option string can carry: inline `KEY=value`
 * assignments, `--password=…` / `--token …` style flags, auth-scheme tokens and URL credentials.
 * The command itself stays readable.
 */
export declare function redactCommandLine(text: string): string;
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
export declare function redactDocumentLines(text: string): string[];
/** `redactDocumentLines` joined back into one document. */
export declare function redactDocument(text: string): string;
/**
 * Deep-copy `input` with secrets redacted. Strings under sensitive keys become `[REDACTED] (N chars)`;
 * compose/config documents are redacted line by line; commands keep their shape but lose inline
 * secrets; credentials inside any URL are stripped.
 * `logs` is deliberately left alone — logs are an explicit, `read:sensitive`-scoped request and
 * Coolify already masks env values in them.
 */
export declare function redactDeep<T>(input: T): T;
