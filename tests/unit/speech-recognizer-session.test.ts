import { randomUUID } from 'node:crypto';

import type { TokenCredential } from '@azure/core-auth';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PCM_SAMPLE_RATE,
  SessionIdSchema,
  encodeAudioFrame,
  type ServerEvent,
} from '../../src/shared/src/index.js';
import {
  SpeechRecognizerSession,
  type SpeechClient,
  type SpeechRecognizerSessionOptions,
} from '../../src/api/src/speech/SpeechRecognizerSession.js';

type SpeechClientHandlers = Parameters<
  NonNullable<SpeechRecognizerSessionOptions['createClient']>
>[0];

afterEach(() => vi.useRealTimers());

function createSession() {
  const events: ServerEvent[] = [];
  let handlers: SpeechClientHandlers | undefined;
  const client: SpeechClient = {
    start: vi.fn(async () => undefined),
    write: vi.fn(),
    endAudio: vi.fn(),
    stop: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
  const session = new SpeechRecognizerSession({
    sessionId: SessionIdSchema.parse(randomUUID()),
    endpoint: 'https://speech.example.com',
    credential: {} as TokenCredential,
    recognitionLanguage: 'ja-JP',
    phrases: [],
    utteranceTimeoutMs: 10_000,
    finalGraceMs: 500,
    sendEvent: (event) => events.push(event),
    createClient: (createdHandlers) => {
      handlers = createdHandlers;
      return client;
    },
  });

  return { session, client, events, getHandlers: () => handlers! };
}

describe('SpeechRecognizerSession', () => {
  it('streams PCM and emits one aggregated transcript', async () => {
    vi.useFakeTimers();
    const { session, client, events, getHandlers } = createSession();
    await session.start();
    session.write(
      encodeAudioFrame({
        sequence: 0,
        sampleRate: PCM_SAMPLE_RATE,
        samples: new Int16Array([100, -100]),
      }),
    );

    const handlers = getHandlers();
    handlers.onSpeechStarted();
    handlers.onRecognized('one', '最初の');
    handlers.onSpeechEnded();
    handlers.onRecognized('two', '質問です。');
    await vi.advanceTimersByTimeAsync(500);

    expect(client.write).toHaveBeenCalledOnce();
    expect(events.map((event) => event.type)).toEqual([
      'turn.state',
      'speech.started',
      'speech.ended',
      'stt.recognized',
      'turn.state',
    ]);
    expect(events[3]).toMatchObject({ type: 'stt.recognized', text: '最初の 質問です。' });
    expect(client.stop).toHaveBeenCalledOnce();
    expect(client.close).toHaveBeenCalledOnce();
  });

  it('uses sessionStopped as a deduplicated speech end signal', async () => {
    vi.useFakeTimers();
    const { session, events, getHandlers } = createSession();
    await session.start();

    getHandlers().onSpeechEnded();
    getHandlers().onSessionStopped();

    expect(events.filter((event) => event.type === 'speech.ended')).toHaveLength(1);
  });

  it('rejects an out-of-order audio frame', async () => {
    const { session } = createSession();
    await session.start();

    expect(() =>
      session.write(
        encodeAudioFrame({
          sequence: 1,
          sampleRate: PCM_SAMPLE_RATE,
          samples: new Int16Array([100]),
        }),
      ),
    ).toThrow('sequence mismatch');
  });

  it('closes the recognizer exactly once', async () => {
    const { session, client } = createSession();
    await session.start();

    await Promise.all([session.close(), session.close()]);

    expect(client.stop).toHaveBeenCalledOnce();
    expect(client.close).toHaveBeenCalledOnce();
  });
});
