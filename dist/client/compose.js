import { createHash } from 'node:crypto';
import { redactDocument } from './redact.js';
const IMAGE_REF_RE = /^[a-z0-9][a-z0-9._\-/]*(:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?(@sha256:[a-f0-9]{64})?$/;
/** True for a plausible OCI image reference (`repo[:tag][@sha256:digest]`, lowercase repo). */
export function isValidImageRef(ref) {
    return IMAGE_REF_RE.test(ref);
}
const indentOf = (line) => line.length - line.trimStart().length;
const isBlankOrComment = (line) => line.trim() === '' || line.trimStart().startsWith('#');
const unquote = (v) => v.trim().replace(/^(['"])(.*)\1$/, '$2');
/** List the `image:` of every service under the top-level `services:` key. */
export function listServiceImages(yaml) {
    const lines = yaml.split('\n');
    const start = lines.findIndex((l) => /^services:\s*(#.*)?$/.test(l));
    if (start < 0)
        return [];
    const out = [];
    let serviceIndent = -1;
    let current;
    for (let i = start + 1; i < lines.length; i += 1) {
        const line = lines[i] ?? '';
        if (isBlankOrComment(line))
            continue;
        const indent = indentOf(line);
        if (indent === 0)
            break; // next top-level key: end of `services:`
        if (serviceIndent < 0)
            serviceIndent = indent;
        if (indent === serviceIndent) {
            const header = /^\s*([A-Za-z0-9_.-]+):\s*(#.*)?$/.exec(line);
            current = header?.[1] ? { name: header[1], indent, childIndent: -1, found: false } : undefined;
            continue;
        }
        if (!current || indent <= current.indent)
            continue;
        if (current.childIndent < 0)
            current.childIndent = indent;
        if (indent !== current.childIndent || current.found)
            continue;
        const img = /^\s*image:\s*(.+?)\s*(#.*)?$/.exec(line);
        if (img?.[1]) {
            out.push({ service: current.name, image: unquote(img[1]), line: i });
            current.found = true;
        }
    }
    return out;
}
/**
 * Return `yaml` with the `image:` of `service` replaced by `image`, preserving the line's
 * indentation and quote style. Throws when the service or its image line does not exist.
 */
export function setServiceImage(yaml, service, image) {
    if (!isValidImageRef(image))
        throw new Error(`Not a valid image reference: '${image}'`);
    const found = listServiceImages(yaml).find((s) => s.service === service);
    if (!found) {
        const known = listServiceImages(yaml).map((s) => s.service).join(', ') || '(none)';
        throw new Error(`No 'image:' line for service '${service}'. Services with an image: ${known}`);
    }
    const lines = yaml.split('\n');
    const old = lines[found.line] ?? '';
    lines[found.line] = old.replace(/^(\s*image:\s*)(['"]?)[^'"#\s]+(['"]?)/, (_m, pre, q1, q2) => `${pre}${q1}${image}${q2}`);
    return lines.join('\n');
}
/** Split `repo[:tag]` → { repo, tag } (digest-aware; a registry port is not mistaken for a tag). */
export function splitImageRef(ref) {
    const noDigest = ref.split('@')[0] ?? ref;
    const lastColon = noDigest.lastIndexOf(':');
    if (lastColon > noDigest.lastIndexOf('/')) {
        return { repo: noDigest.slice(0, lastColon), tag: noDigest.slice(lastColon + 1) };
    }
    return { repo: noDigest, tag: undefined };
}
export function sha256(text) {
    return createHash('sha256').update(text, 'utf8').digest('hex');
}
export function toBase64(text) {
    return Buffer.from(text, 'utf8').toString('base64');
}
/** LCS line diff. Compose files are small (tens to hundreds of lines), so O(n·m) is fine. */
export function diffLines(before, after) {
    const a = before.split('\n');
    const b = after.split('\n');
    const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i -= 1) {
        for (let j = b.length - 1; j >= 0; j -= 1) {
            dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }
    const out = [];
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) {
            out.push({ op: 'same', line: a[i] });
            i += 1;
            j += 1;
        }
        else if (dp[i + 1][j] >= dp[i][j + 1]) {
            out.push({ op: 'del', line: a[i] });
            i += 1;
        }
        else {
            out.push({ op: 'add', line: b[j] });
            j += 1;
        }
    }
    while (i < a.length) {
        out.push({ op: 'del', line: a[i] });
        i += 1;
    }
    while (j < b.length) {
        out.push({ op: 'add', line: b[j] });
        j += 1;
    }
    return out;
}
/**
 * Human diff of two compose documents with secrets redacted on both sides. A changed line whose
 * redacted form is identical (i.e. only a secret value changed) is reported as such instead of
 * showing two identical `-`/`+` lines.
 */
export function formatRedactedDiff(before, after) {
    const ops = diffLines(before, after);
    const out = [];
    for (let k = 0; k < ops.length; k += 1) {
        const cur = ops[k];
        if (cur.op === 'same')
            continue;
        const next = ops[k + 1];
        if (cur.op === 'del' && next?.op === 'add' && redactDocument(cur.line) === redactDocument(next.line)) {
            out.push(`~ ${redactDocument(next.line).trim()}   (redacted value changed)`);
            k += 1;
            continue;
        }
        out.push(`${cur.op === 'del' ? '-' : '+'} ${redactDocument(cur.line)}`);
    }
    return out;
}
