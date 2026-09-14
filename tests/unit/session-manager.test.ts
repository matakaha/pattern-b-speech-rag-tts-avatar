import { describe, expect, it, vi } from 'vitest';

import { SessionManager } from '../../src/api/src/sessions/SessionManager.js';

describe('SessionManager', () => {
  it('expires and disposes sessions', async () => {
    vi.useFakeTimers();
    const manager = new SessionManager(1_000, 2, 60_000);
    const session = manager.create();
    const dispose = vi.fn(async () => undefined);
    session.dispose = dispose;

    vi.advanceTimersByTime(1_001);
    expect(manager.get(session.id)).toBeUndefined();
    await session.disposalPromise;
    expect(dispose).toHaveBeenCalledOnce();
    expect(session.disposalState).toBe('disposed');
    await manager.close();
    vi.useRealTimers();
  });

  it('enforces the concurrent session limit', () => {
    const manager = new SessionManager(60_000, 1, 60_000);
    manager.create();

    expect(() => manager.create()).toThrow('capacity');
    return manager.close();
  });

  it('shares one disposal across concurrent deletion paths', async () => {
    const manager = new SessionManager(60_000, 1, 60_000);
    const session = manager.create();
    const dispose = vi.fn(async () => undefined);
    session.dispose = dispose;

    const results = await Promise.all([manager.delete(session.id), manager.delete(session.id)]);

    expect(results).toEqual([true, false]);
    expect(dispose).toHaveBeenCalledOnce();
    expect(session.disposalState).toBe('disposed');
    await manager.close();
  });

  it('removes a session even when its disposal fails', async () => {
    const manager = new SessionManager(60_000, 1, 60_000);
    const session = manager.create();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    session.dispose = async () => {
      throw new Error('SDK close failed.');
    };

    await expect(manager.delete(session.id)).resolves.toBe(true);
    expect(session.disposalState).toBe('disposed');
    expect(manager.get(session.id)).toBeUndefined();
    expect(consoleError).toHaveBeenCalledOnce();

    consoleError.mockRestore();
    await manager.close();
  });
});
