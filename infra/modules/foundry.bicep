@description('Azure region for the Azure OpenAI account.')
param location string

@description('Globally unique Azure OpenAI account name.')
param name string

@description('Chat model deployment name.')
param chatDeploymentName string

@description('Chat model name.')
param chatModelName string

@description('Chat model version.')
param chatModelVersion string

@description('Chat deployment SKU.')
param chatDeploymentSku string

@description('Chat deployment capacity in thousands of tokens per minute.')
@minValue(1)
param chatDeploymentCapacity int

@description('Embedding model deployment name.')
param embeddingDeploymentName string

@description('Embedding model name.')
param embeddingModelName string

@description('Embedding model version.')
param embeddingModelVersion string

@description('Embedding deployment SKU.')
param embeddingDeploymentSku string

@description('Embedding deployment capacity in thousands of tokens per minute.')
@minValue(1)
param embeddingDeploymentCapacity int

@description('Log Analytics workspace resource ID for diagnostics.')
param logAnalyticsResourceId string

@description('Tags applied to the Azure OpenAI account.')
param tags object = {}

module foundryAccount 'br/public:avm/res/cognitive-services/account:0.19.0' = {
  name: 'deploy-foundry'
  params: {
    kind: 'OpenAI'
    name: name
    location: location
    sku: 'S0'
    customSubDomainName: name
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
    deployments: [
      {
        name: chatDeploymentName
        model: {
          format: 'OpenAI'
          name: chatModelName
          version: chatModelVersion
        }
        sku: {
          name: chatDeploymentSku
          capacity: chatDeploymentCapacity
        }
      }
      {
        name: embeddingDeploymentName
        model: {
          format: 'OpenAI'
          name: embeddingModelName
          version: embeddingModelVersion
        }
        sku: {
          name: embeddingDeploymentSku
          capacity: embeddingDeploymentCapacity
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

output baseUrl string = '${foundryAccount.outputs.endpoint}openai/v1/'
output name string = foundryAccount.outputs.name
output resourceId string = foundryAccount.outputs.resourceId
