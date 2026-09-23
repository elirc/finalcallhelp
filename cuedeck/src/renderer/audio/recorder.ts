import { encodeWav, resample } from '../../shared/audio';
import { TARGET_SAMPLE_RATE } from '../../shared/constants';

/** Minimum gap between level callbacks; 0 = one per worklet block. */
const LEVEL_POST_MIN_MS = 0;

export interface RecorderCallbacks {
  onLevel: (rms: number, peak: number, elapsedMs: number) => void;
  onAutoStop: () => void;
}

export interface EncodedClip {
  wav: ArrayBuffer;
  encodeMs: number;
  durationMs: number;
}

/**
 * System-audio recorder (CAP-01..CAP-09). Capture starts only after the
 * caller has armed a one-use grant and the user pressed Listen. The
 * display-media video track Electron requires on Windows is stopped
 * immediately; only audio is retained, and all sample buffers are released
 * after `stop()` encodes the WAV.
 */
export class ClipRecorder {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private worklet: AudioWorkletNode | null = null;
  private chunks: Float32Array[] = [];
  private startedAt = 0;
  private sampleRate = 48_000;
  private lastLevelPost = 0;
  private stopped = false;

  constructor(
    private readonly maxSeconds: number,
    private readonly callbacks: RecorderCallbacks,
  ) {}

  async start(): Promise<void> {
    const ensureActive = () => {
      if (this.stopped) throw new DOMException('Recording cancelled', 'AbortError');
    };
    ensureActive();
    // The armed grant in the main process supplies the source; this request
    // never shows a picker and fails closed when unarmed (CAPTURE_DENIED).
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    if (this.stopped) {
      stream.getTracks().forEach((track) => track.stop());
      ensureActive();
    }
    for (const track of stream.getVideoTracks()) track.stop();
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      for (const track of stream.getTracks()) track.stop();
      throw new Error('CAPTURE_NO_AUDIO');
    }
    this.stream = new MediaStream(audioTracks);
    // Chromium resamples the capture stream to 16 kHz with a proper
    // anti-aliasing filter, so the clip needs no resampling of its own.
    this.context = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
    this.sampleRate = this.context.sampleRate;
    await this.context.audioWorklet.addModule('./audio-capture-worklet.js');
    ensureActive();
    await this.context.resume();
    ensureActive();
    const source = this.context.createMediaStreamSource(this.stream);
    this.worklet = new AudioWorkletNode(this.context, 'cuedeck-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 0,
    });
    this.worklet.port.onmessage = (event: MessageEvent) => {
      if (this.stopped) return;
      const { samples, rms, peak } = event.data as {
        samples: Float32Array;
        rms: number;
        peak: number;
      };
      this.chunks.push(samples);
      const now = performance.now();
      const elapsedMs = now - this.startedAt;
      // The worklet posts one 2048-frame block (128 ms at 16 kHz), so every
      // block updates the meter: ~8 Hz (spec §18 asks for about 15 Hz; the
      // block size trades that for ~8 posts/s instead of ~375).
      if (now - this.lastLevelPost >= LEVEL_POST_MIN_MS) {
        this.lastLevelPost = now;
        this.callbacks.onLevel(rms, peak, elapsedMs);
      }
      if (elapsedMs >= this.maxSeconds * 1000) {
        this.callbacks.onAutoStop();
      }
    };
    source.connect(this.worklet);
    this.startedAt = performance.now();
  }

  /** Stop capture and encode the collected audio as 16 kHz mono WAV. */
  async stop(): Promise<EncodedClip> {
    const encodeStart = performance.now();
    await this.teardown();
    const totalFrames = this.chunks.reduce((sum, c) => sum + c.length, 0);
    const merged = new Float32Array(totalFrames);
    let offset = 0;
    for (const chunk of this.chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    this.chunks = []; // release capture buffers (CAP-09)
    // A no-op when the context honoured the 16 kHz request; kept as a
    // safety net for a device that forces another rate.
    const resampled = resample(merged, this.sampleRate, TARGET_SAMPLE_RATE);
    const wav = encodeWav(resampled, TARGET_SAMPLE_RATE);
    const buffer = wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer;
    return {
      wav: buffer,
      encodeMs: Math.round(performance.now() - encodeStart),
      durationMs: (resampled.length / TARGET_SAMPLE_RATE) * 1000,
    };
  }

  /** Discard everything without producing a clip (CAP-05). */
  async abort(): Promise<void> {
    await this.teardown();
    this.chunks = [];
  }

  private async teardown(): Promise<void> {
    this.stopped = true;
    if (this.worklet) {
      this.worklet.port.onmessage = null;
      this.worklet.disconnect();
      this.worklet = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    if (this.context) {
      await this.context.close().catch(() => undefined);
      this.context = null;
    }
  }
}
