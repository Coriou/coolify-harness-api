/**
 * Output redaction. Coolify API payloads carry live secrets in places that look harmless:
 * `manual_webhook_secret_*` and `http_basic_auth_password` on every application, `sentinel_token`
 * in server settings, `internal_db_url` (with the DB password) on databases, and whole
 * docker-compose documents (`docker_compose_raw`, the proxy `configuration`) that may hold literal
 * credentials. Everything the CLI prints goes through here first. Values are never echoed — only
 * their length, so an operator can still tell "set" from "empty".
 */
export declare const REDACTED = "[REDACTED]";
export declare function redactValue(value: string): string;
/**
 * Redact a docker-compose / dotenv / Dockerfile-like document line by line:
 * - `KEY=value` / `KEY: value` (list items and maps, quoted or not) where KEY is UPPER_SNAKE or
 *   looks sensitive → value replaced, unless it is a pure `${VAR}` reference, a number or a boolean;
 * - credentials embedded in URLs anywhere on the line → password replaced.
 * Structure (service names, `image:` lines, ports, labels without secrets) stays readable, which is
 * what an agent needs to review an image bump or a diff.
 */
export declare function redactDocument(text: string): string;
/**
 * Deep-copy `input` with secrets redacted. Strings under sensitive keys become `[REDACTED] (N chars)`;
 * compose/config documents are redacted line by line; credentials inside any URL are stripped.
 * `logs` is deliberately left alone — logs are an explicit, `read:sensitive`-scoped request and
 * Coolify already masks env values in them.
 */
export declare function redactDeep<T>(input: T): T;
