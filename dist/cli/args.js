import { UsageError } from '../errors/index.js';
const COMMANDS = {
    'catalog gen': 'catalog-gen',
    'catalog check': 'catalog-check',
    'env diff': 'env-diff',
    'env apply': 'env-apply',
    'env list': 'env-list',
    'env delete': 'env-delete',
    'flag set': 'flag-set',
    deploy: 'deploy',
    'config doctor': 'config-doctor',
    status: 'status',
    logs: 'logs',
    deployments: 'deployments',
    deployment: 'deployment',
    'deployment cancel': 'deployment-cancel',
    'compose get': 'compose-get',
    'compose set': 'compose-set',
    'instance info': 'instance-info',
    version: 'instance-info',
    'instance upgrade': 'instance-upgrade',
    servers: 'servers',
    'server get': 'server-get',
    'server patch': 'server-patch',
    'server reboot': 'server-reboot',
    'proxy get': 'proxy-get',
    'proxy set': 'proxy-set',
    'proxy restart': 'proxy-restart',
    databases: 'databases',
    'database get': 'database-get',
    'database set': 'database-set',
    'database backups': 'database-backups',
    'database backup': 'database-backup',
    help: 'help',
};
/** Every command as typed on the command line (`env diff`, `deploy`, …). */
export const COMMAND_NAMES = Object.keys(COMMANDS);
/** Flags that consume the next token as their value (everything else is a boolean switch). */
const VALUE_FLAGS = new Set([
    '--config', '--app', '--from-file', '--set', '--lines', '--deployment', '--take', '--skip',
    '--instance', '--server', '--database', '--backup', '--timeout', '--key', '--out', '--image',
    '--service', '--public', '--public-port', '--token-file', '--env-file',
]);
/** Switches. Listed so `--tak=5` is an unknown flag, not "a flag that takes no value". */
const BOOLEAN_FLAGS = new Set([
    '--apply', '--yes', '--redeploy', '--restart', '--json', '--fail-on-drift', '--build', '--runtime',
    '--wait', '--force', '--latest', '--preview', '--timestamps', '--running', '--version', '--dry-run',
    '--fail-on-changes', '--no-logs', '--offline',
]);
/** Flags that say how to run, not what: allowed next to `--version`. */
const GLOBAL_FLAGS = new Set(['--json', '--config', '--token-file']);
const usage = (message) => new UsageError(message);
const own = (map, key) => (Object.hasOwn(map, key) ? map[key] : undefined);
/** A flag NAME is vocabulary, but something very long after `--` is more likely a pasted value. */
const flagName = (tok) => (/^--[a-z][a-z-]{0,30}$/.test(tok) ? tok : `<${tok.length}-character flag>`);
/**
 * A word the user typed is echoed back only when it is part of the command vocabulary. Anything
 * else may be a secret that slipped out of its flag (`--set KEY= value`): error text ends up in
 * logs and transcripts, so it is described, never quoted.
 */
const VOCABULARY = new Set(Object.keys(COMMANDS).flatMap((c) => [c, c.replace(' ', '-'), c.replace(' ', ':'), ...c.split(' ')]));
const show = (words) => words.map((w) => (VOCABULARY.has(w.toLowerCase()) ? w : `<${w.length}-character word>`)).join(' ');
/** Marks a value that came from `--flag=value`, so `--set K=--x` is not mistaken for a missing value. */
const EQ = '\u0000=';
/**
 * Split the argv into the command words and the flags, tolerating the forms agents actually type:
 * `--flag=value`, hyphen/colon command spellings (`env-diff`, `env:diff`), and flags placed before
 * the command (`--app x status`). `-h` / `--help` anywhere selects `help`.
 */
function normalize(argv) {
    // `--help` wins over everything else on the line, also over a flag that is missing its value.
    // `--json` still decides the format.
    const json = argv.includes('--json') ? ['--json'] : [];
    if (argv.some((t) => t === '-h' || t === '--help'))
        return { words: ['help'], flags: json };
    const tokens = [];
    for (const t of argv) {
        const eq = t.startsWith('--') ? t.indexOf('=') : -1;
        if (eq > 2)
            tokens.push(t.slice(0, eq), `${EQ}${t.slice(eq + 1)}`);
        else
            tokens.push(t);
    }
    const words = [];
    const flags = [];
    for (let i = 0; i < tokens.length; i += 1) {
        const t = tokens[i];
        if (t === '-v') {
            flags.push('--version');
            continue;
        }
        if (t.startsWith('--')) {
            flags.push(t);
            if (VALUE_FLAGS.has(t)) {
                const v = tokens[i + 1];
                // `--app --json`: the next token is another flag, so the value is missing — do not swallow it.
                if (v === undefined || (v.startsWith('--') && v !== '--'))
                    throw usage(`Missing value for ${t}`);
                flags.push(v.startsWith(EQ) ? v.slice(EQ.length) : v);
                i += 1;
            }
            else if (tokens[i + 1]?.startsWith(EQ)) {
                throw usage(BOOLEAN_FLAGS.has(t) ? `${t} does not take a value` : `Unknown flag: ${flagName(t)}`);
            }
            continue;
        }
        words.push(t.startsWith(EQ) ? t.slice(EQ.length) : t);
    }
    // `--version` / `-v` stand alone — next to global flags at most (`--config`, `--token-file`,
    // `--json`: a wrapper script adds those). Beside a command or any other flag they are refused,
    // and nothing runs: `deploy --app x --version` used to deploy, and answering it with a version
    // line and exit 0 would let `env apply … --apply -v` ("verbose"?) pass for a write that never
    // happened.
    if (flags.includes('--version')) {
        let alone = words.length === 0;
        for (let k = 0; k < flags.length && alone; k += 1) {
            const flag = flags[k]; // reason: k < flags.length
            if (flag === '--version')
                continue;
            if (!GLOBAL_FLAGS.has(flag))
                alone = false;
            else if (VALUE_FLAGS.has(flag))
                k += 1; // its value
        }
        if (!alone)
            throw usage('--version (-v) stands alone: `coolify-harness --version`. Nothing was run. (There is no verbose flag.)');
    }
    return { words, flags };
}
function resolveCommand(words) {
    if (words[0] === 'help')
        return { command: 'help', positionals: [] };
    let w = words;
    const first = w[0] ?? '';
    const split = first.replace(/[-:]/, ' ');
    // Own properties only: `constructor` and `toString` are not commands.
    if (split !== first && Object.hasOwn(COMMANDS, split))
        w = [...split.split(' '), ...w.slice(1)];
    const two = own(COMMANDS, w.slice(0, 2).join(' '));
    if (two !== undefined)
        return { command: two, positionals: w.slice(2) };
    const one = w[0] ?? '';
    const single = own(COMMANDS, one);
    if (single !== undefined)
        return { command: single, positionals: w.slice(1) };
    if (w.length === 0)
        throw usage('No command given. Run `coolify-harness help`.');
    const typed = w.slice(0, 2).join(' ');
    const near = nearestCommand(typed) ?? nearestCommand(one);
    throw usage(`Unknown command: ${show(w)}.${near ? ` Did you mean \`${near}\`?` : ''} Run \`coolify-harness help\`.`);
}
function editDistance(a, b) {
    const row = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i += 1) {
        let prev = row[0];
        row[0] = i;
        for (let j = 1; j <= b.length; j += 1) {
            const cur = row[j];
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
            prev = cur;
        }
    }
    return row[b.length];
}
/** Closest known command within a couple of typos, or the group's first command (`env` → `env list`). */
function nearestCommand(typed) {
    if (typed === '')
        return undefined;
    const group = COMMAND_NAMES.filter((c) => c.startsWith(`${typed} `));
    if (group.length > 0)
        return group.join('`, `');
    let best;
    for (const name of COMMAND_NAMES) {
        const d = editDistance(typed, name);
        if (d <= 2 && (!best || d < best.d))
            best = { name, d };
    }
    return best?.name;
}
/** Plain decimal digits only: `0x10`, `1e3` and an empty `--skip=` are not numbers here. */
function parseNumber(flag, v, min, max = 2 ** 31 - 1) {
    const n = /^\d{1,10}$/.test(v) ? Number(v) : Number.NaN;
    if (!(n >= min && n <= max))
        throw usage(`${flag} expects a whole number from ${min} to ${max}`);
    return n;
}
function parseBool(flag, v) {
    if (/^(true|yes|on|1)$/i.test(v))
        return true;
    if (/^(false|no|off|0)$/i.test(v))
        return false;
    throw usage(`${flag} expects true or false`);
}
export function parseArgs(argv) {
    const { words, flags } = normalize(argv);
    // `coolify-harness --version` has no command: it is its own (local) action, served by `help`.
    const versionOnly = words.length === 0 && flags.includes('--version');
    const { command, positionals } = versionOnly ? { command: 'help', positionals: [] } : resolveCommand(words);
    const out = {
        command, config: 'coolify-harness.config.ts',
        apply: false, yes: false, redeploy: false, restart: false, json: false, failOnDrift: false, set: {},
        build: false, runtime: false, wait: false,
        force: false, latest: false, keys: [], preview: false, images: [], timestamps: false, running: false,
    };
    // "deployment <uuid>" / "deployment cancel <uuid>" take the uuid positionally.
    if (positionals.length > 0) {
        if ((command === 'deployment' || command === 'deployment-cancel') && positionals.length === 1) {
            out.deployment = positionals[0];
        }
        else {
            throw usage(`${positionals.length} unexpected argument(s) after the command (not echoed: they may be secret). Values belong to a flag, e.g. --app NAME, --set KEY=VALUE.`);
        }
    }
    for (let i = 0; i < flags.length; i += 1) {
        const tok = flags[i];
        const next = () => {
            const v = flags[i + 1];
            // `--app=` is a missing value too, not an empty name.
            if (v === undefined || v === '')
                throw usage(`Missing value for ${tok}`);
            i += 1;
            return v;
        };
        switch (tok) {
            case '--config':
                out.config = next();
                out.configExplicit = true;
                break;
            case '--app':
                out.app = next();
                break;
            case '--apply':
                out.apply = true;
                break;
            case '--yes':
                out.yes = true;
                break;
            case '--redeploy':
                out.redeploy = true;
                break;
            case '--restart':
                out.restart = true;
                break;
            case '--json':
                out.json = true;
                break;
            case '--fail-on-drift':
                out.failOnDrift = true;
                break;
            case '--from-file':
                out.fromFile = next();
                break;
            case '--set': {
                const pair = next();
                const eq = pair.indexOf('=');
                // Never echo the argument: without an `=` the whole token may be a pasted secret.
                if (eq < 0)
                    throw usage('--set expects KEY=VALUE (no `=` found)');
                if (eq === 0)
                    throw usage('--set expects KEY=VALUE (the key is empty)');
                // Assigning it would set the object's prototype and silently drop the pair.
                if (pair.slice(0, eq) === '__proto__')
                    throw usage('--set: __proto__ cannot be used as a variable name');
                out.set[pair.slice(0, eq)] = pair.slice(eq + 1);
                break;
            }
            case '--lines':
                out.lines = parseNumber(tok, next(), 1);
                break;
            case '--build':
                out.build = true;
                break;
            case '--runtime':
                out.runtime = true;
                break;
            case '--deployment': {
                const uuid = next();
                // `deployment cancel A --deployment B`: which one? Never guess on a mutation.
                if (out.deployment !== undefined && out.deployment !== uuid)
                    throw usage('Two different deployment uuids were given (one after the command, one with --deployment); pass one');
                out.deployment = uuid;
                break;
            }
            case '--wait':
                out.wait = true;
                break;
            case '--take':
                out.take = parseNumber(tok, next(), 1);
                break;
            case '--skip':
                out.skip = parseNumber(tok, next(), 0);
                break;
            case '--instance':
                out.instance = next();
                break;
            case '--server':
                out.server = next();
                break;
            case '--database':
                out.database = next();
                break;
            case '--backup':
                out.backup = next();
                break;
            case '--force':
                out.force = true;
                break;
            case '--latest':
                out.latest = true;
                break;
            case '--timeout':
                out.timeout = parseNumber(tok, next(), 1);
                break;
            case '--key':
                out.keys.push(next());
                break;
            case '--preview':
                out.preview = true;
                break;
            case '--out':
                out.out = next();
                break;
            case '--image':
                out.images.push(next());
                break;
            case '--service':
                out.service = next();
                break;
            case '--timestamps':
                out.timestamps = true;
                break;
            case '--public':
                out.public = parseBool(tok, next());
                break;
            case '--public-port':
                out.publicPort = parseNumber(tok, next(), 1024, 65535);
                break;
            case '--running':
                out.running = true;
                break;
            case '--version':
                out.version = true;
                break;
            case '--dry-run':
                out.dryRun = true;
                break;
            case '--fail-on-changes':
                out.failOnChanges = true;
                break;
            case '--no-logs':
                out.noLogs = true;
                break;
            case '--offline':
                out.offline = true;
                break;
            case '--token-file':
                (out.tokenFiles ??= []).push(next());
                break;
            // Node claims `--env-file` for itself wherever it appears (it even exits 9 when the file is
            // missing, before this program starts), so the harness cannot offer a flag of that name.
            case '--env-file': throw usage('Unknown flag: --env-file (Node reserves that name). Use --token-file <file>.');
            default:
                throw usage(`Unknown flag: ${flagName(tok)}`);
        }
    }
    if (out.apply && out.dryRun)
        throw usage('--apply and --dry-run contradict each other; pass one');
    return out;
}
