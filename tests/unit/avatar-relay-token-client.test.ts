import type { AccessToken, GetTokenOptions, TokenCredential } from '@azure/core-auth';
import { describe, expect, it, vi } from 'vitest';

import {
  AvatarRelayError,
  AvatarRelayTokenClient,
} from '../../src/api/src/avatar/AvatarRelayTokenClient.js';

class FakeCredential implements TokenCredential {
  async getToken(scopes: string | string[], _options?: GetTokenOptions): Promise<AccessToken> {
    expect(scopes).toBe('https://cognitiveservices.azure.com/.default');
    return { token: 'managed-identity-token', expiresOnTimestamp: Date.now() + 60_000 };
  }
}

describe('AvatarRelayTokenClient', () => {
  it('uses a bearer token and returns TURN-only credentials', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe(
        'https://speech.example.com/tts/cognitiveservices/avatar/relay/token/v1',
      );
      expect(init?.headers).toEqual({ Authorization: 'Bearer managed-identity-token' });
      return Response.json({
        Urls: ['stun:ignored.example.com', 'turn:relay.example.com:3478'],
        Username: 'relay-user',
        Password: 'relay-password',
      });
    });
    const client = new AvatarRelayTokenClient(
      'https://speech.example.com',
      new FakeCredential(),
      1_000,
      fetcher,
    );

    await expect(client.getIceServers()).resolves.toEqual([
      {
        urls: ['turn:relay.example.com:3478'],
        username: 'relay-user',
        credential: 'relay-password',
      },
    ]);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('maps invalid relay responses to a safe error', async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ Urls: ['stun:only.example.com'], Username: 'user', Password: 'password' }),
    );
    const client = new AvatarRelayTokenClient(
      'https://speech.example.com',
      new FakeCredential(),
      1_000,
      fetcher,
    );

    await expect(client.getIceServers()).rejects.toBeInstanceOf(AvatarRelayError);
  });
});
