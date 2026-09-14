import { randomUUID } from 'node:crypto';

import {
  AvatarConnectionIdSchema,
  type AvatarConnectResponse,
  type AvatarConnectionId,
  type AvatarIceServer,
  type AvatarPrepareResponse,
  type ServerEvent,
  type SessionId,
} from '@pattern-b/shared';

import type { AvatarConnector, AvatarOffer, AvatarTransport } from './AvatarSpeechAdapter.js';

type AvatarEvent = Extract<
  ServerEvent,
  {
    type: 'avatar.connecting' | 'avatar.ready' | 'avatar.fallback' | 'avatar.disconnected';
  }
>;
type AvatarFailureCode = Extract<AvatarEvent, { type: 'avatar.fallback' }>['code'];
type AvatarEventPayload = AvatarEvent extends infer Event
  ? Event extends AvatarEvent
    ? Omit<Event, 'sessionId' | 'timestamp'>
    : never
  : never;

export interface AvatarRelayProvider {
  getIceServers(signal?: AbortSignal): Promise<AvatarIceServer[]>;
}

interface AvatarSessionOptions {
  sessionId: SessionId;
  relayProvider: AvatarRelayProvider;
  connector: AvatarConnector;
  idleTimeoutMs: number;
  maxConnectionMs: number;
  clientConfig: AvatarPrepareResponse['clientConfig'];
  sendEvent: (event: AvatarEvent) => void;
}

export type AvatarSessionState =
  | 'idle'
  | 'preparing'
  | 'prepared'
  | 'connecting'
  | 'ready'
  | 'fallback'
  | 'closing'
  | 'closed';

export class AvatarSession {
  #state: AvatarSessionState = 'idle';
  #connectionId: AvatarConnectionId | undefined;
  #iceServers: AvatarIceServer[] = [];
  #transport: AvatarTransport | undefined;
  #idleTimer: NodeJS.Timeout | undefined;
  #lifetimeTimer: NodeJS.Timeout | undefined;
  #operation = Promise.resolve();

  constructor(private readonly options: AvatarSessionOptions) {}

  get state(): AvatarSessionState {
    return this.#state;
  }

  prepare(signal?: AbortSignal): Promise<AvatarPrepareResponse> {
    return this.#serialize(async () => {
      this.#assertOpen();
      await this.#closeTransport('client', false);
      this.#state = 'preparing';
      try {
        this.#iceServers = await this.options.relayProvider.getIceServers(signal);
        this.#connectionId = AvatarConnectionIdSchema.parse(randomUUID());
        this.#state = 'prepared';
        return {
          connectionId: this.#connectionId,
          iceServers: this.#iceServers,
          clientConfig: this.options.clientConfig,
        };
      } catch (cause) {
        this.#state = 'fallback';
        this.#emitFallback('AVATAR_RELAY_UNAVAILABLE', true);
        throw cause;
      }
    });
  }

  connect(
    connectionId: AvatarConnectionId,
    offer: AvatarOffer,
    signal?: AbortSignal,
  ): Promise<AvatarConnectResponse> {
    return this.#serialize(async () => {
      this.#assertOpen();
      if (this.#state !== 'prepared' || connectionId !== this.#connectionId) {
        throw new Error('Avatar connection is stale.');
      }

      this.#state = 'connecting';
      this.#emit({ type: 'avatar.connecting', connectionId });
      try {
        const result = await this.options.connector.connect(
          offer,
          this.#iceServers[0]!,
          () => this.#handleTransportLost(connectionId),
          signal,
        );
        if (connectionId !== this.#connectionId) {
          await result.transport.close();
          throw new Error('Avatar connection is stale.');
        }
        this.#transport = result.transport;
        this.#state = 'ready';
        this.#startTimers(connectionId);
        this.#emit({ type: 'avatar.ready', connectionId });
        return { connectionId, answer: result.answer };
      } catch (cause) {
        this.#state = 'fallback';
        this.#emitFallback('AVATAR_CONNECT_FAILED', true);
        throw cause;
      }
    });
  }

  async speak(text: string, signal?: AbortSignal): Promise<'spoken' | 'skipped'> {
    if (this.#state !== 'ready' || !this.#transport) return 'skipped';
    const connectionId = this.#connectionId;
    const transport = this.#transport;
    const stopOnAbort = () => void transport.stop();
    if (signal?.aborted) {
      await transport.stop();
      return 'skipped';
    }
    signal?.addEventListener('abort', stopOnAbort, { once: true });
    try {
      await transport.speak(text, signal);
      if (connectionId === this.#connectionId && this.#state === 'ready') this.#resetIdleTimer();
      return 'spoken';
    } catch (cause) {
      if (signal?.aborted || (cause instanceof DOMException && cause.name === 'AbortError')) {
        return 'skipped';
      }
      if (connectionId) this.#handleTransportLost(connectionId, 'AVATAR_SYNTHESIS_FAILED');
      return 'skipped';
    } finally {
      signal?.removeEventListener('abort', stopOnAbort);
    }
  }

  async stopSpeaking(): Promise<void> {
    await this.#transport?.stop();
  }

  disconnect(): Promise<void> {
    return this.#serialize(() => this.#closeTransport('client', false));
  }

  dispose(): Promise<void> {
    return this.#serialize(async () => {
      if (this.#state === 'closed') return;
      await this.#closeTransport('session-ended', false);
      this.#state = 'closed';
    });
  }

  #handleTransportLost(
    connectionId: AvatarConnectionId,
    code: 'AVATAR_TRANSPORT_LOST' | 'AVATAR_SYNTHESIS_FAILED' = 'AVATAR_TRANSPORT_LOST',
  ): void {
    if (
      connectionId !== this.#connectionId ||
      this.#state === 'closing' ||
      this.#state === 'closed'
    ) {
      return;
    }
    void this.#serialize(async () => {
      if (connectionId !== this.#connectionId) return;
      await this.#closeTransport('transport', true);
      this.#state = 'fallback';
      this.#emitFallback(code, true);
    });
  }

  #startTimers(connectionId: AvatarConnectionId): void {
    this.#clearTimers();
    this.#idleTimer = setTimeout(() => {
      void this.#serialize(() => this.#expire(connectionId, 'idle'));
    }, this.options.idleTimeoutMs);
    this.#idleTimer.unref();
    this.#lifetimeTimer = setTimeout(() => {
      void this.#serialize(() => this.#expire(connectionId, 'lifetime'));
    }, this.options.maxConnectionMs);
    this.#lifetimeTimer.unref();
  }

  #resetIdleTimer(): void {
    if (!this.#connectionId || this.#state !== 'ready') return;
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    const connectionId = this.#connectionId;
    this.#idleTimer = setTimeout(() => {
      void this.#serialize(() => this.#expire(connectionId, 'idle'));
    }, this.options.idleTimeoutMs);
    this.#idleTimer.unref();
  }

  async #expire(connectionId: AvatarConnectionId, reason: 'idle' | 'lifetime'): Promise<void> {
    if (connectionId !== this.#connectionId || this.#state !== 'ready') return;
    await this.#closeTransport(reason, reason === 'lifetime');
  }

  async #closeTransport(
    reason: 'client' | 'idle' | 'lifetime' | 'transport' | 'session-ended',
    reconnectable: boolean,
  ): Promise<void> {
    const hadConnection = this.#connectionId !== undefined;
    const transport = this.#transport;
    this.#state = 'closing';
    this.#clearTimers();
    this.#connectionId = undefined;
    this.#iceServers = [];
    this.#transport = undefined;
    if (transport) await transport.close().catch(() => undefined);
    this.#state = reason === 'idle' ? 'idle' : 'fallback';
    if (hadConnection) {
      this.#emit({ type: 'avatar.disconnected', reason, reconnectable });
    }
  }

  #clearTimers(): void {
    if (this.#idleTimer) clearTimeout(this.#idleTimer);
    if (this.#lifetimeTimer) clearTimeout(this.#lifetimeTimer);
    this.#idleTimer = undefined;
    this.#lifetimeTimer = undefined;
  }

  #emitFallback(code: AvatarFailureCode, reconnectable: boolean): void {
    this.#emit({ type: 'avatar.fallback', code, reconnectable });
  }

  #emit(event: AvatarEventPayload): void {
    this.options.sendEvent({
      ...event,
      sessionId: this.options.sessionId,
      timestamp: new Date().toISOString(),
    } as AvatarEvent);
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#operation.then(operation, operation);
    this.#operation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  #assertOpen(): void {
    if (this.#state === 'closed') throw new Error('Avatar session is closed.');
  }
}
