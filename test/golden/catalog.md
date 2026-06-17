# Environment Variable Catalog

| Key | Type | Required | Default | Services | Description |
| --- | ---- | -------- | ------- | -------- | ----------- |
| CORS_ORIGINS | string | yes |  | api | Comma-separated allowlist |
| FEATURE_X_ENABLED | boolean | no | false | api | Toggle feature X |
| JWT_PRIVATE_KEY | string | no |  | api | Ed25519 PEM |
| LOG_LEVEL | string | no | info | api, web | Pino log level |
| NEXT_PUBLIC_API_BASE_URL | string | no | http://localhost:3001 | web | API base URL |
| NO_DESCRIPTION_KEY | string | no | x | api |  |
| NODE_ENV | enum(development|production|test) | no | development | api | Runtime mode |
| OPTIONAL_FLAG | string | no |  | api | Set if present |
| PORT | number | no | 3001 | api | HTTP listen port |

## Keys missing a description

- NO_DESCRIPTION_KEY

## Conflicts

- LOG_LEVEL: default differs across services (info vs debug)
