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
    '--service', '--public', '--public-port', '--env-file',
]);
const usage = (message) => new UsageError(message);
/**
 * A word the user typed is echoed back only when it is part of the command vocabulary. Anything
 * else may be a secret that slipped out of its flag (`--set KEY= value`): error text ends up in
 * logs and transcripts, so it is described, never quoted.
 */
const VOCABULARY = new Set(Object.keys(COMMANDS).flatMap((c) => c.split(' ')));
const show = (words) => words.map((w) => (VOCABULARY.has(w.toLowerCase().replace(/[-:].*$/, '')) || VOCABULARY.has(w.toLowerCase()) ? w : `<${w.length}-character word>`)).join(' ');
/** Marks a value that came from `--flag=value`, so `--set K=--x` is not mistaken for a missing value. */
const EQ = '\u0000=';
/**
 * Split the argv into the command words and the flags, tolerating the forms agents actually type:
 * `--flag=value`, hyphen/colon command spellings (`env-diff`, `env:diff`), and flags placed before
 * the command (`--app x status`). `-h` / `--help` anywhere selects `help`.
 */
function normalize(argv) {
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
    let help = false;
    for (let i = 0; i < tokens.length; i += 1) {
        const t = tokens[i];
        if (t === '-h' || t === '--help') {
            help = true;
            continue;
        }
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
                throw usage(`${t} does not take a value`);
            }
            continue;
        }
        words.push(t.startsWith(EQ) ? t.slice(EQ.length) : t);
    }
    // `--help` wins over everything else on the line, but `--json` still decides its format.
    return help ? { words: ['help'], flags: flags.filter((f) => f === '--json') } : { words, flags };
}
function resolveCommand(words) {
    if (words[0] === 'help')
        return { command: 'help', positionals: [] };
    let w = words;
    const first = w[0] ?? '';
    const split = first.replace(/[-:]/, ' ');
    if (split !== first && split in COMMANDS)
        w = [...split.split(' '), ...w.slice(1)];
    const two = w.slice(0, 2).join(' ');
    if (two in COMMANDS) {
        return { command: COMMANDS[two], positionals: w.slice(2) }; // reason: key membership checked by `in COMMANDS` guard above
    }
    const one = w[0] ?? '';
    if (one in COMMANDS) {
        return { command: COMMANDS[one], positionals: w.slice(1) }; // reason: key membership checked by `in COMMANDS` guard above
    }
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
function parseNumber(flag, v, min) {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min)
        throw usage(`${flag} expects an integer >= ${min}, got ${v}`);
    return n;
}
function parseBool(flag, v) {
    if (/^(true|yes|on|1)$/i.test(v))
        return true;
    if (/^(false|no|off|0)$/i.test(v))
        return false;
    throw usage(`${flag} expects true or false, got ${v}`);
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
            if (v === undefined)
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
            case '--deployment':
                out.deployment = next();
                break;
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
                out.publicPort = parseNumber(tok, next(), 1024);
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
            case '--env-file':
                (out.envFiles ??= []).push(next());
                break;
            default:
                throw usage(`Unknown flag: ${tok}`);
        }
    }
    if (out.apply && out.dryRun)
        throw usage('--apply and --dry-run contradict each other; pass one');
    return out;
}
