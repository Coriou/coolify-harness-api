import { describe, it, expect, vi } from 'vitest';
import { channel } from 'node:diagnostics_channel';

// Watches the moment zod is first evaluated (see lazy-zod.test.ts).
const state = vi.hoisted(() => ({ zodLoaded: false }));
vi.mock('zod', async (importOriginal) => {
  state.zodLoaded = true;
  return importOriginal();
});

const turn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
const settle = async (): Promise<void> => { for (let i = 0; i < 5; i += 1) await turn(); };

describe('validators are loaded while Coolify is answering', () => {
  it('starts the import only once EVERY issued request has been written to its socket', async () => {
    const { preloadSchemasOnceRequestIsSent, loadSchemas } = await import('../src/client/lazy-schemas.js');
    const sendHeaders = channel('undici:client:sendHeaders'); // what Node's fetch publishes
    preloadSchemasOnceRequestIsSent(); // request A issued
    preloadSchemasOnceRequestIsSent(); // request B issued in the same tick (status, instance info)
    await settle();
    expect(state.zodLoaded).toBe(false); // nothing on the wire yet: do not block the event loop

    sendHeaders.publish({}); // A written
    await settle();
    expect(state.zodLoaded).toBe(false); // B still has to leave

    sendHeaders.publish({}); // B written
    expect(state.zodLoaded).toBe(false); // not inside undici's write path: one loop turn later
    await settle();
    await loadSchemas();
    expect(state.zodLoaded).toBe(true);

    // Later requests and events are no-ops.
    preloadSchemasOnceRequestIsSent();
    sendHeaders.publish({});
    expect((await loadSchemas()).EnvVarSchema).toBeDefined();
  });
});
