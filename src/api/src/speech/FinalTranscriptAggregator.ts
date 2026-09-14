export type TranscriptCompletionReason = 'speech-end' | 'audio-end' | 'timeout';

export interface TranscriptCompletion {
  text: string | undefined;
  reason: TranscriptCompletionReason;
}

interface FinalTranscriptAggregatorOptions {
  utteranceTimeoutMs: number;
  finalGraceMs: number;
  onComplete: (completion: TranscriptCompletion) => void;
}

export class FinalTranscriptAggregator {
  readonly #resultIds = new Set<string>();
  readonly #segments: string[] = [];
  #utteranceTimer: NodeJS.Timeout | undefined;
  #graceTimer: NodeJS.Timeout | undefined;
  #generation = 0;
  #active = false;
  #speechEnded = false;
  #pendingReason: TranscriptCompletionReason = 'speech-end';

  constructor(private readonly options: FinalTranscriptAggregatorOptions) {}

  start(): void {
    this.cancel();
    this.#active = true;
    const generation = this.#generation;
    this.#utteranceTimer = setTimeout(
      () => this.#complete('timeout', generation),
      this.options.utteranceTimeoutMs,
    );
  }

  addFinal(resultId: string, text: string): void {
    if (!this.#active || this.#resultIds.has(resultId)) return;
    this.#resultIds.add(resultId);

    const normalizedText = text.trim();
    if (normalizedText) this.#segments.push(normalizedText);
    if (this.#speechEnded) this.#scheduleGraceCompletion();
  }

  speechStarted(): void {
    if (!this.#active) return;
    this.#speechEnded = false;
    this.#clearGraceTimer();
  }

  speechEnded(): void {
    if (!this.#active) return;
    this.#speechEnded = true;
    this.#pendingReason = 'speech-end';
    this.#scheduleGraceCompletion();
  }

  audioEnded(): void {
    if (!this.#active) return;
    this.#speechEnded = true;
    this.#pendingReason = 'audio-end';
    this.#scheduleGraceCompletion();
  }

  cancel(): void {
    this.#generation += 1;
    this.#active = false;
    this.#speechEnded = false;
    this.#resultIds.clear();
    this.#segments.length = 0;
    this.#clearTimers();
  }

  #scheduleGraceCompletion(): void {
    this.#clearGraceTimer();
    const generation = this.#generation;
    this.#graceTimer = setTimeout(
      () => this.#complete(this.#pendingReason, generation),
      this.options.finalGraceMs,
    );
  }

  #complete(reason: TranscriptCompletionReason, generation: number): void {
    if (!this.#active || generation !== this.#generation) return;

    const text = this.#segments.join(' ').trim() || undefined;
    this.#active = false;
    this.#clearTimers();
    this.options.onComplete({ text, reason });
  }

  #clearTimers(): void {
    if (this.#utteranceTimer) clearTimeout(this.#utteranceTimer);
    this.#utteranceTimer = undefined;
    this.#clearGraceTimer();
  }

  #clearGraceTimer(): void {
    if (this.#graceTimer) clearTimeout(this.#graceTimer);
    this.#graceTimer = undefined;
  }
}
