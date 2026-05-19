$ErrorActionPreference = "Stop"

$ScriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepositoryRoot = Split-Path -Parent $ScriptDirectory
$LogDirectory = Join-Path $RepositoryRoot ".codex-logs"
$LogPath = Join-Path $LogDirectory "squadops-sync-watch-task.log"
$WatcherScript = Join-Path $ScriptDirectory "squadops-sync-operations-watch.mjs"

New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null
Set-Location $RepositoryRoot

if (-not $env:SQUADOPS_SYNC_ENDPOINT) {
  $env:SQUADOPS_SYNC_ENDPOINT = "http://localhost:3001/api/squadops/operations/structured"
}

$NodePath = (Get-Command node -ErrorAction Stop).Source
$StartedAt = Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz"
"[$StartedAt] starting SquadOps operations sync watcher" | Tee-Object -FilePath $LogPath -Append

& $NodePath $WatcherScript --watch 2>&1 | Tee-Object -FilePath $LogPath -Append
