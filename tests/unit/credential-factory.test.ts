import type { TokenCredential } from '@azure/core-auth';
import { describe, expect, it, vi } from 'vitest';

import { createCredential } from '../../src/api/src/auth/credentialFactory.js';

const credential = {} as TokenCredential;

describe('createCredential', () => {
  it('uses DefaultAzureCredential only for local execution', () => {
    const createLocalCredential = vi.fn(() => credential);
    const createAzureCredential = vi.fn(() => credential);

    expect(createCredential('local', { createLocalCredential, createAzureCredential })).toBe(
      credential,
    );
    expect(createLocalCredential).toHaveBeenCalledOnce();
    expect(createAzureCredential).not.toHaveBeenCalled();
  });

  it('uses ManagedIdentityCredential only for Azure execution', () => {
    const createLocalCredential = vi.fn(() => credential);
    const createAzureCredential = vi.fn(() => credential);

    expect(createCredential('azure', { createLocalCredential, createAzureCredential })).toBe(
      credential,
    );
    expect(createAzureCredential).toHaveBeenCalledOnce();
    expect(createLocalCredential).not.toHaveBeenCalled();
  });
});
