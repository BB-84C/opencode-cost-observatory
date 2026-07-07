#requires -Version 7.0
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$runDir = Join-Path $repoRoot '.run'
if (-not (Test-Path $runDir)) {
    New-Item -ItemType Directory -Path $runDir -Force | Out-Null
}

$usageMode = if ($env:OPENCODE_USAGE_MODE) { $env:OPENCODE_USAGE_MODE } else { 'uploader' }

if ($usageMode -ne 'local_dashboard') {
    $uploaderScript = if ($env:OPENCODE_USAGE_UPLOADER_SCRIPT) { $env:OPENCODE_USAGE_UPLOADER_SCRIPT } else { Join-Path $repoRoot 'uploader.ps1' }
    $timeoutSec = if ($env:OPENCODE_USAGE_TIMEOUT_SEC) { [int]$env:OPENCODE_USAGE_TIMEOUT_SEC } else { 30 }
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    $uploaderLog = Join-Path $runDir 'usage-uploader-call.out.log'
    $uploaderErr = Join-Path $runDir 'usage-uploader-call.err.log'

    function Read-UploaderStatus {
        try {
            $raw = & pwsh -NoProfile -NoLogo -NonInteractive -File $uploaderScript status 2>$null
            if ($LASTEXITCODE -ne 0 -or -not $raw) { return $null }
            return ($raw | Out-String | ConvertFrom-Json -ErrorAction Stop)
        } catch {
            return $null
        }
    }

    function Test-UploaderReady($Status) {
        if (-not $Status) { return $false }
        if ($Status.running -eq $true -and $Status.pid) { return $true }
        if ($Status.watermark -and ([string]$Status.watermark).Trim() -ne '') { return $true }
        return $false
    }

    $status = Read-UploaderStatus
    if (-not ($status -and $status.running -eq $true)) {
        Remove-Item -Path $uploaderLog, $uploaderErr -Force -ErrorAction SilentlyContinue
        $process = Start-Process -FilePath 'pwsh' `
            -ArgumentList @('-NoProfile', '-NoLogo', '-NonInteractive', '-File', $uploaderScript, 'start') `
            -RedirectStandardOutput $uploaderLog `
            -RedirectStandardError $uploaderErr `
            -WindowStyle Hidden `
            -PassThru `
            -ErrorAction Stop
        $remainingMs = [Math]::Max(1, [Math]::Ceiling(($deadline - (Get-Date)).TotalMilliseconds))
        if (-not $process.WaitForExit([int]$remainingMs)) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
            [Console]::Error.WriteLine("opencode --usage failed: uploader start did not return after ${timeoutSec}s. Logs: $uploaderLog, $uploaderErr")
            exit 1
        }
        if ([int]$process.ExitCode -ne 0) {
            [Console]::Error.WriteLine("opencode --usage failed: uploader start exited $($process.ExitCode). Logs: $uploaderLog, $uploaderErr")
            exit 1
        }
    }

    $readyStatus = $null
    while ((Get-Date) -lt $deadline) {
        $readyStatus = Read-UploaderStatus
        if (Test-UploaderReady $readyStatus) { break }
        Start-Sleep -Milliseconds 500
    }

    if (-not (Test-UploaderReady $readyStatus)) {
        [Console]::Error.WriteLine("opencode --usage failed: uploader not ready after ${timeoutSec}s. Logs: $uploaderLog, $uploaderErr")
        exit 1
    }

    $watermark = if ($readyStatus.watermark) { [string]$readyStatus.watermark } else { '0' }
    Write-Host "opencode -> BB84 VPS uploader ready. Latest watermark: $watermark"
    exit 0
}

# --- Configuration via env (with defaults) ---
$bootstrapScript = if ($env:OPENCODE_USAGE_BOOTSTRAP_SCRIPT) { $env:OPENCODE_USAGE_BOOTSTRAP_SCRIPT } else { Join-Path $repoRoot 'bootstrap.ps1' }
$frontendScript  = if ($env:OPENCODE_USAGE_FRONTEND_SCRIPT)  { $env:OPENCODE_USAGE_FRONTEND_SCRIPT }  else { Join-Path $repoRoot 'scripts\spawn-frontend.ps1' }
$backendUrl      = if ($env:OPENCODE_USAGE_BACKEND_HEALTH_URL) { $env:OPENCODE_USAGE_BACKEND_HEALTH_URL } else { 'http://127.0.0.1:41777/health' }
$frontendUrl     = if ($env:OPENCODE_USAGE_FRONTEND_URL)        { $env:OPENCODE_USAGE_FRONTEND_URL }       else { 'http://127.0.0.1:41778' }
$timeoutSec      = if ($env:OPENCODE_USAGE_TIMEOUT_SEC)         { [int]$env:OPENCODE_USAGE_TIMEOUT_SEC }   else { 30 }
$deadline = (Get-Date).AddSeconds($timeoutSec)

$backendLog  = Join-Path $runDir 'usage-bootstrap-call.out.log'
$backendErr  = Join-Path $runDir 'usage-bootstrap-call.err.log'
$frontendLog = Join-Path $runDir 'usage-frontend-call.out.log'
$frontendErr = Join-Path $runDir 'usage-frontend-call.err.log'
$frontendWrapperLog = Join-Path $runDir 'frontend-wrapper.out.log'
$frontendWrapperErr = Join-Path $runDir 'frontend-wrapper.err.log'

function Test-BackendHealthy {
    try {
        $r = Invoke-WebRequest -Uri $backendUrl -TimeoutSec 1 -UseBasicParsing -ErrorAction Stop
        if ($r.StatusCode -ne 200) { return $false }
        $payload = $r.Content | ConvertFrom-Json -ErrorAction Stop
        return ($payload.ok -is [bool]) -and ($payload.ok -eq $true)
    } catch {
        return $false
    }
}

function Test-FrontendHealthy {
    try {
        $r = Invoke-WebRequest -Uri $frontendUrl -TimeoutSec 1 -UseBasicParsing -ErrorAction Stop
        if ($r.StatusCode -lt 200 -or $r.StatusCode -ge 300) { return $false }
        $titleMatch = [regex]::Match($r.Content, '<title>(.*?)</title>', 'IgnoreCase')
        if (-not $titleMatch.Success) { return $false }
        return $titleMatch.Groups[1].Value -match 'OpenCode Cost Observatory'
    } catch {
        return $false
    }
}

function ConvertTo-ProcessArgument {
    param(
        [AllowNull()]
        [string] $Value
    )

    if ($null -eq $Value -or $Value -eq '') { return '""' }
    if ($Value -notmatch '[\s"]') { return $Value }
    return '"' + $Value.Replace('"', '\"') + '"'
}

function Join-ProcessArguments {
    param(
        [Parameter(Mandatory = $true)]
        [string[]] $Arguments
    )

    return (($Arguments | ForEach-Object { ConvertTo-ProcessArgument $_ }) -join ' ')
}

function Get-RemainingTimeoutMs {
    $remaining = [Math]::Ceiling(($deadline - (Get-Date)).TotalMilliseconds)
    if ($remaining -lt 1) { return 0 }
    if ($remaining -gt [int]::MaxValue) { return [int]::MaxValue }
    return [int] $remaining
}

function Invoke-UsageChildProcess {
    param(
        [Parameter(Mandatory = $true)] [string] $Side,
        [Parameter(Mandatory = $true)] [string] $InvocationName,
        [Parameter(Mandatory = $true)] [string[]] $Arguments,
        [Parameter(Mandatory = $true)] [string] $LogPath,
        [Parameter(Mandatory = $true)] [string] $ErrPath
    )

    $remainingMs = Get-RemainingTimeoutMs
    if ($remainingMs -le 0) {
        [Console]::Error.WriteLine("opencode --usage failed: $Side not healthy after ${timeoutSec}s. Logs: $LogPath, $ErrPath")
        exit 1
    }

    Remove-Item -Path $LogPath, $ErrPath -Force -ErrorAction SilentlyContinue

    try {
        $process = Start-Process -FilePath 'pwsh' `
            -ArgumentList (Join-ProcessArguments $Arguments) `
            -RedirectStandardOutput $LogPath `
            -RedirectStandardError $ErrPath `
            -WindowStyle Hidden `
            -PassThru `
            -ErrorAction Stop
    } catch {
        [Console]::Error.WriteLine("opencode --usage failed: $InvocationName invocation error: $_. Logs: $LogPath, $ErrPath")
        exit 1
    }

    if (-not $process.WaitForExit($remainingMs)) {
        [Console]::Error.WriteLine("opencode --usage failed: $InvocationName did not return after ${timeoutSec}s. Logs: $LogPath, $ErrPath")
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        exit 1
    }

    return [int] $process.ExitCode
}

# --- Backend bring-up ---
if (-not (Test-BackendHealthy)) {
    $previousHost = $env:HOST
    $previousPort = $env:PORT
    try {
        $env:HOST = '127.0.0.1'
        $env:PORT = '41777'
        $bootstrapExit = Invoke-UsageChildProcess `
            -Side 'backend' `
            -InvocationName 'bootstrap' `
            -Arguments @('-NoProfile', '-NoLogo', '-NonInteractive', '-File', $bootstrapScript, 'start') `
            -LogPath $backendLog `
            -ErrPath $backendErr
    } finally {
        if ($null -eq $previousHost) { Remove-Item Env:\HOST -ErrorAction SilentlyContinue } else { $env:HOST = $previousHost }
        if ($null -eq $previousPort) { Remove-Item Env:\PORT -ErrorAction SilentlyContinue } else { $env:PORT = $previousPort }
    }
    if ($bootstrapExit -ne 0) {
        if (-not (Test-BackendHealthy)) {
            [Console]::Error.WriteLine("opencode --usage failed: backend exited $bootstrapExit. Logs: $backendLog, $backendErr")
            exit 1
        }
    }
}

# --- Frontend bring-up ---
if (-not (Test-FrontendHealthy)) {
    $frontendExit = Invoke-UsageChildProcess `
        -Side 'frontend' `
        -InvocationName 'frontend' `
        -Arguments @('-NoProfile', '-NoLogo', '-NonInteractive', '-File', $frontendScript, '-ProjectRoot', $repoRoot) `
        -LogPath $frontendLog `
        -ErrPath $frontendErr
    if ($frontendExit -ne 0) {
        [Console]::Error.WriteLine("opencode --usage failed: frontend exited $frontendExit. Logs: $frontendLog, $frontendErr, $frontendWrapperLog, $frontendWrapperErr")
        exit 1
    }
}

# --- Wait loop ---
$backendOk = $false
$frontendOk = $false
while ((Get-Date) -lt $deadline) {
    if (-not $backendOk)  { $backendOk  = Test-BackendHealthy }
    if (-not $frontendOk) { $frontendOk = Test-FrontendHealthy }
    if ($backendOk -and $frontendOk) { break }
    Start-Sleep -Milliseconds 500
}

if (-not $backendOk) {
    [Console]::Error.WriteLine("opencode --usage failed: backend not healthy after ${timeoutSec}s. Logs: $backendLog, $backendErr")
    exit 1
}
if (-not $frontendOk) {
    [Console]::Error.WriteLine("opencode --usage failed: frontend not healthy after ${timeoutSec}s. Logs: $frontendLog, $frontendErr, $frontendWrapperLog, $frontendWrapperErr")
    exit 1
}

Write-Host "OpenCode Cost Observatory ready -> http://127.0.0.1:41778"
exit 0
