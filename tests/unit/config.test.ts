import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/api/src/config.js';

const phase3Environment = {
  AZURE_SEARCH_ENDPOINT: 'https://search.example.com',
  AZURE_SEARCH_INDEX: 'documents',
  AZURE_FOUNDRY_BASE_URL: 'https://foundry.example.com/openai/v1/',
  AZURE_CHAT_DEPLOYMENT: 'chat',
  AZURE_EMBEDDING_DEPLOYMENT: 'embedding',
};

describe('loadConfig', () => {
  it('requires an HTTPS Azure Speech endpoint', () => {
    expect(() =>
      loadConfig({ ...phase3Environment, AZURE_SPEECH_ENDPOINT: 'http://speech.example.com' }),
    ).toThrow();
  });

  it('rejects local credentials in production', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        APPLICATION_RUNTIME: 'local',
        AZURE_SPEECH_ENDPOINT: 'https://speech.example.com',
        ...phase3Environment,
      }),
    ).toThrow('APPLICATION_RUNTIME must be azure');
  });

  it('accepts the Azure managed identity runtime in production', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      APPLICATION_RUNTIME: 'azure',
      AZURE_SPEECH_ENDPOINT: 'https://speech.example.com',
      ...phase3Environment,
    });

    expect(config.APPLICATION_RUNTIME).toBe('azure');
  });
});
