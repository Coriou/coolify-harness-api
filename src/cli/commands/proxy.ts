import type { ParsedArgs } from '../args.js';
import {
  countHiddenAdditions, formatRedactedDiff, isValidImageRef, listServiceImages, setServiceImage, sha256, splitImageRef,
} from '../../client/compose.js';
import { redactDocument } from '../../client/redact.js';
import type { ServerProxy } from '../../client/schemas.js';
import { CoolifyFeatureNotSupportedError } from '../../errors/index.js';
import { audited, defaultWriteFile, print, printJson, requireInstance, warn, type CmdDeps, usageFail } from '../deps.js';
import { withScope } from '../scope.js';
import { noteStoredState } from '../write-outcome.js';
import { sanitizeErrorMessage } from '../errors-out.js';
import { EXIT } from '../exit.js';
import { asUsageError, hiddenAdditionsNote, imageChanges, readInputFile, requireServices } from './compose.js';

function requireServer(args: ParsedArgs): string | undefined {
  if (!args.server) usageFail(args, `${args.command.replace('-', ' ')}: --server <uuid> is required (list them with \`servers --instance <name>\`)`);
  return args.server;
}

function requireConfiguration(proxy: ServerProxy): string {
  if (!proxy.configuration) {
    throw new CoolifyFeatureNotSupportedError(
      'Coolify did not return the proxy configuration. It is only returned to a token with read:sensitive whose user is a team admin/owner, and only once Coolify has stored it (open the server\'s Proxy page once if it never has).',
    );
  }
  return proxy.configuration;
}

/** The proxy service inside the compose: the only one, else the one named after proxy_type. */
function proxyService(compose: string, proxyType: string | null | undefined): string {
  const services = listServiceImages(compose).map((s) => s.service);
  if (services.length === 1) return services[0]!;
  const byType = services.find((s) => s === (proxyType ?? '').toLowerCase());
  if (byType) return byType;
  throw new CoolifyFeatureNotSupportedError(`Cannot tell which service is the proxy (services: ${services.join(', ') || 'none'}). Use --from-file.`);
}

export async function proxyGet(args: ParsedArgs, deps: CmdDeps): Promise<number> {
  const uuid = requireServer(args);
  if (!uuid) return EXIT.usage;
  const { client } = requireInstance(args, deps);
  const proxy = await withScope('read', () => client.getServerProxy(uuid));
  const images = proxy.configuration ? listServiceImages(proxy.configuration) : [];
  if (args.out) {
    const conf = requireConfiguration(proxy);
    await (deps.writeFile ?? defaultWriteFile)(args.out, conf);
    if (!args.json) warn(`wrote the UNREDACTED proxy compose (${conf.length} bytes, mode 0600) to ${args.out} — do not commit it.`);
  }
  if (args.json) {
    printJson({
      ...proxy, images, ...(proxy.configuration ? { sha256: sha256(proxy.configuration) } : {}),
      ...(args.out && proxy.configuration ? { out: { path: args.out, bytes: proxy.configuration.length, unredacted: true } } : {}),
    });
    return EXIT.ok;
  }
  print(`proxy: ${proxy.proxy_type ?? '?'} [${proxy.status ?? '?'}]  cert resolver: ${proxy.traefik_certificate_resolver ?? '(none)'}  redirect: ${proxy.redirect_enabled ? (proxy.redirect_url ?? 'default') : 'off'}`);
  if (!proxy.configuration) {
    print('configuration: (not returned — needs read:sensitive + team admin, or not stored yet)');
    return EXIT.ok;
  }
  for (const i of images) print(`image ${i.service}: ${i.image}`);
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
export async function proxySet(args: ParsedArgs, deps: CmdDeps): Promise<number> {
  const uuid = requireServer(args);
  if (!uuid) return EXIT.usage;
  if (!args.fromFile && args.images.length !== 1) {
    return usageFail(args, 'proxy set: pass exactly one --image <ref> (e.g. traefik:v3.6.4) or --from-file <compose.yml>');
  }
  // The file IS the whole configuration: an --image next to it used to be dropped without a word.
  if (args.fromFile && args.images.length > 0) {
    return usageFail(args, 'proxy set: pass --image or --from-file, not both (put the image in the file).');
  }
  const { client } = requireInstance(args, deps);
  const proxy = await withScope('read:sensitive', () => client.getServerProxy(uuid));
  const before = requireConfiguration(proxy);
  let after: string;
  if (args.fromFile) {
    after = await readInputFile(args.fromFile, deps);
    requireServices(after, 'proxy set --from-file');
  } else {
    const image = args.images[0]!;
    if (!isValidImageRef(image)) throw new CoolifyFeatureNotSupportedError(`Not a valid image reference: '${image}'`);
    after = asUsageError(() => setServiceImage(before, proxyService(before, proxy.proxy_type), image));
  }
  const changes = imageChanges(listServiceImages(before), listServiceImages(after));
  const warnings: string[] = [];
  for (const c of changes) {
    if (!c.from || !c.to) continue;
    const a = splitImageRef(c.from);
    const b = splitImageRef(c.to);
    if (a.repo !== b.repo) warnings.push(`image repository changes (${a.repo} -> ${b.repo})`);
    const major = (t: string | undefined): string | undefined => /^v?(\d+)/.exec(t ?? '')?.[1];
    if (major(a.tag) && major(b.tag) && major(a.tag) !== major(b.tag)) {
      warnings.push(`major version changes (${a.tag} -> ${b.tag}): read the upstream migration guide first`);
    }
  }
  const diff = formatRedactedDiff(before, after);
  const hiddenAddedLines = countHiddenAdditions(diff);
  const report: Record<string, unknown> = { dryRun: !args.apply, server: uuid, changed: before !== after, imageChanges: changes, warnings, diff, hiddenAddedLines };
  if (!args.json) {
    for (const c of changes) print(`proxy image ${c.service}: ${c.from ?? '(none)'} -> ${c.to ?? '(removed)'}`);
    for (const w of warnings) print(`WARNING: ${w}`);
    for (const line of diff) print(line);
    if (hiddenAddedLines > 0) print(hiddenAdditionsNote(hiddenAddedLines, args.fromFile !== undefined, `coolify-harness proxy get --instance ${args.instance ?? '<name>'} --server ${uuid} --out FILE`));
  }
  if (before === after || !args.apply) {
    const restartSkipped = before === after && args.apply && args.restart
      ? `nothing changed, so nothing was saved and the proxy was not restarted. To restart it anyway: coolify-harness proxy restart --instance ${args.instance ?? '<name>'} --server ${uuid} --apply`
      : undefined;
    if (args.json) printJson(restartSkipped ? { ...report, restart: null, note: restartSkipped } : report);
    else print(restartSkipped ? `No changes: ${restartSkipped}` : before === after ? 'No changes.' : 'Dry-run. Re-run with --apply to save; add --restart to pull and run it (brief downtime for every site on this server).');
    return EXIT.ok;
  }
  const imageOpt = changes.map((c) => `${c.service}=${c.to ?? ''}`).join(',');
  await audited(deps, {
    instanceUrl: client.instanceUrl, kind: 'server', uuid, action: 'proxy.configuration',
    keysAffected: changes.length > 0 ? changes.map((c) => c.service) : ['configuration'],
    ...(imageOpt ? { options: { images: imageOpt } } : {}),
  }, async () => {
    try {
      return await withScope('write+deploy', () => client.saveServerProxyConfiguration(uuid, after));
    } catch (err) {
      await noteStoredState(err, async () => (await client.getServerProxy(uuid)).configuration, before, after, `coolify-harness proxy get --instance ${args.instance ?? '<name>'} --server ${uuid}`,
        // Coolify records the configuration first and writes the file on the server afterwards.
        'Coolify recorded the new configuration, but the file on the server may not have been written: running the same command again rewrites it.');
      throw err;
    }
  });
  // The configuration is saved. A failing confirmation read must not hide that, nor skip --restart.
  try {
    const stored = (await withScope('read:sensitive', () => client.getServerProxy(uuid))).configuration;
    report['confirmed'] = stored == null ? null : stored === after;
  } catch (err) {
    report['confirmed'] = null;
    report['confirmError'] = sanitizeErrorMessage(err);
    if (!args.json) warn(`WARNING: the proxy configuration was saved but could not be re-read: ${sanitizeErrorMessage(err)}`);
  }
  if (!args.json) {
    print(report['confirmed'] === true
      ? 'Saved and confirmed (stored configuration matches).'
      : report['confirmed'] === false
        ? 'Saved, but the stored configuration differs from what was sent — review with `proxy get`.'
        : 'Saved; not confirmed.');
  }
  if (args.restart) {
    try {
      const ack = await audited(deps, { instanceUrl: client.instanceUrl, kind: 'server', uuid, action: 'proxy.restart' },
        () => withScope('deploy', () => client.restartServerProxy(uuid)));
      report['restart'] = ack.message;
      if (!args.json) print(`${ack.message} Check it with: coolify-harness proxy get --instance ${args.instance ?? '<name>'} --server ${uuid}`);
    } catch (err) {
      if (args.json) printJson({ ...report, restart: null, restartFailed: true });
      else warn('The proxy configuration was saved, but the restart failed (below).');
      throw err;
    }
  } else if (!args.json) {
    print(`NOTE: not running yet. Restart to apply: coolify-harness proxy restart --instance ${args.instance ?? '<name>'} --server ${uuid} --apply`);
  }
  if (args.json) printJson(report);
  return EXIT.ok;
}

export async function proxyRestart(args: ParsedArgs, deps: CmdDeps): Promise<number> {
  const uuid = requireServer(args);
  if (!uuid) return EXIT.usage;
  const { client } = requireInstance(args, deps);
  const proxy = await withScope('read', () => client.getServerProxy(uuid));
  if (!args.apply) {
    if (args.json) printJson({ dryRun: true, server: uuid, proxy_type: proxy.proxy_type ?? null, status: proxy.status ?? null });
    else print(`would restart the ${proxy.proxy_type ?? '?'} proxy [${proxy.status ?? '?'}] on ${uuid} (pulls the configured image; brief downtime for every site on it). Re-run with --apply.`);
    return EXIT.ok;
  }
  const ack = await audited(deps, { instanceUrl: client.instanceUrl, kind: 'server', uuid, action: 'proxy.restart' },
    () => withScope('deploy', () => client.restartServerProxy(uuid)));
  if (args.json) printJson(ack);
  else print(ack.message);
  return EXIT.ok;
}
