[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ResourceGroupName,

    [string]$Location = 'southeastasia',

    [string]$ParameterFile = 'infra/main.bicepparam',

    [string]$DeploymentName = "pattern-b-$(Get-Date -Format 'yyyyMMdd-HHmmss')",

    [string]$OutputPath = '.artifacts/deployment-outputs.json',

    [string]$ExistingSearchSubscriptionId,

    [string]$ExistingSearchResourceGroupName = 'rg-voice-live-avatar-rag-dev',

    [string]$ExistingSearchServiceName = 'srch-dev-zmh4qttuqdrbi',

    [string]$SearchIndexName = 'knowledge-index',

    [string]$SearchSemanticConfigName = 'knowledge-semantic',

    [string]$ExistingFoundrySubscriptionId,

    [string]$ExistingFoundryResourceGroupName = 'rg-voice-live-avatar-rag-dev',

    [string]$ExistingFoundryAccountName = 'aif-dev-zmh4qttuqdrbi',

    [int]$EmbeddingDimensions = 1536
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$resolvedParameterFile = Join-Path $repoRoot $ParameterFile
$resolvedOutputPath = Join-Path $repoRoot $OutputPath

function Invoke-AzureCli {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = & az @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($exitCode -ne 0) {
        throw "Azure CLI command failed: az $($Arguments -join ' ')`n$($output -join [Environment]::NewLine)"
    }
    return $output
}

function Set-DeploymentParameter {
    param(
        [Parameter(Mandatory = $true)][PSCustomObject]$Parameters,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][object]$Value
    )

    $property = $Parameters.PSObject.Properties[$Name]
    if ($property) {
        $property.Value.value = $Value
        return
    }
    $Parameters | Add-Member -MemberType NoteProperty -Name $Name -Value ([PSCustomObject]@{
        value = $Value
    })
}

function Get-AzureRoleAssignmentCount {
    param(
        [Parameter(Mandatory = $true)][string]$Scope,
        [Parameter(Mandatory = $true)][string]$PrincipalId,
        [Parameter(Mandatory = $true)][string]$RoleDefinitionId
    )

    $filter = [Uri]::EscapeDataString("principalId eq '$PrincipalId'")
    $url = "https://management.azure.com$Scope/providers/Microsoft.Authorization/roleAssignments?api-version=2022-04-01&`$filter=$filter"
    $responseJson = Invoke-AzureCli @(
        'rest', '--method', 'get', '--url', $url,
        '--only-show-errors', '--output', 'json'
    )
    $response = ($responseJson -join [Environment]::NewLine) | ConvertFrom-Json

    return @($response.value | Where-Object {
        $_.properties.principalId -ieq $PrincipalId -and
        $_.properties.roleDefinitionId -ieq $RoleDefinitionId -and
        $_.properties.scope -ieq $Scope
    }).Count
}

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    throw 'Azure CLI is required. Install it and run az login before deployment.'
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw 'npm is required to validate the shared Azure AI Search index before deployment.'
}
if (-not (Test-Path $resolvedParameterFile -PathType Leaf)) {
    throw "Bicep parameter file was not found: $resolvedParameterFile"
}

Invoke-AzureCli @('account', 'show', '--only-show-errors', '--output', 'none') | Out-Null
if (-not $ExistingSearchSubscriptionId) {
    $ExistingSearchSubscriptionId = (@(Invoke-AzureCli @(
        'account', 'show', '--query', 'id', '--only-show-errors', '--output', 'tsv'
    )) -join '').Trim()
}
if (-not $ExistingFoundrySubscriptionId) {
    $ExistingFoundrySubscriptionId = $ExistingSearchSubscriptionId
}

$previousSearchEnvironment = @{
    AZURE_SEARCH_ENDPOINT = $env:AZURE_SEARCH_ENDPOINT
    AZURE_SEARCH_INDEX = $env:AZURE_SEARCH_INDEX
    AZURE_SEARCH_SEMANTIC_CONFIG = $env:AZURE_SEARCH_SEMANTIC_CONFIG
    AZURE_EMBEDDING_DIMENSIONS = $env:AZURE_EMBEDDING_DIMENSIONS
}
try {
    $env:AZURE_SEARCH_ENDPOINT = "https://$ExistingSearchServiceName.search.windows.net"
    $env:AZURE_SEARCH_INDEX = $SearchIndexName
    $env:AZURE_SEARCH_SEMANTIC_CONFIG = $SearchSemanticConfigName
    $env:AZURE_EMBEDDING_DIMENSIONS = $EmbeddingDimensions.ToString()

    & npm --prefix $repoRoot run search:validate
    if ($LASTEXITCODE -ne 0) {
        throw 'Shared Azure AI Search index validation failed.'
    }
}
finally {
    $env:AZURE_SEARCH_ENDPOINT = $previousSearchEnvironment.AZURE_SEARCH_ENDPOINT
    $env:AZURE_SEARCH_INDEX = $previousSearchEnvironment.AZURE_SEARCH_INDEX
    $env:AZURE_SEARCH_SEMANTIC_CONFIG = $previousSearchEnvironment.AZURE_SEARCH_SEMANTIC_CONFIG
    $env:AZURE_EMBEDDING_DIMENSIONS = $previousSearchEnvironment.AZURE_EMBEDDING_DIMENSIONS
}

Invoke-AzureCli @(
    'group', 'create',
    '--name', $ResourceGroupName,
    '--location', $Location,
    '--only-show-errors',
    '--output', 'none'
) | Out-Null

$compiledOutput = Invoke-AzureCli @(
    'bicep', 'build-params',
    '--file', $resolvedParameterFile,
    '--stdout',
    '--only-show-errors'
) | ConvertFrom-Json
$compiledParameters = $compiledOutput.parametersJson | ConvertFrom-Json
Set-DeploymentParameter $compiledParameters.parameters 'existingSearchSubscriptionId' $ExistingSearchSubscriptionId
Set-DeploymentParameter $compiledParameters.parameters 'existingSearchResourceGroupName' $ExistingSearchResourceGroupName
Set-DeploymentParameter $compiledParameters.parameters 'existingSearchServiceName' $ExistingSearchServiceName
Set-DeploymentParameter $compiledParameters.parameters 'searchIndexName' $SearchIndexName
Set-DeploymentParameter $compiledParameters.parameters 'searchSemanticConfigName' $SearchSemanticConfigName
Set-DeploymentParameter $compiledParameters.parameters 'embeddingDimensions' $EmbeddingDimensions
Set-DeploymentParameter $compiledParameters.parameters 'existingFoundrySubscriptionId' $ExistingFoundrySubscriptionId
Set-DeploymentParameter $compiledParameters.parameters 'existingFoundryResourceGroupName' $ExistingFoundryResourceGroupName
Set-DeploymentParameter $compiledParameters.parameters 'existingFoundryAccountName' $ExistingFoundryAccountName

$temporaryTemplateFile = [IO.Path]::GetTempFileName()
$temporaryParameterFile = [IO.Path]::GetTempFileName()
$utf8WithoutBom = New-Object Text.UTF8Encoding($false)
try {
    [IO.File]::WriteAllText($temporaryTemplateFile, $compiledOutput.templateJson, $utf8WithoutBom)
    [IO.File]::WriteAllText(
        $temporaryParameterFile,
        ($compiledParameters | ConvertTo-Json -Depth 100),
        $utf8WithoutBom
    )
    $deploymentJson = Invoke-AzureCli @(
        'deployment', 'group', 'create',
        '--name', $DeploymentName,
        '--resource-group', $ResourceGroupName,
        '--template-file', $temporaryTemplateFile,
        '--parameters', "@$temporaryParameterFile",
        '--only-show-errors',
        '--output', 'json'
    )
}
finally {
    Remove-Item $temporaryTemplateFile, $temporaryParameterFile -Force -ErrorAction SilentlyContinue
}
$deployment = ($deploymentJson -join [Environment]::NewLine) | ConvertFrom-Json
if ($deployment.properties.provisioningState -ne 'Succeeded') {
    throw "Infrastructure deployment did not succeed: $($deployment.properties.provisioningState)"
}

$outputs = [ordered]@{
    resourceGroupName = $ResourceGroupName
    deploymentName = $DeploymentName
}
foreach ($property in $deployment.properties.outputs.PSObject.Properties) {
    $outputs[$property.Name] = $property.Value.value
}

$searchReaderRoleId = '1407120a-92aa-4202-b7e9-c0e197c71c8f'
$searchReaderRoleDefinitionId = "/subscriptions/$ExistingSearchSubscriptionId/providers/Microsoft.Authorization/roleDefinitions/$searchReaderRoleId"
$searchRoleCount = Get-AzureRoleAssignmentCount `
    -Scope $outputs.searchIndexResourceId `
    -PrincipalId $outputs.appPrincipalId `
    -RoleDefinitionId $searchReaderRoleDefinitionId
if ($searchRoleCount -eq 0) {
    Invoke-AzureCli @(
        'role', 'assignment', 'create',
        '--assignee-object-id', $outputs.appPrincipalId,
        '--assignee-principal-type', 'ServicePrincipal',
        '--role', $searchReaderRoleId,
        '--scope', $outputs.searchIndexResourceId,
        '--only-show-errors',
        '--output', 'none'
    ) | Out-Null
}

New-Item (Split-Path -Parent $resolvedOutputPath) -ItemType Directory -Force | Out-Null
$outputs | ConvertTo-Json -Depth 10 | Set-Content $resolvedOutputPath -Encoding UTF8
Write-Host "Infrastructure deployment succeeded: $DeploymentName"
Write-Host "Deployment outputs: $resolvedOutputPath"
Write-Output ([pscustomobject]$outputs)