import { SearchClient } from '@azure/search-documents';
import type { TokenCredential } from '@azure/core-auth';

import type { EmbeddingProvider } from '../llm/FoundryEmbeddingProvider.js';
import { mapServiceError } from '../errors/ServiceError.js';

interface KnowledgeSearchDocument {
  chunkId: string;
  title: string;
  content: string;
  sourceUri: string;
  category: string;
  tags: string[];
  intents: string[];
  locale: string;
  contentVector: number[];
}

export interface RetrievedChunk {
  citationId: string;
  chunkId: string;
  title: string;
  content: string;
  sourceUrl: string;
}

export class SearchRetriever {
  readonly #client: SearchClient<KnowledgeSearchDocument>;

  constructor(
    endpoint: string,
    indexName: string,
    credential: TokenCredential,
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly semanticConfigurationName: string,
    private readonly topK: number,
    private readonly maxContextChars: number,
  ) {
    this.#client = new SearchClient<KnowledgeSearchDocument>(endpoint, indexName, credential);
  }

  async retrieve(question: string, signal: AbortSignal): Promise<RetrievedChunk[]> {
    const [vector] = await this.embeddingProvider.embed([question], signal);
    if (!vector) throw new Error('Question embedding was not returned.');

    let results;
    try {
      results = await this.#client.search(
        question,
        createKnowledgeSearchOptions(vector, this.semanticConfigurationName, this.topK, signal),
      );
    } catch (cause) {
      throw mapServiceError(cause, 'retrieval');
    }

    const chunks: RetrievedChunk[] = [];
    let usedCharacters = 0;
    for await (const result of results.results) {
      const document = result.document;
      const sourceUrl = resolveFaqSourceUrl(document.sourceUri);
      if (!sourceUrl) continue;
      const remaining = this.maxContextChars - usedCharacters;
      if (remaining <= 0) break;
      const content = document.content.slice(0, remaining);
      if (!content) continue;
      chunks.push({
        citationId: `C${chunks.length + 1}`,
        chunkId: document.chunkId,
        title: document.title,
        content,
        sourceUrl,
      });
      usedCharacters += content.length;
    }
    return chunks;
  }
}

export function resolveFaqSourceUrl(sourceUri: string): string | undefined {
  let url: URL;
  try {
    url = new URL(sourceUri);
  } catch {
    return undefined;
  }

  if (url.protocol !== 'https:' || url.hostname !== 'github.com') return undefined;

  const segments = url.pathname.split('/').filter(Boolean);
  const [owner, repository, view, branch, root, ...fileSegments] = segments;
  if (
    owner !== 'matakaha' ||
    repository !== 'rubberduckexpress' ||
    (view !== 'blob' && view !== 'tree') ||
    branch !== 'main' ||
    root !== 'faq' ||
    fileSegments.length < 2 ||
    !fileSegments.at(-1)?.endsWith('.md') ||
    fileSegments.some((segment) => segment === '.' || segment === '..')
  ) {
    return undefined;
  }

  url.pathname = `/${owner}/${repository}/blob/${branch}/${root}/${fileSegments.join('/')}`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function createKnowledgeSearchOptions(
  vector: number[],
  semanticConfigurationName: string,
  topK: number,
  signal: AbortSignal,
) {
  return {
    abortSignal: signal,
    queryType: 'semantic' as const,
    semanticSearchOptions: { configurationName: semanticConfigurationName },
    select: [
      'chunkId',
      'title',
      'content',
      'sourceUri',
      'category',
      'tags',
      'intents',
      'locale',
    ] as Array<keyof KnowledgeSearchDocument>,
    top: topK,
    vectorSearchOptions: {
      queries: [
        {
          kind: 'vector' as const,
          vector,
          fields: ['contentVector'] as Array<keyof KnowledgeSearchDocument>,
          kNearestNeighborsCount: 50,
        },
      ],
    },
  };
}
