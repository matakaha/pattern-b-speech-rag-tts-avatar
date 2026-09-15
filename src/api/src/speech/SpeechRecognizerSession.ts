import { randomUUID } from 'node:crypto';

import type { TokenCredential } from '@azure/core-auth';
import {
  AudioConfig,
  AudioInputStream,
  AudioStreamFormat,
  CancellationErrorCode,
  CancellationReason,
  PhraseListGrammar,
  ResultReason,
  SpeechConfig,
  SpeechRecognizer,
} from 'microsoft-cognitiveservices-speech-sdk';

import {
  PCM_SAMPLE_RATE,
  TurnIdSchema,
  decodeAudioFrame,
  type ServerEvent,
  type SessionId,
  type TurnId,
} from '@pattern-b/shared';

import { safeLog } from '../logging/safeLogger.js';
import { FinalTranscriptAggregator } from './FinalTranscriptAggregator.js';

type ServerEventPayload<Event extends ServerEvent = ServerEvent> = Event extends ServerEvent
  ? Omit<Event, 'sessionId' | 'timestamp'>
  : never;

interface SpeechClientHandlers {
  onRecognizing: (text: string) => void;
  onRecognized: (resultId: string, text: string) => void;
  onSpeechStarted: () => void;
  onSpeechEnded: () => void;
  onSessionStopped: () => void;
  onCanceled: (reason: CancellationReason, errorCode: CancellationErrorCode) => void;
}

export interface SpeechClient {
  start: () => Promise<void>;
  write: (audio: ArrayBuffer) => void;
  endAudio: () => void;
  stop: () => Promise<void>;
  close: () => Promise<void>;
}

export interface SpeechRecognizerSessionOptions {
  sessionId: SessionId;
  endpoint: string;
  credential: TokenCredential;
  recognitionLanguage: string;
  phrases: string[];
  utteranceTimeoutMs: number;
  finalGraceMs: number;
  sendEvent: (event: ServerEvent) => void;
  createClient?: (handlers: SpeechClientHandlers) => SpeechClient;
}

export class SpeechSessionOperationError extends Error {
  readonly code = 'SPEECH_SERVICE_UNAVAILABLE';
  readonly retryable = true;

  constructor() {
    super('Azure Speech operation failed.');
  }
}

export class SpeechRecognizerSession {
  readonly #aggregator: FinalTranscriptAggregator;
  #client: SpeechClient | undefined;
  #expectedSequence = 0;
  #state: 'ready' | 'starting' | 'listening' | 'ending' | 'finishing' | 'closed' = 'ready';
  #speechEndedEmitted = false;
  #cleanupPromise: Promise<void> | undefined;

  constructor(private readonly options: SpeechRecognizerSessionOptions) {
    this.#aggregator = new FinalTranscriptAggregator({
      utteranceTimeoutMs: options.utteranceTimeoutMs,
      finalGraceMs: options.finalGraceMs,
      onComplete: ({ text }) => {
        void this.#finishTurn(text).catch(() => this.#emitOperationError());
      },
    });
  }

  async start(): Promise<void> {
    if (this.#state !== 'ready') throw new Error('Speech recognition is not ready to start.');

    this.#state = 'starting';
    this.#expectedSequence = 0;
    this.#speechEndedEmitted = false;

    try {
      this.#client = (this.options.createClient ?? this.#createSdkClient)(this.#handlers());
      this.#aggregator.start();
      await this.#client.start();
      if (this.#isClosed()) return;
      this.#state = 'listening';
      this.#emitState('listening');
    } catch {
      this.#aggregator.cancel();
      await this.#disposeClient();
      this.#state = 'ready';
      throw new SpeechSessionOperationError();
    }
  }

  write(data: ArrayBuffer): void {
    if (this.#isFinishingEndedSpeech()) return;
    if (this.#state !== 'listening') throw new Error('Speech recognition is not listening.');

    const frame = decodeAudioFrame(data);
    if (frame.sampleRate !== PCM_SAMPLE_RATE) throw new Error('Unsupported sample rate.');
    if (frame.sequence !== this.#expectedSequence) {
      throw new Error('Audio frame sequence mismatch.');
    }

    this.#expectedSequence += 1;
    this.#client?.write(frame.samples.buffer as ArrayBuffer);
  }

  end(): void {
    if (this.#isFinishingEndedSpeech()) return;
    if (this.#state !== 'listening') throw new Error('Speech recognition is not listening.');
    this.#state = 'ending';
    this.#client?.endAudio();
    this.#aggregator.audioEnded();
  }

  #isFinishingEndedSpeech(): boolean {
    return (
      this.#state === 'ending' ||
      (this.#speechEndedEmitted && (this.#state === 'finishing' || this.#state === 'ready'))
    );
  }

  async cancel(): Promise<void> {
    if (this.#state === 'closed') return;
    this.#emitState('canceling');
    this.#aggregator.cancel();
    this.#state = 'finishing';
    await this.#disposeClient();
    if (!this.#isClosed()) {
      this.#state = 'ready';
      this.#emitState('ready');
    }
  }

  async close(): Promise<void> {
    if (this.#state === 'closed') return this.#cleanupPromise;
    this.#state = 'closed';
    this.#aggregator.cancel();
    await this.#disposeClient();
    this.#emitState('ended');
  }

  #handlers(): SpeechClientHandlers {
    return {
      onRecognizing: (text) => {
        if (this.#state === 'listening' && text.trim()) {
          this.#emit({ type: 'stt.recognizing', text: text.trim() });
        }
      },
      onRecognized: (resultId, text) => this.#aggregator.addFinal(resultId, text),
      onSpeechStarted: () => {
        this.#aggregator.speechStarted();
        this.#emit({ type: 'speech.started' });
      },
      onSpeechEnded: () => this.#handleSpeechEnded(),
      onSessionStopped: () => this.#handleSpeechEnded(),
      onCanceled: (reason, errorCode) => {
        if (reason === CancellationReason.EndOfStream) {
          this.#handleSpeechEnded();
          return;
        }
        this.#emitSpeechError(errorCode);
        this.#aggregator.cancel();
        void this.#finishTurn(undefined);
      },
    };
  }

  async #finishTurn(text: string | undefined): Promise<void> {
    if (this.#state === 'ready' || this.#state === 'closed' || this.#state === 'finishing') return;
    if (!this.#speechEndedEmitted) this.#handleSpeechEnded();
    this.#state = 'finishing';
    await this.#disposeClient();
    if (this.#isClosed()) return;

    let turnId: TurnId | undefined;
    if (text) {
      turnId = TurnIdSchema.parse(randomUUID());
      this.#emit({ type: 'stt.recognized', turnId, text });
    }
    this.#state = 'ready';
    this.#emitState('ready', turnId);
  }

  #handleSpeechEnded(): void {
    if (this.#speechEndedEmitted) return;
    this.#speechEndedEmitted = true;
    this.#aggregator.speechEnded();
    this.#emit({ type: 'speech.ended' });
  }

  #disposeClient(): Promise<void> {
    if (this.#cleanupPromise) return this.#cleanupPromise;
    const client = this.#client;
    this.#client = undefined;
    if (!client) return Promise.resolve();

    this.#cleanupPromise = (async () => {
      try {
        await client.stop();
      } finally {
        await client.close();
      }
    })().finally(() => {
      this.#cleanupPromise = undefined;
    });
    return this.#cleanupPromise;
  }

  #createSdkClient = (handlers: SpeechClientHandlers): SpeechClient => {
    const speechConfig = SpeechConfig.fromEndpoint(
      new URL(this.options.endpoint),
      this.options.credential,
    );
    speechConfig.speechRecognitionLanguage = this.options.recognitionLanguage;

    const format = AudioStreamFormat.getWaveFormatPCM(PCM_SAMPLE_RATE, 16, 1);
    const pushStream = AudioInputStream.createPushStream(format);
    const audioConfig = AudioConfig.fromStreamInput(pushStream);
    const recognizer = new SpeechRecognizer(speechConfig, audioConfig);
    if (this.options.phrases.length > 0) {
      PhraseListGrammar.fromRecognizer(recognizer).addPhrases(this.options.phrases);
    }

    recognizer.recognizing = (_sender, event) => handlers.onRecognizing(event.result.text);
    recognizer.recognized = (_sender, event) => {
      if (event.result.reason === ResultReason.RecognizedSpeech) {
        handlers.onRecognized(event.result.resultId, event.result.text);
      }
    };
    recognizer.speechStartDetected = () => handlers.onSpeechStarted();
    recognizer.speechEndDetected = () => handlers.onSpeechEnded();
    recognizer.sessionStopped = () => handlers.onSessionStopped();
    recognizer.canceled = (_sender, event) => handlers.onCanceled(event.reason, event.errorCode);

    return {
      start: () =>
        callbackToPromise((resolve, reject) =>
          recognizer.startContinuousRecognitionAsync(resolve, reject),
        ),
      write: (audio) => pushStream.write(audio),
      endAudio: () => pushStream.close(),
      stop: () =>
        callbackToPromise((resolve, reject) =>
          recognizer.stopContinuousRecognitionAsync(resolve, reject),
        ),
      close: () => callbackToPromise((resolve, reject) => recognizer.close(resolve, reject)),
    };
  };

  #emitSpeechError(errorCode: CancellationErrorCode): void {
    safeLog({
      event: 'speech.recognition.canceled',
      severity: 'error',
      code: CancellationErrorCode[errorCode] ?? String(errorCode),
      operation: this.#state,
    });
    const retryable = [
      CancellationErrorCode.TooManyRequests,
      CancellationErrorCode.ConnectionFailure,
      CancellationErrorCode.ServiceTimeout,
      CancellationErrorCode.ServiceError,
    ].includes(errorCode);
    const code =
      errorCode === CancellationErrorCode.AuthenticationFailure
        ? 'SPEECH_AUTHENTICATION_FAILED'
        : errorCode === CancellationErrorCode.BadRequestParameters
          ? 'SPEECH_CONFIGURATION_INVALID'
          : 'SPEECH_RECOGNITION_CANCELED';
    this.#emit({
      type: 'error',
      code,
      retryable,
      stage: 'speech',
      correlationId: randomUUID(),
    });
  }

  #emitOperationError(): void {
    this.#emit({
      type: 'error',
      code: 'SPEECH_SERVICE_UNAVAILABLE',
      retryable: true,
      stage: 'speech',
      correlationId: randomUUID(),
    });
  }

  #emit(event: ServerEventPayload): void {
    this.options.sendEvent({
      ...event,
      sessionId: this.options.sessionId,
      timestamp: new Date().toISOString(),
    } as ServerEvent);
  }

  #emitState(state: 'ready' | 'listening' | 'canceling' | 'ended', turnId?: TurnId): void {
    this.#emit({ type: 'turn.state', state, ...(turnId ? { turnId } : {}) });
  }

  #isClosed(): boolean {
    return this.#state === 'closed';
  }
}

function callbackToPromise(
  operation: (resolve: () => void, reject: (error: string) => void) => void,
): Promise<void> {
  return new Promise((resolve, reject) => operation(resolve, (error) => reject(new Error(error))));
}
