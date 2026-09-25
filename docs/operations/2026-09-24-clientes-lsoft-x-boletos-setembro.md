# 2026-09-24 · Os clientes do LSoft batem com os boletos de setembro?

Pergunta do Lucas. Resposta curta: **não batem, e a maior parte da diferença não é erro de emissão.
É a categoria 17 do LSoft, que mistura empreendimentos.**

## Como medi

- **Lado LSoft:** cópia de `\\SERVIDOR\Sistema\sgc\dados.mdb` de 24/09/2026 13:53, lida por Jet 4.0
  em PowerShell 32 bits. Clientes com parcela vencendo entre 01 e 30/09/2026, somando **RECEBER e
  RECEBIDOS**, porque dar baixa no LSoft move a linha de uma tabela para a outra: contar só
  `RECEBER` esconderia quem já pagou.
- **Lado boletos:** `boletos_parcelas` com `competencia = '2026-09'`, sem os 6 slugs de teste.
  Emitido de fato = linha com par em `boletos_pagamentos` e `cobranca_id` do Asaas.
- **Casamento por CPF/CNPJ normalizado** (`\D` removido), dentro do MESMO empreendimento.

## O resultado, por empreendimento

| empreendimento | LSoft | boleto | nos dois | só LSoft | só boleto |
|---|---|---|---|---|---|
| Garden | 139 | 134 | 131 | **8** | 3 |
| Vale do Sol | 86 | 102 | 84 | 2 | **18** |
| Giant Towers | 24 | 20 | 17 | 7 | 3 |
| On Sky | 21 | 17 | 14 | 7 | 3 |
| Guaimbê | 9 | 25 | 7 | 2 | **18** |
| Rubi + Jade | 8 | 8 | 4 e 4 | 4 | 0 |

Totais do lado boleto, setembro/2026: **343 linhas, 329 emitidas, 299 clientes, 292 com boleto.**
As 14 que ficaram fora têm motivo gravado em 12 casos (pagou adiantado, "não fazer" na planilha,
carnê entregue, começa em novembro) e 2 foram canceladas sem reemissão.

## ⚠️ O achado: a CATEGORIA não é o empreendimento

A regra registrada até hoje era "categoria = empreendimento" (124 Garden, 102 Vale do Sol). **Ela
não vale para o resto da base.**

A categoria **17, chamada "Vitor"**, tem 1.456 títulos e R$ 20,9 mi, e é um balaio: o empreendimento
real está no texto livre de `OBSERVACOES`. Amostra das observações dela:

```
APTO 1503 LUA/1508 SOL GIANT TOWERS 720.000
APTO 307 GUAIMBE
APTO 404 BL 03 VALE DO SOL
APTO 202 ED CRISTAL
APTO ON SKY 310/104/509 450.000 30 PARC
VENDA APTO 705 MIRAGE
```

**Dos 18 clientes do Vale do Sol e dos 18 do Guaimbê que pareciam faltar no LSoft, quase todos estão
lá, dentro da categoria 17.** Só 5 pessoas da carteira de setembro não têm nenhum título no LSoft.

### Por que isso importa para o plano

O plano anterior era extrair por categoria (66 On Sky, 70 Guaimbê, 118 Giant Towers, 115 Rubi/Jade).
**Extrair assim traz carteira incompleta**, porque a maior parte do Guaimbê e um pedaço do Vale do
Sol vivem na 17. Antes da carga é preciso classificar a 17 pelo texto de `OBSERVACOES`, do mesmo
jeito que a unidade já é lida hoje ("LOTE: 109 QUADRA: 08").

## As 8 pendências reais do Garden

O Garden é o caso limpo (categoria própria, origem LSoft nos dois lados). Os 8 com parcela em
setembro e sem boleto:

| cliente | unidade | valor | o que é |
|---|---|---|---|
| VITOR CECILIO DE OLIVEIRA ALMEIDA | — | 36.860,75 | **não é comprador**: aporte de permuta com a E&J Terraplanagem |
| HENRIQUE LOPES FLORES DE SOUZA | — | 3.686,08 | **não é comprador**: mesmo aporte |
| KLEBER ANTONIO BARCELOS | Q13 L367 | 2.261,90 + 1.130,95 | **já pagou** (está em RECEBIDOS), pagamento em duas partes |
| LAESTE DE LIMA JUNIOR | Q14 L344/345/346 | 7.000,00 | aparece nas DUAS tabelas com o mesmo valor: **conferir se é duplicata** |
| MARIO SANTOS ROCHA | Q13 L22 e Q07 L1 | 2.261,91 cada | comprador sem boleto |
| ANTONIO MONTEIRO JUNIOR | L180/181/319/432/135 | 11.786,00 | comprador sem boleto |
| GABRIELA ANDRADE DE ALENCAR RAMOS | Q13 L381/382 | 4.238,10 | "PARC. OBRA", comprador sem boleto |
| ALINE CASSIA DOS SANTOS | Q09 L71 | 2.119,00 | comprador sem boleto |

Ou seja: **4 compradores do Garden têm parcela em setembro e não receberam boleto.** Os outros 4 têm
explicação (2 aportes, 1 já pago, 1 a conferir).

## Os 5 que estão no boleto e não existem no LSoft

| empreendimento | cliente |
|---|---|
| Garden | GERALDO SANTOS DE SOUZA · ÂNGELA MARIA DE OLIVEIRA · VICTOR LIMA CAMPOS |
| Vale do Sol | MARCO AURELIO PEREIRA MOTA · BRENDAIANA APARECIDA RODRIGUES CHAVES |
| Guaimbê | FRANCISCO BRAGANTE JUNIOR |

São vendas que a planilha de boletos conhece e o LSoft não. Valem conferência com o time: ou são
vendas novas que ninguém lançou no LSoft, ou o CPF está diferente nos dois lados.

## O que fazer com isto

1. **Conferir os 4 compradores do Garden sem boleto** (Mario, Antonio, Gabriela, Aline). É a lista
   mais curta e mais acionável.
2. **Conferir o Laeste**: mesmo valor em RECEBER e RECEBIDOS cheira a duplicata.
3. **Antes de subir os demais empreendimentos**, classificar a categoria 17 pelo texto de
   `OBSERVACOES`. Sem isso, a carga nasce incompleta.
4. **Conferir os 5 CPFs** que a planilha de boletos tem e o LSoft não.

## Armadilhas desta medição, para quem repetir

- **Somar RECEBER e RECEBIDOS.** A baixa move a linha; só RECEBER conta 23 títulos no Garden em
  setembro, quando são 156.
- **Normalizar a unidade.** `boletos_pagamentos` grava com hífen (`Q04-L13`) e as outras tabelas com
  espaço (`Q04 L13`). O join cru casa 82 de 333 unidades e faria parecer que 264 ficaram sem boleto.
- **Excluir os 6 slugs de teste**, que têm dados reais na base.
- **Não usar `emissao_iniciada_em` como prova de emissão**: só 133 de 349 linhas têm o campo, contra
  336 cobranças que existem de fato. Quem prova é a linha em `boletos_pagamentos`.
- **Comparar dentro do mesmo empreendimento.** 20 documentos aparecem em mais de um, e o CPF global
  esconde a diferença que interessa.
