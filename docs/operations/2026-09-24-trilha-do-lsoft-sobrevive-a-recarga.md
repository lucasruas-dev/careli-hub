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

Migration `0188_a_trilha_sobrevive_a_recarga`, aplicada em 24/09/2026 com OK do Lucas.

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

## A prova da fórmula

A digital é `md5(concat_ws('|', cliente_codigo, empreendimento, parcela, vencimento, valor,
observacoes, origem))`. Antes de aplicar, a fórmula foi rodada contra as 180 marcas de
classificação já gravadas: reproduziu 174 das 177 com parcela viva. As 3 restantes tiveram o
vencimento alterado depois da marcação. O teste `lib/lsoft/impressao-digital.test.ts` fixa
quatro hashes reais lidos do banco.

## O que ainda falta para a carga ser segura

- O reconciliador (`scripts/lsoft/reconciliar-classificacao.mjs`) religa só a classificação. Ele
  precisa religar também a trilha, senão depois da carga as 948 linhas ficam órfãs (vivas, mas sem
  apontar para a parcela nova).
- O importador não chama o reconciliador: hoje é passo manual. Vale o importador rodá-lo no fim.

## Achados no caminho, fora deste conserto

- As rotas internas de escrita do LSoft (`/api/lsoft/cliente/[codigo]`, `/api/lsoft/parcela/[id]`)
  usam `authorizeApoloRead`, que inclui `viewer`. Quem só deveria consultar consegue marcar parcela
  como paga.
- A rota do portal (`/api/incorporador/lsoft`) libera pelo slug e **não confere se o cliente pedido
  pertence ao escopo da sessão**. Com o código do cliente, qualquer sessão dos dois portais lê e
  edita qualquer ficha da base.
- Já havia 3 classificações órfãs antes deste trabalho.
