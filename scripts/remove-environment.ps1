[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ResourceGroupName,

    [Parameter(Mandatory = $true)]
    [string]$ConfirmResourceGroupName
)

$ErrorActionPreference = 'Stop'

if ($ConfirmResourceGroupName -cne $ResourceGroupName) {
    throw 'Confirmation failed. ConfirmResourceGroupName must exactly match ResourceGroupName.'
}
if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    throw 'Azure CLI is required. Install it and run az login before cleanup.'
}

$exists = & az group exists --name $ResourceGroupName --only-show-errors 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "Unable to check the resource group.`n$($exists -join [Environment]::NewLine)"
}
if (($exists -join '').Trim() -ne 'true') {
    Write-Host "Resource group does not exist: $ResourceGroupName"
    return
}

Write-Host "Deleting resource group: $ResourceGroupName"
$result = & az group delete --name $ResourceGroupName --yes --only-show-errors 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "Resource group deletion failed.`n$($result -join [Environment]::NewLine)"
}
Write-Host "Resource group deleted: $ResourceGroupName"