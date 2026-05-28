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

## IRIS-20260526-006-INBOUND-COALESCE-TICKETS

- Modulo: Iris.
- Agente responsavel: Iris Core.
- Status: PRONTO_PARA_HOMO.
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

## CHRONOS-20260527-001-AGENDA-SALAS-DRIVE

- Modulo: Chronos.
- Agente responsavel: Chronos Core.
- Status: PRONTO_PARA_HOMO.
- Origem: Lucas pediu iniciar melhorias no modulo Chronos.
- Objetivo: reorganizar o Chronos em uma experiencia de modulo com sidebar propria no padrao Hades, separando as telas oficiais `Agenda`, `Salas` e `Drive`, com `Gravacoes` e `Atas` como abas internas do Drive, e transformar a Agenda em visual funcional por dia/semana/mes/ano/lista.
- Arquivos do recorte:
  - `apps/hub/app/chronos/page.tsx`;
  - `apps/hub/app/api/chronos/google-calendar/authorize/route.ts`;
  - `apps/hub/app/api/chronos/google-calendar/status/route.ts`;
  - `apps/hub/lib/chronos/client.ts`;
  - `apps/hub/lib/chronos/google-calendar.ts`;
  - `apps/hub/lib/chronos/server.ts`;
  - `apps/hub/lib/chronos/types.ts`;
  - `apps/hub/modules/chronos/ChronosPage.tsx`;
  - `docs/architecture/api-connection-governance.md`;
  - `docs/architecture/environment-governance.md`;
  - `docs/operations/engineering-operations.md`;
  - `docs/operations/releases-homologation.md`;
  - `docs/operations/panteon-recorte-protocols.md`;
  - `turbo.json`.
- Comportamento:
  - rota `/chronos` passa a usar `HubShell chrome="operational"`, removendo a sidebar global fixa e preservando acesso ao launcher do Panteon pelo botao no topo da sidebar do Chronos;
  - Chronos ganha sidebar interna colapsavel com `Agenda`, `Salas` e `Drive`, usando o mesmo padrao visual de sidebars de modulo do Panteon/Hades;
  - `Agenda` passa a ser a tela inicial com toolbar tipo Google Agenda, modos `Dia`, `Semana`, `Mes`, `Ano` e `Lista`, navegacao por periodo e criacao de evento em popup flutuante ao clicar/criar horario, persistindo na fonte real atual do Chronos;
  - `Salas` passa a priorizar organizacao das salas fixas, agenda por sala, configuracao planejada de link externo/setor/host/fundo e preserva o Olimpo de midia/gravacao para a reuniao selecionada;
  - `Drive` organiza o acervo do Chronos em abas internas `Gravacoes` e `Atas`, com filtro por sala e cards por reuniao mostrando data/hora, participantes, tema, protocolo e status;
  - cada card de reuniao exibe horario, status de ata, follow-ups abertos e gravacao disponivel;
  - dossie da reuniao ganha painel de proxima acao formal e checklist de governanca;
  - aba `Perfis` em `Salas` exibe os perfis oficiais `Externa`, `Cliente` e `Resultado` como disponiveis no agendamento;
  - popup da Agenda passa a ter inicio/fim, seletor restrito aos tres perfis oficiais, modo `Online` com sala Chronos e modo `Presencial` com endereco obrigatorio;
  - convidados do popup sao buscados exclusivamente no Apolo via `/api/apolo/relationships` autenticado, persistindo participantes por nome/e-mail e metadados `apoloInvitees` com e-mail/telefone para uso futuro por Iris;
  - backend Chronos valida horario final posterior ao inicio, exige endereco em presencial, persiste `ends_at` e guarda metadados de local/convidados;
  - grade da Agenda permanece com slots de 1 hora por decisao do Lucas apos teste de meia hora;
  - preparo Google Agenda inclui registry `GOOGLE_CALENDAR_*`, rotas protegidas de status/autorizacao e falha fechada sem OAuth real.
- Exclusoes:
  - sem alteracao de env, secrets, OAuth Google, Supabase mutavel, banco, migration, RLS, storage, WebRTC server-side, Vercel, alias, producao ou modulos fora do Chronos.
- Validacao executada:
  - `npx.cmd eslint modules/chronos/ChronosPage.tsx --max-warnings 0`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npx.cmd eslint modules/chronos/ChronosPage.tsx app/chronos/page.tsx --max-warnings 0`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npx.cmd eslint modules/chronos/ChronosPage.tsx --max-warnings 0` apos refinamento do popup: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npx.cmd eslint modules/chronos/ChronosPage.tsx lib/chronos/server.ts lib/chronos/types.ts --max-warnings 0`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npx.cmd eslint modules/chronos/ChronosPage.tsx lib/chronos/client.ts lib/chronos/google-calendar.ts lib/chronos/types.ts app/api/chronos/google-calendar/status/route.ts app/api/chronos/google-calendar/authorize/route.ts --max-warnings 0`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run build --workspace @repo/hub`: OK, com warning conhecido Turbopack/NFT em `next.config.ts`;
  - smoke local `GET http://localhost:3001/chronos`: HTTP 200;
  - smoke seguro `GET http://localhost:3001/api/apolo/relationships?q=teste` sem token: 401 Unauthorized esperado;
  - smoke seguro `GET http://localhost:3001/api/chronos/google-calendar/status` sem sessao: 401 Unauthorized esperado;
  - smoke seguro `GET http://localhost:3001/api/chronos/google-calendar/authorize` sem sessao: 401 Unauthorized esperado.
- Riscos e pendencias:
  - integracao real com Google Agenda exige OAuth, escopos, variaveis e fluxo de consentimento aprovados pelo Lucas em recorte proprio;
  - Google Agenda permanece `BLOQUEADO` neste recorte por envolver OAuth, env e API externa sensivel;
  - rotas Google atuais sao readiness/guardrail; nao redirecionam para Google nem persistem tokens;
  - criacao de perfis customizados alem dos tres oficiais exige persistencia real em recorte backend proprio;
  - envio efetivo de convites por e-mail ou Iris ainda nao foi implementado; o recorte apenas guarda convidados Apolo em fonte real Chronos;
  - criacao/configuracao persistida de salas, vinculo a `hub_sectors`, host padrao, fundo e links externos exigem rota/backend seguro em recorte proprio; nesta entrega a tela usa salas reais ja carregadas pelo Chronos e bloqueia mock de persistencia;
  - links externos de sala exigem rota publica segura, autorizacao de participante externo e politica de acesso em recorte proprio;
  - geracao automatica de ata com OpenAI deve manter revisao humana antes de envio/formalizacao;
  - validacao visual autenticada do Lucas ainda e recomendada para conferir sidebar, Agenda, Drive, filtros e densidade com dados reais; tentativa via Browser Codex falhou por sandbox do Node REPL e screenshot headless local parou em `Carregando sessao...`;
  - worktree principal segue misto com recortes de outras squads, entao Preview/Homo deve usar pacote limpo Chronos.
- Rollback esperado: remover o recorte visual de `ChronosPage.tsx` e restaurar a tela anterior do modulo.

## CHRONOS-20260527-002-SALAS-CONFIG-LINK-FUNDO

- Modulo: Chronos.
- Agente responsavel: Chronos Core.
- Status: PRONTO_PARA_HOMO / AGUARDANDO AUTORIZACAO DO LUCAS.
- Origem: Lucas pediu habilitar criacao e exclusao de salas, link externo curto `/chronos/nome-da-sala` e upload de fundo para a sala, mantendo a aba `Salas` como configuracao porque a reuniao real acontecera em link externo com solicitacao de entrada.
- Objetivo: transformar `Salas` em cadastro operacional real de ambientes fixos do Chronos, sem implementar neste recorte a sala publica/lobby externo.
- Arquivos do recorte:
  - `apps/hub/app/api/chronos/rooms/route.ts`;
  - `apps/hub/lib/chronos/client.ts`;
  - `apps/hub/lib/chronos/server.ts`;
  - `apps/hub/lib/chronos/types.ts`;
  - `apps/hub/modules/chronos/ChronosPage.tsx`;
  - `docs/operations/engineering-operations.md`;
  - `docs/operations/panteon-recorte-protocols.md`;
  - `docs/operations/releases-homologation.md`.
- Comportamento:
  - `Salas` habilita botao `Nova sala` com formulario de nome, slug/link, perfil, capacidade, exigencia de gravacao, transcricao e ata;
  - link externo exibido fica no formato curto `/chronos/<slug>`, com metadata `externalAccess.mode=request_entry`;
  - exclusao de sala e tratada como arquivamento (`status="archived"`) para preservar rastreabilidade historica;
  - fundo da sala pode ser enviado em PNG, JPG ou WebP ate 1 MB no cliente, com validacao server-side por data URL e limite de payload;
  - configuracao e persistida em `chronos_rooms`/`metadata` quando Supabase server-side estiver disponivel, ou no fallback local somente quando permitido em desenvolvimento;
  - a tela `Salas` removeu a area de reuniao ao vivo/Olimpo e ficou restrita a organizacao/configuracao dos ambientes.
- Exclusoes:
  - sem migration, alteracao de env, secret, storage Supabase, OAuth Google, Vercel, dominio, alias, producao, sala publica, lobby externo ou aceite de entrada de convidados;
  - sem alteracao em Hades, Iris, Hermes, Zeus, Atlas, Apolo, Ares ou Setup.
- Validacao executada:
  - `npx.cmd eslint modules/chronos/ChronosPage.tsx lib/chronos/client.ts lib/chronos/server.ts lib/chronos/types.ts app/api/chronos/rooms/route.ts --max-warnings 0`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run build --workspace @repo/hub`: OK, com warning conhecido Turbopack/NFT em `next.config.ts` ligado a SquadOps/Engineering Operations;
  - `git diff --check` do recorte: OK, apenas warnings CRLF conhecidos no Windows;
  - smoke local `GET http://localhost:3001/chronos`: HTTP 200;
  - smoke seguro `POST http://localhost:3001/api/chronos/rooms` sem auth: 401 Unauthorized esperado.
- Riscos e pendencias:
  - rota publica `/chronos/<slug>` e solicitacao/aceite de entrada externa ainda nao existem; este recorte apenas grava a configuracao e o link planejado;
  - upload em metadata usa data URL como etapa inicial sem Storage; para fundos maiores ou acervo institucional sera necessario recorte de storage seguro;
  - validacao visual autenticada por Browser/Playwright ficou bloqueada por sandbox do runtime de navegador nesta sessao;
  - worktree principal segue misto com recortes de outras squads, entao Preview/Homo deve usar pacote limpo Chronos.
- Rollback esperado: remover a rota `app/api/chronos/rooms`, os metodos de sala no client/server/types e restaurar o bloco anterior de configuracao planejada em `ChronosPage.tsx`.

## CHRONOS-20260527-003-SALA-EXTERNA-HERMES-ATHENA

- Modulo: Chronos.
- Agente responsavel: Chronos Core.
- Status: PRONTO_PARA_HOMO / AGUARDANDO AUTORIZACAO_DO_LUCAS.
- Origem: Lucas pediu que a estrutura de video do Chronos fosse igual a construida no Hermes, com mesmos botoes e funcionalidades, aberta por link externo `/chronos/<slug>`, pre-entrada com nome/empresa para clientes, fundo configuravel, botao de gravar, aviso de gravacao/transcricao pela Athena e transcricao vinculada ao nome informado ou ao login do colaborador.
- Objetivo: implementar a primeira experiencia publica de sala Chronos, reaproveitando componentes visuais de chamada do Hermes sem alterar Hermes, e persistindo rastros formais de entrada, gravacao e transcricao no Chronos.
- Arquivos do recorte:
  - `apps/hub/app/chronos/[roomSlug]/page.tsx`;
  - `apps/hub/app/api/chronos/public/rooms/[roomSlug]/join/route.ts`;
  - `apps/hub/app/api/chronos/public/rooms/[roomSlug]/recording/route.ts`;
  - `apps/hub/app/api/chronos/public/rooms/[roomSlug]/transcript/route.ts`;
  - `apps/hub/lib/chronos/server.ts`;
  - `apps/hub/lib/chronos/types.ts`;
  - `apps/hub/modules/chronos/ChronosExternalRoomPage.tsx`;
  - `apps/hub/providers/auth-provider.tsx`;
  - `docs/operations/engineering-operations.md`;
  - `docs/operations/panteon-recorte-protocols.md`;
  - `docs/operations/releases-homologation.md`.
- Comportamento:
  - rota publica `/chronos/[roomSlug]` renderiza experiencia fullscreen externa, sem sidebar/topbar do modulo;
  - sala carrega configuracao real de `chronos_rooms` pelo slug ativo e falha fechada se Supabase server-side nao estiver configurado fora do fallback local autorizado;
  - `AuthProvider` permite acesso anonimo somente ao padrao publico `/chronos/<slug>`, preservando a protecao da rota interna `/chronos`;
  - pre-entrada mostra video local, seletores de camera/microfone, campo de nome e empresa para convidados externos, e usa dados de login para colaboradores autenticados;
  - usuario pode aplicar fundo local na pre-entrada; o fundo persistido da sala continua vindo da configuracao da sala;
  - ao participar, Chronos cria ou reutiliza uma reuniao viva vinculada a sala, registra participante e timeline de entrada;
  - sala usa WebRTC mesh com sinalizacao por Supabase Realtime broadcast, mantendo controles visuais do Hermes para microfone, camera, compartilhamento de tela, picture-in-picture e sair;
  - botao de gravacao aciona `MediaRecorder` no navegador, registra metadata de gravacao em Chronos e mostra aviso de que a reuniao esta sendo gravada/transcrita pela Athena;
  - ao encerrar gravacao, o navegador disponibiliza download local do `.webm` capturado;
  - transcricao V1 usa Web Speech API do navegador quando disponivel, envia trechos para `chronos_transcript_segments` e identifica `speaker_label` pelo nome informado pelo cliente ou pelo login do colaborador.
- Exclusoes:
  - sem alteracao em Hermes, PulseX, Hades, Iris, Zeus, Atlas, Apolo, Ares, Setup, migrations, envs, secrets, Storage, OpenAI, Google OAuth, Vercel, dominios, aliases ou producao;
  - sem publicacao em Preview, homologacao ou producao.
- Validacao executada:
  - `npx.cmd eslint modules/chronos/ChronosExternalRoomPage.tsx lib/chronos/server.ts lib/chronos/types.ts providers/auth-provider.tsx app/chronos/[roomSlug]/page.tsx app/api/chronos/public/rooms/[roomSlug]/join/route.ts app/api/chronos/public/rooms/[roomSlug]/recording/route.ts app/api/chronos/public/rooms/[roomSlug]/transcript/route.ts --max-warnings 0`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run build --workspace @repo/hub`: OK, com warning conhecido Turbopack/NFT em `next.config.ts` ligado a SquadOps/Engineering Operations;
  - smoke local buildado em porta alternativa: `GET http://localhost:3002/chronos/sala-cliente`: HTTP 200;
  - smoke seguro de sala inexistente: `POST http://localhost:3002/api/chronos/public/rooms/__invalid_smoke__/join`: HTTP 400 Bad Request esperado;
  - tentativa de validacao visual via Node REPL/Browser Codex: bloqueada por sandbox do runtime (`spawn setup refresh`).
- Riscos e pendencias:
  - solicitacao de entrada com aceite pelo host ainda precisa de recorte proprio de lobby/admissao;
  - gravacao V1 captura arquivo local para download e metadata Chronos, mas ainda nao persiste o video em Storage/Drive;
  - transcricao V1 depende de Web Speech API do navegador e nao substitui pipeline server-side com OpenAI/Athena;
  - identificacao de fala usa o nome declarado/logado por participante; diarizacao fiel em audio misto exige provedor/transcricao server-side em recorte posterior;
  - WebRTC mesh sem TURN/SFU pode falhar em redes externas restritas;
  - worktree principal segue misto com recortes de outras squads, entao Preview/Homo deve usar pacote limpo Chronos.
- Rollback esperado: remover rota publica `/chronos/[roomSlug]`, APIs publicas `chronos/public/rooms`, tela `ChronosExternalRoomPage`, tipos/funcoes publicas de Chronos e ajuste especifico do `AuthProvider` para rota publica.

## HUB-20260527-001-NOTIFICACOES-WINDOWS

- Modulo/agente dono: Hub / Zeus Operations.
- Hefesto responsavel por producao: Hefesto.
- Objetivo do recorte: ativar notificacoes nativas do Windows para o Panteon via PWA/Web Notifications, com teste manual no topbar e abertura/foco do Hub ao clicar no toast.
- Worktree/branch de publicacao: `.codex-deploy/z27-004-hub-windows-notifications-20260527` em `codex/zeus/hub-windows-notifications-20260527`.
- Arquivos incluidos no pacote:
  - `apps/hub/layouts/hub-shell.tsx`;
  - `apps/hub/lib/hub/native-notifications.ts`;
  - `apps/hub/public/sw.js`;
  - registros operacionais em `docs/operations`.
- Arquivos excluidos: envs, secrets, migrations, banco remoto, service role, backend push, dominio novo, alias manual e alteracoes fora do recorte.
- Status: EM_PRODUCAO.
- Deployment publicado em producao: dpl_FRyLY4NdSJc556S6qZEuXYjevPow.
- URL tecnica: https://careli-hub-hub-i2bs-4n2ztblkp-lucasruas-devs-projects.vercel.app.
- Aliases confirmados: https://c2x.app.br e https://ops.c2x.app.br.
- Rollback imediato: dpl_DbnDfVk3JTvgneJvA9WNcacbyA3f.
- Validacoes finais: diff check OK; eslint escopado OK; check-types OK; lint OK; build hub OK; Vercel Production READY; healthchecks 200/401 esperado; logs sem erro critico.
- Observacao: Lucas dispensou homologacao previa; validacao funcional do toast Windows depende de teste autenticado no dispositivo do Lucas com permissao de notificacao habilitada.

## HERMES-20260527-001-THREAD-REPLY-NOTIFICATIONS

- Modulo/agente dono: Hermes / PulseX.
- Hefesto responsavel por producao: Hefesto.
- Objetivo do recorte: destacar respostas novas em threads do Hermes, permitir abrir a thread a partir do sino do canal e manter links HTTP/HTTPS clicaveis sem quebrar mencoes.
- Worktree/branch de publicacao: `.codex-deploy/z27-005-hermes-thread-notifications-prod-20260527` em `codex/zeus/hermes-thread-notifications-prod-20260527`.
- Arquivos incluidos no pacote:
  - `apps/hub/components/pulsex/conversation-header.tsx`;
  - `apps/hub/components/pulsex/message-item.tsx`;
  - `apps/hub/components/pulsex/message-list.tsx`;
  - `apps/hub/components/pulsex/pulsex-workspace.tsx`;
  - `apps/hub/lib/pulsex/supabase-data.ts`;
  - registros operacionais em `docs/operations`.
- Arquivos excluidos: root misto, envs, secrets, tokens, banco, migrations, Supabase mutavel, service role, Meta/Iris, Hades, Ares, Apolo, dominio novo, alias manual e alteracoes fora do recorte Hermes.
- Status: EM_PRODUCAO.
- Deployment publicado em producao: dpl_7YD9jcHxfRy5j4k8ksQxnSX8aeLC.
- URL tecnica: https://careli-hub-hub-i2bs-hzg6xab9o-lucasruas-devs-projects.vercel.app.
- Aliases confirmados: https://c2x.app.br e https://ops.c2x.app.br.
- Rollback imediato: dpl_FRyLY4NdSJc556S6qZEuXYjevPow.
- Validacoes finais: diff check OK; secret scan de codigo sem ocorrencias; eslint escopado OK; check-types OK; lint OK; build hub OK; Vercel Production READY; healthchecks 200/401 esperado; logs sem erro critico.
- Observacao: validacao funcional final depende de sessao real no Hermes/PulseX com mensagens em thread; leitura usa `localStorage` por navegador/dispositivo.

## CHRONOS-20260527-004-PERFIS-CONFIGURAVEIS

- Modulo: Chronos.
- Agente responsavel: Chronos Core.
- Status: PRONTO_PARA_HOMO / AGUARDANDO AUTORIZACAO_DO_LUCAS.
- Origem: Lucas pediu deixar pronta a criacao e exclusao dos perfis da aba `Salas > Perfis`, que hoje exibia apenas `Externa`, `Cliente` e `Resultado`.
- Objetivo: transformar os perfis de reuniao do Chronos em configuracao operacional editavel, mantendo os perfis oficiais protegidos e liberando perfis customizados para agenda e salas.
- Arquivos do recorte:
  - `apps/hub/app/api/chronos/profiles/route.ts`;
  - `apps/hub/lib/chronos/client.ts`;
  - `apps/hub/lib/chronos/server.ts`;
  - `apps/hub/lib/chronos/types.ts`;
  - `apps/hub/modules/chronos/ChronosPage.tsx`;
  - `docs/operations/engineering-operations.md`;
  - `docs/operations/panteon-recorte-protocols.md`;
  - `docs/operations/releases-homologation.md`.
- Comportamento:
  - a aba `Perfis` habilita o botao `Novo perfil` com formulario de nome, base operacional e descricao;
  - perfis oficiais `Externa`, `Cliente` e `Resultado` seguem ativos, protegidos contra exclusao e disponiveis no agendamento;
  - perfis customizados podem ser criados e usados no popup da agenda e na configuracao de salas;
  - exclusao de perfil customizado arquiva o perfil para preservar rastreabilidade;
  - exclusao fica bloqueada quando o perfil esta vinculado a sala ativa;
  - persistencia usa registro tecnico reservado em `chronos_rooms.metadata`, sem migration nova e sem alterar Supabase manualmente;
  - fallback local so permanece no caminho ja autorizado para desenvolvimento local.
- Exclusoes:
  - sem migration `0019` ou outra migration;
  - sem alteracao de env, secret, Google OAuth, Storage, OpenAI, Vercel, dominio, alias, homologacao ou producao;
  - sem alteracao em Hades, Hermes, Iris, PulseX, Setup, SquadOps, Guardian, CareDesk, Atlas, Apolo, Ares ou Zeus.
- Validacao executada:
  - `npx.cmd eslint modules/chronos/ChronosPage.tsx lib/chronos/client.ts lib/chronos/server.ts lib/chronos/types.ts app/api/chronos/profiles/route.ts --max-warnings 0`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run build --workspace @repo/hub`: OK, com warning conhecido Turbopack/NFT em `next.config.ts` ligado a SquadOps/Engineering Operations;
  - smoke local buildado: `POST http://localhost:3012/api/chronos/profiles` sem auth retornou `401 Unauthorized`;
  - smoke local buildado: `GET http://localhost:3012/chronos` retornou HTTP 200.
- Riscos e pendencias:
  - persistencia aproveita `chronos_rooms.metadata` como registro tecnico reservado; DataOps pode avaliar tabela dedicada em ciclo posterior se o volume de perfis crescer;
  - validacao autenticada do Lucas ainda e recomendada para criar, usar e excluir um perfil customizado na UI;
  - worktree principal segue misto com recortes de outras squads, entao Preview/Homo deve usar pacote limpo Chronos.
- Rollback esperado: remover rota `app/api/chronos/profiles`, metodos de perfil no client/server/types e restaurar a aba `Perfis` como lista somente leitura.

## CHRONOS-20260527-005-FUNDO-SALA-5MB

- Modulo: Chronos.
- Agente responsavel: Chronos Core.
- Status: VALIDADO_LOCAL / AGUARDANDO_VALIDACAO_VISUAL_DO_LUCAS.
- Origem: Lucas pediu aumentar para 5 MB o tamanho maximo da imagem usada como fundo da sala Chronos.
- Objetivo: permitir fundos institucionais de sala com maior resolucao sem alterar Storage, banco, env, migration, Vercel ou rotas externas.
- Arquivos do recorte:
  - `apps/hub/modules/chronos/ChronosPage.tsx`;
  - `apps/hub/lib/chronos/server.ts`;
  - `docs/operations/engineering-operations.md`;
  - `docs/operations/panteon-recorte-protocols.md`;
  - `docs/operations/releases-homologation.md`.
- Comportamento:
  - upload client-side de fundo passa de 1 MB para 5 MB;
  - mensagem de validacao da UI passa a informar `ate 5 MB`;
  - validacao server-side do data URL passa a aceitar o equivalente em base64 ate 7.000.000 caracteres;
  - formato continua restrito a imagem PNG, JPG/JPEG ou WebP.
- Exclusoes:
  - sem migration, env, secret, Storage, Supabase manual, Vercel, dominio, alias, homologacao ou producao;
  - sem alteracao em Hades, Hermes, Iris, PulseX, Setup, SquadOps, Guardian, CareDesk, Atlas, Apolo, Ares ou Zeus.
- Validacao executada:
  - `npx.cmd eslint modules/chronos/ChronosPage.tsx lib/chronos/server.ts --max-warnings 0`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run build --workspace @repo/hub`: OK, com warning conhecido Turbopack/NFT em `next.config.ts` ligado a SquadOps/Engineering Operations;
  - `git diff --check -- apps/hub/modules/chronos/ChronosPage.tsx apps/hub/lib/chronos/server.ts docs/operations/engineering-operations.md docs/operations/panteon-recorte-protocols.md docs/operations/releases-homologation.md`: OK, apenas warnings CRLF conhecidos no Windows.
- Riscos e pendencias:
  - fundos em data URL seguem adequados para V1 curta, mas Storage institucional ainda e recomendado para acervo maior ou repetido;
  - validacao visual autenticada do Lucas ainda e recomendada para testar upload real de imagem proxima a 5 MB;
  - worktree principal segue misto com recortes de outras squads, entao Preview/Homo deve usar pacote limpo Chronos.
- Rollback esperado: restaurar o limite client-side para 1 MB e o limite server-side para 1.400.000 caracteres.

## CHRONOS-20260527-006-SALA-FULLSCREEN-PARTICIPANTES

- Modulo: Chronos.
- Agente responsavel: Chronos Core.
- Status: VALIDADO_LOCAL / AGUARDANDO_VALIDACAO_VISUAL_DO_LUCAS.
- Origem: Lucas pediu que a sala externa usasse a tela toda, ocultasse Athena/transcricao ao vivo, ficasse menos escura e delimitasse cada participante como janela propria; tambem apontou que o fundo escolhido na entrada e fundo do participante, nao da sala.
- Objetivo: ajustar a experiencia externa de reuniao para ocupar o viewport, reduzir paineis laterais e preservar identidade visual executiva sem transformar o Chronos em comunicador casual.
- Arquivos do recorte:
  - `apps/hub/modules/chronos/ChronosExternalRoomPage.tsx`;
  - `docs/operations/engineering-operations.md`;
  - `docs/operations/panteon-recorte-protocols.md`;
  - `docs/operations/releases-homologation.md`.
- Comportamento:
  - sala em chamada passa a usar grid fullscreen, sem limite central `max-w-6xl`;
  - painel lateral de Athena e transcricao ao vivo fica oculto da UI da chamada;
  - badges de gravacao, participantes e download ficam como overlay compacto;
  - fundo da sala passa a vir somente de `room.backgroundDataUrl`;
  - fundo escolhido na pre-entrada passa a ser tratado como `Meu fundo` do participante local;
  - cada participante recebe moldura propria com borda, sombra e superficie separada;
  - overlay geral ficou menos escuro para preservar melhor o fundo configurado da sala.
- Exclusoes:
  - sem alteracao em Hermes, PulseX, Hades, Iris, Setup, SquadOps, Guardian, CareDesk, Atlas, Apolo, Ares, Zeus, migrations, envs, secrets, Storage, Supabase manual, Google OAuth, OpenAI, Vercel, dominios, aliases, homologacao ou producao.
- Validacao executada:
  - `npx.cmd eslint modules/chronos/ChronosExternalRoomPage.tsx --max-warnings 0`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run build --workspace @repo/hub`: OK, com warning conhecido Turbopack/NFT em `next.config.ts` ligado a SquadOps/Engineering Operations;
  - `git diff --check -- apps/hub/modules/chronos/ChronosExternalRoomPage.tsx`: OK.
- Validacao bloqueada:
  - screenshot/Browser automatizado via Node REPL: bloqueado pelo runtime local com `spawn setup refresh`.
- Riscos e pendencias:
  - fundo escolhido pelo participante fica isolado do fundo da sala e aplicado a moldura/local tile; troca real de fundo por segmentacao de pessoa exige recorte futuro de virtual background;
  - validacao visual autenticada do Lucas ainda e necessaria em `/chronos/<slug>` com camera real;
  - worktree principal segue misto com recortes de outras squads, entao Preview/Homo deve usar pacote limpo Chronos.
- Rollback esperado: restaurar o layout com `max-w-6xl`, painel lateral Athena/transcricao e uso anterior do fundo da pre-entrada.

## CHRONOS-20260527-007-FUNDO-VIRTUAL-PARTICIPANTE

- Modulo: Chronos.
- Agente responsavel: Chronos Core.
- Status: VALIDADO_LOCAL / AGUARDANDO_VALIDACAO_VISUAL_DO_LUCAS.
- Origem: Lucas apontou que o fundo escolhido na pre-entrada precisa substituir o fundo real da propria camera, como virtual background, e pediu tambem opcoes de embaçamento/desfoque baixo e alto.
- Objetivo: aplicar efeito real no stream local do participante Chronos, preservando a sala externa fullscreen e enviando o video processado para preview, WebRTC e gravacao local.
- Arquivos do recorte:
  - `apps/hub/modules/chronos/ChronosExternalRoomPage.tsx`;
  - `apps/hub/package.json`;
  - `package-lock.json`;
  - `docs/operations/engineering-operations.md`;
  - `docs/operations/panteon-recorte-protocols.md`;
  - `docs/operations/releases-homologation.md`.
- Comportamento:
  - `Meu fundo` passa a processar a camera em canvas com segmentacao de pessoa via `@mediapipe/tasks-vision`;
  - o stream publicado substitui o fundo real pelo arquivo selecionado, em vez de desenhar apenas CSS na moldura;
  - a pre-entrada inclui modos `Sem efeito`, `Desfoque baixo` e `Desfoque alto` como botoes iconicos no overlay do preview, substituindo o texto `pre-entrada`;
  - os modos de desfoque mantem o participante nitido e aplicam blur no ambiente atras;
  - a captura de video passa a pedir enquadramento 16:9 ideal de 1280x720;
  - o fundo de imagem passa a ser desenhado com ajuste de encaixe, preservando a imagem inteira e usando base desfocada para preencher sobras de proporcao;
  - o preview e os tiles Chronos passam a renderizar video em `object-contain` no escopo da sala externa para evitar corte/zoom do fundo virtual;
  - o stream processado e usado no preview, no track enviado por WebRTC e na gravacao local;
  - se a segmentacao falhar, Chronos volta de forma segura para a camera original e informa a falha na UI.
- Exclusoes:
  - sem migration, env, secret, Storage, Supabase manual, Google OAuth, OpenAI, Vercel, dominio, alias, homologacao ou producao;
  - sem alteracao em Hermes, PulseX, Hades, Iris, Setup, SquadOps, Guardian, CareDesk, Atlas, Apolo, Ares ou Zeus.
- Validacao executada:
  - `npx.cmd eslint modules/chronos/ChronosExternalRoomPage.tsx --max-warnings 0`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run build --workspace @repo/hub`: OK, com warning conhecido Turbopack/NFT em `next.config.ts` ligado a SquadOps/Engineering Operations;
  - `npx.cmd eslint modules/chronos/ChronosExternalRoomPage.tsx --max-warnings 0` apos ajuste de icones/enquadramento: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run check-types:hub` apos ajuste de icones/enquadramento: OK;
  - `npm.cmd run lint:hub` apos ajuste de icones/enquadramento: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run build --workspace @repo/hub` apos ajuste de icones/enquadramento: OK, com warning conhecido Turbopack/NFT em `next.config.ts` ligado a SquadOps/Engineering Operations;
  - `git diff --check` nos arquivos rastreados do recorte: OK, apenas warnings CRLF conhecidos no Windows;
  - `git diff --check --no-index` em `ChronosExternalRoomPage.tsx`: OK, apenas warning CRLF conhecido no Windows;
  - correcao local do dev server: processo antigo PID 79524 parado, `.next/dev` e `.next/cache` limpos, `npm.cmd run dev` reiniciado;
  - smoke local em `http://localhost:3001/chronos/lideranca`: HTTP 200 OK apos limpeza do cache Next e apos ajuste de icones/enquadramento.
- Riscos e pendencias:
  - o modelo de segmentacao e os WASM do MediaPipe sao carregados de URLs publicas oficiais/CDN no navegador; ciclo posterior pode internalizar esses assets se ReleaseOps exigir zero dependencia externa para sala;
  - a qualidade da segmentacao depende de iluminacao, camera e suporte WebGL/MediaPipe do navegador;
  - `npm install` registrou 3 vulnerabilidades no audit geral (2 moderadas, 1 alta); nao foi executado `npm audit fix` para nao alterar dependencias fora do recorte;
  - validacao visual autenticada do Lucas ainda e necessaria em `/chronos/<slug>` com camera real para aprovar o efeito final;
  - worktree principal segue misto com recortes de outras squads, entao Preview/Homo deve usar pacote limpo Chronos.
- Rollback esperado: remover `@mediapipe/tasks-vision`, restaurar o fluxo direto de `getUserMedia` para `localStream` e manter apenas os controles sem efeito/fundo visual anterior.

## CHRONOS-20260527-008-AGENTE-TRANSCRICAO-ATA

- Modulo: Chronos.
- Agente responsavel: Chronos Core.
- Status: VALIDADO_LOCAL / AGUARDANDO_VALIDACAO_OPERACIONAL_DO_LUCAS.
- Origem: Lucas pediu conectar um agente no modulo Chronos para transcricao das reunioes e posterior geracao de ata inteligente, inicialmente com tres perfis de ata: `comunicado`, `resultado` e `alinhamento`.
- Objetivo: criar o primeiro pipeline server-side Athena/OpenAI para receber audio/video de reuniao, transcrever o conteudo, salvar a transcricao no modelo Chronos existente e gerar rascunho de ata revisavel sem aprovar automaticamente.
- Arquivos do recorte:
  - `apps/hub/app/api/chronos/meetings/agent/route.ts`;
  - `apps/hub/lib/chronos/client.ts`;
  - `apps/hub/lib/chronos/server.ts`;
  - `apps/hub/lib/chronos/types.ts`;
  - `apps/hub/modules/chronos/ChronosPage.tsx`;
  - `docs/architecture/api-connection-governance.md`;
  - `docs/operations/engineering-operations.md`;
  - `docs/operations/panteon-recorte-protocols.md`;
  - `turbo.json`.
- Comportamento:
  - nova rota autenticada `POST /api/chronos/meetings/agent` executa a etapa de agente do Chronos;
  - acao `transcribe_recording` recebe arquivo de audio/video, chama OpenAI server-side e salva o texto em `chronos_transcript_segments` com origem `openai`;
  - acao `draft_minutes` le reuniao, participantes, pauta, timeline, follow-ups e transcricao ja persistida para gerar resumo executivo e rascunho de ata;
  - atas geradas entram em `chronos_minutes` com status `draft`, preservando revisao e aprovacao humana;
  - Drive > Gravacoes permite anexar/transcrever arquivo e transcrever gravacoes locais quando houver blob disponivel na sessao;
  - Drive > Atas permite escolher perfil `Comunicado`, `Resultado` ou `Alinhamento` antes de gerar a ata Athena;
  - se `OPENAI_API_KEY` nao estiver configurada no server-side, a rota retorna erro operacional 503 e nao simula resposta local/fallback.
- Exclusoes:
  - sem alteracao em Hermes, PulseX, Hades, Iris, Setup, SquadOps, Guardian, CareDesk, Atlas, Apolo, Ares ou Zeus;
  - sem criacao, exibicao ou alteracao de env, secret, token, Vercel, dominio, alias, Supabase manual, migration, Storage, homologacao ou producao;
  - sem persistencia do arquivo de audio/video em Storage neste recorte; a entrega salva transcricao, resumo e ata.
- Validacao executada:
  - `npx.cmd eslint app/api/chronos/meetings/agent/route.ts lib/chronos/client.ts lib/chronos/server.ts lib/chronos/types.ts modules/chronos/ChronosPage.tsx --max-warnings 0`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run build --workspace @repo/hub`: OK, com warning conhecido Turbopack/NFT em `next.config.ts` ligado a SquadOps/Engineering Operations;
  - smoke local `POST http://localhost:3001/api/chronos/meetings/agent` sem bearer: HTTP 401, confirmando rota protegida por sessao;
  - `git diff --check` nos arquivos rastreados do recorte: OK, apenas warnings CRLF conhecidos no Windows.
- Riscos e pendencias:
  - validacao operacional com arquivo real e chave OpenAI ativa ainda depende do ambiente autenticado do Lucas;
  - modelos opcionais `HUB_CHRONOS_TRANSCRIPTION_MODEL` e `HUB_CHRONOS_MINUTES_MODEL` podem ser configurados futuramente para pinagem por ambiente, sem expor valores no repositorio;
  - diarizacao fiel por participante em audio misto ainda exige melhoria futura; neste recorte a transcricao server-side entra como conteudo Athena/OpenAI e a ata usa o contexto da reuniao;
  - Storage/Drive institucional das gravacoes continua pendente em recorte proprio;
  - worktree principal segue misto com recortes de outras squads, entao Preview/Homo deve usar pacote limpo Chronos.
- Rollback esperado: remover a rota `app/api/chronos/meetings/agent`, restaurar os botoes anteriores de `Gravacoes`/`Atas` em `ChronosPage.tsx`, remover client helpers do agente e manter transcricao/atas manuais existentes.

## CHRONOS-20260528-009-RESERVA-CICLO-DRIVE

- Modulo: Chronos.
- Agente responsavel: Chronos Core.
- Status: VALIDADO_LOCAL / BLOQUEADO_DATAOPS_STORAGE.
- Origem: Lucas definiu que a sala Chronos deve funcionar por reserva de agenda: o host reserva, abre a chamada no periodo reservado, encerra a chamada, o ciclo e fechado e o Drive organiza gravacao, transcricao e ata daquela ocorrencia. Lucas tambem substituiu perfis configuraveis por apenas tres perfis oficiais: `Alinhamento`, `Resultado` e `Comunicado`.
- Objetivo: transformar a sala externa em ciclo formal de abertura/fechamento de reserva, preparar persistencia de Drive/chat/gravacoes e travar os perfis de agendamento/sala ao padrao oficial Chronos.
- Arquivos do recorte:
  - `apps/hub/app/api/chronos/public/rooms/[roomSlug]/chat/route.ts`;
  - `apps/hub/app/api/chronos/public/rooms/[roomSlug]/close/route.ts`;
  - `apps/hub/app/api/chronos/public/rooms/[roomSlug]/recording/upload/route.ts`;
  - `apps/hub/lib/chronos/server.ts`;
  - `apps/hub/lib/chronos/types.ts`;
  - `apps/hub/modules/chronos/ChronosExternalRoomPage.tsx`;
  - `apps/hub/modules/chronos/ChronosPage.tsx`;
  - `packages/database/migrations/0034_chronos_drive_chat_storage.sql`;
  - `docs/operations/engineering-operations.md`;
  - `docs/operations/panteon-recorte-protocols.md`;
  - `docs/operations/releases-homologation.md`.
- Comportamento:
  - `joinChronosPublicRoom` deixa de criar chamada avulsa e passa a exigir reserva Chronos ativa no horario da agenda;
  - reserva agendada so abre quando o host autenticado entra; convidados aguardam o host abrir;
  - entrada do host muda a reuniao para `live`, registra abertura na timeline e preserva `actualStartedAt` em metadata;
  - novo endpoint `POST /api/chronos/public/rooms/[roomSlug]/close` permite encerramento somente pelo host da reserva ou usuario com permissao `chronos:manage`;
  - encerramento marca reuniao como `closed`, participantes sem saida como `left`, transcricao como `processing` quando exigida e registra timeline de fechamento/Athena;
  - ao encerrar com gravacao ativa, a sala espera a parada da gravacao e o envio antes de fechar o ciclo;
  - Drive passa a listar gravacoes persistidas com URLs assinadas quando Storage estiver preparado;
  - chat de chamada e upload de gravacao ficam prontos para persistencia em Supabase Storage/tabelas do recorte `0034`;
  - perfis oficiais do Chronos passam a ser somente `Alinhamento`, `Resultado` e `Comunicado`;
  - UI de `Salas > Perfis` fica somente leitura e salas antigas com `external/client/executive` sao normalizadas para o perfil oficial padrao.
- Exclusoes:
  - sem aplicacao da migration `0034`;
  - sem alteracao em Vercel, envs, secrets, Supabase remoto, Storage remoto, Google OAuth, OpenAI, dominios, aliases, homologacao ou producao;
  - sem alteracao em Hades, Hermes, PulseX, Iris, Setup, SquadOps, Guardian, CareDesk, Atlas, Apolo, Ares ou Zeus.
- Validacao executada:
  - `npx.cmd eslint modules/chronos/ChronosExternalRoomPage.tsx modules/chronos/ChronosPage.tsx lib/chronos/server.ts lib/chronos/types.ts "app/api/chronos/public/rooms/[roomSlug]/chat/route.ts" "app/api/chronos/public/rooms/[roomSlug]/recording/upload/route.ts" "app/api/chronos/public/rooms/[roomSlug]/close/route.ts" --max-warnings 0`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run build --workspace @repo/hub`: OK, com warning conhecido Turbopack/NFT em `next.config.ts` ligado a SquadOps/Engineering Operations;
  - `git diff --check -- apps/hub/lib/chronos/server.ts apps/hub/lib/chronos/types.ts apps/hub/modules/chronos/ChronosPage.tsx apps/hub/modules/chronos/ChronosExternalRoomPage.tsx "apps/hub/app/api/chronos/public/rooms/[roomSlug]/close/route.ts" packages/database/migrations/0034_chronos_drive_chat_storage.sql`: OK, apenas warnings CRLF conhecidos no Windows;
  - smoke local `GET http://localhost:3001/chronos`: HTTP 200 OK;
  - smoke local `GET http://localhost:3001/chronos/lideranca`: HTTP 200 OK;
  - smoke local `POST http://localhost:3001/api/chronos/public/rooms/lideranca/close` sem auth/body valido: HTTP 400 esperado.
- Validacao bloqueada:
  - Browser automatizado para screenshot/inspecao visual local: bloqueado pelo runtime com `spawn setup refresh`.
- Riscos e pendencias:
  - `packages/database/migrations/0034_chronos_drive_chat_storage.sql` esta apenas preparada; DataOps precisa revisar/aprovar/aplicar bucket `chronos-drive`, colunas de gravacao, chat e preferencias;
  - enquanto `0034` nao for aplicada, upload real para Drive/Storage e chat persistido podem retornar pendencia operacional;
  - o acesso externo agora depende de reserva ativa; abrir URL sem reserva exibira a pre-entrada, mas a entrada na chamada deve falhar fechado por desenho;
  - diarizacao fiel por participante e ata final Athena seguem como evolucao posterior do agente;
  - worktree principal segue misto com recortes de outras squads, entao Preview/Homo deve usar pacote limpo Chronos.
- Rollback esperado: remover a rota `close`, restaurar criacao avulsa/local de chamada em `joinChronosPublicRoom`, restaurar UI/API de perfis configuraveis e remover o uso de Storage/chat preparado no Drive.

### Atualizacao 2026-05-28 01:43:48 -03:00 - preparo de homologacao

- Status operacional: PREPARADO / BLOQUEADO PARA PUBLICACAO DIRETA.
- Handoff: `docs/operations/chronos-homologation-handoff-2026-05-28.md`.
- Manifesto draft: `.codex-deploy/chronos-homolog-20260528-0143/homologation-safety-gate.draft.json`.
- Manifesto draft rastreavel: `docs/operations/chronos-homologation-safety-gate-draft-2026-05-28.json`.
- Decisao:
  - nao publicar a partir do worktree raiz porque ele esta misto e a branch local `homolog` esta 13 commits atras de `origin/homolog`;
  - separar pacote limpo Chronos antes de Preview/Homo;
  - manter DataOps como bloqueio para `0034` e bucket `chronos-drive`;
  - manter Zeus como responsavel por preencher deployment ids, rodar Safety Gate final e mover alias de homologacao.
- Risco especifico:
  - `turbo.json` mistura envs Chronos/Google e Iris; o pacote limpo deve reconciliar somente as chaves Chronos/Google necessarias ou aguardar recorte separado de Iris.

### Fechamento 2026-05-28 02:36:08 -03:00 - CHRONOS-20260528-009-RESERVA-CICLO-DRIVE

- Status: `EM_HOMOLOGACAO`.
- Deployment publicado: `dpl_ELMAc8aDDJNFdy61BankVDZSujD2`.
- Preview tecnico: `https://careli-hub-hub-i2bs-9mluxckd1-lucasruas-devs-projects.vercel.app`.
- Alias: `https://homo.c2x.app.br`.
- Rollback imediato: `dpl_4fZVynECRRuP2a6axWtvAk72KyvW`.
- Pacote limpo: `.codex-deploy/z28-001-chronos-athena-homo-20260528-package`.
- Manifestos Safety Gate: `homologation-safety-gate.pre.json` e `homologation-safety-gate.post.json`.
- Observacao: a publicacao incluiu codigo Chronos/Athena, mas nao aplicou `0034`, nao criou bucket `chronos-drive` e nao alterou envs/secrets.
- Validacao pos-alias: `/`, `/login`, `/chronos`, `/chronos/lideranca` 200; rotas protegidas/invalidas retornaram 401/400 esperados; logs sem erro.

### CHRONOS-20260528-010-GOOGLE-AGENDA-MIRROR

- Modulo: Chronos.
- Owner: Zeus/Chronos.
- Status: VALIDADO LOCAL / MIGRATION HOMOLOGACAO APLICADA / BLOQUEADO POR ENVS GOOGLE AUSENTES.
- Recorte:
  - OAuth Google Agenda com state server-side e PKCE;
  - conexao server-only com refresh token;
  - vinculo idempotente Chronos <-> Google;
  - sync manual push, pull, both;
  - UI de conectar/sincronizar na Agenda Chronos;
  - migration 0035_chronos_google_calendar_mirror.sql.
- Arquivos principais:
  - apps/hub/lib/chronos/google-calendar.ts;
  - apps/hub/lib/chronos/server.ts;
  - apps/hub/lib/chronos/client.ts;
  - apps/hub/lib/chronos/types.ts;
  - apps/hub/modules/chronos/ChronosPage.tsx;
  - apps/hub/app/api/chronos/google-calendar/*;
  - packages/database/migrations/0035_chronos_google_calendar_mirror.sql;
  - .env.example, .env.homolog.example, apps/hub/.env.example, turbo.json;
  - docs/architecture/api-connection-governance.md.
- Validacoes:
  - npm.cmd run check-types:hub: OK;
  - npm.cmd run lint:hub: OK;
  - npm.cmd run build --workspace @repo/hub: OK;
  - smoke local porta 3011: /chronos 200 e rotas Google protegidas 401 sem sessao.
- Migration:
  - aplicada em homologacao via HOMOLOG_POSTGRES_URL sem expor valor.
- Bloqueio:
  - Vercel ainda nao possui GOOGLE_CALENDAR_*; precisa cadastrar envs para teste real OAuth/sync.
- Rollback:
  - codigo: reverter commit do recorte;
  - banco: preservar tabelas sem uso ou dropar apenas chronos_google_calendar_* com aprovacao DataOps/Zeus se necessario.


### Atualizacao 2026-05-28 - CHRONOS-20260528-010-GOOGLE-AGENDA-MIRROR

- Status: EM_HOMOLOGACAO.
- Deployment: dpl_9p1exUTK9MfXpctCjJdUqX74fCXM.
- Preview tecnico: https://careli-hub-hub-i2bs-4jxsyzgvz-lucasruas-devs-projects.vercel.app.
- Alias: https://homo.c2x.app.br.
- Rollback: dpl_ELMAc8aDDJNFdy61BankVDZSujD2.
- Safety Gate: pre-deploy PASS e pos-alias PASS.
- Observacao: Vercel autoassociou o alias homo durante o deploy Preview; alias set manual nao foi executado.
- Validacao: check-types, lint, build, healthchecks 200 e rotas Google protegidas 401 sem sessao.
