import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  PCM_SAMPLE_RATE,
  SessionIdSchema,
  encodeAudioFrame,
  type ServerEvent,
} from '../../src/shared/src/index.js';
import { MockAudioSession } from '../../src/api/src/speech/MockAudioSession.js';

describe('MockAudioSession', () => {
  it('emits a final mock transcript for active audio', () => {
    const events: ServerEvent[] = [];
    const session = new MockAudioSession(SessionIdSchema.parse(randomUUID()), (event) =>
      events.push(event),
    );
    session.start();
    session.write(
      encodeAudioFrame({
        sequence: 0,
        sampleRate: PCM_SAMPLE_RATE,
        samples: new Int16Array([0, 500, -500]),
      }),
    );
    session.end();

    expect(events.map((event) => event.type)).toEqual([
      'turn.state',
      'stt.recognized',
      'turn.state',
    ]);
    expect(events[1]).toMatchObject({ type: 'stt.recognized', text: '音声入力を受信しました。' });
  });

  it('rejects an out-of-order frame', () => {
    const session = new MockAudioSession(SessionIdSchema.parse(randomUUID()), () => undefined);
    session.start();

    expect(() =>
      session.write(
        encodeAudioFrame({
          sequence: 1,
          sampleRate: PCM_SAMPLE_RATE,
          samples: new Int16Array([500]),
        }),
      ),
    ).toThrow('sequence mismatch');
  });
});
