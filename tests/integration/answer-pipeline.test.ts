import {
  SessionIdSchema,
  TurnIdSchema,
  type AnswerRequest,
  type AnswerStreamEvent,
} from '@pattern-b/shared';
import { describe, expect, it, vi } from 'vitest';

import { AnswerService } from '../../src/api/src/answer/AnswerService.js';
import type {
  GroundedPrompt,
  ResponseStreamer,
} from '../../src/api/src/llm/FoundryResponseStreamer.js';
import type { SentenceSink } from '../../src/api/src/rag/SynthesisQueue.js';
import { TurnCoordinator } from '../../src/api/src/rag/TurnCoordinator.js';
import type { SearchRetriever } from '../../src/api/src/search/SearchRetriever.js';

const request: AnswerRequest = {
  sessionId: SessionIdSchema.parse('11111111-1111-4111-8111-111111111111'),
  turnId: TurnIdSchema.parse('22222222-2222-4222-8222-222222222222'),
  question: '荷物の送り方を教えてください。',
  history: [],
};

function createCoordinator() {
  const coordinator = new TurnCoordinator();
  coordinator.recordPending(request.turnId, request.question);
  return coordinator;
}

describe('answer pipeline integration', () => {
  it('streams a grounded Search result through sentence synthesis', async () => {
    const retriever = {
      retrieve: vi.fn(async () => [
        {
          citationId: 'C1',
          chunkId: 'RDE-FAQ-002',
          title: '荷物を発送する手順を教えてください',
          content: '荷物を梱包し、送り状を記入します。',
          sourceUrl:
            'https://github.com/matakaha/rubberduckexpress/blob/main/faq/01-shipping/RDE-FAQ-002-how-to-ship.md',
        },
      ]),
    } as unknown as SearchRetriever;
    let receivedPrompt: GroundedPrompt | undefined;
    const responseStreamer: ResponseStreamer = {
      async *stream(prompt) {
        receivedPrompt = prompt;
        yield { type: 'delta', text: '荷物を梱包して' };
        yield { type: 'delta', text: '送り状を記入します。' };
        yield {
          type: 'done',
          usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
        };
      },
    };
    const sentenceSink: SentenceSink = { process: vi.fn(async () => undefined) };
    const service = new AnswerService(retriever, responseStreamer, {
      maxHistoryCharacters: 1_000,
      minSentenceCharacters: 1,
      maxSentenceCharacters: 100,
      synthesisQueueLimit: 5,
      sentenceSink,
    });
    const coordinator = createCoordinator();
    const activeTurn = coordinator.start(request.turnId, request.question);
    const events: AnswerStreamEvent[] = [];

    await service.run(request, activeTurn, coordinator, async (event) => events.push(event));
    await vi.waitFor(() => expect(sentenceSink.process).toHaveBeenCalledOnce());

    expect(receivedPrompt?.input).toContain('<source id="C1"');
    expect(events.map(({ type }) => type)).toEqual([
      'retrieval',
      'citation',
      'delta',
      'delta',
      'sentence',
      'done',
    ]);
    expect(events[1]).toMatchObject({
      type: 'citation',
      chunkId: 'RDE-FAQ-002',
    });
    expect(sentenceSink.process).toHaveBeenCalledWith(
      expect.objectContaining({ text: '荷物を梱包して送り状を記入します。' }),
    );
  });

  it('stops late model output after the turn is invalidated', async () => {
    const retriever = { retrieve: vi.fn(async () => []) } as unknown as SearchRetriever;
    const responseStreamer: ResponseStreamer = {
      async *stream(_prompt, signal) {
        yield { type: 'delta', text: '処理中' };
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Answer canceled.', 'AbortError')),
            { once: true },
          );
        });
      },
    };
    const service = new AnswerService(retriever, responseStreamer, {
      maxHistoryCharacters: 1_000,
      minSentenceCharacters: 1,
      maxSentenceCharacters: 100,
      synthesisQueueLimit: 5,
    });
    const coordinator = createCoordinator();
    const activeTurn = coordinator.start(request.turnId, request.question);
    const events: AnswerStreamEvent[] = [];
    const operation = service.run(request, activeTurn, coordinator, async (event) => {
      events.push(event);
    });

    await vi.waitFor(() => expect(events.some(({ type }) => type === 'delta')).toBe(true));
    coordinator.invalidate();

    await expect(operation).rejects.toMatchObject({ name: 'AbortError' });
    expect(events.some(({ type }) => type === 'done')).toBe(false);
  });
});
