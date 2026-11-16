import { readFile as nodeReadFile } from 'node:fs/promises';
import type { ParsedArgs } from '../args.js';
import {
  formatRedactedDiff, isValidImageRef, listServiceImages, setServiceImage, sha256, type ServiceImage,
} from '../../client/compose.js';
import { redactDocument } from '../../client/redact.js';
import { CoolifyAuthScopeError, CoolifyFeatureNotSupportedError, UsageError } from '../../errors/index.js';
import { sanitizeErrorMessage } from '../errors-out.js';
import { audited, defaultWriteFile, print, printJson, warn, type CmdDeps, usageFail } from '../deps.js';
import { withScope } from '../scope.js';
import { EXIT } from '../exit.js';

/** Re-throw a helper's input error (unknown service, bad ref) as a usage error (exit 2). */
export function asUsageError<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    throw new CoolifyFeatureNotSupportedError(err instanceof Error ? err.message : String(err));
  }
}

/** Read `--from-file`; a missing or unreadable file is a usage error (exit 2), not an internal one. */
export async function readInputFile(path: string, deps: CmdDeps): Promise<string> {
  try {
    return await (deps.readFile ?? ((p: string) => nodeReadFile(p, 'utf8')))(path);
  } catch (err) {
    const code = (err as { code?: unknown }).code; // reason: probing the optional errno code of an unknown error
    throw new UsageError(`Cannot read --from-file ${path}${typeof code === 'string' ? ` (${code})` : ''}`);
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

/**
 * Coolify hides `docker_compose_raw` (no 403, the field is just missing) from a token without
 * read:sensitive, or whose user is not a team admin/owner. Treating that as an EMPTY compose made
 * `compose get` print nothing, `compose set` produce a whole-file diff and the env-delete lock
 * check pass silently.
 */
function requireCompose(raw: string | null | undefined): string {
  if (raw == null) {
    throw new CoolifyAuthScopeError(
      "Coolify did not return the docker-compose document: it needs a token with 'read:sensitive' whose user is a team admin/owner.",
      { requiredScope: 'read:sensitive' },
    );
  }
  return raw;
}

async function currentCompose(args: ParsedArgs, deps: CmdDeps): Promise<{ compose: string; buildPack?: string | null }> {
  const target = deps.resolveTargetFor(args);
  const client = deps.clientFactory(target);
  if (target.kind === 'service') {
    const svc = await withScope('read:sensitive', () => client.getService());
    return { compose: requireCompose(svc.docker_compose_raw) };
  }
  if (target.kind === 'application') {
    const app = await withScope('read:sensitive', () => client.get());
    // Only a docker-compose application has a compose; the others legitimately have none.
    return {
      compose: app.build_pack === 'dockercompose' ? requireCompose(app.docker_compose_raw) : (app.docker_compose_raw ?? ''),
      buildPack: app.build_pack ?? null,
    };
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
    return usageFail(args, 'compose set: pass --from-file <compose.yml> or one or more --image <service>=<ref>');
  }
  const client = deps.clientFactory(target);
  const { compose: before } = await currentCompose(args, deps);
  let after = args.fromFile ? await readInputFile(args.fromFile, deps) : before;
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

  // The compose is saved. A failing confirmation read must not hide that, nor skip --restart.
  try {
    const stored = (await withScope('read:sensitive', () => client.getService())).docker_compose_raw;
    report['confirmed'] = stored == null ? null : stored === after;
  } catch (err) {
    report['confirmed'] = null;
    report['confirmError'] = sanitizeErrorMessage(err);
    warn(`WARNING: the compose was saved but could not be re-read: ${sanitizeErrorMessage(err)}`);
  }
  if (!args.json) {
    print(report['confirmed'] === true
      ? 'Saved and confirmed (stored compose matches what was sent).'
      : report['confirmed'] === false
        ? 'Saved, but the stored compose differs from what was sent (Coolify normalises on parse) — review with `compose get`.'
        : 'Saved; not confirmed.');
  }
  if (args.restart) {
    try {
      const ack = await audited(deps, {
        instanceUrl: target.instanceUrl, kind: 'service', uuid: target.uuid, action: 'restart', options: { latest: true },
      }, () => withScope('deploy', () => client.restart({ latest: true })));
      report['restart'] = ack.message;
      if (!args.json) print(`restart: ${ack.message}`);
    } catch (err) {
      // The save happened: its report must reach the caller along with the restart error.
      if (args.json) printJson({ ...report, restart: null, restartFailed: true });
      else warn('The compose was saved, but the restart failed (below).');
      throw err;
    }
  } else if (!args.json) {
    print(`NOTE: Coolify does not restart on a compose change. Run: coolify-harness deploy --app ${args.app ?? '<target>'} --restart --latest`);
  }
  if (args.json) printJson(report);
  return EXIT.ok;
}
