# Careli Hub - operacoes e governanca

Esta pasta e a casa operacional do Careli Hub. Ela separa o diario vivo de operacao das politicas de arquitetura e seguranca, sem perder o historico do projeto.

## Arquivos principais

- `docs/operations/engineering-operations.md`: diario operacional vivo, append-only, com decisoes, incidentes, validacoes, deploys, handoffs e status.
- `docs/operations/squadops-center-process.md`: processo oficial do SquadOps Center, protocolos `TK/AT/AL/DP`, homologacao, producao e operacao dedicada em `ops.c2x.app.br`.
- `docs/operations/hub-rescueops.md`: protocolo do `Hub RescueOps` para resposta critica, recuperacao operacional, incidentes, rollback, healthchecks e bloqueios sensiveis.
- `docs/operations/agent-handoff-scripts.md`: scripts de encaminhamento para acionar agentes sem misturar recortes.
- `docs/operations/guardian-deploy-blocker-review-2026-05-18.md`: parecer Guardian enxuto sobre criticidade real e prompts curtos para remover bloqueios.
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

## Scripts para agentes

Quando Lucas pedir scripts, prompts ou encaminhamentos para agentes/squads, o padrao operacional e criar ou atualizar um arquivo em `docs/operations/` e responder no chat apenas com:

- caminho do arquivo;
- resumo do que foi criado;
- validacao executada;
- status e proxima squad.

Evite despejar scripts longos diretamente no chat. Use texto completo no chat somente se Lucas pedir explicitamente.

## Guardiao da arquitetura

Hub InfraOps assume o papel de guardiao da arquitetura operacional para proteger ambientes, chaves, Supabase, Vercel, banco, dominios, deploys e estabilidade. Esse papel nao substitui Lucas: Lucas segue como autoridade humana final para operacoes sensiveis.

O guardiao pode auditar, orientar, bloquear e registrar riscos. Ele nao deve criar, alterar, remover, expor ou rotacionar secrets/envs, aplicar migrations, publicar producao ou trocar dominios sem autorizacao explicita do Lucas.

## Hub RescueOps

`Hub RescueOps` e a camada unificada de resposta critica quando Lucas encaminhar problema de deploy, build, runtime, Vercel, Supabase, envs, secrets, banco, migrations, healthchecks, rollback, preview, homologacao, producao, autenticacao, erros `401`, `403`, `500`, `503`, dominio, alias ou incidente operacional.

O RescueOps pode diagnosticar ponta a ponta, validar de forma nao destrutiva, propor correcao, coordenar squads e registrar o incidente. Qualquer acao sensivel continua `BLOQUEADO` ate autorizacao explicita do Lucas.
