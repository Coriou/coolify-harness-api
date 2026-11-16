import { isValidImageRef } from '../../client/compose.js';
import { CoolifyFeatureNotSupportedError } from '../../errors/index.js';
import { audited, print, printJson, requireInstance, warn, usageFail } from '../deps.js';
import { withScope } from '../scope.js';
import { sanitizeErrorMessage } from '../errors-out.js';
import { EXIT } from '../exit.js';
/**
 * Standalone databases are addressed either by a configured target of kind `database` (`--app`)
 * or ad hoc with `--instance <name> --database <uuid>`. Databases inside a service (e.g. a
 * template's postgres) are a different API (`/services/{uuid}/databases/...`) and not covered.
 */
function resolveDatabase(args, deps) {
    if (args.app && !args.database) {
        const target = deps.resolveTargetFor(args);
        if (target.kind !== 'database') {
            throw new CoolifyFeatureNotSupportedError(`'${args.app}' is a ${target.kind} target; database commands need a target of kind 'database' or --instance + --database <uuid>.`);
        }
        return { client: requireInstance(args, deps).client, uuid: target.uuid };
    }
    if (!args.database) {
        usageFail(args, `${args.command.replace('-', ' ')}: --app <database target> or --instance <name> --database <uuid> is required`);
        return undefined;
    }
    return { client: requireInstance(args, deps).client, uuid: args.database };
}
export async function databasesCmd(args, deps) {
    const { name, client } = requireInstance(args, deps);
    const dbs = await withScope('read', () => client.listDatabases());
    if (args.json) {
        printJson(dbs);
        return EXIT.ok;
    }
    print(`standalone databases on ${name}: ${dbs.length}`);
    for (const d of dbs) {
        print(`  ${d.uuid}  ${d.name}  ${d.database_type ?? '?'}  ${d.status ?? '?'}  ${d.image ?? ''}  public=${d.is_public ? `yes:${String(d.public_port)}` : 'no'}`);
    }
    return EXIT.ok;
}
export async function databaseGet(args, deps) {
    const db = resolveDatabase(args, deps);
    if (!db)
        return EXIT.usage;
    const [record, backups] = await Promise.all([
        withScope('read', () => db.client.getDatabase(db.uuid)),
        withScope('read', () => db.client.listDatabaseBackups(db.uuid)),
    ]);
    if (args.json) {
        printJson({ database: record, backups });
        return EXIT.ok;
    }
    print(`database ${record.name} (${record.uuid}) ${record.database_type ?? ''}`);
    print(`  status: ${record.status ?? '?'}  image: ${record.image ?? '?'}`);
    print(`  public: ${record.is_public ? `yes (port ${String(record.public_port)})` : 'no'}`);
    print(`  scheduled backups: ${backups.length}${backups.length === 0 ? '  (none — no recovery points from Coolify)' : ''}`);
    return EXIT.ok;
}
function desiredUpdate(args) {
    const patch = {};
    if (args.public !== undefined)
        patch.is_public = args.public;
    if (args.publicPort !== undefined)
        patch.public_port = args.publicPort;
    if (args.images.length > 1)
        throw new CoolifyFeatureNotSupportedError('database set takes a single --image <ref>');
    const image = args.images[0];
    if (image !== undefined) {
        if (!isValidImageRef(image))
            throw new CoolifyFeatureNotSupportedError(`Not a valid image reference: '${image}'`);
        patch.image = image;
    }
    return patch;
}
/** `database set`: --public true|false, --public-port N, --image REF. Dry-run unless --apply. */
export async function databaseSet(args, deps) {
    const db = resolveDatabase(args, deps);
    if (!db)
        return EXIT.usage;
    const patch = desiredUpdate(args);
    if (Object.keys(patch).length === 0) {
        return usageFail(args, 'database set: nothing to change (use --public true|false, --public-port <n>, --image <ref>)');
    }
    const before = await withScope('read', () => db.client.getDatabase(db.uuid));
    const changes = Object.keys(patch)
        .map((k) => ({ field: k, from: before[k] ?? null, to: patch[k] }))
        .filter((c) => c.from !== c.to);
    const effective = Object.fromEntries(changes.map((c) => [c.field, c.to]));
    // Coolify starts the public-port proxy only when ONE request carries both `is_public: true` and
    // `public_port`, and only for a database that was not public yet. Sending just the field that
    // changed flipped the column and left the port closed.
    const willBePublic = effective.is_public ?? before.is_public === true;
    const notes = [];
    if (willBePublic && ('is_public' in effective || 'public_port' in effective)) {
        const port = effective.public_port ?? before.public_port ?? undefined;
        if (port === undefined) {
            return usageFail(args, 'database set: making a database public needs a port: add --public-port <n> (1024-65535).');
        }
        effective.is_public = true;
        effective.public_port = port;
        if (before.is_public === true && 'public_port' in effective && before.public_port !== port) {
            notes.push('Coolify does not move the port of a database that is already public: the new port is stored, but the proxy keeps the old one. To apply it, run `database set --public false --apply`, then `--public true --public-port <n> --apply`.');
        }
    }
    const report = { dryRun: !args.apply, database: db.uuid, changes, ...(notes.length > 0 ? { notes } : {}) };
    if (!args.json) {
        for (const c of changes)
            print(`${c.field}: ${String(c.from)} -> ${String(c.to)}`);
        for (const n of notes)
            print(`NOTE: ${n}`);
    }
    if (changes.length === 0 || !args.apply) {
        if (args.json)
            printJson(report);
        else
            print(changes.length === 0 ? 'No changes.' : 'Dry-run. Re-run with --apply to update.');
        return EXIT.ok;
    }
    const scope = 'is_public' in effective ? 'write+deploy' : 'write';
    await audited(deps, {
        instanceUrl: db.client.instanceUrl, kind: 'database', uuid: db.uuid, action: 'database.update',
        keysAffected: changes.map((c) => c.field),
        options: Object.fromEntries(changes.filter((c) => c.field !== 'image').map((c) => [c.field, c.to])),
    }, () => withScope(scope, () => db.client.updateDatabase(db.uuid, effective)));
    // The update is done. A failing confirmation read must not turn it into a failure.
    let confirmed = null;
    try {
        const after = await withScope('read', () => db.client.getDatabase(db.uuid));
        confirmed = changes.every((c) => after[c.field] === c.to);
    }
    catch (err) {
        report['confirmError'] = sanitizeErrorMessage(err);
        if (!args.json)
            warn(`WARNING: the database was updated but could not be re-read: ${sanitizeErrorMessage(err)}`);
    }
    report['confirmed'] = confirmed;
    if (args.json)
        printJson(report);
    else {
        print(confirmed === true ? 'Updated and confirmed.' : confirmed === false ? 'Updated, but the re-read does not match yet — re-check with `database get`.' : 'Updated; not confirmed.');
        if ('image' in effective)
            print('NOTE: a new image takes effect on the next restart: coolify-harness deploy --app <db target> --restart');
    }
    return EXIT.ok;
}
export async function databaseBackups(args, deps) {
    const db = resolveDatabase(args, deps);
    if (!db)
        return EXIT.usage;
    const backups = await withScope('read', () => db.client.listDatabaseBackups(db.uuid));
    if (args.json) {
        printJson(backups);
        return EXIT.ok;
    }
    if (backups.length === 0)
        print('No scheduled backups configured for this database.');
    for (const b of backups) {
        const execs = [...(b.executions ?? [])].sort((x, y) => (y.created_at ?? '').localeCompare(x.created_at ?? ''));
        print(`backup ${b.uuid}  ${b.frequency ?? '?'}  enabled=${String(b.enabled ?? '?')}  s3=${String(b.save_s3 ?? '?')}  executions=${execs.length}`);
        for (const e of execs.slice(0, 5))
            print(`    ${e.created_at ?? '?'}  ${e.status ?? '?'}  ${e.filename ?? ''}  ${e.size ?? ''}`);
    }
    return EXIT.ok;
}
/** `database backup`: run an existing backup configuration now. Dry-run unless --apply. */
export async function databaseBackup(args, deps) {
    const db = resolveDatabase(args, deps);
    if (!db)
        return EXIT.usage;
    const backups = await withScope('read', () => db.client.listDatabaseBackups(db.uuid));
    const chosen = args.backup ? backups.find((b) => b.uuid === args.backup) : backups.length === 1 ? backups[0] : undefined;
    if (!chosen) {
        return usageFail(args, backups.length === 0
            ? 'database backup: this database has no backup configuration; create one in the dashboard first.'
            : `database backup: pick one with --backup <uuid>: ${backups.map((b) => `${b.uuid} (${b.frequency ?? '?'})`).join(', ')}`);
    }
    if (!args.apply) {
        if (args.json)
            printJson({ dryRun: true, database: db.uuid, backup: chosen.uuid });
        else
            print(`would run backup ${chosen.uuid} (${chosen.frequency ?? '?'}) now. Re-run with --apply.`);
        return EXIT.ok;
    }
    await audited(deps, {
        instanceUrl: db.client.instanceUrl, kind: 'database', uuid: db.uuid, action: 'database.backup', keysAffected: [chosen.uuid],
    }, () => withScope('write+deploy', () => db.client.runDatabaseBackup(db.uuid, chosen.uuid)));
    if (args.json)
        printJson({ dryRun: false, database: db.uuid, backup: chosen.uuid, queued: true });
    else
        print(`backup ${chosen.uuid} queued. Follow it with: coolify-harness database backups --instance <name> --database ${db.uuid}`);
    return EXIT.ok;
}
