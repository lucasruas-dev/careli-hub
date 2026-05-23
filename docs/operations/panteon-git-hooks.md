# Panteon - Git Hooks Locais

Status: `PADRAO LOCAL / REVERSIVEL`
Owner: `Zeus`
Data: `2026-05-23`

Este documento define os hooks Git locais do Panteon. Eles sao guardrails de
engenharia para reduzir erro humano antes de commit e push. Eles nao executam
deploy, nao acessam rede e nao tocam Vercel, Supabase, banco, env, secret,
dominio, alias, migration, rollback ou producao.

## Hooks configurados

| Hook | Objetivo | Bloqueia |
| --- | --- | --- |
| `pre-commit` | Validar diff staged antes do commit | whitespace invalido, arquivo sensivel staged e padroes de segredo em linhas adicionadas |
| `commit-msg` | Padronizar mensagem de commit | mensagem fora de conventional commit ou possivel segredo no texto |
| `pre-push` | Rodar gate local antes do push | falha no validador de worktree |

## Arquitetura

Templates versionados:

```text
.githooks/pre-commit
.githooks/commit-msg
.githooks/pre-push
```

Runner comum:

```text
scripts/panteon-hook-runner.ps1
```

Instalador:

```text
scripts/panteon-install-hooks.ps1
```

Os templates chamam o runner PowerShell. O instalador copia os templates para o
diretorio real de hooks resolvido por:

```powershell
git rev-parse --git-path hooks
```

Neste repositorio, esse caminho e comum ao repo `careli-hub`, entao o hook vale
para os worktrees do mesmo repositorio.

## Instalar

Preview sem escrita:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/panteon-install-hooks.ps1
```

Instalar:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/panteon-install-hooks.ps1 -Apply
```

Instalacao assistida sem prompt interativo:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/panteon-install-hooks.ps1 -Apply -Yes
```

Se ja existir hook com o mesmo nome, o instalador cria backup com sufixo
`panteon-backup-<timestamp>` antes de substituir.

## Comportamento do `pre-commit`

Executa:

```powershell
git diff --cached --check
```

Tambem bloqueia paths staged que parecam arquivos sensiveis:

- `.env`, `.env.local`, `.env.production` e variantes, exceto exemplos;
- `.pem`, `.p12`, `.pfx`, `.key`, exceto exemplos;
- `.npmrc` e `.netrc`.

Por fim, ele procura padroes de segredo em linhas adicionadas sem imprimir o
valor encontrado.

## Comportamento do `commit-msg`

Aceita mensagens no formato:

```text
feat(zeus): add local git hooks
fix(iris): preserve template queue
docs(hefesto): register production gate
```

Tambem aceita commits especiais do Git, como merge, revert, fixup e squash.

## Comportamento do `pre-push`

Detecta arquivos candidatos ao push e escolhe o gate:

- recortes de Hub/codigo: `panteon-validate-worktree.ps1 -Scope hub -PrepareSharedNodeModules -SkipBuild`;
- recortes documentais: `panteon-validate-worktree.ps1 -Scope docs`.

O build completo continua sendo gate de handoff/homologacao quando o recorte
exigir. O hook de push usa gate mais rapido para nao transformar todo push em
release.

## Escape operacional

Em emergencia local, o operador pode ignorar somente o `pre-push` com:

```powershell
$env:PANTEON_HOOK_SKIP_VALIDATION="1"
```

Esse escape nao autoriza deploy, banco, env, secret, Vercel, Supabase,
homologacao ou producao. Qualquer uso precisa ser registrado no diario se
afetar uma entrega operacional.

## Conclusao

Os hooks colocam uma cerca local antes de erros comuns: segredo acidental,
commit sem padrao, diff quebrado e push sem validacao minima. Eles ajudam a
engenharia a andar mais rapido sem transformar automacao local em operacao
sensivel.
