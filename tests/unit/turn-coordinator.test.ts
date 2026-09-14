import { randomUUID } from 'node:crypto';

import { TurnIdSchema } from '@pattern-b/shared';
import { describe, expect, it } from 'vitest';

import { TurnCoordinator, TurnStartError } from '../../src/api/src/rag/TurnCoordinator.js';

describe('TurnCoordinator', () => {
  it('accepts a pending turn exactly once', () => {
    const coordinator = new TurnCoordinator();
    const turnId = TurnIdSchema.parse(randomUUID());
    coordinator.recordPending(turnId, '  質問 です  ');

    const active = coordinator.start(turnId, '質問 です');

    expect(coordinator.isCurrent(active)).toBe(true);
    expect(() => coordinator.start(turnId, '質問 です')).toThrow(TurnStartError);
  });

  it('aborts and rejects an older generation', () => {
    const coordinator = new TurnCoordinator();
    const firstId = TurnIdSchema.parse(randomUUID());
    const secondId = TurnIdSchema.parse(randomUUID());
    coordinator.recordPending(firstId, 'first');
    const first = coordinator.start(firstId, 'first');

    coordinator.recordPending(secondId, 'second');

    expect(first.signal.aborted).toBe(true);
    expect(coordinator.isCurrent(first)).toBe(false);
    expect(coordinator.isCurrent(coordinator.start(secondId, 'second'))).toBe(true);
  });

  it('advances the public generation when invalidated', () => {
    const coordinator = new TurnCoordinator();

    expect(coordinator.generation).toBe(0);
    coordinator.invalidate();
    expect(coordinator.generation).toBe(1);
  });

  it('notifies interruption subscribers with the advanced generation', () => {
    const coordinator = new TurnCoordinator();
    const generations: number[] = [];
    const unsubscribe = coordinator.onInterrupt(() => generations.push(coordinator.generation));

    coordinator.invalidate();
    unsubscribe();
    coordinator.invalidate();

    expect(generations).toEqual([1]);
  });
});
