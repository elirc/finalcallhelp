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

  it('an invalidated in-flight probe never populates the cache', async () => {
    const { cache, fetcher, calls } = makeCache();
    let resolveOld: (p: Probe) => void = () => undefined;
    const old = cache.get(
      'a',
      () =>
        new Promise<Probe>((r) => {
          resolveOld = r;
        }),
    );
    cache.invalidate();
    const second = await cache.get('a', fetcher('ready'));
    expect(calls()).toBe(1);
    expect(second).toEqual({ status: 'ready', n: 1 });
    resolveOld({ status: 'missing-credential', n: 99 });
    expect(await old).toEqual({ status: 'missing-credential', n: 99 });
    expect(await cache.get('a', fetcher('ready'))).toEqual({ status: 'ready', n: 1 });
    expect(calls()).toBe(1);
  });

  it('fetches again after invalidate even while the old request is pending', async () => {
    const { cache, fetcher, calls } = makeCache();
    let resolveOld: (p: Probe) => void = () => undefined;
    const old = cache.get(
      'a',
      () =>
        new Promise<Probe>((r) => {
          resolveOld = r;
        }),
    );
    cache.invalidate();
    const next = await cache.get('a', fetcher('ready'));
    expect(calls()).toBe(1);
    expect(next.n).toBe(1);
    resolveOld({ status: 'unreachable', n: 0 });
    await old;
  });

  it('invalidating one prefix leaves other in-flight probes joinable', async () => {
    const { cache, fetcher, calls } = makeCache();
    let resolveOllama: (p: Probe) => void = () => undefined;
    const first = cache.get(
      'ollama|url',
      () =>
        new Promise<Probe>((r) => {
          resolveOllama = r;
        }),
    );
    cache.invalidate('local-whisper');
    const second = cache.get('ollama|url', fetcher('ready'));
    resolveOllama({ status: 'ready', n: 7 });
    expect(await second).toEqual(await first);
    expect(calls()).toBe(0);
  });
});
