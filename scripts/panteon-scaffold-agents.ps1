param(
  [string[]] $Agents = @("zeus", "hefesto", "iris", "hades", "ares", "hermes", "atlas", "chronos", "setup", "apolo"),
  [string] $Theme = "worktree-pilot",
  [string] $Date = (Get-Date -Format "yyyyMMdd"),
  [string] $WorktreesRoot,
  [string] $SourceRepoPath,
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

function Get-AgentProfile {
  param([Parameter(Mandatory = $true)][string] $AgentSlug)

  $profiles = @{
    "zeus" = @{
      Module = "Zeus"
      Scope = "Operations Center, governanca, comunicacao entre agentes, suporte, dados e infraestrutura em modo protegido"
      Blocked = "banco real, env, secret, Vercel, Supabase, alias, dominio, deploy, rollback e producao sem autorizacao explicita"
    }
    "hefesto" = @{
      Module = "Hefesto"
      Scope = "promocao para producao, healthchecks finais, rollback e rastreabilidade oficial"
      Blocked = "feature de modulo, pacote misto, producao sem homologacao, alias/env/secret sem autorizacao explicita"
    }
    "iris" = @{
      Module = "Iris"
      Scope = "atendimento, setup de templates, filas, comunicacao externa e integracoes aprovadas"
      Blocked = "envio externo real, Meta/WhatsApp real, env, secret, webhook e producao sem autorizacao explicita"
    }
    "hades" = @{
      Module = "Hades"
      Scope = "cobrancas, financeiro operacional, contratos, boletos e regras legadas C2X preservadas"
      Blocked = "mudanca financeira destrutiva, dados reais sensiveis, banco, env, secret e producao sem autorizacao explicita"
    }
    "ares" = @{
      Module = "Ares"
      Scope = "financeiro tatico, disputas, acordos, escalonamentos e demandas financeiras que podem acionar Iris"
      Blocked = "alteracao financeira real, cobranca externa, dados sensiveis, banco, env, secret e producao sem autorizacao explicita"
    }
    "hermes" = @{
      Module = "Hermes"
      Scope = "comunicacao interna, realtime, mensagens, notificacoes e anexos"
      Blocked = "Realtime/Supabase mutavel, env, secret, notificacao externa real e producao sem autorizacao explicita"
    }
    "atlas" = @{
      Module = "Atlas"
      Scope = "indicadores, performance, dashboards, auditoria e relatorios operacionais"
      Blocked = "consulta destrutiva, banco real mutavel, env, secret e producao sem autorizacao explicita"
    }
    "chronos" = @{
      Module = "Chronos"
      Scope = "jobs, agenda operacional, rotinas temporais, filas programadas e diagnostico de execucao"
      Blocked = "cron real, job mutavel, fila externa, env, secret, Vercel e producao sem autorizacao explicita"
    }
    "setup" = @{
      Module = "Setup"
      Scope = "configuracoes administrativas, permissoes, onboarding operacional e setup central"
      Blocked = "permissao destrutiva, auth real mutavel, env, secret, banco e producao sem autorizacao explicita"
    }
    "apolo" = @{
      Module = "Apolo"
      Scope = "planejamento operacional, apoio de produto, inteligencia assistida e triagem de oportunidades"
      Blocked = "acao automatica sensivel, IA executando mudanca real, env, secret, banco e producao sem autorizacao explicita"
    }
  }

  if ($profiles.ContainsKey($AgentSlug)) {
    return $profiles[$AgentSlug]
  }

  return @{
    Module = (Get-Culture).TextInfo.ToTitleCase($AgentSlug)
    Scope = "recorte operacional definido pelo Lucas"
    Blocked = "operacoes sensiveis sem autorizacao explicita"
  }
}

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

$themeSlug = Convert-ToSlug $Theme
$agentList = @(
  foreach ($agent in $Agents) {
    foreach ($item in ($agent -split ",")) {
      if (-not [string]::IsNullOrWhiteSpace($item)) {
        $item.Trim()
      }
    }
  }
)

if ($agentList.Count -eq 0) {
  throw "Nenhum agente informado para scaffold."
}

Write-Host "Panteon agent scaffolds"
Write-Host "Source repo: $repoRoot"
Write-Host "Worktrees root: $rootPath"
Write-Host "Theme: $themeSlug"
Write-Host "Date: $Date"
Write-Host "Mode: $(if ($Apply) { 'apply' } else { 'preview' })"
Write-Host ""

foreach ($agent in $agentList) {
  $agentSlug = Convert-ToSlug $agent
  $profile = Get-AgentProfile $agentSlug
  $branchName = "codex/$agentSlug/$themeSlug-$Date"
  $targetPath = [System.IO.Path]::GetFullPath((Join-Path $rootPath $agentSlug))
  Assert-ChildPath -ParentPath $rootPath -ChildPath $targetPath

  Write-Host "==> $($profile.Module)"
  Write-Host "Agent: $agentSlug"
  Write-Host "Scope: $($profile.Scope)"
  Write-Host "Worktree: $targetPath"
  Write-Host "Branch: $branchName"
  Write-Host "Blocked: $($profile.Blocked)"

  if (Test-Path -LiteralPath $targetPath) {
    Write-Host "Status: EXISTE - nao sera recriado"
  } else {
    Write-Host "Status: PRONTO PARA SCAFFOLD"
  }

  Write-Host "Preview command:"
  Write-Host "powershell -ExecutionPolicy Bypass -File scripts/panteon-new-worktree.ps1 -Agent $agentSlug -Theme $themeSlug -Date $Date"
  Write-Host ""
}

if (-not $Apply) {
  Write-Host "Preview concluido. Nenhum worktree foi criado."
  Write-Host "Para criar um agente especifico, revise o comando acima e rode panteon-new-worktree.ps1 com -Apply."
  exit 0
}

if (-not $Yes) {
  $answer = Read-Host "Este script nao cria multiplos worktrees automaticamente. Digite SIM para imprimir comandos finais"
  if ($answer -ne "SIM") {
    Write-Host "Operacao cancelada pelo operador."
    exit 1
  }
}

Write-Host "Comandos finais revisados. Execute cada agente individualmente com panteon-new-worktree.ps1 -Apply."
