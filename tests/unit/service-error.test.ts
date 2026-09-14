import { describe, expect, it } from 'vitest';

import { mapServiceError } from '../../src/api/src/errors/ServiceError.js';

describe('mapServiceError', () => {
  it.each([
    [401, 'MODEL_AUTH_FAILED', false],
    [403, 'MODEL_AUTH_FAILED', false],
    [429, 'MODEL_RATE_LIMITED', true],
  ] as const)('maps model status %s without exposing its cause', (status, code, retryable) => {
    const error = mapServiceError({ status, message: 'secret endpoint and token' }, 'generation');

    expect(error).toMatchObject({ code, stage: 'generation', retryable });
    expect(JSON.stringify(error)).not.toContain('secret endpoint and token');
  });

  it('maps timeouts to a retryable public code', () => {
    const cause = new Error('private request details');
    cause.name = 'TimeoutError';

    expect(mapServiceError(cause, 'generation')).toMatchObject({
      code: 'MODEL_TIMEOUT',
      retryable: true,
      httpStatus: 504,
    });
  });
});
