import { describe, it, expect } from 'vitest';
import { CircuitBreaker } from '../src/client/http.js';

describe('CircuitBreaker', () => {
  it('opens after the failure threshold and blocks requests', () => {
    let t = 0;
    const cb = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 1000, now: () => t });
    expect(cb.canRequest()).toBe(true);
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.state).toBe('open');
    expect(cb.canRequest()).toBe(false);
  });

  it('half-opens after the reset timeout and closes on a probe success', () => {
    let t = 0;
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1000, now: () => t });
    cb.recordFailure();
    expect(cb.canRequest()).toBe(false);
    t = 1001;
    expect(cb.canRequest()).toBe(true);
    expect(cb.state).toBe('half-open');
    cb.recordSuccess();
    expect(cb.state).toBe('closed');
  });

  it('re-opens if the half-open probe fails', () => {
    let t = 0;
    const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1000, now: () => t });
    cb.recordFailure();
    t = 1001;
    expect(cb.canRequest()).toBe(true);
    cb.recordFailure();
    expect(cb.state).toBe('open');
  });
});
