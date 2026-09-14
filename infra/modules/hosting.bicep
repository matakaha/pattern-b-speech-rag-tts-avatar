@description('Azure region for App Service resources.')
param location string

@description('App Service Plan name.')
param appServicePlanName string

@description('Globally unique Web App name.')
param webAppName string

@description('App Service Plan SKU.')
param appServicePlanSku string = 'B1'

@description('Azure AI Speech endpoint.')
param speechEndpoint string

@description('Azure AI Search endpoint.')
param searchEndpoint string

@description('Azure AI Search index name.')
param searchIndexName string

@description('Azure AI Search semantic configuration name.')
param searchSemanticConfigName string

@description('Azure OpenAI v1 API base URL.')
param foundryBaseUrl string

@description('Chat model deployment name.')
param chatDeploymentName string

@description('Embedding model deployment name.')
param embeddingDeploymentName string

@description('Embedding vector dimensions.')
@minValue(1)
param embeddingDimensions int

@description('Application Insights resource ID.')
param applicationInsightsResourceId string

@description('Log Analytics workspace resource ID for diagnostics.')
param logAnalyticsResourceId string

@description('Tags applied to App Service resources.')
param tags object = {}

module appServicePlan 'br/public:avm/res/web/serverfarm:0.7.0' = {
  name: 'deploy-app-service-plan'
  params: {
    name: appServicePlanName
    location: location
    kind: 'linux'
    reserved: true
    skuName: appServicePlanSku
    skuCapacity: 1
    zoneRedundant: false
    diagnosticSettings: [
      {
        name: 'send-to-log-analytics'
        workspaceResourceId: logAnalyticsResourceId
      }
    ]
    tags: tags
  }
}

module webApp 'br/public:avm/res/web/site:0.24.0' = {
  name: 'deploy-web-app'
  params: {
    name: webAppName
    location: location
    kind: 'app,linux'
    serverFarmResourceId: appServicePlan.outputs.resourceId
    managedIdentities: {
      systemAssigned: true
    }
    httpsOnly: true
    clientAffinityEnabled: true
    publicNetworkAccess: 'Enabled'
    basicPublishingCredentialsPolicies: [
      {
        name: 'ftp'
        allow: false
      }
      {
        name: 'scm'
        allow: false
      }
    ]
    siteConfig: {
      alwaysOn: true
      appCommandLine: 'npm start'
      ftpsState: 'Disabled'
      healthCheckPath: '/healthz'
      http20Enabled: true
      linuxFxVersion: 'NODE|24-lts'
      minTlsVersion: '1.2'
      remoteDebuggingEnabled: false
      scmMinTlsVersion: '1.2'
      webSocketsEnabled: true
    }
    configs: [
      {
        name: 'appsettings'
        applicationInsightResourceId: applicationInsightsResourceId
        retainCurrentAppSettings: false
        properties: {
          NODE_ENV: 'production'
          APPLICATION_RUNTIME: 'azure'
          ALLOWED_ORIGIN: 'https://${webAppName}.azurewebsites.net'
          AZURE_SPEECH_ENDPOINT: speechEndpoint
          AZURE_SEARCH_ENDPOINT: searchEndpoint
          AZURE_SEARCH_INDEX: searchIndexName
          AZURE_SEARCH_SEMANTIC_CONFIG: searchSemanticConfigName
          AZURE_FOUNDRY_BASE_URL: foundryBaseUrl
          AZURE_CHAT_DEPLOYMENT: chatDeploymentName
          AZURE_EMBEDDING_DEPLOYMENT: embeddingDeploymentName
          AZURE_EMBEDDING_DIMENSIONS: string(embeddingDimensions)
          WEBSITE_RUN_FROM_PACKAGE: '1'
        }
      }
    ]
    diagnosticSettings: [
      {
        name: 'send-to-log-analytics'
        workspaceResourceId: logAnalyticsResourceId
      }
    ]
    tags: tags
  }
}

output defaultHostname string = webApp.outputs.defaultHostname
output name string = webApp.outputs.name
output principalId string = webApp.outputs.systemAssignedMIPrincipalId!
output resourceId string = webApp.outputs.resourceId
