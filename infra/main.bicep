targetScope = 'resourceGroup'

@description('Primary Azure region.')
param location string = 'southeastasia'

@description('Short environment name used in resource names.')
@minLength(2)
@maxLength(8)
param environmentName string = 'dev'

@description('Optional stable suffix. A deterministic suffix is generated when omitted.')
param resourceSuffix string = ''

@description('Tags applied to all resources.')
param tags object = {}

@description('App Service Plan SKU.')
param appServicePlanSku string = 'B1'

@description('Subscription containing the existing shared Azure AI Search service.')
param existingSearchSubscriptionId string = subscription().subscriptionId

@description('Resource group containing the existing shared Azure AI Search service.')
param existingSearchResourceGroupName string = 'rg-voice-live-avatar-rag-dev'

@description('Existing shared Azure AI Search service name.')
param existingSearchServiceName string = 'srch-dev-zmh4qttuqdrbi'

@description('Existing shared Azure AI Search index name.')
param searchIndexName string = 'knowledge-index'

@description('Semantic configuration defined on the existing shared index.')
param searchSemanticConfigName string = 'knowledge-semantic'

@description('Embedding vector dimensions. Must match the selected embedding model and Search index.')
@minValue(1)
param embeddingDimensions int = 1536

@description('Chat model deployment name.')
param chatDeploymentName string = 'chat'

@description('Chat model name.')
param chatModelName string = 'gpt-4o-mini'

@description('Chat model version.')
param chatModelVersion string = '2024-07-18'

@description('Chat model deployment SKU.')
param chatDeploymentSku string = 'GlobalStandard'

@description('Chat model deployment capacity in thousands of tokens per minute.')
@minValue(1)
param chatDeploymentCapacity int = 10

@description('Embedding model deployment name.')
param embeddingDeploymentName string = 'embedding'

@description('Embedding model name.')
param embeddingModelName string = 'text-embedding-3-small'

@description('Embedding model version.')
param embeddingModelVersion string = '1'

@description('Embedding model deployment SKU.')
param embeddingDeploymentSku string = 'Standard'

@description('Embedding model deployment capacity in thousands of tokens per minute.')
@minValue(1)
param embeddingDeploymentCapacity int = 10

var normalizedSuffix = toLower(replace(resourceSuffix, '-', ''))
var generatedSuffix = substring(uniqueString(subscription().subscriptionId, resourceGroup().id, environmentName), 0, 6)
var suffix = empty(normalizedSuffix) ? generatedSuffix : normalizedSuffix
var namePrefix = 'pbavatar-${environmentName}'
var commonTags = union(tags, {
  environment: environmentName
  workload: 'pattern-b-speech-rag-tts-avatar'
})
var searchEndpoint = 'https://${existingSearchServiceName}.search.windows.net'

resource existingSearchService 'Microsoft.Search/searchServices@2025-05-01' existing = {
  name: existingSearchServiceName
  scope: resourceGroup(existingSearchSubscriptionId, existingSearchResourceGroupName)
}

module monitoring './modules/monitoring.bicep' = {
  name: 'monitoring'
  params: {
    location: location
    logAnalyticsName: '${namePrefix}-log-${suffix}'
    applicationInsightsName: '${namePrefix}-appi-${suffix}'
    tags: commonTags
  }
}

module storage './modules/storage.bicep' = {
  name: 'storage'
  params: {
    location: location
    name: 'pbavatar${environmentName}${suffix}'
    tags: commonTags
  }
}

module speech './modules/speech.bicep' = {
  name: 'speech'
  params: {
    location: location
    name: '${namePrefix}-speech-${suffix}'
    logAnalyticsResourceId: monitoring.outputs.logAnalyticsResourceId
    tags: commonTags
  }
}

module foundry './modules/foundry.bicep' = {
  name: 'foundry'
  params: {
    location: location
    name: '${namePrefix}-openai-${suffix}'
    chatDeploymentName: chatDeploymentName
    chatModelName: chatModelName
    chatModelVersion: chatModelVersion
    chatDeploymentSku: chatDeploymentSku
    chatDeploymentCapacity: chatDeploymentCapacity
    embeddingDeploymentName: embeddingDeploymentName
    embeddingModelName: embeddingModelName
    embeddingModelVersion: embeddingModelVersion
    embeddingDeploymentSku: embeddingDeploymentSku
    embeddingDeploymentCapacity: embeddingDeploymentCapacity
    logAnalyticsResourceId: monitoring.outputs.logAnalyticsResourceId
    tags: commonTags
  }
}

module hosting './modules/hosting.bicep' = {
  name: 'hosting'
  params: {
    location: location
    appServicePlanName: '${namePrefix}-plan-${suffix}'
    webAppName: '${namePrefix}-app-${suffix}'
    appServicePlanSku: appServicePlanSku
    speechEndpoint: speech.outputs.endpoint
    searchEndpoint: searchEndpoint
    searchIndexName: searchIndexName
    searchSemanticConfigName: searchSemanticConfigName
    foundryBaseUrl: foundry.outputs.baseUrl
    chatDeploymentName: chatDeploymentName
    embeddingDeploymentName: embeddingDeploymentName
    embeddingDimensions: embeddingDimensions
    applicationInsightsResourceId: monitoring.outputs.applicationInsightsResourceId
    logAnalyticsResourceId: monitoring.outputs.logAnalyticsResourceId
    tags: commonTags
  }
}

module rbac './modules/rbac.bicep' = {
  name: 'rbac'
  params: {
    principalId: hosting.outputs.principalId
    speechAccountName: speech.outputs.name
    foundryAccountName: foundry.outputs.name
  }
}

output applicationInsightsConnectionString string = monitoring.outputs.applicationInsightsConnectionString
output appName string = hosting.outputs.name
output appPrincipalId string = hosting.outputs.principalId
output appUrl string = 'https://${hosting.outputs.defaultHostname}'
output chatDeploymentName string = chatDeploymentName
output embeddingDeploymentName string = embeddingDeploymentName
output foundryBaseUrl string = foundry.outputs.baseUrl
output foundryResourceId string = foundry.outputs.resourceId
output searchEndpoint string = searchEndpoint
output searchIndexResourceId string = '${existingSearchService.id}/indexes/${searchIndexName}'
output searchIndexName string = searchIndexName
output searchResourceId string = existingSearchService.id
output searchSemanticConfigName string = searchSemanticConfigName
output speechEndpoint string = speech.outputs.endpoint
output speechResourceId string = speech.outputs.resourceId
output storageBlobEndpoint string = storage.outputs.primaryBlobEndpoint
