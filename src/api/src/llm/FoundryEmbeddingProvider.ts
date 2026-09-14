import type OpenAI from 'openai';

import { ServiceError, mapServiceError } from '../errors/ServiceError.js';

export interface EmbeddingProvider {
  embed(inputs: readonly string[], signal?: AbortSignal): Promise<number[][]>;
}

export class FoundryEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private readonly client: OpenAI,
    private readonly deployment: string,
    private readonly dimensions: number,
  ) {}

  async embed(inputs: readonly string[], signal?: AbortSignal): Promise<number[][]> {
    if (inputs.length === 0 || inputs.some((input) => input.trim().length === 0)) {
      throw new Error('Embedding input must contain non-empty text.');
    }

    let response;
    try {
      response = await this.client.embeddings.create(
        { model: this.deployment, input: [...inputs], dimensions: this.dimensions },
        { signal },
      );
    } catch (cause) {
      throw mapServiceError(cause, 'embedding');
    }
    const embeddings = [...response.data]
      .sort((left, right) => left.index - right.index)
      .map((item) => item.embedding);

    if (
      embeddings.length !== inputs.length ||
      embeddings.some((embedding) => embedding.length !== this.dimensions)
    ) {
      throw new ServiceError('EMBEDDING_INVALID_RESPONSE', 'embedding', false, 502);
    }
    return embeddings;
  }
}
