import { describe, expect, it } from 'vitest';

import { chunkDocument } from '../../src/api/src/ingestion/documentChunker.js';

describe('chunkDocument', () => {
  it('preserves Markdown headings and creates deterministic identifiers', () => {
    const markdown = '# Guide\n\n## Leave\n\nApply from the portal.\n\nAsk HR for help.';

    const first = chunkDocument('guide.md', markdown, 40, 5);
    const second = chunkDocument('guide.md', markdown, 40, 5);

    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
    expect(first.map((chunk) => chunk.content).join('\n')).toContain('## Leave');
  });

  it('rejects an overlap that cannot advance the chunk window', () => {
    expect(() => chunkDocument('guide.txt', 'content', 10, 10)).toThrow('overlap');
  });
});
