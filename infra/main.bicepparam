using './main.bicep'

param location = 'southeastasia'
param environmentName = 'dev'
param appServicePlanSku = 'B1'
param existingSearchResourceGroupName = 'rg-voice-live-avatar-rag-dev'
param existingSearchServiceName = 'srch-dev-zmh4qttuqdrbi'
param searchIndexName = 'knowledge-index'
param searchSemanticConfigName = 'knowledge-semantic'
param embeddingDimensions = 1536
param existingFoundryResourceGroupName = 'rg-voice-live-avatar-rag-dev'
param existingFoundryAccountName = 'aif-dev-zmh4qttuqdrbi'
param chatDeploymentName = 'gpt-5-mini'
param chatModelName = 'gpt-5-mini'
param chatModelVersion = '2025-08-07'
param chatDeploymentSku = 'GlobalStandard'
param chatDeploymentCapacity = 10
param embeddingDeploymentName = 'text-embedding-3-small'
param tags = {
  workload: 'pattern-b-speech-rag-tts-avatar'
}
