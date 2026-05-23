param(
  [ValidateSet("hub", "docs")]
  [string]$Scope = "hub",

  [ValidateSet("webpack", "default")]
  [string]$BuildMode = "webpack",

  [string]$MainRepoPath,

  [switch]$PrepareSharedNodeModules,
  [switch]$SkipBuild,
  [switch]$SkipLint,
  [switch]$SkipTypes
)

$ErrorActionPreference = "Stop"

function Resolve-RepoRoot {
  $root = (& git rev-parse --show-toplevel).Trim()

  if (-not $root) {
    throw "Nao foi possivel resolver o root Git do worktree."
  }

  return (Resolve-Path -LiteralPath $root).Path
}

function Resolve-MainRepoPath {
  param(
    [string]$WorktreeRoot,
    [string]$ProvidedPath
  )

  if ($ProvidedPath) {
    return (Resolve-Path -LiteralPath $ProvidedPath).Path
  }

  if ((Split-Path -Leaf $WorktreeRoot) -eq "careli-hub") {
    return $WorktreeRoot
  }

  $worktreeParent = Split-Path -Parent $WorktreeRoot
  $systemsRoot = Split-Path -Parent $worktreeParent
  $candidate = Join-Path $systemsRoot "careli-hub"

  if (Test-Path -LiteralPath $candidate) {
    return (Resolve-Path -LiteralPath $candidate).Path
  }

  throw "Informe -MainRepoPath apontando para o repositorio principal careli-hub."
}

function Ensure-SharedNodeModules {
  param(
    [string]$WorktreeRoot,
    [string]$MainRepoRoot
  )

  $mainNodeModules = Join-Path $MainRepoRoot "node_modules"
  $worktreeNodeModules = Join-Path $WorktreeRoot "node_modules"

  if (-not (Test-Path -LiteralPath $mainNodeModules)) {
    throw "node_modules nao encontrado no repositorio principal: $mainNodeModules"
  }

  if (Test-Path -LiteralPath $worktreeNodeModules) {
    $item = Get-Item -LiteralPath $worktreeNodeModules -Force

    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) {
      throw "node_modules ja existe no worktree e nao e junction. Nao vou alterar."
    }

    return
  }

  if (-not $PrepareSharedNodeModules) {
    throw "node_modules ausente no worktree. Rode novamente com -PrepareSharedNodeModules para criar junction local."
  }

  New-Item -ItemType Junction -Path $worktreeNodeModules -Target $mainNodeModules | Out-Null
}

function Invoke-Step {
  param(
    [string]$Label,
    [scriptblock]$Command
  )

  Write-Host ""
  Write-Host "==> $Label" -ForegroundColor Cyan
  $global:LASTEXITCODE = 0
  & $Command

  if ($LASTEXITCODE -ne 0) {
    throw "$Label falhou com exit code $LASTEXITCODE."
  }
}

$worktreeRoot = Resolve-RepoRoot
$mainRepoRoot = Resolve-MainRepoPath -WorktreeRoot $worktreeRoot -ProvidedPath $MainRepoPath
$mainBinPath = Join-Path $mainRepoRoot "node_modules\.bin"

Write-Host "Panteon worktree validation" -ForegroundColor Green
Write-Host "Worktree: $worktreeRoot"
Write-Host "Main repo: $mainRepoRoot"
Write-Host "Scope: $Scope"

Push-Location $worktreeRoot
try {
  if ($Scope -eq "hub") {
    Ensure-SharedNodeModules -WorktreeRoot $worktreeRoot -MainRepoRoot $mainRepoRoot
    $env:PATH = "$mainBinPath;$env:PATH"
  }

  Invoke-Step "git status" {
    git status --short --branch
  }

  Invoke-Step "git diff --check" {
    git diff --check
  }

  if ($Scope -eq "docs") {
    Write-Host ""
    Write-Host "Validacao documental concluida." -ForegroundColor Green
    exit 0
  }

  if (-not $SkipTypes) {
    Invoke-Step "check-types:hub" {
      npm.cmd run check-types:hub
    }
  }

  if (-not $SkipLint) {
    Invoke-Step "lint:hub" {
      npm.cmd run lint:hub
    }
  }

  if (-not $SkipBuild) {
    if ($BuildMode -eq "webpack") {
      Invoke-Step "build hub webpack" {
        npm.cmd exec --workspace @repo/hub -- next build --webpack
      }
    } else {
      Invoke-Step "build hub default" {
        npm.cmd run build --workspace @repo/hub
      }
    }
  }

  Write-Host ""
  Write-Host "Validacao do worktree concluida." -ForegroundColor Green
} finally {
  Pop-Location
}
