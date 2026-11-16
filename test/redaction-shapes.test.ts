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

// ── second review round ─────────────────────────────────────────────────────
const S = 'S3cr3tValue9x';
const has = (text: string): boolean => text.includes(S);

describe('exec-form command arrays', () => {
  it('redacts the argument after a secret flag, whole, whatever precedes it', () => {
    for (const line of [
      '      test: ["CMD", "redis-cli", "--no-auth-warning", "-a", "S3cr3tValue9x", "ping"]',
      '      test: ["CMD", "curl", "-H", "X-Api-Key: S3cr3tValue9x", "http://localhost/health"]',
      '    command: ["server", "--password", "correct horse S3cr3tValue9x"]',
      'CMD ["server", "--password", "S3cr3tValue9x"]',
      "    entrypoint: ['sh', '-c', 'export PGPASSWORD=S3cr3tValue9x && psql']",
    ]) {
      expect(has(redactDocument(line)), line).toBe(false);
    }
    expect(redactDocument('      test: ["CMD", "redis-cli", "--no-auth-warning", "-a", "S3cr3tValue9x", "ping"]'))
      .toBe('      test: ["CMD", "redis-cli", "--no-auth-warning", "-a", "[REDACTED]", "ping"]');
    expect(redactDocument('      test: ["CMD", "pg_isready", "-U", "postgres"]')).toBe('      test: ["CMD", "pg_isready", "-U", "postgres"]');
  });

  it('a flow list spread over several lines (prettier, pretty JSON)', () => {
    for (const d of [
      doc('    command:', '      [', '        "redis-server",', '        "--requirepass",', '        "S3cr3tValue9x",', '      ]', '    image: redis:7'),
      doc('    command: [', '      "redis-server",', '      "--requirepass",', '      "S3cr3tValue9x"', '    ]', '    image: redis:7'),
      doc('      "command": [', '        "redis-server",', '        "--requirepass",', '        "S3cr3tValue9x"', '      ],', '      "image": "redis:7"'),
    ]) {
      const out = redactDocumentLines(d);
      expect(has(out.join('\n')), d).toBe(false);
      expect(out.join('\n')).toContain('redis-server');
      expect(out.at(-1)).toContain('redis:7');
    }
  });
});

describe('multi-line command content', () => {
  it('Dockerfile RUN continuation lines are command lines', () => {
    const out = redactDocument(doc(
      'RUN apt-get update && \\',
      '    mysql -uroot -pS3cr3tValue9x -e "select 1" && \\',
      '    curl -u admin:S3cr3tValue9x https://x && \\',
      '    export PGPASSWORD=S3cr3tValue9x && \\',
      '    npm config set //registry.npmjs.org/:_authToken=S3cr3tValue9x && \\',
      '    git clone https://x-access-token:S3cr3tValue9x@github.com/a/b /src',
      'FROM node:24',
    ));
    expect(has(out)).toBe(false);
    expect(out).toContain('git clone https://x-access-token:[REDACTED]@github.com/a/b /src');
    expect(out).toContain('FROM node:24');
  });

  it('a script given as a block scalar item of command:', () => {
    const out = redactDocument(doc('    command:', '      - sh', '      - -c', '      - |', '        export PGPASSWORD=S3cr3tValue9x', '        mysql -uroot -pS3cr3tValue9x', '    image: a:1'));
    expect(has(out)).toBe(false);
    expect(out).toContain('    image: a:1');
  });

  it('assignments and flags with awkward boundaries', () => {
    for (const cmd of [
      'DB_PASSWORD=abc,S3cr3tValue9x node x',
      'DB_PASSWORD=abc;S3cr3tValue9x',
      'sh -c "mysql --password=\\"S3cr3tValue9x\\" x"',
      'curl --user admin:S3cr3tValue9x https://x',
      'curl --proxy-user admin:S3cr3tValue9x https://x',
      'curl -H "X-Auth-Key: S3cr3tValue9x" https://x',
      'redis-server --requirepass 123456S3cr3tValue9x',
    ]) {
      expect(has(redactCommandLine(cmd)), cmd).toBe(false);
    }
    expect(redactCommandLine('redis-server --requirepass 123456')).toBe('redis-server --requirepass [REDACTED]');
  });
});

describe('comments and tags', () => {
  it('a comment line neither closes the environment block nor leaks what it comments out', () => {
    const out = redactDocument(doc('    environment:', '      ASPNETCORE_ENVIRONMENT: Production', '#      Jwt__Key: S3cr3tValue9x-old', '      jwt__key: S3cr3tValue9x', '    # top comment', '      other: S3cr3tValue9x', '    image: a:1'));
    expect(has(out)).toBe(false);
    expect(out).toContain('    image: a:1');
  });

  it('a comment inside a command list does not reset "the next argument is the secret"', () => {
    expect(has(redactDocument(doc('    command:', '      - --requirepass', '      # rotated 2026-01', '      - S3cr3tValue9x', '    image: a:1')))).toBe(false);
  });

  it('environment: with a YAML tag', () => {
    expect(has(redactDocument(doc('    environment: !override', '      jwtKey: S3cr3tValue9x', '    image: a:1')))).toBe(false);
  });
});

describe('documents on one line', () => {
  it('a minified JSON compose is hidden whole (there is no line structure to keep)', () => {
    expect(has(redactDocument('{"services":{"db":{"image":"postgres:16","environment":{"POSTGRES_PASSWORD":"S3cr3tValue9x"}}}}'))).toBe(false);
  });
});

describe('redaction is linear-time', () => {
  it('long runs of spaces after a flag do not blow up', () => {
    const started = Date.now();
    redactDeep({ start_command: `node server.js --verbose${' '.repeat(20_000)}` });
    redactDocument(`    command: redis-server --port 6379${' '.repeat(20_000)}`);
    redactCommandLine(`tool -x${' '.repeat(20_000)}-y`);
    redactUrlCredentials(`postgres://${'a:'.repeat(5_000)}`);
    redactDocument(`${'  - "x",\n'.repeat(2_000)}`);
    expect(Date.now() - started).toBeLessThan(1500);
  });
});

describe('structure stays readable', () => {
  it('a service whose NAME looks sensitive still shows its image and ports', () => {
    const compose = doc('services:', '  supertokens:', '    image: registry.supertokens.io/supertokens/supertokens-postgresql:9.0', '    ports:', "      - '3567:3567'", '    environment:', '      API_KEYS: S3cr3tValue9x', '  passbolt:', '    image: passbolt/passbolt:4.0');
    const out = redactDocument(compose);
    expect(has(out)).toBe(false);
    expect(out).toContain('    image: registry.supertokens.io/supertokens/supertokens-postgresql:9.0');
    expect(out).toContain("      - '3567:3567'");
    expect(out).toContain('    image: passbolt/passbolt:4.0');
    const diff = formatRedactedDiff(compose, compose.replace('postgresql:9.0', 'postgresql:9.1')).join('\n');
    expect(diff).toContain('postgresql:9.0');
    expect(diff).toContain('postgresql:9.1');
  });

  it('the top-level secrets: section keeps its structure', () => {
    const out = redactDocument(doc('secrets:', '  db_password:', '    file: ./db_password.txt', 'services:', '  a:', '    image: a:1'));
    expect(out).toContain('    file: ./db_password.txt');
    expect(out).toContain('    image: a:1');
  });
});

describe('names and values the heuristics missed', () => {
  it('URL passwords containing "@" followed by "/", and more query parameter names', () => {
    expect(has(redactUrlCredentials('postgres://app:p@ss/S3cr3tValue9x@db:5432/app'))).toBe(false);
    for (const name of ['access_token', 'client_secret', 'private_token', 'key', 'X-Amz-Signature', 'api_key']) {
      expect(has(redactUrlCredentials(`https://h/p?a=1&${name}=S3cr3tValue9x&b=2`)), name).toBe(false);
    }
    expect(redactUrlCredentials('https://h/p?page=2&sort=asc')).toBe('https://h/p?page=2&sort=asc');
  });

  it('names ending in "key", conninfo strings and command values in config documents', () => {
    for (const line of [
      '      - homepage.widget.key=S3cr3tValue9x',
      '    Jwt__Key: S3cr3tValue9x',
      'fastcgi_param APP_KEY S3cr3tValue9x;',
      "primary_conninfo = 'host=primary user=replica password=S3cr3tValue9x'",
      "restore_command = 'AWS_SECRET_ACCESS_KEY=S3cr3tValue9x wal-g wal-fetch %f %p'",
    ]) {
      expect(has(redactDocument(line)), line).toBe(false);
    }
  });

  it('a numeric password is still a password; a numeric port is still shown', () => {
    expect(redactDocument(doc('    environment:', '      POSTGRES_PASSWORD: 123456', '      PORT: 3000'))).toBe(doc('    environment:', '      POSTGRES_PASSWORD: [REDACTED]', '      PORT: 3000'));
  });

  it('a variable NAMED test / command inside environment: is a variable, not a command', () => {
    expect(has(redactDocument(doc('    environment:', '      test: S3cr3tValue9x', '      command: S3cr3tValue9x', '      entrypoint: S3cr3tValue9x')))).toBe(false);
  });

  it('a line separator character inside a value does not hide the rest from the patterns', () => {
    expect(has(redactDocument('    environment:\n      API_URL: abc S3cr3tValue9x'))).toBe(false);
  });

  it('prose that merely contains the word "token" or "basic" is left alone', () => {
    const text = 'The API token contains whitespace or non-printable characters; use basic configuration.';
    expect(redactUrlCredentials(text)).toBe(text);
  });
});
