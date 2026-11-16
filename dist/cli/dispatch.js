import { CoolifyClient } from '../client/coolify.js';
import { CoolifyInstanceClient } from '../client/instance.js';
import { createLogger } from '../logging/index.js';
import { loadConfigModule, resolveInstance, resolveTarget } from '../config/load.js';
import { configPathFor } from './config-path.js';
import { ConfigError } from '../errors/index.js';
import { makeAuditSink } from './audit-sink.js';
import { printJson } from './deps.js';
import { EXIT } from './exit.js';
export function buildDepsFrom(mod) {
    const logger = createLogger({ sink: () => { } });
    const clientDeps = { fetchImpl: (url, init) => globalThis.fetch(url, init), logger };
    return {
        resolveTargetFor: (a) => {
            if (!a.app) {
                throw new ConfigError(`--app <target> is required for this command (known targets: ${Object.keys(mod.registry.targets).join(', ') || 'none'})`);
            }
            return resolveTarget(mod.registry, a.app, process.env);
        },
        clientFactory: (target) => new CoolifyClient(target, clientDeps),
        instanceFor: (a) => {
            if (a.app && !a.instance && !mod.registry.targets[a.app]) {
                throw new ConfigError(`Unknown target '${a.app}'. Known targets: ${Object.keys(mod.registry.targets).join(', ')}`);
            }
            const name = a.instance ?? (a.app ? mod.registry.targets[a.app]?.instance : undefined);
            if (!name) {
                throw new ConfigError(`--instance <name> is required (known instances: ${Object.keys(mod.registry.instances).join(', ')})`);
            }
            return { name, client: new CoolifyInstanceClient(resolveInstance(mod.registry, name, process.env), clientDeps) };
        },
        actor: process.env['USER'] ?? process.env['GITHUB_ACTOR'] ?? 'unknown',
        auditSink: makeAuditSink('.coolify-harness/audit.jsonl'),
    };
}
/**
 * Route a parsed command. Each command module is imported only when it runs, so `status` does not
 * pay for the catalog walker or the compose differ.
 */
export async function dispatch(args) {
    switch (args.command) {
        case 'help': return (await import('./commands/help.js')).helpCmd(args);
        case 'catalog-gen': return (await import('./commands/catalog.js')).catalogGen(args);
        case 'catalog-check': return (await import('./commands/catalog.js')).catalogCheck(args);
        case 'config-doctor': return (await import('./commands/config-doctor.js')).configDoctor(args);
        case 'server-patch':
        case 'server-reboot':
        case 'instance-upgrade':
            return (await import('./commands/instance.js')).notInApi(args);
        default:
            break;
    }
    const deps = buildDepsFrom(await loadConfigModule(configPathFor(args)));
    switch (args.command) {
        case 'env-diff': return (await import('./commands/env.js')).envDiff(args, deps);
        case 'env-apply': return (await import('./commands/env.js')).envApply(args, deps);
        case 'env-list': return (await import('./commands/env.js')).envList(args, deps);
        case 'env-delete': return (await import('./commands/env.js')).envDelete(args, deps);
        case 'flag-set': return flagSet(args, deps);
        case 'deploy': return (await import('./commands/deploy.js')).deployCmd(args, deps);
        case 'status': return (await import('./commands/status.js')).statusCmd(args, deps);
        case 'logs': return (await import('./commands/logs.js')).logsCmd(args, deps);
        case 'deployments':
        case 'deployment':
            return (await import('./commands/deployments.js')).deploymentsCmd(args, deps);
        case 'deployment-cancel': return (await import('./commands/deployments.js')).deploymentCancelCmd(args, deps);
        case 'compose-get': return (await import('./commands/compose.js')).composeGet(args, deps);
        case 'compose-set': return (await import('./commands/compose.js')).composeSet(args, deps);
        case 'instance-info': return (await import('./commands/instance.js')).instanceInfo(args, deps);
        case 'servers': return (await import('./commands/instance.js')).serversCmd(args, deps);
        case 'server-get': return (await import('./commands/instance.js')).serverGet(args, deps);
        case 'proxy-get': return (await import('./commands/proxy.js')).proxyGet(args, deps);
        case 'proxy-set': return (await import('./commands/proxy.js')).proxySet(args, deps);
        case 'proxy-restart': return (await import('./commands/proxy.js')).proxyRestart(args, deps);
        case 'databases': return (await import('./commands/database.js')).databasesCmd(args, deps);
        case 'database-get': return (await import('./commands/database.js')).databaseGet(args, deps);
        case 'database-set': return (await import('./commands/database.js')).databaseSet(args, deps);
        case 'database-backups': return (await import('./commands/database.js')).databaseBackups(args, deps);
        case 'database-backup': return (await import('./commands/database.js')).databaseBackup(args, deps);
        default:
            return EXIT.usage;
    }
}
/**
 * `flag set`: `env apply` and, with `--redeploy`, a deploy — but ONLY after a real write.
 * Without `--apply` the env step is a dry-run, and redeploying then would be a mutation behind a
 * dry-run (it used to do exactly that). With `--json` both steps share one document.
 */
export async function flagSet(args, deps) {
    const { runEnvApply } = await import('./commands/env.js');
    const env = await runEnvApply(args, deps);
    if (!args.redeploy || env.code !== EXIT.ok) {
        if (args.json)
            printJson(env.doc);
        return env.code;
    }
    if (!args.apply) {
        if (args.json)
            printJson({ ...env.doc, deploy: { dryRun: true, skipped: 'env apply was a dry-run; --redeploy needs --apply' } });
        else
            process.stdout.write('--redeploy skipped: this was a dry-run. Re-run with --apply to write and redeploy.\n');
        return EXIT.ok;
    }
    const { runDeploy } = await import('./commands/deploy.js');
    let deploy;
    try {
        deploy = await runDeploy(args, deps);
    }
    catch (err) {
        // The env write already happened: its document must not be lost with the deploy error.
        if (args.json)
            printJson({ ...env.doc, deploy: null });
        throw err;
    }
    if (args.json)
        printJson({ ...env.doc, deploy: deploy.doc });
    return deploy.code;
}
