param(
  [string[]] $Hooks = @("pre-commit", "commit-msg", "pre-push"),
  [switch] $Apply,
  [switch] $Yes,
  [switch] $Force
)

$ErrorActionPreference = "Stop"

function Invoke-Git {
  param([Parameter(Mandatory = $true)][string[]] $Arguments)

  $output = & git @Arguments

  if ($LASTEXITCODE -ne 0) {
    throw "git $($Arguments -join ' ') falhou com exit code $LASTEXITCODE."
  }

  return $output
}

function Get-RepoRoot {
  $root = Invoke-Git -Arguments @("rev-parse", "--show-toplevel")
  return (Resolve-Path ([string] $root)).Path
}

function Get-GitHooksPath {
  $path = Invoke-Git -Arguments @("rev-parse", "--git-path", "hooks")
  return [System.IO.Path]::GetFullPath([string] $path)
}

function Confirm-Install {
  if ($Yes) {
    return
  }

  $answer = Read-Host "Instalar hooks Panteon neste repositorio? Digite SIM para continuar"

  if ($answer -ne "SIM") {
    throw "Instalacao cancelada pelo operador."
  }
}

$repoRoot = Get-RepoRoot
$templateRoot = Join-Path $repoRoot ".githooks"
$hooksPath = Get-GitHooksPath
$timestamp = Get-Date -Format "yyyyMMddHHmmss"

Write-Host "Panteon hooks installer"
Write-Host "Repo: $repoRoot"
Write-Host "Templates: $templateRoot"
Write-Host "Git hooks path: $hooksPath"
Write-Host "Mode: $(if ($Apply) { 'apply' } else { 'preview' })"
Write-Host ""

if (-not (Test-Path -LiteralPath $templateRoot)) {
  throw "Diretorio de templates nao encontrado: $templateRoot"
}

foreach ($hook in $Hooks) {
  if ($hook -notin @("pre-commit", "commit-msg", "pre-push")) {
    throw "Hook nao suportado: $hook"
  }

  $source = Join-Path $templateRoot $hook
  $target = Join-Path $hooksPath $hook

  if (-not (Test-Path -LiteralPath $source)) {
    throw "Template nao encontrado: $source"
  }

  Write-Host "Hook: $hook"
  Write-Host "  source: $source"
  Write-Host "  target: $target"

  if (Test-Path -LiteralPath $target) {
    $same = ((Get-FileHash -LiteralPath $source).Hash -eq (Get-FileHash -LiteralPath $target).Hash)
    Write-Host "  existing: yes"

    if ($same) {
      Write-Host "  action: already installed"
      continue
    }

    $backup = "$target.panteon-backup-$timestamp"
    Write-Host "  action: backup existing to $backup, then install"
  } else {
    Write-Host "  existing: no"
    Write-Host "  action: install"
  }
}

if (-not $Apply) {
  Write-Host ""
  Write-Host "Preview concluido. Nenhum hook foi instalado."
  Write-Host "Para instalar, rode novamente com -Apply."
  exit 0
}

Confirm-Install

if (-not (Test-Path -LiteralPath $hooksPath)) {
  New-Item -ItemType Directory -Path $hooksPath | Out-Null
}

foreach ($hook in $Hooks) {
  $source = Join-Path $templateRoot $hook
  $target = Join-Path $hooksPath $hook

  if (Test-Path -LiteralPath $target) {
    $same = ((Get-FileHash -LiteralPath $source).Hash -eq (Get-FileHash -LiteralPath $target).Hash)

    if ($same) {
      continue
    }

    $backup = "$target.panteon-backup-$timestamp"

    if (-not $Force) {
      Copy-Item -LiteralPath $target -Destination $backup
    }
  }

  Copy-Item -LiteralPath $source -Destination $target -Force
}

Write-Host "Hooks Panteon instalados."
Write-Host "Para testar:"
Write-Host "pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/panteon-hook-runner.ps1 -Hook pre-commit"
