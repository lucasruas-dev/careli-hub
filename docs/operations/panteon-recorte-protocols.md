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
- Status: EM_HOMOLOGACAO.
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
- Publicacao Git homolog:
  - commit: be271a7;
  - deployment: dpl_9rhHPwQLGS5QWgnnvAfHFWj7onJF;
  - Preview: https://careli-hub-hub-i2bs-ouo2ugrpu-lucasruas-devs-projects.vercel.app;
  - branch alias: https://careli-hub-hub-i2bs-git-homolog-lucasruas-devs-projects.vercel.app.
- Validacoes executadas:
  - `git diff --check`: OK;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK;
  - `npm.cmd run build --workspace @repo/hub`: OK;
  - Safety Gate pre-push/pre-alias: PASS;
  - healthchecks `/`, `/login`, `/iris`: 200;
  - APIs protegidas sem sessao: 401 esperado;
  - logs Vercel de erro: sem ocorrencias.
- Rollback registrado:
  - dpl_DNv3wQr8m4yBH87hDcmDFD36wbXW como rollback funcional com OpenAI runtime manual;
  - dpl_4h6qtecE1Jova1Mez5bGhSkdyW8b como snapshot imediatamente anterior.

### IRIS-20260526-005-NOME-WHATSAPP-CONTATO

- Modulo/agente dono: `Iris Core`.
- Objetivo do recorte: priorizar nome do cadastro Apolo quando houver CRM 360 registrado e, sem cadastro Apolo, usar nome/identificacao do WhatsApp em vez de `Sem cadastro` como label principal.
- Worktree/branch de origem: root misto em `homolog` somente como fonte dos arquivos declarados; pacote final montado por Zeus sobre `origin/homolog`.
- Arquivos incluidos no pacote de homologacao:
  - `apps/hub/modules/caredesk/IrisPage.tsx`;
  - `apps/hub/lib/iris/meta-inbound-processor.ts`.
- Arquivos excluidos: envs, secrets, banco, migrations, Meta/WABA/phone number, dominios e producao.
- Validacoes: aplicadas no pacote combinado `ZEUS-20260526-007-IRIS-HADES-APOLO-HOMO`.
- Status: `EM_HOMOLOGACAO`.
- Decisao de Lucas: autorizado subir junto com os cortes Hades e Apolo em 2026-05-26.

### APOLO-20260526-004-CRM360-C2X-REFRESH

- Modulo/agente dono: `Apolo Core`.
- Objetivo do recorte: atualizar C2X ao entrar no Apolo, priorizar registros com carteira/parcelas e restringir filtro de empreendimentos apenas em producao, mantendo homologacao/local com todos os empreendimentos validos por `e.id`.
- Worktree/branch de origem: root misto em `homolog` somente como fonte dos arquivos declarados; pacote final montado por Zeus sobre `origin/homolog`.
- Arquivos incluidos no pacote de homologacao:
  - `apps/hub/lib/apolo/server.ts`;
  - `apps/hub/modules/apolo/ApoloPage.tsx`.
- Arquivos excluidos: Hades/Iris fora do pacote combinado, envs, secrets, migrations, Supabase SQL, banco, dominios, aliases e producao.
- Validacoes: aplicadas no pacote combinado `ZEUS-20260526-007-IRIS-HADES-APOLO-HOMO`.
- Status: `EM_HOMOLOGACAO`.
- Decisao de Lucas: autorizado subir junto com os cortes Iris e Hades em 2026-05-26.

### HADES-20260526-006-FILA-DIARIA-MONITORAMENTO-IRIS

- Modulo/agente dono: `Hades Core`.
- Objetivo do recorte: publicar fila diaria/geral por perfil operacional, estagios de cobranca simplificados, marcador de contato do dia, monitoramento Hades/Iris e abertura do chat Iris no board embutido.
- Worktree/branch de origem: root misto em `homolog` somente como fonte dos arquivos declarados; pacote final montado por Zeus sobre `origin/homolog`.
- Arquivos incluidos no pacote de homologacao:
  - `apps/hub/app/api/auth/profile/route.ts`;
  - `apps/hub/providers/auth-provider.tsx`;
  - `packages/auth/src/helpers.ts`;
  - `packages/auth/src/types.ts`;
  - `apps/hub/components/guardian/layout/Sidebar.tsx`;
  - `apps/hub/lib/guardian/read-model.ts`;
  - `apps/hub/modules/guardian/attendance/AttendancePage.tsx`;
  - `apps/hub/modules/guardian/attendance/components/ClientQueueCard.tsx`;
  - `apps/hub/modules/guardian/attendance/components/QueuePanel.tsx`;
  - `apps/hub/modules/guardian/attendance/data.ts`;
  - `apps/hub/modules/guardian/attendance/types.ts`;
  - `apps/hub/modules/guardian/attendance/workflow.ts`;
  - `apps/hub/modules/guardian/monitoring/MonitoringPage.tsx`.
- Arquivos excluidos: envs, secrets, migrations, banco remoto, dominio, alias de producao e producao.
- Validacoes: aplicadas no pacote combinado `ZEUS-20260526-007-IRIS-HADES-APOLO-HOMO`.
- Status: `EM_HOMOLOGACAO`.
- Decisao de Lucas: autorizado subir junto com os cortes Iris e Apolo em 2026-05-26.

### ZEUS-20260526-007-IRIS-HADES-APOLO-HOMO

- Modulo/agente dono: `Zeus Operations`.
- Objetivo do recorte: compor pacote limpo de homologacao preservando o deployment vigente `dpl_6wDr8Fgy8iFZ4jsUd655QxBCVjF4` e adicionando somente os cortes Iris, Hades e Apolo autorizados por Lucas.
- Recortes incluidos:
  - `IRIS-20260526-005-NOME-WHATSAPP-CONTATO`;
  - `HADES-20260526-006-FILA-DIARIA-MONITORAMENTO-IRIS`;
  - `APOLO-20260526-004-CRM360-C2X-REFRESH`.
- Base limpa: `origin/homolog` em `00ea84e`.
- Worktree limpo: `.codex-deploy/z26-007-iris-hades-apolo-homo-20260526-1712/w`.
- Rollback imediato esperado: `dpl_6wDr8Fgy8iFZ4jsUd655QxBCVjF4`.
- Status: `EM_HOMOLOGACAO`.
- Deploy/alias: pendente neste registro; preencher apos Git deploy e Safety Gate pre-alias.

#### Fechamento operacional ZEUS-20260526-007

- Commit de codigo publicado: 8515dfa.
- Deployment Git de codigo: dpl_Au23VZiY2jwM623mukfHtZmLguwJ.
- Alias confirmado: https://homo.c2x.app.br.
- Rollback imediato: dpl_6wDr8Fgy8iFZ4jsUd655QxBCVjF4.
- Safety Gate: PASS pre-push e pos-deploy.
- Status dos recortes: EM_HOMOLOGACAO aguardando validacao autenticada do Lucas.

## IRIS-20260526-006-INBOUND-COALESCE-TICKETS

- Modulo: Iris.
- Agente responsavel: Iris Core.
- Status: EM_HOMOLOGACAO.
- Origem: Lucas reportou que o mesmo cliente WhatsApp estava abrindo mais de um protocolo em poucos segundos, quebrando o fluxo de continuidade no board.
- Objetivo: evitar duplicacao de tickets no inbound Meta quando houver concorrencia de eventos e contatos duplicados para o mesmo numero.
- Arquivos do recorte:
  - `apps/hub/lib/iris/meta-inbound-processor.ts`;
  - `docs/operations/engineering-operations.md`;
  - `docs/operations/panteon-recorte-protocols.md`.
- Comportamento:
  - selecao de contato inbound passa a ser deterministica quando existirem contatos duplicados para o mesmo WhatsApp;
  - reuso de ticket ganhou retry curto para absorver corrida entre webhooks quase simultaneos;
  - quando dois tickets nascerem em paralelo para o mesmo cliente, o processor consolida automaticamente no ticket estavel e fecha o duplicado com trilha em `ticket_events`;
  - o ticket consolidado recebe a mensagem inbound e segue o atendimento no mesmo protocolo.
- Exclusoes:
  - sem alteracao de env, secret, WABA, token, banco real, migration, dominio, alias ou producao.
- Validacao executada:
  - `git diff --check -- apps/hub/lib/iris/meta-inbound-processor.ts`: OK (warning CRLF conhecido no Windows);
  - `npx.cmd eslint lib/iris/meta-inbound-processor.ts --max-warnings 0`: OK;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK;
  - `npm.cmd run build --workspace @repo/hub`: OK (warning conhecido Turbopack/NFT em `next.config.ts`).
- Riscos e pendencias:
  - consolidacao fecha o ticket duplicado automaticamente; historico fica rastreavel, mas pode exigir alinhamento visual no filtro de encerradas se o time quiser ocultar esse tipo de merge;
  - validacao funcional autenticada em `homo.c2x.app.br/iris` segue pendente com Lucas para confirmar o fim da quebra em conversa real.
- Rollback esperado: remover recorte do processor e restaurar comportamento anterior pelo deployment/base vigente antes deste protocolo.
- Deployment publicado em homologacao: dpl_AMdEEH48FnurCX6e9YcDQpVXVQjv.
- Preview: https://careli-hub-hub-i2bs-16qzrnca1-lucasruas-devs-projects.vercel.app.
- Pacote limpo auditavel: .codex-deploy/z26-008-iris-inbound-coalesce-homo-20260526/package.
- Manifestos Safety Gate: .codex-deploy/z26-008-iris-inbound-coalesce-homo-20260526/homologation-safety-gate.clean.json e .codex-deploy/z26-008-iris-inbound-coalesce-homo-20260526/homologation-safety-gate.post.json.
- Rollback imediato: dpl_9HAjWo5eeBo6VUUn2njxvpgzWYdS.

## SETUP-20260527-001-DEPARTAMENTO-SENHA-COLABORADORES

- Modulo/agente dono: `Zeus Operations` com recorte Home/Setup.
- Objetivo do recorte: remover exibicao de perfil operacional na lista de pessoas da Home, mostrar somente departamento com sinal de presenca, remover a coluna visual de perfil no Setup e permitir que administrador defina nova senha temporaria para colaborador existente.
- Worktree/branch de origem: `.codex-deploy/z27-001-home-setup-profile-password-homo-20260527/w` em `codex/zeus/home-setup-profile-password-homo-20260527`.
- Base limpa: `origin/homolog` em `70396e8`.
- Expected deployment atual de homologacao: `dpl_AfiCAbVqdwY6x8c6SEYbkTBjordL`.
- Arquivos incluidos no pacote de homologacao:
  - `apps/hub/app/page.tsx`;
  - `apps/hub/app/setup/page.tsx`;
  - `apps/hub/app/api/setup/users/route.ts`;
  - `apps/hub/lib/setup/data.ts`;
  - `apps/hub/lib/setup/types.ts`;
  - `docs/operations/engineering-operations.md`;
  - `docs/operations/panteon-recorte-protocols.md`;
  - `docs/operations/releases-homologation.md`.
- Arquivos excluidos: envs, secrets, migrations, banco remoto, service role, dominio, alias de producao e producao.
- Comportamento esperado:
  - Home mostra `Departamento / presenca` no card de pessoas, sem `Operador`, `Lider`, `Coordenador` ou `Administrador`;
  - Setup lista usuarios sem coluna de perfil operacional;
  - perfil operacional continua existindo apenas como controle interno de permissao;
  - edicao de usuario permite informar nova senha temporaria opcional, com minimo de 8 caracteres, enviada somente para rota server-side administrativa.
- Validacoes pre-homo:
  - `git diff --check`: OK;
  - `npx.cmd eslint app/page.tsx app/setup/page.tsx app/api/setup/users/route.ts lib/setup/data.ts lib/setup/types.ts --max-warnings 0`: OK;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK;
  - `npm.cmd run build --workspace @repo/hub`: OK, com warning Turbopack/NFT conhecido.
- Status: `PRONTO_PARA_HOMO`.
- Rollback esperado: `dpl_AfiCAbVqdwY6x8c6SEYbkTBjordL`.

#### Fechamento SETUP-20260527-001

- Status: EM_HOMOLOGACAO.
- Deployment publicado em homologacao: dpl_8rnAdSpeb8og4oPcdYKWz8GpqA2K.
- Preview: https://careli-hub-hub-i2bs-97fbmewnk-lucasruas-devs-projects.vercel.app.
- Alias: https://homo.c2x.app.br.
- Rollback imediato: dpl_AfiCAbVqdwY6x8c6SEYbkTBjordL.
- Safety Gate: PASS pre-push e pos-publicacao.
- Healthchecks: /, /login e /setup 200; /api/setup/users 401 esperado sem sessao; logs Vercel sem erro.

## HADES-20260527-001-FILTRO-ATRASO-LIDERANCA

- Modulo/agente dono: Hades.
- Zeus responsavel por homo: Zeus Operations.
- Objetivo do recorte: permitir que lideranca, coordenacao e administracao filtrem a fila por faixas de atraso sem alterar a experiencia dos perfis OP1/OP2/OP3.
- Worktree/branch de homologacao: `.codex-deploy/z27-002-hades-delay-filter-homo-20260527/w` em `codex/zeus/hades-delay-filter-homo-20260527`.
- Base limpa: `origin/homolog` em `8176f5f`.
- Expected deployment atual de homologacao: `dpl_EQhcAuwZkB7bHzTbf7iXFdMeXZrr`.
- Arquivos incluidos no pacote de homologacao:
  - `apps/hub/modules/guardian/attendance/AttendancePage.tsx`;
  - `apps/hub/modules/guardian/attendance/components/QueuePanel.tsx`;
  - `docs/operations/engineering-operations.md`;
  - `docs/operations/panteon-recorte-protocols.md`;
  - `docs/operations/releases-homologation.md`.
- Arquivos excluidos: envs, secrets, migrations, banco remoto, service role, dominio, alias de producao e producao.
- Comportamento esperado:
  - perfis `adm`, `cdr` e `ldr` visualizam filtro compacto de atraso com `Todos`, `1-30`, `31-60` e `60+`;
  - a faixa selecionada reduz fila diaria, fila geral, busca, empreendimentos, contadores, distribuicao e copilot;
  - perfis OP nao veem o controle e mantem o escopo operacional original.
- Validacoes pre-homo: pendentes neste pacote Zeus.
- Status: `PRONTO_PARA_HOMO`.
- Rollback esperado: `dpl_EQhcAuwZkB7bHzTbf7iXFdMeXZrr`.

#### Fechamento HADES-20260527-001

- Status: EM_HOMOLOGACAO.
- Deployment publicado em homologacao: dpl_8baoM4osAQhGn7W4bhxNqu6FiuBZ.
- Preview: https://careli-hub-hub-i2bs-az8moo3sa-lucasruas-devs-projects.vercel.app.
- Alias: https://homo.c2x.app.br.
- Rollback anterior ao recorte: dpl_EQhcAuwZkB7bHzTbf7iXFdMeXZrr.
- Safety Gate: PASS pre-push e pos-publicacao.
- Healthchecks: /, /login, /hades/cobranca, /hades/monitoramento e /api/hades/attendance/queue 200; logs Vercel sem erro.

## HADES-20260527-002-ENVIO-MENSAGEM-IRIS-JANELA-24H

- Modulo/agente dono: Hades Core.
- Zeus responsavel por homo: Zeus Operations.
- Objetivo do recorte: mostrar corretamente no Hades quando a Iris/Meta bloquear mensagem livre por janela WhatsApp de 24h fechada, evitando feedback verde falso e registro local de mensagem enviada.
- Worktree/branch de homologacao: `.codex-deploy/z27-003-hades-window-feedback-homo-20260527/w` em `codex/zeus/hades-window-feedback-homo-20260527`.
- Base limpa: `origin/homolog` em `986cea8`.
- Expected deployment atual de homologacao: `dpl_756LUCkuVAp31Gs3Br6bho8ST6oE`.
- Arquivos incluidos no pacote de homologacao:
  - `apps/hub/modules/guardian/attendance/components/WhatsAppConversationPanel.tsx`;
  - `docs/operations/engineering-operations.md`;
  - `docs/operations/panteon-recorte-protocols.md`;
  - `docs/operations/releases-homologation.md`.
- Arquivos excluidos: envs, secrets, tokens, Meta API/WABA, Iris backend, migrations, banco remoto, service role, dominio, alias de producao e producao.
- Comportamento esperado:
  - ao receber `customerServiceWindow` da Iris, o Hades atualiza o estado da janela no ticket local;
  - em resposta 409, a UI mostra aviso `warning`, nao adiciona bolha local e nao registra timeline como enviada;
  - o composer exibe a janela conhecida e orienta uso de template aprovado quando a janela estiver fechada.
- Validacoes pre-homo: pendentes neste pacote Zeus.
- Status: `PRONTO_PARA_HOMO`.
- Rollback esperado: `dpl_756LUCkuVAp31Gs3Br6bho8ST6oE`.

#### Fechamento HADES-20260527-002

- Status: EM_HOMOLOGACAO.
- Deployment publicado em homologacao: dpl_4fZVynECRRuP2a6axWtvAk72KyvW.
- Preview: https://careli-hub-hub-i2bs-3cv37bjid-lucasruas-devs-projects.vercel.app.
- Alias: https://homo.c2x.app.br.
- Rollback imediato: dpl_756LUCkuVAp31Gs3Br6bho8ST6oE.
- Safety Gate: PASS pre-deploy e PASS pos-publicacao/reconciliacao.
- Healthchecks: /, /login, /hades/cobranca, /hades/monitoramento e /api/hades/attendance/queue 200; logs Vercel sem erro.
- Observacao: alias homo foi associado automaticamente ao Preview valido pela Vercel durante o deploy do projeto oficial; sem `vercel alias set` manual.

## HUB-20260527-001-NOTIFICACOES-WINDOWS

- Modulo/agente dono: Hub / Zeus Operations.
- Objetivo do recorte: ativar notificacoes nativas do Windows para o Panteon via PWA/Web Notifications, com teste manual no topbar e abertura/foco do Hub ao clicar no toast.
- Worktree/branch de implementacao: `.codex-deploy/z27-004-hub-windows-notifications-20260527` em `codex/zeus/hub-windows-notifications-20260527`.
- Base limpa: `35f05f3` preservando a homologacao Hades `dpl_4fZVynECRRuP2a6axWtvAk72KyvW`.
- Arquivos incluidos no pacote:
  - `apps/hub/layouts/hub-shell.tsx`;
  - `apps/hub/lib/hub/native-notifications.ts`;
  - `apps/hub/public/sw.js`;
  - `docs/operations/engineering-operations.md`;
  - `docs/operations/panteon-recorte-protocols.md`.
- Arquivos excluidos: envs, secrets, migrations, banco remoto, service role, Vercel production, dominio, alias de producao, alias de homologacao e backend push.
- Comportamento esperado:
  - o topbar exibe um botao compacto para ativar/testar notificacoes do Windows;
  - quando autorizado, o clique dispara uma notificacao de teste do Panteon no Windows;
  - novas notificacoes realtime nao lidas recebidas apos o carregamento podem gerar toast nativo;
  - clicar no toast foca uma janela aberta do Hub ou abre o Panteon na rota do modulo relacionado.
- Limitacao assumida: este recorte usa PWA/Web Notifications; notificacao 100% independente do navegador exige etapa futura com app desktop companion.
- Validacoes:
  - `git diff --check`: OK;
  - `npx.cmd eslint layouts/hub-shell.tsx lib/hub/native-notifications.ts --max-warnings 0` em `apps/hub`: OK;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK;
  - `npm.cmd run build --workspace @repo/hub`: OK, com warnings conhecidos de Turbopack/NFT no SquadOps.
- Handoff producao:
  - Lucas dispensou homologacao deste recorte em 2026-05-27 e pediu preparo para Hefesto subir em producao;
  - escopo e client-side/PWA, sem env, banco, secrets, rota server-side sensivel, integration externa ou migracao;
  - producao atual inspecionada em 2026-05-27 15:40:34 -03:00: `c2x.app.br` e `ops.c2x.app.br` apontam para `dpl_DbnDfVk3JTvgneJvA9WNcacbyA3f`;
  - Hefesto deve reinspecionar producao no momento do deploy, rodar Safety Gate/healthchecks de producao e manter rollback para o deployment anterior saudavel.
- Status: `EM_PRODUCAO`.

#### Fechamento HUB-20260527-001-NOTIFICACOES-WINDOWS

- Status: EM_PRODUCAO.
- Deployment publicado em producao: dpl_FRyLY4NdSJc556S6qZEuXYjevPow.
- URL tecnica: https://careli-hub-hub-i2bs-4n2ztblkp-lucasruas-devs-projects.vercel.app.
- Aliases confirmados: https://c2x.app.br e https://ops.c2x.app.br.
- Rollback imediato: dpl_DbnDfVk3JTvgneJvA9WNcacbyA3f.
- Validacoes finais: check-types, lint, build, deploy Vercel Production, inspect dos aliases, healthchecks HTTP e logs recentes sem erro critico.
- Observacao: Lucas dispensou homologacao previa; validacao funcional do toast Windows ainda depende de teste autenticado no dispositivo do Lucas com permissao de notificacao habilitada.
