#requires -Version 7.0
param(
  [ValidateSet("start", "status", "stop", "logs")]
  [string]$Mode = "start"
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$RunDir = Join-Path $Root ".run"
$StateFile = Join-Path $RunDir "uploader-state.json"
$EnvFile = Join-Path $Root ".env"
$UploaderEntryPoint = Join-Path $Root "uploader\main.ts"
$SpawnHelper = Join-Path $Root "server\spawn-backend.cjs"
$NodeExecutable = (Get-Command node -ErrorAction Stop).Source

if (-not (Test-Path $RunDir)) {
  New-Item -ItemType Directory -Force -Path $RunDir | Out-Null
}

$NullDevicePath = Join-Path $RunDir 'stdin.txt'
if (-not (Test-Path $NullDevicePath)) { Set-Content -Path $NullDevicePath -Value "" -Encoding UTF8 }

function Read-KeyValueFile([string]$Path) {
  $values = @{}
  if (-not (Test-Path $Path)) {
    return $values
  }

  foreach ($line in Get-Content -Path $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) {
      continue
    }

    $separatorIndex = $trimmed.IndexOf("=")
    if ($separatorIndex -le 0) {
      continue
    }

    $key = $trimmed.Substring(0, $separatorIndex).Trim()
    $value = $trimmed.Substring($separatorIndex + 1).Trim()
    $commentIndex = $value.IndexOf("#")
    if ($commentIndex -ge 0) {
      $value = $value.Substring(0, $commentIndex).Trim()
    }
    if ($key) {
      $values[$key] = $value.Trim('"').Trim("'")
    }
  }

  return $values
}

function Import-UploaderEnv() {
  $envFileConfig = Read-KeyValueFile $EnvFile
  foreach ($key in $envFileConfig.Keys) {
    if (-not [Environment]::GetEnvironmentVariable([string]$key, "Process")) {
      [Environment]::SetEnvironmentVariable([string]$key, [string]$envFileConfig[$key], "Process")
    }
  }
}

function Assert-UploaderEnv() {
  Import-UploaderEnv
  $missing = @()
  if (-not $env:INGEST_URL) { $missing += "INGEST_URL" }
  if (-not $env:INGEST_TOKEN) { $missing += "INGEST_TOKEN" }
  if ($missing.Count -gt 0) {
    throw ("Missing required uploader environment: {0}. Set them in {1} (see .env.example)." -f ($missing -join ", "), $EnvFile)
  }
}

function Resolve-ProjectPath([string]$Value, [string]$DefaultValue) {
  $target = if ($Value) { $Value } else { $DefaultValue }
  if ([System.IO.Path]::IsPathRooted($target)) {
    return $target
  }
  return [System.IO.Path]::GetFullPath((Join-Path $Root $target))
}

function Get-AnalyticsDbPath() {
  Import-UploaderEnv
  return Resolve-ProjectPath $env:ANALYTICS_DB_PATH ".\.run\analytics.db"
}

function Test-PidRunning([int]$ProcessIdValue) {
  if (-not $ProcessIdValue) {
    return $false
  }

  try {
    $null = Get-Process -Id $ProcessIdValue -ErrorAction Stop
    return $true
  } catch {
    return $false
  }
}

function Read-State() {
  if (-not (Test-Path $StateFile)) {
    return $null
  }

  try {
    return Get-Content -Path $StateFile -Raw | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Clear-State() {
  Remove-Item -Path $StateFile -Force -ErrorAction SilentlyContinue
}

function Write-State([int]$ProcessIdValue, [string]$StdoutLogPath, [string]$StderrLogPath) {
  $state = [ordered]@{
    pid = $ProcessIdValue
    host = "local"
    startedAt = (Get-Date).ToUniversalTime().ToString("o")
    stdoutLogPath = $StdoutLogPath
    stderrLogPath = $StderrLogPath
    watermark = Get-UploaderSyncStateValue "bb84_vps_uploader_watermark"
  }

  $state | ConvertTo-Json | Set-Content -Path $StateFile -Encoding UTF8
}

function Get-ValidManagedState() {
  $state = Read-State
  if (-not $state -or -not $state.pid) {
    Clear-State
    return $null
  }

  if (-not (Test-PidRunning ([int]$state.pid))) {
    Clear-State
    return $null
  }

  return $state
}

function New-RunLogPaths() {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss-ffff"
  $runId = [guid]::NewGuid().ToString("N").Substring(0, 8)
  return @{
    Stdout = Join-Path $RunDir ("uploader-{0}-{1}.out.log" -f $stamp, $runId)
    Stderr = Join-Path $RunDir ("uploader-{0}-{1}.err.log" -f $stamp, $runId)
  }
}

function Get-UploaderSyncStateValue([string]$Key) {
  $analyticsDbPath = Get-AnalyticsDbPath
  if (-not (Test-Path $analyticsDbPath)) {
    return $null
  }

  $script = @'
import Database from "better-sqlite3";
const db = new Database(process.env.ANALYTICS_DB_PATH, { readonly: true, fileMustExist: true });
try {
  const row = db.prepare("select value from sync_state where key = ?").get(process.env.SYNC_STATE_KEY);
  if (row && row.value != null) process.stdout.write(String(row.value));
} finally {
  db.close();
}
'@
  $previousAnalyticsDbPath = $env:ANALYTICS_DB_PATH
  $previousSyncStateKey = $env:SYNC_STATE_KEY
  try {
    $env:ANALYTICS_DB_PATH = $analyticsDbPath
    $env:SYNC_STATE_KEY = $Key
    $value = & $NodeExecutable --import tsx --input-type=module -e $script 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    if ($value -is [array]) { return ($value -join "") }
    return $value
  } catch {
    return $null
  } finally {
    if ($null -eq $previousAnalyticsDbPath) { Remove-Item Env:\ANALYTICS_DB_PATH -ErrorAction SilentlyContinue } else { $env:ANALYTICS_DB_PATH = $previousAnalyticsDbPath }
    if ($null -eq $previousSyncStateKey) { Remove-Item Env:\SYNC_STATE_KEY -ErrorAction SilentlyContinue } else { $env:SYNC_STATE_KEY = $previousSyncStateKey }
  }
}

function Get-LastLogPath() {
  $state = Read-State
  if ($state -and $state.stdoutLogPath) {
    return [string]$state.stdoutLogPath
  }
  return Get-ChildItem -Path $RunDir -Filter "uploader-*.out.log" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}

switch ($Mode) {
  "status" {
    Import-UploaderEnv
    $state = Get-ValidManagedState
    $watermark = Get-UploaderSyncStateValue "bb84_vps_uploader_watermark"
    $lastSuccess = Get-UploaderSyncStateValue "bb84_vps_uploader_last_success_at"
    if (-not $state) {
      Write-Output (@{
        status = "stopped"
        pid = $null
        running = $false
        watermark = $watermark
        lastSuccessfulUploadAt = $lastSuccess
      } | ConvertTo-Json -Compress)
      exit 0
    }

    Write-Output (@{
      status = "running"
      pid = [int]$state.pid
      running = $true
      startedAt = [string]$state.startedAt
      watermark = $watermark
      lastSuccessfulUploadAt = $lastSuccess
      stdoutLogPath = [string]$state.stdoutLogPath
      stderrLogPath = [string]$state.stderrLogPath
    } | ConvertTo-Json -Compress)
    exit 0
  }
  "logs" {
    $logPath = Get-LastLogPath
    if (-not $logPath -or -not (Test-Path $logPath)) {
      Write-Output "no uploader logs found"
      exit 0
    }
    Get-Content -Path $logPath -Tail 80
    exit 0
  }
  "stop" {
    $state = Read-State
    if (-not $state -or -not $state.pid) {
      Clear-State
      Write-Output "stopped"
      exit 0
    }

    $pidToStop = [int]$state.pid
    if (Test-PidRunning $pidToStop) {
      & taskkill.exe /PID $pidToStop /T | Out-Null
      $deadline = (Get-Date).AddSeconds(5)
      while ((Get-Date) -lt $deadline -and (Test-PidRunning $pidToStop)) {
        Start-Sleep -Milliseconds 200
      }
      if (Test-PidRunning $pidToStop) {
        & taskkill.exe /PID $pidToStop /T /F | Out-Null
      }
    }

    Clear-State
    Write-Output "stopped"
    exit 0
  }
  "start" {
    Assert-UploaderEnv
    $managedState = Get-ValidManagedState
    if ($managedState) {
      Write-Output ([string][int]$managedState.pid)
      exit 0
    }

    $logPaths = New-RunLogPaths
    $spawnId = [guid]::NewGuid().ToString("N")
    $spawnPayloadPath = Join-Path $RunDir ("uploader-spawn-{0}.json" -f $spawnId)
    $spawnPidPath = Join-Path $RunDir ("uploader-spawn-{0}.pid" -f $spawnId)
    $spawnErrorPath = Join-Path $RunDir ("uploader-spawn-{0}.err.log" -f $spawnId)
    $spawnPayload = @{
      nodeExecutable = $NodeExecutable
      args = @("--import", "tsx", $UploaderEntryPoint)
      cwd = $Root
      stdinPath = $NullDevicePath
      stdoutLogPath = $logPaths.Stdout
      stderrLogPath = $logPaths.Stderr
      pidPath = $spawnPidPath
      errorPath = $spawnErrorPath
    } | ConvertTo-Json -Compress
    Set-Content -Path $spawnPayloadPath -Value $spawnPayload -Encoding UTF8

    $helperProcess = Start-Process -FilePath $NodeExecutable -ArgumentList @($SpawnHelper, $spawnPayloadPath) -WorkingDirectory $Root -WindowStyle Hidden -PassThru
    $deadline = (Get-Date).AddSeconds(5)
    while ((Get-Date) -lt $deadline -and -not (Test-Path $spawnPidPath)) {
      if ($helperProcess -and -not (Test-PidRunning ([int]$helperProcess.Id)) -and -not (Test-Path $spawnPidPath)) { break }
      Start-Sleep -Milliseconds 100
    }

    if (-not (Test-Path $spawnPidPath)) {
      if ($helperProcess -and (Test-PidRunning ([int]$helperProcess.Id))) {
        Stop-Process -Id ([int]$helperProcess.Id) -Force -ErrorAction SilentlyContinue
      }
      $spawnError = if (Test-Path $spawnErrorPath) { Get-Content -Path $spawnErrorPath -Raw -ErrorAction SilentlyContinue } else { "missing uploader pid" }
      throw ("Uploader did not create a managed process: {0}" -f $spawnError)
    }

    $managedProcessId = [int]((Get-Content -Path $spawnPidPath -Raw).Trim())
    Remove-Item -Path $spawnPayloadPath, $spawnPidPath -Force -ErrorAction SilentlyContinue
    Write-State -ProcessIdValue $managedProcessId -StdoutLogPath $logPaths.Stdout -StderrLogPath $logPaths.Stderr
    Start-Sleep -Milliseconds 500
    if (-not (Test-PidRunning $managedProcessId)) {
      $stderrTail = if (Test-Path $logPaths.Stderr) { (Get-Content -Path $logPaths.Stderr -Tail 20 -ErrorAction SilentlyContinue) -join [Environment]::NewLine } else { "" }
      Clear-State
      throw ("Uploader exited during startup. Logs: {0}, {1}{2}{3}" -f $logPaths.Stdout, $logPaths.Stderr, [Environment]::NewLine, $stderrTail)
    }

    Write-Output ([string]$managedProcessId)
    exit 0
  }
}
