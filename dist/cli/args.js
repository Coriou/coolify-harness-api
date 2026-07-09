import { z } from 'zod';
const COMMANDS = {
    'catalog gen': 'catalog-gen',
    'catalog check': 'catalog-check',
    'env diff': 'env-diff',
    'env apply': 'env-apply',
    'flag set': 'flag-set',
    deploy: 'deploy',
    'config doctor': 'config-doctor',
    status: 'status',
    logs: 'logs',
    deployments: 'deployments',
    deployment: 'deployment',
};
const FlagSchema = z.object({
    command: z.enum([
        'catalog-gen', 'catalog-check', 'env-diff', 'env-apply', 'flag-set', 'deploy', 'config-doctor',
        'status', 'logs', 'deployments', 'deployment',
    ]),
    config: z.string().default('coolify-harness.config.ts'),
});
function resolveCommand(tokens) {
    const two = tokens.slice(0, 2).join(' ');
    const one = tokens[0] ?? '';
    if (two in COMMANDS) {
        return { command: COMMANDS[two], rest: tokens.slice(2) }; // reason: key membership checked by `in COMMANDS` guard above
    }
    if (one in COMMANDS) {
        return { command: COMMANDS[one], rest: tokens.slice(1) }; // reason: key membership checked by `in COMMANDS` guard above
    }
    throw new z.ZodError([{ code: 'custom', path: [], message: `Unknown command: ${tokens.join(' ')}` }]);
}
export function parseArgs(argv) {
    const { command, rest } = resolveCommand(argv);
    const out = {
        command, config: 'coolify-harness.config.ts',
        apply: false, yes: false, redeploy: false, restart: false, json: false, failOnDrift: false, set: {},
        build: false, runtime: false, wait: false,
    };
    for (let i = 0; i < rest.length; i += 1) {
        const tok = rest[i];
        const next = () => {
            const v = rest[i + 1];
            if (v === undefined)
                throw new z.ZodError([{ code: 'custom', path: [], message: `Missing value for ${tok}` }]);
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
                    throw new z.ZodError([{ code: 'custom', path: [], message: `--set expects K=V, got ${pair}` }]);
                out.set[pair.slice(0, eq)] = pair.slice(eq + 1);
                break;
            }
            // New read-only flags
            case '--lines': {
                const v = next();
                const n = Number(v);
                if (!Number.isFinite(n) || n <= 0)
                    throw new z.ZodError([{ code: 'custom', path: [], message: `--lines expects positive integer, got ${v}` }]);
                out.lines = n;
                break;
            }
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
            case '--take': {
                const v = next();
                const n = Number(v);
                if (!Number.isFinite(n) || n < 0)
                    throw new z.ZodError([{ code: 'custom', path: [], message: `--take expects non-negative integer, got ${v}` }]);
                out.take = n;
                break;
            }
            case '--skip': {
                const v = next();
                const n = Number(v);
                if (!Number.isFinite(n) || n < 0)
                    throw new z.ZodError([{ code: 'custom', path: [], message: `--skip expects non-negative integer, got ${v}` }]);
                out.skip = n;
                break;
            }
            default:
                // Positional for "deployment <UUID>"
                if (command === 'deployment' && !out.deployment && !tok.startsWith('--')) {
                    out.deployment = tok;
                }
                else {
                    throw new z.ZodError([{ code: 'custom', path: [], message: `Unknown flag: ${tok}` }]);
                }
        }
    }
    FlagSchema.parse({ command: out.command, config: out.config });
    return out;
}
