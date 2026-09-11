import { randomUUID } from 'node:crypto';

import {
  PCM_SAMPLE_RATE,
  TurnIdSchema,
  decodeAudioFrame,
  type ServerEvent,
  type SessionId,
  type TurnId,
} from '@pattern-b/shared';

const INTERIM_FRAME_INTERVAL = 12;
type ServerEventPayload<Event extends ServerEvent = ServerEvent> = Event extends ServerEvent
  ? Omit<Event, 'sessionId' | 'timestamp'>
  : never;

export class MockAudioSession {
  #expectedSequence = 0;
  #framesReceived = 0;
  #activeSamples = 0;
  #ended = false;

  constructor(
    private readonly sessionId: SessionId,
    private readonly sendEvent: (event: ServerEvent) => void,
  ) {}

  start(): void {
    this.#assertOpen();
    this.#emitState('listening');
  }

  write(data: ArrayBuffer): void {
    this.#assertOpen();
    const frame = decodeAudioFrame(data);
    if (frame.sampleRate !== PCM_SAMPLE_RATE) throw new Error('Unsupported sample rate.');
    if (frame.sequence !== this.#expectedSequence)
      throw new Error('Audio frame sequence mismatch.');

    this.#expectedSequence += 1;
    this.#framesReceived += 1;
    this.#activeSamples += frame.samples.reduce(
      (count, sample) => count + (Math.abs(sample) >= 300 ? 1 : 0),
      0,
    );

    if (this.#framesReceived % INTERIM_FRAME_INTERVAL === 0 && this.#activeSamples > 0) {
      this.#emit({ type: 'stt.recognizing', text: '音声を受信しています…' });
    }
  }

  end(): void {
    this.#assertOpen();
    const turnId = TurnIdSchema.parse(randomUUID());
    const text =
      this.#activeSamples > 0 ? '音声入力を受信しました。' : '音声を検出できませんでした。';
    this.#emit({ type: 'stt.recognized', turnId, text });
    this.#emitState('ready', turnId);
    this.#resetAudio();
  }

  cancel(): void {
    this.#assertOpen();
    this.#emitState('canceling');
    this.#resetAudio();
    this.#emitState('ready');
  }

  close(): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#emitState('ended');
  }

  #emit(event: ServerEventPayload): void {
    this.sendEvent({
      ...event,
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
    } as ServerEvent);
  }

  #emitState(state: 'ready' | 'listening' | 'canceling' | 'ended', turnId?: TurnId): void {
    this.#emit({ type: 'turn.state', state, ...(turnId ? { turnId } : {}) });
  }

  #resetAudio(): void {
    this.#expectedSequence = 0;
    this.#framesReceived = 0;
    this.#activeSamples = 0;
  }

  #assertOpen(): void {
    if (this.#ended) throw new Error('Audio session is closed.');
  }
}
