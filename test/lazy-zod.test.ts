import { describe, it, expect, vi } from 'vitest';

// zod 4 costs ~130 ms to import (every entry point loads its ~60 locale files), so the harness
// loads its validators only once a request is on the wire. This file watches the moment zod is
// first evaluated.
const state = vi.hoisted(() => ({ zodLoaded: false }));
vi.mock('zod', async (importOriginal) => {
  state.zodLoaded = true;
  return importOriginal();
});

describe('zod is loaded lazily', () => {
  it('not by help, --version, a usage error, the library root, config validation or building a client', async () => {
    const write = process.stdout.write.bind(process.stdout);
    const writeErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = (() => true) as typeof process.stdout.write;
    process.stderr.write = (() => true) as typeof process.stderr.write;
    try {
      const { main } = await import('../src/cli/main.js');
      expect(await main(['help'])).toBe(0);
      expect(await main(['--version'])).toBe(0);
      expect(await main(['status', '--nope'])).toBe(2);
      expect(await main(['server', 'reboot', '--instance', 'prod'])).toBe(2);
    } finally {
      process.stdout.write = write;
      process.stderr.write = writeErr;
    }
    const lib = await import('../src/index.js');
    lib.loadConfig; // touch the config surface
    const { loadRegistry } = await import('../src/config/load.js');
    loadRegistry({ instances: { prod: { url: 'https://c.example', tokenEnv: 'T' } }, targets: {} });
    await import('../src/cli/dispatch.js');
    new lib.CoolifyClient({ instanceUrl: 'https://c.example', kind: 'application', uuid: 'a', token: 't' }, {
      fetchImpl: async () => new Response('[]', { status: 200 }), logger: lib.createLogger({ sink: () => {} }),
    });
    expect(state.zodLoaded).toBe(false);
  });

  it('with a fetch that is not undici (no send event) it is still not loaded before the request, and loads for the answer', async () => {
    const lib = await import('../src/index.js');
    let zodLoadedWhenFetchWasCalled: boolean | undefined;
    const client = new lib.CoolifyClient({ instanceUrl: 'https://c.example', kind: 'application', uuid: 'a', token: 't' }, {
      fetchImpl: async () => { zodLoadedWhenFetchWasCalled = state.zodLoaded; return new Response('[]', { status: 200 }); },
      logger: lib.createLogger({ sink: () => {} }),
    });
    expect(await client.listEnvs()).toEqual([]);
    expect(zodLoadedWhenFetchWasCalled).toBe(false);
    expect(state.zodLoaded).toBe(true);
  });
});
