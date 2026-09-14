import {
  AvatarConnectionIdSchema,
  SessionIdSchema,
  type AvatarIceServer,
  type ServerEvent,
} from '@pattern-b/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AvatarSession } from '../../src/api/src/avatar/AvatarSession.js';
import type {
  AvatarConnector,
  AvatarTransport,
} from '../../src/api/src/avatar/AvatarSpeechAdapter.js';

const iceServer: AvatarIceServer = {
  urls: ['turn:relay.example.com:3478'],
  username: 'user',
  credential: 'password',
};

function createHarness(speak = vi.fn(async () => undefined)) {
  const transport: AvatarTransport = {
    speak,
    stop: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
  const connector: AvatarConnector = {
    connect: vi.fn(async () => ({
      answer: { type: 'answer' as const, sdp: 'answer-sdp' },
      transport,
    })),
  };
  const events: ServerEvent[] = [];
  const session = new AvatarSession({
    sessionId: SessionIdSchema.parse('11111111-1111-4111-8111-111111111111'),
    relayProvider: { getIceServers: vi.fn(async () => [iceServer]) },
    connector,
    idleTimeoutMs: 1_000,
    maxConnectionMs: 10_000,
    clientConfig: {
      iceGatheringTimeoutMs: 1_000,
      videoStallTimeoutMs: 1_000,
      reconnectMaxAttempts: 3,
      reconnectBaseDelayMs: 100,
    },
    sendEvent: (event) => events.push(event),
  });
  return { session, connector, transport, events };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('AvatarSession', () => {
  it('rejects an offer for a stale connection', async () => {
    const { session, connector } = createHarness();
    await session.prepare();

    await expect(
      session.connect(AvatarConnectionIdSchema.parse('22222222-2222-4222-8222-222222222222'), {
        type: 'offer',
        sdp: 'offer-sdp',
      }),
    ).rejects.toThrow('stale');
    expect(connector.connect).not.toHaveBeenCalled();
    await session.dispose();
  });

  it('closes an idle transport without requesting an automatic reconnect', async () => {
    vi.useFakeTimers();
    const { session, transport, events } = createHarness();
    const prepared = await session.prepare();
    await session.connect(prepared.connectionId, { type: 'offer', sdp: 'offer-sdp' });

    await vi.advanceTimersByTimeAsync(1_001);

    expect(transport.close).toHaveBeenCalledOnce();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'avatar.disconnected',
        reason: 'idle',
        reconnectable: false,
      }),
    );
    expect(session.state).toBe('idle');
    await session.dispose();
  });

  it('degrades to subtitles when synthesis fails', async () => {
    const speak = vi.fn(async () => {
      throw new Error('synthesis failed');
    });
    const { session, events } = createHarness(speak);
    const prepared = await session.prepare();
    await session.connect(prepared.connectionId, { type: 'offer', sdp: 'offer-sdp' });

    await expect(session.speak('回答です。')).resolves.toBe('skipped');
    await vi.waitFor(() => expect(session.state).toBe('fallback'));
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'avatar.fallback',
        code: 'AVATAR_SYNTHESIS_FAILED',
        reconnectable: true,
      }),
    );
    await session.dispose();
  });

  it('stops active synthesis without fallback when the turn is aborted', async () => {
    const speak = vi.fn(
      (_text: string, signal?: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => reject(new DOMException('canceled', 'AbortError')),
            { once: true },
          );
        }),
    );
    const { session, transport, events } = createHarness(speak);
    const prepared = await session.prepare();
    await session.connect(prepared.connectionId, { type: 'offer', sdp: 'offer-sdp' });
    const controller = new AbortController();

    const result = session.speak('回答です。', controller.signal);
    controller.abort();

    await expect(result).resolves.toBe('skipped');
    expect(transport.stop).toHaveBeenCalledOnce();
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'avatar.fallback' }));
    expect(session.state).toBe('ready');
    await session.dispose();
  });
});
