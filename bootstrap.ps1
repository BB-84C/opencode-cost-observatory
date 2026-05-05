param(
  [ValidateSet("start", "status", "stop")]
  [string]$Mode = "start"
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$RunDir = Join-Path $Root ".run"
$StateFile = Join-Path $RunDir "server-state.json"
$EnvFile = Join-Path $Root ".env"
$DashboardConfigFile = Join-Path $Root "dashboard.config.json"
$DefaultTokenFile = Join-Path $RunDir "dashboard.token"
$TsxPreflightPath = Join-Path $Root "node_modules\tsx\dist\preflight.cjs"
$TsxLoaderPath = Join-Path $Root "node_modules\tsx\dist\loader.mjs"
$TsxLoaderUri = ([System.Uri]::new($TsxLoaderPath)).AbsoluteUri
$BackendEntryPoint = Join-Path $Root "server\main.ts"
$BackendSpawnHelper = Join-Path $Root "server\spawn-backend.cjs"
$NodeExecutable = (Get-Command node -ErrorAction Stop).Source

if (-not (Test-Path $RunDir)) {
  New-Item -ItemType Directory -Force -Path $RunDir | Out-Null
}

$NullDevicePath = Join-Path $RunDir 'stdin.txt'
if (-not (Test-Path $NullDevicePath)) { Set-Content -Path $NullDevicePath -Value "" -Encoding UTF8 }

if (-not $env:DASHBOARD_TOKEN -and -not $env:DASHBOARD_TOKEN_FILE) {
  if (-not (Test-Path $DefaultTokenFile)) {
    Set-Content -Path $DefaultTokenFile -Value ([guid]::NewGuid().ToString('N')) -Encoding UTF8
  }
  $env:DASHBOARD_TOKEN_FILE = $DefaultTokenFile
}

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
    if ($key) {
      $values[$key] = $value
    }
  }

  return $values
}

function Read-DashboardConfig([string]$Path) {
  if (-not (Test-Path $Path)) {
    return $null
  }

  try {
    return Get-Content -Path $Path -Raw | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Get-BootstrapConfig() {
  $dashboardConfig = Read-DashboardConfig $DashboardConfigFile
  $envFileConfig = Read-KeyValueFile $EnvFile

  $bindHost = if ($env:HOST) {
    $env:HOST
  } elseif ($envFileConfig.ContainsKey("HOST")) {
    $envFileConfig["HOST"]
  } elseif ($dashboardConfig -and $dashboardConfig.host) {
    [string]$dashboardConfig.host
  } else {
    "127.0.0.1"
  }

  $port = if ($env:PORT) {
    [int]$env:PORT
  } elseif ($envFileConfig.ContainsKey("PORT")) {
    [int]$envFileConfig["PORT"]
  } elseif ($dashboardConfig -and $dashboardConfig.port) {
    [int]$dashboardConfig.port
  } else {
    41777
  }

  return @{ Host = $bindHost; Port = $port }
}

function Format-HttpHost([string]$HostValue) {
  if ($HostValue.Contains(":")) {
    return "[{0}]" -f $HostValue
  }

  return $HostValue
}

function Format-HostPort([string]$HostValue, [int]$Port) {
  return "{0}:{1}" -f (Format-HttpHost $HostValue), $Port
}

function Get-HealthCheckHost([string]$BindHost) {
  if ($BindHost -eq "0.0.0.0") {
    return "127.0.0.1"
  }

  if ($BindHost -eq "::") {
    return "::1"
  }

  return $BindHost
}

function Get-HealthCheckUrl([string]$BindHost, [int]$Port) {
  $healthCheckHost = Get-HealthCheckHost $BindHost
  return "http://{0}/health" -f (Format-HostPort -HostValue $healthCheckHost -Port $Port)
}

function Test-PortOpen([string]$BindHost, [int]$Port) {
  $tcpClient = New-Object System.Net.Sockets.TcpClient

  try {
    $connectTask = $tcpClient.ConnectAsync((Get-HealthCheckHost $BindHost), $Port)
    if (-not $connectTask.Wait(1000)) {
      return $false
    }

    return $tcpClient.Connected
  } catch {
    return $false
  } finally {
    $tcpClient.Dispose()
  }
}

function Test-HealthEndpoint([string]$BindHost, [int]$Port) {
  $uri = Get-HealthCheckUrl -BindHost $BindHost -Port $Port

  try {
    $response = Invoke-WebRequest -Uri $uri -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
    return $response.StatusCode -eq 200 -and $response.Content.Trim() -eq '{"ok":true}'
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

function Write-State([int]$ProcessIdValue, [string]$BindHost, [int]$Port, [string]$StdoutLogPath, [string]$StderrLogPath) {
  $state = [ordered]@{
    pid = $ProcessIdValue
    host = $BindHost
    port = $Port
    stdoutLogPath = $StdoutLogPath
    stderrLogPath = $StderrLogPath
    startedAt = (Get-Date).ToUniversalTime().ToString("o")
  }

  $state | ConvertTo-Json | Set-Content -Path $StateFile -Encoding UTF8
}

function New-RunLogPaths() {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss-ffff"
  $runId = [guid]::NewGuid().ToString("N").Substring(0, 8)
  return @{
    Stdout = Join-Path $RunDir ("server-{0}-{1}.out.log" -f $stamp, $runId)
    Stderr = Join-Path $RunDir ("server-{0}-{1}.err.log" -f $stamp, $runId)
  }
}

function ConvertTo-ProcessArgument([string]$Value) {
  if ($null -eq $Value) {
    return '""'
  }

  if ($Value -notmatch '[\s"]') {
    return $Value
  }

  return '"{0}"' -f ($Value.Replace('"', '\"'))
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

function Get-ProcessCommandLine([int]$ProcessIdValue) {
  if (-not $ProcessIdValue) {
    return $null
  }

  try {
    return (Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessIdValue" -ErrorAction Stop).CommandLine
  } catch {
    return $null
  }
}

function Normalize-CommandFragment([string]$Value) {
  if (-not $Value) {
    return ""
  }

  return $Value.Replace("/", "\").ToLowerInvariant()
}

function Get-BackendProcessIds() {
  $normalizedEntryPoint = Normalize-CommandFragment $BackendEntryPoint

  return @(
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
      Where-Object { (Normalize-CommandFragment $_.CommandLine).Contains($normalizedEntryPoint) } |
      ForEach-Object { [int]$_.ProcessId }
  )
}

function Resolve-ManagedProcessId([int[]]$ExistingProcessIds) {
  $deadline = (Get-Date).AddSeconds(5)

  while ((Get-Date) -lt $deadline) {
    $newProcessId = Get-BackendProcessIds |
      Where-Object { $_ -notin $ExistingProcessIds } |
      Select-Object -First 1

    if ($newProcessId) {
      return [int]$newProcessId
    }

    Start-Sleep -Milliseconds 100
  }

  return $null
}

function Get-StartupDiagnostics($State) {
  if (-not $State) {
    return $null
  }

  $sections = @()
  foreach ($logInfo in @(@{ Name = "stdout"; Path = $State.stdoutLogPath }, @{ Name = "stderr"; Path = $State.stderrLogPath })) {
    if (-not $logInfo.Path -or -not (Test-Path $logInfo.Path)) {
      continue
    }

    $lines = @(Get-Content -Path $logInfo.Path -Tail 20 -ErrorAction SilentlyContinue)
    if ($lines.Count -gt 0) {
      $sections += "{0}:" -f $logInfo.Name
      $sections += $lines
    }
  }

  if ($sections.Count -eq 0) {
    return $null
  }

  return ($sections -join [Environment]::NewLine)
}

function New-StartupFailureMessage([string]$BindHost, [int]$Port, [string]$Reason, $State) {
  $diagnostics = Get-StartupDiagnostics $State
  $hostPort = Format-HostPort -HostValue $BindHost -Port $Port

  if ($diagnostics) {
    return "{0} on {1}.{2}{3}" -f $Reason, $hostPort, [Environment]::NewLine, $diagnostics
  }

  return "{0} on {1}" -f $Reason, $hostPort
}

function Wait-ForBackendHealthy([int]$ProcessIdValue, [string]$BindHost, [int]$Port, $State) {
  $deadline = (Get-Date).AddSeconds(30)

  while ((Get-Date) -lt $deadline) {
    if (Test-HealthEndpoint -BindHost $BindHost -Port $Port) {
      return
    }

    if (-not (Test-PidRunning $ProcessIdValue)) {
      throw (New-StartupFailureMessage -BindHost $BindHost -Port $Port -Reason "Backend exited before becoming healthy" -State $State)
    }

    Start-Sleep -Milliseconds 200
  }

  throw (New-StartupFailureMessage -BindHost $BindHost -Port $Port -Reason "Backend did not become healthy" -State $State)
}

function Wait-ForBackendDown([int]$ProcessIdValue, [string]$BindHost, [int]$Port) {
  $deadline = (Get-Date).AddSeconds(15)

  while ((Get-Date) -lt $deadline) {
    if (-not (Test-PidRunning $ProcessIdValue) -and -not (Test-HealthEndpoint -BindHost $BindHost -Port $Port)) {
      return
    }

    Start-Sleep -Milliseconds 200
  }

  throw ("Backend remained available on {0}" -f (Format-HostPort -HostValue $BindHost -Port $Port))
}

function Find-ManagedProcessOnPort([int]$Port) {
  $normalizedEntryPoint = Normalize-CommandFragment $BackendEntryPoint

  try {
    $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
      Select-Object -ExpandProperty OwningProcess -Unique
  } catch {
    return $null
  }

  foreach ($pidValue in $connections) {
    $commandLine = Get-ProcessCommandLine([int]$pidValue)
    if ($commandLine -and (Normalize-CommandFragment $commandLine).Contains($normalizedEntryPoint)) {
      return [int]$pidValue
    }
  }

  return $null
}

function Get-ValidManagedState() {
  $state = Read-State
  if (-not $state) {
    $config = Get-BootstrapConfig
    $adoptedPid = Find-ManagedProcessOnPort -Port $config.Port
    if ($adoptedPid -and (Test-HealthEndpoint -BindHost $config.Host -Port $config.Port)) {
      Write-State -ProcessIdValue $adoptedPid -BindHost $config.Host -Port $config.Port -StdoutLogPath '' -StderrLogPath ''
      return Read-State
    }
    return $null
  }

  if (-not $state.pid -or -not $state.host -or -not $state.port) {
    Clear-State
    return $null
  }

  $processIdValue = [int]$state.pid
  $bindHost = [string]$state.host
  $port = [int]$state.port

  if (-not (Test-PidRunning $processIdValue) -or -not (Test-HealthEndpoint -BindHost $bindHost -Port $port)) {
    Clear-State
    return $null
  }

  return $state
}

switch ($Mode) {
  "status" {
    $state = Get-ValidManagedState
    if (-not $state) {
      Write-Output "stopped"
      exit 0
    }

    Write-Output ([string][int]$state.pid)
    exit 0
  }
  "stop" {
    $state = Read-State
    if (-not $state -or -not $state.pid -or -not $state.host -or -not $state.port) {
      Clear-State
      Write-Output "stopped"
      exit 0
    }

    $pidToStop = [int]$state.pid
    $bindHost = [string]$state.host
    $port = [int]$state.port

    if (Test-PidRunning $pidToStop) {
      Stop-Process -Id $pidToStop -Force -ErrorAction SilentlyContinue
      try {
        Wait-ForBackendDown -ProcessIdValue $pidToStop -BindHost $bindHost -Port $port
      } catch {
      }
    }

    Clear-State
    Write-Output "stopped"
    exit 0
  }
  "start" {
    $config = Get-BootstrapConfig
    $managedState = Get-ValidManagedState
    if ($managedState) {
      Write-Output ([string][int]$managedState.pid)
      exit 0
    }

    if (Test-PortOpen -BindHost $config.Host -Port $config.Port) {
      throw ("Configured port {0} is already occupied by another listener" -f (Format-HostPort -HostValue $config.Host -Port $config.Port))
    }

    $logPaths = New-RunLogPaths
    $nodeArguments = @(
      "--require",
      $TsxPreflightPath,
      "--import",
      $TsxLoaderUri,
      $BackendEntryPoint
    )

    $spawnId = [guid]::NewGuid().ToString("N")
    $spawnPayloadPath = Join-Path $RunDir ("spawn-{0}.json" -f $spawnId)
    $spawnPidPath = Join-Path $RunDir ("spawn-{0}.pid" -f $spawnId)
    $spawnErrorPath = Join-Path $RunDir ("spawn-{0}.err.log" -f $spawnId)
    $spawnPayload = @{
      nodeExecutable = $NodeExecutable
      args = $nodeArguments
      cwd = $Root
      stdinPath = $NullDevicePath
      stdoutLogPath = $logPaths.Stdout
      stderrLogPath = $logPaths.Stderr
      pidPath = $spawnPidPath
      errorPath = $spawnErrorPath
    } | ConvertTo-Json -Compress
    Set-Content -Path $spawnPayloadPath -Value $spawnPayload -Encoding UTF8

    $helperProcess = Start-Process -FilePath $NodeExecutable -ArgumentList @($BackendSpawnHelper, $spawnPayloadPath) -WorkingDirectory $Root -WindowStyle Hidden -PassThru
    $spawnDeadline = (Get-Date).AddSeconds(5)
    while ((Get-Date) -lt $spawnDeadline -and -not (Test-Path $spawnPidPath)) {
      if ($helperProcess -and -not (Test-PidRunning ([int]$helperProcess.Id)) -and -not (Test-Path $spawnPidPath)) {
        break
      }
      Start-Sleep -Milliseconds 100
    }

    if (-not (Test-Path $spawnPidPath)) {
      if ($helperProcess -and (Test-PidRunning ([int]$helperProcess.Id))) {
        Stop-Process -Id ([int]$helperProcess.Id) -Force -ErrorAction SilentlyContinue
      }
      if (Test-Path $spawnErrorPath) {
        $spawnError = Get-Content -Path $spawnErrorPath -Raw -ErrorAction SilentlyContinue
        throw ("Backend did not create a managed process: {0}" -f $spawnError)
      }
      throw (New-StartupFailureMessage -BindHost $config.Host -Port $config.Port -Reason "Backend did not create a managed process" -State $null)
    }

    $managedProcessId = [int]((Get-Content -Path $spawnPidPath -Raw).Trim())
    Remove-Item -Path $spawnPayloadPath, $spawnPidPath -Force -ErrorAction SilentlyContinue
    Write-State -ProcessIdValue $managedProcessId -BindHost $config.Host -Port $config.Port -StdoutLogPath $logPaths.Stdout -StderrLogPath $logPaths.Stderr
    $currentState = Read-State

    try {
      Wait-ForBackendHealthy -ProcessIdValue $managedProcessId -BindHost $config.Host -Port $config.Port -State $currentState
      Write-Output ([string]$managedProcessId)
      exit 0
    } catch {
      if (Test-PidRunning $managedProcessId) {
        Stop-Process -Id $managedProcessId -Force -ErrorAction SilentlyContinue
      }

      Clear-State
      throw
    }
  }
}


