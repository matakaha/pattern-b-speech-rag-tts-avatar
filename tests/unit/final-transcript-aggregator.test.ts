import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FinalTranscriptAggregator,
  type TranscriptCompletion,
} from '../../src/api/src/speech/FinalTranscriptAggregator.js';

describe('FinalTranscriptAggregator', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function createAggregator(onComplete: (completion: TranscriptCompletion) => void) {
    return new FinalTranscriptAggregator({
      utteranceTimeoutMs: 10_000,
      finalGraceMs: 500,
      onComplete,
    });
  }

  it('combines unique non-empty final results after the speech-end grace period', () => {
    const onComplete = vi.fn();
    const aggregator = createAggregator(onComplete);

    aggregator.start();
    aggregator.addFinal('result-1', '  こんにちは ');
    aggregator.addFinal('result-1', 'duplicate');
    aggregator.speechEnded();
    aggregator.addFinal('result-2', '世界です。');
    vi.advanceTimersByTime(499);
    expect(onComplete).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onComplete).toHaveBeenCalledWith({
      text: 'こんにちは 世界です。',
      reason: 'speech-end',
    });
  });

  it('accepts a final result during the audio-end grace period', () => {
    const onComplete = vi.fn();
    const aggregator = createAggregator(onComplete);

    aggregator.start();
    aggregator.audioEnded();
    aggregator.addFinal('result-1', '質問です。');
    vi.advanceTimersByTime(500);

    expect(onComplete).toHaveBeenCalledWith({ text: '質問です。', reason: 'audio-end' });
  });

  it('reports an empty timeout for silence', () => {
    const onComplete = vi.fn();
    const aggregator = createAggregator(onComplete);

    aggregator.start();
    vi.advanceTimersByTime(10_000);

    expect(onComplete).toHaveBeenCalledWith({ text: undefined, reason: 'timeout' });
  });

  it('invalidates stale timers when canceled or restarted', () => {
    const onComplete = vi.fn();
    const aggregator = createAggregator(onComplete);

    aggregator.start();
    aggregator.speechEnded();
    aggregator.cancel();
    aggregator.start();
    vi.advanceTimersByTime(500);

    expect(onComplete).not.toHaveBeenCalled();
  });
});
