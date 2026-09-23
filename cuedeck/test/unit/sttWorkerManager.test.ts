import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The speech worker manager with a fake utility process. The electron mock
 * imports inside its factory: top-level imports are not initialised when the
 * hoisted mock runs.
 */
interface FakeWorkerHandle {
  killed: boolean;
  /** Every `load` message posted to this worker. */
  loads: Array<{ modelId?: string; allowDownload?: boolean }>;
  emit(event: string, ...args: unknown[]): boolean;
}
const forks = vi.hoisted(() => [] as FakeWorkerHandle[]);
// load 'hang' leaves the load pending so a test can drive it; 'error'
// answers with a load-error.
const hang = vi.hoisted(() => ({
  transcribe: false,
  load: 'ok' as 'ok' | 'hang' | 'error',
}));

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class FakeWorker extends EventEmitter {
    killed = false;
    loads: Array<{ modelId?: string; allowDownload?: boolean }> = [];
    postMessage(msg: { type: string; modelId?: string; id?: number; allowDownload?: boolean }) {
      if (msg.type === 'load') {
        this.loads.push({ modelId: msg.modelId, allowDownload: msg.allowDownload });
        if (hang.load === 'hang') return;
        const reply =
          hang.load === 'error'
            ? { type: 'load-error', detail: 'not installed: file missing' }
            : { type: 'loaded', modelId: msg.modelId };
        setTimeout(() => {
          if (!this.killed) this.emit('message', { data: reply });
        }, 50);
      } else if (msg.type === 'transcribe' && !hang.transcribe) {
        setTimeout(() => {
          if (!this.killed)
            this.emit('message', { data: { type: 'transcript', id: msg.id, text: 'hello' } });
        }, 20);
      }
    }
    kill() {
      this.killed = true;
      setTimeout(() => this.emit('exit', 0), 0);
      return true;
    }
  }
  return {
    utilityProcess: {
      fork: () => {
        const worker = new FakeWorker();
        forks.push(worker);
        return worker;
      },
    },
  };
});

import { abortableDelay } from '../../src/main/providers/llm/openAiCompatible';
import { SttWorkerManager } from '../../src/main/workers/sttWorkerManager';
import { toPublicError } from '../../src/shared/errors';

const MODEL = 'onnx-community/whisper-base';
const OTHER_MODEL = 'onnx-community/whisper-tiny';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const settle = <T>(p: Promise<T>) =>
  p.then(
    (value) => ({ ok: true as const, value }),
    (error: Error) => ({ ok: false as const, error }),
  );
const noop = () => undefined;
const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'cuedeck-stt-'));
const audio = () => new Float32Array(16_000);

afterEach(() => {
  hang.transcribe = false;
  hang.load = 'ok';
  forks.length = 0;
});

async function loadedManager(): Promise<SttWorkerManager> {
  const manager = new SttWorkerManager('worker.js', tmp());
  await manager.ensureModel(MODEL, noop, new AbortController().signal);
  return manager;
}

describe('SttWorkerManager abort reasons', () => {
  it('transcribes with the fake worker', async () => {
    const manager = await loadedManager();
    const result = await manager.transcribe({
      audio: audio(),
      modelId: MODEL,
      signal: new AbortController().signal,
      onProgress: noop,
    });
    expect(result.text).toBe('hello');
  });

  it('reports a stage timeout on transcribe as PROVIDER_TIMEOUT, not a cancellation', async () => {
    const manager = await loadedManager();
    hang.transcribe = true;
    const err = await manager
      .transcribe({
        audio: audio(),
        modelId: MODEL,
        signal: AbortSignal.timeout(40),
        onProgress: noop,
      })
      .then(
        () => null,
        (e: Error) => e,
      );
    expect(err?.name).toBe('TimeoutError');
    expect(toPublicError(err).code).toBe('PROVIDER_TIMEOUT');
    // The worker is still killed, exactly as for a user cancellation.
    expect(forks.at(-1)?.killed).toBe(true);
    expect(manager.getStatus().state).toBe('idle');
  });

  it('reports a user abort on transcribe as REQUEST_CANCELLED', async () => {
    const manager = await loadedManager();
    hang.transcribe = true;
    const controller = new AbortController();
    const pending = manager.transcribe({
      audio: audio(),
      modelId: MODEL,
      signal: controller.signal,
      onProgress: noop,
    });
    setTimeout(() => controller.abort(), 20);
    const err = await pending.then(
      () => null,
      (e: Error) => e,
    );
    expect(err?.name).toBe('AbortError');
    expect(toPublicError(err).code).toBe('REQUEST_CANCELLED');
    expect(forks.at(-1)?.killed).toBe(true);
  });

  it('rejects ensureModel on an already-timed-out signal with a TimeoutError', async () => {
    const manager = new SttWorkerManager('worker.js', tmp());
    const signal = AbortSignal.timeout(1);
    await new Promise((r) => setTimeout(r, 20));
    expect(signal.aborted).toBe(true);
    const err = await manager.ensureModel(MODEL, noop, signal).then(
      () => null,
      (e: Error) => e,
    );
    expect(err?.name).toBe('TimeoutError');
    expect(toPublicError(err).code).toBe('PROVIDER_TIMEOUT');
    expect(forks).toHaveLength(0);
  });

  it('reports a timeout during a model load as a TimeoutError', async () => {
    const manager = new SttWorkerManager('worker.js', tmp());
    const err = await manager.ensureModel(MODEL, noop, AbortSignal.timeout(10)).then(
      () => null,
      (e: Error) => e,
    );
    expect(err?.name).toBe('TimeoutError');
    expect(manager.getStatus().state).toBe('idle');
  });
});

describe('abortableDelay', () => {
  it('rejects with the TimeoutError reason of a timeout signal', async () => {
    const err = await abortableDelay(5_000, AbortSignal.timeout(10)).then(
      () => null,
      (e: Error) => e,
    );
    expect(err?.name).toBe('TimeoutError');
    expect(toPublicError(err).code).toBe('PROVIDER_TIMEOUT');
  });

  it('rejects an already-timed-out signal with its TimeoutError reason', async () => {
    const signal = AbortSignal.timeout(1);
    await new Promise((r) => setTimeout(r, 20));
    await expect(abortableDelay(5_000, signal)).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('still rejects a plain user abort as an AbortError', async () => {
    const controller = new AbortController();
    const pending = abortableDelay(5_000, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('SttWorkerManager single-flight loads', () => {
  it('shares one load between overlapping ensureModel and transcribe calls', async () => {
    const manager = new SttWorkerManager('worker.js', tmp());
    const signal = () => new AbortController().signal;
    const p1 = settle(manager.ensureModel(MODEL, noop, signal()));
    await sleep(10);
    const p2 = settle(manager.ensureModel(MODEL, noop, signal()));
    await sleep(10);
    const p3 = settle(
      manager.transcribe({ audio: audio(), modelId: MODEL, signal: signal(), onProgress: noop }),
    );
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r3).toMatchObject({ ok: true, value: { text: 'hello' } });
    expect(forks).toHaveLength(1);
    expect(forks[0]?.killed).toBe(false);
    expect(manager.getStatus()).toEqual({ state: 'ready', modelId: MODEL });
  });

  it('a joined caller timing out does not kill the load for the others', async () => {
    const manager = new SttWorkerManager('worker.js', tmp());
    // A warmup with a short timeout, then a transcribe joining the same load.
    const warmup = settle(manager.ensureModel(MODEL, noop, AbortSignal.timeout(10)));
    const transcript = settle(
      manager.transcribe({
        audio: audio(),
        modelId: MODEL,
        signal: new AbortController().signal,
        onProgress: noop,
      }),
    );
    const w = await warmup;
    expect(w.ok).toBe(false);
    if (!w.ok) expect(w.error.name).toBe('TimeoutError');
    expect(manager.getStatus().state).toBe('loading');
    expect(await transcript).toMatchObject({ ok: true, value: { text: 'hello' } });
    expect(forks).toHaveLength(1);
    expect(forks[0]?.killed).toBe(false);
    expect(manager.getStatus().state).toBe('ready');
  });

  it('kills the worker and returns to idle when every waiter aborts', async () => {
    hang.load = 'hang';
    const manager = new SttWorkerManager('worker.js', tmp());
    const a = new AbortController();
    const b = new AbortController();
    const p1 = settle(manager.ensureModel(MODEL, noop, a.signal));
    const p2 = settle(manager.ensureModel(MODEL, noop, b.signal));
    await vi.waitFor(() => expect(forks[0]?.loads).toHaveLength(1));
    a.abort();
    expect(forks[0]?.killed).toBe(false);
    b.abort();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
    if (!r1.ok) expect(r1.error.name).toBe('AbortError');
    if (!r2.ok) expect(r2.error.name).toBe('AbortError');
    expect(forks).toHaveLength(1);
    expect(forks[0]?.killed).toBe(true);
    expect(manager.getStatus()).toEqual({ state: 'idle', modelId: null });
    // The next request starts a fresh load rather than joining the dead one.
    hang.load = 'ok';
    await manager.ensureModel(MODEL, noop, new AbortController().signal);
    expect(forks).toHaveLength(2);
    expect(manager.getStatus().state).toBe('ready');
  });

  it('a different model replaces an in-flight load and aborts its waiters', async () => {
    const manager = new SttWorkerManager('worker.js', tmp());
    const signal = () => new AbortController().signal;
    const first = settle(manager.ensureModel(MODEL, noop, signal()));
    const firstTranscribe = settle(
      manager.transcribe({ audio: audio(), modelId: MODEL, signal: signal(), onProgress: noop }),
    );
    await sleep(10);
    const second = settle(manager.ensureModel(OTHER_MODEL, noop, signal()));
    const [r1, r2, r3] = await Promise.all([first, firstTranscribe, second]);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error.name).toBe('AbortError');
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error.name).toBe('AbortError');
    expect(r3.ok).toBe(true);
    expect(forks).toHaveLength(2);
    expect(forks[0]?.killed).toBe(true);
    expect(forks[1]?.killed).toBe(false);
    expect(manager.getStatus()).toEqual({ state: 'ready', modelId: OTHER_MODEL });
  });

  it('rejects every waiter with MODEL_NOT_INSTALLED on a load-error and kills the worker', async () => {
    hang.load = 'error';
    const manager = new SttWorkerManager('worker.js', tmp());
    const signal = () => new AbortController().signal;
    const results = await Promise.all([
      settle(manager.ensureModel(MODEL, noop, signal())),
      settle(manager.ensureModel(MODEL, noop, signal())),
      settle(
        manager.transcribe({ audio: audio(), modelId: MODEL, signal: signal(), onProgress: noop }),
      ),
    ]);
    for (const r of results) {
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(toPublicError(r.error).code).toBe('MODEL_NOT_INSTALLED');
        expect(r.error.message).toContain('not installed:');
      }
    }
    expect(forks).toHaveLength(1);
    expect(forks[0]?.killed).toBe(true);
    expect(manager.getStatus()).toEqual({ state: 'idle', modelId: null });
  });

  it('forwards load progress to every joined caller', async () => {
    hang.load = 'hang';
    const manager = new SttWorkerManager('worker.js', tmp());
    const seenA: unknown[] = [];
    const seenB: unknown[] = [];
    const signal = () => new AbortController().signal;
    const p1 = manager.ensureModel(MODEL, (p) => seenA.push(p), signal());
    const p2 = manager.ensureModel(MODEL, (p) => seenB.push(p), signal());
    await vi.waitFor(() => expect(forks[0]?.loads).toHaveLength(1));
    const worker = forks[0]!;
    worker.emit('message', {
      data: { type: 'load-progress', file: 'model.onnx', progress: 42 },
    });
    worker.emit('message', { data: { type: 'loaded', modelId: MODEL } });
    await Promise.all([p1, p2]);
    const expected = { stage: 'downloading', file: 'model.onnx', value: 42 };
    expect(seenA).toEqual([expected]);
    expect(seenB).toEqual([expected]);
    expect(forks).toHaveLength(1);
  });
});

describe('SttWorkerManager download policy', () => {
  it('loads without downloads by default', async () => {
    const manager = new SttWorkerManager('worker.js', tmp());
    await manager.ensureModel(MODEL, noop, new AbortController().signal);
    expect(forks[0]?.loads).toEqual([{ modelId: MODEL, allowDownload: false }]);
  });

  it('never allows downloads for a transcription', async () => {
    const manager = new SttWorkerManager('worker.js', tmp());
    await manager.transcribe({
      audio: audio(),
      modelId: MODEL,
      signal: new AbortController().signal,
      onProgress: noop,
    });
    expect(forks[0]?.loads).toEqual([{ modelId: MODEL, allowDownload: false }]);
  });

  it('allows downloads only when asked', async () => {
    const manager = new SttWorkerManager('worker.js', tmp());
    await manager.ensureModel(MODEL, noop, new AbortController().signal, {
      allowDownload: true,
    });
    expect(forks[0]?.loads).toEqual([{ modelId: MODEL, allowDownload: true }]);
  });
});
