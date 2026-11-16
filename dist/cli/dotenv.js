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
export function parseDotenv(text) {
    const result = {};
    const lines = text.split('\n');
    for (let n = 0; n < lines.length; n += 1) {
        const line = (lines[n] ?? '').replace(/\r$/, ''); // trim trailing CR
        const trimmed = line.trimStart();
        if (trimmed === '' || trimmed.startsWith('#'))
            continue; // blank or comment
        const withoutExport = trimmed.startsWith('export ') ? trimmed.slice(7).trimStart() : trimmed;
        const eqIdx = withoutExport.indexOf('=');
        const key = eqIdx < 0 ? '' : withoutExport.slice(0, eqIdx).trim();
        if (eqIdx < 0 || key === '' || /\s/.test(key)) {
            throw new UsageError(`Invalid dotenv line ${n + 1}: expected KEY=VALUE${eqIdx < 0 ? " (missing '=')" : ''}`);
        }
        let value = withoutExport.slice(eqIdx + 1);
        // `KEY = "v"` / `KEY= "v"`: blanks before a quoted value are not part of it.
        if (/^[ \t]+['"]/.test(value))
            value = value.trimStart();
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
            }
            else if (n !== firstLine) {
                throw new UsageError(`Invalid dotenv value for ${key} (line ${firstLine + 1}): unexpected text after the closing quote`);
            }
        }
        result[key] = value;
    }
    return result;
}
function closingQuote(body, quote) {
    for (let i = 0; i < body.length; i += 1) {
        if (quote === '"' && body[i] === '\\') {
            i += 1;
            continue;
        }
        if (body[i] === quote)
            return i;
    }
    return -1;
}
/** What dotenv loaders expand inside double quotes: `\n` and `\r`. Everything else is literal. */
function unescapeDouble(body) {
    return body.replace(/\\([nr])/g, (_m, c) => (c === 'n' ? '\n' : '\r'));
}
/**
 * Read API tokens from dotenv files (`--token-file`). Deliberately forgiving, unlike `parseDotenv`:
 * the file is usually the project's whole `.env`, of which only the token lines matter. Lines
 * that are not `KEY=VALUE` are skipped, values are trimmed, quotes and an inline ` # comment` are
 * removed. A missing file is reported back, not thrown.
 */
export async function readTokenFiles(paths) {
    const vars = {};
    const missing = [];
    for (const path of paths) {
        let text;
        try {
            text = await readFile(path, 'utf8');
        }
        catch (err) {
            if (err.code === 'ENOENT') {
                missing.push(path);
                continue;
            } // reason: probing the optional errno code of an unknown error
            const code = err.code; // reason: same
            throw new UsageError(`Cannot read --token-file ${path}${typeof code === 'string' ? ` (${code})` : ''}`);
        }
        for (const raw of text.split(/\r?\n/)) {
            const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(raw);
            if (!m)
                continue;
            const rest = (m[2] ?? '').trim();
            const quoted = /^(['"])(.*?)\1/.exec(rest);
            vars[m[1] ?? ''] = quoted ? (quoted[2] ?? '') : rest.replace(/\s+#.*$/, '').trim();
        }
    }
    return { vars, missing };
}
