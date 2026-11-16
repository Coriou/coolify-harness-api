import { describe, it, expect } from 'vitest';
import { redactCommandLine, redactDeep, redactDocument, redactDocumentLines, redactUrlCredentials } from '../src/client/redact.js';
import { formatRedactedDiff, isValidImageRef } from '../src/client/compose.js';

const SECRET = 'sup3r-s3cret-value';

describe('URL credentials', () => {
  it('redacts a password after an empty user (redis://:pw@host)', () => {
    expect(redactUrlCredentials(`redis://:${SECRET}@cache:6379/0`)).toBe('redis://:[REDACTED]@cache:6379/0');
  });
  it('redacts a lone token userinfo on http(s) (git remotes), keeps a database username', () => {
    expect(redactUrlCredentials(`https://ghp_${SECRET}@github.com/o/r.git`)).toBe('https://[REDACTED]@github.com/o/r.git');
    expect(redactUrlCredentials('postgres://readonly@db:5432/app')).toBe('postgres://readonly@db:5432/app');
  });
  it('redacts Bearer / Basic tokens in free text', () => {
    expect(redactUrlCredentials(`curl -H "Authorization: Bearer ${SECRET}abcdef" https://x`)).not.toContain(SECRET);
  });
});

describe('document redaction', () => {
  it('redacts every value under an environment: block, whatever the key case', () => {
    const doc = ['services:', '  app:', '    image: nginx:1.27', '    environment:', `      my_setting: ${SECRET}`, `      - lower_list=${SECRET}`, '      PORT: 3000', '    ports:', "      - '80:80'"].join('\n');
    const out = redactDocument(doc);
    expect(out).not.toContain(SECRET);
    expect(out).toContain('image: nginx:1.27');
    expect(out).toContain('PORT: 3000');
    expect(out).toContain("- '80:80'");
  });

  it('redacts the lines of a block scalar under a secret key and resumes after it', () => {
    const doc = ['    environment:', '      PRIVATE_NOTE: |', `        line one ${SECRET}`, `        line two ${SECRET}`, '      OTHER: ${REF}', '    image: nginx:1.27'].join('\n');
    const lines = redactDocumentLines(doc);
    expect(lines).toHaveLength(6);
    expect(lines.join('\n')).not.toContain(SECRET);
    expect(lines[4]).toBe('      OTHER: ${REF}');
    expect(lines[5]).toBe('    image: nginx:1.27');
  });

  it('redacts a PEM block wherever it appears', () => {
    // The body of a PEM block is base64 (RFC 7468): that is what marks its lines.
    const body = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7sup3rs3cretvalue';
    const doc = ['configs:', '  key:', '    content: |', '      -----BEGIN PRIVATE KEY-----', `      ${body}`, '      -----END PRIVATE KEY-----', '  other: 1'].join('\n');
    const out = redactDocument(doc);
    expect(out).not.toContain(body);
    expect(out).not.toContain('BEGIN PRIVATE KEY');
    expect(out).toContain('  other: 1');
  });

  it('redacts sensitive --flag=value command arguments (proxy compose)', () => {
    const out = redactDocument(["    command:", `      - '--pilot.token=${SECRET}'`, "      - '--providers.docker=true'"].join('\n'));
    expect(out).not.toContain(SECRET);
    expect(out).toContain("'--providers.docker=true'");
  });

  it('redacts Dockerfile ENV / ARG values and an inline environment map', () => {
    const out = redactDocument([`ENV API_KEY=${SECRET} mode=prod`, `ARG token=${SECRET}`, `ENV LEGACY ${SECRET}`, `environment: { A: ${SECRET} }`, 'FROM node:24'].join('\n'));
    expect(out).not.toContain(SECRET);
    expect(out).toContain('FROM node:24');
    expect(out).toContain('ENV API_KEY=[REDACTED]');
  });

  it('keeps references, booleans, ports and an empty default readable', () => {
    const doc = ['      - A=${A}', '      - B=${B:-}', '      - C=true', '      - D=8080', `      - E=\${E:-${SECRET}}`].join('\n');
    expect(redactDocument(doc)).toBe(['      - A=${A}', '      - B=${B:-}', '      - C=true', '      - D=8080', '      - E=${E:-[REDACTED]}'].join('\n'));
  });
});

describe('redacted diff keeps context', () => {
  it('does not leak a changed line of a multi-line secret (a line alone looks harmless)', () => {
    const before = ['    environment:', '      CERT: |', `        ${SECRET}-old`, '    image: a:1'].join('\n');
    const after = ['    environment:', '      CERT: |', `        ${SECRET}-new`, '    image: a:2'].join('\n');
    const diff = formatRedactedDiff(before, after).join('\n');
    expect(diff).not.toContain(SECRET);
    expect(diff).toContain('- image: a:1'.replace('- ', '-     '));
    expect(diff).toContain('(redacted value changed)');
  });
});

describe('redactDeep', () => {
  it('redacts commands the way Coolify treats them (sensitive) while keeping them readable', () => {
    const out = redactDeep({
      start_command: `API_KEY=${SECRET} node server.js --port 3000`,
      post_deployment_command: `curl -H "Authorization: Bearer ${SECRET}abcdef" https://hooks.example.com --token ${SECRET}`,
      custom_docker_run_options: `--env X=${SECRET}`,
      init_scripts: `CREATE USER app PASSWORD '${SECRET}'`,
      postgres_conf: `password_encryption = scram\nssl_passphrase_command: ${SECRET}`,
    });
    expect(JSON.stringify(out)).not.toContain(SECRET);
    expect(out.start_command).toBe('API_KEY=[REDACTED] node server.js --port 3000');
    expect(out.custom_docker_run_options).toMatch(/^\[REDACTED\] \(\d+ chars\)$/);
  });

  it('redacts arrays of values (duplicate-key drift) and leaves logs, nulls and booleans alone', () => {
    const out = redactDeep({ duplicateKeyDrift: [{ key: 'A', values: [SECRET, 'other-secret'] }], logs: 'build line', value: null, is_literal: true });
    expect(out.duplicateKeyDrift[0]!.values).toEqual(['[REDACTED] (18 chars)', '[REDACTED] (12 chars)']);
    expect(out).toMatchObject({ logs: 'build line', value: null, is_literal: true });
  });

  it('redactCommandLine leaves plain commands untouched', () => {
    expect(redactCommandLine('pnpm run build && node dist/server.js --port 3000')).toBe('pnpm run build && node dist/server.js --port 3000');
  });
});

describe('image references', () => {
  it('accepts a registry with a port and rejects junk', () => {
    expect(isValidImageRef('registry.example.com:5000/team/app:1.2.3')).toBe(true);
    expect(isValidImageRef('traefik:v3.6.4')).toBe(true);
    expect(isValidImageRef('ghcr.io/o/r@sha256:' + 'a'.repeat(64))).toBe(true);
    expect(isValidImageRef('bad image')).toBe(false);
    expect(isValidImageRef('UPPER/case:1')).toBe(false);
  });
});
