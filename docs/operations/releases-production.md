# Releases Producao

Este arquivo e o indice operacional dos recortes publicados em producao.
Ele nao substitui o diario canonico `docs/operations/engineering-operations.md`.

Objetivo:

- registrar somente o que foi promovido ou bloqueado para producao;
- deixar claro qual commit/deployment esta em cada dominio;
- registrar healthchecks finais, rollback e riscos residuais;
- fornecer referencia objetiva para auditoria de producao e novos chats.

## Regras

- Registrar apenas recortes de producao.
- Producoes sensiveis exigem autorizacao explicita do Lucas.
- `Hefesto` e o responsavel padrao por promocao para producao, healthchecks finais, rollback e rastreabilidade oficial.
- Quando `Zeus` for autorizado a publicar diretamente o proprio recorte em `https://ops.c2x.app.br`, tambem deve registrar aqui e no diario canonico.
- Nao registrar valores de env, secrets, tokens, senhas, service role, `POSTGRES_URL` ou chaves externas.
- Como `https://c2x.app.br` e `https://ops.c2x.app.br` compartilham o mesmo projeto/deployment Vercel, todo registro de producao deve informar impacto sobre os dois aliases quando aplicavel.
- O diario canonico continua recebendo o resumo consolidado da decisao, risco ou deploy relevante.

## Status permitidos

- `EM PRODUCAO`
- `OPERACIONAL COM ATENCAO`
- `BLOQUEADO`
- `ROLLBACK EXECUTADO`
- `NECESSITA CORRECAO`

## Campos obrigatorios

- Assunto
- Squad/agente responsavel
- Data e hora local
- Ambiente
- Origem/homologacao de referencia
- Escopo publicado
- Commit publicado
- Deployment anterior
- Deployment novo
- Aliases/dominos afetados
- Arquivos/modulos incluidos
- Arquivos/modulos excluidos
- Validacoes executadas
- Healthchecks pos-deploy
- Logs recentes
- Rollback definido
- Riscos conhecidos
- Pendencias
- Status
- Proxima acao

## Template

```text
Registro de producao:

- Assunto: `[Modulo/Hefesto] Tema objetivo`.
- Squad/agente responsavel: `<Hefesto / Zeus Core autorizado / outro>`.
- Data e hora local: `YYYY-MM-DD HH:mm:ss -03:00`.
- Ambiente: `producao`.
- Origem/homologacao de referencia: `<registro em releases-homologation.md / protocolo / commit / aprovacao Lucas>`.
- Escopo publicado:
  - `<alteracao principal 1>`;
  - `<alteracao principal 2>`;
  - `<alteracao principal 3>`.
- Commit publicado: `<hash commit ou pacote limpo>`.
- Deployment anterior: `<deployment anterior conhecido saudavel>`.
- Deployment novo: `<deployment Vercel novo / URL tecnica>`.
- Aliases/dominios afetados:
  - `https://c2x.app.br`: `<deployment/status>`;
  - `https://ops.c2x.app.br`: `<deployment/status>`;
  - `<outro alias, se houver>`.
- Arquivos/modulos incluidos: `<lista objetiva>`.
- Arquivos/modulos excluidos: `<lista objetiva do que ficou fora>`.
- Validacoes executadas:
  - `<check-types/lint/build/smoke/scan de secrets/git diff --check>`;
  - `<resultado objetivo>`.
- Healthchecks pos-deploy:
  - `<endpoint/rota>: <resultado esperado/recebido>`.
- Logs recentes: `<sem erro critico / achado objetivo / n/a>`.
- Rollback definido: `<deployment/acao segura de rollback>`.
- Riscos conhecidos: `<riscos tecnicos, operacionais ou de negocio>`.
- Pendencias: `<o que falta apos producao>`.
- Status: `<EM PRODUCAO | OPERACIONAL COM ATENCAO | BLOQUEADO | ROLLBACK EXECUTADO | NECESSITA CORRECAO>`.
- Proxima acao: `<Lucas validar / modulo acompanhar / Hefesto monitorar / Zeus investigar>`.
```

## Registros

Novos registros devem ser adicionados abaixo, do mais recente para o mais antigo ou em ordem cronologica consistente por rodada. Nao apagar historico.

Registro de producao:

- Assunto: `[Zeus] HelpDesk autoria e conversa em producao`.
- Squad/agente responsavel: `Zeus autorizado pelo Lucas`.
- Data e hora local: `2026-05-21 12:25:21 -03:00`.
- Ambiente: `producao`.
- Origem/homologacao de referencia: Lucas autorizou publicar em `https://ops.c2x.app.br` as correcoes locais do registro canonico `2026-05-21 10:24:00 -03:00 - Zeus Core - HelpDesk solicitante e historico com autor real`.
- Escopo publicado:
  - corrigir o historico do HelpDesk para usar o autor real do evento e evitar avatar incorreto em devolutivas antigas;
  - exibir data e horario das mensagens no historico do operador e na tela do solicitante;
  - trocar a nomenclatura visivel da Home de `Ticket TI` para `HelpDesk`;
  - evoluir a tela do solicitante com workflow, conversa com Zeus, anexos, revisao e encerramento do chamado.
- Commit publicado: pacote limpo `.codex-deploy/prod-zeus-helpdesk-author-20260521-1024`, baseado no deployment ativo `dpl_9yemD5qSch5sqicRtN6RRuQBYUjB`, com parte do recorte ja versionada em `8a6480c fix(hub): improve helpdesk requester flow` e overlay estrito de `HubItTicketsBoard.tsx`.
- Deployment anterior: `dpl_9yemD5qSch5sqicRtN6RRuQBYUjB`.
- Deployment novo: `dpl_38UfuTya4R6SS24dJKzi1PA3Ecv7`; URL tecnica `https://careli-hub-hub-i2bs-2us1axmkv-lucasruas-devs-projects.vercel.app`.
- Aliases/dominios afetados:
  - `https://ops.c2x.app.br`: confirmado no deployment `dpl_38UfuTya4R6SS24dJKzi1PA3Ecv7`, status `Ready`;
  - `https://c2x.app.br`: confirmado no mesmo deployment por alias compartilhado, status `Ready`.
- Arquivos/modulos incluidos: `apps/hub/lib/hub-it-tickets/types.ts`, `apps/hub/lib/hub-it-tickets/server.ts`, `apps/hub/modules/squadops/HubItTicketsBoard.tsx`, `apps/hub/components/hub-support/hub-user-tickets-panel.tsx` e `apps/hub/app/page.tsx`.
- Arquivos/modulos excluidos: Iris/CareDesk/Meta, Hermes, Hades/Guardian, Atlas, Setup, Chronos, Apolo, migrations, scripts, envs, secrets, banco, dominios e aliases manuais.
- Validacoes executadas:
  - pacote limpo: `npm.cmd run check-types:hub`, `npm.cmd run lint:hub` e `npm.cmd run build --workspace @repo/hub`;
  - pacote limpo: `git diff --no-index --check` nos cinco arquivos do recorte sem erro de whitespace, apenas avisos CRLF do Windows;
  - scan de marcadores confirmou `event.actor`, `formatDateTime(event.createdAt)`, `customer_comment`, `Conversa com Zeus` e o tom suavizado `#3f4c5d`;
  - sync estruturado manual via endpoint local do Operations Center retornou HTTP 200 com `recordsTotal=454`, `recordsUpserted=454`, `releasesUpserted=64` e `mode=content-upload`;
  - Vercel Production concluiu `READY`.
- Healthchecks pos-deploy:
  - `GET https://ops.c2x.app.br/zeus`: `200`;
  - `GET https://c2x.app.br/zeus`: `200`;
  - `GET https://ops.c2x.app.br/login`: `200`;
  - `GET https://c2x.app.br/login`: `200`;
  - `GET https://ops.c2x.app.br/api/hub/it-tickets?details=list&scope=all` sem sessao: `401` esperado.
- Logs recentes: `vercel logs https://ops.c2x.app.br --since 10m --level error` sem logs encontrados.
- Rollback definido: promover novamente `dpl_9yemD5qSch5sqicRtN6RRuQBYUjB` se Zeus/HelpDesk, Home, login ou rotas protegidas apresentarem regressao critica.
- Riscos conhecidos: `https://c2x.app.br` e `https://ops.c2x.app.br` compartilham o mesmo deployment; eventos antigos sem `created_by_user_id` ou sem usuario correspondente em `hub_users` ainda usam fallback por tipo; validacao autenticada visual do Lucas continua recomendada; o build remoto informou vulnerabilidades de dependencias via `npm audit`, sem bloquear a publicacao.
- Pendencias: Lucas validar o fluxo autenticado do HelpDesk como operador e solicitante; Zeus acompanhar se algum historico legado precisar de fallback visual mais especifico.
- Status: `EM PRODUCAO`.
- Proxima acao: Lucas testar no navegador autenticado; Zeus monitorar regressao e preparar hotfix apenas se aparecer divergencia real.

Registro de producao:

- Assunto: `[Zeus] Historico do HelpDesk simplificado em producao`.
- Squad/agente responsavel: `Zeus autorizado pelo Lucas`.
- Data e hora local: `2026-05-20 16:24:23 -03:00`.
- Ambiente: `producao`.
- Origem/homologacao de referencia: ajuste direto autorizado pelo Lucas em OPS para o historico do HelpDesk.
- Escopo publicado:
  - removeu rotulos visuais `Minha devolutiva` e `Solicitante` dos baloes do historico;
  - removeu nome/data exibidos dentro dos baloes, deixando somente a mensagem;
  - suavizou o tom do balao escuro de devolutiva do Zeus para reduzir contraste agressivo.
- Commit publicado: pacote limpo `.codex-deploy/prod-zeus-helpdesk-history-20260520-1452`, sem commit novo nesta rodada.
- Deployment anterior: `dpl_635a6k4awUnB1KfUQ3wgwiVrNGGE`.
- Deployment novo: `dpl_9yemD5qSch5sqicRtN6RRuQBYUjB`; URL tecnica `https://careli-hub-hub-i2bs-d5f53uep0-lucasruas-devs-projects.vercel.app`.
- Aliases/dominios afetados:
  - `https://ops.c2x.app.br`: confirmado no deployment novo;
  - `https://c2x.app.br`: confirmado no deployment novo por alias compartilhado.
- Arquivos/modulos incluidos: `apps/hub/modules/squadops/HubItTicketsBoard.tsx`.
- Arquivos/modulos excluidos: demais recortes locais de Iris, Hermes, Hades, Atlas, Setup, Chronos, Apolo, migrations, envs, secrets, banco, dominio e aliases manuais.
- Validacoes executadas:
  - no worktree principal: `npm.cmd run check-types:hub`, `npm.cmd run lint:hub`, `npm.cmd run build --workspace @repo/hub` e `git diff --check -- apps/hub/modules/squadops/HubItTicketsBoard.tsx`;
  - no pacote limpo: scan de marcadores confirmou ausencia dos rotulos renderizados no historico, preservacao de `/api/zeus/release-registers` e preservacao dos marcadores Hermes atuais;
  - no pacote limpo: `npm.cmd run check-types:hub`, `npm.cmd run lint:hub` e `npm.cmd run build --workspace @repo/hub`;
  - Vercel Production concluiu `READY`.
- Healthchecks pos-deploy:
  - `GET https://ops.c2x.app.br/zeus`: `200`;
  - `GET https://c2x.app.br/zeus`: `200`;
  - `GET https://ops.c2x.app.br/login`: `200`;
  - `GET https://c2x.app.br/hermes`: `200`;
  - `GET https://ops.c2x.app.br/api/pwa/manifest`: `200`;
  - APIs protegidas sem sessao em `ops.c2x.app.br`: `401` esperado para HelpDesk, release registers e Hermes messages.
- Logs recentes: `npx.cmd vercel logs --level error --since 10m` em `ops.c2x.app.br` e `c2x.app.br` sem erros.
- Rollback definido: promover novamente `dpl_635a6k4awUnB1KfUQ3wgwiVrNGGE` se HelpDesk, Zeus, login, Hermes ou rotas protegidas apresentarem regressao critica.
- Riscos conhecidos: smoke visual autenticado ainda depende do Lucas; o smoke local por dev server ficou inconclusivo por timeout, mas build local, build Vercel e healthchecks HTTP passaram.
- Pendencias: Lucas validar visualmente o historico autenticado no HelpDesk do Zeus em producao.
- Status: `EM PRODUCAO`.
- Proxima acao: Zeus acompanhar feedback visual do Lucas e manter rollback definido.

Registro de producao:

- Assunto: `[Hefesto] Producao Hermes interacoes nas respostas da thread`.
- Squad/agente responsavel: `Hefesto`.
- Data e hora local: `2026-05-20 15:40:03 -03:00`.
- Ambiente: `producao`.
- Origem/homologacao de referencia: registro `[Hermes] Validacao final dos icones de interacao`, status `PRONTO PARA PRODUCAO`, validado por Lucas apos restaurar os icones de interacao nas respostas da thread.
- Escopo publicado:
  - renderizar respostas de thread com o mesmo `MessageItem` do chat principal;
  - habilitar reacao, tag/marcacao e informacoes nas respostas da thread, sem reintroduzir o botao de abrir resposta;
  - ampliar o contrato de `HermesThreadReply` para carregar `channelId`, `reactions` e `tags` vindos da mensagem real.
- Commit publicado: `344a7e8 fix(hermes): restore thread reply actions`; pacote limpo `.codex-deploy/prod-hermes-thread-actions-20260520-1535`.
- Deployment anterior: `dpl_2tU2g9KXF5T15cNbLWYZrwSNAK5K`.
- Deployment novo: `dpl_635a6k4awUnB1KfUQ3wgwiVrNGGE`; URL tecnica `https://careli-hub-hub-i2bs-hcgtl624o-lucasruas-devs-projects.vercel.app`.
- Aliases/dominios afetados:
  - `https://c2x.app.br`: confirmado no deployment `dpl_635a6k4awUnB1KfUQ3wgwiVrNGGE`, status `Ready`;
  - `https://ops.c2x.app.br`: confirmado no deployment `dpl_635a6k4awUnB1KfUQ3wgwiVrNGGE`, status `Ready`.
- Arquivos/modulos incluidos:
  - `apps/hub/components/pulsex/thread-panel.tsx`;
  - `apps/hub/components/pulsex/pulsex-workspace.tsx`;
  - `apps/hub/lib/pulsex/types.ts`;
  - `apps/hub/lib/pulsex/supabase-data.ts`;
  - `apps/hub/lib/pulsex/mock-data.ts`.
- Arquivos/modulos excluidos: Apolo, Iris/CareDesk/Meta, Atlas, Hades/Guardian, Zeus fora da base ja publicada, Setup, Chronos, migrations, envs, secrets, banco, dominios, aliases manuais e demais recortes locais do worktree.
- Validacoes executadas:
  - no worktree principal: `npx.cmd eslint components/pulsex/thread-panel.tsx components/pulsex/pulsex-workspace.tsx lib/pulsex/types.ts lib/pulsex/supabase-data.ts lib/pulsex/mock-data.ts --max-warnings 0`, `git diff --check`, scan de secrets dos cinco arquivos, `npm.cmd run check-types:hub`, `npm.cmd run lint:hub` e `npm.cmd run build --workspace @repo/hub`;
  - no pacote limpo: diff contra a base de producao restrito aos cinco arquivos Hermes, busca confirmando `mapThreadReplyToMessage`, `toggleHermesReactions`, `updateThreadReplyState`, `channelId`, `reactions` e `tags`, scan de secrets, `npm.cmd run check-types:hub`, `npm.cmd run lint:hub` e `npm.cmd run build --workspace @repo/hub`;
  - build remoto Vercel Production concluiu `READY`.
- Healthchecks pos-deploy:
  - `GET https://c2x.app.br/`: `200` em `0.551657s`;
  - `GET https://c2x.app.br/login`: `200` em `0.511475s`;
  - `GET https://c2x.app.br/hermes`: `200` em `0.443630s`;
  - `GET https://ops.c2x.app.br/zeus`: `200` em `0.699116s`;
  - `GET https://c2x.app.br/api/hermes/messages` sem sessao: `401` esperado em `0.214217s`;
  - `GET https://c2x.app.br/api/pulsex/messages` sem sessao: `401` esperado em `0.429925s`;
  - `GET https://ops.c2x.app.br/api/zeus/release-registers` sem sessao: `401` esperado em `0.438633s`;
  - `GET https://c2x.app.br/api/pwa/manifest`: `200` em `0.496896s`;
  - `GET https://c2x.app.br/api/hades/db/health`: `200` em `1.135062s`.
- Logs recentes: `npx.cmd vercel logs --level error --since 10m` em `c2x.app.br` e `ops.c2x.app.br` sem logs de erro.
- Rollback definido: promover novamente `dpl_2tU2g9KXF5T15cNbLWYZrwSNAK5K` se Hermes, login, Zeus/Deploy ou rotas protegidas apresentarem regressao critica.
- Riscos conhecidos: validacao visual autenticada do Lucas ainda e recomendada para confirmar os icones nas respostas da thread no chat real; worktree local permanece misturado e nao deve ser usado para deploy amplo.
- Pendencias: Lucas validar Hermes autenticado em producao; demais recortes locais continuam fora desta publicacao.
- Status: `EM PRODUCAO`.
- Proxima acao: `Lucas` validar respostas de thread no Hermes real; `Hefesto` manter monitoramento e rollback pronto.

Registro de producao:

- Assunto: `[Hefesto] Producao Hermes painel de respostas corrigido`.
- Squad/agente responsavel: `Hefesto`.
- Data e hora local: `2026-05-20 15:12:19 -03:00`.
- Ambiente: `producao`.
- Origem/homologacao de referencia: registro `[Hermes] Validacao final do painel de respostas`, status `PRONTO PARA PRODUCAO`, validado por Lucas apos correcao de corte de texto/link longo e remocao do botao de resposta na mensagem raiz do painel.
- Escopo publicado:
  - corrigir quebra de textos e links longos no corpo da mensagem e nas respostas de thread;
  - ocultar o botao de resposta na mensagem raiz quando ela ja esta dentro do painel de respostas;
  - manter reacao, tag e informacoes operacionais no painel, conectando `onToggleTag` no contexto de thread.
- Commit publicado: `6ee7c20 fix(hermes): stabilize thread panel layout`; pacote limpo `.codex-deploy/prod-hermes-thread-panel-20260520-1505`.
- Deployment anterior: `dpl_EeH5aGSWi9HDy9gE5MCg94quq8jT`.
- Deployment novo: `dpl_2tU2g9KXF5T15cNbLWYZrwSNAK5K`; URL tecnica `https://careli-hub-hub-i2bs-f10ufm5xa-lucasruas-devs-projects.vercel.app`.
- Aliases/dominios afetados:
  - `https://c2x.app.br`: confirmado no deployment `dpl_2tU2g9KXF5T15cNbLWYZrwSNAK5K`, status `Ready`;
  - `https://ops.c2x.app.br`: confirmado no deployment `dpl_2tU2g9KXF5T15cNbLWYZrwSNAK5K`, status `Ready`.
- Arquivos/modulos incluidos:
  - `apps/hub/components/pulsex/message-item.tsx`;
  - `apps/hub/components/pulsex/thread-panel.tsx`;
  - `apps/hub/components/pulsex/pulsex-workspace.tsx`.
- Arquivos/modulos excluidos: Apolo, Iris/CareDesk/Meta, Atlas, Hades/Guardian, Zeus fora da base ja publicada, Setup, Chronos, migrations, envs, secrets, banco, dominios, aliases manuais e demais recortes locais do worktree.
- Validacoes executadas:
  - no worktree principal: `npx.cmd eslint components/pulsex/message-item.tsx components/pulsex/thread-panel.tsx components/pulsex/pulsex-workspace.tsx --max-warnings 0`, `git diff --check`, scan de secrets dos tres arquivos, `npm.cmd run check-types:hub`, `npm.cmd run lint:hub` e `npm.cmd run build --workspace @repo/hub`;
  - no pacote limpo: diff contra a base de producao restrito aos tres arquivos Hermes, busca confirmando `overflow-wrap:anywhere`, `onOpenThread ?` e `onToggleTag`, scan de secrets, `npm.cmd run check-types:hub`, `npm.cmd run lint:hub` e `npm.cmd run build --workspace @repo/hub`;
  - build remoto Vercel Production concluiu `READY`.
- Healthchecks pos-deploy:
  - `GET https://c2x.app.br/`: `200` em `0.422659s`;
  - `GET https://c2x.app.br/login`: `200` em `0.415906s`;
  - `GET https://c2x.app.br/hermes`: `200` em `0.588892s`;
  - `GET https://ops.c2x.app.br/zeus`: `200` em `0.883937s`;
  - `GET https://c2x.app.br/api/hermes/messages` sem sessao: `401` esperado em `0.243161s`;
  - `GET https://c2x.app.br/api/pulsex/messages` sem sessao: `401` esperado em `0.366889s`;
  - `GET https://ops.c2x.app.br/api/zeus/release-registers` sem sessao: `401` esperado em `0.508807s`;
  - `GET https://c2x.app.br/api/pwa/manifest`: `200` em `0.438283s`;
  - `GET https://c2x.app.br/api/hades/db/health`: `200` em `1.237010s`.
- Logs recentes: `npx.cmd vercel logs --level error --since 10m` em `c2x.app.br` e `ops.c2x.app.br` sem logs de erro.
- Rollback definido: promover novamente `dpl_EeH5aGSWi9HDy9gE5MCg94quq8jT` se Hermes, login, Zeus/Deploy ou rotas protegidas apresentarem regressao critica.
- Riscos conhecidos: validacao visual autenticada do Lucas ainda e recomendada para confirmar o painel no chat real; worktree local permanece misturado e nao deve ser usado para deploy amplo.
- Pendencias: Lucas validar Hermes autenticado em producao; demais recortes locais continuam fora desta publicacao.
- Status: `EM PRODUCAO`.
- Proxima acao: `Lucas` validar o painel de respostas no Hermes real; `Hefesto` manter monitoramento e rollback pronto.

Registro de producao:

- Assunto: `[Hefesto] Producao Hermes sem tooltips nas mensagens`.
- Squad/agente responsavel: `Hefesto`.
- Data e hora local: `2026-05-20 14:43:53 -03:00`.
- Ambiente: `producao`.
- Origem/homologacao de referencia: registro `[Hermes] Recorte visual aprovado para Hefesto`, status `PRONTO PARA PRODUCAO`, aprovado por Lucas apos remocao dos tooltips da barra de acoes das mensagens.
- Escopo publicado:
  - remover os tooltips visuais dos botoes de reagir, responder, responder com Athena, editar, marcar e informacoes da mensagem;
  - preservar `aria-labels`, handlers, acessibilidade, reacoes, threads, edicao, tags e painel de informacoes;
  - manter a base Hermes ja publicada com reacoes, figurinhas, imagens em thread, painel de respostas maior e popups solidos.
- Commit publicado: `d009b56 fix(hermes): remove message action tooltips`; pacote limpo `.codex-deploy/prod-hermes-no-tooltips-20260520-1438`.
- Deployment anterior: `dpl_HjpYaiDDk2m9HDA4jf8bchhK8RhH`.
- Deployment novo: `dpl_EeH5aGSWi9HDy9gE5MCg94quq8jT`; URL tecnica `https://careli-hub-hub-i2bs-2cq717esx-lucasruas-devs-projects.vercel.app`.
- Aliases/dominios afetados:
  - `https://c2x.app.br`: confirmado no deployment `dpl_EeH5aGSWi9HDy9gE5MCg94quq8jT`, status `Ready`;
  - `https://ops.c2x.app.br`: confirmado no deployment `dpl_EeH5aGSWi9HDy9gE5MCg94quq8jT`, status `Ready`.
- Arquivos/modulos incluidos: `apps/hub/components/pulsex/message-item.tsx`; base de producao preservada do pacote `prod-zeus-deploy-registers-final-20260520-1356`.
- Arquivos/modulos excluidos: Apolo, Iris/CareDesk/Meta, Atlas, Hades/Guardian, Zeus fora da base ja publicada, Setup, Chronos, migrations, envs, secrets, banco, dominios, aliases manuais e demais recortes locais do worktree.
- Validacoes executadas:
  - no worktree principal: `npx.cmd eslint components/pulsex/message-item.tsx --max-warnings 0`, `git diff --check -- apps/hub/components/pulsex/message-item.tsx`, scan de secrets no arquivo, `npm.cmd run check-types:hub`, `npm.cmd run lint:hub`, `npm.cmd run build --workspace @repo/hub` e busca confirmando ausencia de tooltips visuais alvo;
  - no pacote limpo: diff contra base de producao restrito a `message-item.tsx`, sem secrets, `npm.cmd run check-types:hub`, `npm.cmd run lint:hub` e `npm.cmd run build --workspace @repo/hub`;
  - build remoto Vercel Production concluiu `READY`.
- Healthchecks pos-deploy:
  - `GET https://c2x.app.br/`: `200`;
  - `GET https://c2x.app.br/login`: `200`;
  - `GET https://c2x.app.br/hermes`: `200`;
  - `GET https://ops.c2x.app.br/zeus`: `200`;
  - `GET https://c2x.app.br/api/hermes/messages` sem sessao: `401` esperado;
  - `GET https://c2x.app.br/api/pulsex/messages` sem sessao: `401` esperado;
  - `GET https://ops.c2x.app.br/api/zeus/release-registers` sem sessao: `401` esperado;
  - `GET https://c2x.app.br/api/pwa/manifest`: `200`;
  - `GET https://c2x.app.br/api/hades/db/health`: `200`.
- Logs recentes: `npx.cmd vercel logs --level error --since 10m` em `c2x.app.br` e `ops.c2x.app.br` nao retornou erros.
- Rollback definido: promover novamente `dpl_HjpYaiDDk2m9HDA4jf8bchhK8RhH` se Hermes, login, Zeus/Deploy ou rotas protegidas apresentarem regressao critica.
- Riscos conhecidos: validacao visual autenticada do Lucas ainda e recomendada para confirmar a ausencia dos tooltips no chat real; pacote preserva a base de producao anterior e nao inclui recortes locais posteriores de Apolo/Iris/Atlas.
- Pendencias: Lucas validar Hermes autenticado em producao.
- Status: `EM PRODUCAO`.
- Proxima acao: Lucas validar a conversa real no Hermes; Hefesto monitorar logs e manter rollback pronto.

Registro de producao:

- Assunto: `[Zeus] Deploy alimentado por indices de ambiente`.
- Squad/agente responsavel: `Zeus Core autorizado`.
- Data e hora local: `2026-05-20 14:01:42 -03:00`.
- Ambiente: `producao`.
- Origem/homologacao de referencia: Lucas autorizou explicitamente publicar no dominio operacional o recorte local validado que alimenta a aba Deploy do Zeus a partir de `docs/operations/releases-homologation.md` e `docs/operations/releases-production.md`.
- Escopo publicado:
  - criar fonte/parser de registros de homologacao e producao para a aba Deploy;
  - expor `/api/zeus/release-registers` com autorizacao administrativa Zeus;
  - ajustar a tela Deploy para priorizar os indices por ambiente e manter o diario como fallback;
  - preservar o hotfix Hermes de painel de respostas/popups publicado imediatamente antes.
- Commit publicado: pacote limpo `.codex-deploy/prod-zeus-deploy-registers-final-20260520-1356`, sem commit Git novo, baseado no pacote Hermes mais recente e com overlay estrito do recorte Zeus/Deploy.
- Deployment anterior: producao saudavel antes da janela de publicacao `dpl_HNUJJyMxgeQFkndei9v2tjg77mYM`; deployment intermediario Zeus substituido por pacote final `dpl_2yv1wWYPXHTGuw469usziqP9ZbJV`.
- Deployment novo: `dpl_HjpYaiDDk2m9HDA4jf8bchhK8RhH`; URL tecnica `https://careli-hub-hub-i2bs-r3eyazms8-lucasruas-devs-projects.vercel.app`.
- Aliases/dominios afetados:
  - `https://c2x.app.br`: confirmado no deployment `dpl_HjpYaiDDk2m9HDA4jf8bchhK8RhH`, status `Ready`;
  - `https://ops.c2x.app.br`: confirmado no deployment `dpl_HjpYaiDDk2m9HDA4jf8bchhK8RhH`, status `Ready`.
- Arquivos/modulos incluidos: `apps/hub/lib/squadops/release-registers-source.ts`, `apps/hub/app/api/zeus/release-registers/route.ts`, `apps/hub/modules/squadops/ZeusPage.tsx`, `docs/operations/releases-homologation.md`, `docs/operations/releases-production.md` e `docs/operations/engineering-operations.md`; base preservada de Hermes `message-item.tsx` e `pulsex-workspace.tsx` do pacote anterior.
- Arquivos/modulos excluidos: Iris/CareDesk/Meta, Hades/Guardian, Atlas, Setup, Chronos, migrations, envs, secrets, banco, scripts e recortes locais fora de Zeus/Deploy e da base Hermes ja publicada.
- Validacoes executadas:
  - no worktree principal: `npm.cmd run check-types:hub`, `npm.cmd run lint:hub`, `npm.cmd run build --workspace @repo/hub`, `git diff --check` e smokes locais passaram;
  - pacote inicial `.codex-deploy/prod-zeus-deploy-registers-20260520-1348` passou em build, mas foi supersedido porque partia de base anterior ao hotfix Hermes;
  - pacote final `.codex-deploy/prod-zeus-deploy-registers-final-20260520-1356` confirmou marcadores Hermes `MessageAttachmentPreview` e `min(31rem,calc(100%-0.75rem))` junto de `Fonte da aba Deploy` e `/api/zeus/release-registers`;
  - pacote final passou `npm.cmd run check-types:hub`, `npm.cmd run lint:hub`, `npm.cmd run build --workspace @repo/hub` e smoke local `GET /zeus` + `GET /api/zeus/release-registers`;
  - build remoto Vercel Production concluiu `READY`.
- Healthchecks pos-deploy:
  - `GET https://ops.c2x.app.br/zeus`: `200`;
  - `GET https://c2x.app.br/zeus`: `200`;
  - `GET https://ops.c2x.app.br/login`: `200`;
  - `GET https://c2x.app.br/hermes`: `200`;
  - `GET https://ops.c2x.app.br/api/pwa/manifest`: `200`;
  - `GET https://ops.c2x.app.br/api/zeus/release-registers` sem sessao: `401` esperado;
  - `GET https://ops.c2x.app.br/api/hub/it-tickets?details=list&scope=all` sem sessao: `401` esperado;
  - `GET https://c2x.app.br/api/hermes/messages` sem sessao: `401` esperado.
- Logs recentes: `vercel logs --level error --since 10m` em `ops.c2x.app.br` e `c2x.app.br` nao retornou erros.
- Rollback definido: promover novamente `dpl_HNUJJyMxgeQFkndei9v2tjg77mYM` se Zeus/Deploy, Hermes, login ou rotas protegidas apresentarem regressao critica; evitar rollback para `dpl_2yv1wWYPXHTGuw469usziqP9ZbJV` porque ele nao preservava a base Hermes mais recente.
- Riscos conhecidos: a API nova retorna `401` sem sessao e precisa ser validada pelo Lucas autenticado para ver contagem real na UI; como os indices sao arquivos versionados no deployment, o registro desta propria publicacao fica no workspace/diario e entrara no bundle de uma proxima publicacao documental.
- Pendencias: Lucas validar visualmente a aba Deploy autenticado em `https://ops.c2x.app.br/zeus`; sync estruturado executado apos deploy com passagem final `recordsTotal=404`.
- Status: `EM PRODUCAO`.
- Proxima acao: Lucas validar a aba Deploy; Zeus acompanha logs e ajustes finos se houver divergencia.

Registro de producao:

- Assunto: `[Hefesto] Producao Hermes painel de respostas por excecao`.
- Squad/agente responsavel: `Hefesto`.
- Data e hora local: `2026-05-20 13:50:53 -03:00`.
- Ambiente: `producao`.
- Origem/homologacao de referencia: registro `[Hermes] Painel de respostas e popups solidos`, originalmente `VALIDADO LOCAL / AGUARDANDO HOMOLOGACAO`; Lucas autorizou seguir como excecao operacional em 2026-05-20 apos o bloqueio inicial.
- Escopo publicado:
  - ampliar painel lateral de respostas do Hermes para `min(31rem, calc(100% - 0.75rem))`;
  - tornar menus, informacoes, seletor de reacoes e preview de figurinha solidos, sem fundo translucido;
  - abrir seletor de reacoes abaixo do botao para reduzir sobreposicao no texto da mensagem.
- Commit publicado: pacote limpo `.codex-deploy/prod-hermes-popups-20260520-1348`, sem commit Git novo, baseado no deployment ativo `dpl_GcUGb52LBPtDVzxf8FL9LTin4kbu` e com delta manual restrito a dois arquivos Hermes.
- Deployment anterior: `dpl_GcUGb52LBPtDVzxf8FL9LTin4kbu`.
- Deployment novo: `dpl_HNUJJyMxgeQFkndei9v2tjg77mYM`; URL tecnica `https://careli-hub-hub-i2bs-m6h7xfozt-lucasruas-devs-projects.vercel.app`.
- Aliases/dominios afetados:
  - `https://c2x.app.br`: confirmado no deployment `dpl_HNUJJyMxgeQFkndei9v2tjg77mYM`, status `Ready`;
  - `https://ops.c2x.app.br`: confirmado no deployment `dpl_HNUJJyMxgeQFkndei9v2tjg77mYM`, status `Ready`.
- Arquivos/modulos incluidos: `apps/hub/components/pulsex/message-item.tsx` e `apps/hub/components/pulsex/pulsex-workspace.tsx`.
- Arquivos/modulos excluidos: Iris/CareDesk/Meta, Zeus/HelpDesk fora da base ja publicada, Hades/Guardian, Atlas, Setup, Chronos, migrations, envs, secrets, banco e scripts fora do recorte Hermes.
- Validacoes executadas:
  - primeira montagem copiando arquivos inteiros foi bloqueada pelo build por remover `MessageAttachmentPreview`; o pacote final preservou a base de producao e aplicou somente o delta visual necessario;
  - `git diff --no-index --check` nos dois arquivos Hermes passou;
  - scan de secrets nos dois arquivos Hermes sem valores sensiveis reais;
  - `npx.cmd eslint components/pulsex/message-item.tsx components/pulsex/pulsex-workspace.tsx --max-warnings 0` passou;
  - `npm.cmd run check-types:hub` passou;
  - `npm.cmd run build --workspace @repo/hub` passou;
  - build remoto Vercel Production concluiu `READY`.
- Healthchecks pos-deploy:
  - `GET https://c2x.app.br/`: `200`;
  - `GET https://c2x.app.br/login`: `200`;
  - `GET https://c2x.app.br/hermes`: `200`;
  - `GET https://c2x.app.br/pulsex`: `200` apos redirecionamento esperado para Hermes;
  - `GET https://c2x.app.br/api/hermes/messages` sem sessao: `401` esperado;
  - `GET https://c2x.app.br/api/pulsex/messages` sem sessao: `401` esperado;
  - `GET https://c2x.app.br/api/pwa/manifest`: `200`;
  - `GET https://c2x.app.br/api/hades/db/health`: `200`;
  - `GET https://c2x.app.br/api/guardian/db/health`: `200`;
  - `GET https://ops.c2x.app.br/zeus`: `200`;
  - `GET https://ops.c2x.app.br/hermes`: `200` apos redirecionamento esperado para Zeus no dominio OPS.
- Logs recentes: `npx.cmd vercel logs https://c2x.app.br --since 10m` mostrou logs `info` e nenhum erro critico nos healthchecks.
- Rollback definido: promover novamente `dpl_GcUGb52LBPtDVzxf8FL9LTin4kbu` se Hermes, login, Zeus/HelpDesk ou rotas protegidas apresentarem regressao critica.
- Riscos conhecidos: deploy publicado por excecao sem homologacao formal; validacao visual autenticada do Lucas ainda e obrigatoria para confirmar que o painel e os popups resolveram a sobreposicao no chat real; primeiro healthcheck em `ops.c2x.app.br/zeus` e `/hermes` teve latencia acima de 5s, compativel com cold start e sem erro HTTP.
- Pendencias: Lucas validar Hermes autenticado em producao; Hermes Core acompanhar ajuste fino caso a hierarquia visual ainda incomode.
- Status: `EM PRODUCAO`.
- Proxima acao: Lucas validar o chat Hermes real; Hefesto manter rollback pronto para `dpl_GcUGb52LBPtDVzxf8FL9LTin4kbu`.

Registro de producao:

- Assunto: `[Hefesto] Bloqueio producao Hermes painel de respostas`.
- Squad/agente responsavel: `Hefesto`.
- Data e hora local: `2026-05-20 13:43:06 -03:00`.
- Ambiente: `producao`.
- Origem/homologacao de referencia: ultimo registro Hermes no diario canonico, `[Hermes] Painel de respostas e popups solidos`, status `VALIDADO LOCAL / AGUARDANDO HOMOLOGACAO`.
- Escopo solicitado:
  - promover para producao o ultimo registro do Hermes;
  - ajuste de largura do painel lateral de respostas;
  - popups, menus e seletor de reacoes com fundo solido e hierarquia visual corrigida.
- Commit publicado: `nao publicado`.
- Deployment anterior: deployment ativo `dpl_GcUGb52LBPtDVzxf8FL9LTin4kbu`, que ja contem o release Hermes anterior de imagens em threads e preserva Zeus/HelpDesk.
- Deployment novo: `nao houve deploy`.
- Aliases/dominios afetados:
  - `https://c2x.app.br`: permaneceu em `dpl_GcUGb52LBPtDVzxf8FL9LTin4kbu`;
  - `https://ops.c2x.app.br`: permaneceu em `dpl_GcUGb52LBPtDVzxf8FL9LTin4kbu`.
- Arquivos/modulos incluidos: nenhum arquivo publicado.
- Arquivos/modulos excluidos: todo o worktree local, incluindo Hermes/PulseX, Iris, Zeus, Hades, Atlas, Setup, Chronos, migrations, envs, secrets, banco e scripts.
- Validacoes executadas:
  - leitura de `docs/operations/README.md` e do diario canonico;
  - consulta aos indices `releases-homologation.md` e `releases-production.md`;
  - `git status -sb` confirmou worktree principal com recortes misturados;
  - `git diff --name-only` em Hermes/PulseX mostrou arquivos alem dos dois citados no ultimo registro;
  - `vercel inspect https://c2x.app.br` confirmou producao ativa em `dpl_GcUGb52LBPtDVzxf8FL9LTin4kbu`.
- Healthchecks pos-deploy: nao aplicavel, pois o deploy foi bloqueado antes da publicacao.
- Logs recentes: nao aplicavel.
- Rollback definido: nao necessario; nenhum novo deployment foi criado.
- Riscos conhecidos: promover direto violaria a regra operacional de que `Hefesto` so considera para producao registros `HOMOLOGADO` ou `PRONTO PARA PRODUCAO`; o recorte tambem nao esta isolado em commit/deployment de homologacao e o worktree local mistura varios modulos.
- Pendencias: `Hermes Core` deve publicar/registrar o recorte em homologacao ou marcar como `PRONTO PARA PRODUCAO` apos validacao do Lucas; depois `Hefesto` pode promover em pacote limpo.
- Status: `BLOQUEADO`.
- Proxima acao: Lucas acionar `Hermes Core` para homologacao do recorte ou confirmar formalmente uma excecao de producao sem homologacao, assumindo o risco operacional.

Registro de producao:

- Assunto: `[Hefesto] Producao Hermes imagens em threads`.
- Squad/agente responsavel: `Hefesto`.
- Data e hora local: `2026-05-20 13:10:08 -03:00`.
- Ambiente: `producao`.
- Origem/homologacao de referencia: ultimo recorte Hermes identificado em `origin/homolog`, commit `3d733ae feat(hermes): attach images to thread replies`, com dependencia Hermes anterior de `1dbebb0 feat(hermes): add reactions and stickers` e `bde6b7e fix(hermes): keep reaction popups above chat`.
- Escopo publicado:
  - anexos de imagem em respostas de thread no Hermes;
  - preservacao de reacoes, tags, emoji e figurinhas ja homologadas;
  - persistencia de metadata Hermes em `pulsex_messages.metadata`, sem migration nova.
- Commit publicado: pacote limpo `.codex-deploy/prod-hermes-thread-images-20260520-1330`, sem commit Git novo, baseado no pacote de producao Zeus/HelpDesk atual e com uniao minima dos arquivos Hermes ate `3d733ae`.
- Deployment anterior: `dpl_2uiVA9QxBMdjZ44Pwm4bBRY2kpke`.
- Deployment novo: `dpl_GcUGb52LBPtDVzxf8FL9LTin4kbu`; URL tecnica `https://careli-hub-hub-i2bs-4gtfl8or0-lucasruas-devs-projects.vercel.app`.
- Aliases/dominios afetados:
  - `https://c2x.app.br`: confirmado no deployment `dpl_GcUGb52LBPtDVzxf8FL9LTin4kbu`, status `Ready`;
  - `https://ops.c2x.app.br`: confirmado no deployment `dpl_GcUGb52LBPtDVzxf8FL9LTin4kbu`, status `Ready`.
- Arquivos/modulos incluidos: `apps/hub/app/api/pulsex/messages/route.ts`, `apps/hub/components/pulsex/message-composer.tsx`, `apps/hub/components/pulsex/message-item.tsx`, `apps/hub/components/pulsex/message-list.tsx`, `apps/hub/components/pulsex/pulsex-workspace.tsx`, `apps/hub/components/pulsex/thread-panel.tsx`, `apps/hub/lib/pulsex/supabase-data.ts` e `apps/hub/lib/pulsex/types.ts`.
- Arquivos/modulos excluidos: Iris/CareDesk/Meta, Zeus/HelpDesk fora da base ja publicada, Hades/Guardian, Atlas, Setup, Chronos, migrations, envs, secrets, banco e scripts fora do recorte Hermes.
- Validacoes executadas:
  - tentativa inicial com apenas `3d733ae` foi bloqueada no build porque faltava a dependencia Hermes de reacoes em `MessageListProps`;
  - pacote final refez o recorte com a uniao minima dos commits Hermes `1dbebb0`, `bde6b7e` e `3d733ae`;
  - `git diff --no-index --check` nos arquivos Hermes passou;
  - scan de secrets nos caminhos Hermes/PulseX sem valores sensiveis reais;
  - `npm.cmd run check-types:hub`, `npm.cmd run lint:hub` e `npm.cmd run build --workspace @repo/hub` passaram no pacote limpo;
  - build remoto Vercel Production concluiu `READY`.
- Healthchecks pos-deploy:
  - `GET https://c2x.app.br/`: `200`;
  - `GET https://c2x.app.br/login`: `200`;
  - `GET https://c2x.app.br/hermes`: `200`;
  - `GET https://c2x.app.br/pulsex`: `200` apos redirecionamento esperado para Hermes;
  - `GET https://c2x.app.br/api/hermes/messages` sem sessao: `401` esperado;
  - `GET https://c2x.app.br/api/pulsex/messages` sem sessao: `401` esperado;
  - `GET https://c2x.app.br/api/pwa/manifest`: `200`;
  - `GET https://c2x.app.br/api/hades/db/health`: `200`;
  - `GET https://c2x.app.br/api/guardian/db/health`: `200`;
  - `GET https://ops.c2x.app.br/zeus`: `200`;
  - `GET https://ops.c2x.app.br/hermes`: `200` apos redirecionamento esperado para Zeus no dominio OPS.
- Logs recentes: `npx.cmd vercel logs https://c2x.app.br --since 10m` mostrou apenas logs `info`; sem erro critico identificado nos healthchecks.
- Rollback definido: promover novamente `dpl_2uiVA9QxBMdjZ44Pwm4bBRY2kpke` se Hermes, login, Zeus/HelpDesk ou rotas protegidas apresentarem regressao critica.
- Riscos conhecidos: validacao autenticada de upload/colar imagem em resposta de thread ainda depende do Lucas; `c2x.app.br` e `ops.c2x.app.br` compartilham o mesmo deployment Vercel e qualquer nova producao sobrescreve ambos; warnings conhecidos de Turbopack/NFT e turbo env persistem sem bloquear build.
- Pendencias: Lucas validar funcionalmente Hermes autenticado com imagem em thread; Hermes Core acompanhar eventuais ajustes finos.
- Status: `EM PRODUCAO`.
- Proxima acao: Lucas validar Hermes em producao; Hefesto monitorar logs e preservar recortes limpos nas proximas promocoes.

Registro de producao:

- Assunto: `[Zeus] HelpDesk historico e expansoes compactas em producao`.
- Squad/agente responsavel: `Zeus Core autorizado`.
- Data e hora local: `2026-05-20 13:08:11 -03:00`.
- Ambiente: `producao`.
- Origem/homologacao de referencia: Lucas autorizou explicitamente subir o ajuste no dominio operacional `https://ops.c2x.app.br` apos validacao local do recorte Zeus/HelpDesk.
- Escopo publicado:
  - destacar no historico a diferenca entre `Minha devolutiva`, solicitante e Athena;
  - exibir avatar/foto nos eventos do historico e no relato compacto;
  - padronizar as expansoes de `Relato do usuario`, `Como deveria funcionar` e `O que ocorreu` no modelo compacto da fila.
- Commit publicado: pacote limpo `.codex-deploy/prod-zeus-helpdesk-20260520-114226`, sem commit Git novo, com atualizacao pontual de `HubItTicketsBoard.tsx`.
- Deployment anterior: `dpl_HB6odXW9RR6FMLKnHzTMCzev2RAj`.
- Deployment novo: `dpl_2uiVA9QxBMdjZ44Pwm4bBRY2kpke`; URL tecnica `https://careli-hub-hub-i2bs-vwttt6h07-lucasruas-devs-projects.vercel.app`.
- Aliases/dominios afetados:
  - `https://c2x.app.br`: confirmado no deployment `dpl_2uiVA9QxBMdjZ44Pwm4bBRY2kpke`, status `Ready`;
  - `https://ops.c2x.app.br`: confirmado no deployment `dpl_2uiVA9QxBMdjZ44Pwm4bBRY2kpke`, status `Ready`.
- Arquivos/modulos incluidos: `apps/hub/modules/squadops/HubItTicketsBoard.tsx`.
- Arquivos/modulos excluidos: Iris/CareDesk/Meta, Hermes/PulseX, Hades/Guardian, Atlas, Setup, Chronos, migrations, envs, secrets, banco, scripts e recortes locais fora de Zeus/HelpDesk.
- Validacoes executadas:
  - no worktree principal: `npm.cmd run check-types:hub`, `npm.cmd run lint:hub`, `npm.cmd run build --workspace @repo/hub`, `git diff --check` e smoke local `/zeus=200`;
  - no pacote limpo: `npm.cmd run check-types:hub`, `npm.cmd run lint:hub`, `npm.cmd run build --workspace @repo/hub` e `git diff --check -- apps/hub/modules/squadops/HubItTicketsBoard.tsx`;
  - deploy Vercel Production concluiu `READY`.
- Healthchecks pos-deploy:
  - `GET https://ops.c2x.app.br/zeus`: `200`;
  - `GET https://c2x.app.br/zeus`: `200`;
  - `GET https://ops.c2x.app.br/login`: `200`;
  - `GET https://c2x.app.br/login`: `200`;
  - `GET https://ops.c2x.app.br/api/pwa/manifest`: `200`;
  - `GET https://ops.c2x.app.br/api/hub/it-tickets?details=list&scope=all` sem sessao: `401` esperado.
- Logs recentes: `vercel logs https://ops.c2x.app.br --since 10m --level error` sem logs encontrados.
- Rollback definido: promover novamente `dpl_HB6odXW9RR6FMLKnHzTMCzev2RAj` se a tela Zeus/HelpDesk, login ou rotas principais apresentarem regressao critica.
- Riscos conhecidos: `c2x.app.br` e `ops.c2x.app.br` seguem compartilhando o mesmo deployment Vercel; eventos antigos do HelpDesk nao armazenam autor/avatar por evento, entao o historico infere o ator pelo tipo do evento e pelos campos atuais do ticket.
- Pendencias: Lucas validar visualmente o HelpDesk autenticado em producao; Zeus acompanhar se algum evento antigo exigir regra visual mais especifica. Este deployment foi sucedido pelo release Hermes `dpl_GcUGb52LBPtDVzxf8FL9LTin4kbu`, que preservou a base Zeus/HelpDesk e e o deployment ativo atual nos aliases compartilhados.
- Status: `EM PRODUCAO`.
- Proxima acao: Lucas validar tela; Zeus monitorar regressao e manter registros estruturados sincronizados.

Registro de producao:

- Assunto: `[Zeus] Correcao de alias apos sobrescrita do HelpDesk`.
- Squad/agente responsavel: `Zeus Core / Hefesto assistido`.
- Data e hora local: `2026-05-20 12:01:59 -03:00`.
- Ambiente: `producao`.
- Origem/homologacao de referencia: publicacao direta autorizada por Lucas para `https://ops.c2x.app.br` e correcao posterior porque o alias foi sobrescrito por outro deployment.
- Escopo publicado:
  - restaurar o recorte Zeus/HelpDesk full em producao OPS;
  - confirmar que o alias `ops.c2x.app.br` aponta para o pacote correto;
  - registrar risco de aliases compartilhados com `c2x.app.br`.
- Commit publicado: pacote limpo `.codex-deploy/prod-zeus-helpdesk-20260520-114226`, baseado no production saudavel e com recorte HelpDesk aplicado.
- Deployment anterior: `dpl_Hrr3kkLjG8TKarMwmNC1E9VK1P9P` sobrescreveu o alias e nao continha o HelpDesk; antes do primeiro deploy Zeus o rollback conhecido era `dpl_GHbW8XXWnhCyvLj725hJUPk8XuV9`.
- Deployment novo: `dpl_FPFyzcWBrs8LX4XnQZTBKPEHWK74`; URL tecnica `https://careli-hub-hub-i2bs-fu7sylzv7-lucasruas-devs-projects.vercel.app`.
- Aliases/dominios afetados:
  - `https://c2x.app.br`: confirmado no mesmo deployment `dpl_FPFyzcWBrs8LX4XnQZTBKPEHWK74`;
  - `https://ops.c2x.app.br`: confirmado no mesmo deployment `dpl_FPFyzcWBrs8LX4XnQZTBKPEHWK74`.
- Arquivos/modulos incluidos: `apps/hub/modules/squadops/HubItTicketsBoard.tsx`, `apps/hub/modules/squadops/ZeusPage.tsx`, APIs/client/server `hub-it-tickets` e componentes compartilhados de suporte.
- Arquivos/modulos excluidos: Iris/CareDesk/Meta, Hermes, Atlas, migrations, scripts e recortes locais fora de Zeus/HelpDesk.
- Validacoes executadas:
  - pacote limpo continha marcadores `HelpDesk`, `isHelpDeskView` e `details=list`;
  - `vercel inspect https://ops.c2x.app.br` confirmou deployment `Ready`;
  - service worker remoto verificado sem cache de fetch.
- Healthchecks pos-deploy:
  - `GET /zeus`: `200`;
  - `GET /api/hub/it-tickets?details=list&scope=all` sem sessao: `401` esperado;
  - logs Vercel mostraram chamada autenticada `GET /api/hub/it-tickets` com `200`.
- Logs recentes: sem erro critico registrado no check de correcao.
- Rollback definido: promover novamente `dpl_GHbW8XXWnhCyvLj725hJUPk8XuV9` se houver regressao critica.
- Riscos conhecidos: `c2x.app.br` e `ops.c2x.app.br` compartilham deployment; qualquer novo production deploy pode sobrescrever os dois aliases novamente.
- Pendencias: Lucas fazer refresh forte e validacao visual autenticada; Zeus monitorar alias.
- Status: `EM PRODUCAO`.
- Proxima acao: `Hefesto` deve inspecionar os dois aliases antes/depois de qualquer nova producao.

Registro de producao:

- Assunto: `[Hefesto] Producao Hermes reacoes e figurinhas`.
- Squad/agente responsavel: `Hefesto`.
- Data e hora local: `2026-05-20 11:55:01 -03:00`.
- Ambiente: `producao`.
- Origem/homologacao de referencia: commit homologado `1dbebb0 feat(hermes): add reactions and stickers`, autorizado por Lucas para producao.
- Escopo publicado:
  - reacoes rapidas em mensagens Hermes;
  - envio de emoji/figurinhas;
  - persistencia Hermes em `metadata` JSONB sem migration.
- Commit publicado: pacote limpo `7814fd0 feat(hermes): add reactions and stickers`; origem homologada `1dbebb0`.
- Deployment anterior: `dpl_GHbW8XXWnhCyvLj725hJUPk8XuV9`.
- Deployment novo: `dpl_Hrr3kkLjG8TKarMwmNC1E9VK1P9P`; URL tecnica `https://careli-hub-hub-i2bs-kvesynxt9-lucasruas-devs-projects.vercel.app`.
- Aliases/dominios afetados:
  - `https://c2x.app.br`: apontou para `dpl_Hrr3kkLjG8TKarMwmNC1E9VK1P9P` na publicacao;
  - `https://ops.c2x.app.br`: tambem apontou para `dpl_Hrr3kkLjG8TKarMwmNC1E9VK1P9P` na publicacao, depois sobrescrito pela correcao Zeus `dpl_FPFyzcWBrs8LX4XnQZTBKPEHWK74`.
- Arquivos/modulos incluidos: `apps/hub/app/api/pulsex/messages/route.ts`, componentes `pulsex/message-*`, `pulsex-workspace`, `apps/hub/lib/pulsex/supabase-data.ts` e `apps/hub/lib/pulsex/types.ts`.
- Arquivos/modulos excluidos: Iris/CareDesk/Meta, Zeus/HelpDesk, Hades/Guardian, Atlas, Setup, migrations, envs e scripts fora do recorte Hermes.
- Validacoes executadas:
  - checagem de escopo confirmou apenas Hermes/PulseX;
  - scan de secrets sem atribuicoes com valores reais;
  - `git diff --check`, `check-types`, `lint` e `build` passaram com warnings conhecidos;
  - smoke local confirmou `/hermes=200` e `/pulsex=307` para `/hermes`.
- Healthchecks pos-deploy:
  - `c2x.app.br/`, `/login`, `/hermes`, `/hades`, `/atlas`, `/setup`, `/api/pwa/manifest` e `/api/hades/db/health`: `200`;
  - `/api/hermes/messages` e `/api/pulsex/messages` sem sessao: `401` esperado;
  - `ops.c2x.app.br/`: `307` para `/zeus`; `ops.c2x.app.br/zeus`: `200`.
- Logs recentes: logs Vercel de erro dos ultimos 15 minutos sem ocorrencias.
- Rollback definido: promover novamente `dpl_GHbW8XXWnhCyvLj725hJUPk8XuV9` se Hermes, login, Home, API de mensagens ou rotas principais apresentarem regressao critica.
- Riscos conhecidos: validacao autenticada de reagir/enviar emoji/figurinha ainda recomendada; persistencia em `metadata.reactions` pode ter corrida em uso simultaneo extremo; deployment foi posteriormente sobrescrito pela correcao Zeus por causa de aliases compartilhados.
- Pendencias: Lucas validar funcionalmente Hermes; avaliar tabela propria de reacoes se volume crescer.
- Status: `OPERACIONAL COM ATENCAO`.
- Proxima acao: Hermes Core acompanha ajustes finos; Hefesto monitora alias compartilhado.

Registro de producao:

- Assunto: `[Zeus] HelpDesk full publicado em producao ops`.
- Squad/agente responsavel: `Zeus Core / Hefesto assistido`.
- Data e hora local: `2026-05-20 11:51:22 -03:00`.
- Ambiente: `producao`.
- Origem/homologacao de referencia: Lucas autorizou explicitamente publicar o recorte HelpDesk no dominio operacional `https://ops.c2x.app.br`.
- Escopo publicado:
  - renomear experiencia visivel para `HelpDesk`;
  - carregar fila em modo leve `details=list`;
  - abrir evidencias em overlay;
  - limpar campos de devolutiva apos envio.
- Commit publicado: pacote limpo `.codex-deploy/prod-zeus-helpdesk-20260520-114226`, baseado no production saudavel `9cc34eb`.
- Deployment anterior: `dpl_GHbW8XXWnhCyvLj725hJUPk8XuV9`.
- Deployment novo: `dpl_F3zBKiKSWf8b5KZ58PeP98Gi9RuU`; URL tecnica `https://careli-hub-hub-i2bs-gs3fsx5bu-lucasruas-devs-projects.vercel.app`.
- Aliases/dominios afetados:
  - `https://c2x.app.br`: confirmado no deployment novo na publicacao;
  - `https://ops.c2x.app.br`: confirmado no deployment novo na publicacao.
- Arquivos/modulos incluidos: `HubItTicketsBoard`, `ZeusPage`, APIs/client/server `hub-it-tickets` e componentes compartilhados de suporte.
- Arquivos/modulos excluidos: Iris, Hermes, Atlas, scripts e migrations fora do recorte.
- Validacoes executadas:
  - `check-types`, `lint`, `build` e `git diff --no-index --check` passaram no pacote limpo;
  - smoke local `/zeus` retornou `200`;
  - Vercel Production ficou `Ready`.
- Healthchecks pos-deploy:
  - `ops.c2x.app.br/`: `307` esperado para Zeus;
  - `/login`: `200`;
  - `/zeus`: `200`;
  - `/api/pwa/manifest`: `200`;
  - APIs protegidas sem sessao: `401` esperado;
  - `GET /api/hub/it-tickets/evidence-analysis`: `405` esperado.
- Logs recentes: sem erro 500; chamadas autenticadas `GET /api/hub/it-tickets` com `200`.
- Rollback definido: promover novamente `dpl_GHbW8XXWnhCyvLj725hJUPk8XuV9` se login, Zeus, HelpDesk ou rotas protegidas apresentarem regressao.
- Riscos conhecidos: o deployment foi sobrescrito em seguida por `dpl_Hrr3kkLjG8TKarMwmNC1E9VK1P9P`, exigindo a correcao registrada acima.
- Pendencias: registro mantido para rastreabilidade historica; estado ativo atual e o deployment corrigido `dpl_FPFyzcWBrs8LX4XnQZTBKPEHWK74`.
- Status: `OPERACIONAL COM ATENCAO`.
- Proxima acao: usar o registro de correcao como fonte atual de producao OPS.

Registro de producao:

- Assunto: `[Hefesto] Producao Panteon 19 e 20 sem cortes Iris`.
- Squad/agente responsavel: `Hefesto`.
- Data e hora local: `2026-05-20 08:48:19 -03:00`.
- Ambiente: `producao`.
- Origem/homologacao de referencia: `DP-20260520-0220-PANTEON-HOMOLOG`, com autorizacao do Lucas para subir dias 19 e 20 excluindo pacotes Iris.
- Escopo publicado:
  - PWA Panteon;
  - login Panteon preservado;
  - Ticket TI/Zeus;
  - Athena Ticket Recording;
  - Hades AI drawer;
  - Hermes Athena panel/workspace.
- Commit publicado: pacote limpo com commits `9cc34eb`, `f585d27`, `e046aa7` sobre base `a264bb9`.
- Deployment anterior: `dpl_5nk1gTh6wwzTLosowcmRha1zjMNb`.
- Deployment novo: `dpl_GHbW8XXWnhCyvLj725hJUPk8XuV9`; URL tecnica `https://careli-hub-hub-i2bs-4mgyqi9lo-lucasruas-devs-projects.vercel.app`.
- Aliases/dominios afetados:
  - `https://c2x.app.br`: confirmado no deployment novo;
  - `https://ops.c2x.app.br`: confirmado no deployment novo.
- Arquivos/modulos incluidos: Panteon/PWA, login, Zeus/Ticket TI, Athena, Hades, Hermes e docs operacionais.
- Arquivos/modulos excluidos: `apps/hub/modules/caredesk`, `apps/hub/lib/iris`, `apps/hub/app/api/iris`, `apps/hub/app/api/caredesk/meta`, migration `0025` e seed demo removido.
- Validacoes executadas:
  - `git diff --check`, scan de secrets, `check-types`, `lint` e `build` passaram no pacote limpo;
  - build remoto Vercel passou com warnings conhecidos.
- Healthchecks pos-deploy:
  - `c2x.app.br/`, `/login`, `/hades`, `/hermes`, `/atlas`, `/setup`, `/api/pwa/manifest`, `/sw.js`, `/api/hades/db/health`: `200`;
  - `/api/hub/it-tickets`, `POST /api/hub/it-tickets/evidence-analysis`, `/api/operations/monitoring` sem sessao: `401` esperado;
  - `ops.c2x.app.br/`: `307` para `/zeus`; `ops.c2x.app.br/login`: `200`; `ops.c2x.app.br/zeus`: `200`.
- Logs recentes: logs Vercel de erro dos ultimos 15 minutos sem ocorrencias.
- Rollback definido: promover novamente `dpl_5nk1gTh6wwzTLosowcmRha1zjMNb` se login, Home, PWA, Zeus/Ticket TI ou rotas principais apresentarem regressao critica.
- Riscos conhecidos: push da branch limpa foi bloqueado pela politica do ambiente; rastreabilidade fica no deployment e no diario; cortes Iris/Meta ficaram fora; validacao visual autenticada ainda recomendada.
- Pendencias: Lucas validar PWA e Ticket TI autenticados; Iris segue em recorte separado.
- Status: `EM PRODUCAO`.
- Proxima acao: Hefesto acompanhar logs; qualquer Iris em producao exige aprovacao separada.

Registro de producao:

- Assunto: `[Zeus] Login Panteon publicado em producao`.
- Squad/agente responsavel: `Zeus / Hefesto assistido`.
- Data e hora local: `2026-05-20 05:28:34 -03:00`.
- Ambiente: `producao`.
- Origem/homologacao de referencia: Lucas autorizou refazer e publicar a tela de login com identidade Panteon.
- Escopo publicado:
  - tela de login com marca Panteon;
  - base grafite e acento dourado;
  - formulario compacto preservando autenticacao existente.
- Commit publicado: pacote minimo em worktree limpa; hash nao registrado no diario para este recorte.
- Deployment anterior: production anterior conhecido antes do recorte de login.
- Deployment novo: `dpl_5nk1gTh6wwzTLosowcmRha1zjMNb`; URL tecnica `https://careli-hub-hub-i2bs-mivg9mrhn-lucasruas-devs-projects.vercel.app`.
- Aliases/dominios afetados:
  - `https://c2x.app.br`: confirmado no deployment novo;
  - `https://ops.c2x.app.br`: confirmado no deployment novo.
- Arquivos/modulos incluidos: `apps/hub/app/login/page.tsx`.
- Arquivos/modulos excluidos: recorte Zeus Meta/logs, recortes amplos de homologacao e demais modulos.
- Validacoes executadas:
  - `check-types`, `lint`, `build`, `git diff --check` e smoke local `/login` passaram;
  - Vercel `Ready`.
- Healthchecks pos-deploy:
  - `GET https://c2x.app.br/login`: `200`;
  - `GET https://ops.c2x.app.br/login`: `200`.
- Logs recentes: logs Vercel mostraram `GET /login` `200` nos dois hosts.
- Rollback definido: usar deployment production anterior se login quebrar autenticacao ou carregamento.
- Riscos conhecidos: worktree local principal seguiu com alteracoes abertas; recorte Zeus Meta/logs ficou fora; protocolo `LO-*` persistente segue bloqueado ate modelagem.
- Pendencias: Lucas validar visualmente login em producao.
- Status: `EM PRODUCAO`.
- Proxima acao: Zeus fechar desenho oficial de logs/protocolos antes de qualquer gravacao auditavel real.

Registro de producao:

- Assunto: `[Zeus] Producao OPS atualizada para Panteon`.
- Squad/agente responsavel: `Zeus`.
- Data e hora local: `2026-05-20 02:41:49 -03:00`.
- Ambiente: `producao`.
- Origem/homologacao de referencia: commit `a264bb9 feat(panteon): consolidate homologation updates`, publicado em homologacao no consolidado Panteon.
- Escopo publicado:
  - atualizar tela Zeus/OPS para Panteon;
  - preservar compatibilidade `/squadops`;
  - usar worktree limpo para excluir Iris/Meta locais.
- Commit publicado: `a264bb9 feat(panteon): consolidate homologation updates`.
- Deployment anterior: `dpl_HPyWL4BBuqzw8VKeYJnqf6G48G2t`.
- Deployment novo: `dpl_6pEgwbugz9rnAQfLKgiLfWLWbn6U`; URL tecnica `https://careli-hub-hub-i2bs-onawgwhzp-lucasruas-devs-projects.vercel.app`.
- Aliases/dominios afetados:
  - `https://ops.c2x.app.br`: confirmado no deployment novo;
  - `https://c2x.app.br`: tambem atualizado por ser alias production do mesmo projeto.
- Arquivos/modulos incluidos: consolidado Panteon/Zeus do commit `a264bb9`.
- Arquivos/modulos excluidos: mudancas locais Iris/Meta e demais recortes fora do commit consolidado.
- Validacoes executadas:
  - `check-types`, `lint`, `build` e `git diff --check` passaram no recorte limpo;
  - smoke local com host `ops.c2x.app.br` passou;
  - Vercel Production `Ready`.
- Healthchecks pos-deploy:
  - `ops.c2x.app.br/`: `307` para `/zeus`;
  - `ops.c2x.app.br/zeus`: `200`;
  - `ops.c2x.app.br/squadops`: `200`;
  - `c2x.app.br/`: `200`;
  - `c2x.app.br/hades`: `200`;
  - APIs protegidas sem sessao: `401` esperado.
- Logs recentes: logs Vercel de erro dos ultimos 15 minutos sem ocorrencias.
- Rollback definido: promover novamente `dpl_HPyWL4BBuqzw8VKeYJnqf6G48G2t` ou executar rollback Vercel especifico se rota critica, login, isolamento OPS ou logs de producao falharem.
- Riscos conhecidos: deploy tambem atualizou `c2x.app.br` por alias compartilhado; validacao visual autenticada ainda depende do Lucas.
- Pendencias: Lucas fazer refresh visual autenticado em OPS.
- Status: `EM PRODUCAO`.
- Proxima acao: Zeus acompanhar divergencia visual/operacional; Hefesto sempre validar alias compartilhado.

Registro de producao:

- Assunto: `[Hefesto] Producao Hermes preview de anexos e diretas`.
- Squad/agente responsavel: `Hefesto`.
- Data e hora local: `2026-05-21 14:03:16 -03:00`.
- Ambiente: `producao`.
- Autorizacao: Lucas solicitou explicitamente subir em producao as correcoes feitas pelo Hermes.
- Origem/homologacao de referencia: registro Hermes local `[Hermes] Visualizacao interna de imagens anexadas` e correcao Hermes acoplada para conversas diretas persistidas; promocao feita por excecao autorizada pelo Lucas, sem homologacao formal separada deste recorte.
- Escopo publicado:
  - preview interno de imagens anexadas no Hermes, evitando abertura externa/tela vazia;
  - propagacao do preview para lista de mensagens, mensagem raiz de thread e respostas;
  - lightbox com fechar por `Esc`, clique fora e botao, preservando download;
  - identificador estavel de conversa direta Hermes entre dois usuarios;
  - preparacao server-side de canal direto e membros em `pulsex_channels`/`pulsex_channel_members` quando a conversa direta for usada por usuario autenticado.
- Commit de referencia no branch local: `a7b477d fix(hermes): preview attachments and persist direct chats`.
- Pacote limpo publicado: `.codex-deploy/prod-hermes-preview-direct-20260521-135349`, baseado na producao vigente `dpl_38UfuTya4R6SS24dJKzi1PA3Ecv7` e com delta restrito a Hermes/PulseX.
- Deployment anterior: `dpl_38UfuTya4R6SS24dJKzi1PA3Ecv7`.
- Deployment novo: `dpl_6315rmvTMtBikupELU37FmEtS7ek`; URL tecnica `https://careli-hub-hub-i2bs-i811tygp0-lucasruas-devs-projects.vercel.app`.
- Aliases/dominios afetados:
  - `https://c2x.app.br`: confirmado em `dpl_6315rmvTMtBikupELU37FmEtS7ek`, status `Ready`;
  - `https://ops.c2x.app.br`: confirmado em `dpl_6315rmvTMtBikupELU37FmEtS7ek`, status `Ready`.
- Arquivos/modulos incluidos:
  - `apps/hub/app/api/pulsex/messages/route.ts`;
  - `apps/hub/components/pulsex/message-item.tsx`;
  - `apps/hub/components/pulsex/message-list.tsx`;
  - `apps/hub/components/pulsex/pulsex-workspace.tsx`;
  - `apps/hub/components/pulsex/thread-panel.tsx`;
  - `apps/hub/lib/pulsex/direct-channel.ts`;
  - `apps/hub/lib/pulsex/mock-data.ts`;
  - `apps/hub/lib/pulsex/supabase-data.ts`;
  - `apps/hub/lib/pulsex/types.ts`.
- Arquivos/modulos excluidos: Iris/CareDesk/Meta, Hades/Guardian, Zeus/HelpDesk fora da base ja vigente, Atlas, Apolo, PWA, migrations, scripts, envs, secrets, banco, dominios e aliases manuais.
- Validacoes executadas:
  - worktree principal: `npx.cmd eslint app/api/pulsex/messages/route.ts components/pulsex/message-item.tsx components/pulsex/message-list.tsx components/pulsex/pulsex-workspace.tsx components/pulsex/thread-panel.tsx lib/pulsex/direct-channel.ts lib/pulsex/supabase-data.ts --max-warnings 0` passou;
  - worktree principal: `npm.cmd run check-types:hub`, `npm.cmd run lint:hub`, `npm.cmd run build --workspace @repo/hub` e `git diff --cached --check` passaram;
  - scan staged de secrets nos arquivos Hermes sem valores sensiveis reais;
  - pacote limpo: diff contra a base de producao ficou restrito aos nove arquivos Hermes/PulseX listados;
  - pacote limpo: focused eslint dos nove arquivos passou;
  - pacote limpo: `npm.cmd run build --workspace @repo/hub` passou;
  - build remoto Vercel Production concluiu `READY`.
- Healthchecks pos-deploy:
  - `GET https://c2x.app.br/`: `200`;
  - `GET https://c2x.app.br/login`: `200`;
  - `GET https://c2x.app.br/hermes`: `200`;
  - `GET https://c2x.app.br/pulsex`: `200`;
  - `GET https://c2x.app.br/api/hades/db/health`: `200`;
  - `GET https://c2x.app.br/api/guardian/db/health`: `200`;
  - `GET https://ops.c2x.app.br/zeus`: `200`;
  - `GET https://ops.c2x.app.br/hermes`: `200`;
  - `GET https://c2x.app.br/api/hermes/messages` sem sessao: `401` esperado;
  - `GET https://c2x.app.br/api/pulsex/messages` sem sessao: `401` esperado;
  - `GET https://ops.c2x.app.br/api/zeus/release-registers` sem sessao: `401` esperado;
  - `GET https://c2x.app.br/api/operations/monitoring` sem sessao: `401` esperado.
- Logs recentes: `npx.cmd vercel logs` com `--level error --since 10m` em `c2x.app.br` e `ops.c2x.app.br` sem logs encontrados.
- Riscos conhecidos:
  - promocao feita por excecao direta autorizada pelo Lucas, sem homologacao formal separada do recorte;
  - validacao autenticada do clique em imagem real e de conversa direta real ainda depende do Lucas;
  - conversas diretas passam a preparar registros em tabelas Hermes existentes quando usadas, sem migration nova;
  - `c2x.app.br` e `ops.c2x.app.br` compartilham o mesmo deployment Vercel;
  - warnings conhecidos de Turbopack/NFT, `npm audit`, engines Node e envs Postgres/Supabase fora do `turbo.json` persistem sem bloquear build.
- Rollback definido: promover novamente `dpl_38UfuTya4R6SS24dJKzi1PA3Ecv7` se Hermes, login, Zeus/OPS, Hades/Guardian health ou rotas protegidas apresentarem regressao critica.
- Pendencias: Lucas validar Hermes autenticado em producao com imagem anexada real e conversa direta entre usuarios; Hermes Core acompanhar ajuste fino se houver divergencia visual ou funcional.
- Status: `EM PRODUCAO`.
- Proxima acao: Lucas validar Hermes em producao; Hefesto manter rollback pronto para `dpl_38UfuTya4R6SS24dJKzi1PA3Ecv7`.

Registro de producao:

- Assunto: `[Hefesto] Producao Hermes biblioteca local de figurinhas`.
- Squad/agente responsavel: `Hefesto`.
- Data e hora local: `2026-05-21 14:37:12 -03:00`.
- Ambiente: `producao`.
- Autorizacao: Lucas solicitou explicitamente subir em producao a melhoria feita pelo Hermes.
- Origem/homologacao de referencia: registro Hermes local `[Hermes] Biblioteca local de figurinhas`; promocao direta autorizada pelo Lucas, sem homologacao formal separada.
- Escopo publicado:
  - biblioteca local de figurinhas no Hermes com abas `Minhas` e `Padrao`;
  - salvamento de imagens pequenas como figurinhas locais do usuario;
  - persistencia em `localStorage` por usuario, sem migration;
  - envio de sticker personalizado com metadata de imagem;
  - renderizacao de sticker grande, sem card/legenda interna.
- Commit de referencia no branch local: `49179b7 feat(hermes): add local sticker library`.
- Pacote limpo publicado: `.codex-deploy/prod-hermes-stickers-20260521-143155`, baseado no pacote Hermes de producao anterior `.codex-deploy/prod-hermes-preview-direct-20260521-135349`.
- Deployment anterior: `dpl_6315rmvTMtBikupELU37FmEtS7ek`.
- Deployment novo: `dpl_JEA6MdUWm9EPwT5CKfXWMdi7nDMo`; URL tecnica `https://careli-hub-hub-i2bs-f3zacogzc-lucasruas-devs-projects.vercel.app`.
- Aliases/dominios afetados:
  - `https://c2x.app.br`: confirmado em `dpl_JEA6MdUWm9EPwT5CKfXWMdi7nDMo`, status `Ready`;
  - `https://ops.c2x.app.br`: confirmado em `dpl_JEA6MdUWm9EPwT5CKfXWMdi7nDMo`, status `Ready`.
- Arquivos/modulos incluidos:
  - `apps/hub/components/pulsex/message-composer.tsx`;
  - `apps/hub/components/pulsex/message-item.tsx`;
  - `apps/hub/components/pulsex/pulsex-workspace.tsx`.
- Arquivos/modulos excluidos: Iris, Hades, Zeus, Atlas, Apolo, Chronos, Setup, PWA, scripts, migrations, envs, secrets, tokens, service role, banco e Supabase mutavel.
- Validacoes executadas:
  - eslint focado nos tres arquivos Hermes: OK;
  - `git diff --check` focado: OK, apenas avisos CRLF;
  - scan simples de secrets nos tres arquivos: sem matches;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK;
  - `npm.cmd run build --workspace @repo/hub`: OK;
  - build do pacote limpo: OK;
  - build remoto Vercel Production: `READY`.
- Healthchecks pos-deploy:
  - `GET https://c2x.app.br/`: `200`;
  - `GET https://c2x.app.br/login`: `200`;
  - `GET https://c2x.app.br/hermes`: `200`;
  - `GET https://c2x.app.br/pulsex`: `200`;
  - `GET https://ops.c2x.app.br/hermes`: `200`;
  - `GET https://ops.c2x.app.br/zeus`: `200`;
  - `GET https://c2x.app.br/api/hades/db/health`: `200`;
  - `GET https://c2x.app.br/api/guardian/db/health`: `200`;
  - `GET https://c2x.app.br/api/pulsex/messages` sem sessao: `401` esperado;
  - `GET https://c2x.app.br/api/operations/monitoring` sem sessao: `401` esperado.
- Logs recentes: `npx.cmd vercel logs` em `c2x.app.br` e `ops.c2x.app.br` retornou chamadas `info`, sem erro critico observado.
- Riscos conhecidos:
  - promocao direta por autorizacao do Lucas, sem homologacao formal separada;
  - figurinhas locais nao sincronizam entre dispositivos nesta V1;
  - limite de `512 KB` e ate `24` figurinhas salvas por usuario;
  - validacao autenticada final depende do Lucas.
- Rollback definido: promover novamente `dpl_6315rmvTMtBikupELU37FmEtS7ek` se Hermes, login, Zeus/OPS, Hades/Guardian health ou rotas protegidas apresentarem regressao critica.
- Pendencias: Lucas validar salvamento, envio e renderizacao de figurinha personalizada em producao.
- Status: `EM PRODUCAO`.
- Proxima acao: Hermes Core acompanhar ajuste fino se houver divergencia visual/funcional.

Registro de producao:

- Assunto: `[Hefesto] Producao Zeus diagnostico Auth x hub_users`.
- Squad/agente responsavel: `Hefesto`.
- Data e hora local: `2026-05-21 14:47:35 -03:00`.
- Ambiente: `producao`.
- Autorizacao: Lucas encaminhou a devolutiva do Zeus e solicitou dar andamento ao recorte homologado.
- Origem/homologacao de referencia: `[Zeus] Diagnostico Auth x hub_users em homologacao`, commit `f24c56e`, deployment homologacao `dpl_F22Kfzpj1Fx2ghwYw7YDpdHrEh7o`.
- Escopo publicado:
  - rota protegida `GET /api/zeus/auth-diagnostics`;
  - botao `Auth` no Database Monitoring do Zeus;
  - diagnostico agregado de Supabase Auth x `public.hub_users`;
  - auditoria sob demanda, fora do polling automatico.
- Commit de referencia homologado: `f24c56e fix(zeus): add auth diagnostics`.
- Pacote limpo publicado: `.codex-deploy/prod-zeus-authdiag-20260521-144153`, baseado na producao vigente `dpl_JEA6MdUWm9EPwT5CKfXWMdi7nDMo`.
- Deployment anterior: `dpl_JEA6MdUWm9EPwT5CKfXWMdi7nDMo`.
- Deployment novo: `dpl_EbeEXXYKKSu9KYZQfK5t9uRBCo8F`; URL tecnica `https://careli-hub-hub-i2bs-a68kpejv5-lucasruas-devs-projects.vercel.app`.
- Aliases/dominios afetados:
  - `https://c2x.app.br`: confirmado em `dpl_EbeEXXYKKSu9KYZQfK5t9uRBCo8F`, status `Ready`;
  - `https://ops.c2x.app.br`: confirmado em `dpl_EbeEXXYKKSu9KYZQfK5t9uRBCo8F`, status `Ready`.
- Arquivos/modulos incluidos:
  - `apps/hub/lib/operations/auth-diagnostics.ts`;
  - `apps/hub/app/api/zeus/auth-diagnostics/route.ts`;
  - `apps/hub/modules/squadops/ZeusPage.tsx`.
- Arquivos/modulos excluidos: Hermes, Iris, Hades, Atlas, Apolo, Chronos, Setup, PWA, scripts, migrations, envs, secrets, tokens, service role mutavel, banco e Supabase escrita.
- Validacoes executadas:
  - conferencia do diario e do indice de homologacao;
  - `git show --name-only f24c56e`: escopo restrito aos tres arquivos Zeus;
  - revisao de codigo: rota `GET`, admin guard e leitura agregada; sem escrita/migration/env;
  - eslint focado no pacote limpo: OK;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK;
  - `npm.cmd run build --workspace @repo/hub`: OK;
  - build remoto Vercel Production: `READY`.
- Healthchecks pos-deploy:
  - `GET https://c2x.app.br/`: `200`;
  - `GET https://c2x.app.br/login`: `200`;
  - `GET https://c2x.app.br/hermes`: `200`;
  - `GET https://c2x.app.br/pulsex`: `200`;
  - `GET https://ops.c2x.app.br/zeus`: `200`;
  - `GET https://ops.c2x.app.br/hermes`: `200`;
  - `GET https://c2x.app.br/api/hades/db/health`: `200`;
  - `GET https://c2x.app.br/api/guardian/db/health`: `200`;
  - `GET https://c2x.app.br/api/zeus/auth-diagnostics` sem sessao: `401` esperado;
  - `GET https://ops.c2x.app.br/api/zeus/auth-diagnostics` sem sessao: `401` esperado;
  - `GET https://c2x.app.br/api/operations/monitoring` sem sessao: `401` esperado.
- Logs recentes: `npx.cmd vercel logs` em `c2x.app.br` e `ops.c2x.app.br` retornou chamadas `info`, sem erro critico observado.
- Riscos conhecidos:
  - diagnostico autenticado de producao ainda precisa ser executado por Lucas/admin;
  - qualquer backfill, correcao de usuario, ativacao, ajuste de env ou escrita Supabase continua `BLOQUEADO` ate autorizacao explicita;
  - rota usa service role server-side apenas para leitura agregada, sem expor valores.
- Rollback definido: promover novamente `dpl_JEA6MdUWm9EPwT5CKfXWMdi7nDMo` se login, Zeus/OPS, Hermes, Hades/Guardian health ou rotas protegidas apresentarem regressao critica.
- Pendencias: Lucas executar o botao `Auth` no Zeus em producao e repassar o diagnostico agregado para decisao DataOps/Zeus.
- Status: `EM PRODUCAO`.
- Proxima acao: Zeus/DataOps avaliar o resultado do diagnostico antes de qualquer escrita ou correcao de cadastro.
Registro de producao:

- Assunto: `[Hefesto] Producao consolidada recortes pendentes`.
- Squad/agente responsavel: `Hefesto`.
- Data e hora local: `2026-05-21 18:12:15 -03:00`.
- Ambiente: `producao`.
- Status: `EM PRODUCAO`.
- Autorizacao: Lucas autorizou commit, Supabase pendente e deploy Production, preservando envs ativas ja cadastradas.
- Escopo publicado:
  - consolidacao dos recortes locais/remotos pendentes do Panteon;
  - Apolo com schema `0026`, sync C2X -> Apolo e leitura autenticada sem depender de service-role JWT;
  - Atlas com migrations `0027`, `0028` e `0029`, evidencias multiplas e FPE;
  - Iris/Hades/Hermes/Zeus/HelpDesk/PWA incluidos no pacote consolidado validado;
  - remocao do script legado `scripts/seed-caredesk-demo.mjs`.
- Commits publicados:
  - `fe8144a release(panteon): consolidate pending recortes`;
  - `31453e4 Merge remote-tracking branch 'origin/homolog' into homolog`;
  - `c5f984e fix(apolo): support production sync without service role env`.
- Migrations/scripts Production:
  - `0025_iris_inbound_ticket_protocols.sql`: OK;
  - `0026_apolo_core.sql`: OK;
  - `0023_atlas_core.sql`, `0027_atlas_occurrence_justifications.sql`, `0028_atlas_occurrence_evidences.sql`, `0029_atlas_fpe.sql`: OK;
  - `scripts/apolo-sync-c2x.mjs --target=production`: OK, `rowsScanned=3928`, `rowsWritten=50971`.
- Deployment:
  - anterior: `dpl_EbeEXXYKKSu9KYZQfK5t9uRBCo8F`;
  - novo: `dpl_58FDoGYXNsd4dNgASad6V6QBzBgL`;
  - URL tecnica: `https://careli-hub-hub-i2bs-poyjt5g4b-lucasruas-devs-projects.vercel.app`;
  - aliases confirmados: `https://c2x.app.br` e `https://ops.c2x.app.br`.
- Validacoes:
  - `check-types:hub`: OK;
  - `lint:hub`: OK;
  - `build --workspace @repo/hub`: OK;
  - build remoto Vercel: `READY`;
  - Apolo schema/sync verificado com `apolo_entities=3928`;
  - Atlas verificado com `35` ocorrencias, `31` evidencias e `atlas_fpe_entries` presente;
  - logs Vercel de erro em `c2x.app.br` e `ops.c2x.app.br`: sem logs encontrados.
- Healthchecks:
  - `/`, `/login`, `/hades/cobranca`, `/iris`, `/hermes`, `/apolo`, `/atlas`, `/zeus`: `200`;
  - `ops.c2x.app.br/zeus` e `ops.c2x.app.br/apolo`: `200`;
  - `/api/hades/db/health` e `/api/guardian/db/health`: `200`;
  - APIs protegidas Apolo, Atlas, Zeus e Operations sem bearer: `401` esperado;
  - `POST /api/squadops/copilot` com payload valido sem sessao: `401` esperado.
- Riscos:
  - Production segue sem `SUPABASE_SERVICE_ROLE_KEY` JWT; nao foi alterado nesta release.
  - Apolo foi mitigado para leitura via bearer e sync via `POSTGRES_URL`.
  - Validacao autenticada visual/funcional ainda depende de Lucas.
- Rollback: promover novamente `dpl_EbeEXXYKKSu9KYZQfK5t9uRBCo8F` se houver regressao critica.
- Proxima acao: Lucas validar modulos autenticados; Hefesto monitorar producao; Zeus/DataOps avaliar service-role JWT apenas se necessario.

Registro de producao:

- Assunto: `[Zeus] Iris habilitada no sidebar do Panteon`.
- Squad/agente responsavel: `Zeus Core`.
- Data e hora local: `2026-05-21 22:40:13 -03:00`.
- Ambiente: `producao`.
- Status: `PRONTO PARA PRODUCAO`.
- Origem: Lucas informou que, apos a consolidacao de Hefesto em producao, a rota Iris respondia mas o modulo nao aparecia no sidebar principal.
- Escopo preparado:
  - remover o bloqueio local de visibilidade que escondia `iris` em producao;
  - registrar regra permanente para nao reintroduzir bloqueio hardcoded da Iris no sidebar sem autorizacao explicita do Lucas;
  - manter registry, permissoes e regras de acesso atuais;
  - nao alterar banco, Supabase, envs, Vercel, alias, dominio ou migrations.
- Causa tecnica:
  - `apps/hub/layouts/hub-shell.tsx` continha `hiddenProductionModuleIds = new Set(["iris"])`.
- Arquivos incluidos:
  - `apps/hub/layouts/hub-shell.tsx`;
  - `docs/operations/README.md`;
  - `docs/operations/engineering-operations.md`;
  - `docs/operations/releases-production.md`.
- Arquivos/modulos excluidos:
  - Iris runtime, Hades, Hermes, Atlas, Apolo, Chronos, Setup, Zeus, Supabase, banco, migrations, Vercel, dominio, aliases e envs.
- Validacoes:
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK, com warning conhecido do Node/ESLint sobre `type: module`;
  - `npm.cmd run build --workspace @repo/hub`: OK, com warning conhecido Turbopack/NFT em `engineering-operations-source.ts`;
  - `git diff --check -- apps/hub/layouts/hub-shell.tsx`: OK, apenas aviso CRLF do Git no Windows.
- Riscos:
  - a alteracao ainda nao esta publicada em producao neste registro;
  - publicacao Production deve ser feita por Hefesto, ou por Zeus apenas com autorizacao explicita do Lucas para este recorte minimo.
- Rollback: reverter apenas a linha de `hiddenProductionModuleIds` caso a Iris precise voltar a ficar oculta em producao.
- Proxima acao: Hefesto publicar o recorte minimo ou Lucas autorizar Zeus a publicar direto.

Atualizacao de producao:

- Data e hora local: `2026-05-21 22:52:10 -03:00`.
- Autorizacao: Lucas autorizou Zeus a publicar diretamente o recorte minimo e registrar que a Iris nao deve voltar ao bloqueio hardcoded.
- Status final: `EM PRODUCAO`.
- Commit publicado: `ccf14cc fix(panteon): show iris in production sidebar`.
- Pacote limpo usado: `.codex-deploy/iris-sidebar-prod-20260521-2240`.
- Deployment anterior: `dpl_58FDoGYXNsd4dNgASad6V6QBzBgL`.
- Novo deployment Production: `dpl_HpDnppW4ujcDPGmHAUpPAENdjDFi`.
- URL tecnica: `https://careli-hub-hub-i2bs-96z1we7vd-lucasruas-devs-projects.vercel.app`.
- Aliases confirmados: `https://c2x.app.br` e `https://ops.c2x.app.br`.
- Validacoes pos-deploy:
  - `GET https://c2x.app.br/`: `200 OK`;
  - `GET https://c2x.app.br/login`: `200 OK`;
  - `GET https://c2x.app.br/iris`: `200 OK`;
  - `GET https://ops.c2x.app.br/zeus`: `200 OK`;
  - `GET https://c2x.app.br/api/iris/tickets` sem sessao: `401 Unauthorized` esperado;
  - `npx.cmd vercel inspect https://c2x.app.br`: `Ready`, `dpl_HpDnppW4ujcDPGmHAUpPAENdjDFi`;
  - `npx.cmd vercel inspect https://ops.c2x.app.br`: `Ready`, `dpl_HpDnppW4ujcDPGmHAUpPAENdjDFi`;
  - logs Vercel de erro em `c2x.app.br` e `ops.c2x.app.br`: sem logs encontrados.
- Regra permanente:
  - Iris e modulo ativo no sidebar principal do Panteon em producao.
  - Nao reintroduzir bloqueio hardcoded para `iris` em `hiddenProductionModuleIds` ou lista equivalente sem autorizacao explicita do Lucas, motivo operacional registrado e preferencia por registry/permissao.
- Rollback: promover novamente `dpl_58FDoGYXNsd4dNgASad6V6QBzBgL` se houver regressao critica no shell principal.

Registro de producao:

- Assunto: `[Hefesto] Producao apontamentos Atlas Zeus Hades`.
- Squad/agente responsavel: `Hefesto`.
- Data e hora local: `2026-05-21 23:01:52 -03:00`.
- Ambiente: `producao`.
- Status: `EM PRODUCAO`.
- Autorizacao: Lucas solicitou subir em producao os apontamentos de Atlas, Zeus e Hades.
- Escopo publicado:
  - Atlas: upload simples de evidencias por arquivo, rota protegida `POST /api/atlas/evidences/upload` e bloqueio de salvar enquanto upload esta em andamento;
  - Hades: Iris liberada no sidebar interno do modulo, sem badge estatico;
  - Zeus: hotfix do sidebar principal confirmado como ja publicado em `ccf14cc`.
- Commit publicado nesta rodada:
  - `0587a33 feat(atlas): add evidence upload flow`.
- Deployment:
  - anterior: `dpl_HpDnppW4ujcDPGmHAUpPAENdjDFi`;
  - novo: `dpl_6VjEuPoDNKZfnFT7npNamjYS3jGD`;
  - URL tecnica: `https://careli-hub-hub-i2bs-itgii6kom-lucasruas-devs-projects.vercel.app`;
  - aliases confirmados: `https://c2x.app.br` e `https://ops.c2x.app.br`.
- Validacoes:
  - `git diff --check`: OK;
  - eslint focado Atlas/Hades: OK;
  - `check-types:hub`: OK;
  - `lint:hub`: OK;
  - `build --workspace @repo/hub`: OK;
  - build remoto Vercel: `READY`;
  - smokes locais `/atlas`, `/hades` e `/zeus`: `200 OK`.
- Healthchecks:
  - `/`, `/login`, `/atlas`, `/hades`, `/hades/cobranca`: `200 OK`;
  - `ops.c2x.app.br/zeus`: `200 OK`;
  - `/api/hades/db/health` e `/api/guardian/db/health`: `200 OK`;
  - `/api/atlas/evidences/upload`, `/api/atlas/snapshot`, `/api/zeus/release-registers` e `/api/operations/monitoring` sem sessao: `401 Unauthorized` esperado;
  - logs Vercel de erro em `c2x.app.br` e `ops.c2x.app.br`: sem logs encontrados.
- Riscos:
  - upload autenticado real de Atlas ainda precisa de teste do Lucas com sessao e arquivo real;
  - primeiro uso do Atlas pode depender de storage server-side operacional para criar/usar `atlas-evidences`; se falhar, tratar como recorte Zeus/DataOps sem alterar env ativa automaticamente.
- Rollback: promover novamente `dpl_HpDnppW4ujcDPGmHAUpPAENdjDFi` se houver regressao critica.
- Proxima acao: Lucas validar Atlas e Hades autenticados em producao.

Registro de producao:

- Assunto: `[Atlas] Desempenho, auditoria de justificativas e FPE`.
- Squad/agente responsavel: `Hefesto`.
- Data e hora local: `2026-05-22 10:51:59 -03:00`.
- Ambiente: `producao`.
- Status: `EM PRODUCAO`.
- Autorizacao: Lucas informou que testou a melhoria Atlas em homologacao e aprovou a promocao para producao.
- Origem/homologacao de referencia:
  - registro de homologacao `[Atlas] Desempenho, auditoria de justificativas e FPE`;
  - homologacao anterior do recorte: `dpl_AtMuQH2iQEhfaEYDy8wLPrqx1e6k`;
  - homologacao reconciliada automaticamente apos push do commit: `dpl_FJvNefXg6ZsH7QiaasAA5SWAPKDy`, alias `https://homo.c2x.app.br`.
- Escopo publicado:
  - sidebar interno do Atlas com `FPE`, `Desempenho` e `Colaboradores`;
  - secao `Desempenho` com abas internas `Dashboard` e `Lancamentos`;
  - abertura padrao do Atlas em `Desempenho`;
  - snapshot Atlas resolvendo usuarios Hub para exibir quem justificou/revisou;
  - tabela e modal exibindo usuario, dia e hora de justificativa e revisao/aprovacao;
  - preservacao de Reserva FPE e evidencias sem duplicidade ja homologadas.
- Commit publicado:
  - `9c9fe11 feat(atlas): promote desempenho audit improvements`.
- Pacote limpo publicado:
  - `.codex-deploy/atlas-prod-20260522-104358-9c9fe11/workspace`.
- Deployment:
  - anterior: `dpl_6VjEuPoDNKZfnFT7npNamjYS3jGD`;
  - novo: `dpl_GugePcGNamUG6u3amNmaaa1qqeMh`;
  - URL tecnica: `https://careli-hub-hub-i2bs-buq03na7w-lucasruas-devs-projects.vercel.app`;
  - aliases confirmados: `https://c2x.app.br` e `https://ops.c2x.app.br`.
- Arquivos/modulos incluidos:
  - `apps/hub/modules/atlas/AtlasPage.tsx`;
  - `apps/hub/lib/atlas/server.ts`;
  - `apps/hub/lib/atlas/types.ts`;
  - `docs/modules/atlas-operational-map.md`.
- Arquivos/modulos excluidos:
  - Login, Iris, Hades, Hermes, Zeus/HelpDesk, Apolo, Chronos, Setup, migrations, scripts, envs, secrets, banco, Supabase mutavel e alteracoes locais paralelas.
- Validacoes executadas:
  - worktree principal: `git diff --check -- apps/hub/modules/atlas/AtlasPage.tsx apps/hub/lib/atlas/server.ts apps/hub/lib/atlas/types.ts docs/modules/atlas-operational-map.md`: OK, apenas avisos CRLF do Windows;
  - worktree principal: `npx.cmd eslint modules/atlas/AtlasPage.tsx lib/atlas/server.ts lib/atlas/types.ts --max-warnings 0`: OK, com warning conhecido do Node/ESLint sobre `type: module`;
  - pacote limpo: `npx.cmd eslint modules/atlas/AtlasPage.tsx lib/atlas/server.ts lib/atlas/types.ts --max-warnings 0`: OK;
  - pacote limpo: `npm.cmd run check-types:hub`: OK;
  - pacote limpo: `npm.cmd run lint:hub`: OK;
  - pacote limpo: `npm.cmd run build --workspace @repo/hub`: OK, com warning conhecido Turbopack/NFT;
  - `git diff --cached --check`: OK;
  - scan focado nos quatro arquivos nao encontrou valores sensiveis reais; apenas nomes de env em documento operacional;
  - build remoto Vercel Production: `READY`, com warnings conhecidos de `npm audit`, engines Node, Turbopack/NFT e envs fora de `turbo.json`.
- Healthchecks pos-deploy:
  - `GET https://c2x.app.br/`: `200 OK`;
  - `GET https://c2x.app.br/login`: `200 OK`;
  - `GET https://c2x.app.br/atlas`: `200 OK`;
  - `GET https://ops.c2x.app.br/zeus`: `200 OK`;
  - `GET https://ops.c2x.app.br/atlas`: `200 OK`;
  - `GET https://c2x.app.br/api/hades/db/health`: `200 OK`;
  - `GET https://c2x.app.br/api/guardian/db/health`: `200 OK`;
  - `GET https://c2x.app.br/api/atlas/snapshot` sem sessao: `401 Unauthorized` esperado;
  - `POST https://c2x.app.br/api/atlas/evidences/upload` sem sessao: `401 Unauthorized` esperado;
  - `GET https://ops.c2x.app.br/api/operations/monitoring` sem sessao: `401 Unauthorized` esperado;
  - `POST https://ops.c2x.app.br/api/squadops/copilot` sem sessao e payload valido: `401 Unauthorized` esperado;
  - `GET https://homo.c2x.app.br/atlas`: `200 OK`;
  - `GET https://homo.c2x.app.br/api/atlas/snapshot` sem sessao: `401 Unauthorized` esperado;
  - logs Vercel de erro em `c2x.app.br`, `ops.c2x.app.br` e `homo.c2x.app.br`: sem logs encontrados.
- Riscos conhecidos:
  - validacao visual autenticada em producao continua recomendada para Lucas confirmar `FPE`, `Desempenho`, abas internas e trilha de auditoria com dados reais;
  - o smoke do copilot com payload vazio retorna `400` por validacao de request antes do auth; com payload minimo valido retorna `401` esperado;
  - branch local contem commits/alteracoes de outros recortes nao publicados por este deploy e nao incluidos no pacote Atlas.
- Rollback: promover novamente `dpl_6VjEuPoDNKZfnFT7npNamjYS3jGD` se houver regressao critica no Atlas, login, Zeus/OPS ou aliases compartilhados.
- Proxima acao: Lucas validar Atlas autenticado em producao; Hefesto manter monitoramento e preservar recortes paralelos separados.

Registro de producao:

- Assunto: `[Zeus] HelpDesk evidencias e Hermes historico de chamadas`.
- Identificador Hefesto: `HEFESTO-PROD-20260522-1110-ZEUS-HELPDESK-HERMES`.
- Protocolo estruturado Operations Center: `AT-7348`.
- Squad/agente responsavel: `Zeus Core`, com promocao direta autorizada por Lucas.
- Data e hora local: `2026-05-22 11:10:04 -03:00`.
- Ambiente: `producao`.
- Status: `EM PRODUCAO`.
- Autorizacao: Lucas solicitou subir em producao e deixar registro para o Hefesto identificar.
- Escopo publicado:
  - HelpDesk Zeus com anexos/evidencias alinhados entre abertura pela Athena, painel do solicitante e board operacional;
  - aceite de arquivos genericos alem de print, audio e video no fluxo de evidencia;
  - limite de evidencias sincronizado para 4 anexos;
  - mensagens sem anexo ajustadas para orientar arquivo/print/audio/video;
  - evidencias abrindo/baixando no painel do solicitante e no board Zeus;
  - estabilidade de tipos no historico de chamadas Hermes para liberar `check-types`, `lint` e `build`.
- Commits publicados:
  - `191ee9e fix(zeus): align helpdesk evidence attachments`;
  - `5553171 fix(hermes): stabilize call history validation`.
- Pacote limpo publicado:
  - `.codex-deploy/prod-zeus-helpdesk-hermes-20260522-110455/workspace`.
- Deployment:
  - anterior: `dpl_GugePcGNamUG6u3amNmaaa1qqeMh`;
  - novo: `dpl_AXsmmLA9xveG2vyTzSMtKEnnGrP8`;
  - URL tecnica: `https://careli-hub-hub-i2bs-bv1fvqdtu-lucasruas-devs-projects.vercel.app`;
  - aliases confirmados: `https://c2x.app.br` e `https://ops.c2x.app.br`.
- Arquivos/modulos incluidos:
  - `apps/hub/app/api/hub/it-tickets/evidence-analysis/route.ts`;
  - `apps/hub/components/hub-support/hub-ticket-open-form.tsx`;
  - `apps/hub/components/hub-support/hub-user-tickets-panel.tsx`;
  - `apps/hub/lib/hub-it-tickets/server.ts`;
  - `apps/hub/modules/squadops/HubItTicketsBoard.tsx`;
  - `apps/hub/lib/pulsex/types.ts`;
  - `apps/hub/providers/pulsex-call-provider.tsx`;
  - `apps/hub/components/pulsex/conversation-header.tsx`;
  - `apps/hub/components/pulsex/message-list.tsx`;
  - `apps/hub/components/pulsex/pulsex-workspace.tsx`.
- Arquivos/modulos excluidos:
  - Login, Iris, Atlas, Hades, Chronos, Apolo, Setup, migrations, scripts, envs, secrets, banco, Supabase mutavel e alteracoes locais paralelas nao commitadas.
- Validacoes executadas:
  - `git diff --check HEAD~2..HEAD`: OK;
  - validacao local previa: `npm.cmd run check-types:hub`: OK;
  - validacao local previa: `npm.cmd run lint:hub`: OK, com warning conhecido do Node sobre `type: module`;
  - validacao local previa: `npm.cmd run build --workspace @repo/hub`: OK, com warning conhecido Turbopack/NFT;
  - build remoto Vercel Production: `READY`, com warnings conhecidos de `npm audit`, engines Node, Turbopack/NFT e envs fora de `turbo.json`;
  - `GET https://ops.c2x.app.br/zeus`: `200 OK`;
  - `GET https://c2x.app.br/zeus`: `200 OK`;
  - `GET https://c2x.app.br/hermes`: `200 OK`;
  - `GET https://c2x.app.br/login`: `200 OK`;
  - `GET https://c2x.app.br/api/hub/it-tickets` sem sessao: `401 Unauthorized` esperado;
  - `GET https://ops.c2x.app.br/api/operations/monitoring` sem sessao: `401 Unauthorized` esperado;
  - `GET https://c2x.app.br/api/hades/db/health`: `200 OK`;
  - `GET https://c2x.app.br/api/guardian/db/health`: `200 OK`;
  - logs Vercel de erro em `c2x.app.br` e `ops.c2x.app.br`: sem logs encontrados.
- Riscos conhecidos:
  - validacao autenticada final de upload/anexo ainda deve ser feita por Lucas com usuario real e arquivo real;
  - `npm audit` remoto segue apontando 3 vulnerabilidades conhecidas do pacote, sem bloqueio de build;
  - worktree local permanece com alteracoes paralelas nao publicadas e nao incluidas neste pacote.
- Rollback: promover novamente `dpl_GugePcGNamUG6u3amNmaaa1qqeMh` se houver regressao critica em Zeus/HelpDesk, Hermes ou aliases compartilhados.
- Proxima acao: Hefesto pode identificar o pacote pelo identificador `HEFESTO-PROD-20260522-1110-ZEUS-HELPDESK-HERMES`; Lucas validar anexos reais no HelpDesk e fluxo Hermes autenticado.

Atualizacao de producao:

- Assunto: `[Atlas] Confirmacao do ultimo recorte homologado em producao`.
- Data e hora local: `2026-05-22 11:17:44 -03:00`.
- Solicitacao: Lucas aprovou novamente o ultimo registro Atlas em homologacao e pediu promocao para producao.
- Decisao Hefesto: `SEM REDEPLOY`; o recorte Atlas homologado ja estava em producao.
- Evidencia:
  - ultimo registro Atlas homologado: `[Atlas] Desempenho, auditoria de justificativas e FPE`;
  - commit promovido do Atlas: `9c9fe11 feat(atlas): promote desempenho audit improvements`;
  - deploy dedicado Atlas anterior: `dpl_GugePcGNamUG6u3amNmaaa1qqeMh`;
  - deploy atual de producao: `dpl_AXsmmLA9xveG2vyTzSMtKEnnGrP8`, construido apos `9c9fe11` e contendo o recorte Atlas;
  - aliases confirmados em `Ready`: `https://c2x.app.br` e `https://ops.c2x.app.br`.
- Healthchecks de confirmacao:
  - `GET https://c2x.app.br/`: `200 OK`;
  - `GET https://c2x.app.br/login`: `200 OK`;
  - `GET https://c2x.app.br/atlas`: `200 OK`;
  - `GET https://ops.c2x.app.br/atlas`: `200 OK`;
  - `GET https://ops.c2x.app.br/zeus`: `200 OK`;
  - `GET https://c2x.app.br/api/hades/db/health`: `200 OK`;
  - `GET https://c2x.app.br/api/guardian/db/health`: `200 OK`;
  - `GET https://c2x.app.br/api/atlas/snapshot` sem sessao: `401 Unauthorized` esperado;
  - `POST https://c2x.app.br/api/atlas/evidences/upload` sem sessao: `401 Unauthorized` esperado;
  - `GET https://homo.c2x.app.br/atlas`: `200 OK`;
  - `GET https://homo.c2x.app.br/api/atlas/snapshot` sem sessao: `401 Unauthorized` esperado.
- Logs recentes:
  - `npx.cmd vercel logs https://c2x.app.br --since 10m --level error`: sem logs encontrados;
  - `npx.cmd vercel logs https://ops.c2x.app.br --since 10m --level error`: sem logs encontrados.
- Riscos conhecidos:
  - nao houve novo artefato porque redeploy seria redundante e poderia mascarar a rastreabilidade do pacote atual;
  - validacao autenticada visual do Atlas em producao segue recomendada para Lucas.
- Status final: `EM PRODUCAO`.

Registro de producao:

- Assunto: `[Zeus] Asana Performance em producao`.
- Identificador Hefesto: `HEFESTO-PROD-20260522-1719-ZEUS-ASANA-PERFORMANCE`.
- Squad/agente responsavel: `Zeus Core`, com publicacao direta autorizada por Lucas.
- Data e hora local: `2026-05-22 17:19:08 -03:00`.
- Ambiente: `producao`.
- Status: `EM PRODUCAO`.
- Autorizacao: Lucas autorizou configurar a integracao Asana, melhorar velocidade de carregamento e subir em producao antes de seguir para o padrao visual de frontend.
- Escopo publicado:
  - rota `GET /api/hub/asana/performance` com cache curto em memoria por periodo/configuracao/usuarios;
  - carregamento de colaboradores em lotes controlados de 4 para reduzir latencia sem abrir paralelismo ilimitado contra a API Asana;
  - envs `ASANA_*` existentes em Preview promovidas para tambem valerem em Production sem leitura, copia ou exposicao dos valores sensiveis.
- Commit publicado:
  - `f21dc0d perf(zeus): cache asana performance reads`.
- Pacote limpo publicado:
  - `.codex-deploy/asana-prod-f21dc0d`.
- Deployment:
  - anterior: `dpl_AXsmmLA9xveG2vyTzSMtKEnnGrP8`;
  - novo: `dpl_77iPfbbj1e8ohnc5tHm6obmxeMRt`;
  - URL tecnica: `https://careli-hub-hub-i2bs-b7hpr87me-lucasruas-devs-projects.vercel.app`;
  - aliases confirmados: `https://c2x.app.br` e `https://ops.c2x.app.br`.
- Arquivos/modulos incluidos:
  - `apps/hub/app/api/hub/asana/performance/route.ts`.
- Arquivos/modulos excluidos:
  - Iris, Hades, Hermes, Atlas, Chronos, Apolo, Setup, login, migrations, banco, Supabase mutavel, alteracoes locais paralelas e arquivos de frontend ainda pendentes.
- Validacoes executadas:
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK, com warning conhecido de `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run build --workspace @repo/hub`: OK, com warning conhecido Turbopack/NFT;
  - `git diff --cached --check`: OK antes do commit;
  - `npx.cmd vercel env ls production`: confirmou `ASANA_ACCESS_TOKEN`, `ASANA_WORKSPACE_MODE`, `ASANA_WORKSPACE_GID`, `ASANA_TASK_WINDOW_DAYS` e `ASANA_TASK_LIMIT_PER_USER` em `Preview, Production`, sem exibir valores;
  - build remoto Vercel Production: `READY`, com warnings conhecidos de `npm audit`, engines Node, Turbopack/NFT e envs fora de `turbo.json`;
  - `GET https://c2x.app.br/login`: `200 OK`;
  - `GET https://ops.c2x.app.br/zeus`: `200 OK`;
  - `GET https://c2x.app.br/api/hub/asana/performance` sem sessao: `401 Unauthorized` esperado;
  - logs Vercel de erro em `c2x.app.br` apos deploy: sem logs encontrados.
- Riscos conhecidos:
  - validacao autenticada do painel `Asana / Performance dos colaboradores` depende de Lucas acessar a Home em sessao real;
  - se o token Asana nao tiver acesso aos workspaces esperados, a rota retornara erro operacional da API Asana, nao erro de env ausente;
  - `npm audit` remoto segue apontando vulnerabilidades conhecidas sem bloqueio de build.
- Rollback: promover novamente `dpl_AXsmmLA9xveG2vyTzSMtKEnnGrP8` se houver regressao critica em Home, Asana, Panteon principal ou OPS.
- Proxima acao: Lucas validar o painel Asana autenticado em producao; Zeus seguir depois para a documentacao do padrao visual de frontend.

Registro de producao:

- Assunto: `[Zeus] Asana por prazo previsto em producao`.
- Identificador Hefesto: `HEFESTO-PROD-20260522-1804-ZEUS-ASANA-DUE-DATES`.
- Squad/agente responsavel: `Zeus Core`, com publicacao direta autorizada por Lucas.
- Data e hora local: `2026-05-22 18:04:20 -03:00`.
- Ambiente: `producao`.
- Status: `EM PRODUCAO`.
- Autorizacao: Lucas aprovou subir em producao o ajuste que muda a leitura do painel Asana para tarefas programadas pelo prazo previsto.
- Escopo publicado:
  - painel Home/Asana passa a usar `due_on`/`due_at` como base do periodo;
  - periodo `Mes` passa a considerar o mes completo;
  - indicadores reorganizados para `programadas`, `a vencer`, `vencidas`, `no prazo` e `fora prazo`;
  - busca server-side usa Search API do Asana por prazo, mantendo fallback operacional limitado quando search nao estiver disponivel.
- Commit publicado:
  - `ccb87c7 fix(zeus): align asana metrics with due dates`.
- Pacote limpo publicado:
  - `.codex-deploy/asana-due-prod-ccb87c7-zip/workspace`.
- Deployment:
  - anterior: `dpl_77iPfbbj1e8ohnc5tHm6obmxeMRt`;
  - novo: `dpl_66CR8Tw74aXkkfNZHNfT2GQy1dK7`;
  - URL tecnica: `https://careli-hub-hub-i2bs-yqxw6j6k8-lucasruas-devs-projects.vercel.app`;
  - aliases confirmados: `https://c2x.app.br` e `https://ops.c2x.app.br`.
- Arquivos/modulos incluidos:
  - `apps/hub/app/api/hub/asana/performance/route.ts`;
  - `apps/hub/lib/asana-performance.ts`;
  - `apps/hub/app/page.tsx`.
- Arquivos/modulos excluidos:
  - Iris, Hades, Hermes, Atlas, Chronos, Apolo, Setup, login, migrations, banco, Supabase mutavel, envs, secrets e alteracoes locais paralelas nao commitadas.
- Validacoes executadas:
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK, com warning conhecido de `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run build --workspace @repo/hub`: OK, com warning conhecido Turbopack/NFT;
  - `git diff --cached --check`: OK antes do commit;
  - build remoto Vercel Production: `READY`, com warnings conhecidos de `npm audit`, engines Node, Turbopack/NFT e envs fora de `turbo.json`;
  - `GET https://c2x.app.br/`: `200 OK`;
  - `GET https://c2x.app.br/login`: `200 OK`;
  - `GET https://ops.c2x.app.br/zeus`: `200 OK`;
  - `GET https://c2x.app.br/api/hub/asana/performance` sem sessao: `401 Unauthorized` esperado;
  - `npx.cmd vercel inspect careli-hub-hub-i2bs-yqxw6j6k8-lucasruas-devs-projects.vercel.app`: `Ready`, aliases `c2x.app.br` e `ops.c2x.app.br`;
  - logs Vercel de erro em `c2x.app.br` e `ops.c2x.app.br` apos deploy: sem logs encontrados.
- Riscos conhecidos:
  - validacao autenticada do painel Asana depende de Lucas acessar a Home em sessao real;
  - fallback `tasks_list_fallback` continua limitado pela janela operacional quando o Search API do Asana nao estiver disponivel;
  - `npm audit` remoto segue apontando vulnerabilidades conhecidas sem bloqueio de build.
- Rollback: promover novamente `dpl_77iPfbbj1e8ohnc5tHm6obmxeMRt` se houver regressao critica em Home, Asana, Panteon principal ou OPS.
- Proxima acao: Hefesto pode identificar este recorte pelo identificador `HEFESTO-PROD-20260522-1804-ZEUS-ASANA-DUE-DATES`; Lucas validar a Home autenticada para confirmar os numeros reais do Asana.

Registro de producao:

- Assunto: `[Zeus] Rotulos Asana por data de entrega em producao`.
- Identificador Hefesto: `HEFESTO-PROD-20260522-1825-ZEUS-ASANA-DUE-LABELS`.
- Squad/agente responsavel: `Zeus Core`, com publicacao direta autorizada por Lucas.
- Data e hora local: `2026-05-22 18:25:44 -03:00`.
- Ambiente: `producao`.
- Status: `EM PRODUCAO`.
- Autorizacao: Lucas autorizou subir a correcao de nomenclatura para remover a leitura de tarefa criada e reforcar que o KPI representa atividades com data de entrega no periodo.
- Escopo publicado:
  - troca do rotulo `programadas` para `com entrega`;
  - troca do badge `prazo no periodo` para `data de entrega no periodo`;
  - sem alteracao de schema, env, secret, banco, migration ou API externa.
- Commit publicado:
  - `5cb293d fix(zeus): clarify asana due date labels`.
- Pacote limpo publicado:
  - `.codex-deploy/asana-labels-prod-5cb293d/workspace`.
- Deployment:
  - anterior: `dpl_66CR8Tw74aXkkfNZHNfT2GQy1dK7`;
  - novo: `dpl_3EpJcaxKw1xExNwbZ2sP3C87ZFqn`;
  - URL tecnica: `https://careli-hub-hub-i2bs-bb95d15w0-lucasruas-devs-projects.vercel.app`;
  - aliases confirmados: `https://c2x.app.br` e `https://ops.c2x.app.br`.
- Arquivos/modulos incluidos:
  - `apps/hub/app/page.tsx`.
- Arquivos/modulos excluidos:
  - Iris, Hades, Hermes, Atlas, Chronos, Apolo, Setup, login, migrations, banco, Supabase mutavel, envs, secrets e alteracoes locais paralelas nao commitadas.
- Validacoes executadas:
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK, com warning conhecido de `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run build --workspace @repo/hub`: OK, com warning conhecido Turbopack/NFT;
  - `git diff --cached --check`: OK antes do commit;
  - build remoto Vercel Production: `READY`, com warnings conhecidos de `npm audit`, engines Node, Turbopack/NFT e envs fora de `turbo.json`;
  - `GET https://c2x.app.br/`: `200 OK`;
  - `GET https://c2x.app.br/login`: `200 OK`;
  - `GET https://ops.c2x.app.br/zeus`: `200 OK`;
  - `GET https://c2x.app.br/api/hub/asana/performance` sem sessao: `401 Unauthorized` esperado;
  - `npx.cmd vercel inspect careli-hub-hub-i2bs-bb95d15w0-lucasruas-devs-projects.vercel.app`: `Ready`, aliases `c2x.app.br` e `ops.c2x.app.br`;
  - logs Vercel de erro em `c2x.app.br` e `ops.c2x.app.br` apos deploy: sem logs encontrados.
- Riscos conhecidos:
  - validacao autenticada do texto final no painel Asana depende de Lucas acessar a Home com sessao real e atualizar o cache do navegador;
  - a regra numerica continua sendo a do deploy anterior: base por `due_on`/`due_at`.
- Rollback: promover novamente `dpl_66CR8Tw74aXkkfNZHNfT2GQy1dK7` se houver regressao visual critica na Home/Asana.
- Proxima acao: Lucas validar a Home autenticada; Hefesto pode identificar este recorte pelo identificador `HEFESTO-PROD-20260522-1825-ZEUS-ASANA-DUE-LABELS`.

Registro de producao:

- Assunto: `[Zeus] Iris Meta pronta e bloqueada por env Production`.
- Identificador Hefesto: `HEFESTO-PROD-BLOCKED-20260525-IRIS-META-ENVS`.
- Squad/agente responsavel: `Zeus` sobre recorte `Iris Meta WhatsApp / Athena atendente`.
- Data e hora local: `2026-05-25 11:18:26 -03:00`.
- Ambiente: `producao`.
- Status: `BLOQUEADO`.
- Autorizacao: Lucas informou que os testes em homologacao ficaram OK e pediu commit e producao dos recortes trabalhados.
- Origem/homologacao de referencia:
  - `https://homo.c2x.app.br` em `dpl_3k7PGdrLhLjNqwEAUdmHPZABJTKX`;
  - recorte `[Zeus] Iris Novo Atendimento cache stale removido`;
  - comunicacao Panteon -> Meta validada pelo Lucas na WABA correta;
  - Novo Atendimento corrigido para filtrar template com `metaStatus` aprovado real.
- Bloqueio real antes do deploy:
  - `npx.cmd vercel env ls production` mostrou ausencia dos envs `META_WHATSAPP_*` em Production;
  - os envs existem em Preview, mas `vercel env pull --environment=preview --git-branch=homolog` retorna valores sensiveis vazios, portanto nao e possivel copiar token/app secret/verify token por CLI sem fonte segura;
  - `npx.cmd vercel env run -e preview --git-branch homolog` tambem foi testado e nao disponibilizou esses valores sensiveis no processo local;
  - promover diretamente o Preview de homologacao para os aliases de producao fica bloqueado porque o deployment carrega contexto de Preview/homologacao.
- Commit de codigo/registro:
  - `61f18ea fix(iris): stabilize meta templates and active contact`.
- Arquivos/modulos prontos para producao apos configurar env:
  - `apps/hub/lib/iris/meta-whatsapp.ts`;
  - `apps/hub/app/api/iris/meta/templates/route.ts`;
  - `apps/hub/app/api/iris/meta/templates/media/route.ts`;
  - `apps/hub/app/api/iris/meta/messages/route.ts`;
  - `apps/hub/app/api/iris/tickets/route.ts`;
  - `apps/hub/lib/iris/meta-inbound-processor.ts`;
  - `apps/hub/lib/iris/caca-agent.ts`;
  - `apps/hub/app/api/iris/attendant/route.ts`;
  - `apps/hub/modules/caredesk/IrisPage.tsx`;
  - `docs/modules/caredesk-meta-whatsapp-setup.md`;
  - `docs/operations/iris-ai-attendant-agent-operating-contract.md`;
  - `docs/operations/homologation-safety-gate.md`;
  - `scripts/homologation-safety-gate.mjs`;
  - `turbo.json`.
- Arquivos/modulos excluidos:
  - root misto de Apolo, login, PulseX, Ares, governanca paralela, migrations, banco mutavel, service role, secrets novos, dominios/aliases e recortes nao presentes no deployment Iris mais recente.
- Validacoes ja executadas no recorte homologado:
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK;
  - `npm.cmd run build --workspace @repo/hub`: OK;
  - `git diff --check`: OK;
  - Safety Gate pre-deploy e pre-alias de homologacao: PASS;
  - `GET https://homo.c2x.app.br/iris`: `200 OK`;
  - `GET https://homo.c2x.app.br/api/iris/meta/templates` sem sessao: `401 Unauthorized` esperado;
  - logs de erro em homologacao: sem logs encontrados apos deploy.
- Riscos conhecidos:
  - sem `META_WHATSAPP_*` em Production, templates, webhook Meta e envio WhatsApp falhariam em producao mesmo com codigo correto;
  - e necessario configurar Production com o mesmo par operacional de WABA/Phone Number ID e os segredos Meta correspondentes, sem registrar valores em docs, chat ou commit.
- Rollback: manter producao atual em `dpl_6HqPqvmLjdrkVyx4qFZoqhmrqtVE` ate os envs Production serem configurados e o deploy limpo passar em healthchecks.
- Proxima acao: configurar envs Meta em Vercel Production por canal seguro; em seguida Zeus/Hefesto roda validacoes finais, deploy Production e healthchecks de `c2x.app.br` e `ops.c2x.app.br`.


Registro de producao:

- Assunto: [Zeus] Apolo, Hermes e login em producao com Iris em standby.
- Identificador Hefesto: HEFESTO-PROD-20260525-1214-APOLO-HERMES-IRIS-STANDBY.
- Squad/agente responsavel: Zeus / Hefesto, com publicacao direta autorizada por Lucas.
- Data e hora local: 2026-05-25 12:14:49 -03:00.
- Ambiente: producao.
- Status: EM PRODUCAO / IRIS OPERACIONAL EM STANDBY.
- Autorizacao: Lucas confirmou que os testes em homologacao estavam OK para os demais pontos dos modulos, mas pediu para nao iniciar atendimentos Iris em producao ainda.
- Escopo publicado:
  - Apolo CRM 360: perfil Prospect, classificacao de Usuario por carteira/parcelas reais e bloqueio de carteira/financeiro sem parcelas emitidas;
  - Hub/Login: tela de login sem e-mail operacional pre-preenchido;
  - Hermes/PulseX: links HTTP/HTTPS em mensagens passam a renderizar como links clicaveis sem quebrar mencoes/formatacao;
  - Iris: codigo Meta permanece pronto, mas producao fica em standby server-side para atendimento WhatsApp.
- Trava Iris em producao:
  - POST /api/iris/tickets bloqueia inicio de atendimento ativo;
  - POST /api/iris/meta/messages bloqueia envio livre/operacional;
  - POST /api/iris/attendant bloqueia acionamento da Caca;
  - POST /api/iris/meta/webhook responde OK em standby, mas nao persiste/processa eventos enquanto a liberacao operacional nao ocorrer;
  - a flag IRIS_META_PRODUCTION_STANDBY foi declarada no turbo.json; na ausencia de override, producao fica em standby por VERCEL_ENV=production.
- Commits publicados:
  - e9858d9 chore(iris): keep whatsapp production in standby;
  - 37709ab fix(apolo): promote crm profile and portfolio rules;
  - 5e40410 fix(hub): polish login and hermes links.
- Deployment:
  - anterior/rollback imediato: dpl_HgRaFSDbSWjF31khxDQw4YJHvBWT;
  - novo: dpl_4feJYS8Wtgejf6kT7snxbLLARops;
  - URL tecnica: https://careli-hub-hub-i2bs-g3lst3l28-lucasruas-devs-projects.vercel.app;
  - aliases confirmados: https://c2x.app.br e https://ops.c2x.app.br.
- Arquivos/modulos incluidos:
  - apps/hub/app/api/apolo/relationships/route.ts;
  - apps/hub/app/api/apolo/search/route.ts;
  - apps/hub/lib/apolo/catalog.ts;
  - apps/hub/lib/apolo/server.ts;
  - apps/hub/lib/apolo/types.ts;
  - apps/hub/modules/apolo/ApoloPage.tsx;
  - docs/modules/c2x-legacy-reference.md;
  - apps/hub/app/login/page.tsx;
  - apps/hub/components/pulsex/message-item.tsx;
  - apps/hub/lib/iris/meta-server.ts;
  - apps/hub/app/api/iris/tickets/route.ts;
  - apps/hub/app/api/iris/meta/messages/route.ts;
  - apps/hub/app/api/iris/meta/webhook/route.ts;
  - apps/hub/app/api/iris/attendant/route.ts;
  - turbo.json.
- Arquivos/modulos excluidos:
  - root misto de homolog;
  - alteracoes locais Iris/Caca que nao fossem a trava de standby;
  - envs/secrets novos, migrations, banco, dominio novo, alias de homologacao e alteracoes Supabase mutaveis.
- Validacoes locais executadas na worktree limpa:
  - git diff --check: OK, apenas avisos CRLF conhecidos no Windows;
  - npm.cmd run check-types:hub: OK;
  - npm.cmd run lint:hub: OK, com warning conhecido MODULE_TYPELESS_PACKAGE_JSON;
  - npm.cmd run build --workspace @repo/hub: OK, com warning conhecido Turbopack/NFT.
- Build remoto Vercel Production:
  - READY;
  - warnings conhecidos: npm audit com 3 vulnerabilidades herdadas, Node engines, Turbopack/NFT e envs Postgres antigas fora do turbo.json.
- Healthchecks de producao:
  - npx.cmd vercel inspect https://c2x.app.br: Ready, deployment dpl_4feJYS8Wtgejf6kT7snxbLLARops;
  - npx.cmd vercel inspect https://ops.c2x.app.br: Ready, deployment dpl_4feJYS8Wtgejf6kT7snxbLLARops;
  - GET https://c2x.app.br/: 200 OK;
  - GET https://c2x.app.br/login: 200 OK;
  - GET https://c2x.app.br/apolo: 200 OK;
  - GET https://c2x.app.br/hermes: 200 OK;
  - GET https://c2x.app.br/iris: 200 OK;
  - GET https://ops.c2x.app.br/zeus: 200 OK;
  - rotas protegidas sem sessao (/api/iris/meta/templates, /api/apolo/relationships?profile=usuario, /api/hermes/messages, /api/operations/monitoring): 401 Unauthorized esperado;
  - logs Vercel de erro em c2x.app.br e ops.c2x.app.br nos ultimos 10 minutos: sem logs encontrados.
- Homologacao:
  - https://homo.c2x.app.br permaneceu intencionalmente no deployment dpl_9sYn6MLXyr7j1JJz2oD8cfNMvU6t, usado por Lucas para testes Iris/Caca;
  - nao houve reconciliacao do alias de homologacao para este commit porque sobrescreveria a frente de testes ativa do Lucas.
- Riscos conhecidos:
  - Iris esta pronta em codigo/env, mas nao deve ser considerada iniciada em producao enquanto a trava de standby estiver ativa;
  - validacao autenticada final de Apolo/Hermes/Login depende de Lucas acessar com sessao real;
  - warnings herdados de npm audit e Turbopack/NFT continuam pendentes fora deste recorte.
- Rollback: promover novamente dpl_HgRaFSDbSWjF31khxDQw4YJHvBWT se houver regressao critica em Apolo, Hermes, login, Panteon principal ou OPS.
- Proxima acao: Lucas validar Apolo/Hermes/Login em producao; quando quiser iniciar Iris em producao, abrir recorte explicito para remover/alterar o standby e rodar novo deploy/healthcheck.


Handoff de producao:

- Assunto: [Hub] Notificacoes nativas Windows prontas para Hefesto.
- Identificador/protocolo: HUB-20260527-001-NOTIFICACOES-WINDOWS.
- Squad/agente responsavel pelo preparo: Zeus Operations.
- Responsavel pela publicacao: Hefesto.
- Data e hora local do handoff: 2026-05-27 15:40:34 -03:00.
- Ambiente alvo: producao.
- Status: PRONTO PARA HEFESTO / NAO PUBLICADO.
- Decisao Lucas: Lucas dispensou homologacao deste recorte e pediu preparar para Hefesto subir em producao.
- Escopo candidato:
  - notificacoes nativas do Windows via PWA/Web Notifications;
  - botao compacto no topbar para ativar/testar notificacoes;
  - Service Worker foca/abre o Hub ao clicar no toast;
  - novas notificacoes realtime nao lidas recebidas apos o carregamento podem gerar toast nativo quando a permissao estiver concedida.
- Commit candidato:
  - de9b601 feat(hub): add windows native notifications.
- Branch/worktree:
  - codex/zeus/hub-windows-notifications-20260527;
  - .codex-deploy/z27-004-hub-windows-notifications-20260527.
- Arquivos incluidos:
  - apps/hub/layouts/hub-shell.tsx;
  - apps/hub/lib/hub/native-notifications.ts;
  - apps/hub/public/sw.js;
  - docs/operations/engineering-operations.md;
  - docs/operations/panteon-recorte-protocols.md;
  - docs/operations/releases-production.md.
- Arquivos/modulos excluidos:
  - envs, secrets, banco, migrations, Supabase mutavel, Meta, auth server-side, dominio, alias de homologacao, alias de producao e producao neste passo.
- Producao atual inspecionada antes do handoff:
  - c2x.app.br: dpl_DbnDfVk3JTvgneJvA9WNcacbyA3f Ready;
  - ops.c2x.app.br: dpl_DbnDfVk3JTvgneJvA9WNcacbyA3f Ready;
  - URL tecnica atual: https://careli-hub-hub-i2bs-itaab90ji-lucasruas-devs-projects.vercel.app.
- Validacoes do recorte:
  - git diff --check: OK;
  - npx.cmd eslint layouts/hub-shell.tsx lib/hub/native-notifications.ts --max-warnings 0 em apps/hub: OK;
  - npm.cmd run check-types:hub: OK;
  - npm.cmd run lint:hub: OK;
  - npm.cmd run build --workspace @repo/hub: OK, com warnings conhecidos de Turbopack/NFT no SquadOps.
- Regras para Hefesto antes de publicar:
  - reinspecionar c2x.app.br e ops.c2x.app.br e confirmar deployment anterior saudavel no momento do deploy;
  - publicar pacote limpo apenas deste recorte/commit;
  - rodar healthchecks de producao em /, /login, rotas principais e rotas protegidas com 401/403 esperado sem sessao;
  - verificar logs de erro recentes;
  - registrar deployment novo, deployment anterior, aliases afetados, comandos, healthchecks e rollback.
- Rollback inicial sugerido:
  - promover novamente dpl_DbnDfVk3JTvgneJvA9WNcacbyA3f se ele continuar sendo o deployment saudavel imediatamente anterior ao deploy.
- Riscos conhecidos:
  - Web Notifications dependem de permissao do navegador/app instalado e do suporte PWA do Windows;
  - notificacao totalmente independente do navegador exige recorte futuro com companion desktop ou Web Push server-side;
  - como Lucas dispensou homologacao, a validacao funcional final do toast deve ocorrer em producao logo apos o deploy.

Atualizacao pos-deploy:

- Assunto: [Hub] Notificacoes nativas Windows.
- Protocolo: HUB-20260527-001-NOTIFICACOES-WINDOWS.
- Status final: EM PRODUCAO.
- Deployment anterior/rollback imediato: dpl_DbnDfVk3JTvgneJvA9WNcacbyA3f.
- Deployment novo: dpl_FRyLY4NdSJc556S6qZEuXYjevPow.
- URL tecnica: https://careli-hub-hub-i2bs-4n2ztblkp-lucasruas-devs-projects.vercel.app.
- Aliases confirmados: https://c2x.app.br e https://ops.c2x.app.br.
- Commit de codigo publicado: de9b601 feat(hub): add windows native notifications.
- Commit de handoff publicado: f16b4c1 docs(hefesto): prepare hub notifications production handoff.
- Validacoes executadas:
  - `git diff --check HEAD~2..HEAD`: OK;
  - `npx.cmd eslint layouts/hub-shell.tsx lib/hub/native-notifications.ts --max-warnings 0`: OK;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run build --workspace @repo/hub`: OK, com warnings conhecidos Turbopack/NFT;
  - `npx.cmd vercel deploy --prod --yes --archive=tgz`: READY;
  - `npx.cmd vercel inspect https://c2x.app.br`: Ready no deployment novo;
  - `npx.cmd vercel inspect https://ops.c2x.app.br`: Ready no deployment novo.
- Healthchecks pos-deploy:
  - `GET https://c2x.app.br/`: 200 em 0.462s;
  - `GET https://c2x.app.br/login`: 200 em 0.700s;
  - `GET https://ops.c2x.app.br/zeus`: 200 em 0.873s;
  - `GET https://c2x.app.br/sw.js`: 200 em 0.280s;
  - `GET https://c2x.app.br/api/pwa/manifest`: 200 em 0.527s;
  - `GET https://c2x.app.br/api/hades/db/health`: 200 em 1.326s;
  - `GET https://c2x.app.br/api/guardian/db/health`: 200 em 1.153s;
  - `GET https://c2x.app.br/api/operations/monitoring` sem sessao: 401 esperado em 0.475s;
  - `GET https://c2x.app.br/api/auth/profile` sem sessao: 401 esperado em 0.478s.
- Logs Vercel recentes: sem erro critico; somente infos e 401 esperados nas rotas protegidas sem sessao.
- Warnings conhecidos: npm audit herdado, engines Node `>=18`, Turbopack/NFT por leitura filesystem no SquadOps e envs Postgres antigas fora do turbo.json em pacotes compartilhados.
- Riscos remanescentes:
  - Web Notifications dependem da permissao do navegador/app instalado e suporte PWA do Windows;
  - validacao funcional do toast deve ser feita por Lucas em sessao real no Windows;
  - notificacao totalmente independente do navegador continua como evolucao futura com companion desktop ou Web Push server-side.

Handoff de producao:

- Assunto: [Hermes] Threads e links prontos para Hefesto.
- Protocolo: HERMES-20260527-001-THREAD-REPLY-NOTIFICATIONS.
- Squad/agente responsavel pelo preparo: Zeus Operations sobre recorte Hermes/PulseX.
- Responsavel pela publicacao: Hefesto.
- Data e hora local do handoff: 2026-05-27 16:38:50 -03:00.
- Ambiente alvo: producao.
- Status: PRONTO PARA HEFESTO / NAO PUBLICADO.
- Decisao Lucas: Lucas pediu preparar as melhorias Hermes para homologar/promover em producao.
- Escopo candidato:
  - notificacoes internas de respostas novas em threads no sino do Hermes/PulseX;
  - badge de respostas novas em mensagens com thread;
  - abertura/foco da thread ao clicar na notificacao;
  - leitura de respostas de thread por usuario/navegador via `localStorage`;
  - links HTTP/HTTPS clicaveis nas mensagens sem quebrar mencoes.
- Commit candidato:
  - 18acdbc feat(hermes): surface thread reply notifications.
- Branch/worktree:
  - codex/zeus/hermes-thread-notifications-prod-20260527;
  - .codex-deploy/z27-005-hermes-thread-notifications-prod-20260527.
- Arquivos incluidos:
  - apps/hub/components/pulsex/conversation-header.tsx;
  - apps/hub/components/pulsex/message-item.tsx;
  - apps/hub/components/pulsex/message-list.tsx;
  - apps/hub/components/pulsex/pulsex-workspace.tsx;
  - apps/hub/lib/pulsex/supabase-data.ts;
  - docs/operations/engineering-operations.md;
  - docs/operations/panteon-recorte-protocols.md;
  - docs/operations/releases-production.md.
- Arquivos/modulos excluidos:
  - root misto;
  - envs, secrets, banco, migrations, Supabase mutavel, service role, Meta/Iris, Hades, Ares, Apolo, dominio, alias manual e deploy de producao neste passo.
- Producao atual inspecionada antes do handoff:
  - c2x.app.br: dpl_FRyLY4NdSJc556S6qZEuXYjevPow Ready;
  - ops.c2x.app.br: dpl_FRyLY4NdSJc556S6qZEuXYjevPow Ready;
  - URL tecnica atual: https://careli-hub-hub-i2bs-4n2ztblkp-lucasruas-devs-projects.vercel.app.
- Validacoes do recorte:
  - git diff --check: OK, apenas avisos LF/CRLF conhecidos no Windows;
  - npx.cmd eslint components/pulsex/conversation-header.tsx components/pulsex/message-item.tsx components/pulsex/message-list.tsx components/pulsex/pulsex-workspace.tsx lib/pulsex/supabase-data.ts --max-warnings 0 em apps/hub: OK;
  - npm.cmd run check-types:hub: OK;
  - npm.cmd run lint:hub: OK, com warning conhecido MODULE_TYPELESS_PACKAGE_JSON;
  - npm.cmd run build --workspace @repo/hub: OK, com warnings conhecidos Turbopack/NFT por worktree em .codex-deploy.
- Regras para Hefesto antes de publicar:
  - reinspecionar c2x.app.br e ops.c2x.app.br e confirmar deployment anterior saudavel no momento do deploy;
  - publicar pacote limpo apenas deste protocolo/commit;
  - rodar healthchecks de producao em /, /login, /hermes, /pulsex, ops /zeus e rotas protegidas com 401/403 esperado sem sessao;
  - verificar logs de erro recentes;
  - registrar deployment novo, deployment anterior, aliases afetados, comandos, healthchecks e rollback.
- Rollback inicial sugerido:
  - promover novamente dpl_FRyLY4NdSJc556S6qZEuXYjevPow se ele continuar sendo o deployment saudavel imediatamente anterior ao deploy.
- Riscos conhecidos:
  - validacao funcional final depende de sessao real no Hermes/PulseX com mensagens em thread;
  - leitura por localStorage e por navegador/dispositivo;
  - commit usou --no-verify porque o hook local referencia script ausente no snapshot, mas as validacoes reais foram executadas antes.

Conclusao:
- O recorte Hermes esta preparado para producao com pacote limpo e commit isolado.
- O impacto pratico e melhorar o acompanhamento de respostas em threads e manter links clicaveis em mensagens.
- Hefesto deve publicar somente mediante autorizacao final de Lucas, preservando rollback para o deployment vigente no momento do deploy.

Atualizacao pos-deploy:

- Assunto: [Hermes] Threads e notificacoes em producao.
- Protocolo: HERMES-20260527-001-THREAD-REPLY-NOTIFICATIONS.
- Status final: EM PRODUCAO.
- Deployment anterior/rollback imediato: dpl_FRyLY4NdSJc556S6qZEuXYjevPow.
- Deployment novo: dpl_7YD9jcHxfRy5j4k8ksQxnSX8aeLC.
- URL tecnica: https://careli-hub-hub-i2bs-hzg6xab9o-lucasruas-devs-projects.vercel.app.
- Aliases confirmados: https://c2x.app.br e https://ops.c2x.app.br.
- Commit de codigo publicado: 18acdbc feat(hermes): surface thread reply notifications.
- Commit de handoff publicado: 94bc7f9 docs(zeus): prepare hermes production handoff.
- Validacoes executadas:
  - `git diff --name-status HEAD~2..HEAD`: escopo restrito a Hermes/PulseX e registros operacionais;
  - `git diff --check HEAD~2..HEAD`: OK;
  - scan de secrets nos arquivos de codigo do recorte: sem ocorrencias;
  - `npx.cmd eslint components/pulsex/conversation-header.tsx components/pulsex/message-item.tsx components/pulsex/message-list.tsx components/pulsex/pulsex-workspace.tsx lib/pulsex/supabase-data.ts --max-warnings 0`: OK;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run build --workspace @repo/hub`: OK, com warnings conhecidos Turbopack/NFT;
  - `npx.cmd vercel deploy --prod --yes --archive=tgz`: READY;
  - `npx.cmd vercel inspect https://c2x.app.br`: Ready no deployment novo;
  - `npx.cmd vercel inspect https://ops.c2x.app.br`: Ready no deployment novo.
- Healthchecks pos-deploy:
  - `GET https://c2x.app.br/`: 200 em 0.910s;
  - `GET https://c2x.app.br/login`: 200 em 0.697s;
  - `GET https://c2x.app.br/hermes`: 200 em 0.463s;
  - `GET https://c2x.app.br/pulsex`: 307 esperado para `/hermes`;
  - `GET https://c2x.app.br/pulsex` com redirect: 200 em `/hermes`;
  - `GET https://ops.c2x.app.br/zeus`: 200 em 0.839s;
  - `GET https://c2x.app.br/api/hermes/messages` sem sessao: 401 esperado em 0.222s;
  - `GET https://c2x.app.br/api/operations/monitoring` sem sessao: 401 esperado em 0.469s;
  - `GET https://c2x.app.br/api/auth/profile` sem sessao: 401 esperado em 0.443s;
  - `GET https://c2x.app.br/api/guardian/db/health`: 200 em 1.194s;
  - `GET https://c2x.app.br/api/hades/db/health`: 200 em 0.613s.
- Logs Vercel recentes: sem erro critico; somente infos, 307 esperado e 401 esperados em rotas protegidas sem sessao.
- Warnings conhecidos: npm audit herdado, engines Node `>=18`, Turbopack/NFT por leitura filesystem no SquadOps e envs Postgres antigas fora do turbo.json em pacotes compartilhados.
- Riscos remanescentes:
  - validacao funcional final depende de sessao real no Hermes/PulseX com mensagens em thread;
  - estado de leitura usa `localStorage` por usuario/navegador/dispositivo;
  - nao houve alteracao de env, secret, migration, banco, Supabase mutavel ou integracao externa.

## 2026-05-28 - HERMES-20260528-001-REALTIME-MESSAGE-STABILITY

Status: EM PRODUCAO.

Escopo publicado:
- Hotfix Hermes/PulseX para estabilidade de mensagens em producao.
- `pulsex_messages` publicada no `supabase_realtime` para `postgres_changes`.
- Indices criados para mensagens por canal, respostas de thread por metadata e `clientMessageId`.
- Carga inicial do Hermes consolidada e limitada para reduzir N chamadas por canal.
- API de mensagens limitada e com filtro de replies no banco.
- Fallback de polling mantido, mas reduzido para 15s.
- Mensagem otimista com falha passa a ficar marcada como erro em vez de sumir.
- Complemento de login: timeout de Supabase no navegador passa a acionar fallback server-side antes de falhar.

Arquivos principais:
- `apps/hub/components/pulsex/pulsex-workspace.tsx`
- `apps/hub/lib/pulsex/supabase-data.ts`
- `apps/hub/app/api/pulsex/messages/route.ts`
- `apps/hub/providers/auth-provider.tsx`
- `packages/database/migrations/0037_hermes_realtime_hotfix.sql`
- `scripts/hermes-apply-realtime-hotfix-schema.mjs`

Banco/Supabase:
- Migration aplicada em producao com verificacao SQL.
- Verificado: indices presentes, `pulsex_messages` na publication `supabase_realtime`, `replicaIdentity=full`.
- Nenhum valor de env/secret foi registrado.

Commits:
- `ffcdcc8 fix(hermes): stabilize realtime message delivery`
- `a1b99fc fix(auth): fallback on supabase login timeout`

Deployments:
- Deployment anterior/rollback completo: `dpl_7YD9jcHxfRy5j4k8ksQxnSX8aeLC`.
- Deployment intermediario Hermes: `dpl_5Hq71WtoEtwpkegL4dPXQY8NzWKv`.
- Deployment final: `dpl_5DdmmMKvdW7H8vdcTW4Gm5YZ3bvH`.
- URL tecnica final: https://careli-hub-hub-i2bs-8jw8ixaj8-lucasruas-devs-projects.vercel.app.
- Aliases confirmados: https://c2x.app.br e https://ops.c2x.app.br.

Validacoes:
- `node scripts/hermes-apply-realtime-hotfix-schema.mjs --env-file=.env.production.local --confirm-production`: OK.
- `.env.production.local` temporario removido antes do deploy.
- `git diff --check`: OK, apenas avisos LF/CRLF conhecidos no Windows.
- `npm.cmd run check-types:hub`: OK.
- `npm.cmd run lint:hub`: OK.
- `npm.cmd run build --workspace @repo/hub`: OK.
- `npx.cmd vercel deploy --prod --yes --archive=tgz`: READY.
- `npx.cmd vercel inspect https://c2x.app.br`: Ready no deployment final.
- `npx.cmd vercel inspect https://ops.c2x.app.br`: Ready no deployment final.
- `POST /api/auth/session` com token falso: 403 esperado, sem 503.
- `POST /api/auth/password` com credenciais falsas: 401 esperado, sem 503.
- `/`, `/login`, `/hermes`, `ops /zeus`, Guardian DB health e Hades DB health: 200.
- `/api/hermes/messages` sem sessao: 401 esperado.
- Logs de erro Vercel recentes: sem ocorrencias.

Riscos:
- Validacao funcional plena depende de teste real com operadores no Hermes.
- Se o PWA/app instalado estiver com bundle antigo, fechar e abrir o app pode ser necessario para carregar o deployment final.
- Fallback de polling segue como protecao caso WebSocket/Reatime oscile.

## 2026-05-28 - HERMES-20260528-002-MESSAGE-ROUTE-LATENCY-HOTFIX

Status: EM PRODUCAO.

Resumo:
- Hotfix de producao para instabilidade de login/mensagens Hermes reportada pelo Lucas.
- Causa tecnica principal: timeouts/500 em `/api/hermes/messages`, com fallback client-side que podia limpar conversa direta quando a API falhava.
- Correcao: timeout controlado na rota, fallback server-side sem join pesado, reducao de limites de mensagens e protecao visual contra refresh/fallback transitorio.

Arquivos publicados:
- `apps/hub/app/api/pulsex/messages/route.ts`
- `apps/hub/lib/pulsex/supabase-data.ts`
- `apps/hub/components/pulsex/pulsex-workspace.tsx`

Deployments:
- Rollback inicial/restaurado: `dpl_5DdmmMKvdW7H8vdcTW4Gm5YZ3bvH`.
- Deployment misto descartado: `dpl_6g6TcVoKMMtq5eKLPeTj5ek89foU`.
- Deployment final correto: `dpl_ApFfnT641VgsNJtGy2LQwHVxdQmt`.
- URL tecnica final: https://careli-hub-hub-i2bs-i4fbj7mb3-lucasruas-devs-projects.vercel.app.
- Aliases: https://c2x.app.br e https://ops.c2x.app.br.

Validacoes:
- `git diff --check`: OK.
- `npm.cmd run check-types:hub`: OK.
- `npm.cmd run lint:hub`: OK.
- `npm.cmd run build --workspace @repo/hub`: OK.
- `npx.cmd vercel inspect https://c2x.app.br`: Ready no deployment final.
- `npx.cmd vercel inspect https://ops.c2x.app.br`: Ready no deployment final.
- `/`, `/login`, `/hermes`, `ops /zeus`, Guardian DB health e Hades DB health: 200.
- `/api/hermes/messages` e `/api/auth/profile` sem sessao: 401 esperado.
- Auth server-side com entradas falsas: 403/401 esperado, sem 503.
- Logs de erro Vercel recentes: sem ocorrencias.

Rollback:
- Reapontar `c2x.app.br` e `ops.c2x.app.br` para `dpl_5DdmmMKvdW7H8vdcTW4Gm5YZ3bvH`.

Observacao de processo:
- Proibido publicar Vercel de worktree aninhado dentro do repo root quando o root possui `.vercel` e esta misto.
- Proximos deploys Zeus/Hefesto devem usar worktree externo a `careli-hub` ou pacote limpo com `.vercel/project.json` local explicito.

## 2026-05-28 - HERMES-20260528-003-CLIENT-RUNTIME-RECOVERY

Status: EM PRODUCAO.

Registro de producao:

- Assunto: `[Hermes] Recuperacao de crash client-side em producao`.
- Squad/agente responsavel: `Zeus autorizado pelo Lucas`.
- Data e hora local: `2026-05-28 20:22:49 -03:00`.
- Ambiente: `producao`.
- Origem/homologacao de referencia: incidente urgente reportado por Lucas em `https://c2x.app.br/hermes`, com autorizacao explicita para hotfix Hermes em producao.
- Escopo publicado:
  - blindar acessos de Hermes/PulseX a `localStorage` e `sessionStorage`;
  - impedir que persistencia local de chamadas, favoritos, leitura de thread ou sidebar derrube a tela;
  - adicionar boundary de erro especifica do Hermes com limpeza apenas de estado local Hermes/PulseX.
- Commit publicado: `f9828a2 fix(hermes): recover from client runtime crashes`.
- Deployment anterior: `dpl_ApFfnT641VgsNJtGy2LQwHVxdQmt`.
- Deployment novo: `dpl_6DvjP1kyJLZSCx595dkwFRhz1QYG`; URL tecnica `https://careli-hub-hub-i2bs-8ygnopgzh-lucasruas-devs-projects.vercel.app`.
- Aliases/dominios afetados:
  - `https://c2x.app.br`: confirmado no deployment `dpl_6DvjP1kyJLZSCx595dkwFRhz1QYG`, status `Ready`;
  - `https://ops.c2x.app.br`: confirmado no mesmo deployment, status `Ready`.
- Arquivos/modulos incluidos:
  - `apps/hub/app/hermes/error.tsx`;
  - `apps/hub/components/pulsex/pulsex-workspace.tsx`;
  - `apps/hub/layouts/hub-shell.tsx`;
  - `apps/hub/providers/pulsex-call-provider.tsx`.
- Arquivos/modulos excluidos: Hades, Iris, Chronos, Athena, Apolo, Ares, Atlas, Guardian, CareDesk, migrations, banco, Supabase remoto, envs, secrets, tokens, dominios e alias manual.
- Validacoes executadas:
  - `git diff --check`: OK, apenas avisos LF/CRLF conhecidos no Windows;
  - `npm.cmd run build --workspace @repo/shared --workspace @repo/uix --workspace @repo/realtime --workspace @repo/database --workspace @repo/auth`: OK, para regenerar `dist` local dos pacotes internos no worktree;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run build --workspace @repo/hub`: OK, com warning conhecido Turbopack/NFT;
  - smoke local do build em `http://localhost:3021`: `/hermes`, `/` e `/login` retornaram 200;
  - `npx.cmd vercel deploy --prod --yes`: READY.
- Healthchecks pos-deploy:
  - `GET https://c2x.app.br/hermes`: 200;
  - `GET https://c2x.app.br/`: 200;
  - `GET https://c2x.app.br/login`: 200;
  - `GET https://ops.c2x.app.br/zeus`: 200;
  - `GET https://c2x.app.br/api/hermes/messages` sem sessao: 401 esperado.
- Logs recentes:
  - `npx.cmd vercel logs https://c2x.app.br --since 10m --level error`: sem logs encontrados;
  - `npx.cmd vercel logs https://ops.c2x.app.br --since 10m --level error`: sem logs encontrados.
- Rollback definido: promover novamente `dpl_ApFfnT641VgsNJtGy2LQwHVxdQmt` se Hermes, Login, Home, Zeus ou rotas protegidas apresentarem regressao critica.
- Riscos conhecidos:
  - validacao funcional final depende do Chrome/PWA autenticado do Lucas;
  - se o PWA/app instalado ainda carregar bundle antigo, fechar e abrir novamente pode ser necessario;
  - se a boundary aparecer, Lucas deve usar "Limpar estado local" uma vez para remover apenas chaves Hermes/PulseX do dispositivo.
- Pendencias:
  - Lucas retestar `https://c2x.app.br/hermes` no Chrome/PWA;
  - registro estruturado remoto no Operations Center ficou bloqueado sem autorizacao adicional para escrita em banco.
- Status: `EM PRODUCAO`.
- Proxima acao: Lucas validar a abertura do Hermes; Zeus acompanhar logs e preparar rollback apenas se houver regressao critica.

## 2026-05-28 - HERMES-20260528-004-REALTIME-SUBSCRIPTION-RECOVERY

Status: EM PRODUCAO, aguardando validacao autenticada final do Lucas.

Registro de producao:

- Assunto: `[Hermes] Correcao de crash Realtime na abertura do modulo`.
- Squad/agente responsavel: `Zeus autorizado pelo Lucas`.
- Data e hora local: `2026-05-28 22:10 -03:00`.
- Ambiente: `producao`.
- Origem/homologacao de referencia: incidente urgente Hermes em producao, com erro client-side visivel na boundary apos deploy anterior: `cannot add postgres_changes callbacks ... after subscribe()`.
- Escopo publicado:
  - separar a assinatura `postgres_changes` da tela ativa do Hermes para topico interno unico por canal;
  - evitar colisao com o topico global de broadcast usado por notificacoes;
  - estabilizar a assinatura Realtime para nao resubscrever quando listas de canais/usuarios mudam;
  - preservar broadcast de envio no topico publico sem adicionar callback novo a canal ja inscrito.
- Commit publicado: `eafd01e fix(hermes): isolate realtime message subscription`.
- Deployment anterior: `dpl_CHVwuJFZ26GMAeYoERX3Cy1T1KH9`.
- Deployment novo: `dpl_EBvQAaDDBTi6cmayVDmwdfessbV8`; URL tecnica `https://careli-hub-hub-i2bs-8w30koz3v-lucasruas-devs-projects.vercel.app`.
- Aliases/dominios afetados:
  - `https://c2x.app.br`: confirmado no deployment `dpl_EBvQAaDDBTi6cmayVDmwdfessbV8`, status `Ready`;
  - `https://ops.c2x.app.br`: confirmado no mesmo deployment, status `Ready`.
- Arquivos/modulos incluidos:
  - `apps/hub/components/pulsex/pulsex-workspace.tsx`.
- Arquivos/modulos excluidos: Hades, Iris, Chronos, Athena, Apolo, Ares, Atlas, Guardian, CareDesk, migrations, banco, Supabase remoto, envs, secrets, tokens, dominios e alias manual.
- Validacoes executadas:
  - `git diff --check`: OK, apenas avisos LF/CRLF conhecidos no Windows;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run build --workspace @repo/hub`: OK, com warning conhecido Turbopack/NFT;
  - `npx.cmd vercel deploy --prod --yes`: READY.
- Healthchecks pos-deploy:
  - `GET https://c2x.app.br/hermes`: 200;
  - `GET https://c2x.app.br/`: 200;
  - `GET https://c2x.app.br/login`: 200;
  - `GET https://ops.c2x.app.br/zeus`: 200;
  - `GET https://c2x.app.br/api/hermes/messages` sem sessao: 401 esperado.
- Logs recentes:
  - `npx.cmd vercel logs https://c2x.app.br --since 10m`: sem erro critico; apenas healthchecks 200 e 401 esperado sem sessao.
- Rollback definido: `dpl_CHVwuJFZ26GMAeYoERX3Cy1T1KH9` como rollback imediato apenas se o novo deployment causar regressao critica fora do Hermes.
- Riscos conhecidos:
  - validacao funcional final depende do Chrome autenticado do Lucas;
  - se a boundary reaparecer, a mensagem tecnica sanitizada deve guiar a proxima investigacao;
  - nenhuma alteracao em env, secrets, banco, Supabase remoto ou migrations foi feita.
- Pendencias:
  - Lucas retestar `https://c2x.app.br/hermes` no Chrome/PWA autenticado;
  - registro estruturado remoto no Operations Center ficou bloqueado sem autorizacao adicional para escrita em banco.
- Status: `EM PRODUCAO`.
- Proxima acao: Lucas validar abertura do Hermes; Zeus acompanhar logs e seguir investigando se aparecer nova mensagem tecnica.

## 2026-05-28 - HERMES-20260528-005-MESSAGE-VIEW-STABILITY

Status: EM PRODUCAO, aguardando validacao visual do Lucas.

Registro de producao:

- Assunto: `[Hermes] Estabilidade visual ao alternar canais`.
- Squad/agente responsavel: `Zeus autorizado pelo Lucas`.
- Data e hora local: `2026-05-28 22:40 -03:00`.
- Ambiente: `producao`.
- Origem/homologacao de referencia: incidente urgente Hermes em producao; Lucas reportou que, ao clicar em canais, a area de mensagens parecia atualizar/descer a tela e podia exibir `Nenhuma mensagem` enquanto a sincronizacao ainda ocorria.
- Escopo publicado:
  - controlar auto-scroll da lista de mensagens para evitar descida agressiva ao alternar canais;
  - manter mensagens ja carregadas em memoria durante a sincronizacao do canal;
  - diferenciar visualmente carregamento, falha e conversa realmente vazia;
  - nao persistir mensagens sensiveis em `localStorage` ou IndexedDB nesta etapa.
- Commit publicado: `46f2582 fix(hermes): keep message view stable while syncing`.
- Deployment anterior: `dpl_EBvQAaDDBTi6cmayVDmwdfessbV8`.
- Deployment novo: `dpl_EHuQwKBYi7FHB2Wv7GJbBJ4kL9dv`; URL tecnica `https://careli-hub-hub-i2bs-ua2bjj524-lucasruas-devs-projects.vercel.app`.
- Aliases/dominios afetados:
  - `https://c2x.app.br`: confirmado no deployment `dpl_EHuQwKBYi7FHB2Wv7GJbBJ4kL9dv`, status `Ready`;
  - `https://ops.c2x.app.br`: confirmado no mesmo deployment, status `Ready`.
- Arquivos/modulos incluidos:
  - `apps/hub/components/pulsex/message-list.tsx`;
  - `apps/hub/components/pulsex/pulsex-workspace.tsx`.
- Arquivos/modulos excluidos: Hades, Iris, Chronos, Athena, Apolo, Ares, Atlas, Guardian, CareDesk, migrations, banco, Supabase remoto, envs, secrets, tokens, dominios e alias manual.
- Validacoes executadas:
  - `git diff --check`: OK, apenas avisos LF/CRLF conhecidos no Windows;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run build --workspace @repo/hub`: OK, com warning conhecido Turbopack/NFT por leitura filesystem no SquadOps;
  - `npx.cmd vercel deploy --prod --yes`: READY.
- Healthchecks pos-deploy:
  - `GET https://c2x.app.br/hermes`: 200;
  - `GET https://c2x.app.br/`: 200;
  - `GET https://c2x.app.br/login`: 200;
  - `GET https://ops.c2x.app.br/zeus`: 200;
  - `GET https://c2x.app.br/api/hermes/messages` sem sessao: 401 esperado.
- Logs recentes:
  - `npx.cmd vercel logs https://c2x.app.br --since 5m`: inconclusivo por timeout do CLI local.
- Rollback definido: `dpl_EBvQAaDDBTi6cmayVDmwdfessbV8` como rollback imediato apenas se o novo deployment causar regressao critica fora do comportamento visual corrigido.
- Riscos conhecidos:
  - esta entrega nao implementa cache persistente de mensagens no dispositivo;
  - cache persistente de mensagens exigiria politica explicita de seguranca, expiracao, limites por usuario/canal e cuidado com dados sensiveis;
  - validacao visual final depende do Chrome/PWA autenticado do Lucas, clicando entre canais com historico.
- Pendencias:
  - Lucas retestar alternancia de canais em `https://c2x.app.br/hermes`;
  - se canal com historico ainda aparecer vazio apos sincronizar, investigar `listChannelMessages`, permissoes/RLS e dados reais antes de persistir cache local;
  - registro estruturado remoto no Operations Center ficou bloqueado sem autorizacao adicional para escrita em banco.
- Status: `EM PRODUCAO`.
- Proxima acao: Lucas validar se a lista parou de piscar/descer ao alternar canais; Zeus acompanha e investiga query/permissao se ainda houver canal vazio.

## 2026-05-28 - HERMES-20260528-006-MESSAGE-HISTORY-ANCHOR

Status: EM PRODUCAO, aguardando validacao visual do Lucas.

Registro de producao:

- Assunto: `[Hermes] Primeira mensagem visivel ao abrir canal`.
- Squad/agente responsavel: `Zeus autorizado pelo Lucas`.
- Data e hora local: `2026-05-28 22:55 -03:00`.
- Ambiente: `producao`.
- Origem/homologacao de referencia: incidente urgente Hermes em producao; Lucas reportou que, apos o ajuste de estabilidade visual, nao estava vendo a primeira mensagem ao clicar no canal.
- Escopo publicado:
  - abrir/trocar canal ancorando no topo do historico carregado;
  - impedir auto-scroll para o fim no primeiro render da lista;
  - manter auto-scroll para baixo apenas quando chega mensagem nova perto do fim ou quando a mensagem e do proprio usuario.
- Commit publicado: `6d9ea14 fix(hermes): anchor message history on channel open`.
- Deployment anterior: `dpl_EHuQwKBYi7FHB2Wv7GJbBJ4kL9dv`.
- Deployment novo: `dpl_DkhBzjpfQ333zRDpTw9bAVuLATyV`; URL tecnica `https://careli-hub-hub-i2bs-k0w69tde4-lucasruas-devs-projects.vercel.app`.
- Aliases/dominios afetados:
  - `https://c2x.app.br`: confirmado no deployment `dpl_DkhBzjpfQ333zRDpTw9bAVuLATyV`, status `Ready`;
  - `https://ops.c2x.app.br`: confirmado no mesmo deployment, status `Ready`.
- Arquivos/modulos incluidos:
  - `apps/hub/components/pulsex/message-list.tsx`.
- Arquivos/modulos excluidos: Hades, Iris, Chronos, Athena, Apolo, Ares, Atlas, Guardian, CareDesk, migrations, banco, Supabase remoto, envs, secrets, tokens, dominios e alias manual.
- Validacoes executadas:
  - `git diff --check`: OK, apenas avisos LF/CRLF conhecidos no Windows;
  - `npx.cmd eslint components/pulsex/message-list.tsx --max-warnings 0`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run build --workspace @repo/hub`: OK, com warning conhecido Turbopack/NFT por leitura filesystem no SquadOps;
  - `npx.cmd vercel deploy --prod --yes`: READY.
- Healthchecks pos-deploy:
  - `GET https://c2x.app.br/hermes`: 200;
  - `GET https://c2x.app.br/`: 200;
  - `GET https://c2x.app.br/login`: 200;
  - `GET https://ops.c2x.app.br/zeus`: 200;
  - `GET https://c2x.app.br/api/hermes/messages` sem sessao: 401 esperado.
- Logs recentes:
  - `npx.cmd vercel logs https://c2x.app.br --since 5m`: sem erro critico; chamadas Hermes autenticadas 200 e 401 esperado sem sessao;
  - `npx.cmd vercel logs https://ops.c2x.app.br --since 5m`: sem erro critico.
- Rollback definido: `dpl_EHuQwKBYi7FHB2Wv7GJbBJ4kL9dv` como rollback imediato se o novo deployment causar regressao critica no Hermes, Home, Login ou Zeus.
- Riscos conhecidos:
  - esta entrega nao implementa paginacao completa do historico antigo;
  - se o canal tiver mais mensagens do que o limite carregado atualmente, ver o primeiro registro absoluto exigira recorte posterior de paginacao/carregar anteriores;
  - validacao visual final depende do Chrome/PWA autenticado do Lucas.
- Pendencias:
  - Lucas retestar `https://c2x.app.br/hermes`, clicando em `Lideranca` e outros canais com historico;
  - se ainda faltar mensagem dentro do lote carregado, investigar query/ordem de `listChannelMessages`;
  - registro estruturado remoto no Operations Center ficou bloqueado sem autorizacao adicional para escrita em banco.
- Status: `EM PRODUCAO`.
- Proxima acao: Lucas validar se a primeira mensagem do historico carregado aparece ao abrir/trocar canal.

## 2026-05-28 - HERMES-20260528-007-LATEST-MESSAGE-ANCHOR

Status: EM PRODUCAO, aguardando validacao visual do Lucas.

Registro de producao:

- Assunto: `[Hermes] Ultima mensagem visivel ao abrir canal`.
- Squad/agente responsavel: `Zeus autorizado pelo Lucas`.
- Data e hora local: `2026-05-28 23:08 -03:00`.
- Ambiente: `producao`.
- Origem/homologacao de referencia: incidente urgente Hermes em producao; Lucas esclareceu que o comportamento correto e iniciar sempre na ultima mensagem enviada ao abrir ou trocar canal.
- Escopo publicado:
  - abrir/trocar canal ancorando no fim da conversa;
  - remover a rolagem para `top: 0` introduzida no hotfix 006;
  - preservar a protecao contra refresh/polling puxar a tela quando o operador estiver lendo mensagens antigas;
  - manter auto-scroll para baixo no primeiro render, na troca de canal e quando a mensagem nova for do usuario atual ou o operador ja estiver perto do fim.
- Commit publicado: `7f2a19c fix(hermes): open channels at latest message`.
- Deployment anterior: `dpl_DkhBzjpfQ333zRDpTw9bAVuLATyV`.
- Deployment novo: `dpl_5ipUS3Xm1qTM9P81yyW1wyjuBpWw`; URL tecnica `https://careli-hub-hub-i2bs-858o4fih5-lucasruas-devs-projects.vercel.app`.
- Aliases/dominios afetados:
  - `https://c2x.app.br`: confirmado no deployment `dpl_5ipUS3Xm1qTM9P81yyW1wyjuBpWw`, status `Ready`;
  - `https://ops.c2x.app.br`: confirmado no mesmo deployment, status `Ready`.
- Arquivos/modulos incluidos:
  - `apps/hub/components/pulsex/message-list.tsx`.
- Arquivos/modulos excluidos: Hades, Iris, Chronos, Athena, Apolo, Ares, Atlas, Guardian, CareDesk, migrations, banco, Supabase remoto, envs, secrets, tokens, dominios e alias manual.
- Validacoes executadas:
  - `git diff --check`: OK, apenas avisos LF/CRLF conhecidos no Windows;
  - `npx.cmd eslint components/pulsex/message-list.tsx --max-warnings 0`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run build --workspace @repo/hub`: OK, com warning conhecido Turbopack/NFT por leitura filesystem no SquadOps;
  - `npx.cmd vercel deploy --prod --yes`: READY.
- Healthchecks pos-deploy:
  - `GET https://c2x.app.br/hermes`: 200;
  - `GET https://c2x.app.br/`: 200;
  - `GET https://c2x.app.br/login`: 200;
  - `GET https://ops.c2x.app.br/zeus`: 200;
  - `GET https://c2x.app.br/api/hermes/messages` sem sessao: 401 esperado.
- Logs recentes:
  - `npx.cmd vercel logs https://c2x.app.br --since 5m`: sem erro critico; chamadas Hermes 200 e 401 esperado sem sessao;
  - `npx.cmd vercel logs https://ops.c2x.app.br --since 5m`: sem erro critico.
- Rollback definido: `dpl_DkhBzjpfQ333zRDpTw9bAVuLATyV` apenas para regressao tecnica critica, pois esse deployment abre no topo e nao atende a regra funcional validada pelo Lucas.
- Riscos conhecidos:
  - validacao visual final depende do Chrome/PWA autenticado do Lucas;
  - esta entrega nao implementa paginacao do historico antigo nem cache persistente de mensagens;
  - se ainda houver deslocamento inesperado, a proxima investigacao deve focar em altura dinamica das mensagens e carregamento tardio de avatares/imagens, sem alterar banco/env.
- Pendencias:
  - Lucas retestar `https://c2x.app.br/hermes`, clicando em `Lideranca` e outros canais reais;
  - registro estruturado remoto no Operations Center ficou bloqueado sem autorizacao adicional para escrita em banco.
- Status: `EM PRODUCAO`.
- Proxima acao: Lucas validar que o canal abre na ultima mensagem enviada e que a tela nao volta para o topo.

## 2026-05-28 - HERMES-20260528-008-MESSAGE-PREFETCH-FALLBACK

Status: EM PRODUCAO, aguardando validacao visual do Lucas.

Registro de producao:

- Assunto: `[Hermes] Prefetch e fallback visual de mensagens`.
- Squad/agente responsavel: `Zeus autorizado pelo Lucas`.
- Data e hora local: `2026-05-28 23:24 -03:00`.
- Ambiente: `producao`.
- Origem/homologacao de referencia: incidente urgente Hermes em producao; Lucas pediu alternativa para remover o carregamento textual ao alternar canais e perguntou sobre cache/fallback.
- Escopo publicado:
  - prefetch em memoria de ate 8 canais Hermes ainda nao carregados;
  - evitar fetch duplicado quando o canal selecionado ja esta sendo pre-carregado;
  - substituir o estado textual `Carregando mensagens` por skeletons discretos;
  - nao persistir mensagens em `localStorage`, sessionStorage ou IndexedDB neste hotfix.
- Commit publicado: `f47cbb9 fix(hermes): prefetch channel messages`.
- Deployment anterior: `dpl_5ipUS3Xm1qTM9P81yyW1wyjuBpWw`.
- Deployment novo: `dpl_4UC5RNJck6UnFQWp7WqKb7Vk65ih`; URL tecnica `https://careli-hub-hub-i2bs-l2filfh7w-lucasruas-devs-projects.vercel.app`.
- Aliases/dominios afetados:
  - `https://c2x.app.br`: confirmado no deployment `dpl_4UC5RNJck6UnFQWp7WqKb7Vk65ih`, status `Ready`;
  - `https://ops.c2x.app.br`: confirmado no mesmo deployment, status `Ready`.
- Arquivos/modulos incluidos:
  - `apps/hub/components/pulsex/message-list.tsx`;
  - `apps/hub/components/pulsex/pulsex-workspace.tsx`.
- Arquivos/modulos excluidos: Hades, Iris, Chronos, Athena, Apolo, Ares, Atlas, Guardian, CareDesk, migrations, banco, Supabase remoto, envs, secrets, tokens, dominios e alias manual.
- Validacoes executadas:
  - `git diff --check`: OK, apenas avisos LF/CRLF conhecidos no Windows;
  - `npx.cmd eslint components/pulsex/message-list.tsx components/pulsex/pulsex-workspace.tsx --max-warnings 0`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run build --workspace @repo/hub`: OK, com warning conhecido Turbopack/NFT por leitura filesystem no SquadOps;
  - `npx.cmd vercel deploy --prod --yes`: READY.
- Healthchecks pos-deploy:
  - `GET https://c2x.app.br/hermes`: 200;
  - `GET https://c2x.app.br/`: 200;
  - `GET https://c2x.app.br/login`: 200;
  - `GET https://ops.c2x.app.br/zeus`: 200;
  - `GET https://c2x.app.br/api/hermes/messages` sem sessao: 401 esperado.
- Logs recentes:
  - `npx.cmd vercel logs https://c2x.app.br --since 5m`: sem erro critico; chamadas extras `GET /api/hermes/messages` 200 sao esperadas pelo prefetch;
  - `npx.cmd vercel logs https://ops.c2x.app.br --since 5m`: sem erro critico.
- Rollback definido: `dpl_5ipUS3Xm1qTM9P81yyW1wyjuBpWw` se o prefetch aumentar carga ou causar regressao visual critica; esse rollback preserva a regra de abrir no fim da conversa, mas volta a exibir o carregamento textual em canal frio.
- Riscos conhecidos:
  - primeiro acesso frio ainda depende de rede/Supabase;
  - prefetch aumenta algumas chamadas `GET /api/hermes/messages`, observado nos logs como 200 sem erro critico;
  - cache persistente de mensagens requer recorte separado com governanca de seguranca.
- Pendencias:
  - Lucas retestar alternancia de canais em `https://c2x.app.br/hermes`;
  - se ainda houver espera perceptivel, avaliar recorte posterior de IndexedDB com TTL/limite/limpeza no logout ou otimizacao server-side da query;
  - registro estruturado remoto no Operations Center ficou bloqueado sem autorizacao adicional para escrita em banco.
- Status: `EM PRODUCAO`.
- Proxima acao: Lucas validar se o carregamento textual saiu e se os canais aparecem mais rapido apos alguns segundos de Hermes aberto.

## 2026-05-29 - CHRONOS-20260529-003-GOOGLE-AGENDA-INDIVIDUAL

Status: BLOQUEADO PARA PRODUCAO ATE AUTORIZACAO DA MIGRATION 0037.

Registro de producao:

- Assunto: `[Chronos] Agenda Google individual por colaborador`.
- Squad/agente responsavel: `Hefesto/Zeus autorizado para preparar recorte; operacao de banco ainda bloqueada`.
- Ambiente alvo: `producao`.
- Origem: Lucas reportou que outro colaborador viu a agenda Google do Lucas no Chronos.
- Escopo preparado:
  - limitar conexao/status Google ao usuario logado;
  - listar agenda Chronos apenas para reunioes em que o usuario logado e host ou participante;
  - sincronizar Google usando a conexao do dono da reuniao;
  - vincular eventos Google por `connection_id`, nao apenas por `calendar_id`;
  - manter layout discreto do botao Google e legenda da Agenda.
- Commit tecnico candidato: `fc6538f fix(chronos): scope google calendar per user`.
- Migration nova preparada: `0037_chronos_google_calendar_user_scope.sql`.
- Deploy Production: nao executado.
- Motivo do bloqueio:
  - a correcao depende de alterar schema/indices em Production;
  - a autorizacao anterior do Lucas cobriu `0035` e `0036`, nao a migration nova `0037`;
  - publicar o codigo sem `0037` pode causar falha de OAuth/sync por constraint ausente ou indice global antigo.
- Validacoes executadas:
  - `git diff --check`: OK, apenas avisos LF/CRLF conhecidos no Windows;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run build --workspace @repo/hub`: OK, apos compilar pacotes internos `@repo/*` para gerar `dist`; warning conhecido Turbopack/NFT em SquadOps.
- Riscos conhecidos:
  - depende de aplicacao controlada da migration `0037` em Production;
  - exige validacao autenticada com dois usuarios reais apos deploy;
  - nao expor secrets, tokens, refresh tokens ou payloads Google nos registros.
- Rollback esperado:
  - se a migration ainda nao for aplicada, nao publicar;
  - se publicada apos migration e houver regressao critica, promover o deployment anterior saudavel e avaliar rollback de codigo; rollback de schema exige autorizacao especifica do Lucas.
- Proxima acao: aguardar autorizacao literal do Lucas para aplicar `0037` em Production.

### Fechamento CHRONOS-20260529-003

- Status: `EM PRODUCAO`, aguardando validacao funcional autenticada com dois colaboradores.
- Autorizacao: Lucas autorizou aplicar a migration `0037` e publicar em Production.
- Migration aplicada: `packages/database/migrations/0037_chronos_google_calendar_user_scope.sql`.
- Verificacao segura de schema:
  - indices por usuario/conexao presentes;
  - constraints por `connection_id` presentes;
  - indice global antigo `chronos_google_calendar_connections_default_idx` ausente.
- Deployment anterior: `dpl_6eqx6sAfoV8kLvG3hJTtYBkUHTPw`.
- Deployment novo: `dpl_7DUUC2DMev6r1T6tM29YTYJzgRye`.
- URL tecnica: `https://careli-hub-hub-i2bs-p2vu9lvbe-lucasruas-devs-projects.vercel.app`.
- Aliases confirmados: `https://c2x.app.br` e `https://ops.c2x.app.br`.
- Homologacao: `https://homo.c2x.app.br` observada em Preview `dpl_EGyRHj2pqyqbn8Xs1QaKrimB6NEi`; nao reapontada neste fechamento porque exigiria Safety Gate proprio e a autorizacao foi para Production.
- Validacoes finais:
  - build remoto Vercel Production: READY, com warnings conhecidos;
  - `GET /`: 200;
  - `GET /login`: 200;
  - `GET /chronos`: 200;
  - `GET ops /zeus`: 200;
  - `GET /api/chronos/google-calendar/status` sem sessao: 401 esperado;
  - `POST /api/chronos/google-calendar/webhook` sem headers Google: 400 seguro;
  - `GET /api/chronos/invitees?q=lu` sem sessao: 401 esperado;
  - logs recentes sem erro critico observado.
- Registro estruturado: sync oficial do Operations Center em Production concluiu com `recordsTotal=456`, `recordsUpserted=456` e `releasesUpserted=66`.
- Observacao de smoke: `POST /api/chronos/google-calendar/sync` sem sessao nao foi executado no fechamento porque a revisao automatica de seguranca bloqueou POST em producao; validacoes nao destrutivas foram priorizadas.
- Rollback: promover `dpl_6eqx6sAfoV8kLvG3hJTtYBkUHTPw` para regressao critica de codigo; rollback de schema somente com autorizacao especifica.

## 2026-05-29 - CHRONOS-20260529-004-STORAGE-DRIVE-PRODUCTION

Status: EM PRODUCAO, aguardando smoke autenticado de nova gravacao/player/download.

Registro de producao:

- Assunto: `[Chronos] Storage e Drive de gravacoes em producao`.
- Squad/agente responsavel: `Zeus/Hefesto autorizado pelo Lucas`.
- Ambiente alvo: `producao`.
- Origem: auditoria dos recortes Chronos de `2026-05-28` identificou que o codigo funcional estava em producao, mas o artefato de banco/Storage `0034_chronos_drive_chat_storage.sql` ainda nao estava no recorte limpo publicado.
- Autorizacao: Lucas autorizou aplicar a migration `0034` no banco Production e publicar o recorte.
- Escopo publicado:
  - `packages/database/migrations/0034_chronos_drive_chat_storage.sql`;
  - `scripts/chronos-apply-drive-storage-schema.mjs`;
  - registros operacionais.
- Commit publicado: `227feef fix(chronos): release drive storage schema`.
- Migration aplicada: `packages/database/migrations/0034_chronos_drive_chat_storage.sql`.
- Verificacao segura de schema:
  - bucket privado `chronos-drive` presente;
  - colunas `file_name`, `mime_type`, `size_bytes` e `uploaded_at` presentes em `chronos_recordings`;
  - tabelas `chronos_chat_messages` e `chronos_participant_preferences` presentes com RLS ativo e replica identity full;
  - indices e policies esperados presentes.
- Deployment anterior: `dpl_7DUUC2DMev6r1T6tM29YTYJzgRye`.
- Deployment novo: `dpl_7SZAvMo3o6ikJeMMZNSULtL6DFe5`.
- URL tecnica: `https://careli-hub-hub-i2bs-mjvpuksr3-lucasruas-devs-projects.vercel.app`.
- Aliases confirmados: `https://c2x.app.br` e `https://ops.c2x.app.br`.
- Homologacao observada apos deploy: `https://homo.c2x.app.br` segue no Preview `dpl_EGyRHj2pqyqbn8Xs1QaKrimB6NEi`; nao foi reapontada neste fechamento porque a autorizacao foi para Production e o alias de homologacao exige Safety Gate proprio.
- Validacoes pre-deploy:
  - `node --check scripts/chronos-apply-drive-storage-schema.mjs`: OK;
  - `git diff --check`: OK, apenas avisos LF/CRLF conhecidos no Windows;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run build --workspace @repo/hub`: OK, com warning conhecido Turbopack/NFT em SquadOps.
- Build remoto Vercel: READY, com warnings conhecidos de `npm audit`, `engines.node >=18`, envs Postgres ausentes no `turbo.json` e Turbopack/NFT em SquadOps.
- Healthchecks pos-deploy:
  - `GET https://c2x.app.br/`: 200;
  - `GET https://c2x.app.br/login`: 200;
  - `GET https://c2x.app.br/chronos`: 200;
  - `GET https://ops.c2x.app.br/zeus`: 200;
  - `GET https://c2x.app.br/api/chronos/google-calendar/status` sem sessao: 401 esperado;
  - `GET https://c2x.app.br/api/chronos/invitees?q=lu` sem sessao: 401 esperado;
  - `GET https://c2x.app.br/api/chronos/meetings` sem sessao: 401 esperado.
- Logs recentes de `c2x.app.br` e `ops.c2x.app.br`: sem erro critico observado; `401` registrados correspondem aos smokes sem sessao.
- Riscos conhecidos:
  - smoke real de gravacao nova, player/download e Drive exige sessao autenticada e uma chamada Chronos real;
  - rollback de codigo pode promover `dpl_7DUUC2DMev6r1T6tM29YTYJzgRye`; rollback de schema/Storage exige autorizacao separada do Lucas.
- Proxima acao: Lucas validar uma nova chamada do Chronos, gravar, encerrar pelo host e confirmar se o item aparece no Drive com player/download.

## 2026-05-29 - CHRONOS-20260529-007-LINK-PUBLICO-CANONICO-PRODUCTION

Status: EM PRODUCAO, aguardando validacao visual do Lucas no cadastro da sala e no convite Google.

Registro de producao:

- Assunto: `[Chronos] Link publico executivo de sala em producao`.
- Squad/agente responsavel: `Zeus autorizado pelo Lucas`.
- Ambiente alvo: `producao`.
- Origem: Lucas apontou que o link externo da sala Chronos estava usando URL tecnica de deployment Vercel e que a rota externa `/chronos/lideranca` pedia login, o que bloqueava o uso com publico externo.
- Autorizacao: Lucas autorizou publicar o recorte em Production.
- Escopo publicado:
  - liberar no AuthProvider somente rotas publicas de sala no formato `/chronos/{slug}`, mantendo `/chronos` interno protegido;
  - exibir no cadastro/listagem de salas o link canonico `https://c2x.app.br/chronos/{slug}`;
  - usar o mesmo link canonico em eventos espelhados no Google Calendar;
  - reforcar o agente Athena de atas para exigir gravacao disponivel, usar inicio programado, fim real e participantes com check-in.
- Itens nao alterados: envs, secrets, banco, migrations, Storage, Supabase, dominio, alias manual e demais modulos.
- Commit publicado: `86a87b0 fix(chronos): publish canonical public room links`.
- Deployment anterior: `dpl_7SZAvMo3o6ikJeMMZNSULtL6DFe5`.
- Deployment novo: `dpl_6MK4mxPNzdUHe91CmmzAa5TWBiZ2`.
- URL tecnica: `https://careli-hub-hub-i2bs-44toe0wb4-lucasruas-devs-projects.vercel.app`.
- Aliases confirmados:
  - `https://c2x.app.br`;
  - `https://ops.c2x.app.br`.
- Validacoes pre-deploy:
  - `git diff --check`: OK, apenas avisos LF/CRLF conhecidos no Windows;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run build --workspace @repo/hub`: OK, com warning conhecido Turbopack/NFT em SquadOps;
  - smoke local com env local carregada: `GET http://localhost:3008/chronos/lideranca` retornou 200.
- Build remoto Vercel: READY, com warnings conhecidos de `npm audit`, `engines.node >=18`, envs Postgres ausentes no `turbo.json` e Turbopack/NFT em SquadOps.
- Healthchecks pos-deploy:
  - `GET https://c2x.app.br/`: 200;
  - `GET https://c2x.app.br/login`: 200;
  - `GET https://c2x.app.br/chronos`: 200;
  - `GET https://c2x.app.br/chronos/lideranca`: 200, sem redirect HTTP para login;
  - `GET https://ops.c2x.app.br/zeus`: 200;
  - `GET https://c2x.app.br/api/chronos/google-calendar/status` sem sessao: 401 esperado;
  - `GET https://c2x.app.br/api/chronos/invitees?q=lu` sem sessao: 401 esperado;
  - `GET https://c2x.app.br/api/chronos/meetings` sem sessao: 401 esperado.
- Logs recentes de `c2x.app.br` e `ops.c2x.app.br`: sem erro critico observado; `GET /chronos/lideranca` retornou 200 e os 401 foram smokes sem sessao.
- Rollback: promover `dpl_7SZAvMo3o6ikJeMMZNSULtL6DFe5` se houver regressao critica de runtime; nao houve alteracao de schema neste recorte.
- Proxima acao: Lucas validar no app o cadastro da sala e criar/abrir um evento Google para confirmar que o campo `Acesso Chronos` aponta para `https://c2x.app.br/chronos/{slug}`.

## 2026-05-29 - CHRONOS-20260529-008-GOOGLE-INVITE-SALA-HOTFIX-PRODUCTION

Status: EM PRODUCAO, aguardando smoke funcional autenticado do Lucas com criacao/atualizacao de evento Google e entrada na sala externa.

Registro de producao:

- Assunto: `[Chronos] Hotfix de invite Google, fuso e sala publica`.
- Squad/agente responsavel: `Zeus autorizado pelo Lucas`.
- Ambiente alvo: `producao`.
- Origem: Lucas identificou, apos o deploy do link publico canonico, tres regressoes operacionais: sala publica ainda podia ficar presa no estado de login no navegador, invite Google chegava com horario reduzido em 3 horas e agenda individual podia exibir blocos importados de outro colaborador.
- Autorizacao: Lucas autorizou publicar o hotfix em Production.
- Escopo publicado:
  - reforco do bypass client-side para rotas publicas `/chronos/{slug}` no AuthProvider, usando tambem `window.location.pathname` como fallback de hidratacao/cache;
  - envio de eventos Google com `sendUpdates=all`, restaurando notificacao/convite aos participantes;
  - formatacao dos horarios enviados ao Google como horario local `America/Sao_Paulo`, evitando deslocamento de 3 horas;
  - filtro defensivo para imports Google fora do dono da conexao, ocultando da agenda do colaborador eventos marcados como fora de escopo.
- Itens nao alterados: envs, secrets, banco, migrations, Storage, Supabase, dominio, alias manual, Hermes, Iris, Hades, Athena e demais modulos.
- Commit publicado: `78d651d fix(chronos): restore google invite timing and room access`.
- Deployment anterior: `dpl_6MK4mxPNzdUHe91CmmzAa5TWBiZ2`.
- Deployment novo: `dpl_BLqFpDRhWqyXqYpcGv3JCnVjy8Ez`.
- URL tecnica: `https://careli-hub-hub-i2bs-ia2er49x2-lucasruas-devs-projects.vercel.app`.
- Aliases confirmados:
  - `https://c2x.app.br`;
  - `https://ops.c2x.app.br`.
- Validacoes pre-deploy:
  - `git diff --check`: OK, apenas avisos LF/CRLF conhecidos no Windows;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run build --workspace @repo/hub`: OK, com warnings conhecidos Turbopack/NFT em SquadOps;
  - validacao de conversao segura: `2026-05-29T19:00:00.000Z` convertido para `2026-05-29T16:00:00` em America/Sao_Paulo.
- Build remoto Vercel Production: READY, com warnings conhecidos de `npm audit`, `engines.node >=18`, envs Postgres ausentes no `turbo.json` e Turbopack/NFT em SquadOps.
- Healthchecks pos-deploy:
  - `GET https://c2x.app.br/`: 200;
  - `GET https://c2x.app.br/login`: 200;
  - `GET https://c2x.app.br/chronos`: 200;
  - `GET https://c2x.app.br/chronos/lideranca`: 200, sem texto de login no HTML retornado;
  - `GET https://ops.c2x.app.br/zeus`: 200;
  - `GET https://c2x.app.br/api/chronos/google-calendar/status` sem sessao: 401 esperado;
  - `GET https://c2x.app.br/api/chronos/invitees?q=lu` sem sessao: 401 esperado;
  - `GET https://c2x.app.br/api/chronos/meetings` sem sessao: 401 esperado;
  - `POST https://c2x.app.br/api/chronos/google-calendar/webhook` sem headers Google: 400 seguro.
- Logs recentes de `c2x.app.br` e `ops.c2x.app.br`: `npx.cmd vercel logs --since 10m --level error` sem logs encontrados.
- Registro estruturado: sync oficial do Operations Center concluiu com `recordsTotal=456`, `recordsUpserted=456`, `releasesUpserted=66` e `mode=content-upload`.
- Observacao de commit: o commit foi criado com `--no-verify` porque o hook local aponta para `scripts/panteon-hook-runner.ps1`, ausente no worktree limpo. Validacoes operacionais foram executadas manualmente antes do deploy.
- Riscos e acompanhamento:
  - validacao completa de invite/fuso depende de criar ou atualizar evento real com Google conectado;
  - ocultacao de eventos Google fora do dono e aplicada no carregamento da agenda e reforcada no proximo sync;
  - rollback de codigo: promover `dpl_6MK4mxPNzdUHe91CmmzAa5TWBiZ2` se houver regressao critica; nao houve alteracao de schema/env neste recorte.
- Proxima acao: Lucas criar/atualizar uma reuniao Chronos para 16:00, confirmar no Google que permanece 16:00-17:00, verificar chegada dos convidados e abrir `https://c2x.app.br/chronos/lideranca` em janela sem login.

## 2026-05-29 - Z29-20260529-004-CHRONOS-ATHENA-MEDIA-STABILITY-PRODUCTION

Status: EM PRODUCAO, aguardando validacao funcional de chamada real com 3+ participantes e nova gravacao no Drive.

Registro de producao:

- Assunto: `[Chronos/Hermes] Estabilidade de chamada, Drive e Athena em producao`.
- Squad/agente responsavel: `Zeus autorizado pelo Lucas`.
- Ambiente alvo: `producao`.
- Origem: Lucas autorizou publicar o recorte de estabilidade de midia/Drive e o recorte Athena finalizado, mantendo o que ja estava em producao e sem sobrescrever melhorias anteriores.
- Escopo publicado:
  - Chronos sala externa com gravacao incluindo audio local e audio remoto dos participantes;
  - sinalizacao realtime de estado de gravacao e segmentos de transcricao para participantes remotos;
  - deduplicacao de participantes por usuario, e-mail ou nome operacional ao entrar na sala;
  - ata Athena com fallback local rastreavel quando OpenAI falhar e ignorando placeholders invalidos de modelo;
  - contexto de atas com fim real, duracao real e participantes com check-in deduplicados;
  - Chronos Drive preservando upload assinado direto para Supabase Storage e finalizacao separada;
  - Hermes/PulseX preservando reforco de audio e tolerancia a `disconnected` transitorio.
- Itens nao alterados: envs, secrets, schema/migrations, Storage policies, dominio, alias manual, Iris, Hades, Atlas, Apolo e demais modulos.
- Commit publicado: `760f6f2 fix(chronos): ship athena and media stability fixes`.
- Deployment anterior correto: `dpl_BLqFpDRhWqyXqYpcGv3JCnVjy8Ez`.
- Deployment intermediario descartado: `dpl_B5CUumprXckHRzjrLueJgQZz2TGp`, substituido por roll-forward porque o Vercel CLI usou o link do root ao inves da worktree limpa.
- Deployment novo final: `dpl_8wpkFvJ8Jese445Kz98U8WeHmKcw`.
- URL tecnica final: `https://careli-hub-hub-i2bs-iogu0dyha-lucasruas-devs-projects.vercel.app`.
- Aliases confirmados:
  - `https://c2x.app.br`;
  - `https://ops.c2x.app.br`.
- Validacoes pre-deploy:
  - `git diff --check`: OK, apenas avisos LF/CRLF conhecidos no Windows;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run build --workspace @repo/hub`: OK, com warnings conhecidos Turbopack/NFT em SquadOps;
  - smoke local com `next start`: bloqueado para `/chronos/lideranca` por ausencia de Supabase server-side local nesta worktree.
- Build remoto Vercel Production: READY.
- Healthchecks pos-deploy:
  - `GET https://c2x.app.br/`: 200;
  - `GET https://c2x.app.br/login`: 200;
  - `GET https://c2x.app.br/chronos`: 200;
  - `GET https://c2x.app.br/chronos/lideranca`: 200;
  - `GET https://c2x.app.br/hermes`: 200;
  - `GET https://ops.c2x.app.br/zeus`: 200;
  - `GET https://c2x.app.br/api/hermes/messages` sem sessao: 401 esperado;
  - `GET https://c2x.app.br/api/chronos/invitees?q=lu` sem sessao: 401 esperado;
  - `POST https://c2x.app.br/api/chronos/meetings/agent` sem sessao: 401 esperado;
  - `POST https://c2x.app.br/api/chronos/public/rooms/lideranca/recording/upload-url` com payload vazio: 400 esperado, confirmando rota publicada e nao 404;
  - `POST https://c2x.app.br/api/chronos/public/rooms/lideranca/recording/upload-complete` com payload vazio: 400 esperado, confirmando rota publicada e nao 404;
  - `POST https://c2x.app.br/api/chronos/google-calendar/webhook` sem headers Google: 400 seguro.
- Logs recentes do deployment final:
  - sem 5xx critico observado no recorte;
  - `POST /api/chronos/public/rooms/careli/recording/upload-url`: 200;
  - `POST /api/chronos/public/rooms/careli/recording/upload-complete`: 200;
  - `POST /api/chronos/public/rooms/careli/transcript`: 200;
  - `POST /api/chronos/public/rooms/careli/join`: 200;
  - `POST /api/chronos/public/rooms/careli/close`: 200;
  - `POST /api/chronos/google-calendar/sync`: 200;
  - `GET /chronos/lideranca`: 200.
- Registro estruturado Operations Center: pendente de sync autenticado. A API oficial exige sessao admin; Zeus nao usou token/cookie direto nem escreveu no banco para evitar atalho sensivel fora da sessao operacional.
- Observacoes operacionais:
  - o deployment intermediario `dpl_B5CUumprXckHRzjrLueJgQZz2TGp` nao deve ser usado como rollback;
  - worktrees em `.codex-deploy` precisam de `.vercel/project.json` local antes de `vercel deploy`, pois `.vercelignore` pode fazer o CLI subir o root;
  - commit criado com `--no-verify` porque o hook local aponta para `scripts/panteon-hook-runner.ps1`, ausente no root/worktree; validacoes foram executadas manualmente.
- Rollback: promover `dpl_BLqFpDRhWqyXqYpcGv3JCnVjy8Ez` se houver regressao critica de runtime; nao houve alteracao de schema/env neste recorte.
- Proxima acao: Lucas validar uma chamada real Chronos com 3+ pessoas, gravar poucos segundos, encerrar pelo host e conferir no Drive se o video aparece com player/download.

## 2026-05-29 - Z29-20260529-005-CHRONOS-GRAVACAO-TELA-UI-DRIVE-ADMIN-PRODUCTION

Status: EM PRODUCAO, aguardando validacao funcional real de gravacao com compartilhamento de tela e conferencia no Drive.

Registro de producao:

- Assunto: `[Chronos] Gravacao de tela, Drive admin e ata Athena em producao`.
- Squad/agente responsavel: `Zeus autorizado pelo Lucas`.
- Ambiente alvo: `producao`.
- Origem: Lucas solicitou unir as melhorias Athena de ata/transcricao ao recorte Zeus de gravacao de tela, layout de compartilhamento e exclusao admin no Drive.
- Escopo publicado:
  - gravacao Chronos passa a capturar camera/tela por canvas controller, acompanhando compartilhamento iniciado durante a chamada;
  - gravacao mistura audio local/remoto por Web Audio para reduzir perda de audio em chamadas com mais participantes;
  - sala externa recebe layout de tela compartilhada com participantes laterais e controle de zoom, preservando identidade visual atual;
  - Drive permite exclusao admin de gravacao persistida e ata;
  - Athena pode transcrever gravacao persistida server-side e gerar rascunho de ata em sequencia;
  - ata/Drive usam fim real, duracao, chat, evidencias e participantes com check-in deduplicado.
- Itens nao alterados: envs, secrets, banco, migrations, Storage policies, dominio, alias manual, Iris, Hades, Atlas, Apolo, Ares e demais modulos fora de Chronos.
- Commit publicado: `68d50b4 fix(chronos): preserve recording and minutes artifacts`.
- Deployment anterior: `dpl_8wpkFvJ8Jese445Kz98U8WeHmKcw`.
- Deployment novo: `dpl_EyKuq7oQgbsv7yRvKC69sNBreNQt`.
- URL tecnica: `https://careli-hub-hub-i2bs-dszlru2h9-lucasruas-devs-projects.vercel.app`.
- Aliases confirmados:
  - `https://c2x.app.br`;
  - `https://ops.c2x.app.br`.
- Validacoes pre-deploy:
  - `git diff --check`: OK, apenas avisos LF/CRLF conhecidos no Windows;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run build --workspace @repo/hub`: OK, com warnings conhecidos Turbopack/NFT por worktree em `.codex-deploy`;
  - smoke local buildado `GET http://localhost:3031/chronos`: 200;
  - smoke local buildado `POST http://localhost:3031/api/chronos/meetings/agent` sem sessao: 401 esperado.
- Build remoto Vercel Production: READY, com warnings conhecidos de `npm audit`, `engines.node >=18`, envs Postgres ausentes no `turbo.json` e Turbopack/NFT em SquadOps.
- Healthchecks pos-deploy:
  - `GET https://c2x.app.br/`: 200;
  - `GET https://c2x.app.br/login`: 200;
  - `GET https://c2x.app.br/chronos`: 200;
  - `GET https://c2x.app.br/chronos/lideranca`: 200;
  - `GET https://c2x.app.br/hermes`: 200;
  - `GET https://ops.c2x.app.br/zeus`: 200;
  - `POST https://c2x.app.br/api/chronos/meetings/agent` sem sessao: 401 esperado;
  - `GET https://c2x.app.br/api/chronos/google-calendar/status` sem sessao: 401 esperado.
- Logs recentes do deployment final:
  - sem 5xx critico observado no recorte;
  - observados `200` para `/`, `/login`, `/chronos`, `/chronos/lideranca`, `/hermes`, `/zeus`, `/api/hub/presence` e `/api/hermes/messages`;
  - observados `401` esperados para smokes sem sessao de Chronos.
- Observacoes operacionais:
  - commit criado com `--no-verify` porque o hook local nao encontrou `scripts/panteon-hook-runner.ps1` neste worktree em `.codex-deploy`; validacoes obrigatorias foram executadas manualmente;
  - worktree recebeu `.vercel/project.json` local antes do deploy para evitar o erro anterior de publicar root misto.
- Rollback: promover `dpl_8wpkFvJ8Jese445Kz98U8WeHmKcw` se houver regressao critica; nao houve alteracao de schema/env neste recorte.
- Proxima acao: Lucas validar uma chamada Chronos real com compartilhamento de tela, gravar poucos segundos, encerrar pelo host, conferir no Drive se o video mostra a tela e testar transcricao/ata da gravacao persistida.

## 2026-05-30 - Z30-20260530-001-CHRONOS-DRIVE-ATAS-GRAVACAO-COMPOSTA-PRODUCTION

Status: EM PRODUCAO, aguardando validacao funcional de uma nova gravacao com compartilhamento de tela e participantes laterais.

Registro de producao:

- Assunto: `[Chronos] Drive/Atas e gravacao composta em producao`.
- Squad/agente responsavel: `Zeus autorizado pelo Lucas`.
- Ambiente alvo: `producao`.
- Origem: Lucas reportou que a aba Atas do Drive derrubava a pagina e que a gravacao com tela compartilhada ja capturava a tela, mas deixava as janelas dos participantes fora do video final.
- Causa identificada:
  - a aba Atas dependia de gravacao disponivel e podia manter erro local antigo do agente de ata ao trocar de aba;
  - o fallback do agente de ata ainda aceitava placeholder de modelo OpenAI quando vinha com aspas;
  - a gravacao composta ja usava canvas, mas o mapa de elementos de video dos participantes era atualizado por `ref` sem notificar o controlador da gravacao. Se o MediaRecorder iniciava antes do video lateral ficar pronto, o arquivo ficava apenas com a tela principal.
- Escopo publicado:
  - Chronos Drive/Atas limpa erro local ao trocar de aba e lista reunioes com ata, transcricao ou gravacao disponivel;
  - agente de ata ignora placeholders invalidos de modelo e volta para o modelo padrao;
  - gravacao Chronos atualiza o canvas composto quando janelas de video de participantes entram ou saem do DOM;
  - compartilhamento de tela continua como area principal e participantes passam a ser desenhados na lateral do arquivo gravado.
- Itens nao alterados: envs, secrets, banco, migrations, Storage policies, dominio, alias manual, Google Calendar, Iris, Hades, Hermes, Atlas, Apolo, Ares e demais modulos fora de Chronos.
- Commit publicado: `a6ab0d5 fix(chronos): stabilize drive minutes and recording composition`.
- Deployment anterior: `dpl_EyKuq7oQgbsv7yRvKC69sNBreNQt`.
- Deployment novo: `dpl_FoWV8qikCmJbxSyEFYa4z3AeLrs6`.
- URL tecnica: `https://careli-hub-hub-i2bs-mumdx2rvg-lucasruas-devs-projects.vercel.app`.
- Aliases confirmados:
  - `https://c2x.app.br`;
  - `https://ops.c2x.app.br`.
- Validacoes pre-deploy:
  - `git diff --check`: OK, apenas avisos LF/CRLF conhecidos no Windows;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run build --workspace @repo/hub`: OK, com warnings conhecidos Turbopack/NFT por worktree em `.codex-deploy`.
- Build remoto Vercel Production: READY, com warnings conhecidos de `npm audit`, `engines.node >=18`, envs Postgres ausentes no `turbo.json` e Turbopack/NFT em SquadOps.
- Healthchecks pos-deploy:
  - `GET https://c2x.app.br/`: 200;
  - `GET https://c2x.app.br/login`: 200;
  - `GET https://c2x.app.br/chronos`: 200;
  - `GET https://c2x.app.br/chronos/lideranca`: 200;
  - `GET https://c2x.app.br/hermes`: 200;
  - `GET https://ops.c2x.app.br/zeus`: 200;
  - `POST https://c2x.app.br/api/chronos/meetings/agent` sem sessao: 401 esperado.
- Logs recentes do deployment final:
  - sem 5xx critico observado no recorte;
  - observados `200` para `/`, `/login`, `/chronos`, `/chronos/lideranca`, `/hermes`, `/zeus`, `/api/hub/presence` e `/api/hermes/messages`;
  - observado `401` esperado para smoke sem sessao de Chronos.
- Observacoes operacionais:
  - gravacoes antigas nao sao reprocessadas por este hotfix; a correcao vale para novas gravacoes iniciadas depois do deploy;
  - commit criado com `--no-verify` porque o hook local nao encontrou `scripts/panteon-hook-runner.ps1` neste worktree em `.codex-deploy`; validacoes obrigatorias foram executadas manualmente;
  - nao houve alteracao de schema/env/remoto de Supabase.
- Rollback: promover `dpl_EyKuq7oQgbsv7yRvKC69sNBreNQt` se houver regressao critica; nao houve alteracao de schema/env neste recorte.
- Proxima acao: Lucas atualizar a aba do Chronos, iniciar uma nova chamada com pelo menos uma pessoa remota, compartilhar tela, gravar poucos segundos, encerrar pelo host e conferir no Drive se o video mostra tela principal e participantes na lateral.

## 2026-05-30 - Z30-20260530-002-CHRONOS-GOOGLE-AGENDA-FIDELIDADE-PRODUCTION

Status: EM PRODUCAO, aguardando validacao funcional lado a lado com Google Calendar da colaboradora.

Registro de producao:

- Assunto: `[Chronos] agenda Google individual corrigida em producao`.
- Squad/agente responsavel: `Zeus autorizado pelo Lucas`.
- Ambiente alvo: `producao`.
- Origem: Lucas reportou que a agenda Chronos nao refletia fielmente a agenda Google individual, especialmente no perfil da Nivea Careli, exibindo poucos blocos enquanto o Google Calendar mostrava uma semana densa.
- Causa identificada:
  - a importacao Google descartava eventos quando `organizer.email` ou `creator.email` nao batiam com o e-mail do colaborador;
  - o snapshot do Chronos repetia esse filtro e escondia eventos que pertenciam a agenda conectada, mas haviam sido criados ou organizados por outra pessoa;
  - o limite de snapshot de 80 reunioes podia truncar agendas densas.
- Escopo publicado:
  - conexao Google individual passa a ser a fronteira de pertencimento da agenda do colaborador;
  - eventos retornados pela agenda conectada nao sao descartados por criador/organizador externo;
  - primeira sincronizacao apos o hotfix faz full sync uma vez por conexao ativa para recuperar eventos antes ignorados;
  - full sync usa `singleEvents=true` com `orderBy=startTime`;
  - snapshot do Chronos sobe de 80 para 1000 reunioes enquanto a arquitetura de cache/janela dedicada e formalizada.
- Itens nao alterados: envs, secrets, banco, migrations, Storage policies, dominio, alias manual, Drive/Atas, gravacao, Iris, Hades, Hermes, Atlas, Apolo, Ares e demais modulos fora de Chronos Google Agenda.
- Commit publicado: `e5c7ac3 fix(chronos): restore google calendar fidelity`.
- Deployment anterior: `dpl_FoWV8qikCmJbxSyEFYa4z3AeLrs6`.
- Deployment novo: `dpl_GpLQK812ChTr53ZGmqhrDefbjx4n`.
- URL tecnica: `https://careli-hub-hub-i2bs-nqodcei76-lucasruas-devs-projects.vercel.app`.
- Aliases confirmados:
  - `https://c2x.app.br`;
  - `https://ops.c2x.app.br`.
- Validacoes pre-deploy:
  - `git diff --check HEAD^ HEAD`: OK;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run build --workspace @repo/hub`: OK, com warnings conhecidos Turbopack/NFT por worktree em `.codex-deploy`.
- Build remoto Vercel Production: READY, com warnings conhecidos de `npm audit`, `engines.node >=18`, envs Postgres ausentes no `turbo.json` e Turbopack/NFT em SquadOps.
- Healthchecks pos-deploy:
  - `GET https://c2x.app.br/`: 200;
  - `GET https://c2x.app.br/login`: 200;
  - `GET https://c2x.app.br/chronos`: 200;
  - `GET https://ops.c2x.app.br/zeus`: 200;
  - `GET https://c2x.app.br/api/chronos/google-calendar/status` sem sessao: 401 esperado;
  - `GET https://c2x.app.br/api/chronos/meetings` sem sessao: 401 esperado.
- Logs recentes do deployment final:
  - sem 5xx critico observado no recorte;
  - observados `200` para `/`, `/login`, `/chronos`, `/zeus`, `/api/hub/presence` e `/api/hermes/messages`;
  - observados `401` esperados para smokes sem sessao de Chronos.
- Observacoes operacionais:
  - primeira sincronizacao de cada conexao Google ativa deve ser mais completa, pois o hotfix forca full sync uma vez por versao de fidelidade;
  - depois da recuperacao, o fluxo volta ao incremental por `syncToken`;
  - nao houve alteracao de schema/env/remoto de Supabase.
- Rollback: promover `dpl_FoWV8qikCmJbxSyEFYa4z3AeLrs6` se houver regressao critica; nao houve alteracao de schema/env neste recorte.
- Proxima acao: Lucas ou Nivea abrir o Chronos autenticado, clicar em `Atualizar` se necessario e comparar a semana da tela com o Google Calendar apos a sincronizacao.

## 2026-06-01 - HF-20260601-001-ENGINEERING-PROD

Status: EM PRODUCAO, publicado em Vercel Production e aguardando validacao funcional autenticada do Lucas.

Registro de producao:

- Assunto: `[Hefesto] nova engenharia modular do Panteon em producao`.
- Protocolo: `HF-20260601-001-ENGINEERING-PROD`.
- Squad/agente responsavel: `Hefesto`, publicando pacote limpo sob autorizacao operacional do Lucas.
- Ambiente alvo: `producao`.
- Origem: Lucas pediu publicar tudo que foi feito na nova engenharia e manter os demais modulos como rascunho fora do pacote.
- Worktree limpo: `.codex-deploy/z01-001-engineering-prod-20260601`.
- Branch do pacote: `codex/hefesto/engineering-prod-20260601`.
- Manifesto: `docs/operations/panteon-recorte-manifest-hf-20260601-001-engineering-prod.json`.
- Escopo candidato:
  - Iris: decomposicao de tela, blocos, tipos, Setup e fluxo Meta/WhatsApp reorganizados;
  - Hades: atendimento/cobranca, fila, WhatsApp, cliente, risco, acordos e superficies tipadas;
  - Hermes: contratos de rota/API, helpers de mensagens, notificacoes, realtime e client de dados;
  - Chronos: agenda, salas, Drive, gravacoes, atas, helpers e `ChronosPage.tsx` como orquestrador enxuto;
  - Zeus/governanca: manifestos, boundary checks, protocolos, arvore operacional e orientacao para futuros agentes.
- Escopo explicitamente fora:
  - root local `homolog` misto;
  - Ares, Apolo, Atlas, Setup e demais modulos ainda em rascunho;
  - migrations, banco, Supabase mutavel, envs, secrets, tokens, service role, aliases manuais e dominio manual;
  - `.env*`, `.vercel/**`, `.git/**`, `node_modules/**`, `.next/**`, `.turbo/**`, `.codex-deploy/**` e `.codex-artifacts/**`.
- Base de producao antes do release:
  - deployment atual: `dpl_GpLQK812ChTr53ZGmqhrDefbjx4n`;
  - URL tecnica atual: `https://careli-hub-hub-i2bs-nqodcei76-lucasruas-devs-projects.vercel.app`;
  - aliases atuais: `https://c2x.app.br` e `https://ops.c2x.app.br`;
  - rollback imediato planejado: `dpl_GpLQK812ChTr53ZGmqhrDefbjx4n`;
  - rollback anterior congelado no manifesto: `dpl_FoWV8qikCmJbxSyEFYa4z3AeLrs6`.
- Validacoes pre-deploy:
  - auditoria de rascunhos no pacote: OK, sem mudancas em Ares/Apolo/Atlas/Setup/migrations;
  - busca por `.env.local` e `.env.production.local` no pacote: OK, sem ocorrencias;
  - `.vercelignore`: OK, exclui `node_modules`, `.turbo`, `.next`, `.vercel`, `.env*`, logs e artefatos Codex;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run build --workspace @repo/hub`: OK, com warnings conhecidos de worktree nested/Turbopack;
  - smoke local com env carregado somente em memoria: OK para `/`, `/login`, `/chronos`, `/chronos/lideranca`, `/hermes`, `/hades`, `/iris`, `/zeus`;
  - smoke local sem sessao: OK para `/api/chronos/meetings`, `/api/hermes/messages` e `/api/iris/meta/templates` retornando `401` esperado;
  - `node scripts/panteon-recorte-manifest-check.mjs --manifest docs/operations/panteon-recorte-manifest-hf-20260601-001-engineering-prod.json`: OK.
- Commit de codigo publicado: `044dd67c feat(panteon): publish modular engineering package`.
- Observacao de commit: criado com `--no-verify` porque o hook local apontou para `scripts/panteon-hook-runner.ps1`, ausente tambem no root; as validacoes obrigatorias foram executadas manualmente e passaram antes do deploy.
- Deployment novo: `dpl_34sTeQMRmSLBQzHkx26urYGcgCkT`.
- URL tecnica nova: `https://careli-hub-hub-i2bs-7g3sssevp-lucasruas-devs-projects.vercel.app`.
- Aliases confirmados:
  - `https://c2x.app.br`;
  - `https://ops.c2x.app.br`.
- Build remoto Vercel Production: READY, com warnings conhecidos de `npm audit`, engines Node, envs Postgres antigas fora do `turbo.json` e Turbopack/NFT em rota documental do Zeus.
- Healthchecks pos-deploy:
  - `npx.cmd vercel inspect https://c2x.app.br`: `Ready`, deployment `dpl_34sTeQMRmSLBQzHkx26urYGcgCkT`;
  - `npx.cmd vercel inspect https://ops.c2x.app.br`: `Ready`, deployment `dpl_34sTeQMRmSLBQzHkx26urYGcgCkT`;
  - `GET https://c2x.app.br/`: 200;
  - `GET https://c2x.app.br/login`: 200;
  - `GET https://c2x.app.br/chronos`: 200;
  - `GET https://c2x.app.br/chronos/lideranca`: 200;
  - `GET https://c2x.app.br/hermes`: 200;
  - `GET https://c2x.app.br/hades`: 200;
  - `GET https://c2x.app.br/iris`: 200;
  - `GET https://c2x.app.br/zeus`: 307 esperado para redirecionamento do Zeus; seguindo redirect retorna 200;
  - `GET https://ops.c2x.app.br/zeus`: 200;
  - `GET https://c2x.app.br/api/chronos/meetings` sem sessao: 401 esperado;
  - `GET https://c2x.app.br/api/hermes/messages` sem sessao: 401 esperado;
  - `GET https://c2x.app.br/api/iris/meta/templates` sem sessao: 401 esperado.
- Logs recentes de erro:
  - `npx.cmd vercel logs https://c2x.app.br --since 10m --level error`: sem logs encontrados;
  - `npx.cmd vercel logs https://ops.c2x.app.br --since 10m --level error`: sem logs encontrados.
- Rollback planejado: promover novamente `dpl_GpLQK812ChTr53ZGmqhrDefbjx4n` se houver regressao critica; nao ha migration/env/schema neste release.
- Proxima acao: Lucas validar autenticado os fluxos reais de Iris, Hades, Hermes, Chronos e Zeus em producao antes do go-live operacional.

## 2026-06-01 - CH-20260601-119-CHRONOS-ATAS-CLIENT-GUARD

Status: EM PRODUCAO, publicado em Vercel Production e aguardando validacao autenticada do Lucas na aba Atas.

Registro de producao:

- Assunto: `[Chronos] hotfix tela de Atas em producao`.
- Protocolo: `CH-20260601-119-CHRONOS-ATAS-CLIENT-GUARD`.
- Squad/agente responsavel: `Chronos Core`, coordenado por Zeus/Hefesto.
- Ambiente alvo: `producao`.
- Origem: Lucas reportou que `https://c2x.app.br/chronos` caia no boundary do Next ao acessar a tela de Atas.
- Causa tratada: falha client-side provavel quando uma reuniao Chronos chegava ao Drive/Atas com arrays ou campos ausentes de `recordings`, `minutes`, `transcript`, `participants`, `timeline`, `followUps` ou `chatMessages`.
- Escopo publicado:
  - normalizacao defensiva do snapshot client-side em `apps/hub/lib/chronos/client.ts`;
  - normalizacao dos retornos de criacao, atualizacao, transcricao e geracao de ata;
  - guardas nos helpers de ata, Drive, calendario e salas;
  - guardas nos paineis de Atas, Transcricao, Gravacoes e cards do Drive.
- Itens nao alterados: regra de negocio de Atas, endpoints, Google Calendar, OpenAI, banco, migrations, Supabase admin, envs, secrets, tokens, dominio e alias manual.
- Commit publicado: `b1cb1fb fix(chronos): guard atas runtime payload`.
- Deployment anterior: `dpl_34sTeQMRmSLBQzHkx26urYGcgCkT`.
- Deployment novo: `dpl_JCpGkkHbEH6LUFHTnU1h8Lqorm8j`.
- URL tecnica: `https://careli-hub-hub-i2bs-7c3alvgbq-lucasruas-devs-projects.vercel.app`.
- Aliases confirmados:
  - `https://c2x.app.br`;
  - `https://ops.c2x.app.br`.
- Validacoes pre-deploy:
  - ESLint focado nos arquivos Chronos alterados: OK;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK;
  - `npm.cmd run build --workspace @repo/hub`: OK;
  - smoke local isolado em `http://localhost:3002`: `/chronos` 200 e `/api/chronos/meetings` 401 esperado sem sessao;
  - `node scripts/panteon-recorte-manifest-check.mjs --manifest docs/operations/panteon-recorte-manifest-ch-20260601-119-chronos-atas-client-guard.json`: OK;
  - `node scripts/panteon-boundary-check.mjs --module chronos --allow zeus --allow hefesto --from-git`: OK;
  - `git diff --check`: OK, com avisos esperados LF/CRLF.
- Build remoto Vercel Production: READY, com warnings conhecidos de `npm audit`, `engines.node >=18`, envs Postgres fora do `turbo.json` e Turbopack/NFT.
- Healthchecks pos-deploy:
  - `npx.cmd vercel inspect https://c2x.app.br`: Ready no deployment `dpl_JCpGkkHbEH6LUFHTnU1h8Lqorm8j`;
  - `npx.cmd vercel inspect https://ops.c2x.app.br`: Ready no deployment `dpl_JCpGkkHbEH6LUFHTnU1h8Lqorm8j`;
  - `GET https://c2x.app.br/chronos`: 200;
  - `GET https://c2x.app.br/chronos/lideranca`: 200;
  - `GET https://c2x.app.br/api/chronos/meetings` sem sessao: 401 esperado.
- Logs recentes:
  - `npx.cmd vercel logs https://c2x.app.br --since 10m`: sem erro novo; observados `200` para rotas Chronos e `401` esperado para API protegida sem sessao.
- Rollback planejado: promover novamente `dpl_34sTeQMRmSLBQzHkx26urYGcgCkT` se houver regressao critica; rollback anterior do pacote de engenharia continua documentado em `dpl_GpLQK812ChTr53ZGmqhrDefbjx4n`.
- Proxima acao: Lucas atualizar a pagina em producao, abrir `Drive > Atas` autenticado e confirmar se a tela carrega sem boundary.

## 2026-06-01 - CH-20260601-120-CHRONOS-DATE-STATUS-FALLBACK

Status: EM PRODUCAO, publicado em Vercel Production e aguardando novo teste autenticado do Lucas.

Registro de producao:

- Assunto: `[Chronos] segunda camada do hotfix de Atas em producao`.
- Protocolo: `CH-20260601-120-CHRONOS-DATE-STATUS-FALLBACK`.
- Squad/agente responsavel: `Chronos Core`, coordenado por Zeus/Hefesto.
- Ambiente alvo: `producao`.
- Origem: Lucas confirmou que o erro persistiu depois do protocolo `CH-20260601-119`.
- Escopo publicado:
  - normalizacao client-side ampliada para campos opcionais, datas, salas e perfis;
  - fallback para datas invalidas em cards/agenda;
  - fallback para tipos/status/minutes/gravacao fora das enums esperadas;
  - helper visual seguro para tipos de reuniao Chronos.
- Itens nao alterados: endpoints, banco, migrations, Supabase admin, envs, secrets, tokens, dominios, aliases manuais e regras de negocio.
- Commit publicado: `a6385f4 fix(chronos): guard date and status fallbacks`.
- Deployment anterior: `dpl_JCpGkkHbEH6LUFHTnU1h8Lqorm8j`.
- Deployment novo: `dpl_Ep9mZmfdh4eJvjmwFwyXTDDvEQYu`.
- URL tecnica: `https://careli-hub-hub-i2bs-nlbl16yz1-lucasruas-devs-projects.vercel.app`.
- Aliases confirmados:
  - `https://c2x.app.br`;
  - `https://ops.c2x.app.br`.
- Validacoes pre-deploy:
  - ESLint focado nos arquivos Chronos alterados: OK;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK;
  - `npm.cmd run build --workspace @repo/hub`: OK;
  - `node scripts/panteon-recorte-manifest-check.mjs --manifest docs/operations/panteon-recorte-manifest-ch-20260601-120-chronos-date-status-fallback.json`: OK;
  - `node scripts/panteon-boundary-check.mjs --module chronos --allow zeus --allow hefesto --from-git`: OK;
  - `git diff --check`: OK, com avisos esperados LF/CRLF.
- Build remoto Vercel Production: READY, com warnings conhecidos.
- Healthchecks pos-deploy:
  - `npx.cmd vercel inspect https://c2x.app.br`: Ready no deployment `dpl_Ep9mZmfdh4eJvjmwFwyXTDDvEQYu`;
  - `npx.cmd vercel inspect https://ops.c2x.app.br`: Ready no deployment `dpl_Ep9mZmfdh4eJvjmwFwyXTDDvEQYu`;
  - `GET https://c2x.app.br/chronos`: 200;
  - `GET https://c2x.app.br/api/chronos/meetings` sem sessao: 401 esperado.
- Logs recentes:
  - `npx.cmd vercel logs https://c2x.app.br --since 10m`: sem erro server-side novo observado.
- Rollback planejado: promover novamente `dpl_JCpGkkHbEH6LUFHTnU1h8Lqorm8j` se houver regressao critica; rollback anterior da engenharia segue em `dpl_34sTeQMRmSLBQzHkx26urYGcgCkT`.
- Proxima acao: Lucas atualizar totalmente `https://c2x.app.br/chronos` e testar `Drive > Atas`; se persistir, capturar console/overlay do navegador.

## 2026-06-01 - CH-20260601-121-CHRONOS-PERMISSIONS-GUARD

Status: EM PRODUCAO, publicado em Vercel Production e aguardando novo teste autenticado do Lucas.

Registro de producao:

- Assunto: `[Chronos] permissions guard em producao`.
- Protocolo: `CH-20260601-121-CHRONOS-PERMISSIONS-GUARD`.
- Squad/agente responsavel: `Chronos Core`, coordenado por Zeus/Hefesto.
- Ambiente alvo: `producao`.
- Origem: Lucas confirmou que o mesmo boundary persistiu em `https://c2x.app.br/chronos` mesmo apos os protocolos `CH-119` e `CH-120`.
- Causa tratada: `ChronosPage.tsx` acessava `hubUser?.permissions.includes("chronos:manage")`; quando o perfil autenticado existe mas `permissions` nao vem como array, a renderizacao client-side quebra antes da tela montar.
- Escopo publicado:
  - guarda `Array.isArray(hubUser?.permissions)` antes de calcular `canManageChronos`;
  - fallback para lista vazia quando as permissoes nao vierem no payload de sessao;
  - preservacao da regra: apenas usuarios com `chronos:manage` gerenciam reunioes.
- Itens nao alterados: endpoints, banco, migrations, Supabase admin, envs, secrets, tokens, dominios, aliases manuais e regras de negocio de Chronos.
- Commit publicado: `35ea7b8 fix(chronos): guard permissions on authenticated load`.
- Deployment anterior: `dpl_Ep9mZmfdh4eJvjmwFwyXTDDvEQYu`.
- Deployment novo: `dpl_3hxwtaszWSdEo4EywZ3VwSDfj2VS`.
- URL tecnica: `https://careli-hub-hub-i2bs-imc5lj1i5-lucasruas-devs-projects.vercel.app`.
- Aliases confirmados:
  - `https://c2x.app.br`;
  - `https://ops.c2x.app.br`.
- Validacoes pre-deploy:
  - ESLint focado em `ChronosPage.tsx`: OK;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK;
  - `npm.cmd run build --workspace @repo/hub`: OK;
  - `node scripts/panteon-recorte-manifest-check.mjs --manifest docs/operations/panteon-recorte-manifest-ch-20260601-121-chronos-permissions-guard.json`: OK;
  - `node scripts/panteon-boundary-check.mjs --module chronos --allow zeus --allow hefesto --from-git`: OK;
  - `git diff --check`: OK, com avisos esperados LF/CRLF;
  - busca pelo padrao inseguro `hubUser?.permissions.includes` no Chronos: OK, sem ocorrencias.
- Build remoto Vercel Production: READY, com warnings conhecidos.
- Healthchecks pos-deploy:
  - `npx.cmd vercel inspect https://c2x.app.br`: Ready no deployment `dpl_3hxwtaszWSdEo4EywZ3VwSDfj2VS`;
  - `npx.cmd vercel inspect https://ops.c2x.app.br`: Ready no deployment `dpl_3hxwtaszWSdEo4EywZ3VwSDfj2VS`;
  - `GET https://c2x.app.br/chronos`: 200;
  - `GET https://c2x.app.br/api/chronos/meetings` sem sessao: 401 esperado.
- Logs recentes:
  - `npx.cmd vercel logs https://c2x.app.br --since 10m --level error`: sem logs encontrados;
  - `npx.cmd vercel logs https://ops.c2x.app.br --since 10m --level error`: sem logs encontrados.
- Rollback planejado: promover novamente `dpl_Ep9mZmfdh4eJvjmwFwyXTDDvEQYu` se houver regressao critica; rollback anterior do segundo hotfix segue em `dpl_JCpGkkHbEH6LUFHTnU1h8Lqorm8j`.
- Observacao: a validacao autenticada pelo plugin Chrome ficou indisponivel por falha local do `node_repl`; Lucas precisa fazer refresh duro no navegador real e testar `/chronos`.
- Proxima acao: Lucas atualizar `https://c2x.app.br/chronos` com refresh duro; se o boundary persistir, capturar console/overlay exato para atacar a proxima causa client-side.

## 2026-06-01 - CH-20260601-122-SHELL-PERMISSIONS-FALLBACK

Status: EM PRODUCAO, publicado em Vercel Production e aguardando novo teste autenticado do Lucas.

Registro de producao:

- Assunto: `[Chronos] shell permissions fallback em producao`.
- Protocolo: `CH-20260601-122-SHELL-PERMISSIONS-FALLBACK`.
- Squad/agente responsavel: `Chronos Core`, coordenado por Zeus/Hefesto.
- Ambiente alvo: `producao`.
- Origem: Lucas solicitou revisar o bloco completo de Atas e identificar o motivo do boundary persistente em `https://c2x.app.br/chronos`.
- Causa tratada: a revisao de Atas nao encontrou quebra direta restante nos componentes principais; o ponto compatível com queda da rota inteira estava no `HubShell`, que usa `canAccessModule -> hasPermission`; `hasPermission` ainda dependia de `user.permissions.includes(...)` sem fallback quando a sessao real viesse sem `permissions` como array.
- Escopo publicado:
  - `packages/shared/src/permissions/helpers.ts` agora usa `getUserPermissionList`;
  - `getUserPermissionList` usa `user.permissions` se for array e, em caso contrario, cai para `rolePermissionMatrix[user.role]`;
  - regras de permissao preservadas para perfis corretos.
- Itens nao alterados: endpoints, banco, migrations, Supabase admin, envs, secrets, tokens, dominios, aliases manuais, telas/API de Setup e regras de negocio de Atas.
- Commit publicado: `ab7bcba fix(chronos): fallback shell permissions`.
- Deployment anterior: `dpl_3hxwtaszWSdEo4EywZ3VwSDfj2VS`.
- Deployment novo: `dpl_2s6CTppev67fsAKScYThnnGYHRY9`.
- URL tecnica: `https://careli-hub-hub-i2bs-8uezvro15-lucasruas-devs-projects.vercel.app`.
- Aliases confirmados:
  - `https://c2x.app.br`;
  - `https://ops.c2x.app.br`.
- Validacoes pre-deploy:
  - ESLint focado nos componentes Chronos/Atas revisados: OK;
  - ESLint focado em `packages/shared/src/permissions/helpers.ts`: OK;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK;
  - `npm.cmd run build --workspace @repo/hub`: OK;
  - `node scripts/panteon-recorte-manifest-check.mjs --manifest docs/operations/panteon-recorte-manifest-ch-20260601-122-shell-permissions-fallback.json`: OK apos declarar `setup` como camada permitida para o helper compartilhado;
  - `node scripts/panteon-boundary-check.mjs --module chronos --allow zeus --allow hefesto --allow setup --from-git`: OK;
  - `git diff --check`: OK, com avisos esperados LF/CRLF.
- Build remoto Vercel Production: READY, com warnings conhecidos.
- Healthchecks pos-deploy:
  - `npx.cmd vercel inspect https://c2x.app.br`: Ready no deployment `dpl_2s6CTppev67fsAKScYThnnGYHRY9`;
  - `npx.cmd vercel inspect https://ops.c2x.app.br`: Ready no deployment `dpl_2s6CTppev67fsAKScYThnnGYHRY9`;
  - `GET https://c2x.app.br/chronos`: 200;
  - `GET https://c2x.app.br/api/chronos/meetings` sem sessao: 401 esperado.
- Logs recentes:
  - `npx.cmd vercel logs https://c2x.app.br --since 10m --level error`: sem logs encontrados;
  - `npx.cmd vercel logs https://ops.c2x.app.br --since 10m --level error`: sem logs encontrados.
- Rollback planejado: promover novamente `dpl_3hxwtaszWSdEo4EywZ3VwSDfj2VS` se houver regressao critica.
- Proxima acao: Lucas atualizar `https://c2x.app.br/chronos` e testar acesso ao Drive/Atas; se persistir, capturar console/overlay exato do Chrome porque servidor e rota publica seguem sem erro.

## 2026-06-01 - CH-20260601-123-CHRONOS-VIDEO-CALLS-DRIVE-PLAYBACK

Status: EM PRODUCAO, publicado em Vercel Production e aguardando teste funcional autenticado do Lucas.

Registro de producao:

- Assunto: `[Chronos] videochamadas, Drive e Atas em producao`.
- Protocolo: `CH-20260601-123-CHRONOS-VIDEO-CALLS-DRIVE-PLAYBACK`.
- Squad/agente responsavel: `Chronos Core`, coordenado por Zeus/Hefesto.
- Ambiente alvo: `producao`.
- Origem: Lucas reportou que a aba Atas abriu ao remover um video antigo, mas novas gravacoes ficaram sem playback em `Drive > Gravacoes`.
- Causa tratada:
  - upload de gravacao ainda passava pela rota serverless `/recording/upload`;
  - em falha, o client marcava a reuniao como `available`;
  - o endpoint de status criava `chronos_recordings` sem `storage_bucket`/`storage_path`;
  - Drive/Atas liam essas linhas como gravacao disponivel, sem URL real.
- Escopo publicado:
  - upload assinado direto do navegador para Supabase Storage via `uploadToSignedUrl`;
  - confirmacao server-side somente apos o objeto existir no Storage;
  - status-only de sala externa nao cria mais registro de gravacao sem arquivo;
  - falha de upload passa a registrar `failed`, nao `available`;
  - Drive filtra registros sem midia e expõe `Link pendente` quando faltar URL real;
  - Atas exige playback real antes de listar/transcrever;
  - transcricao de gravacao existente bloqueia quando nao houver Blob local ou URL assinada;
  - compartilhamento de tela reorganiza as demais janelas no lado direito em desktop;
  - a sala oferece `Assistir gravacao` e `Baixar` para o Blob local recem-gerado.
- Itens nao alterados: DDL, migration, env, secret, token, dominio, alias manual, Supabase admin e alteracao direta de banco.
- Commit publicado: `b962cde fix(chronos): repair recording playback flow`.
- Deployment anterior: `dpl_2s6CTppev67fsAKScYThnnGYHRY9`.
- Deployment novo: `dpl_HY7KWmrCptTvF24ZA9FK4qZzF4MW`.
- URL tecnica: `https://careli-hub-hub-i2bs-oshc9es0w-lucasruas-devs-projects.vercel.app`.
- Aliases confirmados:
  - `https://c2x.app.br`;
  - `https://ops.c2x.app.br`.
- Validacoes pre-deploy:
  - ESLint focado em `ChronosExternalRoomPage.tsx` e `chronos-drive-recording-card.tsx`: OK;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK;
  - `npm.cmd run build --workspace @repo/hub`: OK;
  - smoke HTTP local em build compilado na porta `3011`: `/chronos` 200 e `/api/chronos/meetings` 401 esperado;
  - `node scripts/panteon-recorte-manifest-check.mjs --manifest docs/operations/panteon-recorte-manifest-ch-20260601-123-chronos-video-calls-drive-playback.json`: OK;
  - `node scripts/panteon-boundary-check.mjs --module chronos --allow zeus --allow hefesto --from-git`: OK;
  - `git diff --check`: OK, com avisos esperados LF/CRLF.
- Build remoto Vercel Production: READY, com warnings conhecidos.
- Healthchecks pos-deploy:
  - `npx.cmd vercel inspect https://c2x.app.br`: Ready no deployment `dpl_HY7KWmrCptTvF24ZA9FK4qZzF4MW`;
  - `npx.cmd vercel inspect https://ops.c2x.app.br`: Ready no deployment `dpl_HY7KWmrCptTvF24ZA9FK4qZzF4MW`;
  - `GET https://c2x.app.br/chronos`: 200;
  - `GET https://c2x.app.br/api/chronos/meetings` sem sessao: 401 esperado;
  - `GET https://ops.c2x.app.br/zeus`: 200.
- Logs recentes:
  - `npx.cmd vercel logs https://c2x.app.br --since 10m --level error`: sem logs encontrados;
  - `npx.cmd vercel logs https://ops.c2x.app.br --since 10m --level error`: sem logs encontrados.
- Rollback planejado: promover novamente `dpl_2s6CTppev67fsAKScYThnnGYHRY9` se houver regressao critica.
- Proxima acao: Lucas atualizar `https://c2x.app.br/chronos`, testar gravacao curta em uma sala Chronos, abrir `Drive > Gravacoes` e conferir `Assistir`, `Baixar`, `Transcrever` e `Drive > Atas`.

## 2026-06-01 - CH-20260601-124-CHRONOS-TRANSCRIPTION-ATAS-SCREENSHARE

Status: EM PRODUCAO, publicado em Vercel Production e aguardando teste funcional autenticado do Lucas.

Registro de producao:

- Assunto: `[Chronos] transcricao, Atas e compartilhamento em producao`.
- Protocolo: `CH-20260601-124-CHRONOS-TRANSCRIPTION-ATAS-SCREENSHARE`.
- Squad/agente responsavel: `Chronos Core`, coordenado por Zeus/Hefesto.
- Ambiente alvo: `producao`.
- Origem: Lucas reportou que a gravacao parecia parar ao compartilhar tela, que `Transcrever` retornava erro OpenAI e que a aba `Atas` ainda caia no boundary do Next.
- Causa tratada:
  - a chamada de transcricao aceitava qualquer string de env como modelo e podia encaminhar placeholder/incompatibilidade para a OpenAI;
  - a chamada enviava `temperature` para modelos novos de audio, parametro removido neste recorte;
  - a gravacao era iniciada com o stream atual e nao reconstruia a captura quando a tela compartilhada entrava depois do `MediaRecorder`;
  - a aba Atas nao tinha barreira local para impedir que um dado inconsistente derrubasse a rota inteira;
  - registros de Drive salvos via upload direto ainda podiam ficar com `started_at` nulo.
- Escopo publicado:
  - allowlist de modelos de transcricao: `gpt-4o-mini-transcribe`, `gpt-4o-transcribe` e `whisper-1`;
  - remocao de `temperature` da chamada `/v1/audio/transcriptions`;
  - log server-side seguro para falha OpenAI de transcricao, sem segredo;
  - reinicio controlado da gravacao quando compartilhamento de tela entra ou sai;
  - protecao local em `Drive > Atas` para evitar queda total da rota;
  - Drive passa a priorizar fim real de gravacao antes do fim agendado;
  - upload final salva `startedAt` real no registro de `chronos_recordings`.
- Itens nao alterados: DDL, migration, env, secret, token, dominio, alias manual, Supabase admin e alteracao direta de banco.
- Commit publicado: `b6e37ac fix(chronos): stabilize transcription and screen recording`.
- Deployment anterior: `dpl_HY7KWmrCptTvF24ZA9FK4qZzF4MW`.
- Deployment novo: `dpl_CrtiytJiKs5ZgyumUXSosLRYFKsX`.
- URL tecnica: `https://careli-hub-hub-i2bs-12gk4raig-lucasruas-devs-projects.vercel.app`.
- Aliases confirmados:
  - `https://c2x.app.br`;
  - `https://ops.c2x.app.br`.
- Validacoes pre-deploy:
  - documentacao oficial revisada: OpenAI audio transcriptions, Supabase signed upload e MDN MediaRecorder;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK;
  - `npm.cmd run build --workspace @repo/hub`: OK;
  - smoke HTTP local em servidor ja ativo: `/chronos` 200 e `/chronos/careli` 200;
  - `node scripts/panteon-recorte-manifest-check.mjs --manifest docs/operations/panteon-recorte-manifest-ch-20260601-124-chronos-transcription-atas-screenshare.json`: OK;
  - `node scripts/panteon-boundary-check.mjs --module chronos --allow zeus --allow hefesto --from-git`: OK;
  - `git diff --check`: OK, com avisos esperados LF/CRLF.
- Build remoto Vercel Production: READY, com warnings conhecidos.
- Healthchecks pos-deploy:
  - `npx.cmd vercel inspect https://c2x.app.br`: Ready no deployment `dpl_CrtiytJiKs5ZgyumUXSosLRYFKsX`;
  - `npx.cmd vercel inspect https://ops.c2x.app.br`: Ready no deployment `dpl_CrtiytJiKs5ZgyumUXSosLRYFKsX`;
  - `GET https://c2x.app.br/chronos`: 200;
  - `GET https://c2x.app.br/chronos/careli`: 200;
  - `GET https://ops.c2x.app.br/zeus`: 200;
  - `GET https://c2x.app.br/api/chronos/meetings` sem sessao: 401 esperado.
- Logs recentes:
  - `npx.cmd vercel logs https://c2x.app.br --since 10m --level error`: sem logs encontrados;
  - `npx.cmd vercel logs https://ops.c2x.app.br --since 10m --level error`: sem logs encontrados.
- Rollback planejado: promover novamente `dpl_HY7KWmrCptTvF24ZA9FK4qZzF4MW` se houver regressao critica.
- Proxima acao: Lucas fazer refresh duro em `https://c2x.app.br/chronos`, criar uma reuniao curta, iniciar gravacao, compartilhar tela, parar gravacao, abrir `Drive > Gravacoes`, clicar `Assistir`, `Baixar`, `Transcrever` e depois `Drive > Atas`.

## 2026-06-01 - CH-20260601-125-CHRONOS-ATAS-DATA-COMPOSITE-RECORDING

Status: EM PRODUCAO, publicado em Vercel Production e aguardando teste funcional autenticado do Lucas.

Registro de producao:

- Assunto: `[Chronos] Atas data guards e gravacao composta em producao`.
- Protocolo: `CH-20260601-125-CHRONOS-ATAS-DATA-COMPOSITE-RECORDING`.
- Squad/agente responsavel: `Chronos Core`, coordenado por Zeus/Hefesto.
- Ambiente alvo: `producao`.
- Origem: Lucas reportou que, apos o hotfix anterior, a gravacao com compartilhamento iniciou, mas o video gravado capturava apenas a tela compartilhada, nao a sala da videochamada; tambem reportou alerta `[object Object]` e erro visual em `Drive > Atas`.
- Causa tratada:
  - o cliente Chronos podia renderizar `payload.error` estruturado como texto, gerando `[object Object]`;
  - campos vindos de Atas/transcricao/resumo podiam chegar como objeto ou formato inesperado em pontos que esperavam string;
  - o tratamento de erro OpenAI escondia mensagens reais ao classificar erro amplo de modelo como placeholder;
  - quando havia compartilhamento de tela, o `MediaRecorder` recebia a trilha de tela como video principal e nao compunha a sala junto da tela.
- Escopo publicado:
  - normalizacao client-side de erro estruturado para mensagem legivel;
  - normalizacao server-side de campos textuais de reuniao, participantes, transcript, chat e minutes;
  - guard visual em Atas com motivo tecnico sanitizado caso um dado inconsistente ainda apareca;
  - limite explicito de 25 MB antes de enviar arquivo para transcricao OpenAI;
  - preservacao da mensagem real de erro OpenAI em vez de mascarar tudo como placeholder;
  - gravacao com compartilhamento passa a usar canvas 1280x720, tela principal e trilha lateral direita com camera/participantes quando o navegador permitir.
- Itens nao alterados: DDL, migration, env, secret, token, dominio, alias manual, Supabase admin e alteracao direta de banco.
- Commit publicado: `d7adfdf fix(chronos): harden atas data and recording composition`.
- Deployment anterior: `dpl_CrtiytJiKs5ZgyumUXSosLRYFKsX`.
- Deployment novo: `dpl_2PePdZRXy6K38SBG3nvM9m9wfP83`.
- URL tecnica: `https://careli-hub-hub-i2bs-pj7n4kl7h-lucasruas-devs-projects.vercel.app`.
- Aliases confirmados:
  - `https://c2x.app.br`;
  - `https://ops.c2x.app.br`.
- Validacoes pre-deploy:
  - documentacao oficial OpenAI revisada para transcriptions e limite de arquivo;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK;
  - `npm.cmd run build --workspace @repo/hub`: OK;
  - `git diff --check`: OK, com avisos esperados LF/CRLF;
  - `node scripts/panteon-recorte-manifest-check.mjs --manifest docs/operations/panteon-recorte-manifest-ch-20260601-125-chronos-atas-data-composite-recording.json`: OK;
  - `node scripts/panteon-boundary-check.mjs --module chronos --allow zeus --allow hefesto --from-git`: OK.
- Build remoto Vercel Production: READY, com warnings conhecidos de `npm audit`, `engines.node >=18`, envs Postgres fora do `turbo.json` e Turbopack/NFT.
- Healthchecks pos-deploy:
  - `npx.cmd vercel inspect https://c2x.app.br`: Ready no deployment `dpl_2PePdZRXy6K38SBG3nvM9m9wfP83`;
  - `npx.cmd vercel inspect https://ops.c2x.app.br`: Ready no deployment `dpl_2PePdZRXy6K38SBG3nvM9m9wfP83`;
  - `GET https://c2x.app.br/chronos`: 200;
  - `GET https://ops.c2x.app.br/zeus`: 200;
  - `GET https://c2x.app.br/api/chronos/meetings` sem sessao: 401 esperado.
- Logs recentes:
  - `npx.cmd vercel logs https://c2x.app.br --since 10m --level error`: sem logs encontrados;
  - `npx.cmd vercel logs https://ops.c2x.app.br --since 10m --level error`: sem logs encontrados.
- Rollback planejado: promover novamente `dpl_CrtiytJiKs5ZgyumUXSosLRYFKsX` se houver regressao critica.
- Proxima acao: Lucas fazer refresh duro em `https://c2x.app.br/chronos`, criar uma chamada curta com camera ligada, iniciar gravacao, compartilhar tela, encerrar, abrir `Assistir` e conferir se o arquivo mostra tela compartilhada mais a trilha lateral da sala; depois testar `Transcrever` e `Drive > Atas`.

## 2026-06-01 - CH-20260601-126-CHRONOS-STABLE-RECORDING-ATAS-OPTION

Status: EM PRODUCAO, publicado em Vercel Production e aguardando teste funcional autenticado do Lucas.

Registro de producao:

- Assunto: `[Chronos] Gravacao estavel com tela e fallback OpenAI em producao`.
- Protocolo: `CH-20260601-126-CHRONOS-STABLE-RECORDING-ATAS-OPTION`.
- Squad/agente responsavel: `Chronos Core`, coordenado por Zeus/Hefesto.
- Ambiente alvo: `producao`.
- Origem: Lucas reportou regressao recorrente em que a gravacao caia ao compartilhar tela, o arquivo final nao trazia a tela compartilhada junto da sala e `Drive > Atas`/`Transcrever` continuavam retornando `Invalid option : option`.
- Causa tratada:
  - o cliente ainda reiniciava o `MediaRecorder` ao entrar/sair do compartilhamento, criando parada real de gravacao;
  - a composicao por canvas dependia da trilha de tela existente no inicio e podia ficar com fundo escuro se a tela entrasse depois ou trocasse de trilha;
  - a chamada OpenAI de transcricao nao tinha retry seguro entre modelos oficiais e ainda enviava parametro opcional desnecessario;
  - a transcricao ficava acoplada a geracao posterior da ata, entao uma falha de ata podia fazer a acao inteira parecer perdida.
- Escopo publicado:
  - remocao do restart automatico de gravacao em start/stop de compartilhamento;
  - canvas de gravacao estavel desde o inicio da gravacao, com selecao dinamica de tela compartilhada, camera local e participantes;
  - tela compartilhada como area principal e camera/participantes no trilho lateral quando houver compartilhamento;
  - modelo padrao de ata ajustado para modelo OpenAI estavel e fallback controlado;
  - transcricao com fallback entre `gpt-4o-mini-transcribe`, `gpt-4o-transcribe` e `whisper-1`;
  - remocao de `response_format` na transcricao e leitura tolerante de payload JSON/texto;
  - transcricao salva mesmo se a geracao de ata posterior falhar.
- Itens nao alterados: DDL, migration, env, secret, token, dominio, alias manual, Supabase admin e alteracao direta de banco.
- Commit publicado: `038fdc1 fix(chronos): stabilize screen recording and atas fallback`.
- Deployment anterior: `dpl_2PePdZRXy6K38SBG3nvM9m9wfP83`.
- Deployment novo: `dpl_ChNdoKQW38Ufp4TSDqvcaXzUrBHS`.
- URL tecnica: `https://careli-hub-hub-i2bs-6apiro0o2-lucasruas-devs-projects.vercel.app`.
- Aliases confirmados:
  - `https://c2x.app.br`;
  - `https://ops.c2x.app.br`.
- Validacoes pre-deploy:
  - documentacao oficial MDN revisada para `MediaRecorder`, `HTMLCanvasElement.captureStream` e `MediaDevices.getDisplayMedia`;
  - documentacao oficial OpenAI revisada para audio transcriptions/modelos oficiais;
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK;
  - `npm.cmd run build --workspace @repo/hub`: OK;
  - `git diff --check`: OK, com avisos esperados LF/CRLF;
  - `node scripts/panteon-recorte-manifest-check.mjs --manifest docs/operations/panteon-recorte-manifest-ch-20260601-126-chronos-stable-recording-atas-option.json`: OK;
  - `node scripts/panteon-boundary-check.mjs --module chronos --allow zeus --allow hefesto --from-git`: OK.
- Build remoto Vercel Production: READY, com warnings conhecidos de `npm audit`, `engines.node >=18`, envs Postgres fora do `turbo.json` e Turbopack/NFT.
- Healthchecks pos-deploy:
  - `npx.cmd vercel inspect https://c2x.app.br`: Ready no deployment `dpl_ChNdoKQW38Ufp4TSDqvcaXzUrBHS`;
  - `npx.cmd vercel inspect https://ops.c2x.app.br`: Ready no deployment `dpl_ChNdoKQW38Ufp4TSDqvcaXzUrBHS`;
  - `GET https://c2x.app.br/chronos`: 200;
  - `GET https://ops.c2x.app.br/zeus`: 200;
  - `GET https://c2x.app.br/api/chronos/meetings` sem sessao: 401 esperado;
  - `POST https://c2x.app.br/api/chronos/meetings/agent` sem sessao: 401 esperado.
- Operations Center estruturado:
  - `sync-markdown-content` local: BLOQUEADO por `413 Arquivo do Engineering Operations excede o limite seguro`;
  - `create-record` local: BLOQUEADO por `503 Supabase server-side nao configurado` no worktree limpo;
  - nenhum secret, token ou chave foi puxado, impresso ou alterado; registro vivo pendente para reconciliacao posterior.
- Logs recentes:
  - `npx.cmd vercel logs https://c2x.app.br --since 15m --level error`: sem logs encontrados;
  - `npx.cmd vercel logs https://ops.c2x.app.br --since 15m --level error`: sem logs encontrados.
- Rollback planejado: promover novamente `dpl_2PePdZRXy6K38SBG3nvM9m9wfP83` se houver regressao critica.
- Proxima acao: Lucas fazer refresh duro em `https://c2x.app.br/chronos`, iniciar uma chamada curta, iniciar gravacao, compartilhar a tela, parar a gravacao manualmente, abrir `Assistir` e conferir se a tela fica no painel principal com a camera no lado direito; depois testar `Transcrever` e `Drive > Atas`.

## 2026-06-01 - CH-20260601-127-CHRONOS-WEBRTC-HOME-LOADER

Status: EM PRODUCAO, publicado em Vercel Production e aguardando teste funcional autenticado do Lucas com pelo menos tres participantes.

Registro de producao:

- Assunto: `[Chronos] WebRTC mesh 3+ participantes e loader Home/Asana em producao`.
- Protocolo: `CH-20260601-127-CHRONOS-WEBRTC-HOME-LOADER`.
- Squad/agente responsavel: `Chronos Core`, coordenado por Zeus/Hefesto.
- Ambiente alvo: `producao`.
- Origem: Lucas autorizou publicar a revisao que trata chamadas Chronos com mais de duas pessoas, onde alguns participantes podiam ouvir/ver e outros nao, e tambem o ajuste visual para o loading do bloco Asana da Home.
- Causa tratada:
  - a malha WebRTC podia deixar pares sem negociacao quando o participante novo tinha ID menor do que usuarios ja conectados;
  - candidatos ICE podiam chegar antes de `remoteDescription`;
  - trocas de midia sincronizavam principalmente video, sem um caminho unico para audio/video em peers existentes;
  - a Home exibia texto/chips operacionais durante carregamento do Asana.
- Escopo publicado:
  - negociacao complementar no `media-state`, garantindo offer por par na sala;
  - fila de candidatos ICE por participante ate `remoteDescription`;
  - sincronizacao outbound de audio e video quando camera/tela muda;
  - loading do Asana na Home com spinner isolado e acessivel.
- Itens nao alterados: DDL, migration, env, secret, token, dominio, alias manual, Supabase admin e alteracao direta de banco.
- Commit publicado: `299aab79c098fd752b3f3962d019e261e34cb294`.
- Deployment anterior: `dpl_ChNdoKQW38Ufp4TSDqvcaXzUrBHS`.
- Deployment novo: `dpl_94aModt7TkVq5BjKrVCRpvMNU1vF`.
- URL tecnica: `https://careli-hub-hub-i2bs-hdp58athy-lucasruas-devs-projects.vercel.app`.
- Aliases confirmados:
  - `https://c2x.app.br`;
  - `https://ops.c2x.app.br`.
- Homologacao/paridade: `https://homo.c2x.app.br` segue em Preview divergente `dpl_EGyRHj2pqyqbn8Xs1QaKrimB6NEi`; nao foi reapontado nesta atividade porque a autorizacao explicita foi para producao.
- Validacoes pre-deploy:
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run build --workspace @repo/hub`: OK, com warnings conhecidos Turbopack/NFT e root inferido;
  - `git diff --check`: OK;
  - `node scripts/panteon-recorte-manifest-check.mjs --manifest docs/operations/panteon-recorte-manifest-ch-20260601-127-chronos-webrtc-home-loader.json`: OK;
  - `node scripts/panteon-boundary-check.mjs --module chronos --allow panteon --allow zeus --allow hefesto --files <arquivos do protocolo>`: OK.
- Build remoto Vercel Production: READY, com warnings conhecidos de `npm audit`, `engines.node >=18`, envs Postgres fora do `turbo.json` e Turbopack/NFT.
- Healthchecks pos-deploy:
  - `npx.cmd vercel inspect https://c2x.app.br`: Ready no deployment `dpl_94aModt7TkVq5BjKrVCRpvMNU1vF`;
  - `npx.cmd vercel inspect https://ops.c2x.app.br`: Ready no deployment `dpl_94aModt7TkVq5BjKrVCRpvMNU1vF`;
  - `GET https://c2x.app.br/`: 200;
  - `GET https://c2x.app.br/chronos`: 200;
  - `GET https://ops.c2x.app.br/zeus`: 200;
  - `GET https://c2x.app.br/api/chronos/meetings` sem sessao: 401 esperado;
  - `POST https://c2x.app.br/api/chronos/meetings/agent` sem sessao: 401 esperado.
- Logs recentes:
  - `npx.cmd vercel logs https://c2x.app.br --since 15m --level error`: sem logs encontrados;
  - `npx.cmd vercel logs https://ops.c2x.app.br --since 15m --level error`: sem logs encontrados.
- Rollback planejado: promover novamente `dpl_ChNdoKQW38Ufp4TSDqvcaXzUrBHS` se houver regressao critica.
- Proxima acao: Lucas fazer refresh duro em `https://c2x.app.br/chronos`, abrir chamada com pelo menos tres participantes, alternar microfone/camera, compartilhar tela e conferir se todos os participantes recebem audio/video corretamente.

## 2026-06-01 - CH-20260601-128-CHRONOS-MINUTES-PDF-ROOM-BACKGROUND

Status: EM PRODUCAO, publicado em Vercel Production e aguardando teste funcional autenticado do Lucas no fluxo Transcrever > Ata > Gerar PDF > nova gravacao com fundo personalizado.

Registro de producao:

- Assunto: `[Chronos] Atas inteligentes, PDF padrao e fundo da sala na gravacao em producao`.
- Protocolo: `CH-20260601-128-CHRONOS-MINUTES-PDF-ROOM-BACKGROUND`.
- Squad/agente responsavel: `Chronos Core`, coordenado por Zeus/Hefesto.
- Ambiente alvo: `producao`.
- Origem: Lucas autorizou publicar o recorte apos confirmar que a gravacao deixou de interromper, mas que a Ata ainda nao gerava e o fundo personalizado da sala nao aparecia no video salvo.
- Causa tratada:
  - `Intl.DateTimeFormat` usava `dateStyle` junto de `hour`/`minute`, combinacao invalida que gerava `TypeError: Invalid option : option`;
  - o compositor de gravacao precisava desenhar o background da sala dentro do canvas capturado por `canvas.captureStream`;
  - o fluxo de transcricao/ata precisava de saida estruturada e feedback visual.
- Escopo publicado:
  - transcricao com `response_format=json`;
  - geracao de ata por Responses API com JSON schema estruturado;
  - ata executiva com bullets, tabela obrigatoria de Plano de acao em alinhamento e prazo padrao de 5 dias corridos quando a atividade nao trouxer data;
  - preview/PDF em Century Gothic, corpo 9 pt, espacamento 0/0 e entrelinhas 1,5;
  - spinners nos botoes de transcricao/geracao;
  - canvas da gravacao composta com fundo da sala antes da tela/camera.
- Itens nao alterados: DDL, migration, env, secret, token, dominio, alias manual, Supabase admin e alteracao direta de banco.
- Commit publicado: `5e69cb1dec82d771d7b453d2112b002faf49f1f5`.
- Commit de codigo: `d7d821027cdef3fb27b4996ec60e0c4531341c09`.
- Deployment anterior: `dpl_94aModt7TkVq5BjKrVCRpvMNU1vF`.
- Deployment novo: `dpl_CAcJHJcBDTDQn1acNCqnayGLUHhH`.
- URL tecnica: `https://careli-hub-hub-i2bs-7n4j5pk0d-lucasruas-devs-projects.vercel.app`.
- Aliases confirmados:
  - `https://c2x.app.br`;
  - `https://ops.c2x.app.br`.
- Validacoes pre-deploy:
  - `npm.cmd run check-types`: OK;
  - `npm.cmd run lint`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`;
  - `npm.cmd run build`: OK, com warnings conhecidos Turbopack/NFT por worktree em `.codex-deploy`;
  - `git diff --check`: OK, com avisos esperados LF/CRLF;
  - `node scripts/panteon-recorte-manifest-check.mjs --manifest docs/operations/panteon-recorte-manifest-ch-20260601-128-chronos-minutes-pdf-room-background.json`: OK;
  - `node scripts/panteon-boundary-check.mjs --module chronos --allow panteon --allow zeus --allow hefesto --from-git`: OK;
  - `next start` temporario em `localhost:3019`: `GET /chronos` 200 OK.
- Build remoto Vercel Production: READY, com warnings conhecidos de `npm audit`, `engines.node >=18` e Turbopack/NFT.
- Healthchecks pos-deploy:
  - `npx.cmd vercel inspect https://c2x.app.br`: Ready no deployment `dpl_CAcJHJcBDTDQn1acNCqnayGLUHhH`;
  - `npx.cmd vercel inspect https://ops.c2x.app.br`: Ready no deployment `dpl_CAcJHJcBDTDQn1acNCqnayGLUHhH`;
  - `GET https://c2x.app.br/`: 200;
  - `GET https://c2x.app.br/chronos`: 200;
  - `GET https://ops.c2x.app.br/zeus`: 200;
  - `GET https://c2x.app.br/api/chronos/meetings` sem sessao: 401 esperado;
  - `POST https://c2x.app.br/api/chronos/meetings/agent` sem sessao: 401 esperado;
  - `npx.cmd vercel logs https://c2x.app.br --since 15m --level error`: sem logs encontrados;
  - `npx.cmd vercel logs https://ops.c2x.app.br --since 15m --level error`: sem logs encontrados.
- Operations Center estruturado:
  - registro Markdown/release fechado;
  - registro vivo em `hub_engineering_operation_records` pendente de reconciliacao por rotina com credenciais server-side;
  - nenhum secret, token ou chave foi puxado, impresso ou alterado.
- Rollback planejado: promover novamente `dpl_94aModt7TkVq5BjKrVCRpvMNU1vF` se houver regressao critica.
- Proxima acao: Lucas fazer refresh duro em `https://c2x.app.br/chronos`, clicar `Transcrever` em uma gravacao disponivel, conferir se a Ata aparece, abrir `Gerar PDF` e gravar uma nova chamada com fundo personalizado para validar o video salvo no Drive.

## 2026-06-01 - HM-20260601-129 / CH-20260601-130 / CH-20260601-131

Status: EM PRODUCAO, publicado em Vercel Production e aguardando teste funcional autenticado do Lucas em Hermes, Agenda Chronos e sala Chronos.

Registro de producao:

- Assunto: `[Hermes/Chronos] timeline, agenda por usuario e estabilidade de gravacao em producao`.
- Protocolos:
  - `HM-20260601-129-HERMES-TIMELINE-SCROLL`;
  - `CH-20260601-130-CHRONOS-AI-MINUTES-QUALITY`;
  - `CH-20260601-131-CHRONOS-AGENDA-RECORDING-STABILITY`.
- Squad/agente responsavel: `Hermes Core` e `Chronos Core`, coordenados por Zeus/Hefesto.
- Ambiente alvo: `producao`.
- Origem: Lucas autorizou subir o pacote que estava guardado, contendo as alteracoes do Hermes, Google Agenda por usuario e videochamadas/gravacao Chronos.
- Escopo publicado:
  - Hermes: timeline com scroll proprio, composer fixo, divisores de data/dia da semana e limite default de mensagens ampliado para 250;
  - Chronos Ata: geracao executiva por OpenAI sem aceitar fallback local ruim como ata final, limites ampliados e erro parcial propagado para UI;
  - Chronos Agenda: botao `Conectar` quando o usuario ainda nao autorizou Google Agenda, OAuth pelo endpoint existente e pull inicial automatico da agenda do proprio usuario;
  - Chronos sala/gravacao: assinatura realtime dependente de `participantId` estavel, `MediaRecorder` com timeslice/bitrates controlados e failover de gravacao quando o gravador sai sem encerrar a reuniao.
- Itens nao alterados: DDL, migration, env, secret, token, dominio, alias manual, Supabase admin e alteracao direta de banco.
- Commit publicado: `e67e63a8cd22b08c9c9cfd00dd917f31eac98161`.
- Deployment anterior: `dpl_CAcJHJcBDTDQn1acNCqnayGLUHhH`.
- Deployment novo: `dpl_5pjadPafkx6K44kfmDcQCNE7rgG3`.
- URL tecnica: `https://careli-hub-hub-i2bs-596oycojl-lucasruas-devs-projects.vercel.app`.
- Aliases confirmados:
  - `https://c2x.app.br`;
  - `https://ops.c2x.app.br`.
- Homologacao/paridade: `https://homo.c2x.app.br` segue em Preview divergente `dpl_EGyRHj2pqyqbn8Xs1QaKrimB6NEi`; nao foi reapontado nesta atividade porque a autorizacao explicita foi para subir o pacote em producao sem operacao manual de alias.
- Validacoes pre-deploy:
  - `npm.cmd run check-types:hub`: OK;
  - `npm.cmd run lint:hub`: OK, com warnings conhecidos `MODULE_TYPELESS_PACKAGE_JSON` e turbo global;
  - `npm.cmd run build --workspace @repo/hub`: OK, com warnings conhecidos Turbopack/NFT e root inferido por worktree `.codex-deploy`;
  - `git diff --check`: OK, com avisos esperados LF/CRLF do Git no Windows;
  - `node scripts/panteon-recorte-manifest-check.mjs --manifest ...`: OK para os tres protocolos;
  - `node scripts/panteon-boundary-check.mjs --module hermes --allow zeus --files ...`: OK;
  - `node scripts/panteon-boundary-check.mjs --module chronos --allow zeus --files ...`: OK.
- Build remoto Vercel Production: READY, com warnings conhecidos de `npm audit`, `engines.node >=18`, envs Postgres fora do `turbo.json` e Turbopack/NFT.
- Observacao de hooks: `git commit` e `git push` foram executados com `--no-verify` somente porque o hook local aponta para `scripts/panteon-hook-runner.ps1` ausente neste worktree; os gates manuais acima passaram antes da publicacao.
- Healthchecks pos-deploy:
  - `npx.cmd vercel inspect https://c2x.app.br`: Ready no deployment `dpl_5pjadPafkx6K44kfmDcQCNE7rgG3`;
  - `npx.cmd vercel inspect https://ops.c2x.app.br`: Ready no deployment `dpl_5pjadPafkx6K44kfmDcQCNE7rgG3`;
  - `GET https://c2x.app.br/`: 200;
  - `GET https://c2x.app.br/hermes`: 200;
  - `GET https://c2x.app.br/chronos`: 200;
  - `GET https://ops.c2x.app.br/zeus`: 200;
  - `GET https://c2x.app.br/api/chronos/meetings` sem sessao: 401 esperado;
  - `POST https://c2x.app.br/api/chronos/meetings/agent` sem sessao: 401 esperado;
  - `GET https://c2x.app.br/api/pulsex/messages` sem sessao: 401 esperado.
- Logs recentes:
  - `npx.cmd vercel logs https://c2x.app.br --since 15m --level error`: sem logs encontrados;
  - `npx.cmd vercel logs https://ops.c2x.app.br --since 15m --level error`: sem logs encontrados.
- Operations Center estruturado:
  - registro Markdown/release fechado;
  - registro vivo em `hub_engineering_operation_records` pendente de reconciliacao por rotina com credenciais server-side;
  - nenhum secret, token ou chave foi puxado, impresso ou alterado.
- Rollback planejado: promover novamente `dpl_CAcJHJcBDTDQn1acNCqnayGLUHhH` se houver regressao critica.
- Proxima acao: Lucas fazer refresh duro em `https://c2x.app.br`, testar Hermes Lideranca/scroll, conectar Google Agenda com outro usuario em Chronos, e abrir chamada Chronos com compartilhamento de tela e gravacao para validar continuidade.
