# Release And Rollback Policy

Este documento define o protocolo de release, deploy critico e rollback do Panteon.

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
- quando o projeto Vercel possuir mais de um alias de producao, inspecionar todos os aliases afetados antes do deploy e registrar qual deployment cada dominio aponta;
- validar em homologacao quando houver risco;
- registrar aprovacao do Lucas para operacoes sensiveis;
- executar validacoes aplicaveis;
- registrar rollback path.

## Homologacao por modulo

- Cada agente de modulo e responsavel por publicar em homologacao apenas o proprio recorte quando Lucas autorizar.
- O registro de homologacao deve informar modulo, pacote, atividades/protocolos, branch/commit, deployment/alias de homologacao, validacoes, riscos, pendencias e status.
- O registro objetivo de homologacao deve ser feito em `docs/operations/releases-homologation.md`; o resumo consolidado continua no diario `docs/operations/engineering-operations.md`.
- Quando o recorte estiver aprovado em homologacao, o agente sinaliza `PRONTO PARA PRODUCAO` no Zeus/Operations Center.
- `Hefesto` recebe o handoff por modulo e promove producao somente do que estiver homologado, validado e autorizado.
- Antes de promover producao, `Hefesto` deve consultar `docs/operations/releases-homologation.md`, `docs/operations/releases-production.md`, o diario canonico e o Git/worktree.
- Se um commit ou pacote misturar modulos ou itens aprovados e reprovados, `Hefesto` deve bloquear ou exigir novo recorte limpo antes da producao.
- Apos uma promocao para producao, `Hefesto` deve reconciliar `https://homo.c2x.app.br` para um deployment Preview gerado do mesmo commit/recorte publicado. Se homologacao precisar divergir de producao, a divergencia deve ser intencional, justificada e registrada.

## Registro minimo de deploy

Todo deploy critico deve registrar:

- protocolo;
- branch;
- commit publicado;
- deployment novo;
- deployment anterior;
- alias ou dominio afetado;
- impacto sobre aliases compartilhados, incluindo `c2x.app.br` e `ops.c2x.app.br` quando estiverem no mesmo deployment;
- deployment/alias de homologacao reconciliado com o commit publicado, ou justificativa para divergencia;
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
- acionar Zeus/Zeus quando necessario;
- manter monitoramento proporcional ao risco.
