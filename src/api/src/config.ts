import { z } from 'zod';

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  ALLOWED_ORIGIN: z.string().url().default('http://localhost:5173'),
  SESSION_TTL_SECONDS: z.coerce.number().int().min(30).max(3_600).default(1_800),
  MAX_SESSIONS: z.coerce.number().int().min(1).max(1_000).default(20),
  MAX_AUDIO_FRAME_BYTES: z.coerce.number().int().min(1_024).max(65_536).default(32_768),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  return ConfigSchema.parse(environment);
}
