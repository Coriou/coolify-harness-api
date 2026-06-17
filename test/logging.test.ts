import { describe, it, expect } from 'vitest';
import { createLogger, redactSecrets } from '../src/logging/index.js';

describe('logger', () => {
  it('redacts secret-shaped fields', () => {
    expect(redactSecrets({ token: 'abc', port: 3001 })).toEqual({ token: '[REDACTED]', port: 3001 });
  });

  it('emits one JSON line per call respecting level', () => {
    const lines: string[] = [];
    const log = createLogger({ level: 'info', sink: (l) => lines.push(l) });
    log.debug('hidden');
    log.info('shown', { token: 'secret', key: 'NODE_ENV' });
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed.level).toBe('info');
    expect(parsed.msg).toBe('shown');
    expect(parsed.token).toBe('[REDACTED]');
    expect(parsed.key).toBe('NODE_ENV');
    expect(typeof parsed.ts).toBe('string');
  });
});
