import { z } from 'zod';
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
/** Flags that consume the next token as their value (everything else is a boolean switch). */
const VALUE_FLAGS = new Set([
    '--config', '--app', '--from-file', '--set', '--lines', '--deployment', '--take', '--skip',
    '--instance', '--server', '--database', '--backup', '--timeout', '--key', '--out', '--image',
    '--service', '--public', '--public-port',
]);
const usage = (message) => new z.ZodError([{ code: 'custom', path: [], message }]);
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
            tokens.push(t.slice(0, eq), t.slice(eq + 1));
        else
            tokens.push(t);
    }
    const words = [];
    const flags = [];
    for (let i = 0; i < tokens.length; i += 1) {
        const t = tokens[i];
        if (t === '-h' || t === '--help') {
            words.length = 0;
            words.push('help');
            continue;
        }
        if (t.startsWith('--')) {
            flags.push(t);
            if (VALUE_FLAGS.has(t) && i + 1 < tokens.length) {
                flags.push(tokens[i + 1]);
                i += 1;
            }
            continue;
        }
        words.push(t);
    }
    return { words, flags };
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
    throw usage(w.length === 0 ? 'No command given. Run `coolify-harness help`.' : `Unknown command: ${w.join(' ')}. Run \`coolify-harness help\`.`);
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
    const { command, positionals } = resolveCommand(words);
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
            throw usage(`Unexpected argument: ${positionals.join(' ')}`);
        }
    }
    for (let i = 0; i < flags.length; i += 1) {
        const tok = flags[i];
        const next = () => {
            const v = flags[i + 1];
            if (v === undefined || !VALUE_FLAGS.has(tok))
                throw usage(`Missing value for ${tok}`);
            i += 1;
            return v;
        };
        switch (tok) {
            case '--config':
                out.config = next();
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
                if (eq < 0)
                    throw usage(`--set expects K=V, got ${pair}`);
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
                out.take = parseNumber(tok, next(), 0);
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
            default:
                throw usage(`Unknown flag: ${tok}`);
        }
    }
    return out;
}
