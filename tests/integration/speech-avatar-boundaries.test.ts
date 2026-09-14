import type { TokenCredential } from '@azure/core-auth';
import {
  PCM_SAMPLE_RATE,
  SessionIdSchema,
  encodeAudioFrame,
  type ServerEvent,
} from '@pattern-b/shared';
import { describe, expect, it, vi } from 'vitest';

import { AvatarSession } from '../../src/api/src/avatar/AvatarSession.js';
import type {
  AvatarConnector,
  AvatarTransport,
} from '../../src/api/src/avatar/AvatarSpeechAdapter.js';
import {
  SpeechRecognizerSession,
  type SpeechClient,
  type SpeechRecognizerSessionOptions,
} from '../../src/api/src/speech/SpeechRecognizerSession.js';

const sessionId = SessionIdSchema.parse('11111111-1111-4111-8111-111111111111');

describe('Speech and Avatar adapter boundaries', () => {
  it('passes browser PCM to Speech and publishes the aggregated final transcript', async () => {
    vi.useFakeTimers();
    const events: ServerEvent[] = [];
    let handlers:
      | Parameters<NonNullable<SpeechRecognizerSessionOptions['createClient']>>[0]
      | null = null;
    const client: SpeechClient = {
      start: vi.fn(async () => undefined),
      write: vi.fn(),
      endAudio: vi.fn(),
      stop: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    const speech = new SpeechRecognizerSession({
      sessionId,
      endpoint: 'https://speech.example.com',
      credential: {} as TokenCredential,
      recognitionLanguage: 'ja-JP',
      phrases: [],
      utteranceTimeoutMs: 10_000,
      finalGraceMs: 100,
      sendEvent: (event) => events.push(event),
      createClient: (createdHandlers) => {
        handlers = createdHandlers;
        return client;
      },
    });

    await speech.start();
    speech.write(
      encodeAudioFrame({
        sequence: 0,
        sampleRate: PCM_SAMPLE_RATE,
        samples: new Int16Array([100, -100]),
      }),
    );
    const speechHandlers = handlers!;
    speechHandlers.onSpeechStarted();
    speechHandlers.onRecognized('result-1', '配送状況を');
    speechHandlers.onSpeechEnded();
    speechHandlers.onRecognized('result-2', '確認したいです。');
    await vi.advanceTimersByTimeAsync(100);

    expect(client.write).toHaveBeenCalledOnce();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'stt.recognized',
        text: '配送状況を 確認したいです。',
      }),
    );
    vi.useRealTimers();
  });

  it('uses relay credentials to exchange an Avatar offer for an answer', async () => {
    const transport: AvatarTransport = {
      speak: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    const connector: AvatarConnector = {
      connect: vi.fn(async () => ({
        answer: { type: 'answer' as const, sdp: 'answer-sdp' },
        transport,
      })),
    };
    const relayProvider = {
      getIceServers: vi.fn(async () => [
        {
          urls: ['turn:relay.example.com:3478'],
          username: 'relay-user',
          credential: 'relay-credential',
        },
      ]),
    };
    const avatar = new AvatarSession({
      sessionId,
      relayProvider,
      connector,
      idleTimeoutMs: 1_000,
      maxConnectionMs: 10_000,
      clientConfig: {
        iceGatheringTimeoutMs: 1_000,
        videoStallTimeoutMs: 1_000,
        reconnectMaxAttempts: 3,
        reconnectBaseDelayMs: 100,
      },
      sendEvent: vi.fn(),
    });

    const prepared = await avatar.prepare();
    const connected = await avatar.connect(prepared.connectionId, {
      type: 'offer',
      sdp: 'offer-sdp',
    });

    expect(relayProvider.getIceServers).toHaveBeenCalledOnce();
    expect(connector.connect).toHaveBeenCalledWith(
      { type: 'offer', sdp: 'offer-sdp' },
      prepared.iceServers[0],
      expect.any(Function),
      undefined,
    );
    expect(connected.answer).toEqual({ type: 'answer', sdp: 'answer-sdp' });
    expect(avatar.state).toBe('ready');
    await avatar.dispose();
  });
});
