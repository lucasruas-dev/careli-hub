# Security Governance

Este documento define a camada formal de governanca e seguranca do Panteon para operacoes de infraestrutura, ambientes, Vercel, Supabase, banco, dominios, deploys, rollback, secrets e incidentes.

## Principios obrigatorios

- Lucas e a autoridade humana final para qualquer operacao sensivel.
- Operacoes sensiveis iniciam como `BLOQUEADO` ate autorizacao explicita do Lucas.
- Nenhum agente pode criar, alterar, remover, renomear, copiar, rotacionar ou expor envs, secrets, tokens, service role, `POSTGRES_URL`, Supabase keys, Vercel envs, chaves externas, aliases de env ou credenciais sem autorizacao explicita do Lucas.
- Secrets nunca devem aparecer em logs, respostas, commits, prints, documentacao, mensagens, screenshots ou registros operacionais.
- Producao e ambiente critico; homologacao e o caminho padrao antes de producao quando houver risco operacional.
- Toda alteracao sensivel deve gerar protocolo, registro no Engineering Operations, impacto, risco, validacao, responsavel, data/hora e status final.

## Escopo de operacoes sensiveis

Uma operacao deve ser tratada como sensivel quando envolver:

- Vercel Project, Vercel envs, aliases, dominios, custom environments, protection bypass ou production deployment.
- Supabase Auth, REST/Data API, Realtime, Storage, RLS, grants, migrations, service role, secret key, anon key ou publishable key.
- Banco real, `POSTGRES_URL`, pooler, direct connection, replicas, dumps, seeds ou scripts que escrevem dados.
- APIs, webhooks, conectores e chaves externas como Asaas, D4Sign, OpenAI, Meta, WhatsApp, e-mail, storage ou filas.
- Rollback, promocao, redeploy, troca de branch, troca de dominio ou mudanca de ambiente.

## Protocolo minimo

Cada operacao sensivel deve registrar:

- Protocolo no formato `INFRA-YYYYMMDD-HHMM-<tema>`.
- Ambiente: local, homologacao ou producao.
- Responsavel: squad/agente executor e aprovador humano.
- Motivo, impacto esperado e risco operacional.
- Arquivos, dashboards ou recursos afetados, sem valores sensiveis.
- Validacoes antes e depois.
- Plano de rollback e criterio de reversao.
- Status final: `BLOQUEADO`, `AGUARDANDO RELEASEOPS`, `AGUARDANDO DATAOPS`, `EM PRODUCAO`, `FINALIZADO` ou `OPERACIONAL COM ATENCAO`.

## Autoridade por squad

- `Zeus`: ambientes, envs, Vercel, Supabase runtime, healthchecks, aliases, dominios, protecao, safe mode e estabilidade.
- `Zeus`: schema, migrations, grants, RLS, seeds e validacao de banco. Nao aplica migration real sem confirmacao do Lucas.
- `Hefesto`: commit, release, build, deploy, rollback e rastreabilidade apos recorte validado.
- `Zeus`: diagnostico de incidente, logs, regressao, impacto em usuario e evidencia tecnica.
- Squads de produto: podem apontar necessidade, mas nao alteram chaves, envs, banco, dominio ou producao diretamente.

## Safe Mode

Quando uma env critica estiver ausente, invalida ou apontando para ambiente incorreto, o sistema deve:

- Bloquear acoes destrutivas e escritas reais.
- Falhar fechado em rotas protegidas.
- Exibir erro operacional claro, sem revelar segredo.
- Registrar diagnostico mascarado apenas com nome da env, ambiente, status de presenca e impacto.
- Evitar fallback para producao quando a intencao for homologacao.

## Referencias internas

- `docs/architecture/api-connection-governance.md`
- `docs/architecture/environment-governance.md`
- `docs/architecture/production-safety-policy.md`
- `docs/architecture/incident-response-policy.md`
- `docs/architecture/release-and-rollback-policy.md`
- `docs/architecture/secret-management-policy.md`
- `docs/architecture/agent-operating-model.md`
- `docs/operations/README.md`
- `docs/operations/engineering-operations.md`
