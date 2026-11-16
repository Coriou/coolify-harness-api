import { subscribe, unsubscribe } from 'node:diagnostics_channel';
let cached;
/**
 * The response / request validators, loaded on first use.
 *
 * `schemas.ts` is the only module that imports zod, and zod 4 is slow to import: every entry point
 * of the package pulls in its ~60 locale files (~130 ms on Node 24, against ~25 ms for zod 3).
 * Commands that never talk to Coolify (`help`, usage errors, `config doctor --offline`) never pay
 * for it; the others pay while they wait for the network (see preloadSchemasOnceRequestIsSent).
 */
export function loadSchemas() {
    if (!cached) {
        cached = import('./schemas.js');
        stopListening();
    }
    return cached;
}
/** Node's built-in fetch (undici) publishes here right before it writes a request to the socket. */
const SEND_HEADERS = 'undici:client:sendHeaders';
let listener;
let issued = 0;
let sent = 0;
/** Without undici's channel the event never comes: do not stay subscribed past the first load. */
function stopListening() {
    if (!listener)
        return;
    const l = listener;
    listener = undefined;
    try {
        unsubscribe(SEND_HEADERS, l);
    }
    catch { /* diagnostics_channel unavailable */ }
}
/**
 * Call once per request, right before it is issued: the validators start loading at the moment
 * every request issued so far has been written to its socket.
 *
 * Node evaluates a dynamic `import()` of files on disk synchronously, so importing zod right
 * after calling `fetch()` blocks the event loop BEFORE the connection is even opened and delays
 * the request by the full import. Waiting for undici's `sendHeaders` event (plus one turn of the
 * event loop, so the bytes are flushed) moves that work into the time spent waiting for Coolify's
 * answer, where it costs nothing. Counting requests keeps a second, parallel request (`status`
 * reads two things at once) from being stalled behind the import.
 *
 * Without undici's channel (an injected fetch, Bun) the events never come and the validators
 * simply load when the first response is parsed.
 */
export function preloadSchemasOnceRequestIsSent() {
    if (cached)
        return;
    issued += 1;
    if (listener)
        return;
    const onSent = () => {
        sent += 1;
        if (sent < issued)
            return;
        stopListening();
        setImmediate(() => { loadSchemas().catch(() => { }); });
    };
    listener = onSent;
    try {
        subscribe(SEND_HEADERS, onSent);
    }
    catch {
        listener = undefined; // diagnostics_channel unavailable: load lazily on first use
    }
}
