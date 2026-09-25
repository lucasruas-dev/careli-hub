# 2026-09-24 · A trilha do LSoft passa a sobreviver à recarga (migration 0188)

## Por quê

O Lucas pediu para subir os demais empreendimentos para o LSoft Integração. Subir é rodar uma
carga, e a carga **apagava o trabalho do time**: o importador apaga `lsoft_parcelas` inteira antes
de regravar com ids novos, e `lsoft_clientes_edicoes.parcela_id` era `ON DELETE CASCADE`. As 948
linhas de trilha (640 delas baixa de pagamento) iriam junto, sem erro em tela nenhuma.

## Backup antes

`Documents\Relatórios Panteon\2026-09-24 backup lsoft`: as seis tabelas `lsoft_*` em JSON,
conferidas contra `count` exato, mais a cópia do Access de 24/09 13:53, o `restaurar.mjs` (ensaio
testado) e um LEIA-ME.

## O que foi aplicado

Migration `0188_a_trilha_sobrevive_a_recarga`, aplicada em 24/09/2026 no projeto
`bxgukywoxgivlrhjkwjx` (produção), por `apply_migration`. Autorização do Lucas, 24/09/2026:
*"tem o meu ok"*, em resposta ao pedido explícito para aplicar a 0188. Registro no banco:
`20260924191343 a_trilha_sobrevive_a_recarga`.

1. A FK `parcela_id` passou de `CASCADE` para `SET NULL`: quando a parcela some, a linha fica órfã
   e visível em vez de morrer.
2. Colunas novas: `impressao_digital`, `ordinal`, `empreendimento_no_momento`,
   `vencimento_no_momento`, `valor_no_momento`. É o mesmo desenho da classificação (0103).
3. Backfill das 948 linhas a partir das parcelas vivas.
4. Índice parcial `lsoft_edicoes_digital_idx`.

## Conferido depois de aplicar

| | |
|---|---|
| linhas da trilha | 948 (nenhuma perdida) |
| com digital | 948 |
| digital confere com a parcela viva | 948 |
| parcelas distintas | 160, igual ao número de parcelas editadas na tela |
| regra da FK | `SET NULL` |
| índice | criado |

## Conferido por objeto, como pede a skill `migration-supabase`

- **Schema**, `information_schema.columns`: `impressao_digital text null` · `ordinal integer not
  null default 1` · `empreendimento_no_momento text null` · `vencimento_no_momento date null` ·
  `valor_no_momento numeric(14,2) null`.
- **RLS**: continua ligada em `lsoft_clientes_edicoes` e `lsoft_parcelas`.
- **Advisors de segurança**: `lsoft_clientes_edicoes` só como `rls_enabled_no_policy` (INFO, o padrão
  da casa: acesso só por service role). Nenhum `rls_disabled_in_public`. Os WARNs restantes
  (`search_path` de três funções, `btree_gist` em `public`, `has_chronos_permission`) são anteriores
  e não tocam o LSoft.
- **Prova viva**, num bloco `DO` que termina sempre em `raise exception` (nada persiste): inseri uma
  parcela e uma linha de trilha apontando para ela, apaguei a parcela, e a linha **sobreviveu com
  `parcela_id` nulo** e `ordinal` 1. Depois: trilha 948, parcelas 20.866, zero resto da prova.

## O religamento (commit 861532c7)

`scripts/lsoft/reconciliar-trilha.mjs --simular-recarga` finge a carga em memória (ids novos,
trilha zerada) e não grava. Contra produção: **160 de 160 parcelas com trilha religadas, zero
órfãs**, em cinco execuções seguidas.

⚠️ Na primeira execução deu 159 e 1 órfã. Causa: a leitura paginada sem `order` pulava uma parcela
e repetia outra, e o total batia. Corrigido com `order("id")` e conferência de ids distintos, aqui e
no `reconciliar-classificacao.mjs`, que tinha o mesmo defeito. O backup de 24/09 foi conferido
depois disso: 20.866 ids distintos, íntegro.

## A prova da fórmula

A digital é `md5(concat_ws('|', cliente_codigo, empreendimento, parcela, vencimento, valor,
observacoes, origem))`. Antes de aplicar, a fórmula foi rodada contra as 180 marcas de
classificação já gravadas: reproduziu 174 das 177 com parcela viva. As 3 restantes tiveram o
vencimento alterado depois da marcação. O teste `lib/lsoft/impressao-digital.test.ts` fixa
quatro hashes reais lidos do banco.

## O que ainda falta para a carga ser segura

- ~~Religar a trilha depois da carga~~: feito, `reconciliar-trilha.mjs`.
- O importador não chama os dois reconciliadores: hoje é passo manual, e entre a carga e a mão que
  roda o script a tela mostra a trilha sem parcela e o dinheiro da Caixa como dívida do cliente.
- O CHECK `lsoft_parcelas_empreendimento_check` ainda só aceita três nomes.
- Existem 3 classificações da Caixa, confirmadas, que já estavam órfãs antes deste trabalho:
  clientes 00000443, 00000476 e 00000612.

## Achados no caminho, fora deste conserto

- As rotas internas de escrita do LSoft (`/api/lsoft/cliente/[codigo]`, `/api/lsoft/parcela/[id]`)
  usam `authorizeApoloRead`, que inclui `viewer`. Quem só deveria consultar consegue marcar parcela
  como paga.
- A rota do portal (`/api/incorporador/lsoft`) libera pelo slug e **não confere se o cliente pedido
  pertence ao escopo da sessão**. Com o código do cliente, qualquer sessão dos dois portais lê e
  edita qualquer ficha da base.
- Já havia 3 classificações órfãs antes deste trabalho.
