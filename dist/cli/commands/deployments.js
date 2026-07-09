import { withScope } from '../scope.js';
import { EXIT } from '../main.js';
export async function deploymentsCmd(args, deps) {
    if (!args.app) {
        process.stderr.write('deployments: --app <name> is required\n');
        return EXIT.usage;
    }
    const target = deps.resolveTargetFor(args);
    const client = deps.clientFactory(target);
    // If a specific deployment uuid is provided via --deployment or (for "deployment <uuid>" cmd), show single
    const singleUuid = args.deployment;
    if (singleUuid) {
        const d = await withScope('read:sensitive', () => client.getDeployment(singleUuid));
        if (args.json) {
            process.stdout.write(JSON.stringify(d, null, 2) + '\n');
        }
        else {
            process.stdout.write(`deployment ${d.deployment_uuid} [${d.status}]\n`);
            if (d.commit)
                process.stdout.write(`commit: ${d.commit} ${d.commit_message ?? ''}\n`);
            if (d.created_at)
                process.stdout.write(`created: ${d.created_at}\n`);
            process.stdout.write('logs:\n');
            process.stdout.write((d.logs ?? '(none)') + '\n');
            process.stdout.write('NOTE: use --json for full machine-readable output.\n');
        }
        return EXIT.ok;
    }
    // list
    const listOpts = {};
    if (args.skip !== undefined)
        listOpts.skip = args.skip;
    if (args.take !== undefined)
        listOpts.take = args.take;
    else
        listOpts.take = 10;
    const list = await withScope('read:sensitive', () => client.listDeployments(listOpts));
    if (args.json) {
        process.stdout.write(JSON.stringify(list, null, 2) + '\n');
        return EXIT.ok;
    }
    process.stdout.write(`recent deployments for ${args.app} (showing ${list.length})\n`);
    for (const d of list) {
        const short = (d.logs ?? '').slice(0, 60).replace(/\n/g, ' ');
        process.stdout.write(`  ${d.deployment_uuid}  [${d.status}]  ${d.commit ?? ''}  ${d.updated_at ?? d.created_at ?? ''}  ${short}\n`);
    }
    process.stdout.write('NOTE: use --json for full machine-readable output. Use "deployment <UUID> --app X" for full logs.\n');
    return EXIT.ok;
}
