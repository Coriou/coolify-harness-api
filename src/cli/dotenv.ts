import { readFile } from 'node:fs/promises';
import { UsageError } from '../errors/index.js';

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
export function parseDotenv(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = text.split('\n');
  for (let n = 0; n < lines.length; n += 1) {
    const line = (lines[n] ?? '').replace(/\r$/, ''); // trim trailing CR
    const trimmed = line.trimStart();
    if (trimmed === '' || trimmed.startsWith('#')) continue; // blank or comment
    const withoutExport = trimmed.startsWith('export ') ? trimmed.slice(7).trimStart() : trimmed;
    const eqIdx = withoutExport.indexOf('=');
    const key = eqIdx < 0 ? '' : withoutExport.slice(0, eqIdx).trim();
    if (eqIdx < 0 || key === '' || /\s/.test(key)) {
      throw new UsageError(`Invalid dotenv line ${n + 1}: expected KEY=VALUE${eqIdx < 0 ? " (missing '=')" : ''}`);
    }
    let value = withoutExport.slice(eqIdx + 1);
    const quote = value[0];
    if (quote === '"' || quote === "'") {
      // Find the closing quote, on this line or a later one (multi-line value).
      let body = value.slice(1);
      let close = closingQuote(body, quote);
      const firstLine = n;
      while (close < 0 && n + 1 < lines.length) {
        n += 1;
        body += `\n${(lines[n] ?? '').replace(/\r$/, '')}`;
        close = closingQuote(body, quote);
      }
      if (close < 0) {
        throw new UsageError(`Invalid dotenv value for ${key} (line ${firstLine + 1}): unterminated ${quote === '"' ? 'double' : 'single'} quote`);
      }
      // Text after the closing quote (`"a" b`) means this was not a quoted value: keep it verbatim.
      if (body.slice(close + 1).trim().replace(/^#.*/, '') === '') {
        value = quote === '"' ? unescapeDouble(body.slice(0, close)) : body.slice(0, close);
      } else if (n !== firstLine) {
        throw new UsageError(`Invalid dotenv value for ${key} (line ${firstLine + 1}): unexpected text after the closing quote`);
      }
    }
    result[key] = value;
  }
  return result;
}

function closingQuote(body: string, quote: string): number {
  for (let i = 0; i < body.length; i += 1) {
    if (quote === '"' && body[i] === '\\') { i += 1; continue; }
    if (body[i] === quote) return i;
  }
  return -1;
}

function unescapeDouble(body: string): string {
  return body.replace(/\\([nrt"\\])/g, (_m, c: string) => ({ n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' })[c] ?? c);
}

/**
 * Variables of the `--env-file` files, later files winning. Used only to look up API tokens: the
 * real environment always wins over a file, and nothing is written to `process.env`.
 */
export async function readEnvFiles(paths: readonly string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const path of paths) {
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (err) {
      const code = (err as { code?: unknown }).code; // reason: probing the optional errno code of an unknown error
      throw new UsageError(`Cannot read --env-file ${path}${typeof code === 'string' ? ` (${code})` : ''}`);
    }
    Object.assign(out, parseDotenv(text));
  }
  return out;
}
