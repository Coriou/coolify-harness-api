/**
 * Parse dotenv-style text into a record.
 * - blank lines and `#` comment lines are ignored; an optional `export ` prefix is dropped;
 * - a value wrapped in matching quotes loses them (`KEY="a b"` → `a b`), as every dotenv loader
 *   does; a double-quoted value also expands `\n`, `\r`, `\t`, `\"` and `\\`, and a quoted value
 *   may span several lines (PEM keys);
 * - an UNQUOTED value is taken verbatim up to the end of the line (no trimming, no inline-comment
 *   stripping: a secret containing ` #` must not be silently cut).
 * A line that is not `KEY=VALUE` is a usage error; its content is never echoed.
 */
export declare function parseDotenv(text: string): Record<string, string>;
/**
 * Variables of the `--env-file` files, later files winning. Used only to look up API tokens: the
 * real environment always wins over a file, and nothing is written to `process.env`.
 */
export declare function readEnvFiles(paths: readonly string[]): Promise<Record<string, string>>;
