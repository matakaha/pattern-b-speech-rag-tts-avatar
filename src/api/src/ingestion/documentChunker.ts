import { createHash } from 'node:crypto';

import type { Root, RootContent } from 'mdast';
import { toString } from 'mdast-util-to-string';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

export interface DocumentChunk {
  chunkId: string;
  documentId: string;
  content: string;
}

export function chunkDocument(
  documentPath: string,
  content: string,
  maxCharacters = 1_500,
  overlapCharacters = 150,
): DocumentChunk[] {
  if (maxCharacters <= overlapCharacters || overlapCharacters < 0) {
    throw new Error('Chunk overlap must be non-negative and smaller than chunk size.');
  }
  const documentId = createHash('sha256').update(documentPath).digest('hex').slice(0, 24);
  const sections = documentPath.toLowerCase().endsWith('.md')
    ? markdownSections(content)
    : content.split(/\n\s*\n/gu).map((part) => part.trim());
  const chunks: DocumentChunk[] = [];
  let buffer = '';

  for (const section of sections.filter(Boolean)) {
    if (buffer && buffer.length + section.length + 2 > maxCharacters) {
      chunks.push(createChunk(documentId, chunks.length, buffer));
      buffer = buffer.slice(Math.max(0, buffer.length - overlapCharacters));
    }
    buffer = [buffer, section].filter(Boolean).join('\n\n');
    while (buffer.length > maxCharacters) {
      const splitAt = findSplit(buffer, maxCharacters);
      chunks.push(createChunk(documentId, chunks.length, buffer.slice(0, splitAt)));
      buffer = buffer.slice(Math.max(0, splitAt - overlapCharacters));
    }
  }
  if (buffer.trim()) chunks.push(createChunk(documentId, chunks.length, buffer));
  return chunks;
}

function markdownSections(content: string): string[] {
  const root = unified().use(remarkParse).parse(content) as Root;
  const sections: string[] = [];
  let heading = '';
  for (const node of root.children) {
    if (node.type === 'heading') {
      heading = `${'#'.repeat(node.depth)} ${toString(node)}`;
      continue;
    }
    const text = textFromNode(node);
    if (text) sections.push([heading, text].filter(Boolean).join('\n'));
  }
  return sections;
}

function textFromNode(node: RootContent): string {
  if (node.type === 'thematicBreak' || node.type === 'html' || node.type === 'definition')
    return '';
  return toString(node).trim();
}

function findSplit(value: string, limit: number): number {
  const paragraph = value.lastIndexOf('\n\n', limit);
  if (paragraph > limit / 2) return paragraph + 2;
  const sentence = Math.max(value.lastIndexOf('。', limit), value.lastIndexOf('\n', limit));
  return sentence > limit / 2 ? sentence + 1 : limit;
}

function createChunk(documentId: string, ordinal: number, content: string): DocumentChunk {
  const normalized = content.trim();
  const hash = createHash('sha256').update(normalized).digest('hex').slice(0, 16);
  return {
    documentId,
    chunkId: `${documentId}-${ordinal.toString().padStart(4, '0')}-${hash}`,
    content: normalized,
  };
}
