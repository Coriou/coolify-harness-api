import { withScope } from '../scope.js';
import { EXIT } from '../main.js';
export async function statusCmd(args, deps) {
    if (!args.app) {
        process.stderr.write('status: --app <name> is required\n');
        return EXIT.usage;
    }
    const target = deps.resolveTargetFor(args);
    const client = deps.clientFactory(target);
    const app = await withScope('read', () => client.get());
    let latest;
    try {
        latest = await withScope('read:sensitive', () => client.getLatestDeployment());
    }
    catch {
        // non-fatal for status summary (latestDeployment is bonus info and requires read:sensitive like other deployment paths)
    }
    if (args.json) {
        process.stdout.write(JSON.stringify({
            target: { name: args.app, kind: target.kind, uuid: target.uuid },
            app,
            latestDeployment: latest ?? null,
        }, null, 2) + '\n');
        return EXIT.ok;
    }
    // Human summary
    process.stdout.write(`status for ${args.app} (${target.kind} ${target.uuid})\n`);
    process.stdout.write(`  name: ${app.name}\n`);
    process.stdout.write(`  status: ${app.status ?? '(unknown)'}\n`);
    if (app.fqdn)
        process.stdout.write(`  fqdn: ${app.fqdn}\n`);
    if (app.git_branch)
        process.stdout.write(`  branch: ${app.git_branch}\n`);
    if (app.git_commit_sha)
        process.stdout.write(`  commit: ${app.git_commit_sha}\n`);
    if (latest) {
        process.stdout.write(`  latest deploy: ${latest.deployment_uuid} [${latest.status}]\n`);
        if (latest.commit)
            process.stdout.write(`    commit: ${latest.commit}\n`);
        if (latest.updated_at)
            process.stdout.write(`    updated: ${latest.updated_at}\n`);
    }
    else {
        process.stdout.write('  latest deploy: (none found)\n');
    }
    process.stdout.write('NOTE: use --json for full machine-readable output.\n');
    return EXIT.ok;
}
