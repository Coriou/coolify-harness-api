import { readFile } from 'node:fs/promises';
import { UsageError } from '../errors/index.js';

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
    // Assigning it would set the record's prototype and silently drop the line.
    if (key === '__proto__') throw new UsageError(`Invalid dotenv line ${n + 1}: __proto__ cannot be used as a variable name`);
    let value = withoutExport.slice(eqIdx + 1);
    // `KEY = "v"` / `KEY= "v"`: blanks before a quoted value are not part of it.
    if (/^[ \t]+['"]/.test(value)) value = value.trimStart();
    const quote = value[0];
    if (quote === '"' || quote === "'") {
      // Find the closing quote, on this line or a later one (multi-line value).
      const parts = [value.slice(1)];
      let offset = 0; // length of the parts before the last one, with their newlines
      let close = closingQuote(parts[0] ?? '', quote);
      const firstLine = n;
      while (close < 0 && n + 1 < lines.length) {
        n += 1;
        offset += (parts[parts.length - 1] ?? '').length + 1;
        const more = (lines[n] ?? '').replace(/\r$/, '');
        parts.push(more);
        // Only the new line is scanned: re-reading the whole value for each line made a long
        // multi-line value (a certificate chain) quadratic. A quoted value has no escape that
        // spans a line break, so each line can be judged by itself.
        const at = closingQuote(more, quote);
        close = at < 0 ? -1 : offset + at;
      }
      const body = parts.join('\n');
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

/** What dotenv loaders expand inside double quotes: `\n` and `\r`. Everything else is literal. */
function unescapeDouble(body: string): string {
  return body.replace(/\\([nr])/g, (_m, c: string) => (c === 'n' ? '\n' : '\r'));
}

/**
 * A path is echoed only when it reads like one. `--token-file` is the flag a token gets pasted
 * after by mistake, and error text ends up in logs.
 */
export const describePath = (path: string): string =>
  (/^[\w./@~+-]{1,160}$/.test(path) && /[./]/.test(path) && !/^[A-Za-z0-9+/=_-]{32,}$/.test(path) ? path : `<${path.length}-character path>`);

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
export async function readTokenFiles(paths: readonly string[]): Promise<TokenFiles> {
  const vars: Record<string, string> = {};
  const missing: string[] = [];
  for (const path of paths) {
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (err) {
      if ((err as { code?: unknown }).code === 'ENOENT') { missing.push(path); continue; } // reason: probing the optional errno code of an unknown error
      const code = (err as { code?: unknown }).code; // reason: same
      throw new UsageError(`Cannot read --token-file ${describePath(path)}${typeof code === 'string' ? ` (${code})` : ''}`);
    }
    for (const raw of text.split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(raw);
      if (!m) continue;
      const name = m[1] ?? '';
      const rest = (m[2] ?? '').trim();
      const quoted = /^(['"])(.*?)\1/.exec(rest);
      const value = quoted ? (quoted[2] ?? '') : rest.replace(/\s+#.*$/, '').trim();
      // A blank `TOKEN=` in a later file does not erase the token an earlier one gave.
      if (name === '__proto__' || (value === '' && (vars[name] ?? '') !== '')) continue;
      vars[name] = value;
    }
  }
  return { vars, missing };
}
