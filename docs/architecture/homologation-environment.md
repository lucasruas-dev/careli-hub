# Ambiente de Homologacao Panteon

Este documento define o modelo oficial inicial de homologacao do Panteon.

## Objetivo

Criar uma etapa operacional entre desenvolvimento local e producao para validar:

- build, lint e typecheck;
- variaveis Vercel por ambiente;
- rotas principais;
- APIs protegidas;
- Supabase/Auth/Realtimes quando configurados;
- integracoes sensiveis sem disparos reais;
- experiencia visual antes de apontar producao.

## Modelo Oficial V1

| Camada | Papel | Fonte |
| --- | --- | --- |
| Local | Desenvolvimento e validacao inicial | `npm.cmd run dev`, `check-types`, `lint`, `build` |
| Homologacao | Validacao operacional do recorte antes de producao | Vercel Preview ou Custom Environment `homologacao` |
| Producao | Operacao real da Careli | Vercel Production em `https://c2x.app.br` |

## Branches

| Branch | Ambiente | Regra |
| --- | --- | --- |
| `main` | Producao | So recebe recorte aprovado e pronto para deploy final |
| `homolog` | Homologacao | Recebe candidato de release para validacao operacional |
| `codex/*` ou feature branches | Desenvolvimento assistido | Nao representa ambiente oficial |

Enquanto nao houver automacao Git completa, a homologacao pode ser publicada por CLI a partir da branch `homolog` usando o script oficial.

## Vercel

Usar uma destas opcoes, nesta ordem:

1. Custom Environment `homologacao`, se o plano Vercel permitir.
2. Preview Environment com branch dedicada `homolog`.

Dominio recomendado:

- `homolog.c2x.app.br`

Alternativa:

- `teste.c2x.app.br`

O dominio de homologacao deve apontar para a branch `homolog`, nao para producao.

## Supabase

Preferir um projeto Supabase separado para homologacao.

Nao usar o Supabase de producao para fluxos de escrita, tickets, alertas, syncs, alteracoes financeiras, disparos ou testes destrutivos.

Uso temporario do Supabase de producao em homologacao so e aceitavel para:

- healthcheck nao destrutivo;
- leitura controlada;
- diagnostico manual;
- validacao explicitamente autorizada por Lucas.

### Criterio Zeus V1

Para homologacao com persistencia real, o ambiente deve usar um projeto Supabase de homologacao separado, com Auth, schemas, RLS, grants e migrations equivalentes ao recorte em validacao.

O Preview Vercel pode ser criado sem persistencia real apenas como smoke de infraestrutura, desde que fique registrado como `BLOQUEADO PARA FLUXOS DE ESCRITA` e nao seja usado para validar Ticket TI, protocolos, syncs ou qualquer rotina que dependa de banco.

Nao configurar `SUPABASE_SERVICE_ROLE_KEY` de producao no ambiente Preview/Custom Environment de homologacao. Se a homologacao usar temporariamente o Supabase de producao para leitura controlada, ela deve operar sem escrita e com autorizacao explicita do Lucas.

Para um Supabase de homologacao novo, aplicar a base completa em ordem controlada:

1. `0001_create_hub_core_schema.sql`
2. `0002_setup_and_pulsex_core.sql`
3. `0003_setup_beta_policies.sql`
4. `0003_setup_operational_access.sql`
5. `0004_hub_user_operational_profile.sql`
6. `0005_setup_beta_access_policies.sql`
7. `0006_setup_user_assignment_access.sql`
8. `0007_pulsex_channel_members_access.sql`
9. `0008_pulsex_department_announcement_channels.sql`
10. `0009_hub_presence_audit.sql`
11. `0010_c2x_guardian_read_model.sql`
12. `0011_caredesk_core.sql`
13. `0012_hub_operations_alert_protocols.sql`
14. `0013_hub_engineering_operations_records.sql`
15. `0014_hub_it_tickets.sql`
16. `0015_hubops_short_protocol_codes.sql`
17. `0016_hub_release_protocols.sql`
18. `0017_squadops_ticket_operation_links.sql`

Observacao Zeus: existem duas migrations com prefixo `0003`. Se o runner de migration usar apenas o prefixo numerico como versao, a aplicacao deve ser tratada como fluxo manual/controlado ou receber ajuste aprovado em recorte proprio; nao renomear nem apagar migrations antigas sem decisao registrada.

Para um Supabase ja existente com base Hub aplicada, a cadeia minima pendente para liberar persistencia operacional atual e:

1. `0012_hub_operations_alert_protocols.sql`
2. `0013_hub_engineering_operations_records.sql`
3. `0014_hub_it_tickets.sql`
4. `0015_hubops_short_protocol_codes.sql`
5. `0016_hub_release_protocols.sql`
6. `0017_squadops_ticket_operation_links.sql`

Aplicar somente apos autorizacao explicita do Lucas e registrar ambiente, ordem, resultado, riscos e rollback no Engineering Operations.

Validacoes Zeus obrigatorias apos aplicar:

- confirmar existencia das tabelas no schema `public`;
- confirmar RLS habilitado em todas as tabelas expostas;
- confirmar grants minimos para `authenticated` e ausencia de acesso anonimo indevido;
- validar Supabase REST/Data API com usuario autenticado autorizado;
- validar bloqueio sem sessao quando esperado;
- validar policy de requester em Ticket TI;
- validar policy adm em Operations, Release Protocols e sync do Engineering Operations;
- validar indices, triggers `set_hub_updated_at` e sequencias `AT-*`, `AL-*`, `DP-*`;
- registrar evidencias sem expor secrets.

## Variaveis De Ambiente

Usar `.env.homolog.example` como checklist sem secrets.

Na Vercel, configurar as variaveis no escopo Preview ou no Custom Environment `homologacao`:

- `NEXT_PUBLIC_CARELI_APP_ENV=homologacao`;
- `NEXT_PUBLIC_CARELI_APP_URL=https://homolog.c2x.app.br`;
- `NEXT_PUBLIC_APP_URL=https://homolog.c2x.app.br`;
- `NEXT_PUBLIC_SUPABASE_URL`;
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`;
- `SUPABASE_SERVICE_ROLE_KEY`;
- `GUARDIAN_DB_*`, preferencialmente apontando para replica/homologacao;
- chaves de integracoes externas somente em sandbox ou com envio real bloqueado.

## Travas Operacionais

Homologacao nao deve executar automaticamente:

- disparos financeiros;
- envio real de boletos;
- disparos em massa;
- alteracao financeira;
- sync destrutivo;
- migration em producao;
- chamada automatica a Hades queue `limit=1000`.

## Comandos

Validar o Hub:

```powershell
npm.cmd run validate:hub
```

Publicar homologacao pela branch dedicada:

```powershell
git checkout homolog
npm.cmd run deploy:homolog
```

Rodar healthcheck em uma URL de homologacao:

```powershell
npm.cmd run healthcheck:homolog -- -BaseUrl https://homolog.c2x.app.br
```

O script `deploy:homolog` bloqueia por padrao quando:

- a branch atual nao e `homolog`;
- ha arquivos pendentes no worktree;
- `check-types`, `lint` ou `build` falham.

## Healthchecks Minimos

Obrigatorios antes de promover para producao:

- `GET /`;
- `GET /squadops`;
- `GET /api/guardian/db/health`;
- `GET /api/guardian/attendance/queue?limit=20`;
- `GET /api/guardian/attendance/queue?limit=50`;
- `GET /api/operations/monitoring` sem sessao deve retornar `401`;
- `GET /api/operations/watcher` sem sessao deve retornar `401`;
- `GET /api/hub/it-tickets?scope=all` sem sessao deve retornar `401`;
- `POST /api/squadops/copilot` sem sessao deve retornar `401`.

## Fluxo De Release

1. Dev do modulo implementa e valida localmente.
2. Zeus revisa o recorte contra Git e Engineering Operations.
3. Zeus publica em homologacao.
4. Lucas valida visual/funcionalmente quando necessario.
5. Zeus executa healthchecks de homologacao.
6. Zeus aplica migrations em ambiente correto quando houver schema.
7. Zeus promove/publica producao.
8. Healthcheck pos-producao.
9. Registro final no Engineering Operations.

## Status Operacional Inicial

`AGUARDANDO CONFIGURACAO EXTERNA`

Pendencias para ativacao completa:

- criar branch remota `homolog`;
- configurar ambiente Preview/Custom Environment na Vercel;
- configurar dominio `homolog.c2x.app.br` ou alternativa definida por Lucas;
- configurar variaveis de homologacao sem expor secrets;
- decidir projeto Supabase de homologacao;
- executar primeiro deploy preview controlado;
- registrar URL/deployment e healthchecks no Engineering Operations.
