import { describe, expect, it } from 'vitest';

import { SentenceChunker } from '../../src/api/src/rag/SentenceChunker.js';

describe('SentenceChunker', () => {
  it('joins split deltas until a Japanese sentence boundary', () => {
    const chunker = new SentenceChunker(4, 40);

    expect(chunker.push('これは回答')).toEqual([]);
    expect(chunker.push('です。次です！')).toEqual(['これは回答です。', '次です！']);
    expect(chunker.flush()).toEqual([]);
  });

  it('removes citation markers and URLs from synthesis text', () => {
    const chunker = new SentenceChunker(1, 100);

    expect(chunker.push('資料です [C1] https://example.com/path。')).toEqual(['資料です']);
  });

  it('splits an oversized sentence at a Japanese comma', () => {
    const chunker = new SentenceChunker(4, 12);

    expect(chunker.push('これは長い文章です、さらに続きます')).toEqual(['これは長い文章です、']);
    expect(chunker.flush()).toEqual(['さらに続きます']);
  });
});
