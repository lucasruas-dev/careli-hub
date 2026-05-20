param(
  [string]$PackagePath = ".codex-deploy\iris-meta-homolog-0024"
)

$ErrorActionPreference = "Stop"

$keys = @(
  "ASANA_TASK_LIMIT_PER_USER",
  "ASANA_TASK_WINDOW_DAYS",
  "ASANA_WORKSPACE_GID",
  "ASANA_WORKSPACE_MODE",
  "ASANA_ACCESS_TOKEN",
  "GUARDIAN_DB_PASSWORD",
  "GUARDIAN_DB_USER",
  "GUARDIAN_DB_NAME",
  "GUARDIAN_DB_PORT",
  "GUARDIAN_DB_HOST",
  "SUPABASE_SERVICE_ROLE_KEY",
  "HOMOLOG_SUPABASE_SERVICE_ROLE_KEY",
  "HOMOLOG_POSTGRES_URL",
  "NEXT_PUBLIC_SUPABASE_WORKSPACE_ID",
  "NEXT_PUBLIC_CARELI_ENABLE_MOCKS",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_CARELI_APP_URL",
  "NEXT_PUBLIC_CARELI_APP_ENV",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "META_WHATSAPP_APP_ID",
  "META_WHATSAPP_APP_SECRET",
  "META_WHATSAPP_ACCESS_TOKEN",
  "META_WHATSAPP_BUSINESS_ACCOUNT_ID",
  "META_WHATSAPP_PHONE_NUMBER_ID",
  "META_WHATSAPP_WEBHOOK_VERIFY_TOKEN",
  "META_WHATSAPP_GRAPH_VERSION"
)

$argsList = @(
  "vercel",
  "deploy",
  "--yes",
  "--target",
  "preview",
  "--force",
  "--cwd",
  $PackagePath
)
$includedKeys = @()

foreach ($key in $keys) {
  $item = Get-Item -Path "Env:$key" -ErrorAction SilentlyContinue

  if ($item -and $item.Value) {
    $pair = "$key=$($item.Value)"
    $argsList += @("--env", $pair, "--build-env", $pair)
    $includedKeys += $key
  }
}

Write-Host "Iris homolog deploy env names included: $($includedKeys -join ', ')"
& npx.cmd @argsList
