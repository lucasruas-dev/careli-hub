# Release And Rollback Policy

Este documento define o protocolo de release, deploy critico e rollback do Careli Hub.

## Release sensivel

Um release e sensivel quando envolve:

- producao;
- envs, secrets ou chaves;
- Supabase, Postgres, Vercel ou dominios;
- migrations ou dados reais;
- integracoes externas;
- autenticacao, autorizacao ou rotas server-side protegidas;
- workflows financeiros, boletos, contratos, assinaturas ou disparos.

## Pre-release

Antes de publicar:

- confirmar escopo e arquivos do recorte;
- verificar worktree e evitar commit/deploy misturado;
- confirmar ambiente alvo;
- validar em homologacao quando houver risco;
- registrar aprovacao do Lucas para operacoes sensiveis;
- executar validacoes aplicaveis;
- registrar rollback path.

## Registro minimo de deploy

Todo deploy critico deve registrar:

- protocolo;
- branch;
- commit publicado;
- deployment novo;
- deployment anterior;
- alias ou dominio afetado;
- comandos executados;
- healthchecks;
- logs recentes;
- risco residual;
- criterio de rollback.

## Rollback path

O rollback deve ser definido antes do deploy e pode ser:

- promover deployment anterior conhecido como saudavel;
- executar `vercel rollback` para deployment especifico;
- reverter commit e publicar snapshot limpo;
- restaurar env anterior apenas com autorizacao do Lucas;
- bloquear feature por safe mode quando houver flag operacional.

Nunca executar rollback que altere env, chave, banco, dominio ou migration sem autorizacao explicita do Lucas.

## Criterios de reversao

Reverter quando:

- rota critica retorna `5xx` por configuracao;
- login/Auth quebra;
- Supabase/DB aponta para ambiente incorreto;
- modulo operacional principal fica indisponivel;
- logs mostram erro critico recorrente;
- healthcheck obrigatorio falha;
- Lucas solicita reversao.

## Pos-release

Apos publicar:

- rodar healthchecks;
- verificar logs;
- registrar resultado no Engineering Operations;
- informar riscos e pendencias;
- acionar SupportOps/DataOps quando necessario;
- manter monitoramento proporcional ao risco.
