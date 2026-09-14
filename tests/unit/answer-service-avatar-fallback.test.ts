import {
  SessionIdSchema,
  TurnIdSchema,
  type AnswerRequest,
  type AnswerStreamEvent,
} from '@pattern-b/shared';
import { describe, expect, it, vi } from 'vitest';

import { AnswerService } from '../../src/api/src/answer/AnswerService.js';
import type { ResponseStreamer } from '../../src/api/src/llm/FoundryResponseStreamer.js';
import type { SentenceSink } from '../../src/api/src/rag/SynthesisQueue.js';
import { TurnCoordinator } from '../../src/api/src/rag/TurnCoordinator.js';
import type { SearchRetriever } from '../../src/api/src/search/SearchRetriever.js';

describe('AnswerService avatar fallback', () => {
  it('finishes subtitle streaming without waiting for failed avatar synthesis', async () => {
    const retriever = {
      retrieve: vi.fn(async () => []),
    } as unknown as SearchRetriever;
    const responseStreamer: ResponseStreamer = {
      async *stream() {
        yield { type: 'delta' as const, text: '回答です。' };
        yield {
          type: 'done' as const,
          usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
        };
      },
    };
    const sentenceSink: SentenceSink = {
      process: vi.fn(async () => {
        throw new Error('Avatar synthesis failed.');
      }),
    };
    const service = new AnswerService(retriever, responseStreamer, {
      maxHistoryCharacters: 1_000,
      minSentenceCharacters: 1,
      maxSentenceCharacters: 100,
      synthesisQueueLimit: 5,
      sentenceSink,
    });
    const request: AnswerRequest = {
      sessionId: SessionIdSchema.parse('11111111-1111-4111-8111-111111111111'),
      turnId: TurnIdSchema.parse('22222222-2222-4222-8222-222222222222'),
      question: '質問です。',
      history: [],
    };
    const coordinator = new TurnCoordinator();
    coordinator.recordPending(request.turnId, request.question);
    const activeTurn = coordinator.start(request.turnId, request.question);
    const events: AnswerStreamEvent[] = [];

    await expect(
      service.run(request, activeTurn, coordinator, async (event) => {
        events.push(event);
      }),
    ).resolves.toBeUndefined();

    expect(events.map((event) => event.type)).toEqual(['retrieval', 'delta', 'sentence', 'done']);
    expect(sentenceSink.process).toHaveBeenCalledWith(
      expect.objectContaining({ text: '回答です。', sequence: 1 }),
    );
  });
});
