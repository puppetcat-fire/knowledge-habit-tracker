param(
  [int]$Port = 3000,
  [int]$PlatformPort = 3001,
  [string]$DataDir = ""
)
$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $DataDir) { $DataDir = Join-Path $projectRoot "data" }
$DataDir = [System.IO.Path]::GetFullPath($DataDir)
$nodePath = (Get-Command node -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot "node_modules/express/package.json"))) {
  throw "Dependencies are missing. Run npm install in the project folder first."
}
if ($Port -lt 1 -or $Port -gt 65535 -or $PlatformPort -lt 1 -or $PlatformPort -gt 65535 -or $Port -eq $PlatformPort) {
  throw "Choose two different valid ports."
}
# Use a direct HTTP client so a system proxy cannot intercept localhost checks.
Add-Type -AssemblyName System.Net.Http
$handler = New-Object System.Net.Http.HttpClientHandler
$handler.UseProxy = $false
$client = New-Object System.Net.Http.HttpClient($handler)
$client.Timeout = [TimeSpan]::FromSeconds(2)
function Read-Health([int]$ServicePort) {
  try { return ($client.GetStringAsync("http://127.0.0.1:$ServicePort/health").GetAwaiter().GetResult() | ConvertFrom-Json) }
  catch { return $null }
}
try {
  $habitHealth = Read-Health $Port
  $platformHealth = Read-Health $PlatformPort
  if ($habitHealth.service -eq "knowledge-habit-tracker" -and $platformHealth.service -eq "knowledge-platform") {
    Write-Host "Both systems are already running."
  } else {
    if ($habitHealth -or $platformHealth) { throw "A service already uses one of these ports. Close that service or choose another port pair." }
    New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
    $env:PORT = [string]$Port
    $env:PLATFORM_PORT = [string]$PlatformPort
    $env:DATA_DIR = $DataDir
    $serverPath = Join-Path $projectRoot "server.js"
    $stdoutPath = Join-Path $DataDir "service-out.log"
    $stderrPath = Join-Path $DataDir "service-error.log"
    $serviceProcess = Start-Process -FilePath $nodePath -ArgumentList ('"' + $serverPath + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
      $habitHealth = Read-Health $Port
      $platformHealth = Read-Health $PlatformPort
      if ($habitHealth.service -eq "knowledge-habit-tracker" -and $platformHealth.service -eq "knowledge-platform") { $ready = $true; break }
      if ($serviceProcess.HasExited) { break }
      Start-Sleep -Milliseconds 250
    }
    if (-not $ready) { throw "Startup failed. Check $stderrPath" }
    Set-Content -LiteralPath (Join-Path $DataDir "service-process.json") -Value (@{ pid = $serviceProcess.Id; server = $serverPath; port = $Port; platformPort = $PlatformPort; startedAt = [DateTime]::UtcNow.ToString("o") } | ConvertTo-Json)
    Write-Host "Both systems are ready and continue running after this launcher closes."
  }
  Write-Host "Habit tracker: http://127.0.0.1:$Port/"
  Write-Host "Knowledge platform: http://127.0.0.1:$Port/knowledge/"
  Write-Host "Standalone knowledge platform: http://127.0.0.1:$PlatformPort/"
} finally { $client.Dispose(); $handler.Dispose() }
