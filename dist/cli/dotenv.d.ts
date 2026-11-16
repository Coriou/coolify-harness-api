/**
 * Parse dotenv-style text into a record.
 * - blank lines and `#` comment lines are ignored; an optional `export ` prefix is dropped;
 * - a value wrapped in matching quotes loses them (`KEY="a b"` → `a b`), as every dotenv loader
 *   does; a double-quoted value also expands `\n` and `\r`, and a quoted value may span several
 *   lines (PEM keys);
 * - an UNQUOTED value is taken verbatim up to the end of the line (no trimming, no inline-comment
 *   stripping: a secret containing ` #` must not be silently cut).
 * A line that is not `KEY=VALUE` is a usage error; its content is never echoed.
 */
export declare function parseDotenv(text: string): Record<string, string>;
export interface TokenFiles {
    /** Variables found in the files, later files winning. */
    vars: Record<string, string>;
    /** Files that do not exist (not an error: the token may come from the real environment). */
    missing: string[];
}
/**
 * Read API tokens from dotenv files (`--token-file`). Deliberately forgiving, unlike `parseDotenv`:
 * the file is usually the project's whole `.env`, of which only the token lines matter. Lines
 * that are not `KEY=VALUE` are skipped, values are trimmed, quotes and an inline ` # comment` are
 * removed. A missing file is reported back, not thrown.
 */
export declare function readTokenFiles(paths: readonly string[]): Promise<TokenFiles>;
