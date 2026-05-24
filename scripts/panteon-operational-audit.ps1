param(
  [string]$RepoRoot,
  [switch]$Strict
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
