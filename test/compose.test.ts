import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  diffLines, formatRedactedDiff, isValidImageRef, listServiceImages, setServiceImage, splitImageRef,
} from '../src/client/compose.js';

const fx = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/coolify/v4.5/${name}`, import.meta.url)), 'utf8'));
const serviceCompose = fx('service.json')['docker_compose_raw'] as string;
const proxyCompose = fx('server-proxy.json')['configuration'] as string;

describe('compose image helpers', () => {
  it('lists the image of every service under services:', () => {
    expect(listServiceImages(serviceCompose).map((s) => [s.service, s.image])).toEqual([
      ['umami', 'ghcr.io/umami-software/umami:3.0.3'],
      ['postgresql', 'postgres:15-alpine'],
    ]);
    expect(listServiceImages(proxyCompose).map((s) => s.image)).toEqual(['traefik:v3.6']);
  });

  it('rewrites only the target image line, preserving quote style and every other byte', () => {
    const next = setServiceImage(proxyCompose, 'traefik', 'traefik:v3.7.13');
    expect(next).toContain("    image: 'traefik:v3.7.13'");
    const changed = diffLines(proxyCompose, next).filter((d) => d.op !== 'same');
    expect(changed).toHaveLength(2); // one - and one +
    const svc = setServiceImage(serviceCompose, 'umami', 'ghcr.io/umami-software/umami:3.4.0');
    expect(svc).toContain('    image: ghcr.io/umami-software/umami:3.4.0\n');
    expect(svc).toContain('image: postgres:15-alpine'); // untouched sibling
  });

  it('refuses unknown services and malformed image references', () => {
    expect(() => setServiceImage(serviceCompose, 'nope', 'x:1')).toThrow(/Services with an image: umami, postgresql/);
    expect(() => setServiceImage(serviceCompose, 'umami', 'bad ref')).toThrow(/valid image/);
    expect(isValidImageRef("traefik:v3.6'; rm -rf /")).toBe(false);
    expect(isValidImageRef('ghcr.io/org/app:1.2.3')).toBe(true);
    expect(isValidImageRef(`postgres@sha256:${'a'.repeat(64)}`)).toBe(true);
  });

  it('splits repo and tag', () => {
    expect(splitImageRef('traefik:v3.6')).toEqual({ repo: 'traefik', tag: 'v3.6' });
    expect(splitImageRef('ghcr.io/a/b')).toEqual({ repo: 'ghcr.io/a/b', tag: undefined });
    expect(splitImageRef(`node:24@sha256:${'b'.repeat(64)}`)).toEqual({ repo: 'node', tag: '24' });
  });
});

describe('formatRedactedDiff', () => {
  it('shows image changes and hides changed secret values', () => {
    const next = setServiceImage(serviceCompose, 'umami', 'ghcr.io/umami-software/umami:3.4.0')
      .replace('HARDCODED_TOKEN=fixture-not-a-real-secret', 'HARDCODED_TOKEN=another-fixture-secret');
    const out = formatRedactedDiff(serviceCompose, next).join('\n');
    expect(out).toContain('-     image: ghcr.io/umami-software/umami:3.0.3');
    expect(out).toContain('+     image: ghcr.io/umami-software/umami:3.4.0');
    expect(out).toContain('~ - HARDCODED_TOKEN=[REDACTED]   (redacted value changed)');
    expect(out).not.toMatch(/fixture-not-a-real-secret|another-fixture-secret/);
  });

  it('is empty when nothing changed', () => {
    expect(formatRedactedDiff(serviceCompose, serviceCompose)).toEqual([]);
  });
});
