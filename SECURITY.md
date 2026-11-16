# Security

coolify-harness handles API tokens that can deploy to, and read secrets from, your servers. Its
core promise is that it never prints, logs or stores a token or an env value.

## Reporting a vulnerability

**Do not open a public issue.** Use GitHub's private reporting:
<https://github.com/Coriou/coolify-harness-api/security/advisories/new>

Please report anything that breaks the promise above, for example:

- a token, env value, password or private key appearing in stdout, stderr, `--json` output, an
  error message, a stack trace or `.coolify-harness/audit.jsonl`;
- a command that changes Coolify without `--apply` (other than `deploy`, which is documented);
- a way to make the harness send a token to a host other than the configured instance;
- a redaction miss on a compose / proxy document or an API payload.

Include the harness version (`coolify-harness --version`), the Coolify version, the command, and a
**synthetic** reproduction. Never include a real token or secret: if one leaked while you found
the bug, rotate it first (Coolify → Keys & Tokens).

You will get an answer within a few days. Fixes ship as a patch release with a `### Security`
section in the CHANGELOG.

## What redaction covers, and what it cannot know

Two different guarantees:

- **Structured data is exact.** Env values (`env list` / `diff` / `apply`), tokens, and every
  field of a Coolify payload whose name says it is secret are never printed, whatever they hold.
- **Free-form documents are a heuristic.** A docker-compose file, a proxy configuration, a
  Dockerfile or a start command is text. The redactor recognises the shapes these really take
  (assignments, `environment:` blocks, secret-named keys and flags, command lists, URL
  credentials, `Bearer` tokens, PEM blocks, password hashes…) and errs on the side of hiding. It
  cannot recognise a password that nothing marks as one: a bare positional argument
  (`rabbitmqctl add_user admin PASS`), free prose, a value under a key such as `pw` or `k`.

So keep literal secrets out of compose files and commands: put them in env variables and
reference them (`${VAR}`). References are always shown; values never are. `compose get --out` and
`proxy get --out` write the unredacted document on purpose: keep those files out of git.

A shape of a real compose file that prints its secret is a bug worth reporting (above), as is
redaction hiding a change a reviewer must see in a `compose set` / `proxy set` diff.

## Supported versions

Only the latest release gets fixes. Consumers pin a tag, so upgrading is a one-line change.

## If you think a token leaked

1. Revoke it in Coolify (Keys & Tokens → API tokens) and create a new one.
2. Check `.coolify-harness/audit.jsonl` and Coolify's own audit log for actions you did not take.
3. Then report how it leaked.
