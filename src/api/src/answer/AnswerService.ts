import type { AnswerRequest, AnswerStreamEvent } from '@pattern-b/shared';

import type { ResponseStreamer, ResponseUsage } from '../llm/FoundryResponseStreamer.js';
import { buildGroundedPrompt } from '../rag/PromptBuilder.js';
import { SentenceChunker } from '../rag/SentenceChunker.js';
import {
  SubtitleOnlySentenceSink,
  SynthesisQueue,
  type SentenceSink,
} from '../rag/SynthesisQueue.js';
import type { ActiveTurn, TurnCoordinator } from '../rag/TurnCoordinator.js';
import type { SearchRetriever } from '../search/SearchRetriever.js';

export interface AnswerServiceOptions {
  maxHistoryCharacters: number;
  minSentenceCharacters: number;
  maxSentenceCharacters: number;
  synthesisQueueLimit: number;
  sentenceSink?: SentenceSink;
}

export class AnswerService {
  readonly #sentenceSink: SentenceSink;

  constructor(
    private readonly retriever: SearchRetriever,
    private readonly responseStreamer: ResponseStreamer,
    private readonly options: AnswerServiceOptions,
  ) {
    this.#sentenceSink = options.sentenceSink ?? new SubtitleOnlySentenceSink();
  }

  async run(
    request: AnswerRequest,
    activeTurn: ActiveTurn,
    coordinator: TurnCoordinator,
    emit: (event: AnswerStreamEvent) => Promise<void>,
  ): Promise<void> {
    const startedAt = Date.now();
    const chunks = await this.retriever.retrieve(request.question, activeTurn.signal);
    this.#assertCurrent(activeTurn, coordinator);
    await emit({
      type: 'retrieval',
      sessionId: request.sessionId,
      turnId: request.turnId,
      durationMs: Date.now() - startedAt,
      count: chunks.length,
    });
    for (const chunk of chunks) {
      this.#assertCurrent(activeTurn, coordinator);
      await emit({
        type: 'citation',
        sessionId: request.sessionId,
        turnId: request.turnId,
        citationId: chunk.citationId,
        chunkId: chunk.chunkId,
        title: chunk.title,
        sourceUrl: chunk.sourceUrl,
      });
    }

    const prompt = buildGroundedPrompt(request, chunks, this.options.maxHistoryCharacters);
    const chunker = new SentenceChunker(
      this.options.minSentenceCharacters,
      this.options.maxSentenceCharacters,
    );
    const queue = new SynthesisQueue(
      coordinator,
      this.#sentenceSink,
      this.options.synthesisQueueLimit,
    );
    let sentenceSequence = 0;
    let usage: ResponseUsage | undefined;

    for await (const item of this.responseStreamer.stream(prompt, activeTurn.signal)) {
      this.#assertCurrent(activeTurn, coordinator);
      if (item.type === 'done') {
        usage = item.usage;
        continue;
      }
      await emit({
        type: 'delta',
        sessionId: request.sessionId,
        turnId: request.turnId,
        text: item.text,
      });
      for (const sentence of chunker.push(item.text)) {
        sentenceSequence += 1;
        await this.#emitSentence(request, sentenceSequence, sentence, emit);
        void queue
          .enqueue(request.sessionId, activeTurn, sentenceSequence, sentence)
          .catch(() => undefined);
      }
    }

    for (const sentence of chunker.flush()) {
      sentenceSequence += 1;
      await this.#emitSentence(request, sentenceSequence, sentence, emit);
      void queue
        .enqueue(request.sessionId, activeTurn, sentenceSequence, sentence)
        .catch(() => undefined);
    }
    this.#assertCurrent(activeTurn, coordinator);
    await emit({
      type: 'done',
      sessionId: request.sessionId,
      turnId: request.turnId,
      usage: usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    });
    void queue.drain().finally(() => {
      queue.dispose();
      coordinator.complete(activeTurn);
    });
  }

  async #emitSentence(
    request: AnswerRequest,
    sequence: number,
    text: string,
    emit: (event: AnswerStreamEvent) => Promise<void>,
  ): Promise<void> {
    await emit({
      type: 'sentence',
      sessionId: request.sessionId,
      turnId: request.turnId,
      sequence,
      text,
    });
  }

  #assertCurrent(turn: ActiveTurn, coordinator: TurnCoordinator): void {
    if (!coordinator.isCurrent(turn)) throw new DOMException('Answer canceled.', 'AbortError');
  }
}
