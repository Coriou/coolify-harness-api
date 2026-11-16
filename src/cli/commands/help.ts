import type { ParsedArgs } from '../args.js';
import { EXIT } from '../exit.js';
import { HARNESS_VERSION, TESTED_COOLIFY } from '../../version.js';

export const HELP = `coolify-harness ${HARNESS_VERSION} — agent control plane for Coolify (API tested on ${TESTED_COOLIFY.min}–${TESTED_COOLIFY.max})

Targets come from coolify-harness.config.ts (--app <target>); instance-wide commands take
--instance <name> (or infer it from --app). Commands marked * change Coolify and are a dry-run
unless --apply. \`deploy\` acts immediately (use --dry-run to preview it).
--json on any command prints ONE redacted JSON document on stdout; with --json, an error is one
JSON document on stderr: { "error": { "code", "message", "exitCode" } }. Secrets are never printed.

Start here
  config doctor   [--app T | --instance I] [--offline]   config, tokens, reachability, version check
  status          --app T                                state + latest deployment

Env (per target; production rows unless --preview, applications only)
  env list        --app T                         keys, scope, flags, value length (never values)
  env diff        --app T [--from-file F] [--set K=V]... [--preview] [--fail-on-changes] [--fail-on-drift]
  env apply *     --app T [--from-file F] [--set K=V]... [--preview]
  env delete *    --app T --key K [--key K2]... [--preview] [--force]
  flag set *      --app T --set K=V [--redeploy [--wait]]         (env apply, then deploy if applied)

Deploy / runtime (per target)
  deploy          --app T [--force] [--wait [--timeout SEC]] [--dry-run]   (application build; force = no cache)
  deploy          --app T --restart [--latest]                   (service: --latest pulls images)
  logs            --app T [--lines N] [--service NAME] [--timestamps]
  logs            --app T --build [--deployment UUID]
  deployments     --app T [--take N] [--skip N] [--no-logs]  |  --instance I   (queued + in progress)
  deployment      UUID (--app T | --instance I) [--no-logs]
  deployment cancel * UUID (--app T | --instance I)

Service compose
  compose get     --app T [--out FILE]                           (FILE is unredacted, mode 0600)
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
  help | --help | --version

Global flags: --config FILE (default: ./coolify-harness.config.{ts,mts,mjs,js}) · --json

Exit codes: 0 ok · 1 Coolify/network/internal error · 2 usage, config or unsupported · 3 catalog stale
            4 drift (--fail-on-drift / --fail-on-changes) · 5 auth/scope · 6 locked env var
            7 deploy failed/cancelled (--wait) · 8 wait timeout
Docs: https://github.com/Coriou/coolify-harness-api#readme
`;

/** `help` / `--help` / `--version`: local, instant, never touches the config or the network. */
export function helpCmd(args?: Pick<ParsedArgs, 'version' | 'json'>): Promise<number> {
  if (args?.version) {
    process.stdout.write(args.json
      ? `${JSON.stringify({ name: 'coolify-harness', version: HARNESS_VERSION, testedCoolify: TESTED_COOLIFY })}\n`
      : `coolify-harness ${HARNESS_VERSION} (Coolify API tested on ${TESTED_COOLIFY.min}–${TESTED_COOLIFY.max})\n`);
    return Promise.resolve(EXIT.ok);
  }
  process.stdout.write(HELP);
  return Promise.resolve(EXIT.ok);
}
