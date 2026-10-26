import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { redactDeep, redactDocument } from '../src/client/redact.js';

const fx = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/coolify/v4.5/${name}`, import.meta.url)), 'utf8'));

// Every literal secret planted in the recorded fixtures. None may survive redaction.
const PLANTED = ['fixture-not-a-real-secret', 'fixture-webhook-secret', 'fixture-sentinel-token', 'fixture-db-password', '$$apr1'];

describe('redactDeep', () => {
  it('removes every planted secret from application, server, database and proxy payloads', () => {
    for (const name of ['application.json', 'server.json', 'servers.json', 'database.json', 'databases.json', 'server-proxy.json', 'service.json']) {
      const out = JSON.stringify(redactDeep(fx(name)));
      for (const secret of PLANTED) expect(out, `${name} leaks ${secret}`).not.toContain(secret);
    }
  });

  it('keeps structure an agent needs: names, status, image lines, ${VAR} references', () => {
    const app = redactDeep(fx('application.json')) as Record<string, string>;
    expect(app['name']).toBe('my-api');
    expect(app['git_branch']).toBe('main');
    expect(app['manual_webhook_secret_github']).toMatch(/^\[REDACTED\] \(\d+ chars\)$/);
    expect(app['docker_compose_raw']).toContain('image: ghcr.io/umami-software/umami:3.0.3');
    expect(app['docker_compose_raw']).toContain('APP_SECRET=${SERVICE_PASSWORD_64_UMAMI}');
    expect(app['docker_compose_raw']).toContain('HARDCODED_TOKEN=[REDACTED]');
  });

  it('strips the password from connection URLs but keeps scheme, user and host', () => {
    const db = redactDeep(fx('database.json')) as Record<string, string>;
    expect(db['internal_db_url']).toBe('redis://default:[REDACTED]@db-1:6379/0');
  });

  it('never touches logs (explicit read:sensitive request; Coolify masks env values in them)', () => {
    expect(redactDeep({ logs: 'PASSWORD=x' })).toEqual({ logs: 'PASSWORD=x' });
  });
});

describe('redactDocument', () => {
  it('redacts env assignments in list, map and quoted forms but keeps refs, numbers and booleans', () => {
    const doc = [
      '    environment:',
      '      - SECRET_A=plain',
      "      - 'SECRET_B=quoted'",
      '      SECRET_C: "mapped"',
      '      PORT: 3000',
      '      DEBUG: "false"',
      '      REF: ${OTHER}',
      '      DEFAULTED: ${OTHER:-literal-default}',
      '    image: postgres:16',
    ].join('\n');
    const out = redactDocument(doc);
    expect(out).toContain('- SECRET_A=[REDACTED]');
    expect(out).toContain("- 'SECRET_B=[REDACTED]'");
    expect(out).toContain('SECRET_C: "[REDACTED]"');
    expect(out).toContain('PORT: 3000');
    expect(out).toContain('DEBUG: "false"');
    expect(out).toContain('REF: ${OTHER}');
    expect(out).toContain('DEFAULTED: ${OTHER:-[REDACTED]}');
    expect(out).toContain('image: postgres:16');
    expect(out).not.toMatch(/plain|quoted|mapped|literal-default/);
  });

  it('redacts basic-auth label values in the proxy compose', () => {
    const proxy = (fx('server-proxy.json') as { configuration: string }).configuration;
    const out = redactDocument(proxy);
    expect(out).toContain("traefik.http.middlewares.dash-auth.basicauth.users=[REDACTED]'");
    expect(out).toContain("image: 'traefik:v3.6'");
  });
});
