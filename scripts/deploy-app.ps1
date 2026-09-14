[CmdletBinding()]
param(
    [string]$DeploymentOutputsPath = '.artifacts/deployment-outputs.json',

    [string]$ResourceGroupName,

    [string]$WebAppName,

    [string]$PackagePath = '.artifacts/app.zip',

    [switch]$SkipPackage
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$resolvedOutputsPath = Join-Path $repoRoot $DeploymentOutputsPath
$resolvedPackagePath = Join-Path $repoRoot $PackagePath

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    throw 'Azure CLI is required. Install it and run az login before deployment.'
}

if ((-not $ResourceGroupName -or -not $WebAppName) -and (Test-Path $resolvedOutputsPath -PathType Leaf)) {
    $outputs = Get-Content $resolvedOutputsPath -Raw | ConvertFrom-Json
    if (-not $ResourceGroupName) {
        $ResourceGroupName = $outputs.resourceGroupName
    }
    if (-not $WebAppName) {
        $WebAppName = $outputs.appName
    }
}
if (-not $ResourceGroupName -or -not $WebAppName) {
    throw 'Provide ResourceGroupName and WebAppName, or run deploy-infra.ps1 first.'
}

if (-not $SkipPackage) {
    & (Join-Path $PSScriptRoot 'package-app.ps1') -OutputPath $PackagePath
    if ($LASTEXITCODE -ne 0) {
        throw 'Application packaging failed.'
    }
}
if (-not (Test-Path $resolvedPackagePath -PathType Leaf)) {
    throw "Deployment package was not found: $resolvedPackagePath"
}

$result = & az webapp deploy `
    --resource-group $ResourceGroupName `
    --name $WebAppName `
    --src-path $resolvedPackagePath `
    --type zip `
    --clean true `
    --restart true `
    --only-show-errors `
    --output json 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "Application deployment failed.`n$($result -join [Environment]::NewLine)"
}

Write-Host "Application deployment succeeded: https://$WebAppName.azurewebsites.net"