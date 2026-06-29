export type IdempotencyOutcome =
  | { readonly kind: "fresh" }
  | { readonly kind: "replay"; readonly result: unknown }
  | { readonly kind: "in-flight" };

export interface IdempotencyStore {
  begin(key: string, now: number): IdempotencyOutcome;
  complete(key: string, result: unknown, now: number): void;
  fail(key: string, now: number): void;
  size(): number;
}

interface Entry {
  inFlight: boolean;
  result: unknown | undefined;
  expiresAt: number;
}

export interface InMemoryIdempotencyOptions {
  readonly ttlMs: number;
  readonly now?: () => number;
}

export function createInMemoryIdempotencyStore(options: InMemoryIdempotencyOptions): IdempotencyStore {
  if (!Number.isInteger(options.ttlMs) || options.ttlMs < 1) {
    throw new Error("idempotency ttl must be a positive integer");
  }
  const _now: () => number = options.now ?? Date.now;
  void _now;
  const entries = new Map<string, Entry>();

  const evict = (t: number): void => {
    for (const [k, e] of entries) {
      if (e.expiresAt <= t) entries.delete(k);
    }
  };

  return {
    begin(key, t) {
      evict(t);
      const e = entries.get(key);
      if (e !== undefined) {
        if (e.inFlight) return { kind: "in-flight" };
        return { kind: "replay", result: e.result };
      }
      entries.set(key, { inFlight: true, result: undefined, expiresAt: t + options.ttlMs });
      return { kind: "fresh" };
    },
    complete(key, result, t) {
      entries.set(key, { inFlight: false, result, expiresAt: t + options.ttlMs });
    },
    fail(key, t) {
      const e = entries.get(key);
      if (e !== undefined) entries.set(key, { inFlight: false, result: e.result, expiresAt: t + options.ttlMs });
    },
    size() {
      return entries.size;
    },
  };
}
