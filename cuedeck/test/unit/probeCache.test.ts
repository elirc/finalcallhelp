import { describe, expect, it } from 'vitest';
import { ProbeCache } from '../../src/main/providers/probeCache';

interface Probe {
  status: string;
  n: number;
}

function makeCache(ttl = { readyMs: 1000, failureMs: 100 }) {
  let now = 0;
  const cache = new ProbeCache<Probe>(ttl, () => now);
  let calls = 0;
  const fetcher = (status: string) => async () => ({ status, n: ++calls });
  return { cache, fetcher, calls: () => calls, advance: (ms: number) => (now += ms) };
}

describe('ProbeCache', () => {
  it('serves a ready result from cache until its TTL passes', async () => {
    const { cache, fetcher, calls, advance } = makeCache();
    await cache.get('a', fetcher('ready'));
    await cache.get('a', fetcher('ready'));
    expect(calls()).toBe(1);
    advance(1001);
    await cache.get('a', fetcher('ready'));
    expect(calls()).toBe(2);
  });

  it('keeps failures only briefly so a fixed provider is noticed quickly', async () => {
    const { cache, fetcher, calls, advance } = makeCache();
    await cache.get('a', fetcher('unreachable'));
    advance(101);
    await cache.get('a', fetcher('ready'));
    expect(calls()).toBe(2);
  });

  it('shares one in-flight request between concurrent callers', async () => {
    const { cache, calls } = makeCache();
    let resolve: (p: Probe) => void = () => undefined;
    const slow = () =>
      new Promise<Probe>((r) => {
        resolve = r;
      });
    const first = cache.get('a', slow);
    const second = cache.get('a', slow);
    resolve({ status: 'ready', n: 1 });
    expect(await first).toEqual(await second);
    expect(calls()).toBe(0); // the counting fetcher was never used
  });

  it('bypasses the cache when asked for a fresh result', async () => {
    const { cache, fetcher, calls } = makeCache();
    await cache.get('a', fetcher('ready'));
    await cache.get('a', fetcher('ready'), true);
    expect(calls()).toBe(2);
  });

  it('invalidates by key prefix', async () => {
    const { cache, fetcher, calls } = makeCache();
    await cache.get('local-whisper|base', fetcher('ready'));
    await cache.get('ollama|url', fetcher('ready'));
    cache.invalidate('local-whisper');
    await cache.get('local-whisper|base', fetcher('ready'));
    await cache.get('ollama|url', fetcher('ready'));
    expect(calls()).toBe(3);
  });

  it('keys are independent', async () => {
    const { cache, fetcher, calls } = makeCache();
    await cache.get('a', fetcher('ready'));
    await cache.get('b', fetcher('ready'));
    expect(calls()).toBe(2);
  });
});
