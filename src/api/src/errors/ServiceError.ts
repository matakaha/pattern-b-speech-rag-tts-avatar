import type { AnswerStreamEvent } from '@pattern-b/shared';

export type AnswerError = Extract<AnswerStreamEvent, { type: 'error' }>;
export type AnswerErrorCode = AnswerError['code'];
export type AnswerErrorStage = AnswerError['stage'];

export class ServiceError extends Error {
  constructor(
    readonly code: AnswerErrorCode,
    readonly stage: AnswerErrorStage,
    readonly retryable: boolean,
    readonly httpStatus: number,
  ) {
    super('Service operation failed.');
    this.name = 'ServiceError';
  }
}

export function mapServiceError(
  cause: unknown,
  stage: 'embedding' | 'generation' | 'retrieval',
): ServiceError {
  if (cause instanceof ServiceError) return cause;
  if (cause instanceof DOMException && cause.name === 'AbortError') {
    return new ServiceError('ANSWER_CANCELED', 'transport', false, 499);
  }

  const status = getStatus(cause);
  if (stage === 'retrieval') {
    return new ServiceError(
      status === 401 || status === 403 ? 'SEARCH_AUTH_FAILED' : 'SEARCH_UNAVAILABLE',
      'retrieval',
      status !== 401 && status !== 403,
      status === 401 || status === 403 ? 502 : 503,
    );
  }
  if (stage === 'embedding') {
    return new ServiceError(
      status === 401 || status === 403 ? 'EMBEDDING_AUTH_FAILED' : 'EMBEDDING_UNAVAILABLE',
      'embedding',
      status !== 401 && status !== 403,
      status === 401 || status === 403 ? 502 : 503,
    );
  }
  if (status === 401 || status === 403) {
    return new ServiceError('MODEL_AUTH_FAILED', 'generation', false, 502);
  }
  if (status === 404) return new ServiceError('MODEL_NOT_FOUND', 'generation', false, 502);
  if (status === 429) return new ServiceError('MODEL_RATE_LIMITED', 'generation', true, 429);
  if (isTimeout(cause)) return new ServiceError('MODEL_TIMEOUT', 'generation', true, 504);
  return new ServiceError('MODEL_UNAVAILABLE', 'generation', true, 503);
}

function getStatus(cause: unknown): number | undefined {
  if (!cause || typeof cause !== 'object' || !('status' in cause)) return undefined;
  return typeof cause.status === 'number' ? cause.status : undefined;
}

function isTimeout(cause: unknown): boolean {
  return (
    cause instanceof Error &&
    (cause.name === 'TimeoutError' || cause.name === 'APIConnectionTimeoutError')
  );
}
