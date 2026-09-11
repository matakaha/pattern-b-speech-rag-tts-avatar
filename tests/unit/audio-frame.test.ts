import { describe, expect, it } from 'vitest';

import { PCM_SAMPLE_RATE, decodeAudioFrame, encodeAudioFrame } from '../../src/shared/src/index.js';

describe('audio frame codec', () => {
  it('round trips little-endian PCM with metadata', () => {
    const encoded = encodeAudioFrame({
      sequence: 42,
      sampleRate: PCM_SAMPLE_RATE,
      samples: new Int16Array([-32_768, -1, 0, 1, 32_767]),
    });

    expect(decodeAudioFrame(encoded)).toEqual({
      sequence: 42,
      sampleRate: PCM_SAMPLE_RATE,
      samples: new Int16Array([-32_768, -1, 0, 1, 32_767]),
    });
  });

  it('rejects a payload that does not match the declared sample count', () => {
    const encoded = encodeAudioFrame({
      sequence: 0,
      sampleRate: PCM_SAMPLE_RATE,
      samples: new Int16Array([100, 200]),
    });
    new DataView(encoded).setUint16(6, 3, true);

    expect(() => decodeAudioFrame(encoded)).toThrow('sample count');
  });
});
