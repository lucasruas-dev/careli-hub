---
name: migration-supabase
description: Use quando for criar, escrever, aplicar ou conferir migration de banco (Supabase) no Panteon — coluna nova, tabela nova, índice, constraint, RLS, backfill. Também quando alguém pedir "mexer no banco", "criar tabela" ou "rodar SQL em prod".
---

# Migration de banco no Panteon

## 1. ⚠️ REGRA-MÃE: escrever é livre, APLICAR não

`CLAUDE.md` (bloqueio operacional) e `AGENTS.md:181`: **migration · banco · env · secret · token são
operação sensível — exigem OK EXPLÍCITO do Lucas, a cada vez.** Não vale OK de ontem, nem "ele já
autorizou essa frente".

- Pode sempre: escrever o `.sql`, revisar, planejar, conferir schema (leitura).
- Só com OK: `apply_migration`, `execute_sql` que escreve, qualquer DDL, backfill.
- Se estiver sem o OK, escreva o arquivo e **pare**, dizendo exatamente o que vai rodar e onde.

Exemplo do formato que vale (diário, 09/09/2026): *"pode seguir com as migrations"* — registrado no
diário junto com o que foi aplicado.

## 2. Onde moram e como se numera

`packages/database/migrations/` — 154 arquivos, o último é `0152_temis_contrato_editado_a_mao.sql`.

Convenção: `NNNN_assunto_em_portugues_snake_case.sql`, 4 dígitos com zero à esquerda, prefixo do
módulo quando houver (`temis_`, `hercules_`, `apolo_`, `boletos_`, `lsoft_`).

- **Antes de criar, olhe o diretório**: `ls packages/database/migrations/ | tail -5`. Pegue o maior
  número + 1.
- ⚠️ **Colisão entre sessões acontece.** Em 09/09/2026 a migration de assinatura nasceu 0147 e outra
  sessão já tinha usado 0147/0148 → foi renumerada para **0149**. Se o número que você quer já
  existe no repo (ou o Lucas tem outra sessão aberta), renumere o SEU arquivo, nunca o do outro.
- **Buracos e duplicatas do passado ficam como estão**: não existem 0116/0117, e há dois `0003_`
  (`setup_beta_policies` e `setup_operational_access`) — a segunda nunca rodou em prod e causou o
  drift que quebrou o Setup em 2/jul. Não renumere o histórico; corrija com migration NOVA.

## 3. O estilo de SQL desta casa

Modelos para copiar: `0149_temis_envelopes_de_assinatura.sql` (tabela nova),
`0151_proposta_congela_tabela_e_ajuste.sql` (colunas + constraints),
`0152_temis_contrato_editado_a_mao.sql` (tabela nova com decisões).

Regras que esses três seguem, e que você segue:

1. **Cabeçalho comentado dizendo POR QUE a tabela/coluna existe** — não o que ela faz, o que
   acontece se ela não existir. A 0152 abre explicando que sem lugar para a exceção "alguém baixa o
   PDF, ajusta no Word e manda assinar".
2. **`ATENCAO N:` para cada decisão não óbvia**, numerada. A 0149 tem 3, a 0152 tem 4. Exemplo real:
   *ATENCAO 1: a linha nasce ANTES da chamada, e por isso `envelope_id` e nulo* — porque um timeout
   deixaria um envelope pago sem notícia no Panteon.
3. **Citar o Lucas com data** quando a decisão veio dele: *Lucas, 10/09/2026: "quando eu clicar no
   abrir contrato…"*. Regra sem porquê é ignorada na primeira pressa.
4. **Idempotente**: `create table if not exists`, `create index if not exists`,
   `add column if not exists`, e `drop constraint if exists` ANTES de `add constraint`.
5. **`comment on table` / `comment on column`** nas colunas que mentem se lidas sem contexto
   (`estado`, `preco_tabela`, `html`).
6. **Precisão explícita em dinheiro**: `numeric(14,2)` para valor, `numeric(14,4)` quando guarda
   percentual (ver 0151: `preco_tabela` 14,2 e `ajuste_valor` 14,4).
7. ⚠️ **Toda tabela nova em `public` termina com `alter table public.<t> enable row level
   security;`** — ver item 5.
8. Índice parcial quando o nulo é o estado normal (`where envelope_id is not null`).

## 4. Aplicar e CONFERIR (só depois do OK)

MCP do Supabase. **Produção = `bxgukywoxgivlrhjkwjx`** (o nome no painel diz "careli-hub-dev", é
confuso e é a PROD mesmo). **Homologação = `qanlldynttyxgmcwkxqv`**.

1. Antes: conferir que as tabelas referenciadas nas FKs existem e que o tipo da chave bate
   (`list_tables`). Na 0149 isso evitou FK para `hercules_vendas`, que tem zero linhas.
2. Aplicar com `apply_migration` (não `execute_sql`) — é ele que entra no registro de versões.
3. Depois, conferir **no schema, por objeto** — tipo, precisão e nulidade:
   ```sql
   select column_name, data_type, numeric_precision, numeric_scale, is_nullable, column_default
   from information_schema.columns
   where table_schema = 'public' and table_name = '<tabela>'
   order by ordinal_position;
   ```
4. Conferir RLS: `select relname, relrowsecurity from pg_class where relname = '<tabela>';`
5. Rodar `get_advisors` (security). `rls_disabled_in_public` = **ERROR, exposto**;
   `rls_enabled_no_policy` = INFO, **seguro** (é o padrão da casa). Não confundir.
6. Prova viva: `insert` de teste dentro de `begin ... rollback` para exercitar defaults e CHECKs, e
   confirmar que a tabela ficou com 0 linhas — foi o que se fez na 0149.
7. ⚠️ **O registro de migrations NÃO é a verdade.** Em 09/09/2026 descobriu-se que 0136–0140, 0143 e
   0144 estavam no banco mas fora do registro (aplicadas por SQL direto). **Confira por objeto, nunca
   pelo registro.**
8. Se o app passa a ler as colunas: `npm --prefix apps/hub run check-types` e
   `npm --prefix apps/hub run test` antes de qualquer push.

## 5. ⚠️ Armadilhas já medidas nesta casa

- **PostgREST corta em 1.000 linhas SEM ERRO.** 26/08/2026: `.in()` em `apolo_financial_snapshots`
  (~55 linhas por pessoa) pediu 5.478 linhas num lote de 100 pessoas e voltou com **19 de 100** — o
  card da Iris chamava Comprador de "Prospect". Corrigido pela migration **0109**, criando a view
  `apolo_financeiro_por_entidade` (uma linha por pessoa). **Tabela de histórico não se lê em lote sem
  agregar** — se a migration cria histórico, crie junto a view agregada.
- **`.in()` estoura o tamanho da URL.** Medido 24/07/2026 em prod: 100 ids = 4.270 chars (200), 700
  ids = 27.670 chars = **400 Bad Request**. Derrubou a Iris inteira em produção (v1.62.44). **Toda
  leitura por lista de ids vai em lotes de 100.**
- **`upsert` com coluna NOT NULL sem default falha CALADO.** O upsert vira
  `INSERT ... ON CONFLICT`, e o INSERT é validado antes do conflito. 21/07/2026: 11 fichas ficaram
  indexadas com o nome ANTIGO porque o upsert em `apolo_search_entries` (`status` NOT NULL sem
  default) falhou sem ninguém checar `error`. **Ao criar coluna NOT NULL, dê um default** — ou saiba
  que quebrou todo upsert existente. E cheque `error` de toda escrita.
- **RLS em tabela `public`.** Toda tabela de `public` é servida pelo PostgREST com a chave **anon**,
  que vai no bundle do site (`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `apps/hub/lib/supabase/client.ts`) — o
  gate do `proxy.ts` protege as páginas, não a porta dos fundos. Em 28/07/2026 o advisor achou 5
  tabelas abertas (`apolo_disparos`, `apolo_asaas_eventos`, `apolo_imobiliaria_match`,
  `prometeu_operadores` com **hash de senha**, `apolo_c2x_sync` com **CPF e token**), nascidas assim
  nas migrations 0064/0066/0068/0070/0074 e fechadas pela **0075**. Padrão: RLS ON, sem policy
  (deny-all), acesso só por service role (`createApoloAdminClient`, `apps/hub/lib/apolo/server.ts`).
- **Env "Sensitive" da Vercel chega VAZIA no runtime.** 20/07/2026: `SESSAO_CAD_SECRET` aparecia no
  painel e o runtime lia vazio → 503. Redeploy não resolveu; resolveu recriar via CLI
  (`vercel env add`). E `vercel env pull` **mascara todo valor como `[Encrypted]`** — não serve de
  diagnóstico. Se a migration depende de env nova, não conclua "está lá" pelo painel.
- **Sync do C2X APAGA `metadata`.** O upsert de `lib/apolo/server.ts` substitui o jsonb INTEIRO.
  20/07/2026, 02:56: 122 CADs perderam etapa, analista e empreendimento porque a esteira morava em
  `metadata.esteira`. Correção: **tabela própria** (migration 0057 `apolo_esteira`, 0058 `ficha`
  jsonb). **Estado operacional vai em coluna/tabela própria; jsonb que alguém mais escreve, nunca.**
  E em qualquer update de jsonb: **mesclar, jamais substituir**.

## 6. ⚠️ O legado C2X é READ-ONLY

MySQL do C2X (`apps/hub/lib/guardian/db.ts`): **só SELECT, em qualquer hipótese** — migration,
backfill, correção pontual, nada. Escrita no legado só pela API Rails deles, e isso não é migration.
E, desde 10/09/2026 (Lucas: *"já cansei de falar que não vamos usar o legado mais como
referência"*), o legado também não é referência de produto: o dado novo nasce no Panteon.

## 7. Registrar no diário

Toda migration aplicada vira entrada em `docs/operations/engineering-operations.md`, com:
a **autorização citada** (frase do Lucas + data), o projeto (`bxgukywoxgivlrhjkwjx`), o que foi
criado (tabelas, colunas, índices, RLS), **o que foi conferido depois** e o que ainda NÃO está em
produção (a migration pode estar aplicada e o código não — foi o caso da 0149 em 09/09/2026).
Regra de ouro do `CLAUDE.md`: o que importa vai pro repo, não fica só na memória da sessão.
