[CmdletBinding()]
param(
    [string]$OutputPath = '.artifacts/app.zip'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$stagingPath = Join-Path $repoRoot '.artifacts/staging'
$resolvedOutputPath = Join-Path $repoRoot $OutputPath

Push-Location $repoRoot
try {
    npm run build
    if ($LASTEXITCODE -ne 0) {
        throw 'Application build failed.'
    }

    Remove-Item $stagingPath -Recurse -Force -ErrorAction SilentlyContinue
    New-Item $stagingPath -ItemType Directory -Force | Out-Null

    Copy-Item 'package.json', 'package-lock.json' -Destination $stagingPath
    foreach ($workspace in @('src/api', 'src/shared', 'src/web')) {
        $workspaceTarget = Join-Path $stagingPath $workspace
        New-Item $workspaceTarget -ItemType Directory -Force | Out-Null
        Copy-Item (Join-Path $workspace 'package.json') -Destination $workspaceTarget
        Copy-Item (Join-Path $workspace 'dist') -Destination $workspaceTarget -Recurse
    }

    Push-Location $stagingPath
    try {
        npm ci --omit=dev --ignore-scripts
        if ($LASTEXITCODE -ne 0) {
            throw 'Production dependency installation failed.'
        }
    }
    finally {
        Pop-Location
    }

    $requiredFiles = @(
        'package.json',
        'package-lock.json',
        'src/api/dist/server.js',
        'src/shared/dist/index.js',
        'src/web/dist/index.html'
    )
    foreach ($requiredFile in $requiredFiles) {
        if (-not (Test-Path (Join-Path $stagingPath $requiredFile) -PathType Leaf)) {
            throw "Required deployment file is missing: $requiredFile"
        }
    }

    $forbiddenFiles = Get-ChildItem $stagingPath -Recurse -File | Where-Object {
        $_.FullName -notmatch '[\\/]node_modules[\\/]' -and (
        $_.Name -like '.env*' -or
        ($_.Extension -eq '.ts' -and $_.Name -notlike '*.d.ts') -or
        $_.FullName -match '[\\/]tests?[\\/]'
        )
    }
    if ($forbiddenFiles) {
        throw "Forbidden files were included in the deployment package: $($forbiddenFiles.FullName -join ', ')"
    }

    New-Item (Split-Path -Parent $resolvedOutputPath) -ItemType Directory -Force | Out-Null
    Remove-Item $resolvedOutputPath -Force -ErrorAction SilentlyContinue
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::Open(
        $resolvedOutputPath,
        [System.IO.Compression.ZipArchiveMode]::Create
    )
    try {
        foreach ($file in Get-ChildItem $stagingPath -Recurse -File) {
            $entryName = $file.FullName.Substring($stagingPath.Length).TrimStart([char[]]@('\', '/')).Replace('\', '/')
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $archive,
                $file.FullName,
                $entryName,
                [System.IO.Compression.CompressionLevel]::Optimal
            ) | Out-Null
        }
    }
    finally {
        $archive.Dispose()
    }
    Write-Host "Created deployment package: $resolvedOutputPath"
}
finally {
    Pop-Location
}