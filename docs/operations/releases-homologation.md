# Releases Homologacao

Este arquivo e o indice operacional dos recortes publicados em homologacao.
Ele nao substitui o diario canonico `docs/operations/engineering-operations.md`.

Objetivo:

- registrar somente o que foi publicado ou preparado para homologacao;
- separar recortes por modulo/agente;
- deixar claro o que esta em teste, homologado, bloqueado ou pronto para producao;
- fornecer referencia objetiva para `Hefesto` antes de qualquer promocao para producao.

## Regras

- Registrar apenas recortes de homologacao.
- Nao registrar valores de env, secrets, tokens, senhas, service role, `POSTGRES_URL` ou chaves externas.
- Nao misturar modulos no mesmo registro sem justificativa operacional explicita.
- Se o recorte depender de env, chave, migration, dominio, alias ou banco, marcar como `BLOQUEADO` ate autorizacao explicita do Lucas.
- O diario canonico continua recebendo o resumo consolidado da decisao, risco ou deploy relevante.
- `Hefesto` so deve considerar para producao registros com status `HOMOLOGADO` ou `PRONTO PARA PRODUCAO`.

## Status permitidos

- `EM HOMOLOGACAO`
- `HOMOLOGADO`
- `PRONTO PARA PRODUCAO`
- `BLOQUEADO`
- `NECESSITA CORRECAO`
- `OPERACIONAL COM ATENCAO`

## Campos obrigatorios

- Assunto
- Modulo/agente
- Data e hora local
- Ambiente
- Origem
- Escopo do recorte
- Protocolos/atividades relacionados
- Commit de homologacao
- Deployment/alias de homologacao
- Arquivos/modulos afetados
- Validacoes executadas
- Healthchecks de homologacao
- Riscos conhecidos
- Pendencias
- Status
- Proxima acao

## Template

```text
Registro de homologacao:

- Assunto: `[Modulo] Tema objetivo`.
- Modulo/agente: `<Iris Core / Hermes Core / Hades Core / Zeus Core / Atlas Core / Chronos Core / Setup / outro>`.
- Data e hora local: `YYYY-MM-DD HH:mm:ss -03:00`.
- Ambiente: `homologacao`.
- Origem: `<pedido do Lucas / protocolo / commit / incidente / correcao>`.
- Escopo do recorte:
  - `<alteracao principal 1>`;
  - `<alteracao principal 2>`;
  - `<alteracao principal 3>`.
- Protocolos/atividades relacionados: `<AT/CB/TI/OP/AL/DP ou n/a>`.
- Commit de homologacao: `<hash ou n/a se ainda nao commitado>`.
- Deployment/alias de homologacao: `<deployment Vercel / alias / URL tecnica>`.
- Arquivos/modulos afetados: `<lista objetiva>`.
- Validacoes executadas:
  - `<check-types/lint/build/smoke/validacao visual>`;
  - `<resultado objetivo>`.
- Healthchecks de homologacao:
  - `<endpoint/rota>: <resultado esperado/recebido>`.
- Riscos conhecidos: `<riscos tecnicos, operacionais ou de negocio>`.
- Pendencias: `<o que falta para aprovar ou promover>`.
- Status: `<EM HOMOLOGACAO | HOMOLOGADO | PRONTO PARA PRODUCAO | BLOQUEADO | NECESSITA CORRECAO | OPERACIONAL COM ATENCAO>`.
- Proxima acao: `<Lucas validar / modulo corrigir / Hefesto promover producao / DataOps/Zeus atuar>`.
```

## Registros

Novos registros devem ser adicionados abaixo, do mais recente para o mais antigo ou em ordem cronologica consistente por rodada. Nao apagar historico.

Registro de homologacao:

- Assunto: `[Iris] Homologacao restaurada apos deploy sem env Meta`.
- Modulo/agente: `Iris Core / Hefesto assistido`.
- Data e hora local: `2026-05-20 20:37:13 -03:00`.
- Ambiente: `homologacao`.
- Origem: incidente durante tentativa de publicar o recorte UX da Iris em homologacao; o Preview gerado nao carregou as envs Meta branch-specific necessarias.
- Escopo do recorte:
  - registrar que a tentativa de publicar a UX da Iris nao ficou vigente em homologacao;
  - restaurar o alias `https://homo.c2x.app.br` para o deployment funcional anterior;
  - preservar inbound/outbound Iris ja configurado com Meta;
  - manter producao intocada.
- Protocolos/atividades relacionados: `IRIS-HOMOLOG-ROLLBACK-20260520`.
- Commit de homologacao: `n/a - tentativa de Preview e rollback de alias; sem commit final publicado para UX`.
- Deployment/alias de homologacao: alias restaurado para `dpl_8JRthzASvxdxPFx7aHngZT18Ev4i`; tentativas afetadas `dpl_EEpkkUjs3vw7MKwFcyX1a3teSNZd` e `dpl_UpC4wKgzEmEDDHxamC25WCVnHnUg`.
- Arquivos/modulos afetados: alias `https://homo.c2x.app.br`, modulo Iris, `docs/operations/releases-homologation.md` e diario canonico.
- Validacoes executadas:
  - `vercel inspect https://homo.c2x.app.br` confirmou retorno ao deployment `dpl_8JRthzASvxdxPFx7aHngZT18Ev4i`;
  - `GET https://homo.c2x.app.br/iris` retornou `200 OK`;
  - `GET /api/iris/meta/webhook` sem challenge retornou `403 Forbidden` esperado;
  - `POST /api/iris/meta/messages` sem sessao retornou `401 Unauthorized` esperado;
  - arquivo temporario `.vercel/.env.preview.local` removido sem registrar valores sensiveis.
- Healthchecks de homologacao:
  - `/iris`: `200 OK`;
  - `/api/iris/meta/webhook`: `403 Forbidden` esperado sem challenge;
  - `/api/iris/meta/messages`: `401 Unauthorized` esperado sem sessao.
- Riscos conhecidos: a UX da Iris continua nao publicada em homologacao; nova tentativa deve preservar o runtime com envs Meta corretas, preferencialmente via branch/commit limpo ou estrategia Vercel confirmada.
- Pendencias: Iris Core preparar novo pacote limpo de homologacao para UX sem perder envs Meta; Lucas validar que o ambiente restaurado segue operacional.
- Status: `OPERACIONAL COM ATENCAO`.
- Proxima acao: Iris Core refazer estrategia de publicacao em homologacao antes de novo deploy; Hefesto/Zeus devem bloquear qualquer pacote que gere Preview sem as envs Meta necessarias.

Registro de homologacao:

- Assunto: `[Panteon] Iris sempre visivel no sidebar`.
- Modulo/agente: `Zeus`.
- Data e hora local: `2026-05-20 20:31:57 -03:00`.
- Ambiente: `homologacao (recorte preparado localmente; publicacao pendente de autorizacao Lucas)`.
- Origem: Lucas informou que a Iris nao aparecia no sidebar de homologacao e pediu remover a camada que ocultava o modulo.
- Escopo do recorte:
  - remover a regra local que escondia a Iris por ambiente;
  - deixar visibilidade depender do registry/permissoes, nao de lista fixa;
  - preservar demais modulos e regras de producao/homologacao.
- Protocolos/atividades relacionados: `PANTEON-SIDEBAR-IRIS-20260520`.
- Commit de homologacao: `n/a - recorte local validado; sem commit/deploy de homologacao`.
- Deployment/alias de homologacao: `n/a - publicacao ainda nao executada`.
- Arquivos/modulos afetados: `apps/hub/layouts/hub-shell.tsx`.
- Validacoes executadas:
  - `rg hiddenProductionModuleIds|isVisibleInCurrentEnvironment apps/hub/layouts/hub-shell.tsx` nao encontrou mais a regra;
  - `git diff --check -- apps/hub/layouts/hub-shell.tsx docs/operations/engineering-operations.md` passou com avisos LF/CRLF conhecidos;
  - `npm.cmd run check-types:hub`, `npm.cmd run lint:hub` e `npm.cmd run build --workspace @repo/hub` passaram;
  - smoke local `GET http://127.0.0.1:3001/iris` retornou `200 OK`.
- Healthchecks de homologacao:
  - `n/a - nao houve deploy/alias de homologacao nesta etapa`.
- Riscos conhecidos: se publicado junto com outros recortes locais, pode sobrescrever entregas paralelas; deve ser empacotado isoladamente.
- Pendencias: Lucas autorizar publicacao em homologacao; Zeus publicar somente este hotfix de sidebar em pacote limpo.
- Status: `BLOQUEADO`.
- Proxima acao: Zeus preparar pacote limpo para `https://homo.c2x.app.br` quando Lucas autorizar.

Registro de homologacao:

- Assunto: `[Apolo] UX CRM e sidebar Panteon local`.
- Modulo/agente: `Apolo Core`.
- Data e hora local: `2026-05-20 20:04:06 -03:00`.
- Ambiente: `homologacao (recorte preparado localmente; smoke em homologacao ainda pendente)`.
- Origem: ajustes locais de UX CRM central, leitura por tabelas Apolo, retorno do sidebar global Panteon e reativacao de dados no localhost.
- Escopo do recorte:
  - reorganizar Apolo em `Dashboard`, `CRM` e `Relatorios`;
  - concentrar busca forte e detalhe 360 em composicao mais proxima do Hades/Panteon;
  - restaurar o sidebar global do Panteon na rota `/apolo`;
  - manter fallback C2X apenas em desenvolvimento local enquanto homologacao usa tabelas `apolo_*`.
- Protocolos/atividades relacionados: `APOLO-CRM-UX-20260520`.
- Commit de homologacao: `n/a - recorte local validado; sem commit/deploy de homologacao`.
- Deployment/alias de homologacao: `n/a - publicacao em homologacao ainda nao executada`.
- Arquivos/modulos afetados: `apps/hub/app/apolo/page.tsx`, `apps/hub/modules/apolo/ApoloPage.tsx`, `apps/hub/lib/apolo/catalog.ts`, `apps/hub/lib/apolo/server.ts`.
- Validacoes executadas:
  - `npm.cmd run check-types:hub`, `npm.cmd run lint:hub` e `npm.cmd run build --workspace @repo/hub` passaram;
  - `GET http://127.0.0.1:3001/apolo` retornou `200 OK`;
  - `GET http://127.0.0.1:3001/api/apolo/relationships` retornou `200 OK` com dados reais via fallback local de desenvolvimento.
- Healthchecks de homologacao:
  - `n/a - nao houve deploy/alias de homologacao nesta etapa`.
- Riscos conhecidos: homologacao precisa apontar para ambiente com tabelas `apolo_*` sincronizadas; fallback C2X e somente local/desenvolvimento; qualquer deploy deve ser isolado para nao misturar Iris/Zeus/Hermes.
- Pendencias: smoke visual em homologacao com `source=apolo`; commit/deploy de homologacao em pacote limpo quando Lucas autorizar.
- Status: `BLOQUEADO`.
- Proxima acao: Apolo Core preparar pacote limpo e validar em `https://homo.c2x.app.br/apolo` somente apos autorizacao.

Registro de homologacao:

- Assunto: `[Iris] Ajustes UX conversa e baloes locais`.
- Modulo/agente: `Iris Core`.
- Data e hora local: `2026-05-20 19:16:55 -03:00`.
- Ambiente: `homologacao (recorte preparado localmente; publicacao pendente de autorizacao Lucas)`.
- Origem: Lucas pediu diferenciar melhor lista lateral/conversa, fechar seletor de emojis ao clicar fora e aproximar os baloes dos cantos da area de atendimento.
- Escopo do recorte:
  - diferenciar visualmente inbox lateral e painel de conversa;
  - trocar seletor de emojis para popover com fechamento por clique externo/Escape;
  - ajustar alinhamento dos baloes para usar a largura real da conversa;
  - preservar envio Meta e dados reais fora do escopo.
- Protocolos/atividades relacionados: `IRIS-UX-CONVERSA-20260520`.
- Commit de homologacao: `n/a - recorte local validado parcialmente; sem commit/deploy de homologacao`.
- Deployment/alias de homologacao: `n/a - publicacao ainda nao executada`.
- Arquivos/modulos afetados: `apps/hub/modules/caredesk/IrisPage.tsx`.
- Validacoes executadas:
  - `npx.cmd eslint modules/caredesk/IrisPage.tsx --max-warnings 0` passou no escopo isolado;
  - `git diff --check -- apps/hub/modules/caredesk/IrisPage.tsx` passou com aviso CRLF conhecido;
  - validacao global anterior ficou bloqueada por erros fora do recorte no Apolo; validacao visual autenticada ainda pendente.
- Healthchecks de homologacao:
  - `n/a - nao houve deploy/alias de homologacao nesta etapa`.
- Riscos conhecidos: recorte UX da Iris ja causou tentativa de Preview sem env Meta quando empacotado incorretamente; nova publicacao deve preservar branch/env corretas e nao alterar tokens.
- Pendencias: corrigir/contornar bloqueios globais fora da Iris, validar visualmente e publicar em homologacao apenas com pacote limpo autorizado.
- Status: `BLOQUEADO`.
- Proxima acao: Iris Core refazer pacote de homologacao com runtime Meta preservado; Lucas autorizar nova tentativa.

Registro de homologacao:

- Assunto: `[Apolo] Sync inicial C2X para cadastro mestre`.
- Modulo/agente: `Apolo Core`.
- Data e hora local: `2026-05-20 17:23:21 -03:00`.
- Ambiente: `homologacao`.
- Origem: Lucas confirmou usar homologacao como alvo e ja havia aplicado manualmente a SQL da migration Apolo no SQL Editor do Supabase.
- Escopo do recorte:
  - aplicar o sync inicial C2X -> Apolo sem escrita no C2X;
  - popular as tabelas centrais `apolo_*` de homologacao;
  - validar que a API local apontada para homologacao passa a ler fonte `apolo`.
- Protocolos/atividades relacionados: `OP-20260520-1723-APOLO-HOMOLOG-SYNC`.
- Commit de homologacao: `n/a - operacao de banco homologacao e recorte local ainda nao commitado`.
- Deployment/alias de homologacao: `n/a - sem deploy Vercel nesta etapa`.
- Arquivos/modulos afetados: `scripts/apolo-sync-c2x.mjs`, `apps/hub/lib/apolo/server.ts`, `packages/database/migrations/0026_apolo_core.sql`, `docs/operations/releases-homologation.md` e diario canonico.
- Validacoes executadas:
  - sync executado em homologacao com `rowsScanned=3927`, `rowsWritten=50958`, `status=completed`;
  - contagens agregadas confirmaram `apolo_entities=3927`, `apolo_entity_profiles=7854`, `apolo_entity_identifiers=11775`, `apolo_contacts=4019`, `apolo_addresses=3846`, `apolo_relationships=3829`, `apolo_module_records=3927`, `apolo_commercial_links=3927`, `apolo_source_links=3927` e `apolo_search_entries=3927`;
  - perfis agregados confirmaram `usuario=3431`, `incorporador=21`, `imobiliaria=374`, `corretor=24`, `colaborador=73`, `pessoa_fisica=3448`, `pessoa_juridica=479` e `acesso_incorporador=4`;
  - `npm.cmd run check-types:hub`, `npm.cmd run lint:hub`, `npm.cmd run build --workspace @repo/hub`, `node --check scripts/apolo-sync-c2x.mjs` e `git diff --check` do recorte passaram.
- Healthchecks de homologacao:
  - smoke local com envs de homologacao: `GET /apolo` HTTP 200;
  - smoke local com envs de homologacao: `GET /api/apolo/relationships` HTTP 200, `source=apolo`, `totalCount=3927`, `entitiesReturned=120`, `profileSummaries=7`.
- Riscos conhecidos: houve um run anterior falho e auditavel por duplicidade em lote antes do ajuste de deduplicacao; o run final ficou `completed`. O recorte ainda nao foi publicado no alias `https://homo.c2x.app.br`, portanto a validacao foi local apontada para o banco de homologacao.
- Pendencias: publicar o recorte Apolo em homologacao quando Lucas autorizar deploy/commit; validar visualmente autenticado; decidir cadencia de sync incremental e depois iniciar consumo por Hades/Iris/Chronos/Zeus em recortes pequenos.
- Status: `EM HOMOLOGACAO`.
- Proxima acao: `Lucas` validar o Apolo com dados de homologacao; `Apolo Core` preparar publicacao do recorte em homologacao quando autorizado.

Registro de homologacao:

- Assunto: `[Hermes] Painel de respostas e popups solidos`.
- Modulo/agente: `Hermes Core`.
- Data e hora local: `2026-05-20 13:56:43 -03:00`.
- Ambiente: `homologacao (recorte preparado localmente; aprovado por Lucas em 2026-05-20 14:32:54 -03:00; correcao incremental validada por Lucas em 2026-05-20 15:01:53 -03:00; icones de interacao nas respostas validados por Lucas em 2026-05-20 15:30:23 -03:00; publicacao/deploy ainda nao executado nesta etapa)`.
- Origem: Lucas reportou em producao que o painel de respostas continuava pequeno e que o seletor de reacoes ainda sobrepunha a bolha da mensagem.
- Escopo do recorte:
  - ampliar a janela lateral de respostas do Hermes;
  - deixar popups, menus e painel de informacoes com fundo 100% solido;
  - ajustar a hierarquia visual do seletor de reacoes para nao cobrir o texto da mensagem;
  - remover os tooltips dos botoes de acao da mensagem para evitar baloes visuais sobre a conversa;
  - corrigir quebra de textos/links longos no painel de respostas para nao cortar a mensagem;
  - remover o botao de resposta da mensagem raiz dentro do painel de respostas, mantendo reagir, tag e informacoes;
  - habilitar a acao de tag da mensagem raiz no painel de respostas;
  - exibir os icones de interacao tambem nas respostas da thread, reaproveitando o mesmo componente de mensagem do Hermes.
- Protocolos/atividades relacionados: `Hermes / Threads / Reacoes`.
- Commit de homologacao: `n/a - recorte local validado; sem commit/deploy de homologacao`.
- Deployment/alias de homologacao: `n/a - publicacao em homologacao ainda nao autorizada`.
- Arquivos/modulos afetados: `apps/hub/components/pulsex/pulsex-workspace.tsx`, `apps/hub/components/pulsex/message-item.tsx`, `apps/hub/components/pulsex/thread-panel.tsx`, `apps/hub/lib/pulsex/types.ts`, `apps/hub/lib/pulsex/supabase-data.ts`, `apps/hub/lib/pulsex/mock-data.ts` e diario canonico.
- Validacoes executadas:
  - `npm.cmd run check-types:hub` passou;
  - `npm.cmd run lint:hub` passou com warning conhecido de `eslint.config.js` typeless;
  - `npm.cmd run build --workspace @repo/hub` passou com warning conhecido Turbopack/NFT em `engineering-operations-source.ts`;
  - `git diff --check -- apps/hub/components/pulsex/message-item.tsx apps/hub/components/pulsex/pulsex-workspace.tsx` passou com avisos CRLF conhecidos;
  - smoke local temporario em `/hermes` retornou HTTP 200;
  - validacao incremental da remocao dos tooltips: `npm.cmd run check-types:hub`, `npm.cmd run lint:hub`, `npm.cmd run build --workspace @repo/hub` e `git diff --check -- apps/hub/components/pulsex/message-item.tsx docs/operations/releases-homologation.md` passaram;
  - validacao incremental da correcao de corte/acoes da thread: `npm.cmd run check-types:hub`, `npm.cmd run lint:hub`, `npm.cmd run build --workspace @repo/hub` e `git diff --check -- apps/hub/components/pulsex/message-item.tsx apps/hub/components/pulsex/thread-panel.tsx apps/hub/components/pulsex/pulsex-workspace.tsx` passaram;
  - validacao incremental dos icones de interacao nas respostas: `npm.cmd run check-types:hub`, `npm.cmd run lint:hub`, `npm.cmd run build --workspace @repo/hub` e `git diff --check -- apps/hub/lib/pulsex/types.ts apps/hub/lib/pulsex/supabase-data.ts apps/hub/lib/pulsex/mock-data.ts apps/hub/components/pulsex/thread-panel.tsx apps/hub/components/pulsex/pulsex-workspace.tsx` passaram.
- Healthchecks de homologacao:
  - `n/a - nao houve deploy/alias de homologacao nesta etapa`.
- Aprovacao: Lucas informou `esta aprovado` em 2026-05-20 14:32:54 -03:00, `validado` em 2026-05-20 15:01:53 -03:00 e novo `validado` em 2026-05-20 15:30:23 -03:00, validando tambem os icones de interacao nas respostas da thread.
- Riscos conhecidos: o ajuste ainda nao foi publicado por novo deploy em `https://homo.c2x.app.br`; Hefesto deve promover somente por pacote limpo, contendo os arquivos Hermes deste recorte, e bloquear qualquer mistura com outros modulos/recortes locais. O worktree principal contem recortes misturados e nao deve ser usado para deploy geral.
- Pendencias: Hefesto preparar pacote limpo, executar build/healthchecks, inspecionar `https://c2x.app.br` e `https://ops.c2x.app.br` antes/depois se houver producao, e registrar o resultado em producao.
- Status: `PRONTO PARA PRODUCAO`.
- Proxima acao: `Hefesto` pode considerar este recorte Hermes para producao somente em pacote limpo e rastreado; se optar por homologacao intermediaria, publicar apenas estes arquivos e registrar o deployment antes de promover.

Registro de homologacao:

- Assunto: `[Iris] Token Meta atualizado em homologacao`.
- Modulo/agente: `Iris Core`.
- Data e hora local: `2026-05-20 13:02:05 -03:00`.
- Ambiente: `homologacao`.
- Origem: Lucas gerou novo token Meta apos aprovar o destinatario de teste e autorizou atualizar o runtime de homologacao.
- Escopo do recorte:
  - atualizar `META_WHATSAPP_ACCESS_TOKEN` no Vercel Preview/homolog sem expor valor;
  - redeployar `https://homo.c2x.app.br` para carregar o token novo;
  - validar que a Iris continua online e que o endpoint de webhook mantém comportamento esperado.
- Protocolos/atividades relacionados: `AT-000001 / Iris Meta WhatsApp`.
- Commit de homologacao: `n/a - operacao de env/redeploy autorizada; sem alteracao de codigo`.
- Deployment/alias de homologacao: `dpl_BeH636FcaUK35icxoUcGmusue8BS`; URL tecnica `https://careli-hub-hub-i2bs-3yy4pw6ri-lucasruas-devs-projects.vercel.app`; alias `https://homo.c2x.app.br`.
- Arquivos/modulos afetados: Vercel Preview env `META_WHATSAPP_ACCESS_TOKEN`, alias `https://homo.c2x.app.br`, `docs/operations/releases-homologation.md` e diario canonico.
- Validacoes executadas:
  - script seguro `.codex-artifacts/iris-meta-refresh-access-token.ps1` detectou token na area de transferencia, atualizou a env de Preview/homolog e limpou a area de transferencia sem imprimir o valor;
  - `vercel redeploy https://homo.c2x.app.br --target preview` concluiu `Ready`;
  - `vercel inspect https://homo.c2x.app.br` confirmou deployment `Ready` no alias de homologacao;
  - `GET /iris` retornou `200`;
  - `GET /api/iris/meta/webhook` sem challenge retornou `403` esperado;
  - `vercel logs --level error --since 5m` nao retornou erros.
- Healthchecks de homologacao:
  - `https://homo.c2x.app.br/iris`: `200`;
  - `https://homo.c2x.app.br/api/iris/meta/webhook` sem challenge: `403` esperado;
  - logs recentes de erro: sem ocorrencias.
- Riscos conhecidos: token Meta temporario pode expirar; envio outbound real ainda precisa de smoke autenticado pelo Lucas na Iris para confirmar que a Meta deixou de retornar `131030`.
- Pendencias: Lucas enviar nova mensagem pela Iris e confirmar chegada no WhatsApp e evolucao dos checks.
- Status: `EM HOMOLOGACAO`.
- Proxima acao: Lucas testar envio outbound real pela Iris; Iris Core acompanha logs e registra resultado.

Registro de homologacao:

- Assunto: `[Iris] Envio outbound bloqueado por lista de destinatarios Meta`.
- Modulo/agente: `Iris Core`.
- Data e hora local: `2026-05-20 12:45:45 -03:00`.
- Ambiente: `homologacao`.
- Origem: erro reportado pelo Lucas na tela Iris ao responder pelo WhatsApp em `https://homo.c2x.app.br/iris`.
- Escopo do recorte:
  - investigar erro `(#131030) Recipient phone number not in allowed list` no envio outbound;
  - confirmar se a rota Iris chegou a chamar a Meta Cloud API;
  - orientar desbloqueio operacional no painel Meta sem alterar envs, secrets, banco, migration ou producao.
- Protocolos/atividades relacionados: `AT-000001 / Iris Meta WhatsApp`.
- Commit de homologacao: `n/a - investigacao operacional; sem alteracao de codigo`.
- Deployment/alias de homologacao: `dpl_GLKNpDvt5EqvwxdKtj4t2EGiegsf`; alias `https://homo.c2x.app.br`.
- Arquivos/modulos afetados: `apps/hub/app/api/iris/meta/messages/route.ts`, `apps/hub/lib/iris/meta-whatsapp.ts`, `docs/operations/releases-homologation.md` e diario canonico.
- Validacoes executadas:
  - `vercel logs https://homo.c2x.app.br --since 45m --query "131030"` nao encontrou log textual com o codigo;
  - `vercel logs https://homo.c2x.app.br --since 45m --query "iris/meta/messages"` confirmou duas chamadas `POST /api/iris/meta/messages` com status `400`;
  - `vercel logs https://homo.c2x.app.br --since 45m --level error` nao retornou erro de runtime;
  - leitura da rota confirmou que erros da Meta sao repassados para a UI e marcam a mensagem local como `failed`.
- Healthchecks de homologacao:
  - `vercel inspect https://homo.c2x.app.br`: deployment `Ready`;
  - logs da rota de envio: `400` controlado, sem `5xx`.
- Riscos conhecidos: app/numero Meta em modo teste so permite envio para destinatarios adicionados/verificados na lista permitida; enquanto o destinatario nao estiver liberado, o recebimento inbound pode funcionar, mas a resposta outbound sera rejeitada pela Meta.
- Pendencias: Lucas adicionar/verificar o numero de teste no painel Meta em `Configuracao da API` antes de novo envio outbound pela Iris; nenhuma alteracao de env deve ser feita para este erro.
- Status: `BLOQUEADO`.
- Proxima acao: Lucas liberar o destinatario de teste na Meta; depois Iris Core retesta envio pela tela e valida evolucao dos checks.

Registro de homologacao:

- Assunto: `[Hefesto] Carga inicial dos recortes em homologacao`.
- Modulo/agente: `Hefesto`.
- Data e hora local: `2026-05-20 12:35:59 -03:00`.
- Ambiente: `homologacao`.
- Origem: revisao retroativa do diario canonico apos criacao dos indices `releases-homologation.md` e `releases-production.md`.
- Escopo do recorte:
  - consolidar os recortes recentes efetivamente publicados em `https://homo.c2x.app.br`;
  - separar homologacao de producao para reduzir sujeira no diario consolidado;
  - deixar `Hefesto` com referencia objetiva antes de qualquer promocao futura.
- Protocolos/atividades relacionados: `DP-20260520-0220-PANTEON-HOMOLOG`, recortes Iris/Meta, PWA/Panteon, Zeus/Ticket TI e Atlas.
- Commit de homologacao: multiplos commits; principais `a264bb9`, `63138a7`, `f74309f`, `fdb4d95`, `f9376c2`, `7dac954`, `8239eb4`, `6476dc7`; Atlas possui correcao operacional de banco/env/deploy sem commit Git limpo final.
- Deployment/alias de homologacao: alias principal `https://homo.c2x.app.br`; deployments relevantes `dpl_5sFd6djTk8bahG9P31u3pXvEceSD`, `dpl_DUiQaazPSPr5P5yNZqkgdNM3SS6z`, `dpl_Ef59UFw6zR6VvJddSXEaPBs36bFB`, `dpl_Az2Hrhd4ugWci4RegMLw5TW2JVoy`, `dpl_Bavi4yFRA2qChmvRE5knaQnGoTG3`, `dpl_H41f1MvDLVYod2ZiVdRuxbvB73Vs`, `dpl_BpkZ1bDLAH9QG8UnHq7N1b8ZhJX6`, `dpl_5yad3dxA4xwKCuz4PimMgQLS6hNT`, `dpl_5dme1YjBKHhSJQKRCagoMFGPP7S3` e `dpl_EFs6HhmbFxJqjfnGTHUkR5Aotm3W`.
- Arquivos/modulos afetados: `Panteon`, `Iris`, `Zeus`, `Atlas`, `Setup`, `Hermes`, `Hades`, PWA, rotas Meta/WhatsApp, Ticket TI/HelpDesk e documentos operacionais.
- Validacoes executadas:
  - registros-fonte revisados em `docs/operations/engineering-operations.md`;
  - publicacoes citadas tiveram, conforme cada registro, `git diff --check`, `npm.cmd run check-types:hub`, `npm.cmd run lint:hub`, `npm.cmd run build --workspace @repo/hub`, `vercel inspect`, smokes HTTP e logs Vercel;
  - nenhuma promocao de producao foi feita nesta carga documental.
- Healthchecks de homologacao:
  - `GET /`, `/login`, `/hades`, `/guardian`, `/hermes`, `/pulsex`, `/iris`, `/caredesk`, `/atlas`, `/setup`, `/zeus` e `/squadops`: registrados como `200` nos recortes de homologacao consolidados;
  - `/api/hades/db/health` e `/api/guardian/db/health`: registrados como `200`;
  - `/api/iris/meta/webhook` sem challenge: `403` esperado;
  - rotas protegidas sem sessao: `401` esperado.
- Riscos conhecidos: Iris/Meta segue em homologacao com dependencia de token Meta valido e smoke real; Atlas teve env server-side ajustada em Preview generico e precisa revisao futura de estrategia; PWA depende de criterios do Chrome/Edge; Ticket TI/Zeus requer validacao autenticada; worktree principal segue misturado.
- Pendencias: Lucas validar Iris, Atlas, PWA e Ticket TI em homologacao; agentes de modulo devem transformar aprovacao em status `PRONTO PARA PRODUCAO` antes de qualquer promocao; `Hefesto` deve bloquear recortes misturados.
- Status: `EM HOMOLOGACAO`.
- Proxima acao: Lucas validar os recortes em homologacao; depois `Hefesto` avalia apenas o que estiver aprovado e registrado como pronto para producao.

Registro de homologacao:

- Assunto: `[Iris] Meta WhatsApp em homologacao`.
- Modulo/agente: `Iris Core / Hefesto assistido`.
- Data e hora local: `2026-05-20 12:21:18 -03:00`.
- Ambiente: `homologacao`.
- Origem: sequencia de recortes Iris/Meta registrados no diario canonico entre 2026-05-20 01:37 e 12:21.
- Escopo do recorte:
  - liberar e validar webhook Meta em homologacao;
  - receber status e mensagem inbound real;
  - publicar painel de envio manual e atendimento realtime;
  - corrigir envio outbound pela Meta, recuperacao de mensagens locais e auto-scroll da conversa.
- Protocolos/atividades relacionados: `AT/Iris Meta WhatsApp`.
- Commit de homologacao: principais `63138a7`, `f9376c2`, `7dac954`, `8239eb4`, `6476dc7`; operacoes de env/redeploy foram autorizadas e registradas sem expor valores.
- Deployment/alias de homologacao: `https://homo.c2x.app.br`; deployments principais `dpl_DUiQaazPSPr5P5yNZqkgdNM3SS6z`, `dpl_Bavi4yFRA2qChmvRE5knaQnGoTG3`, `dpl_H41f1MvDLVYod2ZiVdRuxbvB73Vs`, `dpl_BpkZ1bDLAH9QG8UnHq7N1b8ZhJX6`, `dpl_5yad3dxA4xwKCuz4PimMgQLS6hNT` e `dpl_5dme1YjBKHhSJQKRCagoMFGPP7S3`.
- Arquivos/modulos afetados: `apps/hub/modules/caredesk/IrisPage.tsx`, `apps/hub/app/api/iris/meta/*`, `apps/hub/lib/iris/*`, rotas legadas `apps/hub/app/api/caredesk/meta/*` e documentacao Iris/Meta.
- Validacoes executadas:
  - `check-types`, `lint`, `build` e `git diff --check` passaram nos recortes publicados;
  - webhook Meta respondeu `200` ao challenge correto, `403` para token errado e `401` para POST com assinatura invalida;
  - eventos `status:sent`, `status:delivered` e `message:text` foram confirmados por metadados operacionais sem expor payload sensivel.
- Healthchecks de homologacao:
  - `GET /iris`: `200`;
  - `GET /api/iris/meta/webhook` sem challenge: `403` esperado;
  - `GET /api/iris/meta/events` sem sessao: `401` esperado;
  - `POST /api/iris/meta/messages` sem sessao: `401` esperado.
- Riscos conhecidos: envio outbound ainda depende de token Meta valido e smoke real; Vercel SSO/protection foi desabilitado anteriormente para permitir webhook publico e deve ser reavaliado; token temporario Meta pode expirar; processamento final de contato/conversa/ticket ainda evolui por recortes.
- Pendencias: Lucas testar envio real pela Iris, chegada no WhatsApp e evolucao dos checks; Iris Core acompanhar logs; producao permanece fora do recorte.
- Status: `EM HOMOLOGACAO`.
- Proxima acao: Lucas validar smoke real; Iris Core corrige eventual retorno Meta; `Hefesto` so avalia producao em recorte separado se houver aprovacao explicita.

Registro de homologacao:

- Assunto: `[Zeus] Ticket TI publicado em homologacao`.
- Modulo/agente: `Zeus Core / Hefesto assistido`.
- Data e hora local: `2026-05-20 06:28:42 -03:00`.
- Ambiente: `homologacao`.
- Origem: Lucas autorizou subir as melhorias do Ticket TI/Athena em homologacao.
- Escopo do recorte:
  - data de entrega desejada no Ticket TI;
  - decisao de prazo por Zeus;
  - preservacao da gravacao Athena durante troca de tela;
  - fila Zeus com criticidade visual por vencimento.
- Protocolos/atividades relacionados: `TI / Zeus HelpDesk`.
- Commit de homologacao: `fdb4d95 feat(zeus): improve ticket capture and delivery dates`.
- Deployment/alias de homologacao: Vercel Preview Git `dpl_Az2Hrhd4ugWci4RegMLw5TW2JVoy`; alias `https://homo.c2x.app.br`; URL tecnica `https://careli-hub-hub-i2bs-grgu2upck-lucasruas-devs-projects.vercel.app`.
- Arquivos/modulos afetados: componentes `hub-support`, `athena-ticket-recording-provider`, `pulsex/athena-agent-panel`, `hub-it-tickets`, `HubItTicketsBoard`, `AiCopilotDrawer`, `hub-shell` e branch `homolog`.
- Validacoes executadas:
  - `npm.cmd run check-types:hub`, `npm.cmd run lint:hub`, `npm.cmd run build --workspace @repo/hub` e `git diff --check` passaram;
  - build remoto Vercel passou com warnings conhecidos;
  - logs remotos sem erros recentes.
- Healthchecks de homologacao:
  - `/`, `/login`, `/zeus`, `/iris`, `/hades`, `/hermes`, `/api/pwa/manifest` e `/api/hades/db/health`: `200`;
  - `/api/hub/it-tickets`, `/api/hub/it-tickets/evidence-analysis` e `/api/operations/monitoring` sem sessao: `401` esperado.
- Riscos conhecidos: projeto temporario criado em primeiro deploy nao foi usado e so deve ser limpo com autorizacao; tickets antigos sem `metadata.deliveryAgreement` continuam como `Sem data`; validacao autenticada do fluxo ainda depende do Lucas.
- Pendencias: Lucas validar abertura de Ticket TI, gravacao ao trocar de tela, data desejada e decisao de prazo.
- Status: `EM HOMOLOGACAO`.
- Proxima acao: Lucas validar; Zeus acompanha ajustes; `Hefesto` so promove se houver aprovacao.

Registro de homologacao:

- Assunto: `[Panteon] PWA publicado e corrigido em homologacao`.
- Modulo/agente: `Zeus / Hefesto assistido`.
- Data e hora local: `2026-05-20 04:58:12 -03:00`.
- Ambiente: `homologacao`.
- Origem: Lucas autorizou a primeira versao instalavel do Panteon e depois reportou que a opcao de instalar nao apareceu no Chrome.
- Escopo do recorte:
  - manifest instalavel do Panteon;
  - service worker minimo sem cache operacional;
  - botao discreto de instalacao quando o navegador permite;
  - correcao do alias homolog para manter `/api/pwa/manifest` e `/sw.js`.
- Protocolos/atividades relacionados: `Panteon/PWA`.
- Commit de homologacao: `f74309f feat(panteon): enable homologation pwa install`.
- Deployment/alias de homologacao: deployment final `dpl_Ef59UFw6zR6VvJddSXEaPBs36bFB`; alias `https://homo.c2x.app.br`; URL tecnica `https://careli-hub-hub-i2bs-l4bar9s70-lucasruas-devs-projects.vercel.app`.
- Arquivos/modulos afetados: `apps/hub/app/layout.tsx`, `apps/hub/app/api/pwa/manifest/route.ts`, `apps/hub/components/panteon-pwa-runtime.tsx`, `apps/hub/layouts/hub-shell.tsx`, `apps/hub/public/sw.js`.
- Validacoes executadas:
  - `git diff --check`, `check-types`, `lint` e `build` passaram;
  - `/api/pwa/manifest` apareceu no build e respondeu com manifest valido;
  - logs Vercel sem erros recentes.
- Healthchecks de homologacao:
  - `GET /iris`: `200` com link para `/api/pwa/manifest`;
  - `GET /api/pwa/manifest`: `200`, `name=Homo Panteon`, `display=standalone`, `start_url=/`, `theme_color=#101820`;
  - `GET /sw.js`: `200`.
- Riscos conhecidos: prompt de instalacao depende do Chrome/Edge recalcular instalabilidade; se o prompt tiver sido recusado, pode exigir nova aba/sessao; offline foi evitado por seguranca operacional.
- Pendencias: Lucas testar instalacao pelo Chrome/Edge em homologacao.
- Status: `EM HOMOLOGACAO`.
- Proxima acao: Lucas validar instalacao; `Hefesto` avalia producao apenas se aprovado.

Registro de homologacao:

- Assunto: `[Atlas] Dados e runtime restaurados em homologacao`.
- Modulo/agente: `Atlas Core / Hub DataOps assistido / Hefesto assistido`.
- Data e hora local: `2026-05-20 03:58:26 -03:00`.
- Ambiente: `homologacao`.
- Origem: Lucas reportou que `https://homo.c2x.app.br/atlas` subiu sem dados e depois continuou exibindo bloqueio de chave server-side; Lucas autorizou a correcao de banco/env/deploy em homologacao.
- Escopo do recorte:
  - aplicar a migration nao destrutiva `0023_atlas_core.sql` no Supabase de homologacao;
  - copiar os dados Atlas ja migrados no Hub para as tabelas `atlas_*` de homologacao por upsert idempotente;
  - corrigir o runtime Preview que servia `homo.c2x.app.br` para carregar chave server-side do Hub sem expor secret;
  - redeployar o alias de homologacao para validar leitura autenticada do Atlas.
- Protocolos/atividades relacionados: `n/a`.
- Commit de homologacao: `n/a - correcao operacional de banco/env/deploy; ajustes locais Atlas pendentes de recorte Git limpo`.
- Deployment/alias de homologacao: `dpl_EFs6HhmbFxJqjfnGTHUkR5Aotm3W`; alias `https://homo.c2x.app.br`; URL tecnica `https://careli-hub-hub-i2bs-adofzps38-lucasruas-devs-projects.vercel.app`.
- Arquivos/modulos afetados: `apps/hub/lib/atlas/server.ts`, `apps/hub/lib/supabase/server-config.ts`, `scripts/atlas-apply-schema.mjs`, `scripts/atlas-verify-migration.mjs`, `scripts/atlas-copy-hub-data.mjs`, `packages/database/migrations/0023_atlas_core.sql`, Supabase homologacao e Vercel Preview de homologacao.
- Validacoes executadas:
  - `node --check scripts/atlas-copy-hub-data.mjs`, `node --check scripts/atlas-apply-schema.mjs` e `node --check scripts/atlas-verify-migration.mjs` passaram;
  - migration `0023_atlas_core.sql` confirmou as 8 tabelas `atlas_*` em homologacao;
  - dry-run e apply da copia Hub-to-Hub concluiram com contagens esperadas;
  - verificacao Atlas confirmou 4 departamentos, 7 cargos, 9 colaboradores, 3 perfis de ocorrencia, 6 tipos de ocorrencia e 35 ocorrencias;
  - valores de cargos confirmados: soma `3682.00`, menor `78.00`, maior `1500.00`;
  - evidencias confirmadas: 31 ocorrencias com evidencia e 4 sem evidencia;
  - `npm.cmd run check-types:hub`, `npm.cmd run lint:hub` e `npm.cmd run build --workspace @repo/hub` passaram com warnings conhecidos.
- Healthchecks de homologacao:
  - `GET https://homo.c2x.app.br/atlas`: `200 OK`;
  - `GET /api/atlas/snapshot` sem sessao: `401 Unauthorized` esperado;
  - `/api/atlas/snapshot` autenticado nos logs remotos: `200`;
  - `PATCH /api/hub/presence` autenticado nos logs remotos: `200`;
  - `vercel inspect https://homo.c2x.app.br`: deployment `Ready` no alias de homologacao.
- Riscos conhecidos: a env server-side foi criada no `Preview` generico para cobrir deployments manuais do alias e deve ser revisada por `Hefesto/Hub InfraOps`; links de evidencia ainda apontam para URLs importadas do Atlas legado; copia fisica de evidencias para Storage Hub segue fora do recorte; regras de bonus, calculos de performance e escrita operacional seguem preservados e bloqueados ate validacao humana.
- Pendencias: Lucas validar visualmente a tela autenticada em homologacao; isolar os ajustes locais Atlas em recorte Git limpo antes de qualquer promocao; DataOps avaliar migracao fisica de evidencias se Lucas autorizar.
- Status: `EM HOMOLOGACAO`.
- Proxima acao: Lucas fazer refresh/validacao autenticada do Atlas; depois `Atlas Core`/`Hefesto` fecham recorte limpo para eventual promocao futura, sem incluir producao neste registro.

Registro de homologacao:

- Assunto: `[Hades] Logo principal do modulo`.
- Modulo/agente: `Hades Core`.
- Data e hora local: `2026-05-20 12:37:33 -03:00`.
- Ambiente: `homologacao (recorte preparado localmente; publicacao pendente de autorizacao Lucas)`.
- Origem: pedido do Lucas para trocar a logo principal do modulo apos a mudanca de Guardian para Hades; o sidebar local ja estava no padrao Hades e o ajuste pendente era alinhar o topo mobile ao mesmo simbolo.
- Escopo do recorte:
  - validar/preservar a identidade Hades no sidebar interno;
  - alinhar o topo mobile do modulo para usar o mesmo icone/nome Hades;
  - remover dependencia visual dos assets antigos `logoCbranca.png`, `logoiconbranca.png` e `logog.png` nesse recorte.
- Protocolos/atividades relacionados: `n/a`.
- Commit de homologacao: `n/a - recorte local validado; sem commit/deploy de homologacao`.
- Deployment/alias de homologacao: `n/a - publicacao nao autorizada nesta etapa`.
- Arquivos/modulos afetados: `apps/hub/components/guardian/layout/Sidebar.tsx`, `apps/hub/components/guardian/layout/Topbar.tsx`.
- Validacoes executadas:
  - `npm.cmd run check-types:hub` passou;
  - `npm.cmd run lint:hub` passou com warning conhecido de `eslint.config.js` typeless;
  - `npm.cmd run build --workspace @repo/hub` passou com warning conhecido Turbopack/NFT da leitura do Engineering Operations;
  - `git diff --check -- apps/hub/components/guardian/layout/Sidebar.tsx apps/hub/components/guardian/layout/Topbar.tsx` passou, com aviso CRLF conhecido;
  - smoke local com `next start` em `localhost:3018/hades` retornou `200` e nao encontrou referencias aos assets antigos de logo no HTML.
- Healthchecks de homologacao:
  - `n/a - nao houve deploy/alias de homologacao nesta etapa`.
- Riscos conhecidos: validacao visual autenticada ainda recomendada em homologacao antes de qualquer producao; o worktree principal possui outros recortes locais de outras frentes e nao deve ser publicado como pacote geral.
- Pendencias: Lucas autorizar publicacao em homologacao se quiser testar a nova identidade visual fora do ambiente local; Hefesto deve bloquear producao ate existir recorte homologado/aprovado.
- Status: `BLOQUEADO`.
- Proxima acao: Lucas autorizar ou nao a publicacao do recorte Hades em homologacao; depois Hades Core publica somente este recorte e atualiza o status.

Registro de homologacao:

- Assunto: `[Iris] Token permanente Meta aplicado`.
- Modulo/agente: `Iris Core`.
- Data e hora local: `2026-05-20 15:32:28 -03:00`.
- Ambiente: `homologacao`.
- Origem: Lucas criou o usuario de sistema `Iris Core`, atribuiu ativos WhatsApp/app no Business Manager e autorizou atualizar a env de homologacao para substituir token temporario da tela de teste Meta.
- Escopo do recorte:
  - atualizar `META_WHATSAPP_ACCESS_TOKEN` no Vercel Preview/homolog sem registrar valor sensivel;
  - redeployar o ultimo deployment homologado limpo para carregar a nova env;
  - preservar fora do deploy as alteracoes locais em andamento da UX WhatsApp da Iris.
- Protocolos/atividades relacionados: `n/a`.
- Commit de homologacao: `n/a - operacao de env/redeploy sobre deployment homologado existente`.
- Deployment/alias de homologacao: `dpl_7QHfaSdVTMZMRmHDCiZN1EaHu4ak`; alias `https://homo.c2x.app.br`; URL tecnica `https://careli-hub-hub-i2bs-mpqydi9mg-lucasruas-devs-projects.vercel.app`.
- Arquivos/modulos afetados: Vercel Preview/homolog, variavel `META_WHATSAPP_ACCESS_TOKEN`, modulo Iris e registros operacionais. Nenhum valor de token foi armazenado ou impresso.
- Validacoes executadas:
  - token lido somente da area de transferencia local e validado por tamanho/formato minimo sem exibir valor;
  - `vercel inspect https://homo.c2x.app.br` confirmou deployment `Ready` e alias apontando para o redeploy novo;
  - `GET https://homo.c2x.app.br/iris` retornou `200 OK`;
  - `GET /api/iris/meta/webhook` sem challenge retornou `403 Forbidden` esperado;
  - `POST /api/iris/meta/messages` sem sessao retornou `401 Unauthorized` esperado.
- Healthchecks de homologacao:
  - `/iris`: `200 OK`;
  - `/api/iris/meta/webhook`: `403 Forbidden` esperado sem challenge;
  - `/api/iris/meta/messages`: `401 Unauthorized` esperado sem sessao.
- Riscos conhecidos: ainda falta smoke autenticado real de envio outbound pela Iris para confirmar aceite do token permanente pela Meta; producao nao foi alterada.
- Pendencias: Lucas testar uma mensagem real na Iris homologada; Iris Core acompanhar logs e seguir com o pacote UX apos o smoke do token.
- Status: `EM HOMOLOGACAO`.
- Proxima acao: Lucas enviar mensagem pela Iris em `https://homo.c2x.app.br/iris`; Iris Core validar resultado.

Registro de homologacao:

- Assunto: `[Iris] UX WhatsApp V1 preparada`.
- Modulo/agente: `Iris Core`.
- Data e hora local: `2026-05-20 16:00:14 -03:00`.
- Ambiente: `homologacao (recorte preparado localmente; publicacao pendente de autorizacao Lucas)`.
- Origem: Lucas pediu retomar a frente de UX da Iris depois da estabilizacao do token permanente Meta, priorizando experiencia semelhante ao WhatsApp no atendimento.
- Escopo do recorte:
  - estados visuais de envio, entrega e leitura no padrao WhatsApp;
  - composer com emoji, audio, resposta e edicao local;
  - reacoes em mensagens com persistencia no Iris e envio pela Meta quando aplicavel a mensagem inbound do cliente;
  - nome e avatar do operador vindos do perfil Hub;
  - rolagem automatica para o fim ao chegar/atualizar mensagem;
  - API de mensagens preparada para texto, audio, resposta por contexto e atualizacoes locais.
- Protocolos/atividades relacionados: `n/a`.
- Commit de homologacao: `n/a - recorte local validado; sem commit/deploy de homologacao`.
- Deployment/alias de homologacao: `n/a - publicacao nao autorizada nesta etapa`.
- Arquivos/modulos afetados: `apps/hub/modules/caredesk/IrisPage.tsx`, `apps/hub/app/api/iris/meta/messages/route.ts`, `apps/hub/lib/iris/meta-whatsapp.ts`.
- Validacoes executadas:
  - `git diff --check -- apps/hub/modules/caredesk/IrisPage.tsx apps/hub/app/api/iris/meta/messages/route.ts apps/hub/lib/iris/meta-whatsapp.ts` passou com aviso CRLF conhecido;
  - `npm.cmd run check-types:hub` passou;
  - `npm.cmd run lint:hub` passou com warning conhecido de `eslint.config.js` typeless;
  - `npm.cmd run build --workspace @repo/hub` passou com warnings conhecidos de lockfiles/Turbopack/NFT.
- Healthchecks de homologacao:
  - `n/a - nao houve deploy/alias de homologacao nesta etapa`.
- Riscos conhecidos: precisa smoke autenticado em homologacao para confirmar audio, resposta, reacao e updates de status com dados reais da Meta; edicao de mensagem ja enviada e escopo local do Iris, pois nao ha promessa de edicao remota pela Cloud API; midias inbound ainda dependem de fluxo posterior de download/storage.
- Pendencias: Lucas autorizar publicacao do recorte em homologacao; Iris Core publicar pacote limpo e validar atendimento real em `https://homo.c2x.app.br/iris`.
- Status: `BLOQUEADO`.
- Proxima acao: Lucas autorizar ou nao a publicacao do recorte UX WhatsApp V1 em homologacao.

Registro de homologacao:

- Assunto: `[Iris] Numero real de testes ativado`.
- Modulo/agente: `Iris Core`.
- Data e hora local: `2026-05-20 17:24:51 -03:00`.
- Ambiente: `homologacao`.
- Origem: Lucas localizou/cadastrou o numero real de testes na Meta e autorizou explicitamente alterar `META_WHATSAPP_PHONE_NUMBER_ID` em homologacao.
- Escopo do recorte:
  - trocar somente o identificador tecnico do numero usado pela Iris na Cloud API;
  - manter token, WABA, app, webhook, verify token e demais envs preservados;
  - redeployar o deployment homologado existente sem publicar recortes locais paralelos;
  - manter producao intocada.
- Protocolos/atividades relacionados: `ENV-20260520-1724-IRIS-PHONE-HOMOLOG`.
- Commit de homologacao: `n/a - operacao de env/redeploy sobre deployment homologado existente`.
- Deployment/alias de homologacao: `dpl_8JRthzASvxdxPFx7aHngZT18Ev4i`; alias `https://homo.c2x.app.br`; URL tecnica `https://careli-hub-hub-i2bs-o459ufmpl-lucasruas-devs-projects.vercel.app`.
- Arquivos/modulos afetados: Vercel Preview/homolog, variavel `META_WHATSAPP_PHONE_NUMBER_ID`, modulo Iris e registros operacionais. O valor do identificador nao foi registrado neste indice.
- Validacoes executadas:
  - `vercel env ls preview` confirmou `META_WHATSAPP_PHONE_NUMBER_ID` recriada em `Preview (homolog)`;
  - `vercel inspect https://homo.c2x.app.br` confirmou deployment `Ready` e alias apontando para o redeploy novo;
  - `GET https://homo.c2x.app.br/iris` retornou `200 OK`;
  - `GET /api/iris/meta/webhook` sem challenge retornou `403 Forbidden` esperado;
  - `POST /api/iris/meta/messages` sem sessao retornou `401 Unauthorized` esperado;
  - `vercel logs https://homo.c2x.app.br --level error --since 10m` nao encontrou erros.
- Healthchecks de homologacao:
  - `/iris`: `200 OK`;
  - `/api/iris/meta/webhook`: `403 Forbidden` esperado sem challenge;
  - `/api/iris/meta/messages`: `401 Unauthorized` esperado sem sessao;
  - logs Vercel: sem erros recentes.
- Riscos conhecidos: falta smoke autenticado real para confirmar recebimento e envio pelo numero novo; se a Meta retornar erro de permissao, revisar ativo WhatsApp atribuido ao usuario de sistema `Iris Core` e token permanente.
- Pendencias: Lucas enviar mensagem para o numero real de testes, confirmar entrada na Iris e responder pela Iris em homologacao.
- Status: `EM HOMOLOGACAO`.
- Proxima acao: Lucas testar fluxo real em `https://homo.c2x.app.br/iris`; Iris Core acompanhar o resultado.

Registro de homologacao:

- Assunto: `[Hermes] Mensagens diretas persistentes`.
- Modulo/agente: `Hermes Core`.
- Data e hora local: `2026-05-20 17:30:14 -03:00`.
- Ambiente: `homologacao (recorte preparado localmente; publicacao pendente de autorizacao Lucas)`.
- Origem: Lucas reportou que as mensagens individuais nao estavam chegando no Hermes; ao abrir uma conversa direta, a tela ficava em `Nenhuma mensagem`, mesmo com o usuario disponivel na sidebar.
- Escopo do recorte:
  - transformar conversa direta sintetica em canal deterministico entre dois usuarios;
  - garantir server-side o canal `direct-*` e seus membros antes de ler, marcar como lido ou enviar mensagem;
  - permitir leitura, polling, realtime/broadcast e persistencia de mensagens em canais diretos;
  - preservar o nome operacional Hermes sem renomear tabelas/rotas tecnicas legadas `pulsex`.
- Protocolos/atividades relacionados: `n/a`.
- Commit de homologacao: `n/a - recorte local validado; sem commit/deploy de homologacao`.
- Deployment/alias de homologacao: `n/a - publicacao nao autorizada nesta etapa`.
- Arquivos/modulos afetados: `apps/hub/lib/pulsex/direct-channel.ts`, `apps/hub/app/api/pulsex/messages/route.ts`, `apps/hub/lib/pulsex/supabase-data.ts`, `apps/hub/components/pulsex/pulsex-workspace.tsx`, `docs/operations/engineering-operations.md` e este indice.
- Validacoes executadas:
  - `npm.cmd run check-types:hub` passou;
  - `npm.cmd run lint:hub` passou com warning conhecido de `eslint.config.js` sem `type: module`;
  - `npm.cmd run build --workspace @repo/hub` passou com warning conhecido Turbopack/NFT em `engineering-operations-source.ts`;
  - `git diff --check -- apps/hub/lib/pulsex/direct-channel.ts apps/hub/app/api/pulsex/messages/route.ts apps/hub/lib/pulsex/supabase-data.ts apps/hub/components/pulsex/pulsex-workspace.tsx` passou com avisos CRLF conhecidos;
  - smoke local confirmou `GET http://localhost:3001/hermes` `200 OK`;
  - smoke local confirmou `GET http://localhost:3001/api/hermes/messages` sem sessao `401 Unauthorized` esperado.
- Healthchecks de homologacao:
  - `n/a - nao houve deploy/alias de homologacao nesta etapa`.
- Riscos conhecidos: validacao funcional multiusuario autenticada ainda e necessaria para confirmar envio Lucas -> Catherine e Catherine -> Lucas em tempo real; a criacao do canal direto ocorre no primeiro acesso/envio via API server-side e usa as tabelas atuais `pulsex_channels` e `pulsex_channel_members`, sem migration nova.
- Pendencias: Lucas testar no localhost `http://localhost:3001/hermes`; se aprovado, autorizar publicacao em homologacao do recorte Hermes.
- Status: `BLOQUEADO`.
- Proxima acao: Lucas validar conversa direta em ambiente autenticado; Hermes Core publica homologacao somente se Lucas autorizar.

Registro de homologacao:

- Assunto: `[Iris] Numero real registrado na API de Nuvem`.
- Modulo/agente: `Iris Core`.
- Data e hora local: `2026-05-20 18:45:48 -03:00`.
- Ambiente: `homologacao`.
- Origem: Lucas concluiu no painel da Meta a etapa de registro do numero real de testes da Iris na API de Nuvem.
- Escopo do recorte:
  - registrar o marco operacional do numero real ativo na Cloud API;
  - manter o deployment/alias de homologacao ja publicado;
  - manter envs, tokens e producao intocados nesta etapa;
  - liberar o proximo smoke real de envio e recebimento pela Iris.
- Protocolos/atividades relacionados: `ENV-20260520-1724-IRIS-PHONE-HOMOLOG`.
- Commit de homologacao: `n/a - registro operacional externo na Meta; sem mudanca de codigo`.
- Deployment/alias de homologacao: `dpl_8JRthzASvxdxPFx7aHngZT18Ev4i`; alias `https://homo.c2x.app.br`.
- Arquivos/modulos afetados: configuracao operacional Meta WhatsApp, modulo Iris, diario canonico e este indice de homologacao.
- Validacoes executadas:
  - painel da Meta indicou o numero como registrado na API de Nuvem;
  - Iris ja havia recebido evento/mensagem operacional da Meta e criado ticket em homologacao;
  - nenhuma validacao automatizada adicional foi executada porque nao houve alteracao de codigo/env neste marco.
- Healthchecks de homologacao:
  - pendente novo smoke autenticado completo apos o registro.
- Riscos conhecidos: outbound ainda precisa ser confirmado com o token permanente e permissoes do usuario de sistema `Iris Core`; se a Meta rejeitar destinatario ou formato, testar estrategia com/sem nono digito.
- Pendencias: Lucas testar fluxo completo em `https://homo.c2x.app.br/iris`: inbound real, resposta pela Iris, entrega no WhatsApp e status de mensagem.
- Status: `EM HOMOLOGACAO`.
- Proxima acao: Iris Core acompanhar o smoke real e depois retomar as melhorias de UX WhatsApp.

Registro de homologacao:

- Assunto: `[Iris] Rollback de alias apos Preview sem env Meta`.
- Modulo/agente: `Iris Core`.
- Data e hora local: `2026-05-20 20:37:13 -03:00`.
- Ambiente: `homologacao`.
- Origem: tentativa de publicar o recorte UX da Iris em homologacao apos autorizacao do Lucas.
- Escopo do recorte:
  - publicar melhorias UX da conversa Iris em Preview;
  - preservar producao e demais modulos;
  - restaurar imediatamente homologacao ao deployment anterior funcional quando o runtime do novo Preview nao recebeu as envs Meta.
- Protocolos/atividades relacionados: `n/a`.
- Commit de homologacao: `n/a - deploy de worktree temporario; sem commit`.
- Deployment/alias de homologacao:
  - tentativas bloqueadas: `dpl_EEpkkUjs3vw7MKwFcyX1a3teSNZd` e `dpl_UpC4wKgzEmEDDHxamC25WCVnHnUg`;
  - deployment restaurado e vigente: `dpl_8JRthzASvxdxPFx7aHngZT18Ev4i`;
  - alias vigente: `https://homo.c2x.app.br`.
- Arquivos/modulos afetados: alias de homologacao, modulo Iris e registros operacionais. Nenhum valor de env/secret foi registrado.
- Validacoes executadas:
  - `vercel inspect https://homo.c2x.app.br` confirmou o alias restaurado para `dpl_8JRthzASvxdxPFx7aHngZT18Ev4i`;
  - `GET https://homo.c2x.app.br/iris` retornou `200 OK`;
  - `GET /api/iris/meta/webhook` sem challenge retornou `403 Forbidden` esperado;
  - `POST /api/iris/meta/messages` sem sessao retornou `401 Unauthorized` esperado.
- Healthchecks de homologacao:
  - `/iris`: `200 OK`;
  - webhook sem challenge: `403 Forbidden` esperado;
  - envio sem sessao: `401 Unauthorized` esperado.
- Riscos conhecidos: o recorte UX nao esta publicado em homologacao; a nova tentativa precisa ser feita por branch/commit limpo ou estrategia Vercel que carregue corretamente envs `Preview (homolog)`.
- Pendencias: refazer pacote UX da Iris sem mexer no runtime Meta funcional; validar visualmente com Lucas somente apos o deploy correto.
- Status: `OPERACIONAL COM ATENCAO`.
- Proxima acao: manter `dpl_8JRthzASvxdxPFx7aHngZT18Ev4i` como homologacao vigente ate novo pacote limpo da Iris.

Registro de homologacao:

- Assunto: `[Panteon] Iris fixa no sidebar de homologacao`.
- Modulo/agente: `Zeus`.
- Data e hora local: `2026-05-20 20:39:22 -03:00`.
- Ambiente: `homologacao`.
- Origem: Lucas autorizou publicar a remocao da camada que ocultava a Iris do sidebar global depois de constatar que o modulo nao aparecia em `homo.c2x.app.br`.
- Escopo do recorte:
  - remover a lista fixa `hiddenProductionModuleIds`;
  - remover a funcao `isVisibleInCurrentEnvironment`;
  - deixar a Iris visivel pelo fluxo normal de registry, status e permissao;
  - preservar as rotas Iris, Apolo, PWA e Zeus ja presentes no pacote de homologacao atual.
- Protocolos/atividades relacionados: `n/a`.
- Commit de homologacao: `n/a - hotfix publicado por deploy manual autorizado, sem commit nesta etapa`.
- Deployment/alias de homologacao: `dpl_8Gp3wGhtjtVzeWDjDwdNG69aBULh`; URL tecnica `https://careli-hub-hub-i2bs-qc8b5t2lt-lucasruas-devs-projects.vercel.app`; alias `https://homo.c2x.app.br`.
- Arquivos/modulos afetados: `apps/hub/layouts/hub-shell.tsx`, `docs/operations/releases-homologation.md` e diario canonico.
- Validacoes executadas:
  - `rg hiddenProductionModuleIds|isVisibleInCurrentEnvironment apps/hub/layouts/hub-shell.tsx` nao encontrou mais a regra;
  - `git diff --check -- apps/hub/layouts/hub-shell.tsx docs/operations/engineering-operations.md` passou com avisos conhecidos LF/CRLF no Windows;
  - `npm.cmd run check-types:hub` passou;
  - `npm.cmd run lint:hub` passou com warning conhecido de `eslint.config.js` sem `type: module`;
  - `npm.cmd run build --workspace @repo/hub` passou com warning conhecido Turbopack/NFT em `engineering-operations-source.ts`;
  - build remoto Vercel concluiu `READY`.
- Healthchecks de homologacao:
  - `GET https://homo.c2x.app.br/`: `200 OK`;
  - `GET https://homo.c2x.app.br/login`: `200 OK`;
  - `GET https://homo.c2x.app.br/iris`: `200 OK`;
  - `GET https://homo.c2x.app.br/api/iris/meta/webhook` sem challenge: `403 Forbidden` esperado;
  - `POST https://homo.c2x.app.br/api/iris/meta/messages` sem sessao: `401 Unauthorized` esperado;
  - `vercel inspect https://homo.c2x.app.br` confirmou alias no deployment `dpl_8Gp3wGhtjtVzeWDjDwdNG69aBULh`;
  - `vercel logs https://homo.c2x.app.br --level error --since 10m` nao encontrou logs de erro.
- Riscos conhecidos: deploy manual preservou o pacote atual do worktree para nao apagar recortes que ja estavam visiveis em homologacao; ainda e recomendavel validar visualmente autenticado que a Iris aparece no sidebar e que o runtime Meta segue operacional no fluxo real.
- Pendencias: Lucas recarregar `https://homo.c2x.app.br` em sessao autenticada e confirmar a Iris no sidebar.
- Status: `EM HOMOLOGACAO`.
- Proxima acao: se Lucas validar visualmente, marcar como `HOMOLOGADO`; producao fica fora deste recorte.

Registro de homologacao:

- Assunto: `[Hefesto] Correcao Vercel Preview envs bloqueada por secrets sensiveis`.
- Modulo/agente: `Hefesto`.
- Data e hora local: `2026-05-20 21:12:46 -03:00`.
- Ambiente: `homologacao / Vercel Preview`.
- Origem: Lucas autorizou corrigir a falha em que deployments Preview de homologacao podiam nascer sem envs branch-specific da Iris/Meta, Asana e Hades/Guardian.
- Escopo do recorte:
  - tentar sincronizar envs de `Preview (homolog)` para `Preview` generico;
  - manter Production intocada;
  - nao imprimir, commitar ou registrar valores de secrets;
  - criar script operacional seguro para sincronizacao futura via arquivo local ignorado.
- Protocolos/atividades relacionados: `VERCEL-PREVIEW-ENV-SYNC-20260520`.
- Commit de homologacao: `pendente - script/registro documental local ainda nao commitado neste momento`.
- Deployment/alias de homologacao: `n/a - sem deploy, sem redeploy e sem alias alterado`.
- Arquivos/modulos afetados: `scripts/sync-vercel-preview-env.ps1`, `docs/operations/releases-homologation.md` e diario canonico.
- Validacoes executadas:
  - `vercel env ls preview` confirmou que `META_WHATSAPP_*`, `ASANA_*` e `GUARDIAN_DB_*` existem apenas como `Preview (homolog)` e tipo `sensitive`;
  - `vercel env pull --environment=preview --git-branch=homolog` confirmou nomes, mas valores sensiveis voltam vazios/nao legiveis;
  - `vercel env run -e preview --git-branch homolog` nao injetou valores sensiveis branch-specific no processo;
  - API oficial de leitura de uma env sensivel retornou metadados sem `value`;
  - documentacao oficial da Vercel confirma que envs `sensitive` ficam nao legiveis apos criacao e precisam de novo valor para edicao.
- Healthchecks de homologacao:
  - `n/a - nao houve deployment novo`.
- Riscos conhecidos: copiar essas chaves para `Preview` generico ampliaria o acesso de qualquer Preview do projeto aos recursos de homologacao; se Lucas decidir seguir por esse caminho, os valores precisam ser regravados manualmente no Dashboard ou fornecidos em arquivo local ignorado para o script.
- Pendencias: Lucas/InfraOps decidir entre regravar as chaves sensiveis no escopo `Preview` generico ou manter regra operacional de publicar homologacao apenas via branch/deployment que herde `Preview (homolog)`. Sem isso, novos Previews temporarios podem repetir erro de runtime sem Meta/Asana/Guardian.
- Status: `BLOQUEADO`.
- Proxima acao: `Lucas/InfraOps` reentrar valores sensiveis no Vercel Dashboard ou fornecer arquivo `.env` local seguro para `scripts/sync-vercel-preview-env.ps1 -SourceEnvFile <arquivo> -Apply`; `Hefesto` valida `env ls`, runtime Iris e healthchecks apos a acao.
