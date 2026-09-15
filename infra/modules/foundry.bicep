@description('Existing Microsoft Foundry account name.')
param accountName string

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

resource foundryAccount 'Microsoft.CognitiveServices/accounts@2025-06-01' existing = {
  name: accountName
}

resource chatDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: foundryAccount
  name: chatDeploymentName
  sku: {
    name: chatDeploymentSku
    capacity: chatDeploymentCapacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: chatModelName
      version: chatModelVersion
    }
    versionUpgradeOption: 'OnceNewDefaultVersionAvailable'
  }
}

output baseUrl string = 'https://${accountName}.services.ai.azure.com/openai/v1/'
output name string = foundryAccount.name
output resourceId string = foundryAccount.id
