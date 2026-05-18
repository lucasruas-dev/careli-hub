param(
  [string]$Branch = "homolog",
  [switch]$AllowDirty,
  [switch]$SkipValidation,
  [switch]$RunHealthcheck
)

$ErrorActionPreference = "Stop"

$currentBranch = (git branch --show-current).Trim()

if ($currentBranch -ne $Branch) {
  Write-Error "Deploy de homologacao bloqueado. Branch atual: '$currentBranch'. Branch esperada: '$Branch'."
  Write-Host "Use uma branch dedicada de homologacao antes de publicar preview operacional."
  exit 1
}

$dirtyFiles = @(git status --porcelain)

if ($dirtyFiles.Count -gt 0 -and -not $AllowDirty) {
  Write-Error "Deploy de homologacao bloqueado porque o worktree nao esta limpo."
  $dirtyFiles | ForEach-Object { Write-Host $_ }
  Write-Host "Finalize ou isole o recorte antes de publicar. Use -AllowDirty apenas para diagnostico manual."
  exit 1
}

if (-not $SkipValidation) {
  npm.cmd run check-types:hub
  npm.cmd run lint:hub
  npm.cmd run build --workspace @repo/hub
}

$deploymentOutput = @(npx.cmd vercel deploy --yes)
$deploymentUrl = ($deploymentOutput | Select-Object -Last 1)

if ($LASTEXITCODE -ne 0 -or -not $deploymentUrl) {
  $deploymentOutput | ForEach-Object { Write-Host $_ }
  Write-Error "Deploy de homologacao falhou antes de retornar URL Vercel."
  exit 1
}

$deploymentUrl = $deploymentUrl.Trim()

Write-Host "Deploy de homologacao criado: $deploymentUrl"

if ($RunHealthcheck) {
  powershell -ExecutionPolicy Bypass -File scripts/homologation-healthcheck.ps1 -BaseUrl $deploymentUrl
}
