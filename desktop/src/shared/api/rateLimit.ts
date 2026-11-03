// R28 — token bucket per (key, bucket). Pure: the caller passes the clock.

export interface BucketSpec {
  capacity: number;
  perMinute: number;
}

export interface TakeResult {
  ok: boolean;
  /** Whole seconds until one token is available (≥ 1 when refused). */
  retryAfterS: number;
  remaining: number;
}

export class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(private spec: BucketSpec, now: number) {
    this.tokens = spec.capacity;
    this.last = now;
  }

  private refill(now: number): void {
    const perMs = this.spec.perMinute / 60_000;
    if (now > this.last) {
      this.tokens = Math.min(this.spec.capacity, this.tokens + (now - this.last) * perMs);
      this.last = now;
    }
  }

  take(now: number): TakeResult {
    this.refill(now);
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return { ok: true, retryAfterS: 0, remaining: Math.floor(this.tokens) };
    }
    const perMs = this.spec.perMinute / 60_000;
    const waitMs = (1 - this.tokens) / perMs;
    return { ok: false, retryAfterS: Math.max(1, Math.ceil(waitMs / 1000)), remaining: 0 };
  }

  full(now: number): boolean {
    this.refill(now);
    return this.tokens >= this.spec.capacity;
  }
}

export class RateLimiter<B extends string> {
  private buckets = new Map<string, TokenBucket>();
  constructor(private specs: Record<B, BucketSpec>) {}

  take(subject: string, bucket: B, now: number): TakeResult {
    const k = `${subject}\u0000${bucket}`;
    let b = this.buckets.get(k);
    if (!b) {
      b = new TokenBucket(this.specs[bucket], now);
      this.buckets.set(k, b);
    }
    return b.take(now);
  }

  /** Drops buckets that are full again (bounded memory for many keys). */
  sweep(now: number): void {
    for (const [k, b] of this.buckets) if (b.full(now)) this.buckets.delete(k);
  }

  forget(subject: string): void {
    for (const k of [...this.buckets.keys()]) if (k.startsWith(`${subject}\u0000`)) this.buckets.delete(k);
  }
}
