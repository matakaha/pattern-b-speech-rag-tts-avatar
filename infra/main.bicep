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

@description('Subscription containing the existing Microsoft Foundry account.')
param existingFoundrySubscriptionId string = subscription().subscriptionId

@description('Resource group containing the existing Microsoft Foundry account.')
param existingFoundryResourceGroupName string = 'rg-voice-live-avatar-rag-dev'

@description('Existing Microsoft Foundry account name.')
param existingFoundryAccountName string = 'aif-dev-zmh4qttuqdrbi'

@description('Chat model deployment name.')
param chatDeploymentName string = 'gpt-5-mini'

@description('Chat model name.')
param chatModelName string = 'gpt-5-mini'

@description('Chat model version.')
param chatModelVersion string = '2025-08-07'

@description('Chat model deployment SKU.')
param chatDeploymentSku string = 'GlobalStandard'

@description('Chat model deployment capacity in thousands of tokens per minute.')
@minValue(1)
param chatDeploymentCapacity int = 10

@description('Embedding model deployment name.')
param embeddingDeploymentName string = 'text-embedding-3-small'

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
  scope: resourceGroup(existingFoundrySubscriptionId, existingFoundryResourceGroupName)
  params: {
    accountName: existingFoundryAccountName
    chatDeploymentName: chatDeploymentName
    chatModelName: chatModelName
    chatModelVersion: chatModelVersion
    chatDeploymentSku: chatDeploymentSku
    chatDeploymentCapacity: chatDeploymentCapacity
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

module speechRbac './modules/rbac.bicep' = {
  name: 'speech-rbac'
  params: {
    principalId: hosting.outputs.principalId
    accountName: speech.outputs.name
    roleDefinitionId: 'f2dc8367-1007-4938-bd23-fe263f013447'
  }
}

module foundryRbac './modules/rbac.bicep' = {
  name: 'foundry-rbac'
  scope: resourceGroup(existingFoundrySubscriptionId, existingFoundryResourceGroupName)
  params: {
    principalId: hosting.outputs.principalId
    accountName: existingFoundryAccountName
    roleDefinitionId: '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'
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
