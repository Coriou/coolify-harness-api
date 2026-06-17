import { readFile as nodeReadFile } from 'fs/promises';
import { z } from 'zod';
import type { ParsedArgs } from '../args.js';
import type { CoolifyClient } from '../../client/coolify.js';
import type { ResolvedTarget } from '../../config/schema.js';
import type { AuditRecord } from '../../client/safe-write.js';
import { planEnvWrite, applyEnvWrite } from '../../client/safe-write.js';
import { createLogger } from '../../logging/index.js';
import { DuplicateKeyDriftError } from '../../errors/index.js';
import { EXIT } from '../main.js';

export interface EnvCmdDeps {
  resolveTargetFor: (args: ParsedArgs) => ResolvedTarget;
  clientFactory: (target: ResolvedTarget) => Pick<CoolifyClient, 'listEnvs' | 'upsertEnvs' | 'deploy' | 'restart'>;
  actor: string;
  auditSink: (record: AuditRecord) => Promise<void>;
  now?: () => Date;
  readFile?: (path: string) => Promise<string>;
}

const defaultReadFile = (path: string): Promise<string> =>
  nodeReadFile(path, 'utf8');

/** Parse dotenv-style KEY=VALUE text into a record. Ignores blank lines and comments (#). */
export function parseDotenv(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, ''); // trim trailing CR
    const trimmed = line.trimStart();
    if (trimmed === '' || trimmed.startsWith('#')) continue; // blank or comment
    // Strip optional `export ` prefix
    const withoutExport = trimmed.startsWith('export ') ? trimmed.slice(7) : trimmed;
    const eqIdx = withoutExport.indexOf('=');
    if (eqIdx < 0) {
      throw new z.ZodError([{
        code: 'custom', path: [],
        message: `Invalid dotenv line (missing '='): ${JSON.stringify(line)}`,
      }]);
    }
    const key = withoutExport.slice(0, eqIdx).trim();
    const value = withoutExport.slice(eqIdx + 1); // preserve internal content; no trim
    result[key] = value;
  }
  return result;
}

async function resolveValues(args: ParsedArgs, deps: EnvCmdDeps): Promise<Record<string, string>> {
  if (!args.fromFile) return args.set;
  const fileText = await (deps.readFile ?? defaultReadFile)(args.fromFile);
  const fileValues = parseDotenv(fileText);
  // --set overrides file values for the same key
  return { ...fileValues, ...args.set };
}

function printPlan(plan: ReturnType<typeof planEnvWrite>, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }
  process.stdout.write(`creates: ${plan.creates.map((c) => c.key).join(', ') || '(none)'}\n`);
  process.stdout.write(`updates: ${plan.updates.map((u) => u.key).join(', ') || '(none)'}\n`);
  process.stdout.write(`unchanged: ${plan.unchanged.length}\n`);
  if (plan.duplicateKeyDrift.length > 0) {
    process.stdout.write(`DUPLICATE-KEY DRIFT: ${plan.duplicateKeyDrift.map((d) => d.key).join(', ')}\n`);
  }
  for (const w of plan.warnings) process.stdout.write(`warning: ${w.message}\n`);
  process.stdout.write('NOTE: env changes are inert until a separate redeploy.\n');
}

export async function envDiff(args: ParsedArgs, deps: EnvCmdDeps): Promise<number> {
  const target = deps.resolveTargetFor(args);
  const client = deps.clientFactory(target);
  const current = await client.listEnvs();
  const merged = await resolveValues(args, deps);
  const plan = planEnvWrite(current, { values: merged });
  printPlan(plan, args.json);
  if (args.failOnDrift && plan.duplicateKeyDrift.length > 0) {
    throw new DuplicateKeyDriftError('Duplicate-key drift detected', {
      keys: plan.duplicateKeyDrift.map((d) => d.key),
    });
  }
  return EXIT.ok;
}

export async function envApply(args: ParsedArgs, deps: EnvCmdDeps): Promise<number> {
  const target = deps.resolveTargetFor(args);
  const client = deps.clientFactory(target);
  const current = await client.listEnvs();
  const merged = await resolveValues(args, deps);
  const plan = planEnvWrite(current, { values: merged });
  printPlan(plan, args.json);
  if (args.failOnDrift && plan.duplicateKeyDrift.length > 0) {
    throw new DuplicateKeyDriftError('Duplicate-key drift detected', {
      keys: plan.duplicateKeyDrift.map((d) => d.key),
    });
  }
  if (!args.apply) {
    process.stdout.write('Dry-run. Re-run with --apply to write.\n');
    return EXIT.ok;
  }
  const result = await applyEnvWrite(plan, {
    client, logger: createLogger({ sink: () => {} }),
    target: { instanceUrl: target.instanceUrl, kind: target.kind, uuid: target.uuid },
    actor: deps.actor, writeAudit: deps.auditSink, ...(deps.now ? { now: deps.now } : {}),
  });
  process.stdout.write(result.confirmed ? 'Applied and confirmed.\n' : 'Applied (confirmation mismatch — re-check).\n');
  return EXIT.ok;
}
