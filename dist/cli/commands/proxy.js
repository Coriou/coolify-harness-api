import { readFile as nodeReadFile } from 'node:fs/promises';
import { formatRedactedDiff, isValidImageRef, listServiceImages, setServiceImage, sha256, splitImageRef, } from '../../client/compose.js';
import { redactDocument } from '../../client/redact.js';
import { CoolifyFeatureNotSupportedError } from '../../errors/index.js';
import { audited, defaultWriteFile, print, printJson, requireInstance, warn } from '../deps.js';
import { withScope } from '../scope.js';
import { EXIT } from '../main.js';
import { asUsageError, imageChanges } from './compose.js';
function requireServer(args) {
    if (!args.server)
        warn(`${args.command.replace('-', ' ')}: --server <uuid> is required (list them with \`servers --instance <name>\`)`);
    return args.server;
}
function requireConfiguration(proxy) {
    if (!proxy.configuration) {
        throw new CoolifyFeatureNotSupportedError('Coolify did not return the proxy configuration. It is only returned to a token with read:sensitive whose user is a team admin/owner, and only once Coolify has stored it (open the server\'s Proxy page once if it never has).');
    }
    return proxy.configuration;
}
/** The proxy service inside the compose: the only one, else the one named after proxy_type. */
function proxyService(compose, proxyType) {
    const services = listServiceImages(compose).map((s) => s.service);
    if (services.length === 1)
        return services[0];
    const byType = services.find((s) => s === (proxyType ?? '').toLowerCase());
    if (byType)
        return byType;
    throw new CoolifyFeatureNotSupportedError(`Cannot tell which service is the proxy (services: ${services.join(', ') || 'none'}). Use --from-file.`);
}
export async function proxyGet(args, deps) {
    const uuid = requireServer(args);
    if (!uuid)
        return EXIT.usage;
    const { client } = requireInstance(args, deps);
    const proxy = await withScope('read', () => client.getServerProxy(uuid));
    const images = proxy.configuration ? listServiceImages(proxy.configuration) : [];
    if (args.out) {
        const conf = requireConfiguration(proxy);
        await (deps.writeFile ?? defaultWriteFile)(args.out, conf);
        warn(`wrote the UNREDACTED proxy compose (${conf.length} bytes, mode 0600) to ${args.out} — do not commit it.`);
    }
    if (args.json) {
        printJson({ ...proxy, images, ...(proxy.configuration ? { sha256: sha256(proxy.configuration) } : {}) });
        return EXIT.ok;
    }
    print(`proxy: ${proxy.proxy_type ?? '?'} [${proxy.status ?? '?'}]  cert resolver: ${proxy.traefik_certificate_resolver ?? '(none)'}  redirect: ${proxy.redirect_enabled ? (proxy.redirect_url ?? 'default') : 'off'}`);
    if (!proxy.configuration) {
        print('configuration: (not returned — needs read:sensitive + team admin, or not stored yet)');
        return EXIT.ok;
    }
    for (const i of images)
        print(`image ${i.service}: ${i.image}`);
    print('---');
    print(redactDocument(proxy.configuration));
    return EXIT.ok;
}
/**
 * `proxy set`: change the proxy (Traefik/Caddy) version with `--image <ref>`, or replace the
 * whole proxy compose with `--from-file`. Dry-run unless --apply. Coolify writes the file and
 * keeps a backup of the old one, but only a restart (`--restart`) pulls and runs the new image —
 * which briefly interrupts every site on that server.
 */
export async function proxySet(args, deps) {
    const uuid = requireServer(args);
    if (!uuid)
        return EXIT.usage;
    if (!args.fromFile && args.images.length !== 1) {
        warn('proxy set: pass exactly one --image <ref> (e.g. traefik:v3.6.4) or --from-file <compose.yml>');
        return EXIT.usage;
    }
    const { client } = requireInstance(args, deps);
    const proxy = await withScope('read:sensitive', () => client.getServerProxy(uuid));
    const before = requireConfiguration(proxy);
    let after;
    if (args.fromFile) {
        after = await (deps.readFile ?? ((p) => nodeReadFile(p, 'utf8')))(args.fromFile);
    }
    else {
        const image = args.images[0];
        if (!isValidImageRef(image))
            throw new CoolifyFeatureNotSupportedError(`Not a valid image reference: '${image}'`);
        after = asUsageError(() => setServiceImage(before, proxyService(before, proxy.proxy_type), image));
    }
    const changes = imageChanges(listServiceImages(before), listServiceImages(after));
    const warnings = [];
    for (const c of changes) {
        if (!c.from || !c.to)
            continue;
        const a = splitImageRef(c.from);
        const b = splitImageRef(c.to);
        if (a.repo !== b.repo)
            warnings.push(`image repository changes (${a.repo} -> ${b.repo})`);
        const major = (t) => /^v?(\d+)/.exec(t ?? '')?.[1];
        if (major(a.tag) && major(b.tag) && major(a.tag) !== major(b.tag)) {
            warnings.push(`major version changes (${a.tag} -> ${b.tag}): read the upstream migration guide first`);
        }
    }
    const diff = formatRedactedDiff(before, after);
    const report = { dryRun: !args.apply, server: uuid, changed: before !== after, imageChanges: changes, warnings, diff };
    if (!args.json) {
        for (const c of changes)
            print(`proxy image ${c.service}: ${c.from ?? '(none)'} -> ${c.to ?? '(removed)'}`);
        for (const w of warnings)
            print(`WARNING: ${w}`);
        for (const line of diff)
            print(line);
    }
    if (before === after || !args.apply) {
        if (args.json)
            printJson(report);
        else
            print(before === after ? 'No changes.' : 'Dry-run. Re-run with --apply to save; add --restart to pull and run it (brief downtime for every site on this server).');
        return EXIT.ok;
    }
    const imageOpt = changes.map((c) => `${c.service}=${c.to ?? ''}`).join(',');
    await audited(deps, {
        instanceUrl: client.instanceUrl, kind: 'server', uuid, action: 'proxy.configuration',
        keysAffected: changes.length > 0 ? changes.map((c) => c.service) : ['configuration'],
        ...(imageOpt ? { options: { images: imageOpt } } : {}),
    }, () => withScope('write+deploy', () => client.saveServerProxyConfiguration(uuid, after)));
    const stored = (await withScope('read:sensitive', () => client.getServerProxy(uuid))).configuration ?? '';
    report['confirmed'] = stored === after;
    if (!args.json) {
        print(stored === after ? 'Saved and confirmed (stored configuration matches).' : 'Saved, but the stored configuration differs from what was sent — review with `proxy get`.');
    }
    if (args.restart) {
        const ack = await audited(deps, { instanceUrl: client.instanceUrl, kind: 'server', uuid, action: 'proxy.restart' }, () => withScope('deploy', () => client.restartServerProxy(uuid)));
        report['restart'] = ack.message;
        if (!args.json)
            print(`${ack.message} Check it with: coolify-harness proxy get --instance ${args.instance ?? '<name>'} --server ${uuid}`);
    }
    else if (!args.json) {
        print(`NOTE: not running yet. Restart to apply: coolify-harness proxy restart --instance ${args.instance ?? '<name>'} --server ${uuid} --apply`);
    }
    if (args.json)
        printJson(report);
    return EXIT.ok;
}
export async function proxyRestart(args, deps) {
    const uuid = requireServer(args);
    if (!uuid)
        return EXIT.usage;
    const { client } = requireInstance(args, deps);
    const proxy = await withScope('read', () => client.getServerProxy(uuid));
    if (!args.apply) {
        if (args.json)
            printJson({ dryRun: true, server: uuid, proxy_type: proxy.proxy_type ?? null, status: proxy.status ?? null });
        else
            print(`would restart the ${proxy.proxy_type ?? '?'} proxy [${proxy.status ?? '?'}] on ${uuid} (pulls the configured image; brief downtime for every site on it). Re-run with --apply.`);
        return EXIT.ok;
    }
    const ack = await audited(deps, { instanceUrl: client.instanceUrl, kind: 'server', uuid, action: 'proxy.restart' }, () => withScope('deploy', () => client.restartServerProxy(uuid)));
    if (args.json)
        printJson(ack);
    else
        print(ack.message);
    return EXIT.ok;
}
