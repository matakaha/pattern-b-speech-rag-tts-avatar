import { describe, expect, it, vi } from 'vitest';

import { SessionManager } from '../../src/api/src/sessions/SessionManager.js';

describe('SessionManager', () => {
  it('expires and disposes sessions', () => {
    vi.useFakeTimers();
    const manager = new SessionManager(1_000, 2, 60_000);
    const session = manager.create();
    const dispose = vi.fn();
    session.dispose = dispose;

    vi.advanceTimersByTime(1_001);
    expect(manager.get(session.id)).toBeUndefined();
    expect(dispose).toHaveBeenCalledOnce();
    manager.close();
    vi.useRealTimers();
  });

  it('enforces the concurrent session limit', () => {
    const manager = new SessionManager(60_000, 1, 60_000);
    manager.create();

    expect(() => manager.create()).toThrow('capacity');
    manager.close();
  });
});
