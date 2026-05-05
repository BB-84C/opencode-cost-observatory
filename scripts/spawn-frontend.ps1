[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ProjectRoot
)

$ErrorActionPreference = "Stop"

$runDir = Join-Path $ProjectRoot ".run"
New-Item -ItemType Directory -Path $runDir -Force | Out-Null

$stdoutLog = Join-Path $runDir "frontend-wrapper.out.log"
$stderrLog = Join-Path $runDir "frontend-wrapper.err.log"

Start-Process -FilePath "npm.cmd" `
  -ArgumentList @("run", "dev") `
  -WorkingDirectory $ProjectRoot `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog `
  -WindowStyle Hidden | Out-Null
