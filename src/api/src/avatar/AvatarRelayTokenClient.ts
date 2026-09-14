import type { TokenCredential } from '@azure/core-auth';
import { AvatarIceServerSchema, type AvatarIceServer } from '@pattern-b/shared';
import { z } from 'zod';

const SPEECH_SCOPE = 'https://cognitiveservices.azure.com/.default';

const RelayResponseSchema = z.object({
  Urls: z.array(z.string().min(1)).min(1),
  Username: z.string().min(1),
  Password: z.string().min(1),
});

export class AvatarRelayError extends Error {
  readonly code = 'AVATAR_RELAY_UNAVAILABLE';
  readonly retryable = true;

  constructor() {
    super('Avatar relay service is unavailable.');
  }
}

export class AvatarRelayTokenClient {
  readonly #relayEndpoint: URL;

  constructor(
    speechEndpoint: string,
    private readonly credential: TokenCredential,
    private readonly timeoutMs: number,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.#relayEndpoint = new URL('/tts/cognitiveservices/avatar/relay/token/v1', speechEndpoint);
  }

  async getIceServers(signal?: AbortSignal): Promise<AvatarIceServer[]> {
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), this.timeoutMs);
    const combinedSignal = combineSignals(signal, timeoutController.signal);

    try {
      const accessToken = await this.credential.getToken(SPEECH_SCOPE, {
        abortSignal: combinedSignal,
      });
      if (!accessToken) throw new AvatarRelayError();

      const response = await this.fetcher(this.#relayEndpoint, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken.token}` },
        signal: combinedSignal,
      });
      if (!response.ok) throw new AvatarRelayError();

      const relay = RelayResponseSchema.parse(await response.json());
      const turnUrls = relay.Urls.filter(
        (url) => url.startsWith('turn:') || url.startsWith('turns:'),
      );
      return [
        AvatarIceServerSchema.parse({
          urls: turnUrls,
          username: relay.Username,
          credential: relay.Password,
        }),
      ];
    } catch (cause) {
      if (cause instanceof AvatarRelayError) throw cause;
      throw new AvatarRelayError();
    } finally {
      clearTimeout(timeout);
    }
  }
}

function combineSignals(first: AbortSignal | undefined, second: AbortSignal): AbortSignal {
  if (!first) return second;
  return AbortSignal.any([first, second]);
}
