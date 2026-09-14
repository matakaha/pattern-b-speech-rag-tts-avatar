import type OpenAI from 'openai';

import { mapServiceError } from '../errors/ServiceError.js';

export interface ResponseUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export type ResponseStreamItem =
  | { type: 'delta'; text: string }
  | { type: 'done'; usage: ResponseUsage };

export interface GroundedPrompt {
  instructions: string;
  input: string;
}

export interface ResponseStreamer {
  stream(prompt: GroundedPrompt, signal: AbortSignal): AsyncIterable<ResponseStreamItem>;
}

export class FoundryResponseStreamer implements ResponseStreamer {
  constructor(
    private readonly client: OpenAI,
    private readonly deployment: string,
    private readonly maxOutputTokens: number,
  ) {}

  async *stream(prompt: GroundedPrompt, signal: AbortSignal): AsyncIterable<ResponseStreamItem> {
    try {
      const stream = await this.client.responses.create(
        {
          model: this.deployment,
          instructions: prompt.instructions,
          input: prompt.input,
          max_output_tokens: this.maxOutputTokens,
          store: false,
          stream: true,
        },
        { signal },
      );

      for await (const event of stream) {
        if (event.type === 'response.output_text.delta' && event.delta) {
          yield { type: 'delta', text: event.delta };
        }
        if (event.type === 'response.completed') {
          const usage = event.response.usage;
          yield {
            type: 'done',
            usage: {
              inputTokens: usage?.input_tokens ?? 0,
              outputTokens: usage?.output_tokens ?? 0,
              totalTokens: usage?.total_tokens ?? 0,
            },
          };
        }
      }
    } catch (cause) {
      throw mapServiceError(cause, 'generation');
    }
  }
}
