/**
 * Short-lived memo for provider probes. The coach re-checks readiness every
 * time settings change and the preferences window probes on its own, so
 * without this a single "open Preferences, toggle one switch" round trip
 * fired four network/disk probes and showed "Checking…" each time.
 *
 * Successful results live longer than failures: a stopped Ollama or a
 * missing model should be noticed quickly once the user fixes it, while a
 * healthy provider does not need re-verifying every few seconds. In-flight
 * probes are shared, so concurrent callers await one request.
 *
 * `invalidate()` bumps a generation counter and forgets both the stored
 * results and the in-flight requests for the matching keys. A caller that
 * arrives afterwards starts a new probe instead of joining the obsolete one,
 * and a probe started before the invalidation still resolves for its own
 * callers but never writes its (possibly stale) result into the cache.
 */
export class ProbeCache<T extends { status: string }> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();
  private readonly inflight = new Map<string, Promise<T>>();
  private generation = 0;

  constructor(
    private readonly ttl: { readyMs: number; failureMs: number } = {
      readyMs: 30_000,
      failureMs: 5_000,
    },
    private readonly now: () => number = Date.now,
  ) {}

  async get(key: string, fetcher: () => Promise<T>, fresh = false): Promise<T> {
    const generation = this.generation;
    if (!fresh) {
      const hit = this.entries.get(key);
      if (hit && hit.expiresAt > this.now()) return hit.value;
      const pending = this.inflight.get(key);
      if (pending) return pending;
    }
    const request = fetcher()
      .then((value) => {
        if (generation === this.generation) {
          const ttl = value.status === 'ready' ? this.ttl.readyMs : this.ttl.failureMs;
          this.entries.set(key, { value, expiresAt: this.now() + ttl });
        }
        return value;
      })
      .finally(() => {
        if (this.inflight.get(key) === request) this.inflight.delete(key);
      });
    this.inflight.set(key, request);
    return request;
  }

  /**
   * Drop every stored result and in-flight request whose key starts with
   * `prefix` (or everything), and stop any probe already running from
   * populating the cache when it completes.
   */
  invalidate(prefix = ''): void {
    this.generation += 1;
    for (const map of [this.entries, this.inflight]) {
      for (const key of [...map.keys()]) {
        if (key.startsWith(prefix)) map.delete(key);
      }
    }
  }
}
