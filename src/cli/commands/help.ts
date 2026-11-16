import { COMMAND_NAMES, type ParsedArgs } from '../args.js';
import { EXIT } from '../exit.js';
import { HARNESS_VERSION, TESTED_COOLIFY } from '../../version.js';

export const HELP = `coolify-harness ${HARNESS_VERSION} — agent control plane for Coolify (API tested on ${TESTED_COOLIFY.min}–${TESTED_COOLIFY.max})

Targets come from coolify-harness.config.ts (--app <target>); instance-wide commands take
--instance <name> (or infer it from --app). Commands marked * change Coolify and are a dry-run
unless --apply. \`deploy\` acts immediately (use --dry-run to preview it).
--json on any command prints ONE redacted JSON document on stdout; with --json, a failure is one
JSON document on stderr: { "error": { "code", "message", "exitCode" } }. Secrets are never printed.
Never pass a secret with --set: the command line is visible to script runners and process lists.
Put values in a file and use --from-file.

Start here
  config doctor   [--app T | --instance I] [--offline]   config, tokens, reachability, version check
  status          --app T [--no-logs]                    state + latest deployment

Env (per target; production rows unless --preview, applications only)
  env list        --app T                         keys, scope, flags, value length (never values)
  env diff        --app T [--from-file F] [--set K=V]... [--preview] [--fail-on-changes] [--fail-on-drift]
  env apply *     --app T [--from-file F] [--set K=V]... [--preview] [--fail-on-drift]
  env delete *    --app T --key K [--key K2]... [--preview] [--force]
  flag set *      --app T --set K=V [--redeploy [--wait]]         (env apply; --redeploy deploys, only with --apply)

Deploy / runtime (per target)
  deploy          --app T [--force] [--wait [--timeout SEC] [--no-logs]] [--dry-run]
                                                                 (application build; force = no cache;
                                                                 --wait gives up after 600 s unless
                                                                 --timeout: keep your own shell
                                                                 timeout above it)
  deploy          --app T --restart [--latest]                   (service: --latest pulls images)
  logs            --app T [--lines N] [--service NAME] [--timestamps]
  logs            --app T --build [--deployment UUID]
  deployments     --app T [--take N] [--skip N] [--no-logs]
  deployments     --instance I | --app T --running               (the team's queued + in-progress ones)
  deployment      UUID (--app T | --instance I) [--no-logs]
  deployment cancel * UUID (--app T | --instance I)

Service compose
  compose get     --app T [--out FILE]                           (needs read:sensitive; FILE is unredacted, mode 0600)
  compose set *   --app T (--image SERVICE=REF... | --from-file F) [--restart]

Instance, servers, proxy
  instance info   (--instance I | --app T)           Coolify version + health; alias: version
  servers         --instance I
  server get      --instance I --server UUID
  proxy get       --instance I --server UUID [--out FILE]
  proxy set *     --instance I --server UUID (--image REF | --from-file F) [--restart]
  proxy restart * --instance I --server UUID

Standalone databases (--app <database target> or --instance I --database UUID)
  databases       --instance I
  database get    ...
  database set *  ... [--public true|false] [--public-port N] [--image REF]
  database backups ...
  database backup * ... [--backup UUID]

Not in the Coolify API (exit 2 with where to do it instead)
  server patch, server reboot, instance upgrade

Local (no token, no network)
  catalog gen | catalog check        env catalog from your Zod schemas (zod 3 or 4)
  help | --help | -h     (wins anywhere on the line: nothing else runs)
  --version | -v         (alone on the line; beside a command it is refused)

Global flags: --config FILE (default: ./coolify-harness.config.{ts,mts,mjs,js}) · --json
              --token-file FILE  read the API token(s) from a dotenv file (a variable set in the
                                 environment wins; a missing file is not an error)
              --yes, --runtime   accepted and ignored (kept for 0.x scripts)
Timeouts: a request gets 30 s; a read that times out is tried once more (about a minute at worst).

Exit codes: 0 ok · 1 Coolify/network/internal error · 2 usage, config or unsupported · 3 catalog stale
            4 drift (--fail-on-drift / --fail-on-changes) · 5 auth/scope · 6 locked env var
            7 deploy failed/cancelled (--wait) · 8 wait timeout
            130 --wait interrupted (Ctrl-C or SIGTERM; the deployment keeps running)
Docs: https://github.com/Coriou/coolify-harness-api#readme
`;

/** Meaning of every exit code, for `help --json`. */
export const EXIT_CODES: Record<string, string> = {
  0: 'success, including a clean dry-run',
  1: 'Coolify answered with an error, could not be reached, or sent an unexpected payload',
  2: 'usage or config error, or an operation the Coolify API does not offer',
  3: 'catalog stale',
  4: 'drift: duplicate keys (--fail-on-drift) or pending env changes (--fail-on-changes)',
  5: 'token missing, rejected, or lacking an ability',
  6: 'refused to delete an env var Coolify would re-create',
  7: 'deploy --wait: the deployment failed or was cancelled',
  8: 'deploy --wait: timed out',
  130: 'deploy --wait: interrupted by SIGINT or SIGTERM (the deployment keeps running)',
};

/** `help` / `--help` / `--version`: local, instant, never touches the config or the network. */
export function helpCmd(args?: Pick<ParsedArgs, 'version' | 'json'>): Promise<number> {
  if (args?.json && !args.version) {
    process.stdout.write(`${JSON.stringify({ name: 'coolify-harness', version: HARNESS_VERSION, testedCoolify: TESTED_COOLIFY, commands: COMMAND_NAMES, exitCodes: EXIT_CODES, help: HELP }, null, 2)}\n`);
    return Promise.resolve(EXIT.ok);
  }
  if (args?.version) {
    process.stdout.write(args.json
      ? `${JSON.stringify({ name: 'coolify-harness', version: HARNESS_VERSION, testedCoolify: TESTED_COOLIFY })}\n`
      : `coolify-harness ${HARNESS_VERSION} (Coolify API tested on ${TESTED_COOLIFY.min}–${TESTED_COOLIFY.max})\n`);
    return Promise.resolve(EXIT.ok);
  }
  process.stdout.write(HELP);
  return Promise.resolve(EXIT.ok);
}
