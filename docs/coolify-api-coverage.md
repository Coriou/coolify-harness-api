# Coolify API coverage

**Pinned contract: Coolify 4.7.5** — verified 2026-11-16. Tested range: **4.5.0 – 4.7.5**
(`TESTED_COOLIFY` in `src/version.ts`).

How it was verified:

- the OpenAPI spec (`openapi.yaml`), `routes/api.php` (per-route ability middleware) and the API
  controllers of the upstream tags `v4.5.0` and `v4.7.5`, diffed against each other;
- every read endpoint the harness uses, called read-only on two live 4.7.5 instances and parsed
  with the harness's own schemas (the fixtures in `test/fixtures/coolify/v4.7/` are those payloads,
  sanitised);
- mutations were **not** run against live instances: their request and response shapes come from
  the controller source and are exercised against fixtures and mocks.

4.7.5 is also the latest stable Coolify release at the time of writing.

## What changed between 4.5.0 and 4.7.5 (for the endpoints the harness uses)

| Area | Change in Coolify | What the harness does |
|---|---|---|
| Token abilities | **Every `DELETE` route now needs a new `delete` ability** (`write` no longer covers it). | `env delete` asks for `delete`; a 403 prints Coolify's own reason (`Missing required permissions: delete`). Add `delete` to the token. |
| Token scoping | Tokens can be limited to projects / environments / resources. Such a token gets a 403 on team-level routes (everything under `/servers`; applications, services, databases and deployments stay reachable). | The 403 message carries Coolify's sentence, so the cause is visible. |
| Env rows | A compose-declared blank variable (`${VAR:-}`) is stored with `value: null`. | Read as an empty value flagged `value_null` (fixed in 0.4.1). |
| Env rows | A locked variable (`is_shown_once`) is permanent, and its `value` / `real_value` are omitted for every token. | `env list` shows `len=locked`; `env diff` / `apply` rewrite it with a warning instead of failing as "missing read:sensitive". |
| Env bulk write | On update, Coolify 4.7 keeps the flags the request omits. 4.5 reset them (`is_literal`, `is_multiline`, `is_shown_once`). | An update re-sends the flags the row has set, so both versions keep them. |
| Env bulk write | On 4.7 services and databases keep only `key, value, is_literal, is_multiline, is_shown_once, comment` and drop `is_preview` silently (4.5 wrote every fillable field it was given). Either way they have no preview rows. | `--preview` on a service / database is refused (exit 2) before any request. |
| Env bulk write | A duplicate key in the same scope can no longer be created. Existing duplicates remain. | Duplicate detection and repair advice unchanged. |
| Hidden documents | `docker_compose_raw` is omitted (no 403) for a token without `read:sensitive` or a non-admin user — unchanged since 4.5, but the harness treated it as an empty compose. | `compose get` / `compose set` and the `env delete` lock check fail with exit 5. |
| `POST /deploy` | New `cancel_previous=queued|building`. | Not wrapped (see below). |
| Proxy | `proxy_error_page` on `GET` / `PATCH /servers/{uuid}/proxy`. | Accepted by `ServerProxyUpdateSchema` (library). |
| Deployments | `is_mcp`, `scan_gate_*`, `github_deployment_*` columns. | Passed through. |
| New families | DNS records, secret-manager sources, integration tokens, image scanning / vulnerabilities, Gitea apps, host-key reset (29 operations). | Not wrapped. |

Nothing the harness uses was removed. `GET /version` and `GET /health` still answer `text/html`.

Behaviours that are the same on 4.5.0 and 4.7.5 and that the harness now handles:

- `POST /applications/{uuid}/start` (and `/restart`) answers 200 **without** a `deployment_uuid`
  when the same commit is already queued or building (`skipped`); it does not say which
  deployment that is. `deploy --wait` reports on the production deployment of that commit
  (running, or ended moments ago) and fails rather than report an older one.
- The same handlers test only for `skipped`: when the server's deployment queue is full
  (`queue_full`, `deployment_queue_limit`, default 25) they answer "queued" with a uuid that was
  never created. `deploy` reads the deployment back once (`GET /deployments/{uuid}`; under
  `--wait` the first poll is that read) and reports `DEPLOY_NOT_QUEUED` on Coolify's own 404.
  `POST /deploy` handles a full queue (429) but returns a uuid even when it skipped.
- `PATCH /services/{uuid}` saves the compose before it re-parses it, and the proxy configuration
  is recorded before the file is written on the server: a 5xx can leave the new document stored.
  `compose set` / `proxy set` read it back and say which one is there.
- The deployment list mixes production and pull-request preview rows (`pull_request_id`), newest
  first (`created_at desc, id desc`), each with its full build log.
- The bulk env endpoint validates and writes item by item, with no transaction: an invalid key in
  the middle leaves the earlier keys written. Names are validated before sending.
- Creating a key on a service or database answers a row without its flag columns
  (`updateOrCreate` without a refresh). The acknowledgement of an accepted write is not validated
  strictly; the confirmation is the re-read.
- Values are trimmed on save (single-line values on 4.7, every value on 4.5).
- `PATCH /databases/{uuid}` starts the public-port proxy only when the same request carries
  `is_public: true` and `public_port`.
- `PUT /servers/{uuid}/proxy/configuration` records the new configuration before writing the
  file: a replay finds "nothing changed" and skips the backup. It is not retried.

## What the Coolify API does not expose (and the harness therefore does not do)

The Coolify dashboard nags about these, but **4.7.5 still has no API endpoint for any of them**
(checked in `routes/api.php` of `v4.7.5`). They are Livewire (dashboard) actions only. The CLI
commands `server patch`, `server reboot` and `instance upgrade` exist only to say so (exit 2) and
point at the dashboard. The harness will never SSH into a server or write Coolify's database to
emulate them.

| Dashboard nag | API? | Where to do it |
|---|---|---|
| Update Coolify | **No** | Settings → Updates (`/settings/updates`), or the auto-update schedule |
| Server OS package updates ("patches") | **No** | Servers → *server* → Security → Patches (`/server/<uuid>/security/patches`) |
| Reboot server | **No** | Same Patches page (offered after updates) |
| Change proxy (Traefik) version | **Yes**, indirectly | `PUT /servers/{uuid}/proxy/configuration` with the edited compose, then `POST /servers/{uuid}/proxy/restart` → `proxy set --image traefik:vX --apply --restart` |
| Restart proxy | **Yes** | `POST /servers/{uuid}/proxy/restart` → `proxy restart --apply` |
| Wait for a deployment | **No** (no long-poll, no stream) | `deploy --wait` polls `GET /deployments/{uuid}` (2 s growing to 5 s) |
| Read a deployment without its log | **No** (the log is embedded in every row) | `--no-logs` drops it from the output; the download cannot be avoided |

How the proxy version change works:
- `PATCH /servers/{uuid}/proxy` only accepts `redirect_enabled`, `redirect_url`, `proxy_error_page`,
  `generate_exact_labels`, `traefik_certificate_resolver` and `proxy_type`. Anything else is a 422.
- The image lives in the proxy docker-compose. `PUT …/proxy/configuration` (abilities `write` +
  `deploy`; the `deploy` check is inside the controller) stores it in Coolify's DB, writes it to
  the server, and keeps up to 10 timestamped backups of the previous file.
- `RestartProxyJob` restarts from the DB-stored compose and pulls the image first.
- `GET …/proxy` returns `configuration` only to a `read:sensitive` token whose user is a team
  admin/owner and whose token covers the whole team, and only once Coolify has stored it. Coolify
  refuses a compose whose `container_name` is not `coolify-proxy`.

## Abilities (from `routes/api.php` middleware, 4.7.5)

| Ability | Needed for |
|---|---|
| `read` | `version`, list/get applications, services, databases, servers, server resources, proxy settings, deployments, env **rows**, backups |
| `read:sensitive` | env **values**; runtime logs (apps, services, databases); deployment build `logs`; proxy `configuration`; backup execution `message`. The token's user must also be a team admin/owner. |
| `write` | env create/update, `PATCH` service / database / proxy settings, backup config |
| `delete` | every `DELETE` route — for the harness: env delete (new in 4.7; `write` before) |
| `deploy` | `POST …/start`, `…/restart`, `POST /deploy`, `POST /deployments/{uuid}/cancel`, `POST /servers/{uuid}/proxy/restart` |
| `write` **and** `deploy` | `PUT /servers/{uuid}/proxy/configuration`; `PATCH /databases/{uuid}` when it sends `is_public` or `instant_deploy`; backup `backup_now`; changing `proxy_type` |
| `root` | everything |

## Not wrapped yet: worth adding next

- `POST /deploy?cancel_previous=queued|building` (4.7): supersede an older queued / building
  deployment of the same application. Not adopted in 0.5.0 because `/deploy` returns a
  `deployment_uuid` even when Coolify **skipped** the deployment, so `--wait` on it would poll a
  deployment that does not exist; needs a live-verified way to tell the two apart.
- `GET /vulnerabilities`, `GET /{applications,services,databases}/{uuid}/vulnerabilities` (4.7):
  image-scan findings. Image scanning is off on the instances this release was verified on, so the
  payload could not be recorded.
- Env write flags: the bulk endpoint accepts `is_buildtime`, `is_runtime` and `comment` (applications).
  `EnvWriteItemSchema` passes them through for library callers; there is no CLI flag yet.
- Service sub-resources: `GET/PATCH /services/{uuid}/applications/{app_uuid}`,
  `…/databases/{database_uuid}` (incl. a service database's `is_public`), and per-container
  start/stop/restart.
- `POST /applications/{uuid}/stop`, `/services/{uuid}/stop`, `/databases/{uuid}/stop`.
- `GET /applications/{uuid}/rollback-images` + `POST …/rollback`.
- `POST /servers/{uuid}/docker-cleanup/run` and its executions.
- `GET /audit-events`.
- `PATCH /applications/{uuid}` (general app settings), scheduled tasks, storages, tags, projects,
  DNS records, secret-manager sources.

## Endpoint table

<!-- generated from the Coolify 4.7.5 openapi.yaml (coollabsio/coolify tag v4.7.5); 330 operations -->
**330 operations in the 4.7.5 spec (301 in 4.5.0): 38 used by the CLI, 5 library-only, 287 not wrapped.**

### /applications (8/55)

| Method | Path | operationId | Harness | Command / note |
|---|---|---|---|---|
| GET | `/applications/{uuid}/previews` | list-preview-deployments-by-application-uuid | — |  |
| POST | `/applications/{uuid}/previews` | create-preview-deployment-by-application-uuid | — |  |
| GET | `/applications/{uuid}/previews/{pull_request_id}` | get-preview-deployment-by-pull-request-id | — |  |
| DELETE | `/applications/{uuid}/previews/{pull_request_id}` | delete-preview-deployment-by-pull-request-id | — |  |
| PATCH | `/applications/{uuid}/previews/{pull_request_id}` | update-preview-domains-by-pull-request-id | — |  |
| GET | `/applications` | list-applications | library | CoolifyInstanceClient |
| POST | `/applications/public` | create-public-application | — |  |
| POST | `/applications/private-github-app` | create-private-github-app-application | — |  |
| POST | `/applications/private-gitea-app` | create-private-gitea-app-application | — | new in 4.6 / 4.7 |
| POST | `/applications/private-deploy-key` | create-private-deploy-key-application | — |  |
| POST | `/applications/dockerfile` | create-dockerfile-application | — |  |
| POST | `/applications/dockerimage` | create-dockerimage-application | — |  |
| GET | `/applications/{uuid}` | get-application-by-uuid | yes | status, compose get, env delete (compose lock check) |
| DELETE | `/applications/{uuid}` | delete-application-by-uuid | — |  |
| PATCH | `/applications/{uuid}` | update-application-by-uuid | — |  |
| GET | `/applications/{uuid}/logs` | get-application-logs-by-uuid | yes | logs [--service] |
| GET | `/applications/{uuid}/previews/{pull_request_id}/logs` | get-preview-application-logs-by-pull-request-id | — |  |
| GET | `/applications/{uuid}/envs` | list-envs-by-application-uuid | yes | env list/diff/apply/delete |
| POST | `/applications/{uuid}/envs` | create-env-by-application-uuid | — |  |
| PATCH | `/applications/{uuid}/envs` | update-env-by-application-uuid | — |  |
| PATCH | `/applications/{uuid}/envs/bulk` | update-envs-by-application-uuid | yes | env apply (idempotent upsert; preview rows with is_preview) |
| DELETE | `/applications/{uuid}/envs/{env_uuid}` | delete-env-by-application-uuid | yes | env delete — needs the `delete` ability since 4.7 |
| POST | `/applications/{uuid}/start` | start-application-by-uuid | yes | deploy [--force] |
| POST | `/applications/{uuid}/stop` | stop-application-by-uuid | — |  |
| POST | `/applications/{uuid}/restart` | restart-application-by-uuid | yes | deploy --restart |
| POST | `/applications/{uuid}/move` | move-application-by-uuid | — |  |
| POST | `/applications/{uuid}/migrate` | migrate-application-by-uuid | — |  |
| GET | `/applications/{uuid}/storages` | list-storages-by-application-uuid | — |  |
| POST | `/applications/{uuid}/storages` | create-storage-by-application-uuid | — |  |
| PATCH | `/applications/{uuid}/storages` | update-storage-by-application-uuid | — |  |
| DELETE | `/applications/{uuid}/storages/{storage_uuid}` | delete-storage-by-application-uuid | — |  |
| GET | `/applications/{uuid}/tags` | list-tags-by-application-uuid | — |  |
| POST | `/applications/{uuid}/tags` | create-tag-by-application-uuid | — |  |
| DELETE | `/applications/{uuid}/tags/{tag_uuid}` | delete-tag-by-application-uuid | — |  |
| POST | `/applications/{uuid}/clone` | clone-application-by-uuid | — |  |
| GET | `/applications/{uuid}/rollback-images` | list-application-rollback-images | — |  |
| POST | `/applications/{uuid}/rollback` | rollback-application-by-uuid | — |  |
| GET | `/applications/{uuid}/destinations` | list-application-destinations | — |  |
| POST | `/applications/{uuid}/destinations` | add-application-destination | — |  |
| DELETE | `/applications/{uuid}/destinations/{destination_uuid}` | remove-application-destination | — |  |
| GET | `/applications/{uuid}/dns` | get-application-dns | — | new in 4.6 / 4.7 |
| POST | `/applications/{uuid}/dns` | create-application-dns-record | — | new in 4.6 / 4.7 |
| POST | `/applications/{uuid}/dns/replace` | replace-application-dns-record | — | new in 4.6 / 4.7 |
| DELETE | `/applications/{uuid}/dns/{hostname}` | release-application-dns-record | — | new in 4.6 / 4.7 |
| GET | `/applications/{uuid}/scheduled-tasks` | list-scheduled-tasks-by-application-uuid | — |  |
| POST | `/applications/{uuid}/scheduled-tasks` | create-scheduled-task-by-application-uuid | — |  |
| DELETE | `/applications/{uuid}/scheduled-tasks/{task_uuid}` | delete-scheduled-task-by-application-uuid | — |  |
| PATCH | `/applications/{uuid}/scheduled-tasks/{task_uuid}` | update-scheduled-task-by-application-uuid | — |  |
| GET | `/applications/{uuid}/scheduled-tasks/{task_uuid}/executions` | list-scheduled-task-executions-by-application-uuid | — |  |
| POST | `/applications/{uuid}/scheduled-tasks/{task_uuid}/execute` | execute-scheduled-task-by-application-uuid | — |  |
| PATCH | `/applications/{uuid}/secret-manager` | configure-application-secret-manager | — |  |
| PUT | `/applications/{uuid}/storages/{storage_uuid}/backups` | set-application-storage-backup-schedule | — |  |
| DELETE | `/applications/{uuid}/storages/{storage_uuid}/backups` | delete-application-storage-backup-schedule | — |  |
| POST | `/applications/{uuid}/storages/{storage_uuid}/backups/run` | run-application-storage-backup | — |  |
| GET | `/applications/{uuid}/vulnerabilities` | get-application-vulnerabilities | — | new in 4.6 / 4.7 |

### /databases (12/45)

| Method | Path | operationId | Harness | Command / note |
|---|---|---|---|---|
| POST | `/databases/{uuid}/imports/uploads` | upload-database-import | — |  |
| POST | `/databases/{uuid}/imports` | create-database-import | — |  |
| GET | `/databases/{uuid}/imports/{activity_id}` | get-database-import | — |  |
| GET | `/databases` | list-databases | yes | databases |
| GET | `/databases/{uuid}/backups` | get-database-backups-by-uuid | yes | database get/backups/backup |
| POST | `/databases/{uuid}/backups` | create-database-backup | — |  |
| GET | `/databases/{uuid}` | get-database-by-uuid | yes | status, database get |
| DELETE | `/databases/{uuid}` | delete-database-by-uuid | — |  |
| PATCH | `/databases/{uuid}` | update-database-by-uuid | yes | database set (is_public, public_port, image, limits) |
| DELETE | `/databases/{uuid}/backups/{scheduled_backup_uuid}` | delete-backup-configuration-by-uuid | — |  |
| PATCH | `/databases/{uuid}/backups/{scheduled_backup_uuid}` | update-database-backup | yes | database backup (backup_now only) |
| POST | `/databases/postgresql` | create-database-postgresql | — |  |
| POST | `/databases/clickhouse` | create-database-clickhouse | — |  |
| POST | `/databases/dragonfly` | create-database-dragonfly | — |  |
| POST | `/databases/redis` | create-database-redis | — |  |
| POST | `/databases/keydb` | create-database-keydb | — |  |
| POST | `/databases/mariadb` | create-database-mariadb | — |  |
| POST | `/databases/mysql` | create-database-mysql | — |  |
| POST | `/databases/mongodb` | create-database-mongodb | — |  |
| POST | `/databases/sqlite` | create-database-sqlite | — |  |
| GET | `/databases/{uuid}/logs` | get-database-logs-by-uuid | yes | logs |
| DELETE | `/databases/{uuid}/backups/{scheduled_backup_uuid}/executions/{execution_uuid}` | delete-backup-execution-by-uuid | — |  |
| GET | `/databases/{uuid}/backups/{scheduled_backup_uuid}/executions` | list-backup-executions | library | CoolifyInstanceClient |
| POST | `/databases/{uuid}/move` | move-database-by-uuid | — |  |
| POST | `/databases/{uuid}/migrate` | migrate-database-by-uuid | — |  |
| POST | `/databases/{uuid}/start` | start-database-by-uuid | yes | deploy |
| POST | `/databases/{uuid}/stop` | stop-database-by-uuid | — |  |
| POST | `/databases/{uuid}/restart` | restart-database-by-uuid | yes | deploy --restart |
| GET | `/databases/{uuid}/envs` | list-envs-by-database-uuid | yes | env list/diff/apply/delete (no preview rows) |
| POST | `/databases/{uuid}/envs` | create-env-by-database-uuid | — |  |
| PATCH | `/databases/{uuid}/envs` | update-env-by-database-uuid | — |  |
| PATCH | `/databases/{uuid}/envs/bulk` | update-envs-by-database-uuid | yes | env apply |
| DELETE | `/databases/{uuid}/envs/{env_uuid}` | delete-env-by-database-uuid | yes | env delete — needs the `delete` ability since 4.7 |
| GET | `/databases/{uuid}/storages` | list-storages-by-database-uuid | — |  |
| POST | `/databases/{uuid}/storages` | create-storage-by-database-uuid | — |  |
| PATCH | `/databases/{uuid}/storages` | update-storage-by-database-uuid | — |  |
| DELETE | `/databases/{uuid}/storages/{storage_uuid}` | delete-storage-by-database-uuid | — |  |
| GET | `/databases/{uuid}/tags` | list-tags-by-database-uuid | — |  |
| POST | `/databases/{uuid}/tags` | create-tag-by-database-uuid | — |  |
| DELETE | `/databases/{uuid}/tags/{tag_uuid}` | delete-tag-by-database-uuid | — |  |
| POST | `/databases/{uuid}/clone` | clone-database-by-uuid | — |  |
| PUT | `/databases/{uuid}/storages/{storage_uuid}/backups` | set-database-storage-backup-schedule | — |  |
| DELETE | `/databases/{uuid}/storages/{storage_uuid}/backups` | delete-database-storage-backup-schedule | — |  |
| POST | `/databases/{uuid}/storages/{storage_uuid}/backups/run` | run-database-storage-backup | — |  |
| GET | `/databases/{uuid}/vulnerabilities` | get-database-vulnerabilities | — | new in 4.6 / 4.7 |

### /deployments (4/4)

| Method | Path | operationId | Harness | Command / note |
|---|---|---|---|---|
| GET | `/deployments` | list-deployments | yes | deployments --instance |
| GET | `/deployments/{uuid}` | get-deployment-by-uuid | yes | deployment, logs --build --deployment, deploy --wait |
| POST | `/deployments/{uuid}/cancel` | cancel-deployment-by-uuid | yes | deployment cancel |
| GET | `/deployments/applications/{uuid}` | list-deployments-by-app-uuid | yes | deployments --app, status, logs --build (newest first; every row embeds its log) |

### /health (1/1)

| Method | Path | operationId | Harness | Command / note |
|---|---|---|---|---|
| GET | `/health` | healthcheck | yes | instance info |

### /servers (8/46)

| Method | Path | operationId | Harness | Command / note |
|---|---|---|---|---|
| GET | `/servers/{server_uuid}/destinations` | list-server-destinations | — |  |
| POST | `/servers/{server_uuid}/destinations` | create-server-destination | — |  |
| POST | `/servers/digitalocean` | create-digitalocean-server | — |  |
| POST | `/servers/hetzner` | create-hetzner-server | — |  |
| POST | `/servers/hostinger` | create-hostinger-server | — |  |
| GET | `/servers/{uuid}/cloudflare-tunnel` | get-server-cloudflare-tunnel | — |  |
| PATCH | `/servers/{uuid}/cloudflare-tunnel` | update-server-cloudflare-tunnel | — |  |
| POST | `/servers/{uuid}/cloudflare-tunnel/enable` | enable-server-cloudflare-tunnel | — |  |
| POST | `/servers/{uuid}/cloudflare-tunnel/disable` | disable-server-cloudflare-tunnel | — |  |
| GET | `/servers/{uuid}/docker-cleanup` | get-server-docker-cleanup | — |  |
| PATCH | `/servers/{uuid}/docker-cleanup` | update-server-docker-cleanup | — |  |
| POST | `/servers/{uuid}/docker-cleanup/run` | run-server-docker-cleanup | — |  |
| GET | `/servers/{uuid}/docker-cleanup/executions` | list-server-docker-cleanup-executions | — |  |
| GET | `/servers/{uuid}/registries` | list-server-registries | — |  |
| POST | `/servers/{uuid}/registries` | login-server-registry | — |  |
| POST | `/servers/{uuid}/registries/{registry}/check` | check-server-registry-login | — |  |
| DELETE | `/servers/{uuid}/registries/{registry}` | logout-server-registry | — |  |
| GET | `/servers/{uuid}/image-scanning` | get-server-image-scanning | — | new in 4.6 / 4.7 |
| PATCH | `/servers/{uuid}/image-scanning` | update-server-image-scanning | — | new in 4.6 / 4.7 |
| GET | `/servers/{uuid}/log-drains` | get-server-log-drains | — |  |
| PATCH | `/servers/{uuid}/log-drains` | update-server-log-drains | — |  |
| GET | `/servers/{uuid}/proxy` | get-server-proxy | yes | proxy get, server get |
| PATCH | `/servers/{uuid}/proxy` | update-server-proxy | library | CoolifyInstanceClient |
| PUT | `/servers/{uuid}/proxy/configuration` | save-server-proxy-configuration | yes | proxy set |
| POST | `/servers/{uuid}/proxy/restart` | restart-server-proxy | yes | proxy restart, proxy set --restart |
| GET | `/servers/{uuid}/sentinel` | get-server-sentinel | — |  |
| PATCH | `/servers/{uuid}/sentinel` | update-server-sentinel | — |  |
| POST | `/servers/{uuid}/migrate` | migrate-server-between-instances | — |  |
| GET | `/servers/{uuid}/transfer` | get-server-transfer-status | — |  |
| GET | `/servers/import/check` | check-server-import | — |  |
| POST | `/servers/import` | import-server-transfer-bundle | — |  |
| POST | `/servers/{uuid}/transfer/complete` | complete-server-transfer | — |  |
| GET | `/servers` | list-servers | yes | servers |
| POST | `/servers` | create-server | — |  |
| GET | `/servers/{uuid}` | get-server-by-uuid | yes | server get |
| DELETE | `/servers/{uuid}` | delete-server-by-uuid | — |  |
| PATCH | `/servers/{uuid}` | update-server-by-uuid | — |  |
| GET | `/servers/{uuid}/resources` | get-resources-by-server-uuid | yes | server get |
| GET | `/servers/{uuid}/domains` | get-domains-by-server-uuid | library | CoolifyInstanceClient |
| POST | `/servers/{uuid}/validate` | validate-server-by-uuid | — |  |
| POST | `/servers/{uuid}/host-key/reset` | reset-server-host-key-by-uuid | — | new in 4.6 / 4.7 |
| GET | `/servers/{uuid}/envs` | list-server-shared-envs | — |  |
| POST | `/servers/{uuid}/envs` | create-server-shared-env | — |  |
| DELETE | `/servers/{uuid}/envs/{env_id}` | delete-server-shared-env | — |  |
| PATCH | `/servers/{uuid}/envs/{env_id}` | update-server-shared-env | — |  |
| POST | `/servers/vultr` | create-vultr-server | — |  |

### /services (9/56)

| Method | Path | operationId | Harness | Command / note |
|---|---|---|---|---|
| GET | `/services/{uuid}/dns` | get-service-dns | — | new in 4.6 / 4.7 |
| POST | `/services/{uuid}/dns` | create-service-dns-record | — | new in 4.6 / 4.7 |
| POST | `/services/{uuid}/dns/replace` | replace-service-dns-record | — | new in 4.6 / 4.7 |
| DELETE | `/services/{uuid}/dns/{hostname}` | release-service-dns-record | — | new in 4.6 / 4.7 |
| GET | `/services/{uuid}/scheduled-tasks` | list-scheduled-tasks-by-service-uuid | — |  |
| POST | `/services/{uuid}/scheduled-tasks` | create-scheduled-task-by-service-uuid | — |  |
| DELETE | `/services/{uuid}/scheduled-tasks/{task_uuid}` | delete-scheduled-task-by-service-uuid | — |  |
| PATCH | `/services/{uuid}/scheduled-tasks/{task_uuid}` | update-scheduled-task-by-service-uuid | — |  |
| GET | `/services/{uuid}/scheduled-tasks/{task_uuid}/executions` | list-scheduled-task-executions-by-service-uuid | — |  |
| POST | `/services/{uuid}/scheduled-tasks/{task_uuid}/execute` | execute-scheduled-task-by-service-uuid | — |  |
| GET | `/services/{uuid}/applications` | list-service-applications-by-service-uuid | — |  |
| GET | `/services/{uuid}/applications/{app_uuid}` | get-service-application-by-service-and-app-uuid | — |  |
| PATCH | `/services/{uuid}/applications/{app_uuid}` | patch-service-application-by-service-and-app-uuid | — |  |
| GET | `/services/{uuid}/applications/{app_uuid}/logs` | get-service-application-logs-by-service-and-app-uuid | — |  |
| POST | `/services/{uuid}/applications/{app_uuid}/logs` | post-service-application-logs-by-service-and-app-uuid | — |  |
| POST | `/services/{uuid}/applications/{app_uuid}/start` | post-start-service-application-by-service-and-app-uuid | — |  |
| POST | `/services/{uuid}/applications/{app_uuid}/restart` | post-restart-service-application-by-service-and-app-uuid | — |  |
| POST | `/services/{uuid}/applications/{app_uuid}/stop` | post-stop-service-application-by-service-and-app-uuid | — |  |
| POST | `/services/{uuid}/databases/{database_uuid}/imports/uploads` | upload-service-database-import | — |  |
| POST | `/services/{uuid}/databases/{database_uuid}/imports` | create-service-database-import | — |  |
| GET | `/services/{uuid}/databases/{database_uuid}/imports/{activity_id}` | get-service-database-import | — |  |
| GET | `/services/{uuid}/databases` | list-service-databases-by-service-uuid | — |  |
| GET | `/services/{uuid}/databases/{database_uuid}` | get-service-database-by-service-and-database-uuid | — |  |
| PATCH | `/services/{uuid}/databases/{database_uuid}` | patch-service-database-by-service-and-database-uuid | — |  |
| GET | `/services/{uuid}/databases/{database_uuid}/logs` | get-service-database-logs-by-service-and-database-uuid | — |  |
| POST | `/services/{uuid}/databases/{database_uuid}/start` | start-service-database-by-service-and-database-uuid | — |  |
| POST | `/services/{uuid}/databases/{database_uuid}/restart` | restart-service-database-by-service-and-database-uuid | — |  |
| POST | `/services/{uuid}/databases/{database_uuid}/stop` | stop-service-database-by-service-and-database-uuid | — |  |
| GET | `/services` | list-services | library | CoolifyInstanceClient |
| POST | `/services` | create-service | — |  |
| GET | `/services/{uuid}` | get-service-by-uuid | yes | status, compose get |
| DELETE | `/services/{uuid}` | delete-service-by-uuid | — |  |
| PATCH | `/services/{uuid}` | update-service-by-uuid | yes | compose set (docker_compose_raw only) |
| GET | `/services/{uuid}/logs` | get-service-logs-by-uuid | yes | logs --service |
| GET | `/services/{uuid}/envs` | list-envs-by-service-uuid | yes | env list/diff/apply/delete (no preview rows) |
| POST | `/services/{uuid}/envs` | create-env-by-service-uuid | — |  |
| PATCH | `/services/{uuid}/envs` | update-env-by-service-uuid | — |  |
| PATCH | `/services/{uuid}/envs/bulk` | update-envs-by-service-uuid | yes | env apply (is_preview / is_buildtime / is_runtime are dropped server-side) |
| DELETE | `/services/{uuid}/envs/{env_uuid}` | delete-env-by-service-uuid | yes | env delete — needs the `delete` ability since 4.7 |
| POST | `/services/{uuid}/move` | move-service-by-uuid | — |  |
| POST | `/services/{uuid}/migrate` | migrate-service-by-uuid | — |  |
| POST | `/services/{uuid}/start` | start-service-by-uuid | yes | deploy |
| POST | `/services/{uuid}/stop` | stop-service-by-uuid | — |  |
| POST | `/services/{uuid}/restart` | restart-service-by-uuid | yes | deploy --restart [--latest] |
| GET | `/services/{uuid}/storages` | list-storages-by-service-uuid | — |  |
| POST | `/services/{uuid}/storages` | create-storage-by-service-uuid | — |  |
| PATCH | `/services/{uuid}/storages` | update-storage-by-service-uuid | — |  |
| DELETE | `/services/{uuid}/storages/{storage_uuid}` | delete-storage-by-service-uuid | — |  |
| GET | `/services/{uuid}/tags` | list-tags-by-service-uuid | — |  |
| POST | `/services/{uuid}/tags` | create-tag-by-service-uuid | — |  |
| DELETE | `/services/{uuid}/tags/{tag_uuid}` | delete-tag-by-service-uuid | — |  |
| POST | `/services/{uuid}/clone` | clone-service-by-uuid | — |  |
| PUT | `/services/{uuid}/storages/{storage_uuid}/backups` | set-service-storage-backup-schedule | — |  |
| DELETE | `/services/{uuid}/storages/{storage_uuid}/backups` | delete-service-storage-backup-schedule | — |  |
| POST | `/services/{uuid}/storages/{storage_uuid}/backups/run` | run-service-storage-backup | — |  |
| GET | `/services/{uuid}/vulnerabilities` | get-service-vulnerabilities | — | new in 4.6 / 4.7 |

### /version (1/1)

| Method | Path | operationId | Harness | Command / note |
|---|---|---|---|---|
| GET | `/version` | version | yes | instance info, config doctor (version + compatibility check) |

### /audit-events (0/1)

| Method | Path | operationId | Harness | Command / note |
|---|---|---|---|---|
| GET | `/audit-events` | list-audit-events | — |  |

### /cloud-init-scripts (0/5)

| Method | Path | operationId | Harness | Command / note |
|---|---|---|---|---|
| GET | `/cloud-init-scripts` | list-cloud-init-scripts | — |  |
| POST | `/cloud-init-scripts` | create-cloud-init-script | — |  |
| GET | `/cloud-init-scripts/{uuid}` | get-cloud-init-script-by-uuid | — |  |
| DELETE | `/cloud-init-scripts/{uuid}` | delete-cloud-init-script-by-uuid | — |  |
| PATCH | `/cloud-init-scripts/{uuid}` | update-cloud-init-script-by-uuid | — |  |

### /cloud-tokens (0/6)

| Method | Path | operationId | Harness | Command / note |
|---|---|---|---|---|
| GET | `/cloud-tokens` | list-cloud-tokens | — |  |
| POST | `/cloud-tokens` | create-cloud-token | — |  |
| GET | `/cloud-tokens/{uuid}` | get-cloud-token-by-uuid | — |  |
| DELETE | `/cloud-tokens/{uuid}` | delete-cloud-token-by-uuid | — |  |
| PATCH | `/cloud-tokens/{uuid}` | update-cloud-token-by-uuid | — |  |
| POST | `/cloud-tokens/{uuid}/validate` | validate-cloud-token-by-uuid | — |  |

### /deploy (0/1)

| Method | Path | operationId | Harness | Command / note |
|---|---|---|---|---|
| POST | `/deploy` | deploy-by-tag-or-uuid | — | — (has `cancel_previous` since 4.7; see "Not wrapped yet") |

### /destinations (0/4)

| Method | Path | operationId | Harness | Command / note |
|---|---|---|---|---|
| GET | `/destinations` | list-destinations | — |  |
| GET | `/destinations/{uuid}` | get-destination-by-uuid | — |  |
| DELETE | `/destinations/{uuid}` | delete-destination-by-uuid | — |  |
| PATCH | `/destinations/{uuid}` | update-destination-by-uuid | — |  |

### /digitalocean (0/4)

| Method | Path | operationId | Harness | Command / note |
|---|---|---|---|---|
| GET | `/digitalocean/regions` | get-digitalocean-regions | — |  |
| GET | `/digitalocean/sizes` | get-digitalocean-sizes | — |  |
| GET | `/digitalocean/images` | get-digitalocean-images | — |  |
| GET | `/digitalocean/ssh-keys` | get-digitalocean-ssh-keys | — |  |

### /disable (0/1)

| Method | Path | operationId | Harness | Command / note |
|---|---|---|---|---|
| POST | `/disable` | disable-api | — |  |

### /dns (0/1)

| Method | Path | operationId | Harness | Command / note |
|---|---|---|---|---|
| GET | `/dns/zones` | list-dns-zones | — | new in 4.6 / 4.7 |

### /gitea-apps (0/1)

| Method | Path | operationId | Harness | Command / note |
|---|---|---|---|---|
| GET | `/gitea-apps` | list-gitea-apps | — | new in 4.6 / 4.7 |

### /github-apps (0/6)

| Method | Path | operationId | Harness | Command / note |
|---|---|---|---|---|
| GET | `/github-apps` | list-github-apps | — |  |
| POST | `/github-apps` | create-github-app | — |  |
| GET | `/github-apps/{github_app_id}/repositories` | load-repositories | — |  |
| GET | `/github-apps/{github_app_id}/repositories/{owner}/{repo}/branches` | load-branches | — |  |
| DELETE | `/github-apps/{github_app_id}` | deleteGithubApp | — |  |
| PATCH | `/github-apps/{github_app_id}` | updateGithubApp | — |  |

### /gitlab-apps (0/4)

| Method | Path | operationId | Harness | Command / note |
|---|---|---|---|---|
| GET | `/gitlab-apps` | list-gitlab-apps | — |  |
| POST | `/gitlab-apps` | create-gitlab-app | — |  |
| DELETE | `/gitlab-apps/{gitlab_app_id}` | deleteGitlabApp | — |  |
| PATCH | `/gitlab-apps/{gitlab_app_id}` | updateGitlabApp | — |  |

### /hetzner (0/6)

| Method | Path | operationId | Harness | Command / note |
|---|---|---|---|---|
| GET | `/hetzner/locations` | get-hetzner-locations | — |  |
| GET | `/hetzner/server-types` | get-hetzner-server-types | — |  |
| GET | `/hetzner/images` | get-hetzner-images | — |  |
| GET | `/hetzner/ssh-keys` | get-hetzner-ssh-keys | — |  |
| GET | `/hetzner/firewalls` | get-hetzner-firewalls | — |  |
| GET | `/hetzner/networks` | get-hetzner-networks | — |  |

### /hostinger (0/5)

| Method | Path | operationId | Harness | Command / note |
|---|---|---|---|---|
| GET | `/hostinger/data-centers` | get-hostinger-data-centers | — |  |
| GET | `/hostinger/catalog` | get-hostinger-catalog | — |  |
| GET | `/hostinger/templates` | get-hostinger-templates | — |  |
| GET | `/hostinger/ssh-keys` | get-hostinger-ssh-keys | — |  |
| GET | `/hostinger/post-install-scripts` | get-hostinger-post-install-scripts | — |  |

### /mcp (0/2)

| Method | Path | operationId | Harness | Command / note |
|---|---|---|---|---|
| POST | `/mcp/enable` | enable-mcp | — |  |
| POST | `/mcp/disable` | disable-mcp | — |  |

### /notifications (0/12)

| Method | Path | operationId | Harness | Command / note |
|---|---|---|---|---|
| GET | `/notifications/email` | get-current-team-email-notifications | — |  |
| PATCH | `/notifications/email` | update-current-team-email-notifications | — |  |
| GET | `/notifications/discord` | get-current-team-discord-notifications | — |  |
| PATCH | `/notifications/discord` | update-current-team-discord-notifications | — |  |
| GET | `/notifications/slack` | get-current-team-slack-notifications | — |  |
| PATCH | `/notifications/slack` | update-current-team-slack-notifications | — |  |
| GET | `/notifications/telegram` | get-current-team-telegram-notifications | — |  |
| PATCH | `/notifications/telegram` | update-current-team-telegram-notifications | — |  |
| GET | `/notifications/pushover` | get-current-team-pushover-notifications | — |  |
| PATCH | `/notifications/pushover` | update-current-team-pushover-notifications | — |  |
| GET | `/notifications/webhook` | get-current-team-webhook-notifications | — |  |
| PATCH | `/notifications/webhook` | update-current-team-webhook-notifications | — |  |

### /projects (0/18)

| Method | Path | operationId | Harness | Command / note |
|---|---|---|---|---|
| GET | `/projects` | list-projects | — |  |
| POST | `/projects` | create-project | — |  |
| GET | `/projects/{uuid}` | get-project-by-uuid | — |  |
| DELETE | `/projects/{uuid}` | delete-project-by-uuid | — |  |
| PATCH | `/projects/{uuid}` | update-project-by-uuid | — |  |
| GET | `/projects/{uuid}/{environment_name_or_uuid}` | get-environment-by-name-or-uuid | — |  |
| GET | `/projects/{uuid}/environments` | get-environments | — |  |
| POST | `/projects/{uuid}/environments` | create-environment | — |  |
| DELETE | `/projects/{uuid}/environments/{environment_name_or_uuid}` | delete-environment | — |  |
| PATCH | `/projects/{uuid}/environments/{environment_name_or_uuid}` | update-environment | — |  |
| GET | `/projects/{uuid}/envs` | list-project-shared-envs | — |  |
| POST | `/projects/{uuid}/envs` | create-project-shared-env | — |  |
| DELETE | `/projects/{uuid}/envs/{env_id}` | delete-project-shared-env | — |  |
| PATCH | `/projects/{uuid}/envs/{env_id}` | update-project-shared-env | — |  |
| GET | `/projects/{uuid}/environments/{environment_name_or_uuid}/envs` | list-environment-shared-envs | — |  |
| POST | `/projects/{uuid}/environments/{environment_name_or_uuid}/envs` | create-environment-shared-env | — |  |
| DELETE | `/projects/{uuid}/environments/{environment_name_or_uuid}/envs/{env_id}` | delete-environment-shared-env | — |  |
| PATCH | `/projects/{uuid}/environments/{environment_name_or_uuid}/envs/{env_id}` | update-environment-shared-env | — |  |

### /resources (0/1)

| Method | Path | operationId | Harness | Command / note |
|---|---|---|---|---|
| GET | `/resources` | list-resources | — |  |

### /s3-storages (0/6)

| Method | Path | operationId | Harness | Command / note |
|---|---|---|---|---|
| GET | `/s3-storages` | list-s3-storages | — |  |
| POST | `/s3-storages` | create-s3-storage | — |  |
| GET | `/s3-storages/{uuid}` | get-s3-storage-by-uuid | — |  |
| DELETE | `/s3-storages/{uuid}` | delete-s3-storage-by-uuid | — |  |
| PATCH | `/s3-storages/{uuid}` | update-s3-storage-by-uuid | — |  |
| POST | `/s3-storages/{uuid}/validate` | validate-s3-storage-by-uuid | — |  |

### /secret-manager (any resource) (0/6)

| Method | Path | operationId | Harness | Command / note |
|---|---|---|---|---|
| GET | `/{resource_type}/{uuid}/secret-manager` | get-secret-manager-source | — | new in 4.6 / 4.7 |
| DELETE | `/{resource_type}/{uuid}/secret-manager` | remove-secret-manager-source | — | new in 4.6 / 4.7 |
| PATCH | `/{resource_type}/{uuid}/secret-manager` | set-secret-manager-source | — | new in 4.6 / 4.7 |
| GET | `/{resource_type}/{uuid}/secret-manager/keys` | list-secret-manager-keys | — | new in 4.6 / 4.7 |
| POST | `/{resource_type}/{uuid}/secret-manager/references` | add-secret-manager-reference | — | new in 4.6 / 4.7 |
| POST | `/{resource_type}/{uuid}/secret-manager/import` | import-secret-manager-references | — | new in 4.6 / 4.7 |

### /security (0/11)

| Method | Path | operationId | Harness | Command / note |
|---|---|---|---|---|
| GET | `/security/integration-tokens` | list-integration-tokens | — | new in 4.6 / 4.7 |
| POST | `/security/integration-tokens` | create-secret-manager-integration-token | — |  |
| GET | `/security/integration-tokens/{uuid}` | get-integration-token-by-uuid | — | new in 4.6 / 4.7 |
| DELETE | `/security/integration-tokens/{uuid}` | delete-integration-token-by-uuid | — | new in 4.6 / 4.7 |
| PATCH | `/security/integration-tokens/{uuid}` | update-integration-token-by-uuid | — | new in 4.6 / 4.7 |
| POST | `/security/integration-tokens/{uuid}/sync-zones` | sync-integration-token-zones | — | new in 4.6 / 4.7 |
| GET | `/security/keys` | list-private-keys | — |  |
| POST | `/security/keys` | create-private-key | — |  |
| GET | `/security/keys/{uuid}` | get-private-key-by-uuid | — |  |
| DELETE | `/security/keys/{uuid}` | delete-private-key-by-uuid | — |  |
| PATCH | `/security/keys/{uuid}` | update-private-key | — |  |

### /settings (0/2)

| Method | Path | operationId | Harness | Command / note |
|---|---|---|---|---|
| GET | `/settings/email` | get-instance-email-settings | — |  |
| PATCH | `/settings/email` | update-instance-email-settings | — |  |

### /tags (0/4)

| Method | Path | operationId | Harness | Command / note |
|---|---|---|---|---|
| GET | `/tags` | list-tags | — |  |
| POST | `/tags` | create-tag | — |  |
| DELETE | `/tags/{uuid}` | delete-tag-by-uuid | — |  |
| PATCH | `/tags/{uuid}` | update-tag-by-uuid | — |  |

### /team (0/7)

| Method | Path | operationId | Harness | Command / note |
|---|---|---|---|---|
| GET | `/team/envs` | list-team-shared-envs | — |  |
| POST | `/team/envs` | create-team-shared-env | — |  |
| DELETE | `/team/envs/{env_id}` | delete-team-shared-env | — |  |
| PATCH | `/team/envs/{env_id}` | update-team-shared-env | — |  |
| GET | `/team` | get-token-team | — |  |
| PATCH | `/team` | update-token-team | — |  |
| GET | `/team/members` | get-token-team-members | — |  |

### /teams (0/3)

| Method | Path | operationId | Harness | Command / note |
|---|---|---|---|---|
| GET | `/teams` | list-teams | — |  |
| GET | `/teams/{id}` | get-team-by-id | — |  |
| GET | `/teams/{id}/members` | get-members-by-team-id | — |  |

### /vulnerabilities (0/1)

| Method | Path | operationId | Harness | Command / note |
|---|---|---|---|---|
| GET | `/vulnerabilities` | list-vulnerabilities | — | new in 4.6 / 4.7 |

### /vultr (0/4)

| Method | Path | operationId | Harness | Command / note |
|---|---|---|---|---|
| GET | `/vultr/regions` | get-vultr-regions | — |  |
| GET | `/vultr/plans` | get-vultr-plans | — |  |
| GET | `/vultr/os` | get-vultr-operating-systems | — |  |
| GET | `/vultr/ssh-keys` | get-vultr-ssh-keys | — |  |
