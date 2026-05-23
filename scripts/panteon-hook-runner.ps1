param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("pre-commit", "commit-msg", "pre-push")]
  [string] $Hook,

  [string] $CommitMsgFile,
  [switch] $DryRun
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([Parameter(Mandatory = $true)][string] $Message)
  Write-Host "==> $Message"
}

function Invoke-Git {
  param(
    [Parameter(Mandatory = $true)][string[]] $Arguments,
    [switch] $AllowFailure
  )

  if ($AllowFailure) {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $output = & git @Arguments 2>$null
    $code = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorActionPreference
  } else {
    $output = & git @Arguments
    $code = $LASTEXITCODE
  }

  if ($code -ne 0 -and -not $AllowFailure) {
    throw "git $($Arguments -join ' ') falhou com exit code $code."
  }

  return @{
    Output = $output
    ExitCode = $code
  }
}

function Get-RepoRoot {
  $result = Invoke-Git -Arguments @("rev-parse", "--show-toplevel")
  return (Resolve-Path ([string] $result.Output)).Path
}

function Get-PanteonPowerShellCommand {
  $pwsh = Get-Command pwsh -ErrorAction SilentlyContinue

  if ($pwsh) {
    try {
      & $pwsh.Source -NoLogo -NoProfile -Command "exit 0" *> $null

      if ($LASTEXITCODE -eq 0) {
        return $pwsh.Source
      }
    } catch {
      # Some hosted Windows sessions can resolve pwsh.exe but fail to launch it.
    }
  }

  return "powershell"
}

function Get-StagedFiles {
  $result = Invoke-Git -Arguments @("diff", "--cached", "--name-only", "--diff-filter=ACMRT")
  return @($result.Output | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Test-BlockedStagedPaths {
  param([string[]] $Files)

  $blocked = New-Object System.Collections.Generic.List[string]

  foreach ($file in $Files) {
    $normalized = $file -replace "\\", "/"
    $leaf = [System.IO.Path]::GetFileName($normalized)

    $isEnv = $leaf -match "^\.env($|\.)" -and $leaf -notmatch "\.(example|sample|template)$"
    $isPrivateKey = $leaf -match "\.(pem|p12|pfx|key)$" -and $leaf -notmatch "\.(example|sample|template)$"
    $isSensitiveConfig = $leaf -match "^\.npmrc$|^\.netrc$"

    if ($isEnv -or $isPrivateKey -or $isSensitiveConfig) {
      $blocked.Add($file)
    }
  }

  if ($blocked.Count -gt 0) {
    Write-Error "Hook bloqueou arquivos sensiveis no stage: $($blocked -join ', ')"
  }
}

function Test-SecretLikeAdditions {
  $diff = Invoke-Git -Arguments @("diff", "--cached", "--unified=0", "--no-ext-diff")
  $patterns = @(
    @{ Name = "secret assignment"; Pattern = "(?i)(secret|token|password|senha|service[_-]?role|postgres_url|database_url|supabase.*key|api[_-]?key)\s*[:=]\s*['""]?[^'""]{8,}" },
    @{ Name = "bearer token"; Pattern = "(?i)bearer\s+[a-z0-9._\-]{20,}" },
    @{ Name = "OpenAI-style key"; Pattern = "(?i)sk-[a-z0-9_\-]{20,}" },
    @{ Name = "JWT"; Pattern = "(?i)eyJ[a-z0-9_\-]{20,}\.[a-z0-9_\-]{20,}\.[a-z0-9_\-]{10,}" },
    @{ Name = "connection string"; Pattern = "(?i)(postgres(ql)?|mysql|mongodb(\+srv)?)://" },
    @{ Name = "known sensitive env"; Pattern = "(?i)(SUPABASE_SERVICE_ROLE_KEY|POSTGRES_URL|DATABASE_URL|OPENAI_API_KEY|VERCEL_TOKEN)\s*=" }
  )

  $matches = New-Object System.Collections.Generic.List[string]

  foreach ($line in @($diff.Output)) {
    if (-not ($line.StartsWith("+")) -or $line.StartsWith("+++")) {
      continue
    }

    foreach ($item in $patterns) {
      if ($line -match $item.Pattern) {
        $matches.Add([string] $item.Name)
      }
    }
  }

  if ($matches.Count -gt 0) {
    $unique = $matches | Sort-Object -Unique
    Write-Error "Hook bloqueou possivel segredo no diff staged. Padroes: $($unique -join ', '). Remova o valor e registre somente nome/impacto."
  }
}

function Invoke-PreCommit {
  Write-Step "Panteon pre-commit"
  $files = Get-StagedFiles

  if ($files.Count -eq 0) {
    Write-Host "Sem arquivos staged. Nada a validar."
    return
  }

  Invoke-Git -Arguments @("diff", "--cached", "--check") | Out-Null
  Test-BlockedStagedPaths -Files $files
  Test-SecretLikeAdditions

  Write-Host "Pre-commit Panteon OK."
}

function Invoke-CommitMsg {
  if ([string]::IsNullOrWhiteSpace($CommitMsgFile) -or -not (Test-Path -LiteralPath $CommitMsgFile)) {
    throw "Arquivo de commit message nao encontrado."
  }

  Write-Step "Panteon commit-msg"

  $lines = Get-Content -LiteralPath $CommitMsgFile
  $firstLine = ($lines | Where-Object {
    -not [string]::IsNullOrWhiteSpace($_) -and -not $_.TrimStart().StartsWith("#")
  } | Select-Object -First 1)

  if ([string]::IsNullOrWhiteSpace($firstLine)) {
    throw "Mensagem de commit vazia."
  }

  $allowedSpecial = $firstLine -match "^(Merge|Revert|fixup!|squash!)"
  $allowedConventional = $firstLine -match "^(feat|fix|docs|chore|refactor|test|build|ci|perf|release|revert)(\([a-z0-9\-]+\))?: .{8,}$"

  if (-not $allowedSpecial -and -not $allowedConventional) {
    Write-Error "Mensagem de commit fora do padrao. Exemplo: feat(zeus): add local git hooks"
  }

  foreach ($line in $lines) {
    if ($line -match "(?i)(secret|token|password|senha|service[_-]?role|postgres_url|database_url)\s*[:=]\s*['""]?[^'""]{8,}") {
      Write-Error "Mensagem de commit parece conter valor sensivel. Remova o valor e mantenha somente nome/impacto."
    }
  }

  Write-Host "Commit message Panteon OK."
}

function Get-PushCandidateFiles {
  $upstream = Invoke-Git -Arguments @("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}") -AllowFailure

  if ($upstream.ExitCode -eq 0 -and -not [string]::IsNullOrWhiteSpace($upstream.Output)) {
    $range = "$($upstream.Output)...HEAD"
    $files = Invoke-Git -Arguments @("diff", "--name-only", $range)
    return @($files.Output | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  }

  $previous = Invoke-Git -Arguments @("rev-parse", "--verify", "HEAD~1") -AllowFailure

  if ($previous.ExitCode -eq 0) {
    $files = Invoke-Git -Arguments @("diff", "--name-only", "HEAD~1..HEAD")
    return @($files.Output | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  }

  $tree = Invoke-Git -Arguments @("diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD") -AllowFailure
  return @($tree.Output | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Invoke-PrePush {
  Write-Step "Panteon pre-push"

  if ($env:PANTEON_HOOK_SKIP_VALIDATION -eq "1") {
    Write-Host "PANTEON_HOOK_SKIP_VALIDATION=1 definido. Validacao pre-push ignorada pelo operador."
    return
  }

  $root = Get-RepoRoot
  $validator = Join-Path $root "scripts/panteon-validate-worktree.ps1"

  if (-not (Test-Path -LiteralPath $validator)) {
    throw "Validador nao encontrado: $validator"
  }

  $files = Get-PushCandidateFiles
  $hasHubCode = $files | Where-Object {
    $_ -match "^(apps/hub|packages)/" -or $_ -match "\.(ts|tsx|js|jsx|mjs|cjs|json)$"
  }

  $scope = if ($hasHubCode) { "hub" } else { "docs" }
  $shell = Get-PanteonPowerShellCommand
  $args = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $validator, "-Scope", $scope)

  if ($scope -eq "hub") {
    $args += @("-PrepareSharedNodeModules", "-SkipBuild")
  }

  if ($DryRun) {
    Write-Host "Dry run: $shell $($args -join ' ')"
    return
  }

  & $shell @args

  if ($LASTEXITCODE -ne 0) {
    throw "Validacao pre-push falhou com exit code $LASTEXITCODE."
  }

  Write-Host "Pre-push Panteon OK."
}

Set-Location (Get-RepoRoot)

switch ($Hook) {
  "pre-commit" { Invoke-PreCommit }
  "commit-msg" { Invoke-CommitMsg }
  "pre-push" { Invoke-PrePush }
}
