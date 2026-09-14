import type { SearchIndex } from '@azure/search-documents';

export const SHARED_SEARCH_INDEX = 'knowledge-index';
export const SHARED_VECTOR_PROFILE = 'knowledge-vector-profile';

export function assertSearchIndexIsWritable(indexName: string): void {
  if (indexName === SHARED_SEARCH_INDEX) {
    throw new Error(
      `${SHARED_SEARCH_INDEX} is shared read-only data. Index creation and ingestion are disabled.`,
    );
  }
}

export function assertKnowledgeIndexCompatible(
  index: SearchIndex,
  semanticConfigurationName: string,
  embeddingDimensions: number,
): void {
  const expectedFields = new Map([
    ['chunkId', 'Edm.String'],
    ['title', 'Edm.String'],
    ['content', 'Edm.String'],
    ['sourceUri', 'Edm.String'],
    ['category', 'Edm.String'],
    ['tags', 'Collection(Edm.String)'],
    ['intents', 'Collection(Edm.String)'],
    ['locale', 'Edm.String'],
    ['contentVector', 'Collection(Edm.Single)'],
  ]);

  for (const [name, type] of expectedFields) {
    const field = index.fields.find((candidate) => candidate.name === name);
    if (!field || field.type !== type) {
      throw new Error(`Shared Search index field ${name} must have type ${type}.`);
    }
  }

  const vectorField = index.fields.find((field) => field.name === 'contentVector');
  const dimensions =
    vectorField && 'vectorSearchDimensions' in vectorField
      ? vectorField.vectorSearchDimensions
      : undefined;
  const profileName =
    vectorField && 'vectorSearchProfileName' in vectorField
      ? vectorField.vectorSearchProfileName
      : undefined;
  if (dimensions !== embeddingDimensions) {
    throw new Error(
      `contentVector dimensions must be ${embeddingDimensions}, received ${dimensions}.`,
    );
  }
  if (profileName !== SHARED_VECTOR_PROFILE) {
    throw new Error(`contentVector must use vector profile ${SHARED_VECTOR_PROFILE}.`);
  }

  const semanticConfigurations = index.semanticSearch?.configurations ?? [];
  if (!semanticConfigurations.some(({ name }) => name === semanticConfigurationName)) {
    throw new Error(`Semantic configuration ${semanticConfigurationName} was not found.`);
  }
  if (!index.vectorSearch?.profiles?.some(({ name }) => name === SHARED_VECTOR_PROFILE)) {
    throw new Error(`Vector profile ${SHARED_VECTOR_PROFILE} was not found.`);
  }
}
