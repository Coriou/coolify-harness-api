import { listServiceImages } from '../../client/compose.js';
import { CoolifyFeatureNotSupportedError } from '../../errors/index.js';
import { print, printJson, requireInstance, warn, usageFail } from '../deps.js';
import { withScope } from '../scope.js';
import { sanitizeErrorMessage } from '../errors-out.js';
import { TESTED_COOLIFY, compatibilityWarning, coolifyCompatibility } from '../../version.js';
import { EXIT } from '../exit.js';
/**
 * `instance info` / `version`: Coolify version + health for an instance, and whether that version
 * is inside the range this harness release is tested against. Outside the range is a WARNING
 * (stderr, and `compatibility` / `warning` in the JSON), never a failure: most commands keep
 * working, but a contract error becomes a likely cause to check first.
 */
export async function instanceInfo(args, deps) {
    const { name, client } = requireInstance(args, deps);
    const [version, health] = await Promise.all([
        withScope('read', () => client.getVersion()),
        client.getHealth().catch((e) => `error: ${sanitizeErrorMessage(e)}`),
    ]);
    const compatibility = coolifyCompatibility(version);
    const warning = compatibilityWarning(version);
    if (args.json) {
        printJson({
            instance: name, url: client.instanceUrl, version, health,
            compatibility, testedCoolify: TESTED_COOLIFY, ...(warning !== undefined ? { warning } : {}),
        });
    }
    else {
        print(`${name} (${client.instanceUrl}): Coolify ${version}, health ${health}`);
        print(compatibility === 'tested'
            ? `  within the tested range (${TESTED_COOLIFY.min}–${TESTED_COOLIFY.max})`
            : `  OUTSIDE the tested range (${TESTED_COOLIFY.min}–${TESTED_COOLIFY.max})`);
    }
    if (warning !== undefined)
        warn(`WARNING: ${warning}`);
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
        return usageFail(args, 'server get: --server <uuid> is required (list them with `servers --instance <name>`)');
    }
    const uuid = args.server;
    const { client } = requireInstance(args, deps);
    const [server, resources, proxy] = await Promise.all([
        withScope('read', () => client.getServer(uuid)),
        withScope('read', () => client.getServerResources(uuid)),
        withScope('read', () => client.getServerProxy(uuid)),
    ]);
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
    'server-patch': 'Checking for / installing OS package updates on a server is not exposed by the Coolify API (checked up to 4.7.5). ' +
        'It exists only in the dashboard: Servers → <server> → Security → Patches (/server/<uuid>/security/patches).',
    'server-reboot': 'Rebooting a server is not exposed by the Coolify API (checked up to 4.7.5). It exists only in the dashboard, on the ' +
        'same Security → Patches page (/server/<uuid>/security/patches), offered after package updates.',
    'instance-upgrade': 'Upgrading Coolify itself is not exposed by the Coolify API (checked up to 4.7.5). Use the dashboard: Settings → Updates ' +
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
