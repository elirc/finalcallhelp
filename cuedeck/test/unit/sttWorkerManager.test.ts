import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The speech worker manager with a fake utility process. The electron mock
 * imports inside its factory: top-level imports are not initialised when the
 * hoisted mock runs.
 */
const forks = vi.hoisted(() => [] as Array<{ killed: boolean }>);
const hang = vi.hoisted(() => ({ transcribe: false }));

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class FakeWorker extends EventEmitter {
    killed = false;
    postMessage(msg: { type: string; modelId?: string; id?: number }) {
      if (msg.type === 'load') {
        setTimeout(() => {
          if (!this.killed)
            this.emit('message', { data: { type: 'loaded', modelId: msg.modelId } });
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
const noop = () => undefined;
const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'cuedeck-stt-'));
const audio = () => new Float32Array(16_000);

afterEach(() => {
  hang.transcribe = false;
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
