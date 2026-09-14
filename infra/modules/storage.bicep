@description('Azure region for the storage account.')
param location string

@description('Globally unique storage account name.')
@minLength(3)
@maxLength(24)
param name string

@description('Tags applied to the storage account.')
param tags object = {}

module storageAccount 'br/public:avm/res/storage/storage-account:0.33.0' = {
  name: 'deploy-storage'
  params: {
    name: name
    location: location
    kind: 'StorageV2'
    skuName: 'Standard_LRS'
    accessTier: 'Hot'
    allowBlobPublicAccess: false
    allowCrossTenantReplication: false
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    minimumTlsVersion: 'TLS1_2'
    publicNetworkAccess: 'Enabled'
    supportsHttpsTrafficOnly: true
    tags: tags
  }
}

output name string = storageAccount.outputs.name
output primaryBlobEndpoint string = storageAccount.outputs.primaryBlobEndpoint
output resourceId string = storageAccount.outputs.resourceId
