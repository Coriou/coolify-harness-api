import { defineConfig } from '../../../src/config/load.js';

export default defineConfig({
  instances: { prod: { url: 'https://coolify.example.com', tokenEnv: 'COOLIFY_PROD_TOKEN' } },
  targets: { 'pfi-api': { instance: 'prod', kind: 'application', uuid: 'abc-uuid' } },
});

export const catalog = {
  schemas: [] as { service: string; schema: unknown }[],
  out: { markdown: 'docs/cat.md' },
};
