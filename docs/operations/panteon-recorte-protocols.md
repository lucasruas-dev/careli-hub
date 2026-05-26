# Panteon - protocolos de recorte

Status: `ATIVO / OBRIGATORIO PARA RECORTES`

Este documento define o protocolo operacional que marca cada recorte alterado, melhorado, corrigido ou publicado no Panteon.

## Objetivo

- Dar uma identidade unica para cada recorte.
- Permitir que Lucas aprove exatamente o que testou.
- Impedir deploy por conversa, memoria de chat ou worktree misto.
- Facilitar que Zeus publique Preview/Homo somente pelo protocolo informado.
- Facilitar que Hefesto promova producao apenas por protocolo homologado.

## Regra central

Todo recorte de modulo deve ter um `protocolId` antes de ser considerado candidato a Preview, Homo ou Producao.

O deploy nao deve ser pedido como "sobe meu recorte". O pedido deve informar o protocolo aprovado:

```text
Zeus, sobe o protocolo ARES-20260525-001 para Homo.
```

## Formato recomendado

```text
<MODULO>-<YYYYMMDD>-<NNN>
```

Exemplos:

```text
IRIS-20260525-001
ARES-20260525-002
APOLO-20260525-003
ZEUS-20260525-004
```

Quando o pacote for uma reconciliacao ou combinacao controlada por Zeus, use:

```text
ZEUS-<YYYYMMDD>-<NNN>-<MODULOS>
```

Exemplo:

```text
ZEUS-20260525-001-IRIS-ARES
```

## Campos obrigatorios

Cada protocolo deve registrar:

- `protocolId`;
- modulo/agente dono;
- objetivo do recorte;
- worktree e branch;
- arquivos incluidos;
- arquivos excluidos;
- validacoes locais;
- status;
- se existe Preview Vercel;
- deployment id e URL tecnica quando houver Preview;
- riscos e pendencias;
- rollback sugerido;
- decisao de Lucas.

## Status oficiais

- `EM_DESENVOLVIMENTO`;
- `VALIDADO_LOCAL`;
- `AGUARDANDO_TESTE_LUCAS`;
- `APROVADO_LUCAS`;
- `PREVIEW_PUBLICADO`;
- `PRONTO_PARA_HOMO`;
- `EM_HOMOLOGACAO`;
- `HOMOLOGADO`;
- `PRONTO_PARA_PRODUCAO`;
- `BLOQUEADO`;
- `CANCELADO`.

## Fluxo operacional

1. Agente trabalha em worktree propria.
2. Agente cria ou atualiza o protocolo do recorte.
3. Agente valida localmente.
4. Lucas testa em `localhost` quando o recorte nao depender de URL publica.
5. Se Lucas aprovar, informa o `protocolId` para Zeus.
6. Zeus busca o protocolo, confere arquivos, validacoes e riscos.
7. Zeus decide com Safety Gate se publica Preview ou move `homo.c2x.app.br`.
8. Hefesto promove producao somente a partir de protocolo homologado, validado e autorizado.

## Regras de deploy

- `localhost` nao e Preview nem homologacao; e validacao local.
- Preview Vercel e opcional e deve ter `protocolId` no manifesto.
- `homo.c2x.app.br` so deve receber protocolo aprovado por Lucas e reconciliado por Zeus.
- Producao so deve receber protocolo homologado e aprovado, via Hefesto.
- Worktree misto, protocolo ausente, arquivos nao declarados ou divergencia de alias bloqueiam deploy.

## Manifesto Safety Gate

O manifesto de homologacao deve incluir:

```json
{
  "protocolId": "ARES-20260525-001",
  "module": "ares",
  "alias": "https://homo.c2x.app.br",
  "expectedDeploymentId": "dpl_atual_antes_do_deploy",
  "expectedProjectName": "careli-hub-hub-i2bs",
  "targetPreviewUrl": "https://careli-hub-hub-i2bs-xxxx-lucasruas-devs-projects.vercel.app",
  "packagePath": ".codex-deploy/ares-homolog-YYYYMMDD-HHMMSS/workspace",
  "includedFiles": [],
  "excludedPaths": [],
  "validations": [],
  "rollbackDeploymentId": "dpl_rollback_conhecido",
  "approvedBy": "Lucas"
}
```

## Protocolos registrados

### ARES-20260526-001-BASES-FINANCEIRAS

- Modulo/agente dono: `Ares Core`.
- Objetivo do recorte: adicionar empresa/base financeira ativa no Ares para separar lancamentos, dimensoes, contas, extratos e lotes por contexto operacional.
- Worktree/branch de origem: root misto com arquivos Ares isolados; branch principal observada `homolog`; worktree oficial `careli-hub-worktrees/ares` permanece limpo, mas nao contem este recorte.
- Arquivos incluidos no pacote de homologacao:
  - `apps/hub/app/api/ares/financial-bases/route.ts`;
  - `apps/hub/app/api/ares/snapshot/route.ts`;
  - `apps/hub/lib/ares/client.ts`;
  - `apps/hub/lib/ares/server.ts`;
  - `apps/hub/lib/ares/types.ts`;
  - `apps/hub/modules/ares/AresPage.tsx`;
  - `docs/operations/engineering-operations.md`;
  - `docs/operations/releases-homologation.md`;
  - `docs/operations/panteon-recorte-protocols.md`.
- Arquivos excluidos do pacote Vercel: envs, secrets, tokens, producao, dominios, alias de producao, migrations e `packages/database/migrations/0033_ares_financial_bases.sql`.
- Observacao de banco: migration `0033_ares_financial_bases.sql` registrada como aplicada em Supabase homologacao pelo Ares; Zeus nao reaplica DDL neste deploy.
- Validacoes locais declaradas pelo Ares: `check-types:hub`, `lint:hub`, `build --workspace @repo/hub`, smoke `/ares` e APIs Ares protegidas sem sessao retornando `401`.
- Status: `PRONTO_PARA_HOMO`.
- Preview Vercel: pendente ate execucao do pacote limpo Zeus.
- Rollback sugerido: deployment vigente de `homo.c2x.app.br` antes do alias.
- Decisao de Lucas: autorizado subir o corte do Ares em homologacao em 2026-05-26.

### ZEUS-20260526-002-ARES-IRIS-HADES-ATHENA-HOMO

- Modulo/agente dono: `Zeus Operations`.
- Objetivo do recorte: compor pacote limpo de homologacao preservando o Ares ja publicado em `homo.c2x.app.br` e adicionando somente os ultimos recortes aprovados/solicitados de Iris, Hades e Athena/Caca.
- Recortes incluidos:
  - `ARES-20260526-001-BASES-FINANCEIRAS` como base ja vigente em homologacao;
  - `IRIS-20260526-002-CACA-FUSO-SAUDACAO`;
  - `IRIS-20260526-003-CACA-V8-AGENT-FIRST`;
  - `HADES-20260526-001`;
  - `HADES-20260526-002-ABERTURA-IRIS-ASSUNTOS-PARCELAS`;
  - `HADES-20260526-003-ABERTURA-IRIS-PREVIEW-MENSAGEM`;
  - recorte Iris/Hades de variaveis de parcela e protocolo no template de abertura.
- Worktree/branch de origem: root misto em `homolog` somente como fonte dos arquivos declarados; pacote final deve ser montado a partir do workspace limpo do deployment atual de homologacao.
- Deployment base esperado antes do alias: `dpl_AqqeSA2T1u7B37rZsf4LDrCWxSDj`.
- Arquivos incluidos no pacote de homologacao:
  - `apps/hub/lib/iris/caca-agent.ts`;
  - `docs/operations/iris-ai-attendant-agent-operating-contract.md`;
  - `apps/hub/app/api/iris/tickets/route.ts`;
  - `apps/hub/modules/caredesk/IrisPage.tsx`;
  - `apps/hub/modules/guardian/attendance/components/WhatsAppConversationPanel.tsx`;
  - `apps/hub/modules/guardian/attendance/AttendancePage.tsx`;
  - `apps/hub/components/guardian/layout/Sidebar.tsx`;
  - `apps/hub/app/hades/desk/page.tsx`;
  - `apps/hub/app/guardian/desk/page.tsx`;
  - `docs/operations/engineering-operations.md`;
  - `docs/operations/releases-homologation.md`;
  - `docs/operations/panteon-recorte-protocols.md`.
- Arquivos excluidos do pacote Vercel: envs, secrets, tokens, `.env*`, `.vercel`, `.git`, `.next`, `.turbo`, `node_modules`, migrations, Supabase, banco, dominio, alias de producao, HelpDesk/Zeus code, Apolo, PulseX, Financeiro e alteracoes nao declaradas no protocolo.
- Validacoes planejadas: `git diff --check` do recorte, lint escopado dos arquivos alterados, `npm.cmd run check-types:hub`, `npm.cmd run lint:hub`, `npm.cmd run build --workspace @repo/hub`, Homologation Safety Gate pre-deploy e pre-alias, inspect/healthchecks de `homo`.
- Status: `EM_HOMOLOGACAO`.
- Preview Vercel: `https://careli-hub-hub-i2bs-4kyzd0d47-lucasruas-devs-projects.vercel.app`.
- Deployment publicado em homologacao: `dpl_DGqpRzTVWzXX3oV2EWu1NWUtpocB`.
- Pacote limpo publicado: `.codex-deploy/z26-002/w`.
- Manifesto Safety Gate: `.codex-deploy/z26-002/homologation-safety-gate.json`.
- Rollback sugerido: `dpl_AqqeSA2T1u7B37rZsf4LDrCWxSDj`.
- Decisao de Lucas: autorizado organizar e subir em homologacao os ultimos cortes de Ares, Iris, Hades e Athena em 2026-05-26.

### IRIS-20260526-004-CACA-V9-FINANCEIRO-CONTROLADO

- Modulo/agente dono: `Iris Core`.
- Objetivo do recorte: corrigir a Caca para que pedidos de pendencia financeira, debito, parcelas em aberto, atraso ou inadimplencia sigam o fluxo financeiro controlado e nao prometam retorno futuro sem acao server-side real.
- Worktree/branch de origem: root misto em `homolog`; recorte deve ser isolado por pacote limpo antes de Preview/Homo.
- Arquivos incluidos no pacote de homologacao:
  - `apps/hub/lib/iris/caca-agent.ts`;
  - `docs/operations/iris-ai-attendant-agent-operating-contract.md`;
  - `docs/operations/engineering-operations.md`;
  - `docs/operations/panteon-recorte-protocols.md`.
- Arquivos excluidos do pacote Vercel: envs, secrets, tokens, `.env*`, `.vercel`, `.git`, `.next`, `.turbo`, `node_modules`, migrations, Supabase, banco, dominio, alias de producao, Hades, Ares, Apolo, Zeus/HelpDesk e alteracoes nao declaradas no protocolo.
- Validacoes locais:
  - `npx.cmd eslint lib/iris/caca-agent.ts --max-warnings 0`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run build --workspace @repo/hub`: OK, com warning conhecido Turbopack/NFT em `next.config.ts`;
  - `git diff --check` do recorte: OK, com aviso conhecido de normalizacao LF/CRLF em `docs/operations/engineering-operations.md`.
- Status: `PRONTO_PARA_HOMO`.
- Preview Vercel: pendente; publicar somente apos autorizacao explicita do Lucas e pacote limpo Iris.
- Deployment id e URL tecnica: pendentes.
- Riscos e pendencias:
  - o ticket AT-000024 nao possui retorno automatico pendente; a V9 impede nova promessa sem acao real, mas nao cria worker assincrono;
  - validacao real em WhatsApp/homologacao depende de novo deploy e novo teste autenticado;
  - a V9 deve ser aplicada sobre a base vigente de homologacao sem sobrescrever recortes Ares/Hades/Iris ja homologados.
- Rollback sugerido: deployment vigente de `homo.c2x.app.br` antes do alias, a ser capturado pelo Safety Gate no momento da publicacao.
- Decisao de Lucas: aguardando autorizacao explicita para publicar o protocolo em homologacao.

## Conclusao

- O protocolo passa a ser a unidade oficial de recorte, teste, homologacao e promocao.
- O impacto pratico e que Lucas aprova por identificador, Zeus publica por identificador e Hefesto promove por identificador.
- A proxima acao de qualquer agente e criar ou atualizar o protocolo antes de pedir Preview, Homo ou Producao.

## IRIS-20260526-005-QUEUE-LOAD-TIMEOUT-HOMO

- Modulo: Iris.
- Agente responsavel: Zeus.
- Status: PRONTO_PARA_HOMO.
- Origem: diagnostico emergencial em `homo.c2x.app.br/iris` com tela presa em `Carregando fila`.
- Objetivo: impedir spinner infinito quando a carga da fila Iris ou o enriquecimento CRM 360/Apolo demorar.
- Arquivos do recorte:
  - `apps/hub/modules/caredesk/IrisPage.tsx`.
- Comportamento:
  - timeout de 15s para carga base da fila;
  - timeout de 4s para enriquecimento CRM 360 via `/api/iris/apolo/phone-match`;
  - se o CRM 360 exceder o limite, a fila base continua carregando sem travar a tela.
- Exclusoes:
  - sem envs, secrets, banco, migrations, service role, WABA/Meta, producao ou dominios de producao.
- Validacao esperada:
  - `git diff --check` do recorte;
  - `npm.cmd run check-types:hub`;
  - `npm.cmd run lint:hub`;
  - `npm.cmd run build --workspace @repo/hub`;
  - Safety Gate pre-deploy/pre-alias;
  - healthcheck `/iris` e logs Vercel.
- Rollback esperado: deployment vigente antes do hotfix.
