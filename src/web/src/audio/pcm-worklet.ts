interface AudioWorkletProcessorLike {
  readonly port: MessagePort;
}

declare const AudioWorkletProcessor: {
  new (): AudioWorkletProcessorLike;
};
declare function registerProcessor(
  name: string,
  processorCtor: new () => AudioWorkletProcessorLike,
): void;
declare const sampleRate: number;

const TARGET_SAMPLE_RATE = 16_000;
const TARGET_FRAME_SAMPLES = 320;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  #carry = new Float32Array(0);
  #pending = new Int16Array(0);

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]?.[0];
    if (!input?.length) return true;

    const combined = new Float32Array(this.#carry.length + input.length);
    combined.set(this.#carry);
    combined.set(input, this.#carry.length);

    const ratio = sampleRate / TARGET_SAMPLE_RATE;
    const outputLength = Math.floor(combined.length / ratio);
    const output = new Int16Array(outputLength);
    for (let index = 0; index < outputLength; index += 1) {
      const sourcePosition = index * ratio;
      const lowerIndex = Math.floor(sourcePosition);
      const upperIndex = Math.min(lowerIndex + 1, combined.length - 1);
      const fraction = sourcePosition - lowerIndex;
      const interpolated =
        (combined[lowerIndex] ?? 0) * (1 - fraction) + (combined[upperIndex] ?? 0) * fraction;
      const clamped = Math.max(-1, Math.min(1, interpolated));
      output[index] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    }

    const consumed = Math.floor(outputLength * ratio);
    this.#carry = combined.slice(consumed);
    if (output.length) this.#appendOutput(output);
    return true;
  }

  #appendOutput(output: Int16Array): void {
    const pending = new Int16Array(this.#pending.length + output.length);
    pending.set(this.#pending);
    pending.set(output, this.#pending.length);

    let offset = 0;
    while (offset + TARGET_FRAME_SAMPLES <= pending.length) {
      const frame = pending.slice(offset, offset + TARGET_FRAME_SAMPLES);
      this.port.postMessage(frame, [frame.buffer]);
      offset += TARGET_FRAME_SAMPLES;
    }
    this.#pending = pending.slice(offset);
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);
