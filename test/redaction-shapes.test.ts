import { describe, it, expect } from 'vitest';
import { redactCommandLine, redactDeep, redactDocument, redactDocumentLines, redactUrlCredentials } from '../src/client/redact.js';
import { formatRedactedDiff } from '../src/client/compose.js';

// Every input below leaked `hunter2…` through an earlier version of the redactor. They are the
// shapes real documents come in: Windows line endings, YAML a dumper emits, JSON-style compose,
// command lists, config files that are not YAML.
const leaks = (text: string): boolean => /hunter2/.test(text);
const doc = (...lines: string[]): string => lines.join('\n');

describe('line endings', () => {
  it('redacts a CRLF document exactly like an LF one, and keeps the CRLF', () => {
    const lf = doc('services:', '  app:', '    image: nginx:1.27', '    environment:', '      DB_PASSWORD: hunter2_crlf', '      - STRIPE_SECRET_KEY=sk_live_hunter2', '      my_setting: hunter2_lower', '');
    const crlf = lf.replace(/\n/g, '\r\n');
    expect(leaks(redactDocument(crlf))).toBe(false);
    expect(redactDocument(crlf)).toBe(redactDocument(lf).replace(/\n/g, '\r\n'));
    expect(redactDocument(crlf)).toContain('    image: nginx:1.27\r\n');
    expect(leaks(redactDocument('ENV NPM_TOKEN=hunter2_df\r\nRUN echo ok\r\n'))).toBe(false);
  });

  it('a redacted diff of a CRLF file shows no value', () => {
    const before = 'services:\r\n  a:\r\n    environment:\r\n      - DB_PASSWORD=old\r\n';
    const after = 'services:\r\n  a:\r\n    environment:\r\n      - DB_PASSWORD=hunter2_local_file\r\n';
    expect(leaks(formatRedactedDiff(before, after).join('\n'))).toBe(false);
  });
});

describe('auth tokens', () => {
  it('redacts a Coolify-style token (it contains "|"), whatever the case of the scheme', () => {
    for (const text of [
      'Authorization: Bearer 12|hunter2AbCdEfGhIjKlMnOp',
      'authorization: bearer 12|hunter2AbCdEfGhIjKlMnOp',
      'Authorization: token ghp_hunter2AbCdEfGhIjKl',
      'curl -H "Authorization: Basic aHVudGVyMjpodW50ZXIy" https://x',
    ]) {
      expect(redactUrlCredentials(text), text).not.toMatch(/hunter2|aHVudGVyMjpodW50ZXIy/);
    }
  });
});

describe('URLs', () => {
  it('redacts passwords containing @ or /, and secret query parameters', () => {
    expect(redactUrlCredentials('postgres://postgres:hunter2/with@slash@host:5432/db')).toBe('postgres://postgres:[REDACTED]@host:5432/db');
    expect(redactUrlCredentials('postgres://user:hunter2_p@ss@host/db')).toBe('postgres://user:[REDACTED]@host/db');
    expect(redactUrlCredentials('jdbc:postgresql://h/db?user=x&password=hunter2_jdbc&ssl=true')).toBe('jdbc:postgresql://h/db?user=x&password=[REDACTED]&ssl=true');
    expect(redactUrlCredentials('https://api.example.com/hook?token=hunter2_q')).toBe('https://api.example.com/hook?token=[REDACTED]');
    expect(redactUrlCredentials('https://example.com/a/b?page=2')).toBe('https://example.com/a/b?page=2');
  });
});

describe('command lines', () => {
  it('redacts the forms real commands use', () => {
    for (const cmd of [
      'mysql -uroot -phunter2_start && redis-cli -a hunter2_a ping',
      'curl -u admin:hunter2_curl https://x/y',
      'export token=hunter2_lc; ./run',
      'redis-server --requirepass hunter2_cmd',
      'sh -c "export PGPASSWORD=hunter2_ep && psql"',
      'sshpass -p hunter2_ssh ssh host',
      'curl -H "X-Api-Key: hunter2_hdr" https://x',
      'npm config set //registry.npmjs.org/:_authToken=hunter2_run',
      'tool --key hunter2_key --pwd hunter2_pwd',
      'SECRET="a \\" hunter2_esc" run',
    ]) {
      expect(redactCommandLine(cmd), cmd).not.toMatch(/hunter2/);
    }
  });

  it('keeps ordinary commands readable', () => {
    expect(redactCommandLine('docker run -p 8080:80 -e NODE_ENV=production nginx')).toBe('docker run -p 8080:80 -e NODE_ENV=[REDACTED] nginx');
    expect(redactCommandLine('mysql -uroot -h db -P 3306')).toBe('mysql -uroot -h db -P 3306');
    expect(redactCommandLine('curl -u admin:pw https://x')).toBe('curl -u admin:[REDACTED] https://x');
    expect(redactCommandLine('node server.js --port 3000 --verbose')).toBe('node server.js --port 3000 --verbose');
  });

  it('treats command / entrypoint / test / RUN inside a document as command lines', () => {
    const out = redactDocument(doc(
      'services:',
      '  cache:',
      '    command: redis-server --requirepass hunter2_cmd',
      '    entrypoint: sh -c "export PGPASSWORD=hunter2_ep && psql"',
      '    healthcheck:',
      "      test: 'mysqladmin ping -uroot -phunter2_mysql'",
      '  other:',
      '    command:',
      "      - '--requirepass'",
      '      - hunter2_requirepass',
      '      - --port',
      '      - 6379',
      '    healthcheck:',
      '      test:',
      '        - CMD',
      '        - redis-cli',
      "        - '-a'",
      '        - hunter2_healthcheck',
      '        - ping',
      '    labels:',
      '      - plain=label',
    ));
    expect(leaks(out)).toBe(false);
    expect(out).toContain('    command: redis-server --requirepass [REDACTED]');
    expect(out).toContain('      - 6379');
    expect(out).toContain('        - ping');
    expect(out).toContain('      - plain=label');
    expect(leaks(redactDocument('RUN export API_KEY=hunter2_export && make\nRUN npm config set //registry.npmjs.org/:_authToken=hunter2_run'))).toBe(false);
    expect(leaks(redactDocument('    test: ["CMD", "redis-cli", "-a", "hunter2_json", "ping"]'))).toBe(false);
  });
});

describe('YAML shapes the line reader used to miss', () => {
  it('quoted keys and JSON-style compose', () => {
    expect(leaks(redactDocument('      "DB_PASSWORD": hunter2_qkey'))).toBe(false);
    const json = JSON.stringify({ services: { app: { image: 'nginx:1.27', environment: { DB_PASSWORD: 'hunter2_json', my_setting: 'hunter2_lower' } } } }, null, 2);
    const out = redactDocument(json);
    expect(leaks(out)).toBe(false);
    expect(out).toContain('"image": "nginx:1.27"');
  });

  it('flow mappings', () => {
    expect(leaks(redactDocument('services: {app: {environment: {DB_PASSWORD: hunter2_flow}}}'))).toBe(false);
    expect(leaks(redactDocument('    environment: { A: hunter2_inline }'))).toBe(false);
    expect(redactDocument("    ports: ['80:80', '443:443']")).toBe("    ports: ['80:80', '443:443']");
  });

  it('a list at the same indent as environment:, anchors, and aliases', () => {
    expect(leaks(redactDocument(doc('    environment:', '    - mykey=hunter2_sameindent', '    - OTHER=hunter2_two', '    image: a:1')))).toBe(false);
    const anchored = redactDocument(doc('    environment: &e', '      mykey: hunter2_anchor', '    image: a:1'));
    expect(leaks(anchored)).toBe(false);
    expect(anchored).toContain('    environment: &e');
    expect(anchored).toContain('    image: a:1');
  });

  it('values spanning lines: quoted scalar, value on the next line, block scalar headers with indicators', () => {
    for (const d of [
      doc('    environment:', '      KEY: "first', '        hunter2_cont"', '      NEXT: 1'),
      doc('    environment:', '      KEY:', '        hunter2_nextline', '      NEXT: 1'),
      doc('    environment:', '      KEY: | # comment', '        hunter2_block', '      NEXT: 1'),
      doc('    environment:', '      KEY: |2-', '        hunter2_block', '      NEXT: 1'),
      doc('    environment:', '      KEY: >+', '        hunter2_block', '', '        hunter2_more', '      NEXT: 1'),
      doc('    environment:', '      "CONFIG": {', '        "a": "hunter2_nested"', '      }', '      NEXT: 1'),
    ]) {
      const out = redactDocumentLines(d);
      expect(leaks(out.join('\n')), d).toBe(false);
      expect(out).toHaveLength(d.split('\n').length);
      expect(out.at(-1)).toBe('      NEXT: 1');
    }
  });

  it('an env list entry that is not KEY=value is hidden; a bare pass-through name is kept', () => {
    const out = redactDocument(doc('    environment:', '      - PASSTHROUGH', '      - hunter2 stray words', '    image: a:1'));
    expect(leaks(out)).toBe(false);
    expect(out).toContain('      - PASSTHROUGH');
  });
});

describe('documents that are not YAML', () => {
  it('redis.conf, fluent-bit and nginx directives', () => {
    for (const conf of [
      'maxmemory 256mb\nrequirepass hunter2_redisconf\nmasterauth hunter2_master\n',
      'user default on >hunter2_acl ~* +@all\n',
      '[OUTPUT]\n    http_User   shipper\n    http_Passwd hunter2_fluent\n',
      'proxy_set_header X-Api-Key hunter2_nginx;\n',
    ]) {
      expect(leaks(redactDocument(conf)), conf).toBe(false);
    }
    expect(redactDocument('maxmemory 256mb\nrequirepass hunter2\n')).toBe('maxmemory 256mb\nrequirepass [REDACTED]\n');
    const payload = redactDeep({ redis_conf: 'requirepass hunter2_redisconf\n', settings: { logdrain_custom_config: 'http_Passwd hunter2_fluent\n' } });
    expect(leaks(JSON.stringify(payload))).toBe(false);
  });
});

describe('sensitive names', () => {
  it('Traefik / Caddy label and argument names', () => {
    for (const line of [
      "      - '--certificatesresolvers.le.acme.eab.hmacencoded=hunter2_eab'",
      '      - traefik.http.middlewares.a.digestauth.users=u:realm:hunter2_digest',
      '      - caddy_0.basic_auth.admin=hunter2_caddy',
      '      - traefik.http.middlewares.h.headers.customrequestheaders.X-Custom=hunter2_hdr',
    ]) {
      expect(leaks(redactDocument(line)), line).toBe(false);
    }
  });

  it('everything nested under a sensitive key is secret', () => {
    const out = redactDeep({ secrets: { db: 'hunter2_nested', list: ['hunter2_item'] }, name: 'app', token: { value: 'hunter2_tok' } });
    expect(leaks(JSON.stringify(out))).toBe(false);
    expect(out.name).toBe('app');
  });
});
