import { describe, expect, it } from 'vitest';

import { createSearchIndexDefinition } from '../../src/api/src/search/indexDefinition.js';

describe('createSearchIndexDefinition', () => {
  it('uses cosine HNSW and the configured vector dimensions', () => {
    const index = createSearchIndexDefinition('documents', 1_536, 'semantic-config');
    const vectorField = index.fields.find((field) => field.name === 'contentVector');

    expect(vectorField?.vectorSearchDimensions).toBe(1_536);
    expect(vectorField?.stored).toBe(false);
    expect(index.vectorSearch?.algorithms?.[0]).toMatchObject({
      kind: 'hnsw',
      parameters: { metric: 'cosine' },
    });
    expect(index.semanticSearch?.configurations?.[0]?.name).toBe('semantic-config');
  });
});
