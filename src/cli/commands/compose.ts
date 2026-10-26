import { readFile as nodeReadFile } from 'node:fs/promises';
import type { ParsedArgs } from '../args.js';
import {
  formatRedactedDiff, isValidImageRef, listServiceImages, setServiceImage, sha256, type ServiceImage,
} from '../../client/compose.js';
import { redactDocument } from '../../client/redact.js';
import { CoolifyFeatureNotSupportedError } from '../../errors/index.js';
import { audited, defaultWriteFile, print, printJson, warn, type CmdDeps } from '../deps.js';
import { withScope } from '../scope.js';
import { EXIT } from '../main.js';

/** Re-throw a helper's input error (unknown service, bad ref) as a usage error (exit 2). */
export function asUsageError<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    throw new CoolifyFeatureNotSupportedError(err instanceof Error ? err.message : String(err));
  }
}

/** Parse repeated `--image name=ref` into pairs (a bare ref is rejected: services have several images). */
export function parseImageAssignments(values: string[]): Array<{ service: string; image: string }> {
  return values.map((v) => {
    const eq = v.indexOf('=');
    if (eq <= 0) throw new CoolifyFeatureNotSupportedError(`--image for compose expects <service>=<image>, got '${v}'`);
    const service = v.slice(0, eq);
    const image = v.slice(eq + 1);
    if (!isValidImageRef(image)) throw new CoolifyFeatureNotSupportedError(`Not a valid image reference: '${image}'`);
    return { service, image };
  });
}

export function imageChanges(before: ServiceImage[], after: ServiceImage[]): Array<{ service: string; from: string | null; to: string | null }> {
  const names = [...new Set([...before, ...after].map((s) => s.service))];
  return names
    .map((service) => ({
      service,
      from: before.find((s) => s.service === service)?.image ?? null,
      to: after.find((s) => s.service === service)?.image ?? null,
    }))
    .filter((c) => c.from !== c.to);
}

async function currentCompose(args: ParsedArgs, deps: CmdDeps): Promise<{ compose: string; buildPack?: string | null }> {
  const target = deps.resolveTargetFor(args);
  const client = deps.clientFactory(target);
  if (target.kind === 'service') {
    const svc = await withScope('read', () => client.getService());
    return { compose: svc.docker_compose_raw ?? '' };
  }
  if (target.kind === 'application') {
    const app = await withScope('read', () => client.get());
    return { compose: app.docker_compose_raw ?? '', buildPack: app.build_pack ?? null };
  }
  throw new CoolifyFeatureNotSupportedError('Standalone databases have no docker-compose document.');
}

/**
 * `compose get`: the stored docker-compose, secrets redacted on stdout. `--out FILE` writes the
 * UNREDACTED document (mode 0600) for editing — keep that file out of git.
 */
export async function composeGet(args: ParsedArgs, deps: CmdDeps): Promise<number> {
  const target = deps.resolveTargetFor(args);
  const { compose, buildPack } = await currentCompose(args, deps);
  const images = listServiceImages(compose);
  if (args.out) {
    await (deps.writeFile ?? defaultWriteFile)(args.out, compose);
    warn(`wrote the UNREDACTED compose (${compose.length} bytes, mode 0600) to ${args.out} — it may contain secrets; do not commit it.`);
  }
  if (args.json) {
    printJson({ uuid: target.uuid, kind: target.kind, sha256: sha256(compose), images, compose: redactDocument(compose) });
    return EXIT.ok;
  }
  for (const i of images) print(`# ${i.service}: ${i.image}`);
  if (target.kind === 'application' && buildPack === 'dockercompose') {
    print('# NOTE: this application deploys its compose from git; edit it in the repository, not here.');
  }
  print(redactDocument(compose));
  return EXIT.ok;
}

/**
 * `compose set` (services): replace the stored docker-compose from `--from-file`, or bump images
 * with `--image <service>=<ref>`. Dry-run (redacted diff) unless --apply. Coolify validates and
 * re-parses the compose but does NOT restart; `--restart` restarts with latest=true so new tags
 * are pulled.
 */
export async function composeSet(args: ParsedArgs, deps: CmdDeps): Promise<number> {
  const target = deps.resolveTargetFor(args);
  if (target.kind !== 'service') {
    throw new CoolifyFeatureNotSupportedError(
      target.kind === 'application'
        ? 'compose set only edits services. A dockercompose application deploys its compose from git — commit the change to the repository and deploy.'
        : 'Standalone databases have no docker-compose document; use `database set --image` instead.',
    );
  }
  if (!args.fromFile && args.images.length === 0) {
    warn('compose set: pass --from-file <compose.yml> or one or more --image <service>=<ref>');
    return EXIT.usage;
  }
  const client = deps.clientFactory(target);
  const { compose: before } = await currentCompose(args, deps);
  let after = args.fromFile ? await (deps.readFile ?? ((p: string) => nodeReadFile(p, 'utf8')))(args.fromFile) : before;
  for (const { service, image } of parseImageAssignments(args.images)) after = asUsageError(() => setServiceImage(after, service, image));

  const changes = imageChanges(listServiceImages(before), listServiceImages(after));
  const diff = formatRedactedDiff(before, after);
  const report: Record<string, unknown> = { dryRun: !args.apply, uuid: target.uuid, changed: before !== after, imageChanges: changes, diff };
  if (!args.json) {
    for (const c of changes) print(`image ${c.service}: ${c.from ?? '(none)'} -> ${c.to ?? '(removed)'}`);
    for (const line of diff) print(line);
  }
  if (before === after || !args.apply) {
    if (args.json) printJson(report);
    else print(before === after ? 'No changes.' : 'Dry-run. Re-run with --apply to save (add --restart to restart with fresh images).');
    return EXIT.ok;
  }
  const keysAffected = changes.length > 0 ? changes.map((c) => c.service) : ['docker_compose_raw'];
  const imagesOpt = changes.map((c) => `${c.service}=${c.to ?? ''}`).join(',');
  await audited(deps, {
    instanceUrl: target.instanceUrl, kind: 'service', uuid: target.uuid, action: 'compose.update', keysAffected,
    ...(imagesOpt ? { options: { images: imagesOpt } } : {}),
  }, () => withScope('write', () => client.updateServiceCompose(after)));

  const stored = (await withScope('read', () => client.getService())).docker_compose_raw ?? '';
  report['confirmed'] = stored === after;
  if (!args.json) {
    print(stored === after
      ? 'Saved and confirmed (stored compose matches what was sent).'
      : 'Saved, but the stored compose differs from what was sent (Coolify normalises on parse) — review with `compose get`.');
  }
  if (args.restart) {
    const ack = await audited(deps, {
      instanceUrl: target.instanceUrl, kind: 'service', uuid: target.uuid, action: 'restart', options: { latest: true },
    }, () => withScope('deploy', () => client.restart({ latest: true })));
    report['restart'] = ack.message;
    if (!args.json) print(`restart: ${ack.message}`);
  } else if (!args.json) {
    print(`NOTE: Coolify does not restart on a compose change. Run: coolify-harness deploy --app ${args.app ?? '<target>'} --restart --latest`);
  }
  if (args.json) printJson(report);
  return EXIT.ok;
}
