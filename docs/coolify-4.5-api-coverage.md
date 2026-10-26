# Coolify 4.5 API coverage

**Verified:** 2026-10-26 against Coolify **4.5.0**. The spec was `openapi.yaml` as served by the
instance (`/var/www/html/openapi.yaml`, identical on two instances), cross-checked with
`routes/api.php` (per-route ability middleware) and the API controllers. Live checks used
read-only GETs only.

## What the Coolify API does not expose (and the harness therefore does not do)

The Coolify dashboard nags about these, but **4.5.0 has no API endpoint for any of them**. They
are Livewire (dashboard) actions only: `App\Actions\Server\{CheckUpdates,UpdatePackage,RebootServer,UpdateCoolify}`
are referenced by `app/Livewire/...` and by none of the `app/Http/Controllers/Api/*` controllers.
The CLI commands `server patch`, `server reboot` and `instance upgrade` exist only to say so
(exit 2) and point at the dashboard. The harness will never SSH into a server or write Coolify's
database to emulate them.

| Dashboard nag | API? | Where to do it |
|---|---|---|
| Update Coolify | **No** | Settings → Updates (`/settings/updates`), or the auto-update schedule |
| Server OS package updates ("patches") | **No** | Servers → *server* → Security → Patches (`/server/<uuid>/security/patches`) |
| Reboot server | **No** | Same Patches page (offered after updates) |
| Change proxy (Traefik) version | **Yes**, indirectly | `PUT /servers/{uuid}/proxy/configuration` with the edited compose, then `POST /servers/{uuid}/proxy/restart` → `proxy set --image traefik:vX --apply --restart` |
| Restart proxy | **Yes** | `POST /servers/{uuid}/proxy/restart` → `proxy restart --apply` |

How the proxy version change works:
- `PATCH /servers/{uuid}/proxy` only accepts `redirect_enabled`, `redirect_url`,
  `generate_exact_labels`, `traefik_certificate_resolver` and `proxy_type`. Anything else is a 422.
- The image lives in the proxy docker-compose. `PUT …/proxy/configuration` (scopes `write` + `deploy`)
  stores it in Coolify's DB, writes it to the server, and keeps up to 10 timestamped backups of
  the previous file.
- `RestartProxyJob` restarts from the DB-stored compose and pulls the image first.
- `GET …/proxy` returns `configuration` only to a `read:sensitive` token whose user is a team
  admin/owner, and only once Coolify has stored it. Coolify refuses a compose whose
  `container_name` is not `coolify-proxy`.

## Contract fixes in 0.4.0

| Endpoint | Symptom | Cause | Fix |
|---|---|---|---|
| `GET /applications/{uuid}` | `status` failed contract validation (since 4.3.16) | `git_full_url`, `health_check_port` are JSON `null`; schema had `.optional()` | every optional field `.nullish()` |
| `GET /deployments/{uuid}` | `deploy --wait` failed on its first poll; `deployment <uuid>` failed for in-flight deploys | a queued row has `commit_message`, `finished_at`, `server_name`, … = `null` (nullable columns) | `.nullish()`; `status` is a plain string |
| `GET /version`, `GET /health` | (unused before) | `text/html` body (`4.5.0`, `OK`), not JSON | transport falls back to raw text |
| `POST /deploy`, `POST …/start` | agents curl'd `?force=true` | — | `deploy --force` → `POST /applications/{uuid}/start?force=true` |

## Scopes (from `routes/api.php` middleware)

| Ability | Needed for |
|---|---|
| `read` | `version`, list/get applications, services, databases, servers, server resources, proxy settings, deployments, env **rows**, backups |
| `read:sensitive` | env **values**; runtime logs (apps, services, databases); deployment build `logs`; proxy `configuration`; backup execution `message` |
| `write` | env create/update/delete, `PATCH` service / database / proxy settings, backup config |
| `deploy` | `POST …/start`, `…/restart`, `POST /deploy`, `POST /deployments/{uuid}/cancel`, `POST /servers/{uuid}/proxy/restart` |
| `write` **and** `deploy` | `PUT /servers/{uuid}/proxy/configuration`; `PATCH /databases/{uuid}` when it sends `is_public` or `instant_deploy`; backup `backup_now`; changing `proxy_type` |

## Not wrapped yet: worth adding next

- Service sub-resources: `GET/PATCH /services/{uuid}/applications/{app_uuid}`,
  `…/databases/{database_uuid}` (incl. a service database's `is_public`), and per-container
  start/stop/restart.
- `POST /applications/{uuid}/stop`, `/services/{uuid}/stop`, `/databases/{uuid}/stop`.
- `GET /applications/{uuid}/rollback-images` + `POST …/rollback`.
- `POST /servers/{uuid}/docker-cleanup/run` and its executions.
- `GET /audit-events`.
- `PATCH /applications/{uuid}` (general app settings), scheduled tasks, storages, tags, projects.

## Endpoint table

<!-- generated from the Coolify 4.5.0 openapi.yaml served by the instance; 301 operations -->
**301 operations in the 4.5.0 spec: 38 used by the CLI, 5 library-only, 258 not wrapped.**

### /applications (8/49)

| Method | Path | operationId | Harness | Command / note |
|---|---|---|---|---|
| GET | `/applications/{uuid}/previews` | list-preview-deployments-by-application-uuid | — |  |
| POST | `/applications/{uuid}/previews` | create-preview-deployment-by-application-uuid | — |  |
| GET | `/applications/{uuid}/previews/{pull_request_id}` | get-preview-deployment-by-pull-request-id | — |  |
| DELETE | `/applications/{uuid}/previews/{pull_request_id}` | delete-preview-deployment-by-pull-request-id | — |  |
| PATCH | `/applications/{uuid}/previews/{pull_request_id}` | update-preview-domains-by-pull-request-id | — |  |
| PATCH | `/applications/{uuid}/secret-manager` | configure-application-secret-manager | — |  |
| GET | `/applications` | list-applications | library | CoolifyInstanceClient |
| POST | `/applications/public` | create-public-application | — |  |
| POST | `/applications/private-github-app` | create-private-github-app-application | — |  |
| POST | `/applications/private-deploy-key` | create-private-deploy-key-application | — |  |
| POST | `/applications/dockerfile` | create-dockerfile-application | — |  |
| POST | `/applications/dockerimage` | create-dockerimage-application | — |  |
| GET | `/applications/{uuid}` | get-application-by-uuid | yes | status, compose get — was BROKEN (null git_full_url / health_check_port) — fixed |
| DELETE | `/applications/{uuid}` | delete-application-by-uuid | — |  |
| PATCH | `/applications/{uuid}` | update-application-by-uuid | — |  |
| GET | `/applications/{uuid}/logs` | get-application-logs-by-uuid | yes | logs [--service] |
| GET | `/applications/{uuid}/previews/{pull_request_id}/logs` | get-preview-application-logs-by-pull-request-id | — |  |
| GET | `/applications/{uuid}/envs` | list-envs-by-application-uuid | yes | env list/diff/apply |
| POST | `/applications/{uuid}/envs` | create-env-by-application-uuid | — |  |
| PATCH | `/applications/{uuid}/envs` | update-env-by-application-uuid | — |  |
| PATCH | `/applications/{uuid}/envs/bulk` | update-envs-by-application-uuid | yes | env apply |
| DELETE | `/applications/{uuid}/envs/{env_uuid}` | delete-env-by-application-uuid | yes | env delete |
| POST | `/applications/{uuid}/start` | start-application-by-uuid | yes | deploy [--force] — force=true now supported |
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
| GET | `/applications/{uuid}/scheduled-tasks` | list-scheduled-tasks-by-application-uuid | — |  |
| POST | `/applications/{uuid}/scheduled-tasks` | create-scheduled-task-by-application-uuid | — |  |
| DELETE | `/applications/{uuid}/scheduled-tasks/{task_uuid}` | delete-scheduled-task-by-application-uuid | — |  |
| PATCH | `/applications/{uuid}/scheduled-tasks/{task_uuid}` | update-scheduled-task-by-application-uuid | — |  |
| GET | `/applications/{uuid}/scheduled-tasks/{task_uuid}/executions` | list-scheduled-task-executions-by-application-uuid | — |  |
| POST | `/applications/{uuid}/scheduled-tasks/{task_uuid}/execute` | execute-scheduled-task-by-application-uuid | — |  |
| PUT | `/applications/{uuid}/storages/{storage_uuid}/backups` | set-application-storage-backup-schedule | — |  |
| DELETE | `/applications/{uuid}/storages/{storage_uuid}/backups` | delete-application-storage-backup-schedule | — |  |
| POST | `/applications/{uuid}/storages/{storage_uuid}/backups/run` | run-application-storage-backup | — |  |

### /databases (12/44)

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
| GET | `/databases/{uuid}/envs` | list-envs-by-database-uuid | yes | env list/diff/apply |
| POST | `/databases/{uuid}/envs` | create-env-by-database-uuid | — |  |
| PATCH | `/databases/{uuid}/envs` | update-env-by-database-uuid | — |  |
| PATCH | `/databases/{uuid}/envs/bulk` | update-envs-by-database-uuid | yes | env apply |
| DELETE | `/databases/{uuid}/envs/{env_uuid}` | delete-env-by-database-uuid | yes | env delete |
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

### /deployments (4/4)

| Method | Path | operationId | Harness | Command / note |
|---|---|---|---|---|
| GET | `/deployments` | list-deployments | yes | deployments --instance |
| GET | `/deployments/{uuid}` | get-deployment-by-uuid | yes | deployment, logs --build, deploy --wait — was BROKEN for queued / in-progress rows (null commit_message, ...) — fixed |
| POST | `/deployments/{uuid}/cancel` | cancel-deployment-by-uuid | yes | deployment cancel |
| GET | `/deployments/applications/{uuid}` | list-deployments-by-app-uuid | yes | deployments --app, status — tolerant of in-flight rows since the fix |

### /health (1/1)

| Method | Path | operationId | Harness | Command / note |
|---|---|---|---|---|
| GET | `/health` | healthcheck | yes | instance info |

### /servers (8/43)

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
| GET | `/servers/{uuid}/envs` | list-server-shared-envs | — |  |
| POST | `/servers/{uuid}/envs` | create-server-shared-env | — |  |
| DELETE | `/servers/{uuid}/envs/{env_id}` | delete-server-shared-env | — |  |
| PATCH | `/servers/{uuid}/envs/{env_id}` | update-server-shared-env | — |  |
| POST | `/servers/vultr` | create-vultr-server | — |  |

### /services (9/51)

| Method | Path | operationId | Harness | Command / note |
|---|---|---|---|---|
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
| GET | `/services/{uuid}/envs` | list-envs-by-service-uuid | yes | env list/diff/apply |
| POST | `/services/{uuid}/envs` | create-env-by-service-uuid | — |  |
| PATCH | `/services/{uuid}/envs` | update-env-by-service-uuid | — |  |
| PATCH | `/services/{uuid}/envs/bulk` | update-envs-by-service-uuid | yes | env apply |
| DELETE | `/services/{uuid}/envs/{env_uuid}` | delete-env-by-service-uuid | yes | env delete |
| POST | `/services/{uuid}/move` | move-service-by-uuid | — |  |
| POST | `/services/{uuid}/migrate` | migrate-service-by-uuid | — |  |
| POST | `/services/{uuid}/start` | start-service-by-uuid | yes | deploy |
| POST | `/services/{uuid}/stop` | stop-service-by-uuid | — |  |
| POST | `/services/{uuid}/restart` | restart-service-by-uuid | yes | deploy --restart [--latest] — latest=true now supported |
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

### /version (1/1)

| Method | Path | operationId | Harness | Command / note |
|---|---|---|---|---|
| GET | `/version` | version | yes | instance info |

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
| POST | `/deploy` | deploy-by-tag-or-uuid | — |  |

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

### /security (0/6)

| Method | Path | operationId | Harness | Command / note |
|---|---|---|---|---|
| POST | `/security/integration-tokens` | create-secret-manager-integration-token | — |  |
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

### /vultr (0/4)

| Method | Path | operationId | Harness | Command / note |
|---|---|---|---|---|
| GET | `/vultr/regions` | get-vultr-regions | — |  |
| GET | `/vultr/plans` | get-vultr-plans | — |  |
| GET | `/vultr/os` | get-vultr-operating-systems | — |  |
| GET | `/vultr/ssh-keys` | get-vultr-ssh-keys | — |  |

