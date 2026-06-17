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

A partir de 2026-06-17, todo novo protocolo candidato a Preview, Homo ou
Producao tambem deve declarar o CEP operacional do recorte. O CEP nao substitui
o `protocolId`; ele prova qual cidade, bairro, rua e casa podem mudar.

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
- CEP operacional do recorte: `cityAddressCode`, `districtAddressCode`,
  `streetAddressCode` e `houseAddressCodes`;
- manifesto CEP usado para o recorte;
- resultado do check CEP;
- validacoes locais;
- status;
- se existe Preview Vercel;
- deployment id e URL tecnica quando houver Preview;
- riscos e pendencias;
- rollback sugerido;
- decisao de Lucas.

## CEP operacional obrigatorio

Todo novo protocolo que possa virar Preview, homologacao ou producao deve
declarar o endereco operacional antes do Safety Gate.

Campos minimos:

- `addressManifest`: caminho do manifesto CEP do recorte;
- `cityAddressCode`: cidade/base preservada;
- `districtAddressCode`: bairro/modulo autorizado;
- `streetAddressCode`: rua/tela/fluxo autorizado;
- `houseAddressCodes`: casas/unidades autorizadas;
- `protectedHouseAddressCodes`: casas protegidas pelo recorte;
- `addressCheckCommand`: comando executado;
- `addressCheckStatus`: `PASS`, `BLOCKED` ou `PENDING`;
- `addressCheckEvidence`: resumo curto da evidencia.

Comando minimo:

```powershell
node scripts/panteon-address-recorte-check.mjs --manifest <manifesto-cep> --files <arquivos-do-recorte>
```

Regras:

- protocolo sem CEP operacional fica `BLOQUEADO`;
- protocolo com CEP inexistente no registry fica `BLOQUEADO`;
- protocolo cujo diff toque arquivo fora das casas autorizadas fica `BLOQUEADO`;
- protocolo com `addressCheckStatus` diferente de `PASS` nao avanca para
  Preview, Homo ou Producao;
- protocolos historicos anteriores a esta regra continuam como evidencia, mas
  qualquer reabertura, promocao ou republicacao deve preencher CEP antes de
  seguir.

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
2. Agente localiza o CEP no registry ou solicita inclusao documental antes de
   alterar o recorte.
3. Agente cria ou atualiza o protocolo e o manifesto CEP do recorte.
4. Agente roda `panteon-address-recorte-check.mjs`.
5. Agente valida localmente.
6. Lucas testa em `localhost` quando o recorte nao depender de URL publica.
7. Se Lucas aprovar, informa o `protocolId` para Zeus.
8. Zeus busca o protocolo, confere CEP, arquivos, validacoes e riscos.
9. Zeus decide com Safety Gate se publica Preview ou move `homo.c2x.app.br`.
10. Hefesto promove producao somente a partir de protocolo homologado, validado e autorizado.

## Regras de deploy

- `localhost` nao e Preview nem homologacao; e validacao local.
- Preview Vercel e opcional e deve ter `protocolId` no manifesto.
- Novo protocolo sem CEP operacional validado nao pode virar Preview, Homo ou Producao.
- `homo.c2x.app.br` so deve receber protocolo aprovado por Lucas e reconciliado por Zeus.
- Producao so deve receber protocolo homologado e aprovado, via Hefesto.
- Worktree misto, protocolo ausente, arquivos nao declarados ou divergencia de alias bloqueiam deploy.

## Manifesto Safety Gate

O manifesto de homologacao deve incluir:

```json
{
  "protocolId": "HADES-20260617-001",
  "module": "hades",
  "addressManifest": "docs/operations/panteon-address-recorte-pilot-hades-iris-embed-20260617.json",
  "addressCodes": [
    "PNT-01-00-00-000",
    "PNT-01-10-00-000",
    "PNT-01-10-20-000",
    "PNT-01-10-20-003"
  ],
  "addressCheckCommand": "node scripts/panteon-address-recorte-check.mjs --manifest docs/operations/panteon-address-recorte-pilot-hades-iris-embed-20260617.json --files apps/hub/modules/caredesk/embeds/iris-collection-queue-embed.tsx",
  "addressCheckStatus": "PASS",
  "alias": "https://homo.c2x.app.br",
  "expectedDeploymentId": "dpl_atual_antes_do_deploy",
  "expectedProjectName": "careli-hub-hub-i2bs",
  "targetPreviewUrl": "https://careli-hub-hub-i2bs-xxxx-lucasruas-devs-projects.vercel.app",
  "packagePath": ".codex-deploy/hades-homolog-YYYYMMDD-HHMMSS/workspace",
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
- O CEP operacional passa a ser a prova obrigatoria de escopo para novos protocolos candidatos a Preview, Homo ou Producao.
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

## CHRONOS-20260528-010-DRIVE-PASTAS-SALA-SEM-PERFIL

- Modulo: Chronos.
- Agente responsavel: Chronos Core.
- Status: VALIDADO_LOCAL / BLOQUEADO_PARA_PUBLICACAO_DIRETA.
- Origem: Lucas pediu que gravacoes fiquem organizadas em pastas por setores no Drive e que o perfil da reuniao seja escolhido somente na reserva/agendamento, nao no cadastro da sala.
- Objetivo: simplificar o Drive de gravacoes para modelo de pastas com videos assistiveis/baixaveis e remover o vinculo visual/operacional de perfil no cadastro de salas.
- Arquivos do recorte:
  - `apps/hub/modules/chronos/ChronosPage.tsx`;
  - `apps/hub/lib/chronos/client.ts`;
  - `turbo.json`;
  - `docs/operations/engineering-operations.md`;
  - `docs/operations/panteon-recorte-protocols.md`;
  - `docs/operations/releases-homologation.md`.
- Comportamento:
  - `Drive > Gravacoes` renderiza explorador de pastas e videos, em vez do painel lateral anterior;
  - pastas usam metadados reais de setor quando existirem na sala e fallback por sala enquanto o vinculo de setor nao estiver persistido;
  - cards de video exibem player, assistir, baixar, reuniao, transcrever quando houver blob local e metadados de data/participantes/tema/duracao/tamanho;
  - tela de cadastro de salas nao exibe aba `Perfis`, nao exibe campo `Perfil` e nao envia `roomType` pelo formulario;
  - perfil da reuniao permanece disponivel no fluxo de agenda/reserva;
  - client do Google Agenda retorna status tipado para evitar mistura com resultado de sync;
  - `turbo.json` declara o nome `VERCEL_URL` em `globalEnv` sem registrar valor sensivel.
- Exclusoes:
  - sem deploy, Preview, alias de homologacao, producao, env real, secret, Supabase remoto, Storage remoto, Google OAuth real ou migration aplicada;
  - sem alteracao em Hades, Hermes, PulseX, Iris, Setup, SquadOps, Guardian, CareDesk, Atlas, Apolo, Ares ou Zeus.
- Validacao executada:
  - `npx.cmd eslint modules/chronos/ChronosPage.tsx --max-warnings 0`: OK;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK;
  - `npm.cmd run build --workspace @repo/hub`: OK, com warning conhecido Turbopack/NFT em `next.config.ts` ligado a SquadOps/Engineering Operations.
- Riscos e pendencias:
  - pastas por setor dependem de fonte real de setor/vinculo na sala; sem isso, fallback por sala permanece;
  - armazenamento definitivo dos videos depende de DataOps liberar `0034` e bucket `chronos-drive`;
  - worktree raiz segue misto e deve ser empacotado de forma limpa antes de Preview/Homo.
- Rollback esperado: restaurar o painel anterior de gravacoes em `ChronosPage.tsx`, restaurar campo/aba de perfis em salas se necessario e remover a declaracao `VERCEL_URL` de `turbo.json` caso o helper Google Calendar seja removido do pacote.

## CHRONOS-20260528-011-DRIVE-REUNIAO-FILTROS

- Modulo: Chronos.
- Agente responsavel: Chronos Core.
- Status: VALIDADO_LOCAL / BLOQUEADO_PARA_PUBLICACAO_DIRETA.
- Origem: Lucas reforcou que, com o ciclo de reserva, cada reuniao tem comeco e fim e deve ser a unidade principal do Drive; tambem pediu visual em grade/lista e filtros por data, assunto e pessoas.
- Objetivo: transformar `Drive > Gravacoes` em biblioteca de reunioes gravadas, agrupando arquivos tecnicos por reuniao e oferecendo filtros operacionais para escala.
- Arquivos do recorte:
  - `apps/hub/modules/chronos/ChronosPage.tsx`;
  - `docs/operations/engineering-operations.md`;
  - `docs/operations/panteon-recorte-protocols.md`;
  - `docs/operations/releases-homologation.md`.
- Comportamento:
  - cada card/linha do Drive representa uma reuniao, nao um arquivo tecnico isolado;
  - arquivos tecnicos da mesma reuniao ficam agregados e uma gravacao principal e escolhida para assistir/baixar/transcrever quando existir URL/blob;
  - filtros por `De`, `Ate`, `Assunto` e `Pessoas` foram adicionados;
  - visual alterna entre `Grade` e `Lista`;
  - exibicao de inicio/fim usa `actualStartedAt`, `actualEndedAt` e `closedAt` quando disponiveis, com fallback para horarios da agenda;
  - gravacoes locais registram metadata de inicio, fim, tamanho e status para aparecerem corretamente no Drive.
- Exclusoes:
  - sem deploy, Preview, alias de homologacao, producao, env real, secret, Supabase remoto, Storage remoto, Google OAuth real ou migration aplicada;
  - sem alteracao em Hades, Hermes, PulseX, Iris, Setup, SquadOps, Guardian, CareDesk, Atlas, Apolo, Ares ou Zeus.
- Validacao executada:
  - `npx.cmd eslint modules/chronos/ChronosPage.tsx --max-warnings 0`: OK;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK;
  - `npm.cmd run build --workspace @repo/hub`: OK, com warning conhecido Turbopack/NFT em `next.config.ts` ligado a SquadOps/Engineering Operations;
  - smoke local `GET http://localhost:3001/chronos`: HTTP 200 OK.
- Validacao bloqueada:
  - Browser automatizado para screenshot/inspecao visual local bloqueado pelo runtime com `spawn setup refresh`.
- Riscos e pendencias:
  - assistir/baixar depende de URL/blob real; sem Storage assinado o Drive informa que o arquivo esta aguardando Storage;
  - armazenamento definitivo dos videos depende de DataOps liberar `0034` e bucket `chronos-drive`;
  - worktree raiz segue misto e deve ser empacotado de forma limpa antes de Preview/Homo.
- Rollback esperado: restaurar o card por arquivo tecnico no Drive, remover filtros/alternancia Grade-Lista e voltar o agrupamento de `ChronosDriveRecordingFolder` para `recordings`.

## CHRONOS-20260528-012-DRIVE-LINGUAGEM-GRAVACAO

- Modulo: Chronos.
- Agente responsavel: Chronos Core.
- Status: VALIDADO_LOCAL / BLOQUEADO_PARA_PUBLICACAO_DIRETA.
- Origem: Lucas questionou o significado de `aguardando Storage` no Drive de gravacoes.
- Objetivo: remover linguagem tecnica de infraestrutura da tela e exibir estados compreensiveis para usuario final.
- Arquivos do recorte:
  - `apps/hub/modules/chronos/ChronosPage.tsx`;
  - `docs/operations/engineering-operations.md`;
  - `docs/operations/panteon-recorte-protocols.md`;
  - `docs/operations/releases-homologation.md`.
- Comportamento:
  - cards/linhas sem arquivo reproduzivel passam a exibir `Video em processamento` quando ha registro de gravacao sem URL/blob disponivel;
  - reunioes sem gravacao reproduzivel exibem `Gravacao ainda nao disponivel`;
  - botao de assistir desabilitado exibe `Video em processamento`.
- Exclusoes:
  - sem deploy, Preview, alias de homologacao, producao, env real, secret, Supabase remoto, Storage remoto, Google OAuth real ou migration aplicada;
  - sem alteracao em Hades, Hermes, PulseX, Iris, Setup, SquadOps, Guardian, CareDesk, Atlas, Apolo, Ares ou Zeus.
- Validacao executada:
  - `npx.cmd eslint modules/chronos/ChronosPage.tsx --max-warnings 0`: OK;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK;
  - `npm.cmd run build --workspace @repo/hub`: OK, com warning conhecido Turbopack/NFT em `next.config.ts` ligado a SquadOps/Engineering Operations;
  - `git diff --check -- apps/hub/modules/chronos/ChronosPage.tsx docs/operations/engineering-operations.md docs/operations/panteon-recorte-protocols.md docs/operations/releases-homologation.md`: OK, apenas avisos LF/CRLF.
- Riscos e pendencias:
  - ajuste nao cria arquivo de video nem altera Storage;
  - videos persistidos/baixaveis dependem de DataOps liberar `0034` e bucket `chronos-drive`;
  - worktree raiz segue misto e deve ser empacotado de forma limpa antes de Preview/Homo.
- Rollback esperado: restaurar os textos anteriores no placeholder e na acao desabilitada do Drive.

## CHRONOS-20260528-013-STORAGE-HOMOLOG-LIBERADO

- Modulo: Chronos.
- Agente responsavel: Chronos Core com operacao sensivel Zeus/DataOps.
- Protocolo sensivel: INFRA-20260528-0909-CHRONOS-STORAGE-HOMOLOG.
- Status: EM_HOMOLOGACAO / OPERACIONAL_COM_ATENCAO.
- Origem: Lucas autorizou liberar o Storage do Chronos apos questionar por que videos gravados nao apareciam no Drive.
- Objetivo: aplicar em homologacao a estrutura preparada no recorte `0034` para permitir persistencia real de gravacoes, chat e preferencias do Chronos.
- Recursos afetados:
  - Supabase/Postgres de homologacao via `HOMOLOG_POSTGRES_URL`;
  - bucket privado `chronos-drive`;
  - tabela `chronos_recordings`;
  - tabelas `chronos_chat_messages` e `chronos_participant_preferences`;
  - policies RLS em `public` e `storage.objects`.
- Arquivos do recorte:
  - `packages/database/migrations/0034_chronos_drive_chat_storage.sql`;
  - `docs/operations/engineering-operations.md`;
  - `docs/operations/panteon-recorte-protocols.md`;
  - `docs/operations/releases-homologation.md`.
- Execucao:
  - migration `0034_chronos_drive_chat_storage.sql` aplicada em homologacao;
  - nenhum valor de env, secret, service role ou connection string foi impresso;
  - nenhum Vercel deploy, alias, dominio, env, producao ou migration de producao foi executado.
- Validacao executada:
  - pre-check confirmou ausencia de `chronos-drive`, colunas, tabelas e policies;
  - dependencias `chronos_recordings`, `chronos_meetings`, `set_hub_updated_at` e `has_chronos_permission` presentes;
  - migration aplicada com sucesso;
  - pos-check confirmou bucket privado, limite 500 MB, colunas, tabelas e policies presentes;
  - runtime Supabase local/homolog comparado de forma mascarada e confirmado no mesmo projeto.
- Riscos e pendencias:
  - videos antigos sem upload persistente nao sao recuperados por esta migration;
  - precisa validar nova gravacao em homologacao com upload, player e download no Drive;
  - producao permanece bloqueada ate homologacao funcional e nova autorizacao explicita.
- Rollback esperado:
  - se houver falha critica em homologacao, bloquear uso do fluxo de upload, registrar incidente e preparar script reverso controlado para remover policies/tabelas/bucket somente com autorizacao explicita do Lucas.

## CHRONOS-20260528-014-LIMPEZA-VISUAL-AGENDA-SALAS-DRIVE

- Modulo: Chronos.
- Agente responsavel: Chronos Core.
- Status: VALIDADO_LOCAL / OPERACIONAL_COM_ATENCAO.
- Origem: Lucas pediu limpeza visual no Chronos para reduzir cards e repeticoes em Agenda, Salas e Drive.
- Objetivo:
  - deixar criacao de evento como botao icon-only;
  - remover cards de metricas das telas de Salas e Drive;
  - transformar configuracao de salas em popup;
  - usar lista como padrao no Drive;
  - aplicar cores por tipo de reuniao na Agenda.
- Arquivos do recorte:
  - `apps/hub/modules/chronos/ChronosPage.tsx`;
  - `docs/operations/engineering-operations.md`;
  - `docs/operations/panteon-recorte-protocols.md`;
  - `docs/operations/releases-homologation.md`.
- Comportamento:
  - Agenda compactada, com botao `+` para novo evento e cores para `Alinhamento`, `Resultado`, `Comunicado` e `Reuniao`;
  - Salas em lista operacional, com modal para criar/configurar/excluir sala;
  - Drive em lista como default, com cabecalho sem chips repetitivos de sala/data e titulo de reuniao sem duplicar a sala;
  - tooltip do refresh removido para evitar sobreposicao visual.
- Exclusoes:
  - sem deploy, Preview, alias de homologacao, producao, env real, secret, Supabase remoto, Storage remoto, banco, migration, Google OAuth real ou OpenAI real;
  - sem alteracao em Hades, Hermes, PulseX, Iris, Setup, SquadOps, Guardian, CareDesk, Atlas, Apolo, Ares ou Zeus.
- Validacao executada:
  - `npx.cmd eslint modules/chronos/ChronosPage.tsx --max-warnings 0`: OK;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK;
  - `npm.cmd run build --workspace @repo/hub`: OK, com warning conhecido Turbopack/NFT em `next.config.ts` ligado a SquadOps/Engineering Operations;
  - `GET http://localhost:3001/chronos`: HTTP 200 OK;
  - `GET http://localhost:3001/chronos/lideranca`: HTTP 200 OK;
  - `git diff --check -- apps/hub/modules/chronos/ChronosPage.tsx docs/operations/engineering-operations.md docs/operations/panteon-recorte-protocols.md docs/operations/releases-homologation.md`: OK, apenas avisos LF/CRLF.
- Validacao bloqueada:
  - Browser automatizado via node_repl/Playwright bloqueado por `spawn setup refresh`.
- Riscos e pendencias:
  - precisa validacao visual manual no navegador logado;
  - recorte nao altera Storage, transcricao, atas ou persistencia;
  - worktree raiz segue misto e deve ser empacotado de forma limpa antes de Preview/Homo.
- Rollback esperado:
  - restaurar cards de metricas, formulario inline de salas, grade default do Drive e cores neutras de agenda no arquivo `ChronosPage.tsx`.

## CHRONOS-20260528-015-PACOTE-HOMOLOGACAO-V1

- Modulo: Chronos.
- Agente responsavel: Chronos Core.
- Status: PACOTE_PREPARADO / BLOQUEADO_PARA_PUBLICACAO_DIRETA.
- Origem: Lucas pediu preparar o pacote do Chronos para homologacao.
- Objetivo:
  - montar pacote limpo a partir de `origin/homolog`;
  - sobrepor somente recortes Chronos;
  - validar o pacote fora do worktree misto;
  - entregar manifesto para Zeus/Hefesto gerar Preview e Safety Gate final.
- Pacote:
  - `.codex-deploy/chronos-homolog-20260528-1237/workspace`.
- Manifesto:
  - `docs/operations/chronos-homologation-safety-gate-package-2026-05-28.json`.
- Recortes cobertos:
  - CHRONOS-20260528-009-RESERVA-CICLO-DRIVE;
  - CHRONOS-20260528-010-DRIVE-PASTAS-SALA-SEM-PERFIL;
  - CHRONOS-20260528-011-DRIVE-REUNIAO-FILTROS;
  - CHRONOS-20260528-012-DRIVE-LINGUAGEM-GRAVACAO;
  - CHRONOS-20260528-014-LIMPEZA-VISUAL-AGENDA-SALAS-DRIVE.
- Arquivos do pacote:
  - `apps/hub/app/chronos/page.tsx`;
  - `apps/hub/app/chronos/[roomSlug]/page.tsx`;
  - `apps/hub/app/api/chronos/**`;
  - `apps/hub/lib/chronos/**`;
  - `apps/hub/modules/chronos/ChronosPage.tsx`;
  - `apps/hub/modules/chronos/ChronosExternalRoomPage.tsx`;
  - `apps/hub/package.json`;
  - `package-lock.json`;
  - `turbo.json` sanitizado no pacote.
- Exclusoes:
  - sem Hades, Hermes, PulseX, Iris, Setup, SquadOps, Guardian, CareDesk, Atlas, Apolo, Ares ou Zeus;
  - sem `apps/hub/layouts/hub-shell.tsx`;
  - sem `packages/shared/src/modules/registry.ts`;
  - sem migration `0034` no pacote;
  - sem `.env`, secret, token, `.vercel`, dominio, alias, Vercel, Supabase remoto, Storage remoto ou producao.
- Validacao executada:
  - `npm.cmd --prefix .codex-deploy/chronos-homolog-20260528-1237/workspace run check-types:hub`: OK;
  - `npm.cmd --prefix .codex-deploy/chronos-homolog-20260528-1237/workspace run lint:hub`: OK;
  - `npm.cmd --prefix .codex-deploy/chronos-homolog-20260528-1237/workspace run build --workspace @repo/hub`: OK;
  - `node scripts/homologation-safety-gate.mjs --manifest docs/operations/chronos-homologation-safety-gate-package-2026-05-28.json --skip-alias-check`: PASS;
  - smoke local do build empacotado `/chronos`: HTTP 200;
  - smoke local do build empacotado `/chronos/lideranca`: HTTP 200.
- Riscos e pendencias:
  - Zeus precisa preencher `expectedDeploymentId`, `targetPreviewUrl` e `rollbackDeploymentId`;
  - Zeus precisa rodar Safety Gate final sem pular alias;
  - Lucas precisa validar em homologacao antes de producao;
  - worktree raiz segue misto e nao pode ser publicado diretamente.
- Rollback esperado:
  - antes do alias: descartar Preview e manter deployment atual;
  - depois do alias, se Zeus publicar: retornar ao `rollbackDeploymentId` registrado no manifesto final;
  - funcional: restaurar Chronos anterior removendo rotas publicas, Drive/agenda/salas V1 e pacote de sala externa.

## CHRONOS-20260528-016-AGENDA-DETALHE-CONVITES

- Modulo: Chronos.
- Agente responsavel: Chronos Core.
- Status: VALIDADO_LOCAL / OPERACIONAL_COM_ATENCAO.
- Origem: Lucas pediu que eventos da Agenda abrissem detalhes, exibissem link da sala, permitissem exclusao, habilitassem `Tarefa`, `Ausente` e `Agendamento`, removessem `Fonte atual` e separassem convites internos/externos.
- Objetivo:
  - abrir popup de detalhes ao clicar em evento da Agenda;
  - permitir excluir evento com acao icon-only de lixeira e cancelamento seguro no Chronos;
  - mover Google Agenda para botao icon-only no topo e retirar o bloco lateral `Fonte atual`;
  - buscar convidados internos no cadastro de usuarios do Hub e convidados externos no Apolo;
  - persistir tipo de evento (`Evento`, `Tarefa`, `Ausente`, `Agendamento`) no metadata Chronos.
- Arquivos do recorte:
  - `apps/hub/app/api/chronos/invitees/route.ts`;
  - `apps/hub/app/api/chronos/meetings/route.ts`;
  - `apps/hub/lib/chronos/client.ts`;
  - `apps/hub/lib/chronos/server.ts`;
  - `apps/hub/lib/chronos/types.ts`;
  - `apps/hub/modules/chronos/ChronosPage.tsx`;
  - `docs/operations/engineering-operations.md`;
  - `docs/operations/panteon-recorte-protocols.md`;
  - `docs/operations/releases-homologation.md`.
- Comportamento:
  - eventos da Agenda abrem popup com status, tipo, horario, host, protocolo, local e link da sala quando online;
  - botao de copiar link e abrir sala ficam no detalhe do evento;
  - exclusao marca a reuniao como `cancelled` no Supabase e remove do snapshot/lista;
  - rota `GET /api/chronos/invitees` consulta `hub_users` ativos via autorizacao Chronos;
  - popup de criacao alterna `Interno` e `Apolo`, mantendo convidados selecionados com origem identificada;
  - Google Agenda fica como botao icon-only `G` no topo e sincroniza manualmente pelo endpoint protegido existente.
- Exclusoes:
  - sem deploy, Preview, alias de homologacao, producao, env real, secret, migration, Supabase remoto, Storage remoto, Vercel, Google OAuth real ou OpenAI real;
  - sem alteracao em Hades, Hermes, PulseX, Iris, Setup, SquadOps, Guardian, CareDesk, Atlas, Ares ou Zeus.
- Validacao executada:
  - `npx.cmd eslint modules/chronos/ChronosPage.tsx lib/chronos/client.ts lib/chronos/server.ts lib/chronos/types.ts app/api/chronos/meetings/route.ts app/api/chronos/invitees/route.ts --max-warnings 0`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run build --workspace @repo/hub`: OK, com warning conhecido Turbopack/NFT em `next.config.ts` ligado a SquadOps/Engineering Operations;
  - `GET http://localhost:3001/chronos`: HTTP 200 OK;
  - `GET http://localhost:3001/api/chronos/invitees?q=lu` sem auth: HTTP 401 Unauthorized, falha fechada esperada;
  - `git diff --check -- apps/hub/app/api/chronos/invitees/route.ts apps/hub/app/api/chronos/meetings/route.ts apps/hub/lib/chronos/client.ts apps/hub/lib/chronos/server.ts apps/hub/lib/chronos/types.ts apps/hub/modules/chronos/ChronosPage.tsx docs/operations/engineering-operations.md docs/operations/panteon-recorte-protocols.md docs/operations/releases-homologation.md`: OK, apenas avisos LF/CRLF.
- Riscos e pendencias:
  - exclusao no Google Calendar e best-effort e depende da conexao OAuth ja segura estar configurada;
  - busca interna usa `hub_users` ativos e depende desse cadastro estar populado corretamente;
  - worktree raiz segue misto e nao deve ser publicado diretamente.
- Rollback esperado:
  - remover `apps/hub/app/api/chronos/invitees/route.ts`;
  - reverter os ajustes de agenda/detalhe/exclusao em `ChronosPage.tsx`;
  - remover `DELETE` em `app/api/chronos/meetings/route.ts` se necessario;
  - manter eventos existentes no banco; reunioes ja canceladas podem ser reativadas por DataOps com autorizacao explicita.

## IRIS-20260528-017-CACA-MIDIA-V1

- Modulo: Iris.
- Agente responsavel: Iris Core / Caca Atendimento.
- Status: VALIDADO_LOCAL / PRONTO_PARA_VALIDACAO_FUNCIONAL.
- Origem: Lucas aprovou seguir com a V1 para a Caca ler anexos recebidos no WhatsApp antes de responder.
- Objetivo:
  - permitir que a Caca leia imagem, audio e documento recebidos pela Meta antes de montar a resposta;
  - manter a analise server-side, sem salvar binario, URL temporaria da Meta ou token;
  - usar transcricao/resumo do anexo como parte da mensagem do cliente nos fluxos de atendimento e boleto;
  - manter fallback seguro quando a midia estiver indisponivel, grande demais ou sem OpenAI configurada.
- Arquivos do recorte:
  - `apps/hub/lib/iris/caca-agent.ts`;
  - `apps/hub/lib/iris/caca-media-analysis.ts`;
  - `apps/hub/lib/iris/meta-inbound-processor.ts`;
  - `apps/hub/lib/iris/meta-whatsapp.ts`;
  - `docs/operations/engineering-operations.md`;
  - `docs/operations/panteon-recorte-protocols.md`.
- Comportamento:
  - inbound WhatsApp extrai metadados de `image`, `audio`, `document` e `video`;
  - Iris baixa a midia pelo ID da Meta apenas durante o processamento do webhook;
  - audio e transcrito pela OpenAI antes da classificacao de intencao;
  - imagem/documento/video sao resumidos pela OpenAI quando dentro do limite operacional;
  - `provider_payload` guarda somente metadados sanitizados e resultado da leitura, sem arquivo bruto nem URL temporaria;
  - se a leitura falhar, a Caca pede uma descricao curta ou oferece atendimento humano, sem fingir leitura.
- Exclusoes:
  - sem deploy, Preview, alias de homologacao, producao, env real, secret, migration, Supabase remoto, Storage remoto, Vercel ou alteracao de chaves;
  - sem alteracao em Hades, Hermes, PulseX, Setup, SquadOps, Guardian, CareDesk, Atlas, Apolo, Ares, Zeus ou Chronos.
- Validacao executada:
  - `npx.cmd eslint lib/iris/caca-agent.ts lib/iris/caca-media-analysis.ts lib/iris/meta-inbound-processor.ts lib/iris/meta-whatsapp.ts --max-warnings 0` dentro de `apps/hub`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run build --workspace @repo/hub`: OK, com warning conhecido Turbopack/NFT em `next.config.ts` ligado a SquadOps/Engineering Operations.
- Riscos e pendencias:
  - validacao funcional real depende de webhook Meta com anexo em ambiente configurado com `OPENAI_API_KEY` e token Meta;
  - video e documento muito grande podem cair no fallback seguro por limite operacional;
  - worktree raiz segue misto e nao deve ser publicado diretamente;
  - sem resposta em audio nesta V1.
- Rollback esperado:
  - remover `apps/hub/lib/iris/caca-media-analysis.ts`;
  - reverter download de midia em `apps/hub/lib/iris/meta-whatsapp.ts`;
  - reverter enriquecimento de inbound em `apps/hub/lib/iris/meta-inbound-processor.ts`;
  - reverter uso de `mediaAnalysis` em `apps/hub/lib/iris/caca-agent.ts`.

## CHRONOS-20260528-017-PACOTE-HOMOLOGACAO-FECHAMENTO

- Modulo: Chronos.
- Agente responsavel: Chronos Core.
- Status: PACOTE_PREPARADO / AGUARDANDO_ZEUS_PREVIEW / BLOQUEADO_PARA_ALIAS_DIRETO.
- Origem: Lucas solicitou fechar tudo que foi implementado no Chronos em 2026-05-28 para subir em homologacao.
- Objetivo:
  - consolidar em pacote limpo os recortes Chronos validados no dia;
  - substituir o pacote anterior do meio-dia por um pacote final com agenda detalhada, convites internos/Apolo e manifesto atualizado;
  - entregar para Zeus/Hefesto sem misturar Iris, Hades, Hermes, PulseX, Setup, SquadOps, Guardian, CareDesk, Atlas, Apolo, Ares, envs, migrations, alias ou producao.
- Pacote valido:
  - `.codex-deploy/chronos-homolog-20260528-1435/workspace`.
- Pacotes nao finalizados:
  - `.codex-deploy/chronos-homolog-20260528-1237/workspace`: superseded pelo fechamento final;
  - `.codex-deploy/chronos-homolog-20260528-1430/workspace`: descartado por avisos de extracao tar corrompida no pipeline local.
- Manifesto:
  - `docs/operations/chronos-homologation-safety-gate-package-2026-05-28.json`.
- Recortes cobertos:
  - CHRONOS-20260528-009-RESERVA-CICLO-DRIVE;
  - CHRONOS-20260528-010-DRIVE-PASTAS-SALA-SEM-PERFIL;
  - CHRONOS-20260528-011-DRIVE-REUNIAO-FILTROS;
  - CHRONOS-20260528-012-DRIVE-LINGUAGEM-GRAVACAO;
  - CHRONOS-20260528-014-LIMPEZA-VISUAL-AGENDA-SALAS-DRIVE;
  - CHRONOS-20260528-016-AGENDA-DETALHE-CONVITES.
- Arquivos incluidos no pacote:
  - `apps/hub/app/chronos/page.tsx`;
  - `apps/hub/app/chronos/[roomSlug]/page.tsx`;
  - `apps/hub/app/api/chronos/**`;
  - `apps/hub/lib/chronos/**`;
  - `apps/hub/modules/chronos/ChronosPage.tsx`;
  - `apps/hub/modules/chronos/ChronosExternalRoomPage.tsx`;
  - `apps/hub/package.json`;
  - `package-lock.json`;
  - `turbo.json`.
- Arquivos excluidos do pacote:
  - Hades, Hermes, PulseX, Iris, Setup, SquadOps, Guardian, CareDesk, Atlas, Apolo, Ares e Zeus;
  - `packages/database/migrations/0034_chronos_drive_chat_storage.sql`;
  - `.env`, `.env.local`, `.env.production`, `apps/hub/.env`, `apps/hub/.env.local`, `.vercel`, secrets, tokens, dominio, alias, Vercel remoto, Supabase remoto, Storage remoto e producao.
- Validacao executada:
  - `npm.cmd --prefix .codex-deploy/chronos-homolog-20260528-1435/workspace run check-types:hub`: OK;
  - `npm.cmd --prefix .codex-deploy/chronos-homolog-20260528-1435/workspace run lint:hub`: OK, com warnings conhecidos;
  - `npm.cmd --prefix .codex-deploy/chronos-homolog-20260528-1435/workspace run build --workspace @repo/hub`: OK, com warnings conhecidos;
  - smoke local do build empacotado em `http://localhost:3016/chronos`: HTTP 200;
  - smoke local do build empacotado em `http://localhost:3016/chronos/lideranca`: HTTP 200, com log esperado de Supabase ausente no pacote sem env local;
  - smoke local do build empacotado em `http://localhost:3017/api/chronos/invitees?q=lu` sem auth: HTTP 401 Unauthorized;
  - `node scripts/homologation-safety-gate.mjs --manifest docs/operations/chronos-homologation-safety-gate-package-2026-05-28.json --skip-alias-check`: PASS, com warnings esperados de Preview, alias e rollback pendentes.
- Riscos e pendencias:
  - Chronos Core nao criou Preview nem moveu `homo.c2x.app.br`;
  - Zeus precisa preencher `expectedDeploymentId`, `targetPreviewUrl`, `currentDeploymentId` e `rollbackDeploymentId`;
  - Zeus precisa rodar Safety Gate final sem `--skip-alias-check`;
  - worktree raiz segue misto e nao deve ser publicado diretamente;
  - a rota externa depende de Supabase server-side no ambiente alvo.
- Rollback esperado:
  - antes de alias: descartar Preview e manter deployment atual;
  - depois de alias, se Zeus publicar: retornar ao `rollbackDeploymentId` registrado no manifesto final;
  - funcional: restaurar Chronos anterior removendo rotas publicas, agenda detalhada, convites, Drive V1, sala externa e sync Google do recorte.

## CHRONOS-20260529-018-ATA-TRANSCRICAO-PDF

- Modulo: Chronos.
- Agente responsavel: Chronos Core.
- Status: EM PRODUCAO.
- Origem: Lucas pediu melhorar o agente responsavel por transcricao e atas do Chronos.
- Objetivo:
  - fazer a ata registrar inicio programado e fim real da reuniao;
  - listar apenas participantes que fizeram check-in, sem usar lista de convidados;
  - reduzir transcricao inventada ou ruidosa;
  - estruturar atas de alinhamento com plano de acao em tabela;
  - gerar/revisar ata com formatacao institucional e botao para salvar PDF.
- Arquivos incluidos no recorte:
  - `apps/hub/app/api/chronos/meetings/agent/route.ts`;
  - `apps/hub/lib/chronos/minutes.ts`;
  - `apps/hub/lib/chronos/server.ts`;
  - `apps/hub/lib/chronos/types.ts`;
  - `apps/hub/modules/chronos/ChronosPage.tsx`;
  - `apps/hub/modules/chronos/ChronosExternalRoomPage.tsx`;
  - `docs/operations/engineering-operations.md`;
  - `docs/operations/panteon-recorte-protocols.md`.
- Arquivos excluidos do recorte:
  - Hades, Hermes, Iris, Setup, Atlas, PulseX, Guardian, SquadOps, Apolo, Ares, Zeus e demais modulos fora de Chronos;
  - `.env`, `.env.local`, `.env.production`, `apps/hub/.env`, `apps/hub/.env.local`, `.vercel`, secrets, tokens, dominio, alias, Vercel remoto, Supabase remoto, Storage remoto, banco remoto, migration e producao.
- Comportamento entregue:
  - `joined_at`/`left_at` passam a alimentar o dominio dos participantes;
  - helper de minutos calcula contexto oficial da ata e remove duplicidades de check-in;
  - agente de ata usa horario real de encerramento quando disponivel;
  - transcricao OpenAI recebeu instrucao conservadora para nao completar nem inventar fala;
  - captura Web Speech filtra baixa confianca, repeticao e ruido curto;
  - ata de alinhamento inclui plano de acao com prazo padrao de 5 dias uteis quando o prazo nao for informado;
  - revisao formatada usa Century Gothic 9pt, entrelinha 1,5, negritos, logo e marca d'agua institucional;
  - botao `PDF` abre versao imprimivel para salvar via navegador.
- Validacao executada:
  - `npm.cmd run check-types` em `apps/hub`: OK;
  - `npm.cmd run lint` em `apps/hub`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run build` em `apps/hub`: OK, com warning conhecido Turbopack/NFT em `next.config.ts` ligado a SquadOps/Engineering Operations;
  - `GET http://localhost:3001/chronos`: HTTP 200 OK.
- Publicacao em producao:
  - data/hora: 2026-06-01 14:55:00 -03:00;
  - pacote limpo: `.codex-deploy/z01-002-chronos-ata-timbrada-prod-20260601-144217`;
  - deployment anterior/rollback: `dpl_An7vpw7MuXJWznd6iWyHRb8egwTC`;
  - deployment novo: `dpl_6GYLcdrJcMuB2fpYQUrqw2YZnycK`;
  - URL tecnica: `https://careli-hub-hub-i2bs-ycs7jop7q-lucasruas-devs-projects.vercel.app`;
  - aliases confirmados: `https://c2x.app.br` e `https://ops.c2x.app.br`.
- Riscos e pendencias:
  - PDF e gerado por impressao do navegador, ainda sem persistencia server-side;
  - qualidade da transcricao ao vivo segue limitada pelo motor do navegador;
  - validar em reuniao real com check-in, encerramento e audio gravado;
  - worktree raiz permanece misto e nao deve ser publicado diretamente.
- Rollback esperado:
  - remover `apps/hub/lib/chronos/minutes.ts`;
  - reverter mapeamento de `joinedAt` e `leftAt` em `apps/hub/lib/chronos/server.ts` e `apps/hub/lib/chronos/types.ts`;
  - reverter ajustes do agente em `apps/hub/app/api/chronos/meetings/agent/route.ts`;
  - reverter preview formatado/PDF em `apps/hub/modules/chronos/ChronosPage.tsx`;
  - reverter filtros de transcricao ao vivo em `apps/hub/modules/chronos/ChronosExternalRoomPage.tsx`.

## CHRONOS-20260529-020-ATA-AUDIO-PARTICIPANTES-FIM-REAL

- Modulo: Chronos.
- Agente responsavel: Chronos Core.
- Status: EM PRODUCAO.
- Origem: Lucas reportou falhas na ata/transcricao do Chronos em chamada real.
- Objetivo:
  - capturar audio de outros participantes, nao apenas do host;
  - impedir duplicidade de participantes por novo check-in ou nomes equivalentes;
  - corrigir erro `Invalid option : option` ao gerar ata Athena;
  - registrar fim real da chamada e duracao na ata/revisao.
- Arquivos incluidos no recorte:
  - `apps/hub/modules/chronos/ChronosExternalRoomPage.tsx`;
  - `apps/hub/modules/chronos/ChronosPage.tsx`;
  - `apps/hub/lib/chronos/server.ts`;
  - `apps/hub/lib/chronos/minutes.ts`;
  - `apps/hub/app/api/chronos/meetings/agent/route.ts`;
  - `docs/operations/engineering-operations.md`;
  - `docs/operations/panteon-recorte-protocols.md`.
- Arquivos excluidos do recorte:
  - Hades, Hermes, Iris, Setup, Atlas, PulseX, Guardian, SquadOps, Apolo, Ares, Zeus e demais modulos fora de Chronos;
  - `.env`, `.env.local`, `.env.production`, `apps/hub/.env`, `apps/hub/.env.local`, `.vercel`, secrets, tokens, dominio, alias, Vercel remoto, Supabase remoto, Storage remoto, banco remoto, migration e producao.
- Comportamento entregue:
  - gravacao da sala externa passa a montar stream com audio local e remoto;
  - estado de gravacao e sincronizado entre host e participantes por sinal realtime;
  - SpeechRecognition local liga/desliga nos participantes quando o host grava;
  - join de participante reusa registro existente por usuario, e-mail ou identidade de nome operacional;
  - ata/Drive usam participantes deduplicados por check-in;
  - encerramento server-side/local registra fim real e alimenta duracao;
  - agente Athena ignora placeholders invalidos de modelo e gera fallback local quando a OpenAI falha.
- Validacao executada:
  - `npm.cmd run check-types` em `apps/hub`: OK;
  - `npm.cmd run lint` em `apps/hub`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run build` em `apps/hub`: OK, com warning conhecido Turbopack/NFT em `next.config.ts` ligado a SquadOps/Engineering Operations;
  - `GET http://localhost:3001/chronos`: HTTP 200 OK.
- Riscos e pendencias:
  - validar chamada real com dois ou mais participantes e permissao de microfone/transcricao no navegador;
  - fallback local de ata e operacional, mas nao substitui a qualidade da OpenAI quando disponivel;
  - worktree raiz permanece misto e nao deve ser publicado diretamente.
- Rollback esperado:
  - reverter sinais `recording-state` e montagem de audio remoto em `ChronosExternalRoomPage.tsx`;
  - reverter deduplicacao de join em `apps/hub/lib/chronos/server.ts`;
  - reverter duracao/fim real em `apps/hub/lib/chronos/minutes.ts` e `ChronosPage.tsx`;
  - reverter fallback/model resolver em `apps/hub/app/api/chronos/meetings/agent/route.ts`.

## CHRONOS-20260529-021-DRIVE-TRANSCRICAO-PERSISTIDA

- Modulo: Chronos.
- Agente responsavel: Chronos Core.
- Status: VALIDADO_LOCAL / PRONTO_PARA_HOMO / SEM DEPLOY.
- Origem: Lucas reportou que o botao de transcricao nao aparecia no Drive/Atas e que o erro `Invalid option : option` continuava visivel.
- Objetivo:
  - exibir acao de transcricao para gravacoes ja salvas/persistidas no Chronos Drive;
  - permitir que a Athena transcreva o arquivo salvo server-side, sem depender de `Blob` local no navegador;
  - reduzir erro residual `Invalid option : option` e limpar erro antigo ao trocar de reuniao/aba.
- Arquivos incluidos no recorte:
  - `apps/hub/modules/chronos/ChronosPage.tsx`;
  - `apps/hub/lib/chronos/client.ts`;
  - `apps/hub/app/api/chronos/meetings/agent/route.ts`;
  - `docs/operations/engineering-operations.md`;
  - `docs/operations/panteon-recorte-protocols.md`.
- Arquivos excluidos do recorte:
  - Hades, Hermes, Iris, Setup, Atlas, PulseX, Guardian, SquadOps, Apolo, Ares, Zeus e demais modulos fora de Chronos;
  - `.env`, `.env.local`, `.env.production`, `apps/hub/.env`, `apps/hub/.env.local`, `.vercel`, secrets, tokens, dominio, alias, Vercel remoto, Supabase remoto, Storage remoto, banco remoto, migration e producao.
- Comportamento entregue:
  - aba Atas passa a mostrar o botao `Transcrever gravacao` quando houver gravacao `available` com URL assinada;
  - aba Gravacoes/Drive passa a oferecer `Transcrever` tambem para arquivo persistido, nao apenas para gravacao local em memoria;
  - criado endpoint `transcribe_existing_recording` no agente Chronos para buscar o arquivo assinado server-side e enviar para a OpenAI;
  - erro antigo da tela e limpo ao trocar view/ata/reuniao;
  - mensagem `Invalid option : option` passa por normalizacao operacional para orientar placeholder de modelo.
- Validacao executada:
  - `npm.cmd run check-types` em `apps/hub`: OK;
  - `npm.cmd run lint` em `apps/hub`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run build` em `apps/hub`: OK, com warning conhecido Turbopack/NFT em `next.config.ts` ligado a SquadOps/Engineering Operations;
  - `git diff --check` no recorte Chronos/docs: OK;
  - `GET http://localhost:3001/chronos`: HTTP 200 OK;
  - `POST http://localhost:3001/api/chronos/meetings/agent` sem auth: HTTP 401 esperado.
- Riscos e pendencias:
  - transcricao real depende da URL assinada da gravacao persistida estar acessivel no servidor;
  - se o servidor dev ja estava rodando antes do patch, pode exigir refresh forte ou restart do `npm run dev` para recompilar a rota API;
  - worktree raiz permanece misto e nao deve ser publicado diretamente.
- Rollback esperado:
  - reverter `transcribe_existing_recording` em `apps/hub/app/api/chronos/meetings/agent/route.ts`;
  - reverter helper `transcribeChronosExistingRecording` em `apps/hub/lib/chronos/client.ts`;
  - reverter botoes de transcricao persistida e limpeza de erro em `apps/hub/modules/chronos/ChronosPage.tsx`.

## CHRONOS-20260529-022-ATA-POR-TRANSCRICAO-E-VIDEO-EVIDENCIA

- Modulo: Chronos.
- Agente responsavel: Chronos Core.
- Status: VALIDADO_LOCAL / PRONTO_PARA_HOMO / SEM DEPLOY.
- Origem: Lucas definiu que a transcricao salva deve ser gatilho suficiente para liberar a ata formatada e que o video deve ficar como evidencia operacional vinculada.
- Objetivo:
  - encadear transcricao de gravacao com geracao automatica de ata Athena;
  - permitir salvar/gerar ata quando houver transcricao salva, mesmo sem depender novamente da gravacao;
  - registrar gravacao/video como evidencia da ata, sem a Athena inventar conteudo visual nao extraido;
  - incluir chat e evidencias da reuniao no contexto usado pela Athena.
- Arquivos incluidos no recorte:
  - `apps/hub/modules/chronos/ChronosPage.tsx`;
  - `apps/hub/lib/chronos/server.ts`;
  - `apps/hub/app/api/chronos/meetings/agent/route.ts`;
  - `docs/operations/engineering-operations.md`;
  - `docs/operations/panteon-recorte-protocols.md`.
- Arquivos excluidos do recorte:
  - Hades, Hermes, Iris, Setup, Atlas, PulseX, Guardian, SquadOps, Apolo, Ares, Zeus e demais modulos fora de Chronos;
  - `.env`, `.env.local`, `.env.production`, `apps/hub/.env`, `apps/hub/.env.local`, `.vercel`, secrets, tokens, dominio, alias, Vercel remoto, Supabase remoto, Storage remoto, banco remoto, migration e producao.
- Comportamento entregue:
  - `transcribe_recording` e `transcribe_existing_recording` agora salvam a transcricao e em seguida geram/salvam rascunho de ata Athena;
  - `save_minutes` passa a aceitar gravacao disponivel ou transcricao salva como evidencia minima;
  - aba Atas informa quando ha transcricao registrada e altera a acao para `Gerar ata da transcricao`;
  - prompt/fallback da Athena passam a receber evidencias de gravacao/video e chat da reuniao;
  - a regra operacional ficou explicita: video e evidencia vinculada, mas conteudo visual so pode ser usado quando estiver em transcricao, chat, timeline, metadados ou futura extracao visual.
- Validacao executada:
  - `npm.cmd run check-types` em `apps/hub`: OK;
  - `npm.cmd run lint` em `apps/hub`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run build` em `apps/hub`: OK, com warning conhecido Turbopack/NFT em `next.config.ts` ligado a SquadOps/Engineering Operations;
  - `git diff --check` no recorte Chronos: OK, com avisos CRLF esperados em Windows;
  - `GET http://localhost:3001/chronos`: HTTP 200 OK.
- Riscos e pendencias:
  - leitura visual automatica de frames do video ainda nao foi implementada; o video fica preparado como evidencia para auditoria e futura camada de analise visual;
  - a qualidade da ata depende da transcricao estar fiel ao audio capturado;
  - se o servidor dev ja estava rodando antes do patch, pode exigir refresh forte ou restart do `npm run dev`;
  - worktree raiz permanece misto e nao deve ser publicado diretamente.
- Rollback esperado:
  - reverter encadeamento de transcricao para `saveChronosMinutesDraft` em `apps/hub/app/api/chronos/meetings/agent/route.ts`;
  - reverter `assertChronosMeetingHasMinutesEvidence` para a regra anterior em `apps/hub/lib/chronos/server.ts`;
  - reverter estados e labels de transcricao/ata em `apps/hub/modules/chronos/ChronosPage.tsx`.

## CHRONOS-20260601-023-ATA-TIMBRADA-ATHENA

- Modulo: Chronos.
- Agente responsavel: Chronos Core / Zeus.
- Status: VALIDADO_LOCAL / PRONTO_PARA_HOMO / SEM DEPLOY.
- Origem: Lucas pediu que a ata saia no padrao visual do modelo Careli, com fundo, logos, marca d'agua, negritos, bullets, fonte Century Gothic 9, espacamento 0/0 e 1,5 linha.
- Objetivo:
  - aplicar papel timbrado visual na previa formatada e no print/PDF da Ata Chronos;
  - fortalecer a estrutura executiva da ata gerada pela Athena;
  - manter tabela de plano de acao com prazo padrao de 5 dias quando a atividade nao tiver data registrada;
  - impedir que fallback local pareca ata final de baixa qualidade quando a OpenAI nao concluir a geracao.
- Arquivos incluidos no recorte:
  - `apps/hub/app/api/chronos/meetings/agent/route.ts`;
  - `apps/hub/lib/chronos/minutes-draft.ts`;
  - `apps/hub/lib/chronos/minutes-preview.ts`;
  - `apps/hub/modules/chronos/components/chronos-minutes-formatted-preview.tsx`;
  - `apps/hub/public/chronos-minutes-letterhead-top.png`;
  - `apps/hub/public/chronos-minutes-letterhead-footer.png`;
  - `docs/operations/engineering-operations.md`;
  - `docs/operations/panteon-recorte-protocols.md`.
- Arquivos excluidos do recorte:
  - Hades, Hermes, Iris, Setup, Atlas, PulseX, Guardian, SquadOps, Apolo, Ares, Zeus e demais modulos fora de Chronos;
  - `.env`, `.env.local`, `.env.production`, `apps/hub/.env`, `apps/hub/.env.local`, `.vercel`, secrets, tokens, dominio, alias, Vercel remoto, Supabase remoto, Storage remoto, banco remoto, migration e producao.
- Comportamento entregue:
  - previa formatada passa a usar papel timbrado Careli extraido do modelo anexado, com cabecalho, rodape e marca d'agua;
  - print/PDF passa a gerar A4 com papel timbrado, logo, marca d'agua, Century Gothic 9pt, linha 1,5 e paragrafos com margem 0;
  - parser visual reconhece secoes com ou sem acento e transforma bullets, tabelas e labels importantes em HTML executivo;
  - prompt da Athena exige estrutura executiva com secoes fixas, bullets, negritos, plano de acao e sem despejo bruto de transcricao;
  - fallback local separa trechos de transcricao para revisao e deixa claro quando a OpenAI nao concluiu a ata estruturada;
  - helper `normalizeChronosOpenAiModelCandidate` foi reposto para manter o endpoint tipado e evitar quebra no resolver de modelos.
- Validacao executada:
  - `npm.cmd run check-types` em `apps/hub`: OK;
  - `npx.cmd eslint app/api/chronos/meetings/agent/route.ts lib/chronos/minutes-draft.ts lib/chronos/minutes-preview.ts modules/chronos/components/chronos-minutes-formatted-preview.tsx --max-warnings 0` em `apps/hub`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run build` em `apps/hub`: OK, com warning conhecido Turbopack/NFT em `next.config.ts` ligado a SquadOps/Engineering Operations;
  - `GET http://localhost:3001/chronos`: HTTP 200 OK;
  - `GET http://localhost:3001/chronos-minutes-letterhead-top.png`: HTTP 200 OK.
- Riscos e pendencias:
  - validacao visual final depende de abrir uma ata real no navegador e usar o fluxo de salvar/imprimir PDF;
  - a qualidade executiva plena depende da OpenAI retornar JSON valido; fallback local continua operacional, mas nao substitui a Athena;
  - validacao funcional autenticada de Lucas ainda e necessaria para conferir a ata real, a geracao do PDF e o resultado visual do papel timbrado.
- Rollback esperado:
  - remover os assets `chronos-minutes-letterhead-top.png` e `chronos-minutes-letterhead-footer.png`;
  - reverter `minutes-preview.ts` e `chronos-minutes-formatted-preview.tsx` para o layout simples anterior;
  - reverter o prompt/fallback de `apps/hub/app/api/chronos/meetings/agent/route.ts`;
  - reverter o rascunho local em `apps/hub/lib/chronos/minutes-draft.ts`.

## CHRONOS-20260601-024-ATHENA-STRUCTURED-OUTPUT

- Modulo: Chronos.
- Agente responsavel: Chronos Core / Zeus.
- Status: VALIDADO_LOCAL / PRONTO_PARA_HOMO / SEM DEPLOY.
- Origem: Lucas validou que o papel timbrado ficou bom, mas a ata ainda vinha como rascunho local porque a Athena/OpenAI nao concluia a ata executiva.
- Objetivo:
  - fazer a geracao de ata usar saida estruturada obrigatoria da OpenAI;
  - impedir que fallback local seja salvo como se fosse ata executiva pronta;
  - registrar motivo tecnico real quando Athena nao conseguir gerar a ata.
- Arquivos incluidos no recorte:
  - `apps/hub/app/api/chronos/meetings/agent/route.ts`;
  - `docs/operations/engineering-operations.md`;
  - `docs/operations/panteon-recorte-protocols.md`.
- Arquivos excluidos do recorte:
  - Hermes, Hades, Iris, Atlas, Setup, Apolo, Ares, Zeus visual e demais modulos fora de Chronos;
  - `.env`, `.env.local`, `.env.production`, `apps/hub/.env`, `apps/hub/.env.local`, `.vercel`, secrets, tokens, dominio, alias, Vercel remoto, Supabase remoto, Storage remoto, banco remoto, migration e producao.
- Comportamento entregue:
  - modelo padrao da ata Athena passa a ser `gpt-5.5`, mantendo preferencia apenas por `HUB_CHRONOS_MINUTES_MODEL` quando houver valor valido;
  - a ata Chronos deixa de herdar `HUB_AI_MODEL`, para nao perder qualidade por configuracao generica de outra frente;
  - a chamada usa `reasoning.effort: high` para priorizar qualidade executiva da ata;
  - chamada Responses API passa a exigir JSON Schema com `summary` e `minutes`;
  - limite de saida da ata sobe para 8000 tokens;
  - falha da OpenAI agora e logada com protocolo, meetingId, modelo e motivo, sem transcricao nem segredo;
  - endpoint retorna erro 502 rastreavel quando Athena nao conclui a ata executiva;
  - fallback local deixou de ser gravado pelo endpoint de geracao de ata.
- Validacao executada:
  - `npx.cmd eslint app/api/chronos/meetings/agent/route.ts --max-warnings 0` em `apps/hub`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run check-types` em `apps/hub`: OK;
  - `npm.cmd run build` em `apps/hub`: OK, com warning conhecido Turbopack/NFT em `next.config.ts` ligado a SquadOps/Engineering Operations.
- Publicacao em producao:
  - autorizacao: Lucas informou `pode subir`;
  - pacote limpo: `.codex-deploy/z01-003-chronos-athena-structured-prod-20260601-170500`;
  - deployment novo: `dpl_2zfKXD4FYbQSDQfe49aqGHSsSM4d`;
  - URL tecnica: `https://careli-hub-hub-i2bs-iwesh13kr-lucasruas-devs-projects.vercel.app`;
  - aliases confirmados por `npx.cmd vercel inspect`: `https://c2x.app.br` e `https://ops.c2x.app.br`;
  - healthchecks: `/`, `/chronos`, `/hermes` e `/zeus` responderam 200; `/api/chronos/meetings` respondeu 401 sem sessao, esperado;
  - logs de erro Vercel dos aliases nos ultimos 15 minutos: sem ocorrencias.
- Riscos e pendencias:
  - validacao real depende de chamada autenticada com `OPENAI_API_KEY` configurada no ambiente server-side;
  - se a conta OpenAI recusar o modelo efetivo configurado por env, a tela agora deve mostrar o motivo real em vez de salvar ata local ruim;
  - Lucas ainda precisa validar uma ata real autenticada em producao.
- Rollback esperado:
  - promover novamente `dpl_6GYLcdrJcMuB2fpYQUrqw2YZnycK` se houver regressao critica; nao ha rollback de schema/env.

## HERMES-20260605-001-CALL-MESH-STABILITY

- Modulo: Hermes.
- Agente responsavel: Zeus.
- Status: EM PRODUCAO / AGUARDANDO TESTE REAL MULTIUSUARIO.
- Origem: Lucas reportou que o time viu falhas nas videochamadas do Hermes parecidas com as do Chronos: algumas pessoas nao viam outras e alguns audios nao chegavam para todos.
- Objetivo:
  - reduzir assimetria de audio/video em chamadas Hermes com mais de duas pessoas;
  - reaproveitar a licao do Chronos de manter o estado de participantes e reconciliar pares WebRTC;
  - evitar que um participante aceite a chamada com lista pendente desatualizada e deixe par sem conexao.
- Arquivos incluidos no recorte:
  - `apps/hub/components/pulsex/call-panel.tsx`;
  - `apps/hub/providers/pulsex-call-provider.tsx`;
  - `docs/operations/engineering-operations.md`;
  - `docs/operations/panteon-recorte-protocols.md`.
- Arquivos excluidos do recorte:
  - Chronos, Hades, Iris, Atlas, Setup, Apolo, Ares, Zeus visual e demais modulos fora de Hermes;
  - `.env`, `.env.local`, `.env.production`, `apps/hub/.env`, `apps/hub/.env.local`, `.vercel`, secrets, tokens, dominio, alias, Vercel remoto, Supabase remoto, Storage remoto, banco remoto, migration e producao.
- Comportamento entregue:
  - o provider de chamadas Hermes agora atualiza tambem a chamada pendente (`incomingCall`) quando outro participante entra antes do usuario aceitar;
  - o painel de chamada reconcilia participantes remotos com status `joined` que ainda nao possuem peer connection ativa;
  - a oferta WebRTC de reconciliacao usa criterio deterministico por `userId` para evitar duas pontas criando oferta ao mesmo tempo;
  - o recorte preserva os controles atuais de microfone, camera, tela, audio separado e tiles de participante.
- Validacao executada:
  - `npx.cmd eslint components/pulsex/call-panel.tsx providers/pulsex-call-provider.tsx --max-warnings 0` em `apps/hub`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run check-types:hub`: OK;
  - pacote limpo: varredura sem `.git`, `.next`, `.turbo`, `.env`, `.env.local`, `node_modules`, `.codex-artifacts` ou `.codex-logs`;
  - pacote limpo: `npm.cmd run lint:hub`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - pacote limpo: `npm.cmd run build --workspace @repo/hub`: OK, com warnings conhecidos de lockfile adicional em pacote local e Turbopack/NFT;
  - build remoto Vercel Production: READY.
- Publicacao em producao:
  - autorizacao: Lucas informou `produçãoi`, confirmando producao para o recorte somente do bloco de chamada Hermes;
  - pacote limpo: `.codex-deploy/hermes-call-mesh-prod-20260605`;
  - staging isolado temporario: `C:\Users\lucas\AppData\Local\Temp\careli-hub-deploys\hermes-call-mesh-prod-20260605`;
  - deployment anterior/rollback imediato: `dpl_2zfKXD4FYbQSDQfe49aqGHSsSM4d`;
  - deployment novo: `dpl_7J3G87mTv1k8z1BVo81pQM6EcWwZ`;
  - URL tecnica: `https://careli-hub-hub-i2bs-drbngiqe1-lucasruas-devs-projects.vercel.app`;
  - aliases confirmados: `https://c2x.app.br` e `https://ops.c2x.app.br`;
  - healthchecks: `/`, `/login`, `/hermes`, `/pulsex`, `https://ops.c2x.app.br/zeus` e `/api/pwa/manifest` 200; `/api/hermes/messages` sem sessao 401 esperado;
  - logs Vercel de erro dos aliases nos ultimos 10 minutos: sem logs encontrados.
- Riscos e pendencias:
  - validacao funcional real ainda depende de chamada Hermes autenticada com tres ou mais usuarios/maquinas;
  - se a falha restante for NAT/rede externa, pode exigir revisao de TURN/ICE em recorte sensivel separado, sem expor valores de env;
  - worktree raiz permanece misto e nao deve ser publicado diretamente.
- Rollback esperado:
  - reverter a reconciliacao de pares em `apps/hub/components/pulsex/call-panel.tsx`;
  - reverter a atualizacao de `incomingCall` em `apps/hub/providers/pulsex-call-provider.tsx`.

## ZEUS-20260605-001-HELPDESK-UX-FLOW

- Modulo: Zeus / HelpDesk.
- Agente responsavel: Zeus.
- Status: EM PRODUCAO EM `https://ops.c2x.app.br`.
- Origem: Lucas pediu que o HelpDesk vire a tela principal do Zeus, que a fila fique mais limpa, que validacoes sem resposta fechem apos 3 dias, que anexos nao tenham limite de quantidade e que textos de atendimento usem o operador real em vez de Zeus generico. Durante o recorte, Lucas confirmou que tickets `Novo` tambem devem permanecer na fila.
- Objetivo:
  - abrir Zeus diretamente no HelpDesk;
  - deixar a fila ativa somente com tickets novos, tratativas e revisoes;
  - finalizar automaticamente tickets em validacao ha 3 dias sem nova resposta;
  - reduzir texto explicativo e priorizar acoes por icone;
  - permitir multiplos anexos mantendo limite de tamanho por item.
- Arquivos incluidos no recorte:
  - `apps/hub/modules/squadops/ZeusPage.tsx`;
  - `apps/hub/modules/squadops/blocks/helpdesk/helpdesk-board.tsx`;
  - `apps/hub/modules/squadops/blocks/helpdesk/helpdesk-ticket-summary.ts`;
  - `apps/hub/components/hub-support/hub-ticket-open-form.tsx`;
  - `apps/hub/components/hub-support/hub-user-tickets-panel.tsx`;
  - `apps/hub/lib/hub-it-tickets/server.ts`;
  - `apps/hub/app/api/hub/it-tickets/evidence-analysis/route.ts`;
  - `docs/operations/engineering-operations.md`;
  - `docs/operations/panteon-recorte-protocols.md`.
- Arquivos excluidos do recorte:
  - Hermes, Hades, Iris, Chronos, Atlas, Setup, Apolo, Ares e demais modulos fora de Zeus/HelpDesk;
  - `.env`, `.env.local`, `.env.production`, `apps/hub/.env`, `apps/hub/.env.local`, `.vercel`, secrets, tokens, Supabase remoto, Storage remoto, banco remoto e migration;
  - dominios fora de `https://ops.c2x.app.br`, incluindo preservacao de `https://c2x.app.br` no deployment anterior.
- Comportamento entregue:
  - `ZeusPage` inicia em `HelpDesk`;
  - fila ativa do board exibe somente `Novo`, `Em tratativa` e `Revisao`;
  - status de validacao fica fora da fila ativa e entra no historico operacional;
  - listagem server-side fecha automaticamente tickets em status de validacao com `updated_at`/`updatedAt` de 3 dias ou mais;
  - eventos de anexos e decisao de data usam nome do operador real;
  - formulario do operador, abertura de HelpDesk, revisao do solicitante e normalizacao server-side aceitam multiplos anexos, mantendo limite de 6 MB por item;
  - botoes de anexo, tratativa e envio para validacao foram reduzidos para icones com tooltip.
- Validacao executada:
  - `npx.cmd eslint modules/squadops/ZeusPage.tsx modules/squadops/blocks/helpdesk/helpdesk-board.tsx modules/squadops/blocks/helpdesk/helpdesk-ticket-summary.ts components/hub-support/hub-ticket-open-form.tsx components/hub-support/hub-user-tickets-panel.tsx lib/hub-it-tickets/server.ts app/api/hub/it-tickets/evidence-analysis/route.ts --max-warnings 0` em `apps/hub`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run build --workspace @repo/hub`: OK, com warning conhecido Turbopack/NFT em `engineering-operations-source.ts`;
  - `git diff --check` no recorte: OK, apenas avisos CRLF do Windows.
- Publicacao:
  - autorizacao: Lucas confirmou `pode subir em producao` para o recorte Zeus/HelpDesk;
  - pacote limpo: `.codex-deploy/zeus-helpdesk-prod-20260605`;
  - estrategia: `vercel deploy --prod --skip-domain` para criar deployment de producao sem promover automaticamente dominios fora do escopo, seguido de `vercel alias set` somente para `ops.c2x.app.br`;
  - deployment anterior/rollback do OPS: `dpl_7J3G87mTv1k8z1BVo81pQM6EcWwZ`;
  - deployment novo OPS: `dpl_ENMuLsMJwmCyrHpWG5vn247NGPPt`;
  - URL tecnica: `https://careli-hub-hub-i2bs-kdfyttz0j-lucasruas-devs-projects.vercel.app`;
  - alias publicado: `https://ops.c2x.app.br`;
  - dominio preservado: `https://c2x.app.br` permaneceu em `dpl_7J3G87mTv1k8z1BVo81pQM6EcWwZ`;
  - sem alteracao de env, secret, token, Supabase, banco ou migration.
- Healthchecks pos-publicacao:
  - `npx.cmd vercel inspect https://ops.c2x.app.br --scope lucasruas-devs-projects`: Ready no deployment `dpl_ENMuLsMJwmCyrHpWG5vn247NGPPt`;
  - `npx.cmd vercel inspect https://c2x.app.br --scope lucasruas-devs-projects`: Ready no deployment preservado `dpl_7J3G87mTv1k8z1BVo81pQM6EcWwZ`;
  - `GET https://ops.c2x.app.br/`: 200;
  - `GET https://ops.c2x.app.br/login`: 200;
  - `GET https://ops.c2x.app.br/zeus`: 200;
  - `GET https://ops.c2x.app.br/api/pwa/manifest`: 200;
  - `GET https://ops.c2x.app.br/api/hub/it-tickets` sem sessao: 401 esperado;
  - `GET https://c2x.app.br/`: 200;
  - logs Vercel de erro em `ops.c2x.app.br` e na URL tecnica nos ultimos 10 minutos: sem logs encontrados.
- Riscos e pendencias:
  - validacao visual autenticada em `https://ops.c2x.app.br/zeus` ainda depende de publicacao autorizada;
  - auto-finalizacao executa ao carregar/listar HelpDesk, sem job agendado separado.
- Rollback esperado:
  - apontar `https://ops.c2x.app.br` de volta para `dpl_7J3G87mTv1k8z1BVo81pQM6EcWwZ`;
  - reverter os arquivos listados neste protocolo para restaurar fila/abas/anexos/eventos anteriores.

### Complemento 2026-06-05 - data de entrega como primeira interacao da coluna

- Status: EM PRODUCAO EM `https://ops.c2x.app.br`.
- Origem: Lucas apontou que ainda faltava deixar a data de entrega no topo da coluna, como a primeira coisa para interagir.
- Ajuste:
  - a secao `Entrega` da fila passou a abrir expandida por padrao e ficou acima dos botoes `Fila`/`Historico` e do resumo de fluxo;
  - os cards da fila lateral e do kanban agora comecam visualmente por uma faixa de `Entrega`, antes de protocolo, status, avatar e demais metadados;
  - a faixa de entrega preserva o tom operacional de prazo (`hoje`, `1-2 dias`, `3+ dias`, `sem data`) sem adicionar texto explicativo longo.
- Arquivo alterado:
  - `apps/hub/modules/squadops/blocks/helpdesk/helpdesk-board.tsx`.
- Validacoes executadas:
  - `npx.cmd eslint modules/squadops/blocks/helpdesk/helpdesk-board.tsx --max-warnings 0` em `apps/hub`: PASS, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run check-types:hub`: PASS;
  - `npm.cmd run build --workspace @repo/hub`: PASS, com warning conhecido Turbopack/NFT em `engineering-operations-source.ts`;
  - `git diff --check -- apps/hub/modules/squadops/blocks/helpdesk/helpdesk-board.tsx`: PASS.
- Publicacao complementar:
  - autorizacao: Lucas confirmou `pode subir em producao` para aplicar o complemento;
  - pacote limpo: `.codex-deploy/zeus-helpdesk-delivery-top-prod-20260605`;
  - estrategia: `vercel deploy --prod --skip-domain` para criar deployment de producao sem promover automaticamente dominios fora do escopo, seguido de `vercel alias set` somente para `ops.c2x.app.br`;
  - deployment anterior/rollback do OPS: `dpl_ENMuLsMJwmCyrHpWG5vn247NGPPt`;
  - deployment complementar novo OPS: `dpl_4Gt3b1cWYt4575R8yg5XeiiBv2bd`;
  - URL tecnica: `https://careli-hub-hub-i2bs-h5bkddo9s-lucasruas-devs-projects.vercel.app`;
  - alias publicado: `https://ops.c2x.app.br`;
  - dominio preservado: `https://c2x.app.br` permaneceu em `dpl_7J3G87mTv1k8z1BVo81pQM6EcWwZ`;
  - sem alteracao de env, secret, token, Supabase, banco ou migration.
- Healthchecks pos-publicacao complementar:
  - `npx.cmd vercel inspect https://ops.c2x.app.br --scope lucasruas-devs-projects`: Ready no deployment `dpl_4Gt3b1cWYt4575R8yg5XeiiBv2bd`;
  - `npx.cmd vercel inspect https://c2x.app.br --scope lucasruas-devs-projects`: Ready no deployment preservado `dpl_7J3G87mTv1k8z1BVo81pQM6EcWwZ`;
  - `GET https://ops.c2x.app.br/`: 200;
  - `GET https://ops.c2x.app.br/login`: 200;
  - `GET https://ops.c2x.app.br/zeus`: 200;
  - `GET https://ops.c2x.app.br/api/pwa/manifest`: 200;
  - `GET https://ops.c2x.app.br/api/hub/it-tickets` sem sessao: 401 esperado;
  - `GET https://c2x.app.br/`: 200;
  - logs Vercel de erro em `ops.c2x.app.br` e na URL tecnica nos ultimos 10 minutos: sem logs encontrados.
- Rollback complementar:
  - apontar `https://ops.c2x.app.br` de volta para `dpl_ENMuLsMJwmCyrHpWG5vn247NGPPt`.

### Complemento 2026-06-05 - entrega no topo do atendimento e PO AI fixo

- Status: EM PRODUCAO EM `https://ops.c2x.app.br`.
- Origem: Lucas mostrou que, dentro da janela do atendimento, `Data de entrega` ainda ficava abaixo de `Devolutiva`, e pediu para remover o botao flutuante do agente, deixando-o fixo nessa janela.
- Ajuste:
  - dentro do painel do ticket, `Data de entrega` passou a ser o primeiro bloco acionavel da lateral, antes de `Historico` e `Devolutiva`;
  - o bloco `Data de entrega` abre expandido por padrao ao selecionar um ticket;
  - o botao flutuante global do PO AI foi removido do Zeus;
  - o acesso ao PO AI passou a ficar fixo no cabecalho do HelpDesk, ao lado da acao de atualizar.
- Arquivos alterados:
  - `apps/hub/modules/squadops/ZeusPage.tsx`;
  - `apps/hub/modules/squadops/blocks/helpdesk/helpdesk-board.tsx`.
- Validacoes executadas:
  - `npx.cmd eslint modules/squadops/ZeusPage.tsx modules/squadops/blocks/helpdesk/helpdesk-board.tsx --max-warnings 0` em `apps/hub`: PASS, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run check-types:hub`: PASS;
  - `npm.cmd run build --workspace @repo/hub`: PASS, com warning conhecido Turbopack/NFT em `engineering-operations-source.ts`;
  - `git diff --check -- apps/hub/modules/squadops/ZeusPage.tsx apps/hub/modules/squadops/blocks/helpdesk/helpdesk-board.tsx`: PASS, apenas aviso CRLF do Windows.
- Publicacao:
  - autorizacao: Lucas confirmou `pode subir em producao`;
  - pacote limpo: `.codex-deploy/zeus-helpdesk-ticket-panel-prod-20260605`;
  - estrategia: `vercel deploy --prod --skip-domain`, seguido de `vercel alias set` somente para `ops.c2x.app.br`;
  - deployment anterior/rollback do OPS: `dpl_4Gt3b1cWYt4575R8yg5XeiiBv2bd`;
  - deployment novo OPS: `dpl_6SQfR3zmSJ2WvyVNCpz9p12yrE9F`;
  - URL tecnica: `https://careli-hub-hub-i2bs-am4cozbmj-lucasruas-devs-projects.vercel.app`;
  - dominio preservado: `https://c2x.app.br` permaneceu em `dpl_7J3G87mTv1k8z1BVo81pQM6EcWwZ`;
  - sem alteracao de env, secret, token, Supabase, banco ou migration.
- Healthchecks pos-publicacao:
  - `npx.cmd vercel inspect https://ops.c2x.app.br --scope lucasruas-devs-projects`: Ready no deployment `dpl_6SQfR3zmSJ2WvyVNCpz9p12yrE9F`;
  - `npx.cmd vercel inspect https://c2x.app.br --scope lucasruas-devs-projects`: Ready no deployment preservado `dpl_7J3G87mTv1k8z1BVo81pQM6EcWwZ`;
  - `GET https://ops.c2x.app.br/`: 200;
  - `GET https://ops.c2x.app.br/login`: 200;
  - `GET https://ops.c2x.app.br/zeus`: 200;
  - `GET https://ops.c2x.app.br/api/pwa/manifest`: 200;
  - `GET https://ops.c2x.app.br/api/hub/it-tickets` sem sessao: 401 esperado;
  - `GET https://c2x.app.br/`: 200;
  - logs Vercel de erro em `ops.c2x.app.br` e na URL tecnica nos ultimos 10 minutos: sem logs encontrados.
- Rollback:
  - apontar `https://ops.c2x.app.br` de volta para `dpl_4Gt3b1cWYt4575R8yg5XeiiBv2bd`.

### Complemento 2026-06-05 - fila sem corte no viewport

- Status: EM PRODUCAO EM `https://ops.c2x.app.br`.
- Origem: Lucas mostrou que a lista da fila estava cortando tickets no fim da coluna em `https://ops.c2x.app.br/zeus`.
- Ajuste:
  - a grade principal do HelpDesk passou a ter altura travada no viewport em desktop (`xl:h-[calc(100vh-13rem)]`) e `min-h-0`;
  - a lateral da fila virou coluna flex com `min-h-0` e altura cheia;
  - a area da lista removeu a combinacao conflitante de `max-height` com `min-height: 28rem`;
  - a lista agora ocupa o espaco restante com `flex-1`, `min-h-0`, rolagem propria e respiro inferior, evitando corte do ultimo card.
- Arquivo alterado:
  - `apps/hub/modules/squadops/blocks/helpdesk/helpdesk-board.tsx`.
- Validacoes executadas:
  - `npx.cmd eslint modules/squadops/blocks/helpdesk/helpdesk-board.tsx --max-warnings 0` em `apps/hub`: PASS, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run check-types:hub`: PASS;
  - `npm.cmd run build --workspace @repo/hub`: PASS, com warning conhecido Turbopack/NFT em `engineering-operations-source.ts`;
  - `git diff --check -- apps/hub/modules/squadops/blocks/helpdesk/helpdesk-board.tsx`: PASS.
- Publicacao:
  - autorizacao: Lucas confirmou `pode subir`;
  - pacote limpo: `.codex-deploy/zeus-helpdesk-queue-scroll-prod-20260605`;
  - estrategia: `vercel deploy --prod --skip-domain`, seguido de `vercel alias set` somente para `ops.c2x.app.br`;
  - deployment anterior/rollback do OPS: `dpl_6SQfR3zmSJ2WvyVNCpz9p12yrE9F`;
  - deployment novo OPS: `dpl_EU9fqcsvKjwAtimhBsFvG8M9HLRH`;
  - URL tecnica: `https://careli-hub-hub-i2bs-71jeepmbx-lucasruas-devs-projects.vercel.app`;
  - dominio preservado: `https://c2x.app.br` permaneceu em `dpl_7J3G87mTv1k8z1BVo81pQM6EcWwZ`;
  - sem alteracao de env, secret, token, Supabase, banco ou migration.
- Healthchecks pos-publicacao:
  - `npx.cmd vercel inspect https://ops.c2x.app.br --scope lucasruas-devs-projects`: Ready no deployment `dpl_EU9fqcsvKjwAtimhBsFvG8M9HLRH`;
  - `npx.cmd vercel inspect https://c2x.app.br --scope lucasruas-devs-projects`: Ready no deployment preservado `dpl_7J3G87mTv1k8z1BVo81pQM6EcWwZ`;
  - `GET https://ops.c2x.app.br/`: 200;
  - `GET https://ops.c2x.app.br/login`: 200;
  - `GET https://ops.c2x.app.br/zeus`: 200;
  - `GET https://ops.c2x.app.br/api/pwa/manifest`: 200;
  - `GET https://ops.c2x.app.br/api/hub/it-tickets` sem sessao: 401 esperado;
  - `GET https://c2x.app.br/`: 200;
  - logs Vercel de erro em `ops.c2x.app.br` e na URL tecnica nos ultimos 10 minutos: sem logs encontrados.
- Rollback:
  - apontar `https://ops.c2x.app.br` de volta para `dpl_6SQfR3zmSJ2WvyVNCpz9p12yrE9F`.

### Complemento 2026-06-05 - destravar rolagem dos dados do ticket

- Status: EM PRODUCAO EM `https://ops.c2x.app.br`.
- Origem: Lucas mostrou que a correcao anterior da fila travou a tela e impediu descer para ver os dados completos do ticket.
- Ajuste:
  - removida a trava `xl:h-[calc(100vh-13rem)]` do grid principal do HelpDesk;
  - removido `overflow-hidden` da surface principal, permitindo a pagina voltar a rolar para o conteudo do ticket;
  - a fila lateral permanece limitada em desktop via `xl:max-h-[calc(100vh-8rem)]`;
  - a fila lateral passou a usar `xl:sticky xl:top-4`, mantendo scroll proprio sem bloquear a rolagem da area do ticket.
- Arquivo alterado:
  - `apps/hub/modules/squadops/blocks/helpdesk/helpdesk-board.tsx`.
- Validacoes executadas:
  - `npx.cmd eslint modules/squadops/blocks/helpdesk/helpdesk-board.tsx --max-warnings 0` em `apps/hub`: PASS, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run check-types:hub`: PASS;
  - `npm.cmd run build --workspace @repo/hub`: PASS, com warning conhecido Turbopack/NFT em `engineering-operations-source.ts`;
  - `git diff --check -- apps/hub/modules/squadops/blocks/helpdesk/helpdesk-board.tsx`: PASS.
- Publicacao complementar em producao OPS:
  - autorizacao: Lucas confirmou `pode subir`;
  - pacote limpo: `.codex-deploy/zeus-helpdesk-ticket-scroll-prod-20260605`;
  - estrategia: `vercel deploy --prod --skip-domain` seguido de `vercel alias set` somente para `ops.c2x.app.br`;
  - deployment anterior/rollback OPS: `dpl_EU9fqcsvKjwAtimhBsFvG8M9HLRH`;
  - deployment novo OPS: `dpl_Gitf6mZqC4Wq23ChG16fYP34toZj`;
  - URL tecnica nova: `https://careli-hub-hub-i2bs-k66oazozn-lucasruas-devs-projects.vercel.app`;
  - `https://c2x.app.br` preservado em `dpl_7J3G87mTv1k8z1BVo81pQM6EcWwZ`;
  - sem alteracao de env, secret, token, Supabase, banco, migration ou dominio principal.
- Healthchecks pos-publicacao:
  - `vercel inspect https://ops.c2x.app.br`: READY em `dpl_Gitf6mZqC4Wq23ChG16fYP34toZj`;
  - `vercel inspect https://c2x.app.br`: READY em `dpl_7J3G87mTv1k8z1BVo81pQM6EcWwZ`;
  - `GET https://ops.c2x.app.br/`: 200;
  - `GET https://ops.c2x.app.br/login`: 200;
  - `GET https://ops.c2x.app.br/zeus`: 200;
  - `GET https://ops.c2x.app.br/api/pwa/manifest`: 200;
  - `GET https://ops.c2x.app.br/api/hub/it-tickets` sem sessao: 401 esperado;
  - `GET https://c2x.app.br/`: 200;
  - logs Vercel de erro em `ops.c2x.app.br` e na URL tecnica nos ultimos 10 minutos: sem logs encontrados.
- Limites:
  - deploy executado somente no recorte Zeus/HelpDesk e alias movido somente em `ops.c2x.app.br`;
  - sem publicacao de `https://c2x.app.br`;
  - sem env, secret, token, Supabase, banco ou migration.
- Rollback:
  - apontar `https://ops.c2x.app.br` de volta para `dpl_EU9fqcsvKjwAtimhBsFvG8M9HLRH`.

## HERMES-20260605-002-NOTIFICATIONS-REPLIES

- Status: VALIDADO LOCALMENTE / AGUARDANDO VALIDACAO AUTENTICADA E PUBLICACAO EM `https://c2x.app.br`.
- Origem: Lucas reportou que notificacoes do Hermes estavam atrasadas, badges de mensagens nao lidas nao apareciam na frente dos canais, botoes do topo estavam ruins, notificacoes Windows/PWA nao apareciam, respostas nao permitiam marcar pessoas e o canal de lideranca nao descia para a ultima mensagem apos atualizar.
- Objetivo:
  - fortalecer a camada de notificacao do Hermes sem mexer em outros modulos;
  - atualizar badges de nao lidas de todos os canais sem depender apenas do canal ativo;
  - expor no topo um menu acionavel de mensagens nao lidas, separado de respostas e chamadas;
  - emitir notificacao do navegador/PWA quando houver permissao;
  - permitir mencoes em respostas/thread;
  - melhorar rolagem automatica para a ultima mensagem ao trocar de canal ou receber mensagem nova.
- Arquivos alterados:
  - `apps/hub/components/pulsex/pulsex-workspace.tsx`;
  - `apps/hub/components/pulsex/conversation-header.tsx`;
  - `apps/hub/components/pulsex/thread-panel.tsx`;
  - `apps/hub/components/pulsex/message-list.tsx`;
  - `apps/hub/lib/pulsex/supabase-data.ts`;
  - `apps/hub/lib/pulsex/types.ts`.
- Implementacao:
  - adicionado refresh global leve do workspace a cada 6s para recalcular unread/badges de todos os canais e detectar mensagens novas fora do canal aberto;
  - `notifyIncomingMessages` agora usa o canal real da mensagem, toca som, mostra toast interno e chama `showBrowserHermesNotification` com deep link para `/hermes?channel=...`;
  - o workspace registra a intencao de permissao de notificacao do navegador apos interacao do usuario, seguindo o padrao seguro ja existente;
  - o topo do Hermes ganhou menu de `Mensagens novas` com contador total e lista de canais nao lidos;
  - respostas/thread ganharam autocomplete de mencao por `@`, botao icon-only de marcar pessoa, chips removiveis e persistencia de `mentionUserIds`/`mentions`;
  - a lista de mensagens passou a rolar para o fim em troca de canal e nova mensagem usando scroll imediato, proximo frame e fallback curto.
- Validacoes executadas:
  - `npx.cmd eslint components/pulsex/pulsex-workspace.tsx components/pulsex/conversation-header.tsx components/pulsex/thread-panel.tsx components/pulsex/message-list.tsx lib/pulsex/supabase-data.ts lib/pulsex/types.ts --max-warnings 0`: PASS, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `GET http://localhost:3001/hermes` com dev server temporario: 200;
  - `git diff --check -- apps/hub/components/pulsex/pulsex-workspace.tsx apps/hub/components/pulsex/conversation-header.tsx apps/hub/components/pulsex/thread-panel.tsx apps/hub/components/pulsex/message-list.tsx apps/hub/lib/pulsex/supabase-data.ts apps/hub/lib/pulsex/types.ts`: PASS.
- Validacoes bloqueadas:
  - `npm.cmd run check-types:hub`: BLOQUEADO por erro preexistente/fora do recorte em `apps/hub/modules/chronos/ChronosExternalRoomPage.tsx`, onde `RemoteParticipant` foi importado como type-only e usado como valor;
  - `npm.cmd run build --workspace @repo/hub`: BLOQUEADO no mesmo typecheck de Chronos, apesar de compilar o bundle antes da etapa TypeScript; warning conhecido Turbopack/NFT em `engineering-operations-source.ts`.
- Limites:
  - sem deploy, redeploy, alias, dominio, Vercel, Supabase, banco, migration, env, secret ou token nesta etapa;
  - recorte e de Hermes e, se Lucas autorizar publicacao, deve mirar `https://c2x.app.br`, nao `https://ops.c2x.app.br`.
- Riscos:
  - notificacao Windows/PWA depende de permissao do navegador e do app instalado/aberto com suporte do browser;
  - validacao real de atraso/unread precisa de sessao autenticada com dois usuarios ou duas janelas/maquinas;
  - build global segue bloqueado por Chronos ate o erro de tipo ser corrigido em recorte proprio.
- Rollback:
  - reverter os seis arquivos listados neste protocolo para restaurar o comportamento anterior de notificacoes, replies e rolagem.

### Producao 2026-06-05

- Status atualizado: `EM PRODUCAO` em `https://c2x.app.br`.
- Deployment novo: `dpl_EPC1BLuZ9EF4XXJfGjz73BGCVdLn`.
- URL tecnica: `https://careli-hub-hub-i2bs-jyp1ihfj1-lucasruas-devs-projects.vercel.app`.
- Publicacao: production deployment com `--skip-domain` e alias manual somente de `c2x.app.br`.
- `https://ops.c2x.app.br`: preservado em `dpl_Gitf6mZqC4Wq23ChG16fYP34toZj`, sem publicacao cruzada.
- Healthchecks: `GET https://c2x.app.br/hermes` 200 e `GET https://ops.c2x.app.br/zeus` 200.
- Rollback: reapontar `https://c2x.app.br` para `dpl_7J3G87mTv1k8z1BVo81pQM6EcWwZ` se houver regressao critica.

## CHRONOS-20260605-002-LIVEKIT-CALL-CONTROLS

- Status: VALIDADO LOCALMENTE / BLOQUEADO PARA HOMOLOGACAO ATE ENV, EGRESS E WEBHOOK AUTORIZADOS.
- Origem:
  - Lucas confirmou a configuracao local LiveKit e definiu que a URL publica deve continuar sendo a rota institucional do Chronos;
  - Lucas pediu controles com layout/icones do LiveKit, mantendo extensoes Chronos quando necessarias para o fluxo executivo.
- Objetivo:
  - preparar a PoC LiveKit para substituir o motor instavel de videochamada;
  - preservar `/chronos/[roomSlug]` como URL publica de cliente;
  - emitir token LiveKit server-side;
  - conectar audio, camera, tela e chat pelo LiveKit;
  - trocar a barra herdada do PulseX por controle de chamada Chronos/LiveKit.
- Arquivos alterados:
  - `apps/hub/lib/chronos/livekit.ts`;
  - `apps/hub/app/api/chronos/public/rooms/[roomSlug]/livekit-token/route.ts`;
  - `apps/hub/modules/chronos/ChronosExternalRoomPage.tsx`;
  - `apps/hub/package.json`;
  - `package-lock.json`;
  - `turbo.json`;
  - `docs/operations/engineering-operations.md`;
  - `docs/operations/panteon-recorte-protocols.md`.
- Implementacao:
  - token LiveKit gerado apenas no server com grants de sala/participante e metadados;
  - sala externa conecta no LiveKit quando `NEXT_PUBLIC_CHRONOS_VIDEO_PROVIDER=livekit`;
  - microfone, camera e compartilhamento de tela publicam tracks no LiveKit;
  - chat publica pelo canal de dados LiveKit e tambem preserva persistencia Chronos;
  - saida da chamada limpa conexao LiveKit, streams locais e estado da sala;
  - barra icon-only adicionada com microfone, camera, tela, gravacao, chat, transcricao, picture-in-picture, dispositivos e encerrar chamada;
  - `turbo.json` recebeu apenas nomes de envs LiveKit/Chronos, sem valores sensiveis.
- Validacoes executadas:
  - `npm.cmd run check-types:hub`: PASS;
  - `npm.cmd run lint:hub`: PASS, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run build --workspace @repo/hub`: PASS, com warning conhecido Turbopack/NFT em SquadOps fora do recorte;
  - `GET http://localhost:3001/chronos/lideranca`: 200 OK.
- Validacoes bloqueadas:
  - navegador interno para validacao visual: falha de sandbox do runtime;
  - chamada real com dois participantes, permissao de camera/microfone, egress, webhook e persistencia definitiva de gravacao ainda pendentes.
- Limites:
  - sem deploy, Preview, homologacao, producao, Vercel remoto, Supabase mutavel, banco, migration, storage remoto, dominio, alias, env ou secret;
  - worktree esta misto com outros modulos e exige recorte limpo antes de qualquer publicacao.
- Riscos:
  - LiveKit local depende das envs locais ja configuradas pelo Lucas;
  - custos e arquitetura de Egress/Storage/Webhook ainda precisam de decisao antes de homologacao.
- Rollback:
  - remover `livekit-client` de `apps/hub/package.json`/`package-lock.json`;
  - reverter `apps/hub/lib/chronos/livekit.ts`, rota `livekit-token`, alteracoes da sala externa e nomes de env adicionados ao `turbo.json`.

## OP-20260610-021-CHRONOS-LIVEKIT-PRESENCE-GUARD

- Status: VALIDADO LOCALMENTE / PRODUCAO BLOQUEADA ATE AUTORIZACAO DO LUCAS.
- Modulo dono: Chronos.
- Origem:
  - Lucas reportou em 2026-06-10 que a chamada apareceu na UI do Chronos, mas nao havia evidencia no banco esperado nem no projeto LiveKit aberto no painel;
  - logs de rota 200 para `livekit-token`/`egress` nao sao suficientes para provar presenca real no LiveKit correto.
- Objetivo:
  - impedir que a UI do Chronos mostre uma chamada ativa sem confirmacao server-side do participante no LiveKit RoomService;
  - persistir evidencia minima de presenca LiveKit no meeting/participant do Chronos antes de liberar o estado visual da sala.
- Arquivos incluidos:
  - `apps/hub/lib/chronos/livekit.ts`;
  - `apps/hub/lib/chronos/server.ts`;
  - `apps/hub/modules/chronos/ChronosExternalRoomPage.tsx`;
  - `apps/hub/app/api/chronos/public/rooms/[roomSlug]/livekit-presence/route.ts`;
  - `docs/operations/engineering-operations.md`;
  - `docs/operations/panteon-recorte-protocols.md`.
- Implementacao:
  - RoomService `ListParticipants` passa a expor participantes LiveKit nao-Egress;
  - nova rota `livekit-presence` confirma `meetingId`, `participantId`, `participantIdentity` e `roomName`;
  - servidor persiste metadados `liveKit` no participante e `externalRoom.liveKitPresence` na reuniao;
  - frontend so executa `setLocalParticipant`/`setMeetingId` depois da confirmacao; falha desconecta a sala e exibe erro.
- Validacoes executadas:
  - `npm.cmd exec --workspace @repo/hub -- eslint modules/chronos/ChronosExternalRoomPage.tsx lib/chronos/livekit.ts lib/chronos/server.ts app/api/chronos/public/rooms/[roomSlug]/livekit-presence/route.ts --max-warnings 0`: PASS;
  - `npm.cmd run check-types --workspace @repo/hub`: PASS;
  - `npm.cmd run build --workspace @repo/hub`: PASS, com warning conhecido Turbopack/NFT fora do recorte.
- Fora do escopo:
  - sem deploy, Preview, homologacao, producao, Vercel remoto mutavel, Supabase remoto, banco, migration, storage remoto, dominio, alias, env ou secret;
  - auditoria de valores `LIVEKIT_*`/Supabase em Production permanece bloqueada ate autorizacao explicita.
- Rollback:
  - remover a chamada `livekit-presence` do frontend;
  - remover a rota `livekit-presence`;
  - reverter as adicoes de listagem/confirmacao LiveKit em `livekit.ts` e `server.ts`.

## OP-20260610-023-CHRONOS-EGRESS-CLOSE-FAILSAFE

- Status: VALIDADO LOCALMENTE / PRODUCAO BLOQUEADA ATE AUTORIZACAO DO LUCAS.
- Modulo dono: Chronos.
- Origem:
  - Lucas reportou em 2026-06-10 que a chamada fechou, mas o video nao apareceu no Drive apos varios minutos;
  - LiveKit mostrou sessao fechada com RoomComposite em `STARTING` e Track em `ACTIVE`, indicando Egress preso antes do arquivo final.
- Objetivo:
  - impedir que o fechamento da chamada delete a sala LiveKit antes de tentar finalizar/sincronizar os Egresses pendentes;
  - reduzir dependencia dos IDs de Egress mantidos apenas na memoria do navegador.
- Arquivos incluidos:
  - `apps/hub/lib/chronos/server.ts`;
  - `apps/hub/modules/chronos/ChronosRecordingViewPage.tsx`;
  - `docs/operations/engineering-operations.md`;
  - `docs/operations/panteon-recorte-protocols.md`.
- Implementacao:
  - `/close` passa a chamar um fail-safe que tenta parar ou sincronizar o Egress pendente antes de deletar a sala LiveKit;
  - `stop` e `sync` hidratam refs de gravacao usando `metadata.externalRoom` e linhas de `chronos_recordings`;
  - a view customizada de RoomComposite aceita aliases de parametros e emite `START_RECORDING` por fallback curto quando a conexao nao falha, evitando `STARTING` indefinido por atraso de evento.
- Validacoes executadas:
  - `npm.cmd exec --workspace @repo/hub -- eslint lib/chronos/server.ts modules/chronos/ChronosRecordingViewPage.tsx --max-warnings 0`: PASS;
  - `npm.cmd run check-types --workspace @repo/hub`: PASS;
  - `npm.cmd run build --workspace @repo/hub`: PASS, com warning conhecido Turbopack/NFT fora do recorte;
  - `git diff --check -- apps/hub/lib/chronos/server.ts apps/hub/modules/chronos/ChronosRecordingViewPage.tsx`: PASS, com avisos esperados de LF/CRLF no Windows.
- Fora do escopo:
  - sem deploy, Preview, homologacao, producao, Vercel remoto mutavel, Supabase remoto, banco, migration, storage remoto, dominio, alias, env ou secret;
  - sem intervencao manual no Egress preso em producao.
- Rollback:
  - remover `finalizeChronosLiveKitEgressBeforeClose` e helpers associados em `server.ts`;
  - restaurar `stop`/`sync` para depender apenas do payload enviado pelo navegador;
  - remover aliases/fallback de `START_RECORDING` da `ChronosRecordingViewPage`.
