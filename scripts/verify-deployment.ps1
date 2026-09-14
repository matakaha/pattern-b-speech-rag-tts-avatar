[CmdletBinding()]
param(
    [string]$DeploymentOutputsPath = '.artifacts/deployment-outputs.json',

    [string]$ResourceGroupName,

    [string]$WebAppName,

    [string]$AppUrl,

    [string]$AppPrincipalId,

    [string]$SearchIndexResourceId,

    [string]$SpeechResourceId,

    [string]$FoundryResourceId
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$resolvedOutputsPath = Join-Path $repoRoot $DeploymentOutputsPath

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    throw 'Azure CLI is required. Install it and run az login before verification.'
}
if (Test-Path $resolvedOutputsPath -PathType Leaf) {
    $outputs = Get-Content $resolvedOutputsPath -Raw | ConvertFrom-Json
    if (-not $ResourceGroupName) { $ResourceGroupName = $outputs.resourceGroupName }
    if (-not $WebAppName) { $WebAppName = $outputs.appName }
    if (-not $AppUrl) { $AppUrl = $outputs.appUrl }
    if (-not $AppPrincipalId) { $AppPrincipalId = $outputs.appPrincipalId }
    if (-not $SearchIndexResourceId) { $SearchIndexResourceId = $outputs.searchIndexResourceId }
    if (-not $SpeechResourceId) { $SpeechResourceId = $outputs.speechResourceId }
    if (-not $FoundryResourceId) { $FoundryResourceId = $outputs.foundryResourceId }
}
if (-not $ResourceGroupName -or -not $WebAppName -or -not $AppUrl -or -not $AppPrincipalId -or
    -not $SearchIndexResourceId -or -not $SpeechResourceId -or -not $FoundryResourceId) {
    throw 'Provide all deployment values, or run deploy-infra.ps1 first.'
}

$webAppJson = & az webapp show --resource-group $ResourceGroupName --name $WebAppName --only-show-errors --output json 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "Unable to read the Web App.`n$($webAppJson -join [Environment]::NewLine)"
}
$webApp = ($webAppJson -join [Environment]::NewLine) | ConvertFrom-Json

$configJson = & az webapp config show --resource-group $ResourceGroupName --name $WebAppName --only-show-errors --output json 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "Unable to read the Web App configuration.`n$($configJson -join [Environment]::NewLine)"
}
$config = ($configJson -join [Environment]::NewLine) | ConvertFrom-Json

$failures = @()
if ($webApp.state -ne 'Running') { $failures += "state is $($webApp.state)" }
if (-not $webApp.httpsOnly) { $failures += 'HTTPS-only is disabled' }
if (-not $webApp.identity.principalId) { $failures += 'system-assigned managed identity is missing' }
if (-not $config.webSocketsEnabled) { $failures += 'WebSockets are disabled' }
if ($config.minTlsVersion -ne '1.2') { $failures += "minimum TLS version is $($config.minTlsVersion)" }
if ($config.healthCheckPath -ne '/healthz') { $failures += "health check path is $($config.healthCheckPath)" }

$expectedRoles = @(
    @{ Scope = $SearchIndexResourceId; Role = 'Search Index Data Reader' },
    @{ Scope = $SpeechResourceId; Role = 'Cognitive Services Speech User' },
    @{ Scope = $FoundryResourceId; Role = 'Cognitive Services OpenAI User' }
)
foreach ($expectedRole in $expectedRoles) {
    $roleCount = & az role assignment list `
        --assignee $AppPrincipalId `
        --scope $expectedRole.Scope `
        --query "[?roleDefinitionName=='$($expectedRole.Role)'] | length(@)" `
        --only-show-errors `
        --output tsv 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to verify role assignments.`n$($roleCount -join [Environment]::NewLine)"
    }
    if (($roleCount -join '').Trim() -eq '0') {
        $failures += "missing $($expectedRole.Role) on $($expectedRole.Scope)"
    }
}

if ($failures.Count -gt 0) {
    throw "Deployment verification failed: $($failures -join '; ')"
}

& (Join-Path $PSScriptRoot 'test-health.ps1') -AppUrl $AppUrl
Write-Host "Deployment verification passed: $WebAppName"