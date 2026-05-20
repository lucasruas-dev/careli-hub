# Panteon - operacoes e governanca

Esta pasta e a casa operacional do Panteon. Ela separa o diario vivo de operacao das politicas de arquitetura e seguranca, sem perder o historico do projeto.

## Nomenclatura atual

- Produto/plataforma: `Panteon` (antes Careli Hub).
- `Zeus`: antigo SquadOps e agente central de Operations Center, SupportOps, DataOps e InfraOps.
- `Hefesto`: agente de release, deploy, homologacao, producao, rollback e rastreabilidade oficial.
- `Hades`: antigo Guardian.
- `Iris`: antigo CareDesk/CoreDesk.
- `Hermes`: antigo PulseX.
- `Chronos` e `Atlas`: nomes preservados.

Nomes tecnicos legados em tabelas, envs, migrations, rotas antigas e historico operacional podem permanecer como compatibilidade ate migracao autorizada por Lucas.

## Arquivos principais

- `docs/operations/engineering-operations.md`: diario operacional vivo, append-only, com decisoes, incidentes, validacoes, deploys, handoffs e status.
- `docs/operations/squadops-center-process.md`: processo oficial do Zeus / Operations Center, protocolos `TK/AT/AL/DP`, homologacao, producao e operacao dedicada em `ops.c2x.app.br`.
- `docs/operations/hub-rescueops.md`: protocolo historico de resposta critica, agora absorvido operacionalmente por `Zeus`, para recuperacao operacional, incidentes, rollback, healthchecks e bloqueios sensiveis.
- `docs/operations/agent-handoff-scripts.md`: scripts de encaminhamento para acionar agentes sem misturar recortes.
- `docs/operations/guardian-deploy-blocker-review-2026-05-18.md`: parecer Hades em arquivo de nome legado sobre criticidade real e prompts curtos para remover bloqueios.
- `docs/codex/engineering-operations.md`: ponte de compatibilidade para o caminho historico; nao recebe novas entradas.
- `docs/architecture/agent-operating-model.md`: comportamento esperado dos agentes e papel de guardiao da arquitetura operacional.
- `docs/architecture/security-governance.md`: regras gerais de seguranca, autorizacao humana, operacoes sensiveis e safe mode.
- `docs/architecture/environment-governance.md`: ambientes, env registry e bloqueio padrao para envs.
- `docs/architecture/production-safety-policy.md`: protecao de producao.
- `docs/architecture/incident-response-policy.md`: resposta a incidentes.
- `docs/architecture/release-and-rollback-policy.md`: release, healthcheck e rollback.
- `docs/architecture/secret-management-policy.md`: gestao de secrets sem exposicao de valores.

## Regras de uso

- Leia esta pasta antes de atuar em Vercel, Supabase, banco, dominios, deploys, rollback, envs, secrets ou incidentes.
- Registre novas entradas somente no diario canonico `docs/operations/engineering-operations.md`.
- Mantenha o diario append-only: nao apague historico; normalize por entradas novas.
- Nao registre valores de secrets, tokens, senhas, service role, `POSTGRES_URL` ou chaves externas.
- Toda operacao sensivel comeca `BLOQUEADO` ate autorizacao expressa do Lucas.
- Homologacao e o caminho padrao antes de producao quando houver risco operacional.
- Se `Zeus` for autorizado por Lucas a executar/publicar seu proprio recorte, o fechamento nao pode ficar so no chat nem so no Markdown: o agente deve atualizar a fonte estruturada do Operations Center, reconciliar protocolos `AT/AL/DP/TK`, preencher commit/deploy/validacoes/status real e depois registrar a decisao no diario canonico. Quando o recorte for da tela Zeus e o Zeus fizer o processo inteiro com publicacao, o registro final deve ficar `EM PRODUCAO`, nao `AGUARDANDO RELEASEOPS`.

## Padrao visual oficial

- A Home principal do Panteon e a referencia visual oficial para todos os modulos. Novas telas devem herdar a mesma densidade operacional, hierarquia, ritmo de surfaces/cards, cabecalhos objetivos e linguagem executiva antes de propor variacao local.
- Todos os sidebars, tanto o global quanto sidebars internos de modulo, devem seguir o layout, cor, estados e comportamento do sidebar principal do Panteon. A base visual canonica e grafite `#101820`, com accent Careli `#A07C3B`, header compacto sem subtitulo operacional redundante, icone ativo com fundo preto, leitura recolhida/expandida consistente e interacoes identicas quando a funcao for a mesma. O topo deve sempre trazer icone preto do modulo, nome do modulo, botao para abrir o sidebar/launcher do Panteon e botao de recolher/expandir, separado da navegacao por divisor discreto.
- O perfil do usuario logado deve aparecer no topbar/header da tela, no canto superior direito, seguindo o padrao do Panteon principal: status, avatar, nome e saida. Nao mover esse bloco para o sidebar; sidebars continuam sendo apenas navegacao e contexto do modulo.
- Qualquer excecao visual de sidebar ou de estrutura da Home precisa ter motivo operacional claro, validacao visual e registro no diario canonico.

## Scripts para agentes

Quando Lucas pedir scripts, prompts ou encaminhamentos para agentes/squads, o padrao operacional e criar ou atualizar um arquivo em `docs/operations/` e responder no chat apenas com:

- caminho do arquivo;
- resumo do que foi criado;
- validacao executada;
- status e proxima squad.

Evite despejar scripts longos diretamente no chat. Use texto completo no chat somente se Lucas pedir explicitamente.

## Guardiao da arquitetura

Zeus assume o papel de guardiao da arquitetura operacional para proteger ambientes, chaves, Supabase, Vercel, banco, dominios, deploys e estabilidade. Esse papel nao substitui Lucas: Lucas segue como autoridade humana final para operacoes sensiveis.

O guardiao pode auditar, orientar, bloquear e registrar riscos. Ele nao deve criar, alterar, remover, expor ou rotacionar secrets/envs, aplicar migrations, publicar producao ou trocar dominios sem autorizacao explicita do Lucas.

## Zeus

`Zeus` e a camada unificada de suporte, dados e infraestrutura quando Lucas encaminhar problema de build, runtime, Vercel, Supabase, envs, secrets, banco, migrations, healthchecks, rollback, preview, homologacao, producao, autenticacao, erros `401`, `403`, `500`, `503`, dominio, alias ou incidente operacional.

Zeus pode diagnosticar ponta a ponta, validar de forma nao destrutiva, propor correcao, coordenar squads e registrar o incidente. Qualquer acao sensivel continua `BLOQUEADO` ate autorizacao explicita do Lucas.
