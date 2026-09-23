# Como o reajuste realmente anda na carteira (medido em 23/09/2026)

> Levantamento feito antes de desenhar o relatório de projeção de parcelas que o Lucas pediu em
> 23/09/2026. **Nada foi implementado**: este documento é a medição que decide o desenho.
>
> 🛑 **LEIA A CORREÇÃO NO FIM ANTES DE USAR QUALQUER NÚMERO DAQUI.** O "97,8% explicado" da
> primeira metade **não se sustentou** no backtest (acertou 4,1%). A primeira metade está mantida
> porque mostra como a conclusão errada foi construída, e a segunda mostra o mecanismo real.

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

---

# ⚠️ CORREÇÃO (mesmo dia, depois do backtest)

**O que está escrito acima sobre "97,8% explicado" NÃO se sustentou.** O teste que produziu aquele
número ajustava a janela livremente entre 1 e 5 anos, com tolerância de 1,5 ponto; com cinco
janelas e essa folga, muita coisa encaixa por acaso. O **backtest**, que é o teste honesto (usar só
o passado de cada contrato para prever o degrau seguinte), acertou **4,1%**, não 97,8%.

## O mecanismo real, visto num contrato

AR 206 (LOU), 144 mensais:

```
R$ 535,99   135 parcelas   ZERO com boleto    2024-02 a 2036-01
R$ 566,81     3 parcelas      3 com boleto    abr-jun/2026
R$ 657,27     6 parcelas      5 com boleto    ago-dez/2026
```

**O valor contratual nunca é atualizado no C2X.** Só a parcela que recebe boleto é corrigida, e a
correção é cumulativa desde a data-base. De 535,99 para 657,27 são **+22,63%** — e não os 15,96%
que a régua de degrau mediu, porque ela compara patamar com patamar, não com o contratual.

Por isso "desde o degrau anterior" é a janela errada: os degraus não são aplicações sucessivas de
reajuste, são **lotes de boleto emitidos em momentos diferentes**, cada um carregando a correção
acumulada desde o início.

## A consequência, medida na carteira inteira

**A defasagem não precisa ser deduzida de índice: ela é MEDIDA**, comparando o que a cobrança já
usa (maior valor entre as parcelas com boleto) com o que as futuras ainda carregam.

```
873 contratos com mensalidade
 121  sem nenhum boleto emitido
  15  sem parcela futura sem boleto
 210  ja em dia
 527  COM DEFASAGEM   <-- 60% da carteira
```

Defasagem das parcelas futuras, por percentil: p25 **22,63%**, p50 **22,63%**, p95 **23,20%**.

| empreendimento | contratos | mediana | maior |
|---|---|---|---|
| LOS | 256 | 23,19% | 48,71% |
| LOU | 203 | 22,63% | 23,67% |
| MDS | 20 | 10,29% | 24,82% |
| REP | 47 | 4,72% | 20,40% |

**Se todas as parcelas futuras fossem corrigidas ao patamar que a cobrança já usa, a soma das
mensalidades subiria R$ 72.338,05 por mês** (527 contratos, média de R$ 137,26 cada).

⚠️ **Um outlier a descartar**: o AR 3716 (VAL) aparece com 4.472% porque tem uma parcela atípica
marcada como mensal. O extrato já conhece esse caso (`FATOR_MENSALIDADE_ATIPICA`, que cita
justamente o AR 3716); qualquer medição nova precisa do mesmo filtro.

## O que isto muda no relatório

1. **O "represado" é fato medido, não conta com índice.** Basta comparar o valor cobrado com o
   contratual. Isso elimina a maior fonte de erro da peça.
2. **O índice só serve para o trecho FUTURO**, depois do patamar já corrigido.
3. **O valor que o cliente vê no sistema não é o que ele vai pagar.** No AR 206, o sistema mostra
   R$ 535,99 em 135 parcelas e a cobrança já usa R$ 657,27. Dizer isso ao cliente é o conteúdo mais
   útil do relatório inteiro, e não depende de projeção nenhuma.
4. Os scripts `zeus-backtest-do-motor.ts`, `zeus-estrutura-dos-degraus.ts`,
   `zeus-olhar-um-contrato.ts` e `zeus-defasagem-medida.ts` reproduzem tudo isto.
