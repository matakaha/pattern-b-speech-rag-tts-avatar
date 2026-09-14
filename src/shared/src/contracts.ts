import { z } from 'zod';

export const SessionIdSchema = z.string().uuid().brand<'SessionId'>();
export type SessionId = z.infer<typeof SessionIdSchema>;

export const TurnIdSchema = z.string().uuid().brand<'TurnId'>();
export type TurnId = z.infer<typeof TurnIdSchema>;

export const AvatarConnectionIdSchema = z.string().uuid().brand<'AvatarConnectionId'>();
export type AvatarConnectionId = z.infer<typeof AvatarConnectionIdSchema>;

const IceServerUrlSchema = z
  .string()
  .min(1)
  .max(2_048)
  .refine((value) => value.startsWith('turn:') || value.startsWith('turns:'), {
    message: 'Only TURN relay URLs are allowed.',
  });

export const AvatarIceServerSchema = z.object({
  urls: z.array(IceServerUrlSchema).min(1).max(8),
  username: z.string().min(1).max(1_024),
  credential: z.string().min(1).max(4_096),
});
export type AvatarIceServer = z.infer<typeof AvatarIceServerSchema>;

export const AvatarPrepareResponseSchema = z.object({
  connectionId: AvatarConnectionIdSchema,
  iceServers: z.array(AvatarIceServerSchema).min(1).max(4),
  clientConfig: z.object({
    iceGatheringTimeoutMs: z.number().int().min(1_000).max(30_000),
    videoStallTimeoutMs: z.number().int().min(1_000).max(30_000),
    reconnectMaxAttempts: z.number().int().min(0).max(10),
    reconnectBaseDelayMs: z.number().int().min(100).max(30_000),
  }),
});
export type AvatarPrepareResponse = z.infer<typeof AvatarPrepareResponseSchema>;

const SessionDescriptionSchema = z.object({
  sdp: z.string().min(1).max(128_000),
});

export const AvatarConnectRequestSchema = z.object({
  connectionId: AvatarConnectionIdSchema,
  offer: SessionDescriptionSchema.extend({ type: z.literal('offer') }),
});
export type AvatarConnectRequest = z.infer<typeof AvatarConnectRequestSchema>;

export const AvatarConnectResponseSchema = z.object({
  connectionId: AvatarConnectionIdSchema,
  answer: SessionDescriptionSchema.extend({ type: z.literal('answer') }),
});
export type AvatarConnectResponse = z.infer<typeof AvatarConnectResponseSchema>;

export const AvatarErrorCodeSchema = z.enum([
  'AVATAR_RELAY_UNAVAILABLE',
  'AVATAR_CONNECT_FAILED',
  'AVATAR_CONNECTION_EXPIRED',
  'AVATAR_TRANSPORT_LOST',
  'AVATAR_SYNTHESIS_FAILED',
]);
export type AvatarErrorCode = z.infer<typeof AvatarErrorCodeSchema>;

const AnswerTextSchema = z.string().trim().min(1).max(4_000);

export const AnswerHistoryItemSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(8_000),
});
export type AnswerHistoryItem = z.infer<typeof AnswerHistoryItemSchema>;

export const AnswerRequestSchema = z.object({
  sessionId: SessionIdSchema,
  turnId: TurnIdSchema,
  question: AnswerTextSchema,
  history: z.array(AnswerHistoryItemSchema).max(10).default([]),
});
export type AnswerRequest = z.infer<typeof AnswerRequestSchema>;

const AnswerEventBaseSchema = z.object({
  sessionId: SessionIdSchema,
  turnId: TurnIdSchema,
});

export const AnswerStreamEventSchema = z.discriminatedUnion('type', [
  AnswerEventBaseSchema.extend({
    type: z.literal('retrieval'),
    durationMs: z.number().int().nonnegative(),
    count: z.number().int().nonnegative(),
  }),
  AnswerEventBaseSchema.extend({
    type: z.literal('citation'),
    citationId: z.string().regex(/^C[1-9]\d*$/),
    chunkId: z.string().min(1),
    title: z.string().min(1),
    sourceUrl: z.string().url().startsWith('https://'),
  }),
  AnswerEventBaseSchema.extend({
    type: z.literal('delta'),
    text: z.string().min(1),
  }),
  AnswerEventBaseSchema.extend({
    type: z.literal('sentence'),
    sequence: z.number().int().positive(),
    text: z.string().min(1),
  }),
  AnswerEventBaseSchema.extend({
    type: z.literal('done'),
    usage: z.object({
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      totalTokens: z.number().int().nonnegative(),
    }),
  }),
  AnswerEventBaseSchema.extend({
    type: z.literal('error'),
    code: z.enum([
      'SEARCH_AUTH_FAILED',
      'SEARCH_UNAVAILABLE',
      'EMBEDDING_AUTH_FAILED',
      'EMBEDDING_UNAVAILABLE',
      'EMBEDDING_INVALID_RESPONSE',
      'MODEL_AUTH_FAILED',
      'MODEL_NOT_FOUND',
      'MODEL_RATE_LIMITED',
      'MODEL_CONTENT_FILTERED',
      'MODEL_TIMEOUT',
      'MODEL_UNAVAILABLE',
      'ANSWER_CANCELED',
      'ANSWER_FAILED',
    ]),
    retryable: z.boolean(),
    stage: z.enum(['retrieval', 'embedding', 'generation', 'synthesis', 'transport']),
  }),
]);
export type AnswerStreamEvent = z.infer<typeof AnswerStreamEventSchema>;

export const SessionCreateResponseSchema = z.object({
  sessionId: SessionIdSchema,
  webSocketPath: z.string().startsWith('/'),
  expiresAt: z.string().datetime(),
});
export type SessionCreateResponse = z.infer<typeof SessionCreateResponseSchema>;

export const AudioStartMessageSchema = z.object({
  type: z.literal('audio.start'),
  sampleRate: z.literal(16_000),
  channels: z.literal(1),
  encoding: z.literal('pcm_s16le'),
});

export const AudioEndMessageSchema = z.object({ type: z.literal('audio.end') });
export const CancelMessageSchema = z.object({ type: z.literal('cancel') });

export const ClientMessageSchema = z.discriminatedUnion('type', [
  AudioStartMessageSchema,
  AudioEndMessageSchema,
  CancelMessageSchema,
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

const EventBaseSchema = z.object({
  sessionId: SessionIdSchema,
  timestamp: z.string().datetime(),
});

export const ServerEventSchema = z.discriminatedUnion('type', [
  EventBaseSchema.extend({ type: z.literal('session.ready') }),
  EventBaseSchema.extend({
    type: z.literal('avatar.connecting'),
    connectionId: AvatarConnectionIdSchema,
  }),
  EventBaseSchema.extend({
    type: z.literal('avatar.ready'),
    connectionId: AvatarConnectionIdSchema,
  }),
  EventBaseSchema.extend({
    type: z.literal('avatar.fallback'),
    code: AvatarErrorCodeSchema,
    reconnectable: z.boolean(),
  }),
  EventBaseSchema.extend({
    type: z.literal('avatar.disconnected'),
    reason: z.enum(['client', 'idle', 'lifetime', 'transport', 'session-ended']),
    reconnectable: z.boolean(),
  }),
  EventBaseSchema.extend({
    type: z.literal('stt.recognizing'),
    text: z.string(),
  }),
  EventBaseSchema.extend({
    type: z.literal('stt.recognized'),
    turnId: TurnIdSchema,
    text: z.string(),
  }),
  EventBaseSchema.extend({ type: z.literal('speech.started') }),
  EventBaseSchema.extend({ type: z.literal('speech.ended') }),
  EventBaseSchema.extend({
    type: z.literal('playback.stop'),
    epoch: z.number().int().nonnegative(),
  }),
  EventBaseSchema.extend({
    type: z.literal('turn.state'),
    turnId: TurnIdSchema.optional(),
    state: z.enum(['ready', 'listening', 'processing', 'canceling', 'ended']),
  }),
  EventBaseSchema.extend({
    type: z.literal('error'),
    code: z.string(),
    retryable: z.boolean(),
    stage: z.enum(['session', 'audio', 'speech', 'transport']),
    correlationId: z.string().uuid(),
  }),
]);
export type ServerEvent = z.infer<typeof ServerEventSchema>;
