import { SessionIdSchema, TurnIdSchema } from '@pattern-b/shared';
import { describe, expect, it, vi } from 'vitest';

import { SynthesisQueue, type SentenceSink } from '../../src/api/src/rag/SynthesisQueue.js';
import { TurnCoordinator } from '../../src/api/src/rag/TurnCoordinator.js';

describe('SynthesisQueue', () => {
  it('aborts active synthesis and drops queued sentences on interruption', async () => {
    const sessionId = SessionIdSchema.parse('11111111-1111-4111-8111-111111111111');
    const turnId = TurnIdSchema.parse('22222222-2222-4222-8222-222222222222');
    const coordinator = new TurnCoordinator();
    coordinator.recordPending(turnId, 'question');
    const turn = coordinator.start(turnId, 'question');
    let releaseActive: (() => void) | undefined;
    const sink: SentenceSink = {
      process: vi.fn(
        (item) =>
          new Promise<void>((resolve) => {
            releaseActive = resolve;
            item.signal.addEventListener('abort', resolve, { once: true });
          }),
      ),
    };
    const queue = new SynthesisQueue(coordinator, sink, 3);

    const active = queue.enqueue(sessionId, turn, 1, 'first');
    const queued = queue.enqueue(sessionId, turn, 2, 'second');
    await vi.waitFor(() => expect(sink.process).toHaveBeenCalledOnce());

    coordinator.invalidate();
    await Promise.all([active, queued]);

    expect(turn.signal.aborted).toBe(true);
    expect(sink.process).toHaveBeenCalledOnce();
    releaseActive?.();
    queue.dispose();
  });
});
