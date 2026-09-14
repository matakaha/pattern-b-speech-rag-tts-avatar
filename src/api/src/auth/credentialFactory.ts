import type { TokenCredential } from '@azure/core-auth';
import { DefaultAzureCredential, ManagedIdentityCredential } from '@azure/identity';

import type { AppConfig } from '../config.js';

interface CredentialProviders {
  createLocalCredential: () => TokenCredential;
  createAzureCredential: () => TokenCredential;
}

const defaultProviders: CredentialProviders = {
  createLocalCredential: () => new DefaultAzureCredential(),
  createAzureCredential: () => new ManagedIdentityCredential(),
};

export function createCredential(
  runtime: AppConfig['APPLICATION_RUNTIME'],
  providers: CredentialProviders = defaultProviders,
): TokenCredential {
  return runtime === 'azure'
    ? providers.createAzureCredential()
    : providers.createLocalCredential();
}
