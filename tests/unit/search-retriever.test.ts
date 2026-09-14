import { describe, expect, it } from 'vitest';

import {
  createKnowledgeSearchOptions,
  resolveFaqSourceUrl,
} from '../../src/api/src/search/SearchRetriever.js';

describe('createKnowledgeSearchOptions', () => {
  it('uses the shared knowledge index fields without an ACL filter', () => {
    const signal = new AbortController().signal;
    const options = createKnowledgeSearchOptions([0.1, 0.2], 'knowledge-semantic', 5, signal);

    expect(options).not.toHaveProperty('filter');
    expect(options.semanticSearchOptions.configurationName).toBe('knowledge-semantic');
    expect(options.select).toEqual([
      'chunkId',
      'title',
      'content',
      'sourceUri',
      'category',
      'tags',
      'intents',
      'locale',
    ]);
    expect(options.vectorSearchOptions.queries[0]).toMatchObject({
      fields: ['contentVector'],
      kNearestNeighborsCount: 50,
      vector: [0.1, 0.2],
    });
  });
});

describe('resolveFaqSourceUrl', () => {
  it('normalizes a GitHub tree URL to a file URL', () => {
    expect(
      resolveFaqSourceUrl(
        'https://github.com/matakaha/rubberduckexpress/tree/main/faq/01-shipping/RDE-FAQ-002-how-to-ship.md#details',
      ),
    ).toBe(
      'https://github.com/matakaha/rubberduckexpress/blob/main/faq/01-shipping/RDE-FAQ-002-how-to-ship.md',
    );
  });

  it.each([
    'http://github.com/matakaha/rubberduckexpress/blob/main/faq/01-shipping/file.md',
    'https://example.com/matakaha/rubberduckexpress/blob/main/faq/01-shipping/file.md',
    'https://github.com/another/repository/blob/main/faq/01-shipping/file.md',
    'https://github.com/matakaha/rubberduckexpress/blob/main/docs/file.md',
    'https://github.com/matakaha/rubberduckexpress/blob/main/faq/file.txt',
  ])('rejects an untrusted citation URI: %s', (sourceUri) => {
    expect(resolveFaqSourceUrl(sourceUri)).toBeUndefined();
  });
});
