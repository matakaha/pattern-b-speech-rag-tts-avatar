import { z } from 'zod';

const SearchConfigSchema = z.object({
  AZURE_SEARCH_ENDPOINT: z.string().url().startsWith('https://'),
  AZURE_SEARCH_INDEX: z.string().min(1),
  AZURE_SEARCH_SEMANTIC_CONFIG: z.string().min(1).default('knowledge-semantic'),
  AZURE_EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().max(4_096).default(1_536),
});

const ScriptConfigSchema = SearchConfigSchema.extend({
  AZURE_FOUNDRY_BASE_URL: z
    .string()
    .url()
    .startsWith('https://')
    .refine((value) => value.endsWith('/openai/v1/')),
  AZURE_EMBEDDING_DEPLOYMENT: z.string().min(1),
});

export function loadSearchConfig(environment: NodeJS.ProcessEnv = process.env) {
  return SearchConfigSchema.parse(environment);
}

export function loadScriptConfig(environment: NodeJS.ProcessEnv = process.env) {
  return ScriptConfigSchema.parse(environment);
}
