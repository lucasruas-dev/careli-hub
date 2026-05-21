param(
  [string]$SourceBranch = "homolog",
  [string]$SourceEnvFile = "",
  [string[]]$Keys = @(),
  [switch]$AllowPartial,
  [switch]$Apply,
  [switch]$PromoteBranchScopedMetadata,
  [string]$ProjectRoot = ""
)

$ErrorActionPreference = "Stop"

function Get-DefaultPreviewKeys {
  return @(
    "META_WHATSAPP_APP_ID",
    "META_WHATSAPP_APP_SECRET",
    "META_WHATSAPP_ACCESS_TOKEN",
    "META_WHATSAPP_BUSINESS_ACCOUNT_ID",
    "META_WHATSAPP_PHONE_NUMBER_ID",
    "META_WHATSAPP_WEBHOOK_VERIFY_TOKEN",
    "META_WHATSAPP_GRAPH_VERSION",
    "ASANA_ACCESS_TOKEN",
    "ASANA_WORKSPACE_MODE",
    "ASANA_WORKSPACE_GID",
    "ASANA_TASK_WINDOW_DAYS",
    "ASANA_TASK_LIMIT_PER_USER",
    "GUARDIAN_DB_HOST",
    "GUARDIAN_DB_PORT",
    "GUARDIAN_DB_NAME",
    "GUARDIAN_DB_USER",
    "GUARDIAN_DB_PASSWORD",
    "SUPABASE_SERVICE_ROLE_KEY",
    "HOMOLOG_SUPABASE_SERVICE_ROLE_KEY",
    "HOMOLOG_POSTGRES_URL",
    "NEXT_PUBLIC_SUPABASE_WORKSPACE_ID",
    "NEXT_PUBLIC_CARELI_ENABLE_MOCKS",
    "NEXT_PUBLIC_APP_URL",
    "NEXT_PUBLIC_CARELI_APP_URL",
    "NEXT_PUBLIC_CARELI_APP_ENV"
  )
}

function Read-DotEnvFile {
  param([string]$Path)

  $map = @{}
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
      $name = $matches[1]
      $value = $matches[2]
      if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
        $value = $value.Substring(1, $value.Length - 2)
      }
      $map[$name] = $value
    }
  }

  return $map
}

function Test-UsableEnvValue {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $false
  }

  $normalized = $Value.Trim()
  if ($normalized -eq '""' -or $normalized -eq "''") {
    return $false
  }

  return $true
}

if ($Keys.Count -eq 0) {
  $Keys = Get-DefaultPreviewKeys
}

if (-not $ProjectRoot) {
  $ProjectRoot = (Resolve-Path ".").Path
}

$runnerPath = Join-Path $ProjectRoot ".codex-artifacts\vercel-preview-env-sync"
$runnerVercelDir = Join-Path $runnerPath ".vercel"
$projectConfig = Join-Path $ProjectRoot ".vercel\project.json"
$pulledEnvFile = Join-Path $runnerPath "preview-homolog.env"
$valueFile = Join-Path $runnerPath "value.tmp"

if (-not (Test-Path -LiteralPath $projectConfig)) {
  throw "Vercel project config not found at .vercel/project.json."
}

$projectId = (Get-Content -LiteralPath $projectConfig -Raw | ConvertFrom-Json).projectId
if (-not $projectId) {
  throw "Vercel project id not found in .vercel/project.json."
}

New-Item -ItemType Directory -Force -Path $runnerVercelDir | Out-Null
Copy-Item -LiteralPath $projectConfig -Destination (Join-Path $runnerVercelDir "project.json") -Force

try {
  if ($PromoteBranchScopedMetadata) {
    $envsJson = & npx.cmd vercel --cwd $runnerPath api "/v10/projects/$projectId/env" --raw
    $envs = ($envsJson | ConvertFrom-Json).envs
    $items = @(
      $envs | Where-Object {
        $Keys -contains $_.key -and
        $_.target -contains "preview" -and
        $_.gitBranch -eq $SourceBranch
      }
    )

    if ($items.Count -eq 0) {
      Write-Output ("No branch-scoped Preview envs found for branch {0}." -f $SourceBranch)
      exit 0
    }

    if (-not $Apply) {
      Write-Output ("Dry run only. Branch-scoped Preview envs that would be promoted: " + (($items | ForEach-Object { $_.key }) -join ", "))
      Write-Output "Use -Apply with -PromoteBranchScopedMetadata to remove the gitBranch metadata without reading secret values."
      exit 0
    }

    $body = @{ target = @("preview"); gitBranch = $null } | ConvertTo-Json -Compress
    foreach ($item in $items) {
      $response = $body | npx.cmd vercel --cwd $runnerPath api "/v9/projects/$projectId/env/$($item.id)" -X PATCH --input - --raw
      if ($LASTEXITCODE -ne 0) {
        throw ("Failed to promote metadata for {0}." -f $item.key)
      }

      $updated = $response | ConvertFrom-Json
      Write-Output ("Promoted to Preview scope: {0}" -f $updated.key)
    }

    exit 0
  }

  if ($SourceEnvFile) {
    if (-not (Test-Path -LiteralPath $SourceEnvFile)) {
      throw "Source env file not found."
    }
    $envMap = Read-DotEnvFile -Path $SourceEnvFile
    Write-Output "Source: local env file supplied by Lucas."
  } else {
    & npx.cmd vercel --cwd $runnerPath env pull $pulledEnvFile --environment=preview --git-branch=$SourceBranch --yes | Out-Null
    Start-Sleep -Seconds 2
    $envMap = Read-DotEnvFile -Path $pulledEnvFile
    Write-Output ("Source: Vercel Preview branch {0}." -f $SourceBranch)
  }

  $missingOrHidden = @()
  foreach ($key in $Keys) {
    if (-not $envMap.ContainsKey($key) -or -not (Test-UsableEnvValue -Value ([string]$envMap[$key]))) {
      $missingOrHidden += $key
    }
  }

  if ($missingOrHidden.Count -gt 0) {
    Write-Output ("Blocked: missing or non-readable env names: " + ($missingOrHidden -join ", "))
    Write-Output "Reason: Vercel sensitive env values are non-readable after creation. Re-enter these values in the Vercel dashboard or provide a local ignored env file with real values."
    if (-not $AllowPartial) {
      exit 2
    }
  }

  $keysToSync = @($Keys | Where-Object { $envMap.ContainsKey($_) -and (Test-UsableEnvValue -Value ([string]$envMap[$_])) })

  if (-not $Apply) {
    Write-Output ("Dry run only. Usable env names: " + ($keysToSync -join ", "))
    Write-Output "Use -Apply only after confirming the source file contains the intended homologation values."
    exit 0
  }

  if ($keysToSync.Count -eq 0) {
    Write-Output "No usable env values to sync."
    exit 2
  }

  foreach ($key in $keysToSync) {
    Set-Content -LiteralPath $valueFile -Value ([string]$envMap[$key]) -NoNewline
    Get-Content -Raw -LiteralPath $valueFile | npx.cmd vercel --cwd $runnerPath env add $key preview --force --yes | Out-Null
    Clear-Content -LiteralPath $valueFile
    Write-Output ("Synced to Preview scope: {0}" -f $key)
  }
} finally {
  Remove-Item -LiteralPath $pulledEnvFile -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $valueFile -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $runnerPath -Recurse -Force -ErrorAction SilentlyContinue
}
