import { readFile as fsReadFile } from 'node:fs/promises';
import { buildArtifacts, type SchemaInput } from './generate.js';

export interface StaleCheckResult {
  fresh: boolean;
  staleFiles: string[];
  diff: string;
}

export interface StaleCheckOptions {
  schemas: SchemaInput[];
  files: { markdown?: string; json?: string; dotenvExample?: string };
  readFile?: (path: string) => Promise<string>;
}

export async function checkCatalogFresh(opts: StaleCheckOptions): Promise<StaleCheckResult> {
  const artifacts = buildArtifacts(opts.schemas);
  const read =
    opts.readFile ??
    (async (p: string): Promise<string> => {
      try {
        return await fsReadFile(p, 'utf8');
      } catch {
        return '';
      }
    });

  const checks: { path: string; expected: string }[] = [];
  if (opts.files.markdown) checks.push({ path: opts.files.markdown, expected: artifacts.markdown });
  if (opts.files.json) checks.push({ path: opts.files.json, expected: artifacts.json });
  if (opts.files.dotenvExample) checks.push({ path: opts.files.dotenvExample, expected: artifacts.dotenv });

  const staleFiles: string[] = [];
  for (const c of checks) {
    const actual = await read(c.path);
    if (actual !== c.expected) staleFiles.push(c.path);
  }

  return {
    fresh: staleFiles.length === 0,
    staleFiles,
    diff: staleFiles.length === 0 ? '' : `Stale artifacts: ${staleFiles.join(', ')}. Run 'coolify-harness catalog gen'.`,
  };
}
