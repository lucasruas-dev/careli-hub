# Incident Response Policy

Este documento define o fluxo de resposta a incidentes do Careli Hub.

## Quando abrir incidente

Abrir incidente quando houver:

- queda ou degradacao de producao;
- erro por env, chave, secret, Supabase, Vercel, banco ou dominio;
- rotas retornando `503` por ambiente nao configurado;
- autenticacao quebrada;
- perda de acesso a modulo operacional;
- deploy com alias errado;
- migration ou schema causando falha;
- risco de dado, segredo ou producao cruzada.

## Triage inicial

1. Classificar ambiente: local, homologacao ou producao.
2. Registrar protocolo `INC-YYYYMMDD-HHMM-<tema>`.
3. Verificar se ha segredo exposto. Se houver, parar e escalar para Lucas/InfraOps.
4. Identificar ultimo deploy, branch, commit e alias.
5. Separar sintoma, causa provavel e evidencia confirmada.
6. Manter operacao sensivel `BLOQUEADO` ate autorizacao.

## Responsabilidades

- `Hub SupportOps`: diagnostico inicial, sintomas, logs, reproducao, impacto em usuario e evidencias.
- `Hub InfraOps`: Vercel, envs, Supabase runtime, dominio, alias, protection bypass, healthchecks e safe mode.
- `Hub DataOps`: banco, migrations, RLS, grants, schema, dados e conexao Postgres.
- `Hub ReleaseOps`: publica correcao somente depois que o recorte estiver validado e autorizado.
- Lucas: aprova operacoes sensiveis e decide continuidade/rollback quando houver risco.

## Incidente por env ou chave

Em falhas por env/chave:

- nao exibir valores;
- comparar apenas presenca, ambiente, nome e criticidade;
- verificar se a env e publica ou server-only;
- confirmar se o runtime recebeu a env apos redeploy;
- validar se Preview/Homologacao esta isolado de Production;
- registrar causa raiz e acao corretiva.

## Comunicacao operacional

Toda resposta de incidente deve informar:

- ambiente;
- impacto pratico;
- rotas ou modulos afetados;
- evidencia confirmada;
- o que esta bloqueado;
- quem deve agir;
- proximo passo;
- status final.

## Encerramento

Um incidente so fecha quando:

- causa raiz foi registrada;
- correcao ou rollback foi validado;
- healthchecks passaram;
- pendencias foram listadas;
- Engineering Operations foi atualizado;
- Lucas recebeu handoff claro.
