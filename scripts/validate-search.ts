import { DefaultAzureCredential } from '@azure/identity';
import { SearchIndexClient } from '@azure/search-documents';

import { loadSearchConfig } from './scriptConfig.js';
import { assertKnowledgeIndexCompatible } from './searchSafety.js';

const config = loadSearchConfig();
const client = new SearchIndexClient(config.AZURE_SEARCH_ENDPOINT, new DefaultAzureCredential());
const index = await client.getIndex(config.AZURE_SEARCH_INDEX);

assertKnowledgeIndexCompatible(
  index,
  config.AZURE_SEARCH_SEMANTIC_CONFIG,
  config.AZURE_EMBEDDING_DIMENSIONS,
);

console.log(
  JSON.stringify({
    event: 'search.index.compatible',
    endpoint: config.AZURE_SEARCH_ENDPOINT,
    index: config.AZURE_SEARCH_INDEX,
    semanticConfiguration: config.AZURE_SEARCH_SEMANTIC_CONFIG,
    dimensions: config.AZURE_EMBEDDING_DIMENSIONS,
  }),
);
