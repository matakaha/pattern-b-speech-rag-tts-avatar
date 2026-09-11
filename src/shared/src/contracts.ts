import { z } from 'zod';

export const SessionIdSchema = z.string().uuid().brand<'SessionId'>();
export type SessionId = z.infer<typeof SessionIdSchema>;

export const TurnIdSchema = z.string().uuid().brand<'TurnId'>();
export type TurnId = z.infer<typeof TurnIdSchema>;

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
    type: z.literal('stt.recognizing'),
    text: z.string(),
  }),
  EventBaseSchema.extend({
    type: z.literal('stt.recognized'),
    turnId: TurnIdSchema,
    text: z.string(),
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
