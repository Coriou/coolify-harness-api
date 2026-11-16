import { print, printJson, warn, usageFail } from '../deps.js';
import { sanitizeErrorMessage } from '../errors-out.js';
import { withScope } from '../scope.js';
import { EXIT } from '../exit.js';
import { withoutLogs } from './deployments.js';
/**
 * `status`: the resource and, for an application, its latest deployment — fetched together.
 * The JSON `latestDeployment` embeds the build log when the token can read it (hundreds of kB);
 * `--no-logs` replaces it with `logs_length`, which is what a polling agent wants.
 */
export async function statusCmd(args, deps) {
    if (!args.app) {
        return usageFail(args, 'status: --app <name> is required');
    }
    const target = deps.resolveTargetFor(args);
    const client = deps.clientFactory(target);
    // The latest deployment is bonus information: its failure must not fail `status`, but it must
    // not be hidden either (a contract error here is how API drift first shows up).
    let latestError;
    const [app, latest] = await Promise.all([
        withScope('read', () => client.get()),
        withScope('read', () => client.getLatestDeployment()).catch((err) => {
            latestError = sanitizeErrorMessage(err);
            return undefined;
        }),
    ]);
    // With --json the reason is in the document (latestDeploymentError); stderr stays empty on success.
    if (latestError !== undefined && !args.json)
        warn(`status: could not read the latest deployment: ${latestError}`);
    if (args.json) {
        // The raw resource carries webhook secrets, basic-auth fields and compose documents: redacted.
        printJson({
            target: { name: args.app, kind: target.kind, uuid: target.uuid },
            app,
            latestDeployment: latest ? (args.noLogs ? withoutLogs(latest) : latest) : null,
            ...(latestError !== undefined ? { latestDeploymentError: latestError } : {}),
        });
        return EXIT.ok;
    }
    // Human summary
    const extra = app; // reason: kind-specific passthrough fields (applications/databases/is_public) are read defensively
    print(`status for ${args.app} (${target.kind} ${target.uuid})`);
    print(`  name: ${app.name}`);
    print(`  status: ${app.status ?? '(unknown)'}`);
    if (app.fqdn)
        print(`  fqdn: ${app.fqdn}`);
    if (app.git_branch)
        print(`  branch: ${app.git_branch}`);
    if (app.git_commit_sha)
        print(`  commit: ${app.git_commit_sha}`);
    if (typeof extra['image'] === 'string')
        print(`  image: ${extra['image']}`);
    if (typeof extra['is_public'] === 'boolean')
        print(`  public: ${extra['is_public'] ? `yes (port ${String(extra['public_port'])})` : 'no'}`);
    for (const group of ['applications', 'databases']) {
        const subs = extra[group];
        if (Array.isArray(subs)) {
            for (const s of subs)
                print(`  ${group.slice(0, -1)} ${String(s.name)}: ${String(s.status ?? '?')}  ${String(s.image ?? '')}`);
        }
    }
    if (target.kind === 'application') {
        if (latest) {
            const preview = (latest.pull_request_id ?? 0) !== 0 ? ` (preview of pull request #${latest.pull_request_id}; no production deployment among the newest 10)` : '';
            print(`  latest deploy: ${latest.deployment_uuid} [${latest.status}]${preview}`);
            if (latest.commit)
                print(`    commit: ${latest.commit}`);
            if (latest.updated_at)
                print(`    updated: ${latest.updated_at}`);
        }
        else {
            print(latestError === undefined ? '  latest deploy: (none found)' : '  latest deploy: (unavailable — see the warning above)');
        }
    }
    print('NOTE: use --json for full machine-readable output (secrets redacted).');
    return EXIT.ok;
}
