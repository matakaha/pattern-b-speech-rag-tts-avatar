using './main.bicep'

param location = 'southeastasia'
param environmentName = 'dev'
param appServicePlanSku = 'B1'
param existingSearchResourceGroupName = 'rg-voice-live-avatar-rag-dev'
param existingSearchServiceName = 'srch-dev-zmh4qttuqdrbi'
param searchIndexName = 'knowledge-index'
param searchSemanticConfigName = 'knowledge-semantic'
param embeddingDimensions = 1536
param tags = {
  workload: 'pattern-b-speech-rag-tts-avatar'
}
