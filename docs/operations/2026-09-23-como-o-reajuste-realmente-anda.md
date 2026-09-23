# Como o reajuste realmente anda na carteira (medido em 23/09/2026)

> Levantamento feito antes de desenhar o relatório de projeção de parcelas que o Lucas pediu em
> 23/09/2026. **Nada foi implementado**: este documento é a medição que decide o desenho.

## Por que medir antes

O pedido ("mostrar a evolução das parcelas com base na série histórica do índice e projetar o
futuro") parte de uma premissa: **reajuste = índice X acumulado na competência Y**. Se essa
premissa não se sustentasse, o relatório imprimiria, na mesma página, um histórico real andando de
um jeito e uma curva futura andando de outro, e o cliente perguntaria qual dos dois é o dele.

A única medição que existia no repo apontava contra: `lib/apolo/extrato-cliente.ts:371` registra o
AR 183, plano **IPCA ANUAL**, subindo **+5,75%** num ano em que o IPCA não foi 5,75%.

## O que foi medido

Rodada sobre a carteira inteira, com a **mesma régua do extrato** (`detectarEventosDeValor`, que já
descarta mora, acordo e a fronteira da defasagem), não com uma segunda régua:

```
118.033 parcelas mensais lidas do C2X (1,6 s)
    874 contratos com mensalidade
    532 contratos com algum reajuste
    926 degraus de reajuste detectados
```

## Achado 1: o índice do ano NÃO explica o degrau

| ano | degraus | mediana real | IPCA 12m (dez-1) | INCC 12m (dez-1) |
|---|---|---|---|---|
| 2025 | 363 | 6,52% | 4,83% | 6,33% |
| 2026 | 558 | **15,65%** | 4,26% | 6,09% |

Um degrau de 15,65% não é o IPCA de ano nenhum. E por carteira o comportamento **diverge**:

```
LOS  465 degraus   mediana 15,08%
LOU  384 degraus   mediana 14,68%
REP   44 degraus   mediana  4,72%
MDS   33 degraus   mediana  4,72%
```

Em **913 dos 926** degraus o plano diz "IPCA ANUAL".

## Achado 2: o degrau é o índice ACUMULADO desde a última aplicação

Testando cada degrau contra o índice acumulado em janelas de 1 a 5 anos (tolerância de 1,5 ponto):

| explicação | degraus | % |
|---|---|---|
| IPCA acumulado de **1 ano** | 375 | 40,5% |
| IPCA acumulado de **3 anos** | 366 | 39,5% |
| IPCA acumulado de **4 anos** | 50 | 5,4% |
| INCC-M de 1 ano | 77 | 8,3% |
| IGP-M de 2 anos | 33 | 3,6% |
| IGP-M de 1 ano | 5 | 0,5% |
| INCC-M de 4 anos | 3 | 0,3% |
| IGP-M de 4 anos | 1 | 0,1% |
| **sem explicação nenhuma** | **16** | **1,7%** |

**97,8% da carteira é explicada por índice publicado acumulado.** A premissa do relatório se
sustenta, mas **não** na forma "índice do ano": a forma correta é **índice acumulado desde a última
vez que a correção alcançou aquele contrato**.

Isso casa com o que já estava documentado: a correção é aplicada **à mão** no C2X, e só quando a
parcela recebe boleto. Contrato que ficou três anos sem boleto leva três anos de índice de uma vez.

## Achado 3: as carteiras estão em estados diferentes

```
LOS    3 anos: 227   1 ano: 180
LOU    3 anos: 138   1 ano: 121   4 anos: 50
REP    1 ano:   44
MDS    1 ano:   30   3 anos: 1
```

REP e MDS estão **em dia** (só degrau de 1 ano). LOS e LOU acumularam, e têm mais degrau de 3 anos
do que de 1. Isso é informação de negócio, não só de código: são duas situações de carteira
diferentes, e o relatório precisa dizer em qual o contrato está.

## Achado 4: o índice nomeado no plano não é confiável

913 de 926 degraus vêm de plano marcado "IPCA ANUAL", mas **118 degraus seguiram INCC-M ou IGP-M**.
Projetar pelo índice que o plano nomeia erraria esses contratos. O comportamento medido do contrato
é mais confiável que o rótulo do plano dele.

## O que isto significa para o relatório

1. O motor não pode ser "aplica o índice do ano". Tem de ser **"acumula o índice desde a última
   aplicação"**, e portanto precisa saber **quando foi a última**.
2. A projeção futura tem duas partes distintas, e misturá-las seria mentir: **o que já venceu e
   ainda não foi aplicado** (dívida de correção represada, que é fato apurável) e **o que ainda vai
   acontecer** (estimativa de índice futuro, que é palpite).
3. Contrato em carteira atrasada (LOS, LOU) vai mostrar um degrau grande na próxima aplicação, e
   isso não é erro do relatório: é o retrato da situação.
4. Os 1,7% sem explicação precisam sair **marcados**, e não maquiados com o índice mais próximo.

## Como reproduzir

```
apps/hub/scratchpad/zeus-reajuste-real-x-indice.ts    (lê o C2X, detecta os degraus)
apps/hub/scratchpad/zeus-degrau-e-acumulado.ts        (casa cada degrau com o índice acumulado)
```

Fontes de série usadas, ambas públicas e gratuitas:

- **IPCA**: `servicodados.ibge.gov.br/api/v3/agregados/1737/periodos/all/variaveis/63` (561 meses,
  desde dez/1979). ⚠️ O host `apisidra.ibge.gov.br` falha no TLS daqui; a API v3 responde 200.
- **INCC-M, IGP-M e afins**: `api.bcb.gov.br/dados/serie/bcdata.sgs.<codigo>/dados?formato=json`.
  ⚠️ Séries diárias (Poupança 195, TR 226) devolvem **HTTP 406** sem janela de datas, e trazem
  `dataFim` além de `data`.

Ambas as fontes têm **defasagem de um mês**: em 23/09/2026 o último ponto publicado era agosto.
