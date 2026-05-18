param(
  [Parameter(Mandatory = $true)]
  [string]$BaseUrl,

  [int]$TimeoutSec = 30
)

$ErrorActionPreference = "Stop"

function Join-Url {
  param(
    [string]$Base,
    [string]$Path
  )

  return "$($Base.TrimEnd('/'))$Path"
}

function Invoke-HubCheck {
  param(
    [string]$Name,
    [string]$Path,
    [int]$ExpectedStatus,
    [string]$Method = "GET",
    [string]$Body = $null
  )

  $uri = Join-Url -Base $BaseUrl -Path $Path
  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  $statusCode = 0
  $payloadBytes = 0
  $errorMessage = $null

  try {
    $headers = @{}
    $parameters = @{
      Headers = $headers
      Method = $Method
      TimeoutSec = $TimeoutSec
      Uri = $uri
      UseBasicParsing = $true
    }

    if ($Body) {
      $parameters.Body = $Body
      $parameters.ContentType = "application/json"
    }

    $response = Invoke-WebRequest @parameters
    $statusCode = [int]$response.StatusCode
    $payloadBytes = if ($response.Content) {
      [System.Text.Encoding]::UTF8.GetByteCount([string]$response.Content)
    } else {
      0
    }
  } catch {
    if ($_.Exception.Response) {
      $statusCode = [int]$_.Exception.Response.StatusCode
      $errorMessage = $_.Exception.Response.StatusDescription
    } else {
      $errorMessage = $_.Exception.Message
    }
  } finally {
    $watch.Stop()
  }

  [pscustomobject]@{
    Check = $Name
    Method = $Method
    Path = $Path
    Expected = $ExpectedStatus
    Received = $statusCode
    ElapsedMs = [math]::Round($watch.Elapsed.TotalMilliseconds)
    PayloadKb = [math]::Round($payloadBytes / 1024, 2)
    Ok = $statusCode -eq $ExpectedStatus
    Error = $errorMessage
  }
}

$checks = @(
  @{ Name = "Home"; Path = "/"; ExpectedStatus = 200 },
  @{ Name = "Operations Center"; Path = "/squadops"; ExpectedStatus = 200 },
  @{ Name = "Guardian DB health"; Path = "/api/guardian/db/health"; ExpectedStatus = 200 },
  @{ Name = "Guardian queue limit 20"; Path = "/api/guardian/attendance/queue?limit=20"; ExpectedStatus = 200 },
  @{ Name = "Guardian queue limit 50"; Path = "/api/guardian/attendance/queue?limit=50"; ExpectedStatus = 200 },
  @{ Name = "Operations monitoring sem sessao"; Path = "/api/operations/monitoring"; ExpectedStatus = 401 },
  @{ Name = "Operations watcher sem sessao"; Path = "/api/operations/watcher"; ExpectedStatus = 401 },
  @{ Name = "Ticket TI sem sessao"; Path = "/api/hub/it-tickets?scope=all"; ExpectedStatus = 401 },
  @{
    Name = "PO AI sem sessao"
    Path = "/api/squadops/copilot"
    ExpectedStatus = 401
    Method = "POST"
    Body = '{"question":"healthcheck homologacao"}'
  }
)

$results = foreach ($check in $checks) {
  Invoke-HubCheck @check
}

$results | Format-Table -AutoSize

$failed = @($results | Where-Object { -not $_.Ok })

if ($failed.Count -gt 0) {
  Write-Error "Healthcheck de homologacao falhou em $($failed.Count) check(s)."
  exit 1
}

Write-Host "Healthcheck de homologacao aprovado para $BaseUrl"
