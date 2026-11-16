import { createHash } from 'node:crypto';
import { redactDocumentLines } from './redact.js';

/**
 * Minimal, dependency-free helpers for the docker-compose documents Coolify stores (service
 * `docker_compose_raw`, the server proxy `configuration`). They only touch `image:` lines, so a
 * round-trip never re-serialises the YAML: comments, quoting, anchors and ordering are preserved
 * byte for byte, and Coolify sees exactly the document it had plus the one edited line.
 */

export interface ServiceImage {
  service: string;
  image: string;
  /** 0-based line index of the `image:` line. */
  line: number;
}

const IMAGE_REF_RE = /^([a-z0-9][a-z0-9.-]*(:\d{1,5})?\/)?[a-z0-9][a-z0-9._\-/]*(:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?(@sha256:[a-f0-9]{64})?$/;

/** True for a plausible OCI image reference (`repo[:tag][@sha256:digest]`, lowercase repo). */
export function isValidImageRef(ref: string): boolean {
  return IMAGE_REF_RE.test(ref);
}

const indentOf = (line: string): number => line.length - line.trimStart().length;
const isBlankOrComment = (line: string): boolean => line.trim() === '' || line.trimStart().startsWith('#');
const unquote = (v: string): string => v.trim().replace(/^(['"])(.*)\1$/, '$2');

/** List the `image:` of every service under the top-level `services:` key. */
export function listServiceImages(yaml: string): ServiceImage[] {
  const lines = yaml.split('\n');
  const start = lines.findIndex((l) => /^services:\s*(#.*)?$/.test(l));
  if (start < 0) return [];
  const out: ServiceImage[] = [];
  let serviceIndent = -1;
  let current: { name: string; indent: number; childIndent: number; found: boolean } | undefined;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (isBlankOrComment(line)) continue;
    const indent = indentOf(line);
    if (indent === 0) break; // next top-level key: end of `services:`
    if (serviceIndent < 0) serviceIndent = indent;
    if (indent === serviceIndent) {
      const header = /^\s*([A-Za-z0-9_.-]+):\s*(#.*)?$/.exec(line);
      current = header?.[1] ? { name: header[1], indent, childIndent: -1, found: false } : undefined;
      continue;
    }
    if (!current || indent <= current.indent) continue;
    if (current.childIndent < 0) current.childIndent = indent;
    if (indent !== current.childIndent || current.found) continue;
    // No lazy `(.+?)\s*(#.*)?$`: that re-scans a long run of blanks from every position.
    const img = /^\s*image:\s*(\S.*)$/.exec(line);
    if (img?.[1]) {
      const comment = img[1].search(/\s#/);
      out.push({ service: current.name, image: unquote((comment < 0 ? img[1] : img[1].slice(0, comment)).trimEnd()), line: i });
      current.found = true;
    }
  }
  return out;
}

/**
 * Return `yaml` with the `image:` of `service` replaced by `image`, preserving the line's
 * indentation and quote style. Throws when the service or its image line does not exist.
 */
export function setServiceImage(yaml: string, service: string, image: string): string {
  if (!isValidImageRef(image)) throw new Error(`Not a valid image reference: '${image}'`);
  const found = listServiceImages(yaml).find((s) => s.service === service);
  if (!found) {
    const known = listServiceImages(yaml).map((s) => s.service).join(', ') || '(none)';
    throw new Error(`No 'image:' line for service '${service}'. Services with an image: ${known}`);
  }
  const lines = yaml.split('\n');
  const old = lines[found.line] ?? '';
  lines[found.line] = old.replace(/^(\s*image:\s*)(['"]?)[^'"#\s]+(['"]?)/, (_m, pre: string, q1: string, q2: string) => `${pre}${q1}${image}${q2}`);
  return lines.join('\n');
}

/** Split `repo[:tag]` → { repo, tag } (digest-aware; a registry port is not mistaken for a tag). */
export function splitImageRef(ref: string): { repo: string; tag: string | undefined } {
  const noDigest = ref.split('@')[0] ?? ref;
  const lastColon = noDigest.lastIndexOf(':');
  if (lastColon > noDigest.lastIndexOf('/')) {
    return { repo: noDigest.slice(0, lastColon), tag: noDigest.slice(lastColon + 1) };
  }
  return { repo: noDigest, tag: undefined };
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function toBase64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

export type DiffOp = { op: 'same' | 'del' | 'add'; line: string };

interface IndexedOp { op: DiffOp['op']; a: number; b: number }

/** Above this many table cells (n·m of the differing middle) the diff is not aligned line by line. */
const MAX_LCS_CELLS = 4_000_000;

/**
 * LCS line diff by index. The common head and tail are set aside first (an image bump differs in
 * one line), then the middle is aligned with an O(n·m) table: compose files are tens to hundreds
 * of lines. A middle too large for the table (two unrelated documents of thousands of lines) is
 * reported as "all removed, all added" instead of taking seconds and hundreds of MB.
 */
function diffIndices(a: string[], b: string[]): IndexedOp[] {
  const out: IndexedOp[] = [];
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) { out.push({ op: 'same', a: head, b: head }); head += 1; }
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
  const n = a.length - head - tail;
  const m = b.length - head - tail;
  let i = 0;
  let j = 0;
  if (n * m <= MAX_LCS_CELLS) {
    const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let x = n - 1; x >= 0; x -= 1) {
      for (let y = m - 1; y >= 0; y -= 1) {
        dp[x]![y] = a[head + x] === b[head + y] ? dp[x + 1]![y + 1]! + 1 : Math.max(dp[x + 1]![y]!, dp[x]![y + 1]!); // reason: x ≤ n, y ≤ m by the loop bounds
      }
    }
    while (i < n && j < m) {
      if (a[head + i] === b[head + j]) { out.push({ op: 'same', a: head + i, b: head + j }); i += 1; j += 1; }
      else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) { out.push({ op: 'del', a: head + i, b: -1 }); i += 1; } // reason: i < n, j < m
      else { out.push({ op: 'add', a: -1, b: head + j }); j += 1; }
    }
  }
  while (i < n) { out.push({ op: 'del', a: head + i, b: -1 }); i += 1; }
  while (j < m) { out.push({ op: 'add', a: -1, b: head + j }); j += 1; }
  for (let t = tail; t > 0; t -= 1) out.push({ op: 'same', a: a.length - t, b: b.length - t });
  return out;
}

/** LCS line diff of the RAW documents. Never print its lines: use formatRedactedDiff. */
export function diffLines(before: string, after: string): DiffOp[] {
  const a = before.split('\n');
  const b = after.split('\n');
  return diffIndices(a, b).map((o) => ({ op: o.op, line: o.op === 'add' ? b[o.b]! : a[o.a]! }));
}

/**
 * Human diff of two compose documents with secrets redacted on both sides. Each document is
 * redacted as a whole first, so a line is judged in its context (inside an `environment:` block, a
 * block scalar or a PEM block) rather than on its own. A changed line whose redacted form is
 * identical (i.e. only a secret value changed) is reported as such instead of showing two
 * identical `-`/`+` lines.
 */
export function formatRedactedDiff(before: string, after: string): string[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const ra = redactDocumentLines(before);
  const rb = redactDocumentLines(after);
  const ops = diffIndices(a, b);
  const out: string[] = [];
  for (let k = 0; k < ops.length;) {
    if (ops[k]!.op === 'same') { k += 1; continue; }
    // One hunk: the deleted lines, then the added lines that replace them.
    const dels: number[] = [];
    const adds: number[] = [];
    while (k < ops.length && ops[k]!.op === 'del') { dels.push(ops[k]!.a); k += 1; }
    while (k < ops.length && ops[k]!.op === 'add') { adds.push(ops[k]!.b); k += 1; }
    const paired = Math.min(dels.length, adds.length);
    const minus: string[] = [];
    const plus: string[] = [];
    for (let i = 0; i < Math.max(dels.length, adds.length); i += 1) {
      const d = i < dels.length ? ra[dels[i]!] ?? '' : undefined;
      const p = i < adds.length ? rb[adds[i]!] ?? '' : undefined;
      if (i < paired && d === p) {
        // Same line once redacted: only the secret changed. Say so instead of printing a no-op pair.
        plus.push(`~ ${(p ?? '').trim()}   (redacted value changed)`);
        continue;
      }
      if (d !== undefined) minus.push(`- ${d}`);
      if (p !== undefined) plus.push(`+ ${p}`);
    }
    out.push(...minus, ...plus);
  }
  return out;
}
