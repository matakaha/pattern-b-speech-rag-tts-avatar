import type { SessionId, TurnId } from '@pattern-b/shared';

import type { AvatarSession } from '../avatar/AvatarSession.js';
import type { ActiveTurn, TurnCoordinator } from './TurnCoordinator.js';

export interface SentenceItem {
  sessionId: SessionId;
  turnId: TurnId;
  generation: number;
  sequence: number;
  text: string;
  signal: AbortSignal;
}

export interface SentenceSink {
  process(item: SentenceItem): Promise<void>;
}

export class SynthesisQueue {
  #tail = Promise.resolve();
  #queued = 0;
  #epoch = 0;
  #controller = new AbortController();
  readonly #unsubscribe: () => void;

  constructor(
    private readonly coordinator: TurnCoordinator,
    private readonly sink: SentenceSink,
    private readonly limit: number,
  ) {
    this.#unsubscribe = coordinator.onInterrupt(() => this.clear());
  }

  enqueue(sessionId: SessionId, turn: ActiveTurn, sequence: number, text: string): Promise<void> {
    if (!this.coordinator.isCurrent(turn)) return Promise.resolve();
    if (this.#queued >= this.limit) throw new Error('Synthesis queue capacity reached.');
    this.#queued += 1;
    const epoch = this.#epoch;

    const item: SentenceItem = {
      sessionId,
      turnId: turn.turnId,
      generation: turn.generation,
      sequence,
      text,
      signal: AbortSignal.any([turn.signal, this.#controller.signal]),
    };
    const operation = this.#tail.then(async () => {
      if (epoch !== this.#epoch || !this.coordinator.isCurrent(turn)) return;
      await this.sink.process(item);
      if (epoch !== this.#epoch || !this.coordinator.isCurrent(turn)) return;
    });
    this.#tail = operation
      .catch(() => undefined)
      .finally(() => {
        this.#queued -= 1;
      });
    return operation;
  }

  async drain(): Promise<void> {
    await this.#tail;
  }

  clear(): void {
    this.#epoch += 1;
    this.#controller.abort();
    this.#controller = new AbortController();
  }

  dispose(): void {
    this.clear();
    this.#unsubscribe();
  }
}

export class SubtitleOnlySentenceSink implements SentenceSink {
  async process(_item: SentenceItem): Promise<void> {}
}

export class AvatarSentenceSink implements SentenceSink {
  constructor(private readonly getAvatar: (sessionId: SessionId) => AvatarSession | undefined) {}

  async process(item: SentenceItem): Promise<void> {
    if (item.signal.aborted) return;
    await this.getAvatar(item.sessionId)?.speak(item.text, item.signal);
  }
}
