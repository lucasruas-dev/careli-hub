# Panteon - Padrao de Terminal Operacional

Status: `PADRAO OPERACIONAL / ZEUS`
Owner: `Zeus`
Data: `2026-05-23`

Este documento registra o terminal padrao para a engenharia local do Panteon em
Windows.

## Regra central

PowerShell 7 (`pwsh`) e o terminal operacional padrao para agentes, scripts
locais, validacoes, worktrees e hooks do Panteon.

Windows PowerShell 5.1 (`powershell.exe`) fica permitido apenas como fallback
quando `pwsh` nao estiver instalado, nao conseguir iniciar na sessao atual ou
quando uma ferramenta legada exigir esse runtime explicitamente.

## Comandos padrao

Confirmar versao:

```powershell
pwsh --version
```

Abrir uma sessao PowerShell 7:

```powershell
pwsh
```

Executar scripts operacionais do Panteon:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/panteon-validate-worktree.ps1 -Scope docs
```

Validar worktree Hub:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/panteon-validate-worktree.ps1 -Scope hub -PrepareSharedNodeModules
```

## Node no Windows

Para Node/npm, o padrao segue sendo usar os shims `.cmd`:

```powershell
npm.cmd run check-types:hub
npm.cmd run lint:hub
npx.cmd eslint modules/caredesk/IrisPage.tsx --max-warnings 0
```

Isso evita falhas de execution policy em `npm.ps1` e `npx.ps1`.

## Hooks e scripts

- Hooks versionados em `.githooks/` devem tentar `pwsh` primeiro.
- Scripts locais podem manter extensao `.ps1`.
- Exemplos novos de documentacao devem usar `pwsh -NoProfile -ExecutionPolicy Bypass -File ...`.
- Fallback para `powershell.exe` deve ser explicito e tratado como compatibilidade.

## Bloqueios

Este padrao de terminal nao autoriza:

- deploy;
- Vercel;
- Supabase;
- banco;
- env;
- secret;
- migration;
- dominio;
- alias;
- rollback;
- producao.

Qualquer uma dessas operacoes continua `BLOQUEADO` ate autorizacao explicita do
Lucas.

## Conclusao

O uso de PowerShell 7 reduz divergencia entre agentes, moderniza o runtime local
e preserva compatibilidade com Windows. O padrao operacional do Panteon passa a
ser `pwsh`, com `powershell.exe` apenas como fallback.
