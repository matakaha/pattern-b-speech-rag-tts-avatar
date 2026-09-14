import { z } from 'zod';

const FoundryBaseUrlSchema = z
  .string()
  .url()
  .startsWith('https://')
  .refine((value) => value.endsWith('/openai/v1/'), {
    message: 'AZURE_FOUNDRY_BASE_URL must end with /openai/v1/.',
  });

const ConfigSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APPLICATION_RUNTIME: z.enum(['local', 'azure']).default('local'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    ALLOWED_ORIGIN: z.string().url().default('http://localhost:5173'),
    SESSION_TTL_SECONDS: z.coerce.number().int().min(30).max(3_600).default(1_800),
    MAX_SESSIONS: z.coerce.number().int().min(1).max(1_000).default(20),
    MAX_AUDIO_FRAME_BYTES: z.coerce.number().int().min(1_024).max(65_536).default(32_768),
    SESSION_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(1_000).default(10),
    ANSWER_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(1_000).default(20),
    AVATAR_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(1_000).default(10),
    AUDIO_FRAME_RATE_PER_SECOND: z.coerce.number().int().min(1).max(1_000).default(160),
    AUDIO_BYTES_PER_SECOND: z.coerce.number().int().min(1_024).max(1_048_576).default(65_536),
    MAX_AUDIO_DURATION_SECONDS: z.coerce.number().int().min(1).max(300).default(30),
    MAX_CONTROL_MESSAGE_BYTES: z.coerce.number().int().min(64).max(16_384).default(1_024),
    REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(120_000),
    AZURE_SPEECH_ENDPOINT: z.string().url().startsWith('https://'),
    SPEECH_RECOGNITION_LANGUAGE: z.string().min(2).default('ja-JP'),
    SPEECH_UTTERANCE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(15_000),
    SPEECH_FINAL_GRACE_MS: z.coerce.number().int().min(0).max(5_000).default(750),
    SPEECH_PHRASES: z.string().default(''),
    SPEECH_SYNTHESIS_VOICE: z.string().min(1).default('ja-JP-NanamiNeural'),
    AVATAR_CHARACTER: z.string().min(1).default('lisa'),
    AVATAR_STYLE: z.string().min(1).default('casual-sitting'),
    AVATAR_RELAY_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
    AVATAR_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
    AVATAR_SPEAK_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(120_000),
    AVATAR_CLOSE_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(5_000),
    AVATAR_IDLE_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(600_000).default(300_000),
    AVATAR_MAX_CONNECTION_MS: z.coerce.number().int().min(60_000).max(3_600_000).default(1_800_000),
    AVATAR_RECONNECT_MAX_ATTEMPTS: z.coerce.number().int().min(0).max(10).default(3),
    AVATAR_RECONNECT_BASE_DELAY_MS: z.coerce.number().int().min(100).max(30_000).default(1_000),
    AVATAR_ICE_GATHERING_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(10_000),
    AVATAR_VIDEO_STALL_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(4_000),
    AZURE_SEARCH_ENDPOINT: z.string().url().startsWith('https://'),
    AZURE_SEARCH_INDEX: z.string().min(1),
    AZURE_SEARCH_SEMANTIC_CONFIG: z.string().min(1).default('knowledge-semantic'),
    AZURE_FOUNDRY_BASE_URL: FoundryBaseUrlSchema,
    AZURE_CHAT_DEPLOYMENT: z.string().min(1),
    AZURE_EMBEDDING_DEPLOYMENT: z.string().min(1),
    AZURE_EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().max(4_096).default(1_536),
    SEARCH_TOP_K: z.coerce.number().int().min(1).max(20).default(5),
    MAX_ANSWER_QUESTION_CHARS: z.coerce.number().int().min(100).max(20_000).default(4_000),
    MAX_ANSWER_HISTORY_ITEMS: z.coerce.number().int().min(0).max(50).default(10),
    MAX_ANSWER_HISTORY_CHARS: z.coerce.number().int().min(0).max(100_000).default(12_000),
    MAX_RAG_CONTEXT_CHARS: z.coerce.number().int().min(1_000).max(200_000).default(24_000),
    MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1).max(32_768).default(1_024),
    SEARCH_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(15_000),
    EMBEDDING_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
    MODEL_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(120_000),
    MIN_SENTENCE_CHARS: z.coerce.number().int().min(1).max(1_000).default(8),
    MAX_SENTENCE_CHARS: z.coerce.number().int().min(20).max(5_000).default(240),
    SYNTHESIS_QUEUE_LIMIT: z.coerce.number().int().min(1).max(1_000).default(50),
  })
  .superRefine((config, context) => {
    if (config.NODE_ENV === 'production' && config.APPLICATION_RUNTIME !== 'azure') {
      context.addIssue({
        code: 'custom',
        path: ['APPLICATION_RUNTIME'],
        message: 'APPLICATION_RUNTIME must be azure in production.',
      });
    }

    if (config.MIN_SENTENCE_CHARS >= config.MAX_SENTENCE_CHARS) {
      context.addIssue({
        code: 'custom',
        path: ['MIN_SENTENCE_CHARS'],
        message: 'MIN_SENTENCE_CHARS must be less than MAX_SENTENCE_CHARS.',
      });
    }

    if (config.AVATAR_IDLE_TIMEOUT_MS >= config.AVATAR_MAX_CONNECTION_MS) {
      context.addIssue({
        code: 'custom',
        path: ['AVATAR_IDLE_TIMEOUT_MS'],
        message: 'AVATAR_IDLE_TIMEOUT_MS must be less than AVATAR_MAX_CONNECTION_MS.',
      });
    }
  });

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  return ConfigSchema.parse(environment);
}
