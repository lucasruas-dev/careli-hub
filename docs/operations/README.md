# Panteon - operacoes e governanca

Esta pasta e a casa operacional do Panteon. Ela separa o diario vivo de operacao das politicas de arquitetura e seguranca, sem perder o historico do projeto.

## Nomenclatura atual

- Produto/plataforma: `Panteon` (antes Careli Hub).
- `Zeus`: antigo SquadOps e agente central de Operations Center, SupportOps, DataOps e InfraOps.
- `Hefesto`: agente de promocao para producao, healthchecks finais, rollback e rastreabilidade oficial de producao.
- `Hades`: antigo Guardian.
- `Iris`: antigo CareDesk/CoreDesk.
- `Hermes`: antigo PulseX.
- `Chronos` e `Atlas`: nomes preservados.

Nomes tecnicos legados em tabelas, envs, migrations, rotas antigas e historico operacional podem permanecer como compatibilidade ate migracao autorizada por Lucas.

## Arquivos principais

- `docs/operations/engineering-operations.md`: diario operacional vivo, append-only, com decisoes, incidentes, validacoes, deploys, handoffs e status.
- `docs/operations/releases-homologation.md`: indice operacional dos recortes publicados/preparados para homologacao.
- `docs/operations/releases-production.md`: indice operacional dos recortes publicados/bloqueados em producao.
- `docs/operations/agent-release-register-prompt.md`: prompt oficial para orientar agentes no registro por ambiente.
- `docs/operations/panteon-agent-communication-protocol.md`: protocolo oficial de comunicacao entre agentes, agente master Zeus, handoffs, bloqueios e roadmap das tabelas `hub_agent_*`.
- `docs/operations/panteon-agent-messaging-v1-design.md`: desenho tecnico revisavel da V1 `hub_agent_*`, incluindo modelo de dados, API proposta, seguranca, RLS futura e gates antes de migration.
- `docs/operations/panteon-engineering-evolution-roadmap.md`: roadmap de evolucao da engenharia por fases, com gates para Zeus, Hefesto, worktrees, V1 `hub_agent_*` e squads.
- `docs/operations/panteon-agent-worktree-startup-template.md`: template de abertura de novo chat/agente em worktree separado, com leitura obrigatoria, primeira acao, bloqueios e retorno esperado.
- `docs/operations/panteon-agent-scaffolds.md`: scaffolds operacionais por agente, com worktree, branch, escopo, bloqueios, prompt e ordem recomendada de criacao.
- `docs/operations/panteon-worktree-operating-model.md`: modelo operacional de worktrees separados por agente, branches `codex/*`, checkpoints, validacoes e bloqueios de pacote misto.
- `docs/operations/panteon-validation-checklists.md`: checklists de validacao por tipo de recorte, cobrindo docs, frontend, API, banco, Supabase, Vercel, homologacao, producao e incidentes.
- `docs/operations/panteon-terminal-standard.md`: padrao de terminal operacional em Windows, com PowerShell 7 (`pwsh`) como runtime principal e `powershell.exe` apenas como fallback.
- `docs/operations/panteon-git-hooks.md`: padrao local de hooks Git do Panteon, com `pre-commit`, `commit-msg`, `pre-push`, instalador e limites de seguranca.
- `docs/operations/zeus-core-v2-startup.md`: prompt de continuidade para abrir novo chat Zeus quando houver `CHAT SATURANDO`.
- `docs/operations/squadops-center-process.md`: processo oficial do Zeus / Operations Center, protocolos `AT/CB/TI/OP/AL/DP`, homologacao, producao e operacao dedicada em `ops.c2x.app.br`.
- `docs/operations/hub-rescueops.md`: protocolo historico de resposta critica, agora absorvido operacionalmente por `Zeus`, para recuperacao operacional, incidentes, rollback, healthchecks e bloqueios sensiveis.
- `docs/operations/agent-handoff-scripts.md`: scripts de encaminhamento para acionar agentes sem misturar recortes.
- `scripts/panteon-validate-worktree.ps1`: script local de validacao de worktree, com junction opcional para dependencias compartilhadas do repositorio principal.
- `scripts/panteon-new-worktree.ps1`: script local em modo preview para sugerir criacao segura de worktree e branch por agente, sem executar por padrao.
- `scripts/panteon-scaffold-agents.ps1`: script local para listar scaffolds padrao de agentes, worktrees, branches, escopos e comandos de criacao individual.
- `scripts/panteon-install-hooks.ps1`: script local para instalar hooks Git do Panteon no diretorio real de hooks do repositorio, com preview e backup.
- `scripts/panteon-hook-runner.ps1`: runner PowerShell chamado pelos hooks versionados em `.githooks/`.
- `docs/operations/guardian-deploy-blocker-review-2026-05-18.md`: parecer Hades em arquivo de nome legado sobre criticidade real e prompts curtos para remover bloqueios.
- `docs/codex/engineering-operations.md`: ponte de compatibilidade para o caminho historico; nao recebe novas entradas.
- `docs/architecture/panteon-architecture-map.md`: mapa executivo da arquitetura Panteon, com camadas, worktrees, agentes, fluxo de release, ambientes e governanca.
- `docs/architecture/panteon-architecture-board.svg`: board visual executivo do mapa Panteon para apresentacao e revisao.
- `docs/architecture/agent-operating-model.md`: comportamento esperado dos agentes e papel de guardiao da arquitetura operacional.
- `docs/architecture/security-governance.md`: regras gerais de seguranca, autorizacao humana, operacoes sensiveis e safe mode.
- `docs/architecture/environment-governance.md`: ambientes, env registry e bloqueio padrao para envs.
- `docs/architecture/api-connection-governance.md`: mapa de APIs, conectores, env names, autorizacoes e roteiro seguro de diagnostico para agentes.
- `docs/architecture/production-safety-policy.md`: protecao de producao.
- `docs/architecture/incident-response-policy.md`: resposta a incidentes.
- `docs/architecture/release-and-rollback-policy.md`: release, healthcheck e rollback.
- `docs/architecture/secret-management-policy.md`: gestao de secrets sem exposicao de valores.

## Regras de uso

- Leia esta pasta antes de atuar em Vercel, Supabase, banco, dominios, deploys, rollback, envs, secrets ou incidentes.
- Leia `docs/architecture/api-connection-governance.md` antes de diagnosticar ou alterar qualquer API externa, webhook, conector, bearer, token, service role, banco ou integracao.
- Registre novas entradas somente no diario canonico `docs/operations/engineering-operations.md`.
- Mantenha o diario append-only: nao apague historico; normalize por entradas novas.
- Use `docs/operations/releases-homologation.md` como referencia objetiva do que foi homologado, esta em homologacao ou esta pronto para producao.
- Use `docs/operations/releases-production.md` como referencia objetiva do que foi publicado, bloqueado ou rollbackado em producao.
- Nao registre valores de secrets, tokens, senhas, service role, `POSTGRES_URL` ou chaves externas.
- Toda operacao sensivel comeca `BLOQUEADO` ate autorizacao expressa do Lucas.
- Homologacao e o caminho padrao antes de producao quando houver risco operacional.
- Em Windows, use PowerShell 7 (`pwsh`) como terminal operacional padrao. Use Windows PowerShell 5.1 (`powershell.exe`) apenas como fallback quando `pwsh` nao estiver disponivel ou nao iniciar na sessao atual, e continue usando `npm.cmd`/`npx.cmd` para comandos Node.
- Cada agente de modulo publica o proprio recorte em homologacao quando Lucas autorizar, registra modulo, pacote, atividades, commit/deploy, validacoes, riscos e status. `Hefesto` recebe esses handoffs homologados e promove producao por modulo, sem assumir homologacao de todos os recortes.
- Comunicacao entre agentes deve seguir `docs/operations/panteon-agent-communication-protocol.md`: origem, destino, modulo, protocolo, tipo, prioridade, status, decisao esperada e evidencias. Zeus atua como agente master organizando o trafego; Hefesto recebe producao; Iris centraliza comunicacao externa.
- Todo agente deve acionar `CHAT SATURANDO` quando o chat ficar pesado, houver compactacoes sucessivas ou risco de perda de contexto. O checkpoint deve registrar estado, worktree/branch, arquivos, validacoes, riscos e proximo passo no diario canonico, alem de preparar um resumo curto para abertura de novo chat.
- Se `Zeus` for autorizado por Lucas a executar/publicar seu proprio recorte, o fechamento nao pode ficar so no chat nem so no Markdown: o agente deve atualizar a fonte estruturada do Operations Center, reconciliar protocolos `AT/CB/TI/OP/AL/DP`, preencher commit/deploy/validacoes/status real e depois registrar a decisao no diario canonico. Quando o recorte for da tela Zeus e o Zeus fizer o processo inteiro com publicacao, o registro final deve ficar `EM PRODUCAO`, nao `AGUARDANDO RELEASEOPS`.
- Como `https://c2x.app.br` e `https://ops.c2x.app.br` compartilham o mesmo projeto/deployment Vercel, todo deploy de producao deve inspecionar os dois aliases antes e depois. Se o pacote nao preservar o estado vigente do Panteon principal e do Zeus/OPS, `Hefesto` deve bloquear, preparar recorte limpo que preserve ambos ou registrar rollback/restauracao de alias antes de publicar.
- Paridade homologacao/producao: depois de qualquer deploy de producao, `Hefesto` deve garantir que `https://homo.c2x.app.br` aponte para um deployment Preview gerado do mesmo commit/recorte aprovado, ou registrar explicitamente o motivo da divergencia. Nao usar worktree sujo para esse espelhamento; gerar pacote limpo a partir do commit publicado em producao.

## Padrao visual oficial

- A Home principal do Panteon e a referencia visual oficial para todos os modulos. Novas telas devem herdar a mesma densidade operacional, hierarquia, ritmo de surfaces/cards, cabecalhos objetivos e linguagem executiva antes de propor variacao local.
- Todos os sidebars, tanto o global quanto sidebars internos de modulo, devem seguir o layout, cor, estados e comportamento do sidebar principal do Panteon. A base visual canonica e grafite `#101820`, com accent Careli `#A07C3B`, header compacto sem subtitulo operacional redundante, icone ativo com fundo preto, leitura recolhida/expandida consistente e interacoes identicas quando a funcao for a mesma. O topo deve sempre trazer icone preto do modulo, nome do modulo, botao para abrir o sidebar/launcher do Panteon e botao de recolher/expandir, separado da navegacao por divisor discreto.
- O perfil do usuario logado deve aparecer no topbar/header da tela, no canto superior direito, seguindo o padrao do Panteon principal: status, avatar, nome e saida. Nao mover esse bloco para o sidebar; sidebars continuam sendo apenas navegacao e contexto do modulo.
- Qualquer excecao visual de sidebar ou de estrutura da Home precisa ter motivo operacional claro, validacao visual e registro no diario canonico.
- A Iris e modulo ativo e liberado no sidebar principal do Panteon em producao. Nao reintroduzir bloqueio hardcoded para `iris` em listas como `hiddenProductionModuleIds`; qualquer retirada da Iris do sidebar precisa de autorizacao explicita do Lucas, motivo operacional registrado e deve preferir registry/permissao em vez de bloqueio fixo no shell.

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
