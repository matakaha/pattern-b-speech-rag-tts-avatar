import type { TurnId } from '@pattern-b/shared';

export interface ActiveTurn {
  turnId: TurnId;
  generation: number;
  signal: AbortSignal;
}

interface PendingTurn {
  turnId: TurnId;
  question: string;
  consumed: boolean;
}

export type TurnStartFailure = 'TURN_NOT_PENDING' | 'TURN_MISMATCH' | 'TURN_ALREADY_CONSUMED';

export class TurnStartError extends Error {
  constructor(readonly code: TurnStartFailure) {
    super(code);
  }
}

export class TurnCoordinator {
  #pending?: PendingTurn;
  #active?: ActiveTurn;
  #controller?: AbortController;
  #generation = 0;
  readonly #interruptionHandlers = new Set<() => void>();

  get generation(): number {
    return this.#generation;
  }

  recordPending(turnId: TurnId, question: string): void {
    this.invalidate();
    this.#pending = { turnId, question: normalizeQuestion(question), consumed: false };
  }

  start(turnId: TurnId, question: string): ActiveTurn {
    if (!this.#pending) throw new TurnStartError('TURN_NOT_PENDING');
    if (this.#pending.turnId !== turnId || this.#pending.question !== normalizeQuestion(question)) {
      throw new TurnStartError('TURN_MISMATCH');
    }
    if (this.#pending.consumed) throw new TurnStartError('TURN_ALREADY_CONSUMED');

    this.#pending.consumed = true;
    this.#controller = new AbortController();
    this.#active = {
      turnId,
      generation: this.#generation,
      signal: this.#controller.signal,
    };
    return this.#active;
  }

  isCurrent(turn: Pick<ActiveTurn, 'turnId' | 'generation'>): boolean {
    return (
      this.#active?.turnId === turn.turnId &&
      this.#active.generation === turn.generation &&
      !this.#active.signal.aborted
    );
  }

  complete(turn: Pick<ActiveTurn, 'turnId' | 'generation'>): void {
    if (!this.isCurrent(turn)) return;
    this.#active = undefined;
    this.#controller = undefined;
  }

  onInterrupt(handler: () => void): () => void {
    this.#interruptionHandlers.add(handler);
    return () => this.#interruptionHandlers.delete(handler);
  }

  cancelActive(): void {
    this.#controller?.abort();
    this.#active = undefined;
    this.#controller = undefined;
  }

  invalidate(): void {
    this.cancelActive();
    this.#generation += 1;
    this.#pending = undefined;
    for (const handler of this.#interruptionHandlers) handler();
  }
}

function normalizeQuestion(question: string): string {
  return question.trim().replace(/\s+/gu, ' ');
}
