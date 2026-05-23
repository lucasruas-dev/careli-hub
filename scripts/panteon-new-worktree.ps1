param(
  [Parameter(Mandatory = $true)]
  [string] $Agent,

  [Parameter(Mandatory = $true)]
  [string] $Theme,

  [string] $Date = (Get-Date -Format "yyyyMMdd"),
  [string] $WorktreesRoot,
  [string] $SourceRepoPath,
  [switch] $ExistingBranch,
  [switch] $Apply,
  [switch] $Yes
)

$ErrorActionPreference = "Stop"

function Convert-ToSlug {
  param([Parameter(Mandatory = $true)][string] $Value)

  $slug = $Value.Trim().ToLowerInvariant()
  $slug = $slug -replace "[^a-z0-9]+", "-"
  $slug = $slug.Trim("-")

  if ([string]::IsNullOrWhiteSpace($slug)) {
    throw "Slug vazio gerado a partir de '$Value'."
  }

  return $slug
}

function Get-GitRoot {
  $root = git rev-parse --show-toplevel 2>$null

  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($root)) {
    throw "Execute este script dentro de um worktree Git do Panteon."
  }

  return (Resolve-Path $root).Path
}

function Resolve-DefaultWorktreesRoot {
  param([Parameter(Mandatory = $true)][string] $RepoRoot)

  $repoItem = Get-Item -LiteralPath $RepoRoot
  $parent = $repoItem.Parent.FullName

  if ($parent -like "*careli-hub-worktrees") {
    return $parent
  }

  return (Join-Path $parent "careli-hub-worktrees")
}

function Assert-ChildPath {
  param(
    [Parameter(Mandatory = $true)][string] $ParentPath,
    [Parameter(Mandatory = $true)][string] $ChildPath
  )

  $fullParent = [System.IO.Path]::GetFullPath($ParentPath).TrimEnd([char[]]@("\", "/"))
  $fullChild = [System.IO.Path]::GetFullPath($ChildPath).TrimEnd([char[]]@("\", "/"))

  if (-not $fullChild.StartsWith($fullParent, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Caminho alvo fora de WorktreesRoot. Parent='$fullParent' Child='$fullChild'"
  }
}

$agentSlug = Convert-ToSlug $Agent
$themeSlug = Convert-ToSlug $Theme

if ($Date -notmatch "^\d{8}$") {
  throw "Date deve usar formato yyyymmdd. Recebido: $Date"
}

$repoRoot = if ($SourceRepoPath) {
  (Resolve-Path $SourceRepoPath).Path
} else {
  Get-GitRoot
}

$rootPath = if ($WorktreesRoot) {
  [System.IO.Path]::GetFullPath($WorktreesRoot)
} else {
  Resolve-DefaultWorktreesRoot $repoRoot
}

$branchName = "codex/$agentSlug/$themeSlug-$Date"
$targetPath = [System.IO.Path]::GetFullPath((Join-Path $rootPath $agentSlug))

Assert-ChildPath -ParentPath $rootPath -ChildPath $targetPath

Write-Host "Panteon worktree scaffold"
Write-Host "Source repo: $repoRoot"
Write-Host "Worktrees root: $rootPath"
Write-Host "Target path: $targetPath"
Write-Host "Branch: $branchName"
Write-Host "Mode: $(if ($Apply) { 'apply' } else { 'preview' })"
Write-Host ""

if (Test-Path -LiteralPath $targetPath) {
  throw "Caminho alvo ja existe: $targetPath"
}

$argsList = @("-C", $repoRoot, "worktree", "add", $targetPath)

if ($ExistingBranch) {
  $argsList += $branchName
} else {
  $argsList += @("-b", $branchName)
}

Write-Host "Comando planejado:"
Write-Host ("git " + (($argsList | ForEach-Object {
  if ($_ -match "\s") { '"' + $_ + '"' } else { $_ }
}) -join " "))
Write-Host ""

if (-not $Apply) {
  Write-Host "Preview concluido. Nenhum worktree ou branch foi criado."
  Write-Host "Para executar, rode novamente com -Apply. Use -Yes apenas em execucao assistida e revisada."
  exit 0
}

if (-not (Test-Path -LiteralPath $rootPath)) {
  throw "WorktreesRoot nao existe: $rootPath"
}

if (-not $Yes) {
  $answer = Read-Host "Criar este worktree agora? Digite SIM para continuar"
  if ($answer -ne "SIM") {
    Write-Host "Operacao cancelada pelo operador."
    exit 1
  }
}

& git @argsList

if ($LASTEXITCODE -ne 0) {
  throw "git worktree add falhou com exit code $LASTEXITCODE."
}

Write-Host "Worktree criado com sucesso."
Write-Host "Primeira acao recomendada:"
Write-Host "cd `"$targetPath`""
Write-Host "git status --short --branch"
