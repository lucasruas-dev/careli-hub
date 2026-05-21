# Atlas Operational Map

Este arquivo registra a inicializacao oficial do Atlas Core no Careli Hub.
Ele deve ser lido antes de qualquer evolucao do modulo Atlas.

## Status inicial

- Modulo: Atlas.
- Responsavel operacional: `Atlas Core`.
- Ambiente analisado nesta primeira passada: local.
- Status: `INTEGRADO LOCAL READ-ONLY / BLOQUEADO PARA BANCO REAL E ENVS`.
- Data de abertura: 2026-05-19.

## Escopo do Atlas

Atlas e o sistema oficial de performance operacional, cultura, historico de
evolucao profissional e meritocracia da Careli. O modulo deve preservar a
operacao existente e integrar gradualmente esse contexto ao Careli Hub.

O Atlas deve acompanhar:

- colaboradores;
- produtividade;
- qualidade operacional;
- processos corretos;
- ocorrencias;
- pontualidade;
- disciplina operacional;
- indicadores individuais;
- ciclos de performance;
- evolucao;
- ranking;
- historico;
- bonus por performance;
- auditoria operacional.

## Regras permanentes

- Atlas nao nasce do zero.
- Nao reconstruir o sistema antes de mapear o que ja existe.
- Nao apagar tabelas, alterar schema, migrar dados ou mudar regras de bonus sem autorizacao explicita do Lucas.
- Nao executar migration destrutiva.
- Nao alterar dados reais sem rastreabilidade.
- Nao expor secrets, tokens, service role, `POSTGRES_URL`, keys ou envs.
- Toda operacao Supabase, banco real, migration, seed, env ou deploy inicia como `BLOQUEADO`.
- Qualquer regra de bonus ou indicador existente deve ser tratada como regra operacional real ate validacao humana.

## Mapeamento local confirmado na abertura

Na primeira passada, a analise foi somente local e documental:

- `docs/operations/README.md` confirma que o diario canonico e `docs/operations/engineering-operations.md`.
- `docs/operations/engineering-operations.md` define o fluxo oficial: dev do modulo valida localmente e entrega para `Hub ReleaseOps`; nao ha etapa separada de QA.
- `docs/architecture/design-guidelines.md` define o padrao visual Guardian-like, grafite `#101820`, accent dourado `#A07C3B`, UIX, Hub Shell, desktop-first e realtime-first.
- `packages/shared/src/modules/registry.ts` ainda nao possuia modulo `atlas`.
- `packages/shared/src/permissions/types.ts` e `packages/shared/src/permissions/matrix.ts` ainda nao possuiam permissoes `atlas:view` ou `atlas:manage`.
- `packages/database/migrations/*.sql` nao contem tabelas `atlas_*` neste checkout.
- `apps/hub/app` ainda nao possuia rota `/atlas`.
- `apps/hub/modules` ainda nao possuia pasta `atlas`.
- A unica ocorrencia textual de `Atlas` no codigo local e o nome `Atlas Imoveis / Renata Faria` em dados Guardian, sem relacao confirmada com o modulo Atlas.

## Inventario do Atlas separado

Lucas confirmou que o Atlas atual esta fora do monorepo Hub, com os seguintes
identificadores operacionais:

- GitHub: `lucasruas-dev/careli-performance`.
- Vercel: projeto `careli-performance`.
- Dominio atual: `careli-performance.vercel.app`.
- Supabase: projeto separado exibido como `careli-performance`, no schema `public`.

O inventario read-only do repositorio separado identificou:

- Stack: Next.js, React, Tailwind, Supabase SSR/client, lucide-react.
- Autenticacao antiga: Supabase Auth no proprio projeto Atlas.
- Layout antigo: shell standalone bege/dourado, separado do Hub Shell.
- Rotas principais: `/login`, `/relatorios`, `/ocorrencias`,
  `/colaboradores` e configuracoes de cargos, setores, tipos e perfis.
- Rotas sensiveis: `app/api/colaboradores-auth/route.ts` usa service role para
  criar/atualizar usuarios de Auth e deve permanecer bloqueada na V1 Hub.
- Storage: bucket `evidencias` usado pelo app antigo para anexos de ocorrencias.

Tabelas identificadas no Atlas separado:

- `setores`: departamentos operacionais.
- `cargos`: cargos e `valor_base`.
- `colaboradores`: pessoas avaliadas, com vinculo de setor e cargo.
- `perfis_ocorrencia`: agrupadores de criterio operacional.
- `tipos_ocorrencia`: criterios/tipos vinculados a perfil de ocorrencia.
- `ocorrencias`: registros operacionais por colaborador, tipo, data, evidencia
  e observacao.
- `usuarios_perfis`: perfis legados do Atlas (`admin`, `lider`, `usuario`).

Colunas confirmadas para `ocorrencias`:

- `id`;
- `codigo`;
- `colaborador_id`;
- `tipo_ocorrencia_id`;
- `data_ocorrencia`;
- `observacao`;
- `evidencia_url`;
- `evidencia_nome`;
- `evidencia_tipo`;
- `created_at`.

Regras observadas no app separado:

- `admin` acessa configuracoes, colaboradores, lancamentos e relatorios.
- `lider` cria/edita ocorrencias do proprio setor.
- `usuario` tem acesso mais restrito e nao deve ter escrita geral.
- Criacao de colaborador pode envolver Supabase Auth e `usuarios_perfis`.
- O dashboard antigo agrupa ocorrencias por colaborador, setor, perfil e tipo.
- Regras de bonus nao foram encontradas como contrato tecnico conclusivo nessa
  leitura e permanecem preservadas sem alteracao.

## Integracao V1 Hub local

Foi criada a primeira integracao local do Atlas dentro do Hub:

- Registro do modulo `atlas` em `packages/shared/src/modules/registry.ts`.
- Permissoes `atlas:view` e `atlas:manage` em `packages/shared/src/permissions/types.ts`.
- Matriz inicial conservadora: `admin` possui `atlas:view/manage`; `leader`
  possui `atlas:view`; `operator` e `viewer` ficam sem acesso Atlas ate
  reconciliacao Hub Users x colaboradores Atlas.
- Icone Atlas no Hub Shell em `apps/hub/layouts/hub-shell.tsx`.
- Rota nativa `apps/hub/app/atlas/page.tsx`.
- Tela Guardian-like em `apps/hub/modules/atlas/AtlasPage.tsx`.
- API read-only `apps/hub/app/api/atlas/snapshot/route.ts`.
- Adaptador server-side em `apps/hub/lib/atlas`, lendo apenas quando existirem
  `ATLAS_SUPABASE_URL` e `ATLAS_SUPABASE_ANON_KEY`/`ATLAS_SUPABASE_PUBLISHABLE_KEY`.

Decisoes de seguranca da V1:

- Nao reutilizar o login antigo do Atlas.
- Nao migrar Auth, usuarios, senhas ou service role do Atlas separado.
- Nao copiar a rota antiga de criacao/atualizacao de usuarios.
- Nao habilitar escrita, upload de evidencia, insert, update ou delete.
- Nao expor `evidencia_url` na resposta da API Hub; a V1 retorna apenas status
  de existencia de evidencia.
- Nao recalcular bonus, pesos ou performance financeira.
- Manter qualquer operacao de env, Supabase, Vercel, migration ou producao como
  `BLOQUEADO` ate autorizacao explicita do Lucas.

## Atualizacao de migracao autorizada em 2026-05-19

Lucas autorizou a migracao dos dados do banco Atlas para dentro do Hub.
A autorizacao remove o bloqueio de decisao, mas a execucao real continua
condicionada a credenciais corretas do banco de origem e alvo, sem exposicao de
secrets.

Preparacao tecnica criada:

- migration nao destrutiva `packages/database/migrations/0023_atlas_core.sql`;
- script operacional `scripts/atlas-migrate-data.mjs`;
- leitura do snapshot Atlas passou a priorizar tabelas internas `atlas_*` do
  Hub quando elas existirem, mantendo fallback para o Supabase Atlas separado;
- preservacao de IDs legados via `legacy_id`, para nao quebrar vinculos,
  historico, ocorrencias e filtros ja existentes;
- `atlas_migration_batches` registra origem, status, contagens e rastreabilidade
  da importacao;
- escrita operacional, bonus, Auth legado, uploads e alteracao de regras seguem
  bloqueados na V1.

Tabelas alvo propostas no Hub:

- `atlas_migration_batches`;
- `atlas_departments`;
- `atlas_roles`;
- `atlas_collaborators`;
- `atlas_occurrence_profiles`;
- `atlas_occurrence_types`;
- `atlas_occurrences`;
- `atlas_occurrence_evidences`;
- `atlas_legacy_user_profiles`.

O script de migracao importa, nesta ordem:

1. `setores` -> `atlas_departments`;
2. `cargos` -> `atlas_roles`;
3. `perfis_ocorrencia` -> `atlas_occurrence_profiles`;
4. `tipos_ocorrencia` -> `atlas_occurrence_types`;
5. `colaboradores` -> `atlas_collaborators`;
6. `ocorrencias` -> `atlas_occurrences`;
7. evidencia principal herdada de `ocorrencias` -> `atlas_occurrence_evidences`;
8. `usuarios_perfis` -> `atlas_legacy_user_profiles`.

Estado da execucao:

- `node scripts/atlas-migrate-data.mjs` validou o runner em modo seguro;
- em 2026-05-19, Lucas autorizou seguir com a migracao real;
- o schema alvo `atlas_*` foi aplicado no Supabase Hub via
  `packages/database/migrations/0023_atlas_core.sql`;
- a origem Vercel `careli-performance` possuia envs criptografadas/write-only
  que nao puderam ser recuperadas por `env pull`/`env run`;
- a configuracao publica do app Atlas foi recuperada do bundle publicado apenas
  para leitura;
- a leitura publica permitiu inventario e importacao das tabelas Atlas;
- nenhum valor de secret foi exibido no terminal, chat ou diario;
- arquivos temporarios de env usados na migracao foram removidos apos execucao;
- dados reais foram gravados no Hub apenas em tabelas novas `atlas_*`;
- nenhum dado foi alterado no banco de origem Atlas.

Resultado importado:

- `atlas_departments`: 4;
- `atlas_roles`: 7, todos com `base_value`;
- soma de `base_value`: 3682.00;
- menor `base_value`: 78.00;
- maior `base_value`: 1500.00;
- `atlas_collaborators`: 9;
- `atlas_occurrence_profiles`: 3;
- `atlas_occurrence_types`: 6;
- `atlas_occurrences`: 35;
- `atlas_legacy_user_profiles`: 0;
- primeira ocorrencia importada: 2026-04-09;
- ultima ocorrencia importada: 2026-05-15;
- ocorrencias com evidencia: 31;
- ocorrencias sem evidencia: 4.

Validacao pos-migracao:

- `scripts/atlas-verify-migration.mjs` confirmou contagens e valores agregados;
- `/atlas` local passou a exibir `Supabase: Hub Atlas`;
- o dashboard passou a carregar 35 registros e filtros com dados reais;
- o aviso `Atlas aguardando conexao controlada` deixou de aparecer.

## Fluxo V1 de ocorrencias e justificativas

Regra operacional definida em 2026-05-21:

- qualquer usuario ativo com acesso ao Atlas pode abrir ocorrencia para qualquer
  colaborador;
- a ocorrencia aberta pelo Hub nasce como `procedente`;
- colaboradores/usuarios podem registrar uma justificativa em uma ocorrencia;
- a justificativa fica com status `pending` ate revisao;
- usuarios com perfil Hub `leader` ou `admin` podem revisar justificativas;
- justificativa aceita altera a ocorrencia para `improcedente`;
- justificativa nao aceita mantem a ocorrencia como `procedente` e marca a
  justificativa como `rejected`;
- bonus, calculos de performance, Auth legado, upload/storage fisico e edicoes
  sensiveis seguem preservados e bloqueados fora deste recorte.

Campos adicionados por `packages/database/migrations/0027_atlas_occurrence_justifications.sql`:

- `created_by_user_id`;
- `operational_status`;
- `justification_status`;
- `justification_text`;
- `justification_submitted_by_user_id`;
- `justification_submitted_at`;
- `justification_reviewed_by_user_id`;
- `justification_reviewed_at`;
- `justification_review_note`.

APIs Hub criadas:

- `POST /api/atlas/occurrences`: abertura controlada de ocorrencia;
- `POST /api/atlas/occurrences/[occurrenceId]/evidences`: inclusao de
  evidencias por link em ocorrencia existente;
- `PATCH /api/atlas/occurrences/[occurrenceId]/justification`: envio e revisao
  de justificativas.

Observacao operacional:

- ate a reconciliacao completa Hub Users x colaboradores Atlas, o envio de
  justificativa fica atrelado ao usuario Hub autenticado que executou a acao;
- a revisao de lideranca usa o perfil Hub (`leader` ou `admin`), nao o perfil
  legado do Atlas.

## Fluxo V1 de evidencias multiplas

Regra operacional definida em 2026-05-21:

- uma ocorrencia Atlas pode ter mais de uma evidencia;
- a mesma URL/caminho de evidencia pode ser repetida entre ocorrencias e
  colaboradores diferentes;
- nao existe unicidade operacional por `evidence_url`;
- a coluna historica `atlas_occurrences.evidence_url` fica preservada como
  compatibilidade e fallback da primeira evidencia importada;
- novas ocorrencias abertas com evidencias tambem gravam a primeira evidencia
  nas colunas historicas para preservar compatibilidade;
- a tabela `atlas_occurrence_evidences` passa a ser a fonte operacional para
  multiplas evidencias por ocorrencia;
- `legacy_evidence_key` existe apenas para idempotencia da evidencia principal
  importada do legado, nao para impedir repeticao de links;
- cada envio pelo Hub aceita ate 12 evidencias por requisicao;
- o recorte atual registra URL/caminho controlado; upload fisico em Storage
  segue fora do escopo e bloqueado ate nova autorizacao.

Estrutura preparada por `packages/database/migrations/0028_atlas_occurrence_evidences.sql`:

- tabela `atlas_occurrence_evidences`;
- vinculo com `atlas_occurrences.id` e `atlas_occurrences.legacy_id`;
- `position` para ordenar evidencias por ocorrencia;
- backfill idempotente da evidencia principal ja existente em
  `atlas_occurrences.evidence_url`;
- RLS habilitado, leitura para usuarios ativos e escrita por usuario ativo via
  `created_by_user_id`;
- grants explicitos para `authenticated` e `service_role`.

Status da aplicacao:

- codigo, API, UI e scripts estao preparados localmente;
- aplicar a migration `0028` e publicar homologacao continua `BLOQUEADO` ate
  autorizacao explicita do Lucas para esse recorte.

## Fluxo V1 de FPE - Fundo de Participacao

Regra operacional definida em 2026-05-21:

- o FPE parte de uma base anual de R$ 10.000,00;
- R$ 3.000,00 formam o caixa global, dividido no fechamento anual entre
  colaboradores ativos;
- R$ 7.000,00 formam o caixa dos departamentos, dividido entre departamentos e
  depois entre colaboradores ativos do respectivo departamento;
- lancamentos FPE sao vinculados a uma ocorrencia Atlas e a um colaborador;
- o departamento do lancamento e inferido pelo departamento do colaborador;
- cada valor informado pelo gestor e sempre positivo, com `bonus` aumentando o
  FPE e `loss` reduzindo o FPE;
- 30% do valor impacta o caixa global;
- 70% do valor impacta o caixa do departamento do colaborador;
- a tela FPE possui aba de caixinha com saldo acumulado e contribuicao por
  departamento, e aba de lancamentos seguindo o padrao de ocorrencias Atlas;
- apenas perfis Hub `admin` e `leader` podem criar lancamentos FPE;
- aplicacao da estrutura FPE em banco real segue `BLOQUEADO` ate autorizacao
  explicita de Lucas para a migration `0029_atlas_fpe.sql`.

Estrutura preparada por `packages/database/migrations/0029_atlas_fpe.sql`:

- tabela `atlas_fpe_entries`;
- vinculo com colaborador, departamento, ocorrencia e tipo de ocorrencia;
- `cycle_year`, `entry_date`, `kind`, `amount`, `description` e metadata;
- RLS com leitura para usuarios ativos e insert por `admin`/`leader`;
- correcao preparada para vincular `Lucas Ruas` ao departamento `Tecnologia`.

Observacao operacional:

- a correcao de departamento do Lucas Ruas e alteracao real de dado e so deve
  ser aplicada junto da migration `0029` no ambiente autorizado;
- a regra FPE nao substitui nem recalcula a regra de bonus/performance ja
  existente, que permanece preservada e pendente de validacao humana.

Historico anterior:

- antes da migracao real, `node scripts/atlas-migrate-data.mjs` validou o runner
  em modo seguro e bloqueou corretamente quando as envs de origem nao estavam
  presentes;
- nenhum secret foi exibido no terminal, chat ou diario.

Comando operacional de importacao, quando uma fonte `ATLAS_*` segura estiver
disponivel no runner:

```bash
node scripts/atlas-migrate-data.mjs --source-env-file=<arquivo-seguro> --apply
```

## Contratos do Hub que o Atlas deve seguir

Para entrar como modulo nativo do Hub, o Atlas deve se alinhar a:

- registry compartilhado em `packages/shared/src/modules/registry.ts`;
- permissoes canonicas em `packages/shared/src/permissions/types.ts`;
- matriz de acesso em `packages/shared/src/permissions/matrix.ts`;
- Hub Shell em `apps/hub/layouts/hub-shell.tsx`;
- rota App Router em `apps/hub/app/atlas/page.tsx`;
- modulo visual em `apps/hub/modules/atlas`;
- UIX em `packages/uix`;
- Supabase Auth e `hub_users`;
- governanca de ambiente, secrets, release e rollback;
- diario canonico em `docs/operations/engineering-operations.md`.

## Hipoteses de entidades a validar no banco real

Estas entidades sao esperadas pelo escopo operacional, mas ainda precisam ser
confirmadas por leitura autorizada do Supabase:

- colaboradores;
- ciclos ou periodos de avaliacao;
- indicadores;
- metas;
- pesos;
- apontamentos de produtividade;
- criterios de qualidade;
- ocorrencias;
- pontualidade;
- historico individual;
- ranking;
- bonus e regras de elegibilidade;
- auditoria;
- perfis de acesso.

## Regras de negocio a preservar

As regras abaixo foram definidas por Lucas como comportamento existente e
devem ser preservadas ate mapeamento completo:

- performance acima da meta operacional pode gerar bonus conforme regra Careli;
- bonus nao pode ser alterado sem validacao humana;
- indicadores existentes nao podem ser renomeados ou recalculados sem validacao;
- historico real dos colaboradores deve ser preservado;
- Atlas deve parecer institucional, operacional, executivo, analitico e confiavel;
- Atlas nao deve parecer RH generico, SaaS de produtividade comum ou gamificacao infantil.

## Riscos iniciais

- O sistema Atlas existe na operacao real, mas ainda nao esta refletido no codigo local do Hub.
- Sem autorizacao para leitura do Supabase, ainda nao ha lista confirmada de tabelas, colunas, RLS, policies, views, funcoes, triggers ou calculos reais.
- Qualquer integracao precipitada pode quebrar regra de bonus ou indicador operacional.
- Integracao visual antes do mapeamento de dados pode gerar UI desconectada da operacao real.
- Se houver tabelas Atlas no mesmo Supabase do Hub, DataOps deve validar schema, RLS e grants antes de qualquer uso client/server.

## Plano V1 recomendado

1. `Atlas Core`: manter leitura local e documentar contratos do Hub.
2. `Hub DataOps`: com autorizacao explicita do Lucas, executar inventario somente leitura do schema Atlas no Supabase.
3. `Atlas Core`: transformar o inventario em mapa tecnico e operacional.
4. `Atlas Core`: identificar calculos de performance, ocorrencias, pesos, metas e bonus.
5. `Atlas Core`: manter adaptador server-side sem escrita real inicial.
6. `Atlas Core`: evoluir front Hub com dados reais conforme DataOps validar.
7. `Hub ReleaseOps`: publicar apenas recorte validado e sem operacao sensivel pendente.

## Proximo desbloqueio necessario

Lucas ja autorizou a migracao dos dados do Atlas para dentro do Hub em
2026-05-19. A proxima etapa depende de configurar, em ambiente seguro e sem
expor valores, as envs de origem do Atlas:

- `ATLAS_SUPABASE_URL`;
- `ATLAS_SUPABASE_SERVICE_ROLE_KEY` ou `ATLAS_SUPABASE_ANON_KEY`.

Sem essas envs, o runner nao consegue ler o Supabase separado do Atlas. O alvo
Hub ja usa as envs server-side existentes do Hub, mas a migration SQL
`0023_atlas_core.sql` ainda precisa ser aplicada no ambiente correto antes do
`--apply`.
