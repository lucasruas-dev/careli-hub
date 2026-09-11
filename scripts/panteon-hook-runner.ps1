# O RUNNER DOS GIT HOOKS DO PANTEON.
#
# Os hooks versionados (scripts/git-hooks/*) chamam este arquivo. Eles JA existem e sao resilientes:
# se este runner nao existir, eles saem limpos e o commit passa sem validacao nenhuma. Foi o que
# aconteceu entre ~2026-05-23 (quando o runner original se perdeu) e 2026-09-11: nada foi conferido
# antes de nenhum commit deste repo.
#
# ATENCAO 1: SEM ACENTO NAS MENSAGENS. O terminal que o git usa no Windows nem sempre esta em UTF-8,
# e acento vira lixo justamente na hora em que alguem precisa LER por que o commit foi barrado. Os
# hooks .sh ao lado seguem a mesma regra.
#
# ATENCAO 2: RAPIDO NO COMMIT, PESADO NO PUSH. O pre-commit so faz o que e instantaneo (grep no que
# esta no stage). Typecheck e testes ficam no pre-push: um hook que demora dois minutos por commit
# e um hook que a pessoa desliga na terceira vez, e ai nao protege mais nada.
#
# ATENCAO 3: NAO RODAR `npm run lint` NO REPO INTEIRO. Medido em 10/09/2026: o lint global JA FALHA
# na base, com 1904 warnings em scripts .mjs e `--max-warnings 0`. Um hook que chama o lint global
# bloquearia TODO push, inclusive o de quem nao encostou naqueles arquivos. Aqui o eslint roda
# apenas sobre os arquivos que o push esta levando.
#
# ATENCAO 4: TODA RECUSA DIZ COMO SEGUIR MESMO ASSIM (`--no-verify`). Hook que barra sem saida vira
# hook desativado no `core.hooksPath`, e ai some a protecao inteira em vez de uma verificacao.
#
# Reativar em uma maquina nova: pwsh scripts/setup-git-hooks.ps1

param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('pre-commit', 'pre-push', 'commit-msg')]
  [string]$Hook,

  # So o commit-msg usa: o arquivo com a mensagem que o git acabou de montar.
  [string]$CommitMsgFile
)

$ErrorActionPreference = 'Stop'

# ── SAIDA ────────────────────────────────────────────────────────────────────

function Escreve([string]$texto, [string]$cor = 'Gray') {
  Write-Host "[panteon] $texto" -ForegroundColor $cor
}

function Recusa([string]$titulo, [string[]]$detalhes) {
  Write-Host ""
  Write-Host "[panteon] BLOQUEADO: $titulo" -ForegroundColor Red
  foreach ($d in $detalhes) { Write-Host "          $d" -ForegroundColor Yellow }
  Write-Host "          Se for proposital, repita o comando com --no-verify." -ForegroundColor DarkGray
  Write-Host ""
  exit 1
}

# ⚠️ O RUNNER NUNCA DERRUBA UM COMMIT POR CULPA DELE MESMO. Se uma verificacao quebrar por causa do
# ambiente (node ausente, git em estado estranho, disco cheio), o certo e AVISAR e deixar passar:
# a alternativa e a pessoa perder o trabalho por um bug do proprio hook.
function Tolera([string]$oQue, [string]$erro) {
  Escreve "aviso: nao consegui $oQue ($erro). Seguindo sem essa verificacao." 'DarkYellow'
}

$repo = ''
try {
  $repo = (& git rev-parse --show-toplevel 2>$null | Out-String).Trim()
} catch {
  $repo = ''
}
if (-not $repo) { exit 0 }

# ── O QUE ESTA NO STAGE ──────────────────────────────────────────────────────

function ArquivosNoStage {
  # ACMR: adicionado, copiado, modificado, renomeado. Deletado nao se le.
  $saida = & git diff --cached --name-only --diff-filter=ACMR 2>$null
  if (-not $saida) { return @() }
  return @($saida | Where-Object { $_ -and $_.Trim() })
}

function ConteudoNoStage([string]$caminho) {
  # ⚠️ LE O QUE VAI SER COMMITADO, e nao o que esta no disco. Sao coisas diferentes sempre que
  # alguem faz `git add` e continua editando — e e exatamente nesse intervalo que passa despercebido
  # o que o hook deveria pegar.
  try { return (& git show ":$caminho" 2>$null | Out-String) } catch { return '' }
}

# ── PRE-COMMIT ───────────────────────────────────────────────────────────────

# Chave, token e senha. Cada padrao existe por um motivo concreto, nao por completude.
$PADROES_DE_SEGREDO = @(
  @{ nome = 'chave de servico do Supabase (JWT)'; regex = 'eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}' },
  @{ nome = 'service_role do Supabase';           regex = 'SUPABASE_SERVICE_ROLE[_A-Z]*\s*[:=]\s*["'']?[A-Za-z0-9._-]{20,}' },
  @{ nome = 'chave de API da OpenAI/Anthropic';   regex = '\b(sk-[A-Za-z0-9]{20,}|sk-ant-[A-Za-z0-9_-]{20,})\b' },
  @{ nome = 'chave privada em PEM';               regex = '-----BEGIN [A-Z ]*PRIVATE KEY-----' },
  @{ nome = 'token da Vercel';                    regex = '\bvercel_[A-Za-z0-9]{20,}\b' },
  @{ nome = 'senha escrita no codigo';            regex = '(?i)\b(senha|password|passwd)\s*[:=]\s*["''][^"''\s]{6,}["'']' }
)

function VerificaPreCommit {
  $arquivos = ArquivosNoStage
  if ($arquivos.Count -eq 0) { exit 0 }

  $problemas = @()

  foreach ($arquivo in $arquivos) {
    # ── 1. Arquivo de ambiente ────────────────────────────────────────────────
    # ⚠️ REGRA-MAE DO CLAUDE.md: nunca expor chave, token ou senha em codigo, log ou commit. Um .env
    # commitado nao se apaga do historico com um `git rm` — a chave precisa ser ROTACIONADA.
    $nome = Split-Path $arquivo -Leaf
    if ($nome -match '^\.env($|\.)' -and $nome -notmatch '\.example$|\.sample$') {
      $problemas += "arquivo de ambiente no stage: $arquivo"
      continue
    }

    # ── 2. Arquivo pesado ─────────────────────────────────────────────────────
    # ⚠️ ACONTECEU DUAS VEZES neste repo: os commits "tira o PDF de teste do repo" e "tira o PDF de
    # exemplo que o teste do Hercules escreve" existem porque um artefato de teste entrou junto.
    # Binario grande fica no historico para sempre, mesmo depois de removido.
    try {
      $tamanho = (& git cat-file -s (& git rev-parse ":$arquivo" 2>$null) 2>$null | Out-String).Trim()
      if ($tamanho -match '^\d+$' -and [int64]$tamanho -gt 2097152) {
        $mb = [math]::Round([int64]$tamanho / 1MB, 1)
        $problemas += "arquivo de $mb MB no stage: $arquivo (binario grande fica no historico para sempre)"
        continue
      }
    } catch {
      # Tamanho e acessorio: seguir sem ele.
    }

    # Binario nao se le como texto.
    if ($arquivo -match '\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|xlsx?|docx?|mp4|woff2?|ttf|otf)$') { continue }

    $conteudo = ConteudoNoStage $arquivo
    if (-not $conteudo) { continue }

    # ── 3. Marcador de conflito ───────────────────────────────────────────────
    if ($conteudo -match '(?m)^(<<<<<<< |>>>>>>> |={7}$)' -and $conteudo -match '(?m)^<<<<<<< ') {
      $problemas += "marcador de conflito de merge em: $arquivo"
      continue
    }

    # ── 4. Segredo ────────────────────────────────────────────────────────────
    # ⚠️ NAO VALE PARA O PROPRIO RUNNER: os padroes abaixo estao escritos aqui dentro, e sem esta
    # excecao o arquivo que procura segredo seria acusado de conter um.
    if ($arquivo -notlike '*panteon-hook-runner.ps1') {
      foreach ($padrao in $PADROES_DE_SEGREDO) {
        if ($conteudo -match $padrao.regex) {
          $problemas += "possivel $($padrao.nome) em: $arquivo"
          break
        }
      }
    }
  }

  if ($problemas.Count -gt 0) {
    Recusa 'ha o que conferir antes deste commit' $problemas
  }

  # ── 5. Typecheck desligado ──────────────────────────────────────────────────
  # ⚠️ AVISA, NAO BLOQUEIA. Ja existem 36 arquivos com `@ts-nocheck` no repo (o IrisPage e o Setup
  # da Iris entre eles), entao bloquear seria barrar quem apenas editou um deles. O que importa e
  # ninguem ADICIONAR mais um sem perceber que aquele arquivo saiu do alcance do typecheck.
  $comNocheck = @()
  foreach ($arquivo in $arquivos) {
    if ($arquivo -notmatch '\.(ts|tsx)$') { continue }
    $conteudo = ConteudoNoStage $arquivo
    if ($conteudo -match '@ts-nocheck') { $comNocheck += $arquivo }
  }
  if ($comNocheck.Count -gt 0) {
    Escreve "aviso: @ts-nocheck em $($comNocheck -join ', ') — o typecheck NAO cobre esses arquivos." 'DarkYellow'
  }

  Escreve "pre-commit ok ($($arquivos.Count) arquivo(s))." 'DarkGray'
  exit 0
}

# ── COMMIT-MSG ───────────────────────────────────────────────────────────────

# Medido no historico deste repo em 11/09/2026: os 25 commits mais recentes seguem
# `tipo(escopo): descricao`, com escopo composto por virgula em varios deles
# (ex.: `feat(temis,assinatura): o envio do contrato para a Clicksign`).
$TIPOS = 'feat|fix|chore|docs|refactor|test|perf|build|ci|style|revert'

function VerificaCommitMsg {
  if (-not $CommitMsgFile -or -not (Test-Path $CommitMsgFile)) { exit 0 }

  $linhas = @(Get-Content -LiteralPath $CommitMsgFile -Encoding UTF8 -ErrorAction SilentlyContinue)
  # Comentario do git nao e mensagem.
  $uteis = @($linhas | Where-Object { $_ -notmatch '^\s*#' })
  $primeira = ($uteis | Where-Object { $_.Trim() } | Select-Object -First 1)

  if (-not $primeira) {
    Recusa 'a mensagem do commit esta vazia' @('Diga o que mudou e por que - e o unico registro que sobrevive ao tempo.')
  }

  $primeira = $primeira.Trim()

  # Merge, revert e fixup passam: a mensagem e do proprio git.
  if ($primeira -match '^(Merge |Revert |fixup!|squash!)') { exit 0 }

  if ($primeira.Length -gt 110) {
    Recusa 'a primeira linha da mensagem esta longa demais' @(
      "Tem $($primeira.Length) caracteres; o limite aqui e 110.",
      'O resto do texto cabe no corpo da mensagem, depois de uma linha em branco.'
    )
  }

  if ($primeira -notmatch "^($TIPOS)(\([a-z0-9,._/-]+\))?: .+") {
    Recusa 'a mensagem nao segue a convencao da casa' @(
      "Formato: tipo(escopo): descricao   |   tipos: $($TIPOS -replace '\|', ', ')",
      'Exemplos do proprio repo:',
      '  feat(temis): as cinco etapas do quadro, e a fundacao do indeferimento',
      '  fix(assinatura): o CPF vai formatado, que e o que a Clicksign aceita',
      '  chore(changelog): entrada 1.303.0 - o contrato vai para assinatura'
    )
  }

  exit 0
}

# ── PRE-PUSH ─────────────────────────────────────────────────────────────────

function LinhasDoPush {
  # O git escreve no stdin do hook: "<ref local> <sha local> <ref remota> <sha remoto>".
  # ⚠️ SO LE SE ESTIVER REDIRECIONADO. Chamado a mao num terminal, `ReadToEnd` ficaria esperando
  # para sempre — e o hook viraria um travamento sem explicacao.
  if (-not [Console]::IsInputRedirected) { return @() }
  try {
    $cru = [Console]::In.ReadToEnd()
    if (-not $cru) { return @() }
    return @($cru -split "`n" | Where-Object { $_.Trim() })
  } catch {
    return @()
  }
}

function RodaNpm([string]$oQue, [string]$script) {
  Escreve "$oQue..." 'DarkGray'
  & npm --prefix apps/hub run $script --silent 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
  return $LASTEXITCODE
}

function VerificaPrePush {
  Push-Location $repo
  try {
    if (-not (Test-Path (Join-Path $repo 'apps/hub/node_modules'))) {
      # Sem dependencia instalada nao ha o que rodar, e travar o push por isso seria gratuito.
      Escreve 'aviso: apps/hub/node_modules nao existe — pulando typecheck e testes.' 'DarkYellow'
      exit 0
    }

    $linhas = LinhasDoPush
    $paraMain = $false
    $intervalos = @()

    foreach ($linha in $linhas) {
      $p = @($linha.Trim() -split '\s+')
      if ($p.Count -lt 4) { continue }
      $shaLocal = $p[1]; $refRemota = $p[2]; $shaRemoto = $p[3]

      # Delecao de branch: nao ha codigo novo para conferir.
      if ($shaLocal -match '^0+$') { continue }
      if ($refRemota -eq 'refs/heads/main') { $paraMain = $true }
      if ($shaRemoto -notmatch '^0+$') { $intervalos += "$shaRemoto..$shaLocal" }
    }

    # ── 1. Typecheck ───────────────────────────────────────────────────────────
    # A regra numero 1 do padrao de deploy do CLAUDE.md: typecheck limpo antes de qualquer push.
    if ((RodaNpm 'conferindo os tipos' 'check-types') -ne 0) {
      Recusa 'o typecheck falhou' @('Corrija os erros acima; eles chegariam ao build da Vercel do mesmo jeito.')
    }

    # ── 2. Testes ──────────────────────────────────────────────────────────────
    # A suite inteira leva ~16s (medido em 11/09/2026: 3506 testes em 238 arquivos). Barato o
    # bastante para rodar toda vez, e e o que separa "compila" de "funciona".
    if ((RodaNpm 'rodando os testes' 'test') -ne 0) {
      Recusa 'a suite de testes falhou' @('Um teste vermelho aqui e um defeito que ja existe — nao um obstaculo ao push.')
    }

    # ── 3. Lint, so no que o push leva ─────────────────────────────────────────
    # ⚠️ NUNCA O LINT GLOBAL: ver ATENCAO 3 no topo. Aqui entram apenas os .ts/.tsx modificados.
    $mudados = @()
    foreach ($intervalo in $intervalos) {
      try {
        $saida = & git diff --name-only --diff-filter=ACMR $intervalo -- 'apps/hub/**/*.ts' 'apps/hub/**/*.tsx' 2>$null
        if ($saida) { $mudados += @($saida | Where-Object { $_ }) }
      } catch {
        Tolera 'listar os arquivos deste push' $_.Exception.Message
      }
    }
    $mudados = @($mudados | Sort-Object -Unique | Where-Object { Test-Path (Join-Path $repo $_) })

    # ⚠️ O ESLINT RODA DE DENTRO DE apps/hub, e os caminhos têm que ser relativos A ELE. A primeira
    # versao tirava o prefixo 'apps/hub/' mas continuava rodando da RAIZ, entao o eslint procurava
    # os arquivos num lugar onde eles nao existem e barrava o push com 'No files matching the
    # pattern'. Barrar por engano e pior do que nao checar: ensina a usar --no-verify.
    $doHub = @($mudados | Where-Object { $_ -like 'apps/hub/*' })
    if ($doHub.Count -gt 0 -and $doHub.Count -le 60) {
      $relativos = @($doHub | ForEach-Object { $_ -replace '^apps/hub/', '' })
      Escreve "lintando $($relativos.Count) arquivo(s) deste push..." 'DarkGray'
      Push-Location (Join-Path $repo 'apps/hub')
      try {
        & npx eslint @relativos --max-warnings 0 2>&1 |
          ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
        $falhou = $LASTEXITCODE -ne 0
      } finally {
        Pop-Location
      }
      if ($falhou) {
        Recusa 'o lint acusou nos arquivos deste push' @('Sao apenas os arquivos que voce esta enviando.')
      }
    }

    # ── 4. O push para producao ────────────────────────────────────────────────
    # ⚠️ PUSH NA MAIN E DEPLOY EM c2x.app.br, automatico, com a integracao Vercel-GitHub ligada.
    # O hook NAO tem como saber se o Lucas autorizou — isso e conversa, nao arquivo. O que ele pode
    # conferir e a regra que mais escapa na pressa: o changelog (regra do Lucas de 02/jul/2026,
    # "TODO deploy de producao informado no painel de novidades").
    if ($paraMain) {
      $mexeuNoChangelog = $false
      foreach ($intervalo in $intervalos) {
        try {
          $saida = & git diff --name-only $intervalo -- 'apps/hub/lib/changelog/changelog.ts' 2>$null
          if ($saida) { $mexeuNoChangelog = $true }
        } catch {
          Tolera 'conferir o changelog deste push' $_.Exception.Message
          $mexeuNoChangelog = $true
        }
      }

      Write-Host ""
      Escreve 'ESTE PUSH VAI PARA A MAIN = DEPLOY DE PRODUCAO em c2x.app.br.' 'Magenta'
      Escreve 'Confirme que o Lucas autorizou ESTE go-live, e anote o rollback (o deployment anterior).' 'Magenta'

      if ($intervalos.Count -gt 0 -and -not $mexeuNoChangelog) {
        Recusa 'o changelog nao foi atualizado neste deploy' @(
          'Regra do Lucas (02/07/2026): TODO deploy de producao entra no painel de Novidades.',
          'Adicione a entrada nova no indice 0 de apps/hub/lib/changelog/changelog.ts',
          '(indice 0 = o que esta no ar; a versao do avatar sobe a partir dai).'
        )
      }
      Write-Host ""
    }

    Escreve 'pre-push ok.' 'DarkGray'
    exit 0
  } finally {
    Pop-Location
  }
}

# ── DESPACHO ─────────────────────────────────────────────────────────────────

try {
  switch ($Hook) {
    'pre-commit' { VerificaPreCommit }
    'commit-msg' { VerificaCommitMsg }
    'pre-push'   { VerificaPrePush }
  }
} catch {
  # Ver a nota de `Tolera`: defeito do runner nao derruba o trabalho de ninguem.
  Escreve "aviso: o hook $Hook falhou por dentro ($($_.Exception.Message)). Seguindo." 'DarkYellow'
  exit 0
}

exit 0
