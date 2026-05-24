param(
  [string]$RepoRoot,
  [switch]$Strict,
  [switch]$CheckWatcher,
  [switch]$CheckVercelAliases
)

$ErrorActionPreference = "Stop"

function Resolve-RepoRoot {
  param([string]$ProvidedPath)

  if ($ProvidedPath) {
    return (Resolve-Path -LiteralPath $ProvidedPath).Path
  }

  $root = (& git rev-parse --show-toplevel).Trim()

  if (-not $root) {
    throw "Nao foi possivel resolver o root Git."
  }

  return (Resolve-Path -LiteralPath $root).Path
}

function Write-Check {
  param(
    [string]$Name,
    [string]$Status,
    [string]$Detail
  )

  $label = "{0,-10}" -f "[$Status]"
  Write-Host "$label $Name - $Detail"
}

function Test-RequiredFile {
  param([string]$Path)

  if (Test-Path -LiteralPath $Path) {
    Write-Check -Name $Path -Status "OK" -Detail "encontrado"
    return $false
  }

  Write-Check -Name $Path -Status "WARN" -Detail "ausente"
  return $true
}

function Test-KnownDuplicateMigrationGroup {
  param(
    [string]$Prefix,
    [string[]]$Names
  )

  if (-not $knownDuplicateMigrationPrefixes.ContainsKey($Prefix)) {
    return $false
  }

  $expected = @($knownDuplicateMigrationPrefixes[$Prefix] | Sort-Object)
  $actual = @($Names | Sort-Object)

  if ($expected.Count -ne $actual.Count) {
    return $false
  }

  for ($index = 0; $index -lt $expected.Count; $index++) {
    if ($expected[$index] -ne $actual[$index]) {
      return $false
    }
  }

  return $true
}

function Get-InspectValue {
  param(
    [string]$Text,
    [string]$Name
  )

  $match = [regex]::Match($Text, "(?m)^\s*$([regex]::Escape($Name))\s+(.+?)\s*$")

  if (-not $match.Success) {
    return "-"
  }

  return $match.Groups[1].Value.Trim()
}

function Invoke-WatcherStatusCheck {
  param([string]$RootPath)

  $watcherLogPath = Join-Path $RootPath ".codex-logs/squadops-sync-watch.log"

  if (-not (Test-Path -LiteralPath $watcherLogPath)) {
    Write-Check -Name "watcher sync" -Status "WARN" -Detail "log ausente em .codex-logs/squadops-sync-watch.log"
    return 1
  }

  $lastSyncLine = Get-Content -LiteralPath $watcherLogPath -Tail 120 |
    Where-Object { $_ -match "sync ok" } |
    Select-Object -Last 1

  if (-not $lastSyncLine) {
    Write-Check -Name "watcher sync" -Status "WARN" -Detail "nenhum sync ok encontrado no log recente"
    return 1
  }

  if ($lastSyncLine -notmatch "^\[(?<timestamp>[^\]]+)\]") {
    Write-Check -Name "watcher sync" -Status "WARN" -Detail "ultimo sync sem timestamp parseavel"
    return 1
  }

  try {
    $timestamp = [DateTimeOffset]::Parse($Matches.timestamp)
    $ageMinutes = [math]::Round(([DateTimeOffset]::UtcNow - $timestamp.ToUniversalTime()).TotalMinutes, 1)

    if ($ageMinutes -gt 1440) {
      Write-Check -Name "watcher sync" -Status "WARN" -Detail "ultimo sync ok ha $ageMinutes min"
      return 1
    }

    Write-Check -Name "watcher sync" -Status "OK" -Detail "ultimo sync ok ha $ageMinutes min"
    return 0
  } catch {
    Write-Check -Name "watcher sync" -Status "WARN" -Detail "timestamp invalido no ultimo sync"
    return 1
  }
}

function Invoke-VercelAliasCheck {
  $aliases = @(
    "https://c2x.app.br",
    "https://ops.c2x.app.br",
    "https://homo.c2x.app.br"
  )
  $summaries = @()
  $localWarningCount = 0

  foreach ($alias in $aliases) {
    try {
      $output = & npx.cmd vercel inspect $alias 2>&1
      $exitCode = $LASTEXITCODE
      $text = $output -join "`n"

      if ($exitCode -ne 0) {
        Write-Check -Name "vercel alias $alias" -Status "WARN" -Detail "inspect falhou com exit code $exitCode"
        $localWarningCount++
        continue
      }

      $summary = [pscustomobject]@{
        Alias = $alias
        Id = Get-InspectValue -Text $text -Name "id"
        Target = Get-InspectValue -Text $text -Name "target"
        Status = Get-InspectValue -Text $text -Name "status"
        Url = Get-InspectValue -Text $text -Name "url"
      }
      $summaries += $summary

      Write-Check -Name "vercel alias $alias" -Status "OK" -Detail "$($summary.Id) | target=$($summary.Target) | status=$($summary.Status)"
    } catch {
      Write-Check -Name "vercel alias $alias" -Status "WARN" -Detail "inspect indisponivel: $($_.Exception.Message)"
      $localWarningCount++
    }
  }

  $c2x = $summaries | Where-Object { $_.Alias -eq "https://c2x.app.br" } | Select-Object -First 1
  $ops = $summaries | Where-Object { $_.Alias -eq "https://ops.c2x.app.br" } | Select-Object -First 1
  $homo = $summaries | Where-Object { $_.Alias -eq "https://homo.c2x.app.br" } | Select-Object -First 1

  if ($c2x -and $ops) {
    if ($c2x.Id -eq $ops.Id) {
      Write-Check -Name "production alias pair" -Status "OK" -Detail "c2x e ops compartilham $($c2x.Id)"
    } else {
      Write-Check -Name "production alias pair" -Status "WARN" -Detail "c2x=$($c2x.Id), ops=$($ops.Id)"
      $localWarningCount++
    }
  }

  if ($homo -and $homo.Target -notmatch "preview") {
    Write-Check -Name "homolog alias" -Status "WARN" -Detail "homo target inesperado: $($homo.Target)"
    $localWarningCount++
  } elseif ($homo) {
    Write-Check -Name "homolog alias" -Status "OK" -Detail "homo em target preview"
  }

  return $localWarningCount
}

$repo = Resolve-RepoRoot -ProvidedPath $RepoRoot
$warningCount = 0
$controlledIssueCount = 0
$knownDuplicateMigrationPrefixes = @{
  "0003" = @(
    "0003_setup_beta_policies.sql",
    "0003_setup_operational_access.sql"
  )
}

Write-Host "Panteon operational audit"
Write-Host "Repo: $repo"
Write-Host "Mode: $(if ($Strict) { 'strict' } else { 'read-only' })"
Write-Host "Watcher check: $(if ($CheckWatcher) { 'on' } else { 'off' })"
Write-Host "Vercel alias check: $(if ($CheckVercelAliases) { 'on' } else { 'off' })"
Write-Host ""

Push-Location $repo
try {
  $branch = (& git status --short --branch) -join " | "
  Write-Check -Name "git status" -Status "OK" -Detail $branch

  $requiredFiles = @(
    "docs/operations/README.md",
    "docs/operations/engineering-operations.md",
    "docs/operations/releases-homologation.md",
    "docs/operations/releases-production.md",
    "docs/operations/panteon-operational-risk-register.md",
    "docs/operations/panteon-migration-governance.md",
    "docs/operations/panteon-protocol-migration-plan.md",
    "docs/operations/panteon-worktree-operating-model.md",
    "docs/operations/panteon-validation-checklists.md",
    "docs/operations/squadops-center-process.md",
    "docs/architecture/production-safety-policy.md",
    "docs/architecture/release-and-rollback-policy.md",
    "docs/architecture/secret-management-policy.md"
  )

  foreach ($file in $requiredFiles) {
    if (Test-RequiredFile -Path $file) {
      $warningCount++
    }
  }

  $migrationCandidates = @(
    "packages/database/migrations",
    "supabase/migrations"
  )
  $migrationsDir = $migrationCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

  if ($migrationsDir) {
    $migrations = Get-ChildItem -LiteralPath $migrationsDir -Filter "*.sql" -File | Sort-Object Name
    $groups = $migrations |
      ForEach-Object {
        if ($_.Name -match "^(\d+)_") {
          [pscustomobject]@{
            Prefix = $Matches[1]
            Name = $_.Name
          }
        }
      } |
      Group-Object Prefix |
      Where-Object { $_.Count -gt 1 }

    if ($groups) {
      foreach ($group in $groups) {
        $groupNames = @($group.Group | Select-Object -ExpandProperty Name)
        $names = $groupNames -join ", "

        if (Test-KnownDuplicateMigrationGroup -Prefix $group.Name -Names $groupNames) {
          Write-Check -Name "migration prefix $($group.Name)" -Status "CONTROLLED" -Detail "duplicidade historica reconhecida: $names"
          $controlledIssueCount++
        } else {
          Write-Check -Name "migration prefix $($group.Name)" -Status "WARN" -Detail "duplicado: $names"
          $warningCount++
        }
      }
    } else {
      Write-Check -Name "migration prefixes" -Status "OK" -Detail "sem duplicidade numerica"
    }
  } else {
    Write-Check -Name "migrations" -Status "WARN" -Detail "diretorio de migrations nao encontrado"
    $warningCount++
  }

  $worktrees = (& git worktree list --porcelain)
  $worktreeCount = ($worktrees | Where-Object { $_ -like "worktree *" }).Count
  Write-Check -Name "worktrees" -Status "OK" -Detail "$worktreeCount worktrees registrados"

  $releaseFiles = @(
    "docs/operations/releases-homologation.md",
    "docs/operations/releases-production.md",
    "docs/operations/panteon-operational-risk-register.md"
  )

  foreach ($releaseFile in $releaseFiles) {
    if (Test-Path -LiteralPath $releaseFile) {
      $matches = Select-String -LiteralPath $releaseFile -Pattern "PRONTO PARA PRODUCAO|BLOQUEADO|EM HOMOLOGACAO|EM PRODUCAO|OPERACIONAL COM ATENCAO|PENDENTE" -AllMatches
      Write-Check -Name $releaseFile -Status "OK" -Detail "$($matches.Count) sinais operacionais encontrados"
    }
  }

  if ($CheckWatcher) {
    $warningCount += Invoke-WatcherStatusCheck -RootPath $repo
  }

  if ($CheckVercelAliases) {
    $warningCount += Invoke-VercelAliasCheck
  }

  Write-Host ""
  if ($warningCount -gt 0) {
    Write-Check -Name "summary" -Status "WARN" -Detail "$warningCount alerta(s), $controlledIssueCount controlado(s)"
  } else {
    Write-Check -Name "summary" -Status "OK" -Detail "nenhum alerta nao controlado; $controlledIssueCount controlado(s)"
  }

  if ($Strict -and $warningCount -gt 0) {
    exit 2
  }
} finally {
  Pop-Location
}
