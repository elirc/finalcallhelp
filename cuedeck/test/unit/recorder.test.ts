import { afterEach, expect, it, vi } from 'vitest';
import { ClipRecorder } from '../../src/renderer/audio/recorder';

afterEach(() => vi.unstubAllGlobals());

it('stops a late capture stream after cancellation while permission is pending', async () => {
  let grant!: (stream: MediaStream) => void;
  const pending = new Promise<MediaStream>((resolve) => {
    grant = resolve;
  });
  vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: () => pending } });
  const stop = vi.fn();
  const recorder = new ClipRecorder(30, { onLevel: vi.fn(), onAutoStop: vi.fn() });
  const start = recorder.start();
  const rejected = expect(start).rejects.toMatchObject({ name: 'AbortError' });
  await recorder.abort();
  grant({ getTracks: () => [{ stop }] } as unknown as MediaStream);
  await rejected;
  expect(stop).toHaveBeenCalledOnce();
});

it('asks for a 16 kHz AudioContext and encodes worklet blocks without resampling', async () => {
  const trackStop = vi.fn();
  const audioTrack = { kind: 'audio', stop: trackStop };
  const stream = {
    getVideoTracks: () => [],
    getAudioTracks: () => [audioTrack],
    getTracks: () => [audioTrack],
  };
  vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: async () => stream } });
  vi.stubGlobal(
    'MediaStream',
    class {
      constructor(private readonly tracks: unknown[]) {}
      getTracks() {
        return this.tracks;
      }
    },
  );
  const contextArgs: unknown[] = [];
  class FakeAudioContext {
    readonly sampleRate: number;
    readonly audioWorklet = { addModule: async () => undefined };
    constructor(options?: { sampleRate?: number }) {
      contextArgs.push(options);
      this.sampleRate = options?.sampleRate ?? 48_000;
    }
    resume = async () => undefined;
    close = async () => undefined;
    createMediaStreamSource = () => ({ connect: () => undefined });
  }
  vi.stubGlobal('AudioContext', FakeAudioContext);
  let node!: { port: { onmessage: ((event: { data: unknown }) => void) | null } };
  vi.stubGlobal(
    'AudioWorkletNode',
    class {
      port = { onmessage: null as ((event: { data: unknown }) => void) | null };
      constructor() {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        node = this;
      }
      disconnect() {}
    },
  );
  const onLevel = vi.fn();
  const recorder = new ClipRecorder(30, { onLevel, onAutoStop: vi.fn() });
  await recorder.start();
  expect(contextArgs).toEqual([{ sampleRate: 16000 }]);
  // Two 2048-frame blocks, as the worklet posts them.
  for (let i = 0; i < 2; i++) {
    node.port.onmessage?.({
      data: { samples: new Float32Array(2048).fill(0.1), rms: 0.1, peak: 0.1 },
    });
  }
  // Every block reaches the level meter (no extra throttle on top of the block size).
  expect(onLevel).toHaveBeenCalledTimes(2);
  const clip = await recorder.stop();
  expect(clip.durationMs).toBe((4096 / 16000) * 1000);
  expect(clip.wav.byteLength).toBe(44 + 4096 * 2);
  expect(trackStop).toHaveBeenCalled();
});
