import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isMainModule } from '../src/cli/main.js';

// Bug 2: the bin-entry guard used `import.meta.url === file://${process.argv[1]}`, which never
// matches when the bin is invoked through a pnpm symlink (node_modules/.bin -> ../dist/cli/main.js)
// under tsx — so every command silently no-opped and exited 0. isMainModule realpath-resolves both
// sides so a symlinked argv[1] still equals the real module path.

let dir: string;
let realFile: string;
let linkFile: string;
let otherFile: string;

beforeAll(() => {
  // realpath the tmp dir up front: on macOS os.tmpdir() lives under /var -> /private/var, so the
  // canonical module path must be compared against the resolved dir, not the symlinked one.
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'coolify-harness-entry-')));
  realFile = join(dir, 'main.js');
  otherFile = join(dir, 'other.js');
  linkFile = join(dir, 'bin-link'); // stands in for node_modules/.bin/coolify-harness
  writeFileSync(realFile, '// entry\n');
  writeFileSync(otherFile, '// other\n');
  symlinkSync(realFile, linkFile);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('isMainModule (bin-entry guard predicate)', () => {
  it('true when argv[1] is the module file itself', () => {
    expect(isMainModule(pathToFileURL(realFile).href, realFile)).toBe(true);
  });

  it('true when argv[1] is a SYMLINK resolving to the module (the pnpm + tsx case)', () => {
    // import.meta.url points at the real file; argv[1] is the .bin symlink
    expect(isMainModule(pathToFileURL(realFile).href, linkFile)).toBe(true);
  });

  it('true when BOTH the meta url and argv[1] are the symlink path', () => {
    expect(isMainModule(pathToFileURL(linkFile).href, linkFile)).toBe(true);
  });

  it('false for an unrelated file', () => {
    expect(isMainModule(pathToFileURL(realFile).href, otherFile)).toBe(false);
  });

  it('false when argv[1] is undefined (module imported as a library)', () => {
    expect(isMainModule(pathToFileURL(realFile).href, undefined)).toBe(false);
  });

  it('false when argv[1] points at a path that does not exist', () => {
    expect(isMainModule(pathToFileURL(realFile).href, join(dir, 'does-not-exist.js'))).toBe(false);
  });

  it('false when the meta url is not a file:// URL', () => {
    expect(isMainModule('data:text/javascript,0', realFile)).toBe(false);
  });
});
