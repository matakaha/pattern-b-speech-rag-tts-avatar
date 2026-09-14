import { DefaultAzureCredential } from '@azure/identity';
import { SearchIndexClient, type SearchIndex } from '@azure/search-documents';

import { createSearchIndexDefinition } from '../src/api/src/search/indexDefinition.js';
import { loadScriptConfig } from './scriptConfig.js';
import { assertSearchIndexIsWritable } from './searchSafety.js';

const config = loadScriptConfig();
const dryRun = process.argv.includes('--dry-run');
const recreate = process.argv.includes('--recreate');
const desired = createSearchIndexDefinition(
  config.AZURE_SEARCH_INDEX,
  config.AZURE_EMBEDDING_DIMENSIONS,
  config.AZURE_SEARCH_SEMANTIC_CONFIG,
);

if (!dryRun) assertSearchIndexIsWritable(config.AZURE_SEARCH_INDEX);

console.log(
  JSON.stringify({
    endpoint: config.AZURE_SEARCH_ENDPOINT,
    index: config.AZURE_SEARCH_INDEX,
    dimensions: config.AZURE_EMBEDDING_DIMENSIONS,
    dryRun,
    recreate,
  }),
);
if (!dryRun) await applyIndex(desired);

async function applyIndex(index: SearchIndex): Promise<void> {
  const client = new SearchIndexClient(config.AZURE_SEARCH_ENDPOINT, new DefaultAzureCredential());
  let existing: SearchIndex | undefined;
  try {
    existing = await client.getIndex(config.AZURE_SEARCH_INDEX);
  } catch (cause) {
    if (getStatus(cause) !== 404) throw cause;
  }

  if (existing && recreate) {
    await client.deleteIndex(config.AZURE_SEARCH_INDEX);
    existing = undefined;
  }
  if (existing) {
    assertCompatible(existing, index);
    console.log(JSON.stringify({ event: 'search.index.compatible', index: index.name }));
    return;
  }
  await client.createIndex(index);
  console.log(JSON.stringify({ event: 'search.index.created', index: index.name }));
}

function assertCompatible(existing: SearchIndex, desiredIndex: SearchIndex): void {
  for (const desiredField of desiredIndex.fields) {
    const existingField = existing.fields.find((field) => field.name === desiredField.name);
    if (
      !existingField ||
      existingField.type !== desiredField.type ||
      getVectorDimensions(existingField) !== getVectorDimensions(desiredField)
    ) {
      throw new Error(
        `Index field ${desiredField.name} is incompatible. Review the index and use --recreate explicitly if data loss is acceptable.`,
      );
    }
  }
}

function getVectorDimensions(field: SearchIndex['fields'][number]): number | undefined {
  return 'vectorSearchDimensions' in field ? field.vectorSearchDimensions : undefined;
}

function getStatus(cause: unknown): number | undefined {
  if (!cause || typeof cause !== 'object' || !('statusCode' in cause)) return undefined;
  return typeof cause.statusCode === 'number' ? cause.statusCode : undefined;
}
