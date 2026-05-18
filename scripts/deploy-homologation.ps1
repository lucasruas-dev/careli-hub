param(
  [string]$Branch = "homolog",
  [switch]$AllowDirty,
  [switch]$SkipValidation,
  [switch]$RunHealthcheck
)

$ErrorActionPreference = "Stop"

function Stop-HomologationDeploy {
  param(
    [string]$Message,
    [string[]]$Details = @()
  )

  Write-Error -Message $Message -ErrorAction Continue

  foreach ($detail in $Details) {
    Write-Host $detail
  }

  exit 1
}

$currentBranch = (git branch --show-current).Trim()

if ($currentBranch -ne $Branch) {
  Stop-HomologationDeploy `
    -Message "Deploy de homologacao bloqueado. Branch atual: '$currentBranch'. Branch esperada: '$Branch'." `
    -Details @("Use uma branch dedicada de homologacao antes de publicar preview operacional.")
}

$dirtyFiles = @(git status --porcelain)

if ($dirtyFiles.Count -gt 0 -and -not $AllowDirty) {
  Stop-HomologationDeploy `
    -Message "Deploy de homologacao bloqueado porque o worktree nao esta limpo." `
    -Details @(
      $dirtyFiles
      "Finalize ou isole o recorte antes de publicar. Use -AllowDirty apenas para diagnostico manual."
    )
}

if (-not $SkipValidation) {
  npm.cmd run check-types:hub
  npm.cmd run lint:hub
  npm.cmd run build --workspace @repo/hub
}

$deploymentOutput = @(npx.cmd vercel deploy --yes)
$deploymentUrl = ($deploymentOutput | Select-Object -Last 1)

if ($LASTEXITCODE -ne 0 -or -not $deploymentUrl) {
  Stop-HomologationDeploy `
    -Message "Deploy de homologacao falhou antes de retornar URL Vercel." `
    -Details $deploymentOutput
}

$deploymentUrl = $deploymentUrl.Trim()

Write-Host "Deploy de homologacao criado: $deploymentUrl"

if ($RunHealthcheck) {
  powershell -ExecutionPolicy Bypass -File scripts/homologation-healthcheck.ps1 -BaseUrl $deploymentUrl
}
