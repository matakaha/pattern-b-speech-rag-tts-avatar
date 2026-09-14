import type { SearchIndex } from '@azure/search-documents';

export interface SearchDocument {
  chunkId: string;
  documentId: string;
  title: string;
  content: string;
  sourceUrl: string;
  acl: string[];
  contentVector: number[];
}

export function createSearchIndexDefinition(
  name: string,
  dimensions: number,
  semanticConfigurationName: string,
): SearchIndex {
  return {
    name,
    fields: [
      { name: 'chunkId', type: 'Edm.String', key: true, filterable: true },
      { name: 'documentId', type: 'Edm.String', filterable: true },
      { name: 'title', type: 'Edm.String', searchable: true },
      { name: 'content', type: 'Edm.String', searchable: true },
      { name: 'sourceUrl', type: 'Edm.String' },
      { name: 'acl', type: 'Collection(Edm.String)', filterable: true },
      {
        name: 'contentVector',
        type: 'Collection(Edm.Single)',
        searchable: true,
        stored: false,
        vectorSearchDimensions: dimensions,
        vectorSearchProfileName: 'content-vector-profile',
      },
    ],
    vectorSearch: {
      algorithms: [
        {
          name: 'content-hnsw',
          kind: 'hnsw',
          parameters: { metric: 'cosine' },
        },
      ],
      profiles: [{ name: 'content-vector-profile', algorithmConfigurationName: 'content-hnsw' }],
    },
    semanticSearch: {
      configurations: [
        {
          name: semanticConfigurationName,
          prioritizedFields: {
            titleField: { name: 'title' },
            contentFields: [{ name: 'content' }],
            keywordsFields: [],
          },
        },
      ],
    },
  };
}
