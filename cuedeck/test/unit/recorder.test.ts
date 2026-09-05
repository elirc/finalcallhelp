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
