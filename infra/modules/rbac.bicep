@description('Object ID of the Web App managed identity.')
param principalId string

@description('Azure AI Speech account name.')
param speechAccountName string

@description('Azure OpenAI account name.')
param foundryAccountName string

var speechUserRoleId = 'f2dc8367-1007-4938-bd23-fe263f013447'
var openAiUserRoleId = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'

resource speechAccount 'Microsoft.CognitiveServices/accounts@2025-06-01' existing = {
  name: speechAccountName
}

resource foundryAccount 'Microsoft.CognitiveServices/accounts@2025-06-01' existing = {
  name: foundryAccountName
}

resource speechUserRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' existing = {
  name: speechUserRoleId
}

resource openAiUserRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' existing = {
  name: openAiUserRoleId
}

resource speechUserAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(speechAccount.id, principalId, speechUserRole.id)
  scope: speechAccount
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: speechUserRole.id
  }
}

resource openAiUserAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(foundryAccount.id, principalId, openAiUserRole.id)
  scope: foundryAccount
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: openAiUserRole.id
  }
}
