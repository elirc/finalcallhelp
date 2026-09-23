/**
 * CueDeck capture worklet. Downmixes each 128-frame render quantum to mono,
 * accumulates the frames into a 2048-frame block (128 ms at the recorder's
 * 16 kHz context) and posts each full block to the main thread with its
 * RMS/peak level: about 8 posts per second instead of one per quantum
 * (~125/s at 16 kHz, ~375/s at 48 kHz). Runs on the audio rendering thread
 * (CAP-07: AudioWorklet, not ScriptProcessorNode).
 *
 * A partial trailing block is not flushed: the recorder stops on demand by
 * disconnecting this node, so at most the last <128 ms of a clip is dropped,
 * which is inaudible for a spoken question.
 */
const BLOCK_FRAMES = 2048;

class CueDeckCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // Reused accumulation buffer; each post sends a copy.
    this.block = new Float32Array(BLOCK_FRAMES);
    this.filled = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0 && input[0].length > 0) {
      const channels = input.length;
      const frames = input[0].length;
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) sum += input[c][i];
        this.block[this.filled++] = sum / channels;
        if (this.filled === BLOCK_FRAMES) this.flush();
      }
    }
    return true;
  }

  flush() {
    const samples = this.block.slice(0, this.filled);
    this.filled = 0;
    let sumSquares = 0;
    let peak = 0;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      sumSquares += s * s;
      const abs = s < 0 ? -s : s;
      if (abs > peak) peak = abs;
    }
    this.port.postMessage({ samples, rms: Math.sqrt(sumSquares / samples.length), peak }, [
      samples.buffer,
    ]);
  }
}

registerProcessor('cuedeck-capture', CueDeckCaptureProcessor);
