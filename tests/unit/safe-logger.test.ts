import { afterEach, describe, expect, it, vi } from 'vitest';

import { safeLog } from '../../src/api/src/logging/safeLogger.js';

afterEach(() => vi.restoreAllMocks());

describe('safeLog', () => {
  it('drops fields outside the logging allowlist', () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    safeLog({
      event: 'test.completed',
      count: 1,
      question: 'PRIVATE_QUESTION',
      token: 'PRIVATE_TOKEN',
      endpoint: 'https://private.example.com',
    } as Parameters<typeof safeLog>[0]);

    const serialized = String(output.mock.calls[0]?.[0]);
    expect(serialized).toContain('test.completed');
    expect(serialized).not.toContain('PRIVATE_QUESTION');
    expect(serialized).not.toContain('PRIVATE_TOKEN');
    expect(serialized).not.toContain('private.example.com');
  });
});
