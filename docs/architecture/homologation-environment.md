# Ambiente de Homologacao Careli Hub

Este documento define o modelo oficial inicial de homologacao do Careli Hub.

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
- chamada automatica a Guardian queue `limit=1000`.

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
2. Hub ReleaseOps revisa o recorte contra Git e Engineering Operations.
3. Hub ReleaseOps publica em homologacao.
4. Lucas valida visual/funcionalmente quando necessario.
5. Hub ReleaseOps executa healthchecks de homologacao.
6. Hub DataOps aplica migrations em ambiente correto quando houver schema.
7. Hub ReleaseOps promove/publica producao.
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
