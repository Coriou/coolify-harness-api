import { EXIT } from '../main.js';
export const HELP = `coolify-harness — safe Coolify control plane for agents (Coolify 4.5.x API)

Targets come from coolify-harness.config.ts (--app <target>); instance-wide commands take
--instance <name> (or infer it from --app). Mutations marked * are dry-run unless --apply.
--json on any command prints one redacted JSON document. Secrets are never printed.

Env (per target)
  env list        --app T                         keys, scope, flags, value length
  env diff        --app T [--from-file F] [--set K=V]... [--preview] [--fail-on-drift]
  env apply *     --app T [--from-file F] [--set K=V]... [--preview]   (production rows unless --preview)
  env delete *    --app T --key K [--key K2]... [--preview] [--force]
  flag set *      --app T --set K=V [--redeploy]

Deploy / runtime (per target)
  deploy          --app T [--force] [--wait [--timeout SEC]]     (application build; force = no cache)
  deploy          --app T --restart [--latest]                   (service: --latest pulls images)
  status          --app T
  logs            --app T [--lines N] [--service NAME] [--timestamps]
  logs            --app T --build [--deployment UUID]
  deployments     --app T [--take N] [--skip N]     |  --instance I   (queued + in progress)
  deployment      UUID (--app T | --instance I)
  deployment cancel * UUID (--app T | --instance I)

Service compose
  compose get     --app T [--out FILE]                           (FILE is unredacted, mode 0600)
  compose set *   --app T (--image SERVICE=REF... | --from-file F) [--restart]

Instance, servers, proxy
  instance info   (--instance I | --app T)           alias: version
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

Local
  catalog gen | catalog check | config doctor [--app T]

Exit codes: 0 ok · 1 error · 2 usage/unsupported · 3 catalog stale · 4 drift · 5 auth/scope
            6 locked var · 7 deploy failed/cancelled (--wait) · 8 wait timeout
`;
export function helpCmd() {
    process.stdout.write(HELP);
    return Promise.resolve(EXIT.ok);
}
