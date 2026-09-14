@description('Azure region for Azure AI Search.')
param location string

@description('Globally unique Azure AI Search service name.')
param name string

@description('Tags applied to the search service.')
param tags object = {}

module searchService 'br/public:avm/res/search/search-service:0.13.0' = {
  name: 'deploy-search'
  params: {
    name: name
    location: location
    sku: 'basic'
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
    semanticSearch: 'free'
    partitionCount: 1
    replicaCount: 1
    tags: tags
  }
}

output endpoint string = searchService.outputs.endpoint
output name string = searchService.outputs.name
output resourceId string = searchService.outputs.resourceId
