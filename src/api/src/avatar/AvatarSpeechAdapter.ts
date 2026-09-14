import type { TokenCredential } from '@azure/core-auth';
import type { AvatarIceServer } from '@pattern-b/shared';
import {
  CancellationDetails,
  Connection,
  ResultReason,
  SpeechConfig,
  SpeechSynthesizer,
  type SpeechSynthesisResult,
} from 'microsoft-cognitiveservices-speech-sdk';
import { z } from 'zod';

export interface AvatarOffer {
  type: 'offer';
  sdp: string;
}

export interface AvatarAnswer {
  type: 'answer';
  sdp: string;
}

export interface AvatarTransport {
  speak(text: string, signal?: AbortSignal): Promise<void>;
  stop(): Promise<void>;
  close(): Promise<void>;
}

export interface AvatarConnectResult {
  answer: AvatarAnswer;
  transport: AvatarTransport;
}

export interface AvatarConnector {
  connect(
    offer: AvatarOffer,
    iceServer: AvatarIceServer,
    onDisconnected: () => void,
    signal?: AbortSignal,
  ): Promise<AvatarConnectResult>;
}

interface AvatarSpeechAdapterOptions {
  speechEndpoint: string;
  credential: TokenCredential;
  voice: string;
  character: string;
  style: string;
  connectTimeoutMs: number;
  speakTimeoutMs: number;
  closeTimeoutMs: number;
}

const AnswerSchema = z.object({ type: z.literal('answer'), sdp: z.string().min(1).max(128_000) });

export class AvatarSpeechError extends Error {
  constructor(
    readonly code: 'AVATAR_CONNECT_FAILED' | 'AVATAR_SYNTHESIS_FAILED',
    readonly retryable: boolean,
  ) {
    super(
      code === 'AVATAR_CONNECT_FAILED' ? 'Avatar connection failed.' : 'Avatar synthesis failed.',
    );
  }
}

export class AvatarSpeechAdapter implements AvatarConnector {
  constructor(private readonly options: AvatarSpeechAdapterOptions) {}

  async connect(
    offer: AvatarOffer,
    iceServer: AvatarIceServer,
    onDisconnected: () => void,
    signal?: AbortSignal,
  ): Promise<AvatarConnectResult> {
    const endpoint = new URL('/tts/cognitiveservices/websocket/v1', this.options.speechEndpoint);
    endpoint.protocol = 'wss:';
    endpoint.searchParams.set('enableTalkingAvatar', 'true');

    const speechConfig = SpeechConfig.fromEndpoint(endpoint, this.options.credential);
    speechConfig.speechSynthesisVoiceName = this.options.voice;
    const synthesizer = new SpeechSynthesizer(speechConfig, null);
    const connection = Connection.fromSynthesizer(synthesizer);
    connection.disconnected = onDisconnected;
    connection.setMessageProperty(
      'speech.config',
      'context',
      JSON.stringify(buildAvatarContext(offer, iceServer, this.options)),
    );

    const transport = new SdkAvatarTransport(
      synthesizer,
      connection,
      this.options.speakTimeoutMs,
      this.options.closeTimeoutMs,
    );

    try {
      const result = await withTimeout(
        synthesize(synthesizer, ' '),
        this.options.connectTimeoutMs,
        signal,
      );
      assertSynthesisSucceeded(result, 'AVATAR_CONNECT_FAILED');
      const encodedAnswer = result.properties.getProperty('TalkingAvatarService_WebRTC_SDP');
      const answer = AnswerSchema.parse(
        JSON.parse(Buffer.from(encodedAnswer, 'base64').toString('utf8')),
      );
      return { answer, transport };
    } catch (cause) {
      await transport.close();
      if (cause instanceof AvatarSpeechError) throw cause;
      throw new AvatarSpeechError('AVATAR_CONNECT_FAILED', true);
    }
  }
}

class SdkAvatarTransport implements AvatarTransport {
  #closed = false;

  constructor(
    private readonly synthesizer: SpeechSynthesizer,
    private readonly connection: Connection,
    private readonly speakTimeoutMs: number,
    private readonly closeTimeoutMs: number,
  ) {}

  async speak(text: string, signal?: AbortSignal): Promise<void> {
    if (this.#closed) throw new AvatarSpeechError('AVATAR_SYNTHESIS_FAILED', true);
    try {
      const result = await withTimeout(
        synthesize(this.synthesizer, text),
        this.speakTimeoutMs,
        signal,
      );
      assertSynthesisSucceeded(result, 'AVATAR_SYNTHESIS_FAILED');
    } catch (cause) {
      if (cause instanceof AvatarSpeechError) throw cause;
      throw new AvatarSpeechError('AVATAR_SYNTHESIS_FAILED', true);
    }
  }

  async stop(): Promise<void> {
    if (this.#closed) return;
    await withTimeout(
      callbackToPromise((resolve, reject) =>
        this.connection.sendMessageAsync('synthesis.control', '{"action":"stop"}', resolve, reject),
      ),
      this.closeTimeoutMs,
    ).catch(() => undefined);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    await this.stop();
    this.#closed = true;
    this.connection.disconnected = () => undefined;
    this.connection.close();
    await withTimeout(
      callbackToPromise((resolve, reject) => this.synthesizer.close(resolve, reject)),
      this.closeTimeoutMs,
    ).catch(() => undefined);
  }
}

function buildAvatarContext(
  offer: AvatarOffer,
  iceServer: AvatarIceServer,
  options: Pick<AvatarSpeechAdapterOptions, 'character' | 'style'>,
): object {
  return {
    synthesis: {
      video: {
        protocol: {
          name: 'WebRTC',
          webrtcConfig: {
            clientDescription: Buffer.from(JSON.stringify(offer)).toString('base64'),
            iceServers: [iceServer],
          },
        },
        format: {
          resolution: { width: 1920, height: 1080 },
          bitrate: 1_000_000,
          codec: 'H264',
        },
        talkingAvatar: {
          customized: false,
          useBuiltInVoice: false,
          character: options.character,
          style: options.style,
          background: { color: '#FFFFFFFF', image: { url: '' } },
        },
      },
    },
  };
}

function synthesize(synthesizer: SpeechSynthesizer, text: string): Promise<SpeechSynthesisResult> {
  return new Promise((resolve, reject) => synthesizer.speakTextAsync(text, resolve, reject));
}

function assertSynthesisSucceeded(
  result: SpeechSynthesisResult,
  code: AvatarSpeechError['code'],
): void {
  if (result.reason === ResultReason.SynthesizingAudioCompleted) return;
  const cancellation = CancellationDetails.fromResult(result);
  const retryable = !cancellation.errorDetails.toLowerCase().includes('authentication');
  throw new AvatarSpeechError(code, retryable);
}

function callbackToPromise(
  operation: (resolve: () => void, reject: (error: string) => void) => void,
): Promise<void> {
  return new Promise((resolve, reject) => operation(resolve, (error) => reject(new Error(error))));
}

function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new DOMException('Operation timed out.', 'TimeoutError')),
      timeoutMs,
    );
    const abort = () => reject(new DOMException('Operation canceled.', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    operation.then(resolve, reject).finally(() => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    });
  });
}
