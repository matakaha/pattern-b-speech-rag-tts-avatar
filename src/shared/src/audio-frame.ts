export const AUDIO_FRAME_HEADER_BYTES = 8;
export const PCM_SAMPLE_RATE = 16_000;

export interface AudioFrame {
  sequence: number;
  sampleRate: number;
  samples: Int16Array;
}

export function encodeAudioFrame(frame: AudioFrame): ArrayBuffer {
  const buffer = new ArrayBuffer(AUDIO_FRAME_HEADER_BYTES + frame.samples.byteLength);
  const view = new DataView(buffer);
  view.setUint32(0, frame.sequence, true);
  view.setUint16(4, frame.sampleRate, true);
  view.setUint16(6, frame.samples.length, true);
  new Int16Array(buffer, AUDIO_FRAME_HEADER_BYTES).set(frame.samples);
  return buffer;
}

export function decodeAudioFrame(buffer: ArrayBuffer): AudioFrame {
  if (buffer.byteLength < AUDIO_FRAME_HEADER_BYTES || buffer.byteLength % 2 !== 0) {
    throw new Error('Invalid audio frame length.');
  }

  const view = new DataView(buffer);
  const sampleCount = view.getUint16(6, true);
  const expectedLength = AUDIO_FRAME_HEADER_BYTES + sampleCount * Int16Array.BYTES_PER_ELEMENT;
  if (buffer.byteLength !== expectedLength) {
    throw new Error('Audio frame sample count does not match its payload.');
  }

  return {
    sequence: view.getUint32(0, true),
    sampleRate: view.getUint16(4, true),
    samples: new Int16Array(buffer.slice(AUDIO_FRAME_HEADER_BYTES)),
  };
}
