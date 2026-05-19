param(
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"

$TaskName = "Careli SquadOps Engineering Operations Sync"
$ScriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepositoryRoot = Split-Path -Parent $ScriptDirectory
$WatcherWrapper = Join-Path $ScriptDirectory "squadops-sync-watch.ps1"
$StartupDirectory = [Environment]::GetFolderPath("Startup")
$StartupCommand = Join-Path $StartupDirectory "Careli SquadOps Engineering Operations Sync.cmd"

if ($Uninstall) {
  $existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

  if ($existingTask) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Tarefa removida: $TaskName"
  } else {
    Write-Host "Tarefa nao encontrada: $TaskName"
  }

  if (Test-Path $StartupCommand) {
    Remove-Item -LiteralPath $StartupCommand -Force
    Write-Host "Inicializador removido: $StartupCommand"
  }

  exit 0
}

if (-not (Test-Path $WatcherWrapper)) {
  throw "Wrapper nao encontrado: $WatcherWrapper"
}

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$WatcherWrapper`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal `
  -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType Interactive `
  -RunLevel Limited

try {
  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "Observa docs/operations/engineering-operations.md e sincroniza o diario operacional do SquadOps quando o Hub local estiver disponivel." `
    -Force | Out-Null

  Write-Host "Tarefa instalada: $TaskName"
} catch {
  New-Item -ItemType Directory -Force -Path $StartupDirectory | Out-Null

  @"
@echo off
cd /d "$RepositoryRoot"
start "Careli SquadOps Sync" powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$WatcherWrapper"
"@ | Set-Content -Path $StartupCommand -Encoding ASCII

  Write-Host "Tarefa agendada bloqueada pelo Windows. Inicializador criado no Startup do usuario."
  Write-Host "Inicializador: $StartupCommand"
}

Write-Host "Endpoint padrao: http://localhost:3001/api/squadops/operations/structured"
Write-Host "Log: .codex-logs/squadops-sync-watch-task.log"
