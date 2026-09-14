import type { TokenCredential } from '@azure/core-auth';
import { getBearerTokenProvider } from '@azure/identity';
import OpenAI from 'openai';

const FOUNDRY_SCOPE = 'https://ai.azure.com/.default';

export function createFoundryClient(
  credential: TokenCredential,
  baseURL: string,
  timeoutMs: number,
): OpenAI {
  return new OpenAI({
    baseURL,
    apiKey: getBearerTokenProvider(credential, FOUNDRY_SCOPE),
    timeout: timeoutMs,
    maxRetries: 0,
  });
}
