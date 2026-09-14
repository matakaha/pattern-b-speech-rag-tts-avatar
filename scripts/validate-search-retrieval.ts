import { readFile } from 'node:fs/promises';

import { DefaultAzureCredential } from '@azure/identity';
import { SearchClient } from '@azure/search-documents';

import { loadSearchConfig } from './scriptConfig.js';

interface ComparisonFixture {
  search: { topK: number };
  questions: Array<{
    id: string;
    question: string;
    expectedFaqId: string;
    expectedSourcePath: string;
  }>;
}

interface KnowledgeDocument {
  chunkId: string;
  title: string;
  sourceUri: string;
}

const config = loadSearchConfig();
const fixture = JSON.parse(
  await readFile(new URL('../tests/fixtures/pattern-comparison.json', import.meta.url), 'utf8'),
) as ComparisonFixture;
const client = new SearchClient<KnowledgeDocument>(
  config.AZURE_SEARCH_ENDPOINT,
  config.AZURE_SEARCH_INDEX,
  new DefaultAzureCredential(),
);
const failures: string[] = [];

for (const question of fixture.questions) {
  const response = await client.search(question.question, {
    queryType: 'semantic',
    semanticSearchOptions: { configurationName: config.AZURE_SEARCH_SEMANTIC_CONFIG },
    select: ['chunkId', 'title', 'sourceUri'],
    top: fixture.search.topK,
  });
  const results: KnowledgeDocument[] = [];
  for await (const result of response.results) results.push(result.document);
  const matched = results.some(
    ({ chunkId, sourceUri }) =>
      chunkId.includes(question.expectedFaqId) || sourceUri.endsWith(question.expectedSourcePath),
  );
  console.log(
    JSON.stringify({
      event: 'search.question.validated',
      questionId: question.id,
      expectedFaqId: question.expectedFaqId,
      resultCount: results.length,
      matched,
    }),
  );
  if (!matched) failures.push(question.id);
}

if (failures.length > 0) {
  throw new Error(`Expected FAQ was not returned in the top results for: ${failures.join(', ')}.`);
}
