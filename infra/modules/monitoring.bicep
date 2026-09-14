@description('Azure region for monitoring resources.')
param location string

@description('Log Analytics workspace name.')
param logAnalyticsName string

@description('Application Insights component name.')
param applicationInsightsName string

@description('Log retention period in days.')
@minValue(30)
param retentionInDays int = 30

@description('Maximum daily Log Analytics ingestion in GB.')
@minValue(0)
param dailyQuotaGb int = 1

@description('Tags applied to monitoring resources.')
param tags object = {}

module logAnalytics 'br/public:avm/res/operational-insights/workspace:0.16.1' = {
  name: 'deploy-log-analytics'
  params: {
    name: logAnalyticsName
    location: location
    skuName: 'PerGB2018'
    dataRetention: retentionInDays
    dailyQuotaGb: string(dailyQuotaGb)
    features: {
      disableLocalAuth: true
      enableLogAccessUsingOnlyResourcePermissions: true
    }
    tags: tags
  }
}

module applicationInsights 'br/public:avm/res/insights/component:0.8.0' = {
  name: 'deploy-application-insights'
  params: {
    name: applicationInsightsName
    location: location
    applicationType: 'web'
    kind: 'web'
    workspaceResourceId: logAnalytics.outputs.resourceId
    disableLocalAuth: true
    tags: tags
  }
}

output applicationInsightsConnectionString string = applicationInsights.outputs.connectionString
output applicationInsightsResourceId string = applicationInsights.outputs.resourceId
output logAnalyticsResourceId string = logAnalytics.outputs.resourceId
