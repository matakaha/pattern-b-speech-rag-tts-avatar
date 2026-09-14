@description('Azure region for Azure AI Speech.')
param location string

@description('Globally unique Azure AI Speech account name.')
param name string

@description('Log Analytics workspace resource ID for diagnostics.')
param logAnalyticsResourceId string

@description('Tags applied to the Speech account.')
param tags object = {}

module speechAccount 'br/public:avm/res/cognitive-services/account:0.19.0' = {
  name: 'deploy-speech'
  params: {
    kind: 'SpeechServices'
    name: name
    location: location
    sku: 'S0'
    customSubDomainName: name
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
    diagnosticSettings: [
      {
        name: 'send-to-log-analytics'
        workspaceResourceId: logAnalyticsResourceId
      }
    ]
    tags: tags
  }
}

output endpoint string = speechAccount.outputs.endpoint
output name string = speechAccount.outputs.name
output resourceId string = speechAccount.outputs.resourceId
