import type { SearchIndex } from '@azure/search-documents';
import { describe, expect, it } from 'vitest';

import {
  assertKnowledgeIndexCompatible,
  assertSearchIndexIsWritable,
} from '../../scripts/searchSafety.js';

function createCompatibleIndex(): SearchIndex {
  return {
    name: 'knowledge-index',
    fields: [
      { name: 'chunkId', type: 'Edm.String', key: true },
      { name: 'title', type: 'Edm.String' },
      { name: 'content', type: 'Edm.String' },
      { name: 'sourceUri', type: 'Edm.String' },
      { name: 'category', type: 'Edm.String' },
      { name: 'tags', type: 'Collection(Edm.String)' },
      { name: 'intents', type: 'Collection(Edm.String)' },
      { name: 'locale', type: 'Edm.String' },
      {
        name: 'contentVector',
        type: 'Collection(Edm.Single)',
        vectorSearchDimensions: 1536,
        vectorSearchProfileName: 'knowledge-vector-profile',
      },
    ],
    vectorSearch: {
      algorithms: [{ name: 'knowledge-hnsw', kind: 'hnsw' }],
      profiles: [
        {
          name: 'knowledge-vector-profile',
          algorithmConfigurationName: 'knowledge-hnsw',
        },
      ],
    },
    semanticSearch: {
      configurations: [
        {
          name: 'knowledge-semantic',
          prioritizedFields: { contentFields: [{ name: 'content' }] },
        },
      ],
    },
  };
}

describe('shared Search safety', () => {
  it('blocks write scripts from the shared index', () => {
    expect(() => assertSearchIndexIsWritable('knowledge-index')).toThrow('shared read-only');
    expect(() => assertSearchIndexIsWritable('local-fixture')).not.toThrow();
  });

  it('accepts the confirmed knowledge index schema', () => {
    expect(() =>
      assertKnowledgeIndexCompatible(createCompatibleIndex(), 'knowledge-semantic', 1536),
    ).not.toThrow();
  });

  it('rejects an incompatible vector dimension', () => {
    expect(() =>
      assertKnowledgeIndexCompatible(createCompatibleIndex(), 'knowledge-semantic', 3072),
    ).toThrow('dimensions');
  });
});
