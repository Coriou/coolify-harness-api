export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeoutMs: number;
  now?: () => number;
}

type BreakerState = 'closed' | 'open' | 'half-open';

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private internalState: BreakerState = 'closed';
  private readonly now: () => number;

  constructor(private readonly opts: CircuitBreakerOptions) {
    this.now = opts.now ?? ((): number => Date.now());
  }

  get state(): BreakerState {
    return this.internalState;
  }

  canRequest(): boolean {
    if (this.internalState === 'open') {
      if (this.now() - this.openedAt >= this.opts.resetTimeoutMs) {
        this.internalState = 'half-open';
        return true;
      }
      return false;
    }
    return true;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.internalState = 'closed';
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.internalState === 'half-open' || this.failures >= this.opts.failureThreshold) {
      this.internalState = 'open';
      this.openedAt = this.now();
    }
  }
}
