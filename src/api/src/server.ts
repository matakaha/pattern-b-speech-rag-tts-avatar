import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  AnswerRequestSchema,
  AvatarConnectRequestSchema,
  AvatarConnectResponseSchema,
  AvatarPrepareResponseSchema,
  ClientMessageSchema,
  ServerEventSchema,
  SessionCreateResponseSchema,
  SessionIdSchema,
  type ServerEvent,
} from '@pattern-b/shared';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { WebSocket, WebSocketServer, type RawData } from 'ws';

import { AnswerService } from './answer/AnswerService.js';
import { createCredential } from './auth/credentialFactory.js';
import { AvatarRelayTokenClient } from './avatar/AvatarRelayTokenClient.js';
import { AvatarSession } from './avatar/AvatarSession.js';
import { AvatarSpeechAdapter } from './avatar/AvatarSpeechAdapter.js';
import { loadConfig } from './config.js';
import { ServiceError, type AnswerError } from './errors/ServiceError.js';
import { SseWriter } from './http/SseWriter.js';
import { FixedWindowRateLimiter } from './http/RateLimiter.js';
import { registerStaticWeb } from './http/staticWeb.js';
import { FoundryEmbeddingProvider } from './llm/FoundryEmbeddingProvider.js';
import { createFoundryClient } from './llm/FoundryClientFactory.js';
import { FoundryResponseStreamer } from './llm/FoundryResponseStreamer.js';
import { safeLog } from './logging/safeLogger.js';
import { AvatarSentenceSink } from './rag/SynthesisQueue.js';
import { TurnStartError } from './rag/TurnCoordinator.js';
import { SearchRetriever } from './search/SearchRetriever.js';
import { SessionManager } from './sessions/SessionManager.js';
import {
  SpeechRecognizerSession,
  SpeechSessionOperationError,
} from './speech/SpeechRecognizerSession.js';

const config = loadConfig();
const credential = createCredential(config.APPLICATION_RUNTIME);
const sessions = new SessionManager(config.SESSION_TTL_SECONDS * 1_000, config.MAX_SESSIONS);
const avatarRelayClient = new AvatarRelayTokenClient(
  config.AZURE_SPEECH_ENDPOINT,
  credential,
  config.AVATAR_RELAY_TIMEOUT_MS,
);
const avatarConnector = new AvatarSpeechAdapter({
  speechEndpoint: config.AZURE_SPEECH_ENDPOINT,
  credential,
  voice: config.SPEECH_SYNTHESIS_VOICE,
  character: config.AVATAR_CHARACTER,
  style: config.AVATAR_STYLE,
  connectTimeoutMs: config.AVATAR_CONNECT_TIMEOUT_MS,
  speakTimeoutMs: config.AVATAR_SPEAK_TIMEOUT_MS,
  closeTimeoutMs: config.AVATAR_CLOSE_TIMEOUT_MS,
});
const embeddingClient = createFoundryClient(
  credential,
  config.AZURE_FOUNDRY_BASE_URL,
  config.EMBEDDING_TIMEOUT_MS,
);
const responseClient = createFoundryClient(
  credential,
  config.AZURE_FOUNDRY_BASE_URL,
  config.MODEL_TIMEOUT_MS,
);
const embeddingProvider = new FoundryEmbeddingProvider(
  embeddingClient,
  config.AZURE_EMBEDDING_DEPLOYMENT,
  config.AZURE_EMBEDDING_DIMENSIONS,
);
const retriever = new SearchRetriever(
  config.AZURE_SEARCH_ENDPOINT,
  config.AZURE_SEARCH_INDEX,
  credential,
  embeddingProvider,
  config.AZURE_SEARCH_SEMANTIC_CONFIG,
  config.SEARCH_TOP_K,
  config.MAX_RAG_CONTEXT_CHARS,
);
const answerService = new AnswerService(
  retriever,
  new FoundryResponseStreamer(
    responseClient,
    config.AZURE_CHAT_DEPLOYMENT,
    config.MAX_OUTPUT_TOKENS,
  ),
  {
    maxHistoryCharacters: config.MAX_ANSWER_HISTORY_CHARS,
    minSentenceCharacters: config.MIN_SENTENCE_CHARS,
    maxSentenceCharacters: config.MAX_SENTENCE_CHARS,
    synthesisQueueLimit: config.SYNTHESIS_QUEUE_LIMIT,
    sentenceSink: new AvatarSentenceSink((sessionId) => sessions.get(sessionId)?.avatar),
  },
);
const speechPhrases = config.SPEECH_PHRASES.split(',')
  .map((phrase) => phrase.trim())
  .filter(Boolean);
const app = express();
const server = createServer(app);
const webSocketServer = new WebSocketServer({
  noServer: true,
  maxPayload: config.MAX_AUDIO_FRAME_BYTES,
});
const sessionRateLimiter = new FixedWindowRateLimiter(config.SESSION_RATE_LIMIT_PER_MINUTE, 60_000);
const answerRateLimiter = new FixedWindowRateLimiter(config.ANSWER_RATE_LIMIT_PER_MINUTE, 60_000);
const avatarRateLimiter = new FixedWindowRateLimiter(config.AVATAR_RATE_LIMIT_PER_MINUTE, 60_000);

app.disable('x-powered-by');
app.use('/api', (request, response, next) => {
  if (!isAllowedOrigin(request.headers.origin)) {
    response.status(403).json({ error: 'Request rejected.', code: 'ORIGIN_NOT_ALLOWED' });
    return;
  }
  response.setTimeout(config.REQUEST_TIMEOUT_MS, () => {
    if (!response.headersSent) {
      response.status(504).json({ error: 'Request timed out.', code: 'REQUEST_TIMEOUT' });
    } else {
      response.end();
    }
  });
  next();
});
const standardJsonParser = express.json({ limit: '16kb' });
const avatarJsonParser = express.json({ limit: '160kb' });
app.use((request, response, next) => {
  const parser = request.path.endsWith('/avatar/connect') ? avatarJsonParser : standardJsonParser;
  parser(request, response, next);
});

app.get('/healthz', (_request, response) => {
  response.json({ status: 'ok' });
});

app.post('/api/sessions', (request, response) => {
  if (!isAllowedOrigin(request.headers.origin)) {
    response.status(403).json({ error: 'Origin is not allowed.' });
    return;
  }

  const rateLimit = sessionRateLimiter.consume(request.socket.remoteAddress ?? 'unknown');
  if (!rateLimit.allowed) {
    sendRateLimited(response, rateLimit.retryAfterSeconds);
    return;
  }

  try {
    const session = sessions.create();
    session.avatar = new AvatarSession({
      sessionId: session.id,
      relayProvider: avatarRelayClient,
      connector: avatarConnector,
      idleTimeoutMs: config.AVATAR_IDLE_TIMEOUT_MS,
      maxConnectionMs: config.AVATAR_MAX_CONNECTION_MS,
      clientConfig: {
        iceGatheringTimeoutMs: config.AVATAR_ICE_GATHERING_TIMEOUT_MS,
        videoStallTimeoutMs: config.AVATAR_VIDEO_STALL_TIMEOUT_MS,
        reconnectMaxAttempts: config.AVATAR_RECONNECT_MAX_ATTEMPTS,
        reconnectBaseDelayMs: config.AVATAR_RECONNECT_BASE_DELAY_MS,
      },
      sendEvent: (event) => session.sendEvent(event),
    });
    session.dispose = () => session.avatar?.dispose() ?? Promise.resolve();
    response.status(201).json(
      SessionCreateResponseSchema.parse({
        sessionId: session.id,
        webSocketPath: `/api/audio?sessionId=${session.id}`,
        expiresAt: new Date(session.expiresAt).toISOString(),
      }),
    );
  } catch {
    response.status(503).json({ error: 'Session capacity reached.' });
  }
});

app.post('/api/sessions/:sessionId/avatar/prepare', async (request, response) => {
  if (!isAllowedOrigin(request.headers.origin)) {
    response.status(403).json({ error: 'Origin is not allowed.' });
    return;
  }

  const session = getSessionFromPath(request.params.sessionId);
  if (!session?.avatar) {
    response.status(404).json({ error: 'Session not found.' });
    return;
  }
  if (!beginSessionOperation(session, 'avatar', avatarRateLimiter)) {
    sendRateLimited(response, 60);
    return;
  }

  try {
    response.json(AvatarPrepareResponseSchema.parse(await session.avatar.prepare()));
  } catch {
    response.status(503).json({
      error: 'Avatar relay is unavailable.',
      code: 'AVATAR_RELAY_UNAVAILABLE',
      retryable: true,
    });
  } finally {
    session.activeOperations.delete('avatar');
  }
});

app.post('/api/sessions/:sessionId/avatar/connect', async (request, response) => {
  if (!isAllowedOrigin(request.headers.origin)) {
    response.status(403).json({ error: 'Origin is not allowed.' });
    return;
  }

  const session = getSessionFromPath(request.params.sessionId);
  if (!session?.avatar) {
    response.status(404).json({ error: 'Session not found.' });
    return;
  }
  const parsedRequest = AvatarConnectRequestSchema.safeParse(request.body);
  if (!parsedRequest.success) {
    response.status(400).json({ error: 'Invalid avatar offer.' });
    return;
  }
  if (!beginSessionOperation(session, 'avatar', avatarRateLimiter)) {
    sendRateLimited(response, 60);
    return;
  }

  try {
    const result = await session.avatar.connect(
      parsedRequest.data.connectionId,
      parsedRequest.data.offer,
    );
    response.json(AvatarConnectResponseSchema.parse(result));
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes('stale')) {
      response.status(409).json({ error: 'Avatar connection is stale.' });
      return;
    }
    response.status(503).json({
      error: 'Avatar connection failed.',
      code: 'AVATAR_CONNECT_FAILED',
      retryable: true,
    });
  } finally {
    session.activeOperations.delete('avatar');
  }
});

app.delete('/api/sessions/:sessionId/avatar', async (request, response) => {
  if (!isAllowedOrigin(request.headers.origin)) {
    response.status(403).json({ error: 'Origin is not allowed.' });
    return;
  }

  const session = getSessionFromPath(request.params.sessionId);
  if (!session?.avatar) {
    response.status(404).json({ error: 'Session not found.' });
    return;
  }
  if (!beginSessionOperation(session, 'avatar', avatarRateLimiter)) {
    sendRateLimited(response, 60);
    return;
  }
  try {
    await session.avatar.disconnect();
    response.sendStatus(204);
  } finally {
    session.activeOperations.delete('avatar');
  }
});

app.post('/api/answer', async (request, response) => {
  if (!isAllowedOrigin(request.headers.origin)) {
    response.status(403).json({ error: 'Origin is not allowed.' });
    return;
  }

  const parsedRequest = AnswerRequestSchema.safeParse(request.body);
  if (!parsedRequest.success) {
    response.status(400).json({ error: 'Invalid answer request.' });
    return;
  }
  const session = sessions.get(parsedRequest.data.sessionId);
  if (!session) {
    response.status(404).json({ error: 'Session not found.' });
    return;
  }
  if (!beginSessionOperation(session, 'answer', answerRateLimiter)) {
    sendRateLimited(response, 60);
    return;
  }

  let activeTurn;
  try {
    activeTurn = session.turnCoordinator.start(
      parsedRequest.data.turnId,
      parsedRequest.data.question,
    );
  } catch (cause) {
    if (cause instanceof TurnStartError) {
      session.activeOperations.delete('answer');
      response.status(409).json({ error: 'Turn is not available.' });
      return;
    }
    throw cause;
  }

  const writer = new SseWriter(response);
  response.once('close', () => {
    if (!response.writableEnded) session.turnCoordinator.cancelActive();
  });
  try {
    await answerService.run(parsedRequest.data, activeTurn, session.turnCoordinator, (event) =>
      writer.write(event),
    );
  } catch (cause) {
    if (!writer.closed && session.turnCoordinator.isCurrent(activeTurn)) {
      await writer.write({
        type: 'error',
        sessionId: parsedRequest.data.sessionId,
        turnId: parsedRequest.data.turnId,
        ...classifyAnswerError(cause),
      });
    }
    session.turnCoordinator.cancelActive();
  } finally {
    session.activeOperations.delete('answer');
    writer.end();
  }
});

app.delete('/api/sessions/:sessionId', async (request, response) => {
  if (!isAllowedOrigin(request.headers.origin)) {
    response.status(403).json({ error: 'Origin is not allowed.' });
    return;
  }

  const parsedId = SessionIdSchema.safeParse(request.params.sessionId);
  if (!parsedId.success || !(await sessions.delete(parsedId.data))) {
    response.status(404).json({ error: 'Session not found.' });
    return;
  }
  response.sendStatus(204);
});

server.on('upgrade', (request, socket, head) => {
  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const sessionIdResult = SessionIdSchema.safeParse(requestUrl.searchParams.get('sessionId'));
  if (
    requestUrl.pathname !== '/api/audio' ||
    !isAllowedOrigin(request.headers.origin) ||
    !sessionIdResult.success
  ) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }

  const session = sessions.get(sessionIdResult.data);
  if (!session || session.connected) {
    socket.write('HTTP/1.1 409 Conflict\r\n\r\n');
    socket.destroy();
    return;
  }

  webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
    session.connected = true;
    let interruptionIssued = false;
    const frameRateLimiter = new FixedWindowRateLimiter(config.AUDIO_FRAME_RATE_PER_SECOND, 1_000);
    const byteRateLimiter = new FixedWindowRateLimiter(config.AUDIO_BYTES_PER_SECOND, 1_000);
    let audioStartedAt = 0;
    const interruptPlayback = (beginCycle = false): void => {
      if (beginCycle) interruptionIssued = false;
      if (interruptionIssued) return;
      interruptionIssued = true;
      session.turnCoordinator.invalidate();
      void session.avatar?.stopSpeaking();
      send({
        type: 'playback.stop',
        sessionId: session.id,
        timestamp: new Date().toISOString(),
        epoch: session.turnCoordinator.generation,
      });
    };
    const send = (event: ServerEvent): void => {
      if (event.type === 'speech.started') {
        interruptPlayback();
      }
      if (event.type === 'stt.recognized') {
        session.turnCoordinator.recordPending(event.turnId, event.text);
      }
      if (webSocket.readyState === WebSocket.OPEN) {
        webSocket.send(JSON.stringify(ServerEventSchema.parse(event)));
      }
    };
    session.sendEvent = send;
    const audioSession = new SpeechRecognizerSession({
      sessionId: session.id,
      endpoint: config.AZURE_SPEECH_ENDPOINT,
      credential,
      recognitionLanguage: config.SPEECH_RECOGNITION_LANGUAGE,
      phrases: speechPhrases,
      utteranceTimeoutMs: config.SPEECH_UTTERANCE_TIMEOUT_MS,
      finalGraceMs: config.SPEECH_FINAL_GRACE_MS,
      sendEvent: send,
    });
    const disposeAvatar = session.dispose;
    session.dispose = async () => {
      await Promise.allSettled([audioSession.close(), disposeAvatar()]);
      if (webSocket.readyState === WebSocket.OPEN) webSocket.close(1000, 'Session ended.');
    };

    send({ type: 'session.ready', sessionId: session.id, timestamp: new Date().toISOString() });

    let operations = Promise.resolve();
    webSocket.on('message', (data, isBinary) => {
      const binaryFrame = isBinary ? toArrayBuffer(data) : undefined;
      const textMessage = isBinary ? undefined : data.toString();
      operations = operations
        .then(async () => {
          if (!sessions.get(session.id)) return;
          if (binaryFrame) {
            const frameLimit = frameRateLimiter.consume('audio');
            const byteLimit = byteRateLimiter.consume('audio', binaryFrame.byteLength);
            if (
              !frameLimit.allowed ||
              !byteLimit.allowed ||
              audioStartedAt === 0 ||
              Date.now() - audioStartedAt > config.MAX_AUDIO_DURATION_SECONDS * 1_000
            ) {
              sendAudioLimitError(send, session.id);
              webSocket.close(1008, 'Audio limit exceeded.');
              return;
            }
            audioSession.write(binaryFrame);
            return;
          }

          if (Buffer.byteLength(textMessage ?? '', 'utf8') > config.MAX_CONTROL_MESSAGE_BYTES) {
            sendInvalidAudioError(send, session.id);
            webSocket.close(1009, 'Control message too large.');
            return;
          }

          const message = ClientMessageSchema.parse(JSON.parse(textMessage ?? ''));
          if (message.type === 'audio.start') {
            interruptPlayback(true);
            audioStartedAt = Date.now();
            await audioSession.start();
          }
          if (message.type === 'audio.end') {
            audioStartedAt = 0;
            audioSession.end();
          }
          if (message.type === 'cancel') {
            interruptPlayback(true);
            audioStartedAt = 0;
            await audioSession.cancel();
          }
        })
        .catch((cause: unknown) => {
          if (cause instanceof SpeechSessionOperationError) {
            send({
              type: 'error',
              sessionId: session.id,
              timestamp: new Date().toISOString(),
              code: cause.code,
              retryable: cause.retryable,
              stage: 'speech',
              correlationId: randomUUID(),
            });
            webSocket.close(1011, 'Speech service unavailable.');
          } else {
            sendInvalidAudioError(send, session.id);
            webSocket.close(1008, 'Invalid audio message.');
          }
        });
    });

    webSocket.once('close', () => {
      operations = operations.finally(() => sessions.delete(session.id)).then(() => undefined);
    });
  });
});

if (config.NODE_ENV === 'production') {
  registerStaticWeb(app, fileURLToPath(new URL('../../web/dist', import.meta.url)));
}

app.use((cause: unknown, _request: Request, response: Response, _next: NextFunction) => {
  const status =
    cause && typeof cause === 'object' && 'status' in cause && cause.status === 413 ? 413 : 400;
  response.status(status).json({
    error: status === 413 ? 'Request body is too large.' : 'Invalid JSON body.',
    code: status === 413 ? 'BODY_TOO_LARGE' : 'INVALID_JSON',
  });
});

function toArrayBuffer(data: RawData): ArrayBuffer {
  const bytes = Buffer.isBuffer(data)
    ? data
    : data instanceof ArrayBuffer
      ? Buffer.from(data)
      : Buffer.concat(data as Buffer[]);
  return Uint8Array.from(bytes).buffer;
}

function sendInvalidAudioError(
  send: (event: ServerEvent) => void,
  sessionId: ServerEvent['sessionId'],
): void {
  send({
    type: 'error',
    sessionId,
    timestamp: new Date().toISOString(),
    code: 'INVALID_AUDIO_MESSAGE',
    retryable: false,
    stage: 'audio',
    correlationId: randomUUID(),
  });
}

function sendAudioLimitError(
  send: (event: ServerEvent) => void,
  sessionId: ServerEvent['sessionId'],
): void {
  send({
    type: 'error',
    sessionId,
    timestamp: new Date().toISOString(),
    code: 'AUDIO_RATE_LIMITED',
    retryable: true,
    stage: 'audio',
    correlationId: randomUUID(),
  });
}

function sendRateLimited(response: Response, retryAfterSeconds: number): void {
  response.setHeader('Retry-After', retryAfterSeconds);
  response.status(429).json({ error: 'Rate limit exceeded.', code: 'RATE_LIMITED' });
}

function beginSessionOperation(
  session: ReturnType<typeof getSessionFromPath> & {},
  operation: 'answer' | 'avatar',
  limiter: FixedWindowRateLimiter,
): boolean {
  if (session.activeOperations.has(operation)) return false;
  const result = limiter.consume(session.id);
  if (!result.allowed) return false;
  session.activeOperations.add(operation);
  return true;
}

function isAllowedOrigin(origin: string | undefined): boolean {
  return origin === config.ALLOWED_ORIGIN;
}

function getSessionFromPath(value: string | undefined) {
  const parsedId = SessionIdSchema.safeParse(value);
  return parsedId.success ? sessions.get(parsedId.data) : undefined;
}

function classifyAnswerError(cause: unknown): Pick<AnswerError, 'code' | 'retryable' | 'stage'> {
  if (cause instanceof ServiceError) {
    return { code: cause.code, retryable: cause.retryable, stage: cause.stage };
  }
  return { code: 'ANSWER_FAILED', retryable: true, stage: 'generation' };
}

server.listen(config.PORT, () => {
  safeLog({ event: 'server.started', port: config.PORT });
});

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await sessions.close();
  webSocketServer.close();
  server.close(() => process.exit(0));
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
