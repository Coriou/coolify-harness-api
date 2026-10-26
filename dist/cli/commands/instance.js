import { listServiceImages } from '../../client/compose.js';
import { CoolifyFeatureNotSupportedError } from '../../errors/index.js';
import { print, printJson, requireInstance, warn } from '../deps.js';
import { withScope } from '../scope.js';
import { EXIT } from '../main.js';
/** `instance info` / `version`: Coolify version + health for an instance. */
export async function instanceInfo(args, deps) {
    const { name, client } = requireInstance(args, deps);
    const version = await withScope('read', () => client.getVersion());
    const health = await client.getHealth().catch((e) => `error: ${e instanceof Error ? e.message : String(e)}`);
    if (args.json)
        printJson({ instance: name, url: client.instanceUrl, version, health });
    else
        print(`${name} (${client.instanceUrl}): Coolify ${version}, health ${health}`);
    return EXIT.ok;
}
export async function serversCmd(args, deps) {
    const { name, client } = requireInstance(args, deps);
    const servers = await withScope('read', () => client.listServers());
    if (args.json) {
        printJson(servers);
        return EXIT.ok;
    }
    print(`servers on ${name}: ${servers.length}`);
    for (const s of servers) {
        // The list payload omits proxy type/status; `server get` / `proxy get` have them.
        print(`  ${s.uuid}  ${s.name}  ${s.ip ?? ''}  reachable=${String(s.is_reachable ?? '?')} usable=${String(s.is_usable ?? '?')}${s.is_coolify_host ? '  (coolify host)' : ''}`);
    }
    return EXIT.ok;
}
/** `server get`: server + its resources + proxy summary (type, status, image). */
export async function serverGet(args, deps) {
    if (!args.server) {
        warn('server get: --server <uuid> is required (list them with `servers --instance <name>`)');
        return EXIT.usage;
    }
    const uuid = args.server;
    const { client } = requireInstance(args, deps);
    const server = await withScope('read', () => client.getServer(uuid));
    const resources = await withScope('read', () => client.getServerResources(uuid));
    const proxy = await withScope('read', () => client.getServerProxy(uuid));
    const proxyImages = proxy.configuration ? listServiceImages(proxy.configuration) : [];
    if (args.json) {
        printJson({ server, resources, proxy: { ...proxy, images: proxyImages } });
        return EXIT.ok;
    }
    print(`server ${server.name} (${server.uuid}) ${server.ip ?? ''}`);
    print(`  reachable=${String(server.is_reachable ?? '?')} usable=${String(server.is_usable ?? '?')}`);
    print(`  proxy: ${proxy.proxy_type ?? '?'} ${proxy.status ?? '?'}${proxyImages.length ? `  image ${proxyImages.map((i) => i.image).join(', ')}` : '  (image unknown: needs read:sensitive)'}`);
    print(`  resources: ${resources.length}`);
    for (const r of resources)
        print(`    ${r.type ?? '?'}  ${r.name}  ${r.status ?? ''}  ${r.uuid}`);
    return EXIT.ok;
}
const NOT_IN_API = {
    'server-patch': 'Checking for / installing OS package updates on a server is not exposed by the Coolify API (4.5.0). ' +
        'It exists only in the dashboard: Servers → <server> → Security → Patches (/server/<uuid>/security/patches).',
    'server-reboot': 'Rebooting a server is not exposed by the Coolify API (4.5.0). It exists only in the dashboard, on the ' +
        'same Security → Patches page (/server/<uuid>/security/patches), offered after package updates.',
    'instance-upgrade': 'Upgrading Coolify itself is not exposed by the Coolify API (4.5.0). Use the dashboard: Settings → Updates ' +
        '(/settings/updates), or its auto-update schedule. `instance info` shows the running version.',
};
/**
 * Commands an operator reasonably expects but the Coolify API does not offer. They fail loudly
 * (exit 2) with where to do it instead — the harness never SSHes into servers or writes Coolify's
 * database to emulate a missing endpoint.
 */
export function notInApi(args) {
    return Promise.reject(new CoolifyFeatureNotSupportedError(`${NOT_IN_API[args.command] ?? 'Not exposed by the Coolify API.'} coolify-harness will not SSH into servers or write Coolify's database to work around this.`));
}
