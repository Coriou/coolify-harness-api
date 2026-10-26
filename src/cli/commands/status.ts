import type { ParsedArgs } from '../args.js';
import type { CmdDeps } from '../deps.js';
import { print, printJson } from '../deps.js';
import { withScope } from '../scope.js';
import { EXIT } from '../main.js';

interface SubResource { name?: unknown; status?: unknown; image?: unknown }

export async function statusCmd(args: ParsedArgs, deps: CmdDeps): Promise<number> {
  if (!args.app) {
    process.stderr.write('status: --app <name> is required\n');
    return EXIT.usage;
  }
  const target = deps.resolveTargetFor(args);
  const client = deps.clientFactory(target);

  const app = await withScope('read', () => client.get());
  let latest: Awaited<ReturnType<typeof client.getLatestDeployment>> | undefined;
  try {
    latest = await withScope('read', () => client.getLatestDeployment());
  } catch {
    // non-fatal for status summary (latestDeployment is bonus info)
  }

  if (args.json) {
    // The raw resource carries webhook secrets, basic-auth fields and compose documents: redacted.
    printJson({ target: { name: args.app, kind: target.kind, uuid: target.uuid }, app, latestDeployment: latest ?? null });
    return EXIT.ok;
  }

  // Human summary
  const extra = app as unknown as Record<string, unknown>; // reason: kind-specific passthrough fields (applications/databases/is_public) are read defensively
  print(`status for ${args.app} (${target.kind} ${target.uuid})`);
  print(`  name: ${app.name}`);
  print(`  status: ${app.status ?? '(unknown)'}`);
  if (app.fqdn) print(`  fqdn: ${app.fqdn}`);
  if (app.git_branch) print(`  branch: ${app.git_branch}`);
  if (app.git_commit_sha) print(`  commit: ${app.git_commit_sha}`);
  if (typeof extra['image'] === 'string') print(`  image: ${extra['image']}`);
  if (typeof extra['is_public'] === 'boolean') print(`  public: ${extra['is_public'] ? `yes (port ${String(extra['public_port'])})` : 'no'}`);
  for (const group of ['applications', 'databases']) {
    const subs = extra[group];
    if (Array.isArray(subs)) {
      for (const s of subs as SubResource[]) print(`  ${group.slice(0, -1)} ${String(s.name)}: ${String(s.status ?? '?')}  ${String(s.image ?? '')}`);
    }
  }
  if (target.kind === 'application') {
    if (latest) {
      print(`  latest deploy: ${latest.deployment_uuid} [${latest.status}]`);
      if (latest.commit) print(`    commit: ${latest.commit}`);
      if (latest.updated_at) print(`    updated: ${latest.updated_at}`);
    } else {
      print('  latest deploy: (none found)');
    }
  }
  print('NOTE: use --json for full machine-readable output (secrets redacted).');
  return EXIT.ok;
}
