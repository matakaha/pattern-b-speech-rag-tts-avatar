[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$AppUrl,

    [ValidateRange(1, 60)]
    [int]$Attempts = 12,

    [ValidateRange(1, 60)]
    [int]$DelaySeconds = 5
)

$ErrorActionPreference = 'Stop'
$healthUrl = "$($AppUrl.TrimEnd('/'))/healthz"

for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    try {
        $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 15
        $payload = $response.Content | ConvertFrom-Json
        if ($response.StatusCode -eq 200 -and $payload.status -eq 'ok') {
            Write-Host "Health check passed: $healthUrl"
            return
        }
    }
    catch {
        if ($attempt -eq $Attempts) {
            throw "Health check failed after $Attempts attempts: $healthUrl`n$($_.Exception.Message)"
        }
    }

    if ($attempt -lt $Attempts) {
        Start-Sleep -Seconds $DelaySeconds
    }
}

throw "Health check returned an unexpected response: $healthUrl"