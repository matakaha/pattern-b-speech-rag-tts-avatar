import type { Response } from 'express';
import { AnswerStreamEventSchema, type AnswerStreamEvent } from '@pattern-b/shared';

export class SseWriter {
  #closed = false;

  constructor(private readonly response: Response) {
    response.status(200);
    response.set({
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    response.once('close', () => {
      this.#closed = true;
    });
  }

  get closed(): boolean {
    return this.#closed;
  }

  async write(event: AnswerStreamEvent): Promise<void> {
    if (this.#closed) throw new DOMException('SSE connection closed.', 'AbortError');
    const parsed = AnswerStreamEventSchema.parse(event);
    const accepted = this.response.write(
      `event: ${parsed.type}\ndata: ${JSON.stringify(parsed)}\n\n`,
    );
    if (!accepted) await waitForDrain(this.response);
  }

  end(): void {
    if (!this.#closed) this.response.end();
  }
}

function waitForDrain(response: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    const onDrain = (): void => {
      cleanup();
      resolve();
    };
    const onClose = (): void => {
      cleanup();
      reject(new DOMException('SSE connection closed.', 'AbortError'));
    };
    const cleanup = (): void => {
      response.off('drain', onDrain);
      response.off('close', onClose);
    };
    response.once('drain', onDrain);
    response.once('close', onClose);
  });
}
