import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

import {
  ClientMessageSchema,
  ServerEventSchema,
  SessionCreateResponseSchema,
  SessionIdSchema,
  type ServerEvent,
} from '@pattern-b/shared';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';

import { loadConfig } from './config.js';
import { SessionManager } from './sessions/SessionManager.js';
import { MockAudioSession } from './speech/MockAudioSession.js';

const config = loadConfig();
const app = express();
const server = createServer(app);
const webSocketServer = new WebSocketServer({
  noServer: true,
  maxPayload: config.MAX_AUDIO_FRAME_BYTES,
});
const sessions = new SessionManager(config.SESSION_TTL_SECONDS * 1_000, config.MAX_SESSIONS);

app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));

app.get('/healthz', (_request, response) => {
  response.json({ status: 'ok' });
});

app.post('/api/sessions', (request, response) => {
  if (!isAllowedOrigin(request.headers.origin)) {
    response.status(403).json({ error: 'Origin is not allowed.' });
    return;
  }

  try {
    const session = sessions.create();
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

app.delete('/api/sessions/:sessionId', (request, response) => {
  if (!isAllowedOrigin(request.headers.origin)) {
    response.status(403).json({ error: 'Origin is not allowed.' });
    return;
  }

  const parsedId = SessionIdSchema.safeParse(request.params.sessionId);
  if (!parsedId.success || !sessions.delete(parsedId.data)) {
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
    const send = (event: ServerEvent): void => {
      if (webSocket.readyState === WebSocket.OPEN) {
        webSocket.send(JSON.stringify(ServerEventSchema.parse(event)));
      }
    };
    const audioSession = new MockAudioSession(session.id, send);
    session.dispose = () => {
      audioSession.close();
      webSocket.close(1000, 'Session ended.');
    };

    send({ type: 'session.ready', sessionId: session.id, timestamp: new Date().toISOString() });

    webSocket.on('message', (data, isBinary) => {
      try {
        sessions.get(session.id);
        if (isBinary) {
          const bytes = Buffer.isBuffer(data)
            ? data
            : data instanceof ArrayBuffer
              ? Buffer.from(data)
              : Buffer.concat(data);
          audioSession.write(Uint8Array.from(bytes).buffer);
          return;
        }

        const message = ClientMessageSchema.parse(JSON.parse(data.toString()));
        if (message.type === 'audio.start') audioSession.start();
        if (message.type === 'audio.end') audioSession.end();
        if (message.type === 'cancel') audioSession.cancel();
      } catch {
        send({
          type: 'error',
          sessionId: session.id,
          timestamp: new Date().toISOString(),
          code: 'INVALID_AUDIO_MESSAGE',
          retryable: false,
          stage: 'audio',
          correlationId: randomUUID(),
        });
        webSocket.close(1008, 'Invalid audio message.');
      }
    });

    webSocket.once('close', () => sessions.delete(session.id));
  });
});

function isAllowedOrigin(origin: string | undefined): boolean {
  return origin === config.ALLOWED_ORIGIN;
}

server.listen(config.PORT, () => {
  console.log(JSON.stringify({ event: 'server.started', port: config.PORT }));
});

function shutdown(): void {
  sessions.close();
  webSocketServer.close();
  server.close(() => process.exit(0));
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
