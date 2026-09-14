import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { DefaultAzureCredential } from '@azure/identity';
import { SearchClient } from '@azure/search-documents';

import { chunkDocument } from '../src/api/src/ingestion/documentChunker.js';
import { DocumentManifestSchema } from '../src/api/src/ingestion/manifest.js';
import { FoundryEmbeddingProvider } from '../src/api/src/llm/FoundryEmbeddingProvider.js';
import { createFoundryClient } from '../src/api/src/llm/FoundryClientFactory.js';
import type { SearchDocument } from '../src/api/src/search/indexDefinition.js';
import { loadScriptConfig } from './scriptConfig.js';
import { assertSearchIndexIsWritable } from './searchSafety.js';

const config = loadScriptConfig();
const dryRun = process.argv.includes('--dry-run');
if (!dryRun) assertSearchIndexIsWritable(config.AZURE_SEARCH_INDEX);
const manifestPath = resolve('docs/data/manifest.json');
const manifest = DocumentManifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
const documents: Omit<SearchDocument, 'contentVector'>[] = [];

for (const item of manifest.documents) {
  const path = resolve('docs/data', item.path);
  const content = await readFile(path, 'utf8');
  for (const chunk of chunkDocument(item.path, content)) {
    documents.push({
      ...chunk,
      title: item.title,
      sourceUrl: item.sourceUrl,
      acl: item.acl,
    });
  }
}

console.log(
  JSON.stringify({
    endpoint: config.AZURE_SEARCH_ENDPOINT,
    index: config.AZURE_SEARCH_INDEX,
    files: manifest.documents.length,
    chunks: documents.length,
    embeddingRequests: Math.ceil(documents.length / 16),
    dryRun,
  }),
);
if (!dryRun) await ingest();

async function ingest(): Promise<void> {
  const credential = new DefaultAzureCredential();
  const foundry = createFoundryClient(credential, config.AZURE_FOUNDRY_BASE_URL, 30_000);
  const embeddingProvider = new FoundryEmbeddingProvider(
    foundry,
    config.AZURE_EMBEDDING_DEPLOYMENT,
    config.AZURE_EMBEDDING_DIMENSIONS,
  );
  const searchClient = new SearchClient<SearchDocument>(
    config.AZURE_SEARCH_ENDPOINT,
    config.AZURE_SEARCH_INDEX,
    credential,
  );
  const currentKeys = new Set(documents.map((document) => document.chunkId));
  const documentIds = new Set(documents.map((document) => document.documentId));
  const stale: string[] = [];
  for (const documentId of documentIds) {
    const results = await searchClient.search('*', {
      filter: `documentId eq '${documentId}'`,
      select: ['chunkId'],
    });
    for await (const result of results.results) {
      if (!currentKeys.has(result.document.chunkId)) stale.push(result.document.chunkId);
    }
  }
  if (stale.length > 0) await searchClient.deleteDocuments('chunkId', stale);

  for (let offset = 0; offset < documents.length; offset += 16) {
    const batch = documents.slice(offset, offset + 16);
    const vectors = await embeddingProvider.embed(batch.map((document) => document.content));
    const upload = batch.map((document, index) => ({
      ...document,
      contentVector: vectors[index] ?? [],
    }));
    const result = await searchClient.uploadDocuments(upload);
    const failed = result.results.filter((item) => !item.succeeded);
    if (failed.length > 0) throw new Error(`${failed.length} search documents failed to upload.`);
  }
  console.log(JSON.stringify({ event: 'search.documents.ingested', count: documents.length }));
}
