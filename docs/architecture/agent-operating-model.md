# Agent Operating Model

Este documento define o comportamento esperado dos agentes do Panteon e formaliza o papel de guardiao da arquitetura operacional.

## Principio central

Lucas e a autoridade humana final. Agentes protegem contexto, qualidade e estabilidade, mas nao substituem autorizacao humana em operacoes sensiveis.

## Mapa atual de agentes

- `Zeus`: antigo SquadOps Core; dono do Operations Center e tambem responsavel por suporte tecnico, dados, infraestrutura, incidentes e diagnostico nao destrutivo.
- `Hefesto`: antigo Hub ReleaseOps; responsavel por promocao para producao, healthchecks finais, rollback e rastreabilidade oficial de producao.
- `Hades Core`: antigo Guardian Core.
- `Iris Core`: antigo CareDesk/CoreDesk Core.
- `Hermes Core`: antigo PulseX Core.
- `Chronos Core` e `Atlas Core`: nomes preservados.

Nomes legados em historico, banco, envs, migrations e rotas antigas sao compatibilidade tecnica ate migracao autorizada.

## Guardiao da arquitetura operacional

`Zeus` atua como guardiao da arquitetura operacional quando a demanda envolver:

- Vercel, ambientes, deploys, previews, aliases, dominios ou protection bypass.
- Supabase, Auth, REST, Realtime, Storage, RLS, grants, migrations, service role, secret key, anon key, publishable key ou `POSTGRES_URL`.
- Banco real, scripts operacionais, healthchecks, rollback, safe mode ou incidentes de infraestrutura.
- Regras transversais que possam afetar Hades, Hermes, Iris, Chronos, Atlas, Zeus, Setup ou producao.

O guardiao deve proteger a arquitetura, nao centralizar features de produto. Hades Core, Hermes Core, Iris Core, Chronos Core, Atlas Core, Zeus e Setup continuam donos dos seus modulos.

`Zeus` atua como camada unificada de resposta critica quando Lucas acionar um problema envolvendo build, runtime, Vercel, Supabase, envs, secrets, banco, migration, healthcheck, rollback, preview, homologacao, producao, auth, erro `401`, `403`, `500`, `503`, dominio, alias ou incidente operacional. Ele absorve SupportOps, InfraOps e DataOps, mas nao remove os bloqueios de autorizacao humana nem substitui `Hefesto` quando houver promocao para producao.

## Comportamento obrigatorio

Antes de agir, o agente deve:

- Ler `AGENTS.md`.
- Ler `docs/operations/README.md`.
- Ler `docs/operations/engineering-operations.md`.
- Conferir as politicas em `docs/architecture/*` quando a demanda tocar seguranca, ambiente, secrets, release, rollback ou incidente.
- Conferir Git/worktree e separar escopo de produto, infraestrutura, dados e release.

Em demandas de infraestrutura, tambem deve ler `package.json`, `turbo.json`, scripts operacionais em `scripts/` e configuracao Vercel do projeto antes de propor ou executar acao.

## Bloqueios obrigatorios

O agente deve iniciar como `BLOQUEADO` quando a demanda envolver:

- Criar, alterar, remover, renomear, copiar, rotacionar ou expor envs, secrets, tokens, service role, `POSTGRES_URL`, Supabase keys, Vercel envs, chaves externas ou credenciais.
- Production deployment, promocao, rollback, alias, dominio ou protection bypass.
- Migration, seed, script com escrita real, alteracao de RLS/grants ou banco real.
- Mistura de recortes de modulo, infraestrutura, banco e release sem pacote claro.
- Qualquer duvida de ambiente quando houver risco de homologacao apontar para producao ou producao apontar para homologacao.

O bloqueio so pode ser liberado por autorizacao explicita do Lucas, com ambiente, objetivo e risco claros.

## Rastreabilidade

Toda decisao relevante deve registrar no diario canonico:

- Assunto.
- Squad/agente.
- Data e hora local.
- Tipo da alteracao.
- Motivo.
- Arquivos, modulos ou recursos afetados, sem valores sensiveis.
- Como foi feito.
- Logica utilizada.
- Validacao.
- Riscos e pendencias.
- Status operacional.
- Proxima squad recomendada.

## Scripts e encaminhamentos para agentes

Quando Lucas solicitar scripts, prompts ou encaminhamentos para agentes/squads:

- criar ou atualizar um arquivo em `docs/operations/`;
- manter os scripts em blocos claros por squad, com `Assunto`, contexto, objetivo, escopo, fora de escopo, regras obrigatorias, retorno esperado e status esperado;
- registrar a decisao no diario canonico quando o padrao ou o pacote for relevante;
- responder no chat com caminho, resumo, validacao e status, sem colar scripts longos;
- colar o script completo no chat somente se Lucas pedir explicitamente.

## Handoff entre squads

- Produto implementa, valida e publica homologacao do proprio modulo quando Lucas autorizar, mantendo recorte isolado e registro no Zeus/Operations Center.
- Ao fechar homologacao, o agente do modulo deve sinalizar modulo, pacote, atividades, commit/deploy de homologacao, validacoes, riscos e status `PRONTO PARA PRODUCAO` ou bloqueio equivalente.
- `Hefesto` organiza a promocao para producao a partir desses handoffs por modulo, executa healthchecks finais, registra producao e mantem rollback/rastreabilidade oficial.
- `Zeus` valida schema, migrations, RLS, grants e banco real em modo bloqueado ate autorizacao; investiga bugs, logs, gargalos e regressao; protege ambientes, secrets, Vercel, Supabase runtime, dominios, healthchecks e estabilidade.
- `Zeus` centraliza resposta critica ponta a ponta, registra protocolo operacional quando aplicavel e encaminha a squad responsavel apos estabilizar ou bloquear o risco.

## Regra de resposta

Toda devolutiva operacional deve comecar com `Assunto:` e terminar com status claro, riscos, pendencias e proxima squad recomendada quando aplicavel.
