# Ensaio do espelho da D4Sign (F3), 28/09/2026

> Rodado pelo implementador da F3, no worktree `assinatura-fonte-unica`, com o `.env.local` do hub.
> **Nada foi gravado**: sem `--gravar`, o espelho não escreve a vez, `tentado_em`, a pausa nem o relatório.
> Relatório anonimizado: só ids de envio do C2X, contagens e o começo do id da proposta (sem nome, e-mail
> nem documento). O C2X foi lido só com SELECT dentro de `START TRANSACTION READ ONLY`.

## Comando

```
node scripts/temis/espelhar-d4sign.mjs --so 3805,3804,3803,3801,3800
```

Cinco envios recentes (VAL 3805 e 3804, REP 3803, ACP 3801 e 3800), escolhidos por serem os mais novos
dos produtos com venda nativa na D4Sign. Com `--so` o catálogo (8 páginas) não é lido: o status sai do
`/list` de cada documento. Chamadas à D4Sign: 5 `/list`, uma a cada 2 s. Duração: 23,7 s.

## Antes do ensaio (medido, só SELECT)

- `contract_signatures` com `send_document_signature = 1`: 2.239 envios, **todos com `contract_type =
  'default'`**, nenhum sem `uuidDoc`, 17 com status 6. Por isso `FINALIDADE_POR_TIPO_DO_C2X = { default:
  "contrato" }` (tipo novo fica `null` e é contado em `finalidadeNaoMapeada`).
- Produção **sem a 0195** (0 das 6 colunas novas em `temis_envelopes`, sem `temis_espelho_d4sign`): o
  ensaio tratou o espelho como vazio e marcou `semA0195: true`. A reconciliação e a rede da Clicksign
  não rodaram (dependem das colunas da 0195).

## Resultado

| Campo | Valor |
|---|---|
| `enviosNoC2x` (fora os excluídos) | 2.236 |
| `tiposDoC2x` | `default`: 2.236 |
| `semUuid` / `status6` | 0 / 17 |
| `novos` (no recorte `--so`) | 5 |
| `semUnidade` | 0 |
| `casamentos` | `nativa_do_mesmo_comprador`: 3 · `ar_da_carga`: 2 |
| `candidatasNaoLigadas` | 0 |
| `listas` (chamadas `/list`) | 5 |
| `estadosMudaram` (simulado) | 5 |
| `naoPareados` | 0 |
| `efeitosPlanejados` (borda que moveria venda nativa com `--mover-vendas`) | 3 |
| `comCancelamentoAberto` | 0 |
| `doisContratosVivos` | 0 (não medido: sem a 0195) |
| `falhas` | nenhuma |
| `lidosPorTabela` | `hercules_unidades` 5.541 · propostas do pedido 2 · propostas do terreno 5 |

Ligações com venda nativa (a regra e o id, comprador conferido pelo documento em memória):

| Envio C2X | Proposta (início do id) | Regra |
|---|---|---|
| 3803 (REP) | `36bb35e2` | `nativa_do_mesmo_comprador` |
| 3804 (VAL) | `fad20717` | `nativa_do_mesmo_comprador` |
| 3805 (VAL) | `39c2b98e` | `nativa_do_mesmo_comprador` |

Os dois envios da ACP (3801 e 3800) ligaram pela regra 1 (`ar_da_carga`): o pedido deles tem proposta da
carga, e nenhum caiu em `ar_da_carga_com_nativa_viva` (a duplicata da nativa, medida 0 na seção 3).

## O que o ensaio confirma e o que ainda falta

- O caminho inteiro roda de ponta a ponta contra o C2X, a D4Sign e o Panteon de verdade, sem gravar.
- Os três contratos nativos da D4Sign (REP e VAL×2) casam com a venda nativa do **mesmo comprador**, e
  com `--mover-vendas` seriam 3 bordas (entrada em "Em assinatura" ou assinado).
- Falta, com OK a cada passo: aplicar a 0195; o ensaio completo (sem `--so`, catálogo e amostra de 10
  `/list`) para ver os estados do catálogo, `sem_unidade` e `sem_venda` do acervo inteiro; a cota da
  D4Sign confirmada (F0); `--gravar`; a prova SQL da F3; o cron; `--mover-vendas`.
