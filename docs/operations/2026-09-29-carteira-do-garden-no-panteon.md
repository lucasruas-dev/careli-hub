# Carteira do Garden no Panteon: projeto técnico

Escrito em 29/09/2026 e revisado no mesmo dia depois de três revisões (dinheiro, banco, tela; seção 11).
Tudo o que está aqui foi medido só com leitura: SELECT no Supabase de produção (`bxgukywoxgivlrhjkwjx`),
leitura de código neste worktree (`feat/portal-cecilio-melhorias`) e leitura das planilhas do Downloads.
Nada foi gravado no banco, nada foi mandado ao C2X, nenhum arquivo de código foi alterado. As consultas
estão no apêndice A.

Este documento é o plano. Aplicar migration, gravar dado no banco, ligar o casador e publicar em
produção precisam de OK do Lucas, um por um (seção 9).

---

## 1. O pedido e as decisões

**O pedido (Lucas, 29/09/2026)**, com a planilha `C:\Users\lucas\Documents\OBSERVAÇÕES DO GARDEN S.xlsx`
(aba "OBS. LUCAS", colunas CLIENTE e OBSERVAÇÃO, exportada da própria tela LSoft Integração):

> "agora eu quero subir as carteiras que estão validadas pelo time adm. garden que está no lsoft vai
> subir para financeiro carteira, as que estiverem com ok, ou seja, vai deixar de existir no lsoft e
> agora vai para carteira do garden, as que tiverem algum observação deixar ainda na tela de integração"

Depois, no mesmo dia: *"esquece o c2x, cecilio não tem nenhum vinculo com o legado c2x"* e
*"foi exportação da tela do lsoft integração, pode cruzar pelo nome"*.

**Decisões do Lucas (29/09/2026), que este projeto não rediscute:**

1. Sem C2X, em nada. A carteira do Garden mora no Panteon (Supabase) e o Financeiro do portal
   `cecilio-rocha` lê dela.
2. Baixa depois da subida: o pagamento do boleto no Asaas baixa a parcela sozinho, e existe um botão
   de baixa manual para o que for pago por fora.
3. A carteira fica pendurada no lote NOVO do Panteon (`hercules_unidades`, a numeração dos boletos e do
   masterplan), ligado pelo CPF do boleto (`boletos_documentos`). Quem não tem essa ponte fica na
   integração até alguém indicar o lote.
4. Sem nova extração do LSoft: vale o espelho atual (carga de 16/09 mais as 101 baixas lançadas na tela
   em 22/09).
5. O 00000179 THIAGO HENRIQUE GOMES OTTO QUARESMA (OK na planilha, com R$ 227,5 mil de permuta de
   materiais) fica na integração, como os que têm observação.
6. Premissas já anunciadas e não contestadas: a carteira guarda o valor do CONTRATO (o nominal do
   LSoft) e o reajuste continua no boleto; nesta fase só o Financeiro do portal da Cecílio passa a ver
   o Garden; o cliente sai da tela de integração por MARCA, nunca por DELETE; de quem tem outras
   carteiras (Giant Towers, patrimônio etc.) sobe SÓ a parte do Garden (`categoria_lsoft = 124`) e o
   resto fica no LSoft. Casamentos por nome confirmados: "ANA CLARA RAMOS" = 00000508, "ANA PAULA
   DELASCIO" = 00000545, "LEANDRINHO" = 00000276 (grupo com observação); o 00000558 (fora da planilha)
   fica na integração.

**Premissas deste projeto** (cada uma tem padrão razoável; se o Lucas discordar, muda uma linha do
plano de subida, não o desenho):

- **P1. A ponte tem de fechar dos dois lados.** Além do CPF do boleto, o lote antigo que o LSoft digitou
  não pode apontar, pelo mapa da carga de boletos, para o lote de outra pessoa; e, quando o documento é
  CPF, o nome no boleto tem de ter pelo menos duas palavras em comum com o nome do LSoft. Essa regra
  segura 4 clientes OK além dos 4 sem ponte (seção 2.3): 00000524 e 00000538 (CPFs trocados entre os
  dois boletos), 00000587 (contrato que cobra um lote cujo boleto é de outra pessoa) e 00000086
  (cronograma que o LSoft nunca lançou).
- **P2. Uma série de parcelas digitada com o lote de outro comprador vai para o contrato do próprio
  cliente** quando o cliente tem um contrato só e as linhas NÃO são cópia das do dono do lote. Caso
  único: 00000493 MARIA CAMPOS PIRES (a 004/007 e a 006/007 das anuais dela digitadas no lote 16/297,
  que é do 00000550, com o texto "PARCELAS ANUAIS" das outras 5 dela). O lote digitado fica gravado na
  parcela (`lote_antigo_digitado`).
- **P3. O "validado" é da pessoa, e a pessoa pode ter outra carteira.** Os 95 que sobem e só têm o
  Garden recebem `status_validacao = 'validado'`. Os 11 que sobem e ainda têm Giant Towers, patrimônio
  etc. mantêm o status e ganham a observação; a validação do Garden deles fica na marca
  (`lsoft_migracoes`). Marcar a pessoa inteira tiraria da fila R$ 4.964.996,16 em aberto de outras
  carteiras que ninguém conferiu.
- **P4. A situação do lote em `hercules_unidades` não muda nesta subida.** Os 111 lotes seguem
  `bloqueada`; marcar como vendido é a frente "situação única e um dono por lote".
- **P6. O vencido do Garden é nominal**, sem juros nem multa (o LSoft não tem esses campos). A tela diz
  isso no card.
- **P7. Linha idêntica em dois clientes fica com o dono do lote.** Quando a mesma linha (lote antigo
  digitado, vencimento, valor e texto) aparece em dois clientes, ela é do cliente cujo boleto é daquele
  lote; o outro cliente fica na integração com a observação até o time dizer. Nos 141: 00000440 JFB
  (entrada 2/2 do 00000527 ATHOS) e 00000560 URBANO (as 7 anuais do 00000059 WOLMERT).
- **P8. O pagamento parcial do LSoft é uma parcela só.** O LSoft grava cada pagamento parcial como linha
  nova da MESMA parcela, com o saldo que faltava no `valor`. Na carteira o grupo (cliente, rótulo,
  vencimento, lote digitado) vira UMA parcela: valor = nominal da série (o valor mais frequente das
  parcelas de linha única da mesma série; na entrada 001/001, a linha de maior valor), valor pago =
  soma do recebido, data = o último recebimento. As linhas ficam ligadas em `carteira_parcela_origens`.

(A antiga P5, quem dá baixa manual no portal, virou a pergunta 4 da seção 10.)

---

## 2. Números da subida (medidos em 29/09/2026)

### 2.1 O Garden no espelho e o recorte

| Linhas do espelho | Clientes | Linhas | Em aberto | Saldo em aberto (R$) | Pagas | Recebido (R$) |
|---|---:|---:|---:|---:|---:|---:|
| Garden no espelho (`categoria_lsoft = 124`) | 141 | 13.401 | 12.209 | 43.727.178,97 | 1.192 | 6.291.507,11 |
| **Sobe para a carteira** | **106** | **9.868** | **8.996** | **30.556.722,22** | **872** | **4.484.836,13** |
| Fica na integração | 35 | 3.533 | 3.213 | 13.170.456,75 | 320 | 1.806.670,98 |

A soma fecha: 106 + 35 = 141; 9.868 + 3.533 = 13.401; 30.556.722,22 + 13.170.456,75 = 43.727.178,97;
4.484.836,13 + 1.806.670,98 = 6.291.507,11.

Planilha: 142 linhas, 117 "OK" (116 clientes, porque AMAURI 00000509 aparece nas linhas 28 e 29) e 25
com observação (24 clientes, porque LEANDRINHO e LEANDRO AUGUSTO são o mesmo 00000276). Casamento
linha a linha em `scratchpad/casamento-garden.json`. Dos 116 OK, 106 sobem e 10 ficam (seção 2.3).

### 2.2 O que sobe

- **106 clientes, 107 contratos, 111 lotes novos.** 105 clientes têm um contrato; o 00000531 SEBASTIÃO
  DALMO ALVES PALMEIRA tem dois (lotes antigos 12/397 e 12/400, cada um com a própria série). 103
  contratos ficam em 1 lote; 4 ficam em 2 lotes, porque o boleto sai em dois lotes e o CPF está nos
  dois: 00000498 (Q04 L13 e L14), 00000510 (Q08 L15 e L16), 00000513 (Q07 L10 e Q08 L07), 00000517
  (Q09 L20 e L21).
- **Das 9.868 linhas para 9.840 parcelas (P8).** 22 grupos de 50 linhas, em 14 clientes, viram 22
  parcelas: 21 grupos só com linhas pagas (as linhas de saldo somam R$ 171.762,22 de nominal que não
  existe; ex.: 00000561, entrada 001/001 de R$ 20.000 em 4 linhas, 20.000 + 12.000 + 8.000 + 3.000, com
  R$ 20.000 recebidos) e 1 grupo com uma linha paga e uma aberta do mesmo mês: 00000517, 006/084 de
  10/08/2026, paga em 18/08 (R$ 4.387,58) e ainda "a receber" (R$ 4.387,48). A aberta fica como origem
  `aberta_duplicada`, com pendência para o time confirmar; sem isso seria um vencido que não existe.
  Em 5 grupos a linha de maior valor é o valor reajustado e o nominal da série é menor (00000059
  006/084, 00000498 005 e 006/084, 00000513 003 e 004/084): R$ 580,77.
- **Valor de contrato (nominal):** R$ 34.978.293,15 = R$ 30.552.334,74 em aberto + R$ 4.425.958,41
  nominal pago. O espelho das mesmas linhas soma R$ 35.155.023,62; a diferença, R$ 176.730,47, é
  171.762,22 + 4.387,48 + 580,77. O recebido é R$ 4.484.836,13 nos dois lados (o nominal pago é menor
  que o recebido, como o reajuste faz).
- **Por tipo (regra na seção 4.2):** 8.897 mensais (R$ 23.974.178,08; 708 pagas), 702 anuais
  (R$ 8.114.495,98; 2 pagas), 241 de entrada (R$ 2.889.619,09; 135 pagas).
- **Vencidas até 28/09/2026:** 23 parcelas, R$ 73.571,50 (nominal). 11 delas vencem antes de setembro
  (R$ 38.428,60: 00000431, 00000505, 00000508, 00000531 e 00000533), num período em que o Panteon não
  emitia boleto do Garden (`boletos_parcelas` de fevereiro a agosto tem `emissao_iniciada_em` nulo em
  todas as linhas). Elas sobem com a pendência `vencida_herdada_do_lsoft` e o aviso na tela até o time
  confirmar (seção 5).
- **Vencimentos** de 20/01/2026 a 20/12/2039. Nenhuma parcela paga sem data, nenhuma com permuta no
  texto, nenhuma sem vencimento.
- **91 linhas** com baixa lançada na tela em 22/09 (trilha em `lsoft_clientes_edicoes`, autor Lucas
  Ruas); a baixa vem junto, com a origem `lsoft` e esse autor.
- **Lotes:** os 111 existem em `hercules_unidades` (empreendimento `39`), todos `bloqueada`; 2 com
  `preco_tabela <= 1`. 8 contratos herdam a marca de lote incerto que o boleto já tem
  (`boletos_parcelas.unidade_incerta`: Q06 L10, Q06 L24, Q07 L25, Q07 L26, Q07 L27, Q13 L10, Q17 L02,
  Q17 L18; ver `scripts/boletos/carregar-garden.mjs:12-24`).
- **Contrato que cobre mais de um lote antigo:** 19 dos 106. Em 4 os dois lotes têm boleto (acima); nos
  outros 15 o boleto único já cobra o valor cheio num lote só (ex.: 00000565 BEATRIZ paga R$ 4.414,24 na
  Q12 L14 pelos lotes antigos 416 e 417), e o segundo lote antigo fica em `lotes_antigos`, sem lote
  novo, até alguém indicar.
- **Outras carteiras dos que sobem:** 11 dos 106 têm parcela fora da 124, e 10 têm saldo aberto lá,
  R$ 4.964.996,16: 00000059, 00000096 (só pagas), 00000245, 00000248, 00000289, 00000290, 00000417,
  00000421, 00000422, 00000431, 00000503. Isso não sobe (decisão 6).
- **Dezembro e janeiro:** vencem 60 anuais em dez/2026 (R$ 665.666,00) e 40 em jan/2027
  (R$ 483.357,14), cada uma no mesmo mês de uma mensal. O Garden nunca emitiu cobrança com sequência 2
  (as 989 linhas de `boletos_parcelas` e as 141 de `boletos_pagamentos` são sequência 1), e as anuais
  pagas até hoje foram pagas por fora. Ver a pergunta 5.

Os 106 que sobem:

```
00000011 00000021 00000046 00000059 00000074 00000096 00000245 00000248 00000289 00000290
00000417 00000421 00000422 00000431 00000492 00000493 00000494 00000496 00000498 00000499
00000500 00000501 00000503 00000504 00000505 00000506 00000507 00000508 00000509 00000510
00000511 00000512 00000513 00000514 00000515 00000516 00000517 00000518 00000519 00000520
00000521 00000522 00000523 00000526 00000527 00000529 00000530 00000531 00000532 00000533
00000534 00000535 00000536 00000537 00000540 00000542 00000543 00000545 00000546 00000547
00000549 00000550 00000551 00000552 00000553 00000554 00000555 00000556 00000557 00000559
00000561 00000562 00000564 00000565 00000567 00000568 00000569 00000570 00000571 00000572
00000574 00000575 00000576 00000578 00000579 00000580 00000581 00000583 00000584 00000585
00000589 00000590 00000592 00000593 00000597 00000600 00000601 00000602 00000606 00000607
00000609 00000612 00000613 00000614 00000619 00000625
```

### 2.3 Quem fica na integração, e por quê (35)

**10 com OK na planilha que não sobem** (R$ 3.675.714,02 em aberto):

| Código | Cliente | Linha | Parcelas | Em aberto (R$) | Por que fica |
|---|---|---:|---:|---:|---|
| 00000440 | JFB EMPREEDIMENTOS LTDA | 73 | 1 | 10.500,00 | Sem ponte (o CNPJ não tem boleto do Garden) e linha repetida (P7): a única parcela ("ENTRADA 2/2", 10/01/2028, lote antigo Q4 L247) é idêntica à 002/002 do 00000527 ATHOS, que sobe. Enquanto o time não disser qual é a real, é duplicata. |
| 00000560 | URBANO MARÇAL REZENDE | 126 | 91 | 244.166,30 | Linha repetida (P7): as 7 anuais de R$ 10.000 (lote antigo 12/402, 20/12/2026 a 20/12/2032, texto "LOTE 402 QUADRA 12 PARCELA ANUAL") são idênticas às 7 anuais do 00000059 WOLMERT, dono do lote. O contrato dele (13/366, boleto Q13 L21) não tem entrada nem anual própria. Subir contaria R$ 70.000 duas vezes. |
| 00000487 | ANGELA MARIA DE OLIVEIRA EUFRAZIO MACIEL | 34 | 93 | 235.285,90 | Sem ponte: sem CPF no LSoft. O boleto Q09 L10 tem documento e o mapa leva o lote antigo 9/58 para Q09 L10; basta alguém confirmar e preencher o CPF. |
| 00000548 | ANTONIO MONTEIRO JUNIOR | 36 | 91 | 1.281.094,00 | Sem ponte: parcelas sem quadra e sem lote (o texto cita 180/181/319/432/135) e CPF sem boleto do Garden. |
| 00000599 | GABRIELA ANDRADE DE ALENCAR RAMOS | 61 | 92 | 474.809,90 | Sem ponte: lote vazio (Q13, o texto cita 381/382) e CPF sem boleto do Garden. |
| 00000524 | PAULO SERGIO MAIA | 103 | 186 | 472.690,85 | Ponte cruzada: o CPF dele está no boleto Q11 L01, emitido em nome de HENRIQUE GAUDÊNCIO; e ele tem 2 contratos no LSoft (11/421 e 13/380) para 1 boleto. |
| 00000538 | HENRIQUE GAUDENCIO DE OLIVEIRA | 66 | 92 | 225.833,37 | Ponte cruzada: o CPF dele está no boleto Q13 L07, emitido em nome de PAULO SÉRGIO MAIA; o mapa leva o lote antigo 12/418 para Q12 L16, boleto de VICTOR LIMA CAMPOS (fora do LSoft). |
| 00000086 | BRUNO ALEXANDRE ALMEIDA RESENDE | 43 | 7 | 0,00 | Cronograma nunca lançado: 7 parcelas, todas pagas, nenhuma a vencer, mas o Asaas cobra R$ 4.414,25 por mês na Q06 L02. Subir daria contrato quitado. |
| 00000587 | MOREIRA E GOMES EMPREENDIMENTOS E PARTICIPACOES LTDA | 102 | 97 | 466.333,70 | Contrato partido: o LSoft cobra R$ 4.238,10 por mês pelos lotes 120 e 121, mas o boleto do 121 (Q07 L11) sai em nome de GERALDO SANTOS DE SOUZA, fora do LSoft. É a divergência da 007/084 que trava a carga (PAN-122). |
| 00000179 | THIAGO HENRIQUE GOMES OTTO QUARESMA | 124 | 161 | 265.000,00 | Permuta de materiais: R$ 227,5 mil dos R$ 265 mil em aberto (decisão 5). |

**24 com observação na planilha** (R$ 9.257.337,78 em aberto), texto como está na planilha:

| Código | Cliente | Linha | Parcelas | Em aberto (R$) | Observação |
|---|---|---:|---:|---:|---|
| 00000654 | JORGE EDUARDO LEITE ALBERTO | 2 | 97 | 370.000,00 | 07 PARC DE 10K SÃO PERMUTA |
| 00000605 | LEONARDO GUSTAVO DOS SANTOS | 3 | 87 | 235.667,07 | 100K PERMUTA |
| 00000020 | THIAGO BRUNO FARIA NASSER VILELA | 4 | 92 | 769.500,66 | 250K LOTE PATRIMÔNIO |
| 00000591 | EDMARA MARTINS MATOSO FERREIRA | 5 | 94 | 284.000,00 | 40K PERMUTA |
| 00000544 | VIRGINIA MENDONÇA CAPANEMA | 6 | 92 | 506.333,70 | 40K PERMUTA DE PROJETO ARQUITETÔNICO |
| 00000647 | BUILD PLAN CONSTRUÇÕES | 7 | 1 | 0,00 | ARRUMAMOS E TEM QUE ATUALIZAR - 450.000,00 |
| 00000610 | LEANDRO ALVES ALMEIDA FERREIRA | 8 | 97 | 245.166,85 | BOLETOS EM ABERTO |
| 00000213 | JULIO CESAR FERREIRA BARBOSA | 9 | 92 | 235.285,90 | CANCELAR O DIA 25/09 E EMITIR O PRÓXIMO DIA 25/10 7/84 E DEIXAR OS PRÓXIMOS P DIA 25 |
| 00000541 | JULIANA FERREIRA TEIXEIRA ARANTES | 10 | 276 | 705.857,70 | ESTÁ COMO "EM PARTES" SENDO QUE NA VERDADE É PQ ELA TEM 3 LOTES |
| 00000566 | AGNALDO PEREIRA DUARTE | 11 | 8 | 70.000,00 | ESTÁ SO AS PARCELAS ANUAIS |
| 00000025 | APARECIDO JOAO BATISTA DA SILVA | 12 | 1 | 0,00 | ESTÁ SÓ COM UMA PARCELA LANÇADA, VENCIDA EM 2013 |
| 00000443 | ANDRE ALMEIDA COSTA | 13 | 85 | 330.571,80 | ESTAVA COM PARCELAS 07 DE 20K MAS NO VALE DO SOL |
| 00000276 | LEANDRO AUGUSTO DOS SANTOS | 14 e 20 | 186 | 489.048,30 | LOTE 342 VAI FAZER AS BOLETAS NORMAIS, TEM 160K DE PERMUTA E 84X DE 1190,48 REAJUSTÁVEL; NAO FAZER BOLETO P/ LOTE 358 |
| 00000603 | RONALDO FARIA MENDES | 15 | 93 | 247.333,84 | MUDAMOS A PARCELA, TINHA DADO ERRO POR CAUSA DE 0,01 |
| 00000563 | ALINE CASSIA DOS SANTOS | 16 | 92 | 255.282,00 | NÃO EMITIR BOLETO / PERMUTA DE 20K |
| 00000582 | FABIO AUGUSTO ALMEIDA PINTO | 17 | 184 | 472.690,85 | NÃO ESTÁ EM PARTES, SÃO DOIS LOTES |
| 00000005 | KLEBER ANTONIO BARCELOS | 18 | 100 | 239.642,50 | NÃO FAZER BOLETAS |
| 00000099 | LAESTE DE LIMA JUNIOR | 19 | 117 | 661.000,00 | NÃO FAZER BOLETAS |
| 00000219 | MARIO SANTOS ROCHA | 21 | 273 | 1.175.001,24 | NAO PRECISA FAZER BOLETOS |
| 00000588 | RENATO DE VASCONCELOS FARIA | 139 | 1 | 268.000,00 | PATRIMÔNIO LOTE |
| 00000539 | JULIA LAGE RIBEIRO PALOTTI | 140 | 92 | 257.404,95 | PERMUTA DE 20K |
| 00000185 | LUIZ KELLEY QUIRINO BESSA | 141 | 176 | 256.383,57 | TEM DUAS BOLETAS DO GARDEN TODO MÊS. UMA ABATE NA PERMUTA E A OUTRA ELE PAGA. AS PARCELAS DE 10.000,00 TB SÃO PERMUTAS |
| 00000586 | GUSTAVO MENDES DUARTE | 142 | 102 | 950.000,00 | TEM MAIS DE UM LOTE; 292, 293, 294 E 295 NA Q17 |
| 00000525 | RAMON MENDES DE CARVALHO | 143 | 92 | 233.166,85 | VEIO JUNTO O DO VALE DO OURO |

**1 fora da planilha:** 00000558 ANA CECILIA FERREIRA DINIZ REZENDE (92 parcelas, R$ 237.404,95 em
aberto, lote antigo Q8 L97), decisão 6.

### 2.4 Setembro: Asaas contra o espelho, só para os 106

`boletos_pagamentos` guarda só a competência 2026-09 (o registro nasceu em 22/09, migration 0186). No
Garden inteiro: 129 cobranças `RECEIVED` (R$ 328.931,10) e 12 `OVERDUE` (R$ 50.638,69), todas com
sequência 1. Para os 106, contrato a contrato, somando as cobranças de todos os lotes do contrato:

| Situação em setembro | Clientes | Parcelas | Cobranças | O que a primeira rodada do casador faz |
|---|---:|---:|---:|---|
| Paga nos dois lados, mesmo valor | 91 | 91 | 91 pagas | **Confirmação** (liga a cobrança à baixa do LSoft; nenhum valor muda). Em 91 a baixa do espelho é a da tela de 22/09, datada depois do pagamento no Asaas. |
| Paga nos dois lados, valor e data diferentes | 1 | 1 | 1 paga | 00000290 ALTAIR: o Access baixou a 007/084 em 24/08 (R$ 2.209,59, pago antecipado, como a 006 em 21/07) e o boleto Q08 L01 foi pago em 16/09 (R$ 2.223,07). Vai para a pendência **pago_em_dobro**: o time decide se o dinheiro de 16/09 é da 008/084. |
| Paga no Asaas, aberta no espelho | 6 | 7 | 11 pagas (R$ 26.479,89) | **Baixa pelo Asaas**: 00000498, 00000510, 00000513, 00000517 (dois boletos por parcela: 4 recebimentos parciais e 4 baixas), 00000531 (dois contratos) e 00000542. Nominal baixado: R$ 25.428,60. |
| Paga no espelho, boleto vencido no Asaas | 2 | 2 | 2 vencidas | 00000417 e 00000421 pagaram R$ 10.291,40 por fora em 10/09 (baixa vinda do Access, `editada_por` nulo). Pendência **boleto_em_aberto_carteira_paga**, para a Careli cancelar a cobrança no Asaas. |
| Paga antecipado, sem boleto | 1 | 1 | 0 | 00000555 pagou em 13/03 a 007, a 008 e a 009/084 (set a nov/2026). Nada agora; um boleto de outubro ou novembro pago vira pago_em_dobro. |
| Aberta nos dois lados | 5 | 5 | 5 em aberto | 00000431, 00000508, 00000511, 00000519, 00000579. A baixa vem quando o Asaas receber. |

As outras cobranças do Garden em setembro são de quem fica na integração ou de gente que não está no
LSoft (VICTOR LIMA CAMPOS na Q12 L16, GERALDO SANTOS DE SOUZA na Q07 L11); não tocam a carteira. A
Q07 L28 do SAMUEL (00000431, R$ 12.364,53 por mês) tem boleto e CPF dele, mas nenhuma parcela no
LSoft: fica fora do contrato dele (Q13 L20) e o casador ignora (lote sem contrato).

Depois da primeira rodada, dos 106 ficam 102 parcelas de setembro pagas na carteira (95 do espelho mais
7 do Asaas).

---

## 3. Modelo de dados

### 3.1 O desenho

```
lsoft_clientes ──< lsoft_parcelas (espelho, congelado no par migrado)        hercules_unidades (lote novo)
      │                  ▲ carteira_parcela_origens (1 a N linhas por parcela)            ▲
      │                  │                                                                │
      └──< lsoft_migracoes (a MARCA) ──< carteira_contratos ──< carteira_contrato_unidades ┘
                                               │
                                               ├──< carteira_parcelas ──< carteira_baixas (trilha, só cresce)
                                               ├──< carteira_correcoes (trilha das correções)
                                               └──< carteira_pendencias (o que uma pessoa resolve)
boletos_pagamentos (retrato do Asaas) ──► casador (de hora em hora, só com a chave ligada, relendo na API)
```

- **Genérico, não `garden_*`.** `carteira_contratos.enterprise_id` é o texto de
  `hercules_unidades.enterprise_id` (`'39'`), então o escopo do portal (`donoNoPanteon`,
  `lib/apolo/incorporador/escopo.ts:389`) serve sem tradução.
- **Não é o `apolo_carteira_*`** (`lib/apolo/carteira-da-venda.ts:1-18`, cópia do C2X nunca criada).
- **Dinheiro em `numeric(14,2)`.** Valor da parcela é o nominal do contrato; o reajuste mora no boleto.
- **Tudo com RLS ligada e sem policy**, `revoke all` de `anon` e `authenticated` em tabelas e views, e
  `revoke execute` de `public`, `anon` e `authenticated` em cada função.
- **Escrita só por função.** Situação, valor, vencimento, contrato e vínculo mudam só pelas funções
  `carteira_*`; um trigger recusa UPDATE e DELETE diretos (seção 14 da migration).

### 3.2 A migration 0199 (rascunho)

Número: o 0198 foi aplicado hoje em produção por outra frente
(`20260929191055 0198_a_origem_faturamento_na_passagem`, arquivo em
`careli-hub-worktrees/assinatura-fonte-unica`). Esta é a **0199**; a fatia opcional F8 é a 0200.
**O número é conferido de novo na hora de aplicar**, no diretório de todos os checkouts e no registro.

Arquivo: `packages/database/migrations/0199_a_carteira_mora_no_panteon.sql`

```sql
-- 0199 · A CARTEIRA MORA NO PANTEON, E O GARDEN É O PRIMEIRO A SUBIR.
--
-- Lucas, 29/09/2026: "garden que está no lsoft vai subir para financeiro carteira, as que estiverem
-- com ok, ou seja, vai deixar de existir no lsoft e agora vai para carteira do garden". No mesmo dia:
-- "esquece o c2x, cecilio não tem nenhum vinculo com o legado c2x".
--
-- POR QUE EXISTE: o cronograma de contrato do Garden só existe no espelho do LSoft (lsoft_parcelas,
-- categoria 124), e a carga apaga e regrava o espelho por categoria. Sem carteira própria, "tirar do
-- LSoft" apagaria a única cópia do contrato, e a carga seguinte traria todo mundo de volta em aberto:
-- cobrança em dobro. E o Financeiro do portal lê só o C2X, onde o Garden não tem contrato.
--
-- ATENCAO 1: TABELAS GENÉRICAS (carteira_*), NÃO "garden_*". enterprise_id é o texto de
-- hercules_unidades.enterprise_id ('39').
--
-- ATENCAO 2: NÃO É O ESPELHO apolo_carteira_* de lib/apolo/carteira-da-venda.ts.
--
-- ATENCAO 3: O CLIENTE SAI DA INTEGRAÇÃO POR MARCA, NUNCA POR DELETE (decisão do Lucas, 29/09). A marca
-- é por CLIENTE x CATEGORIA: 11 dos 106 têm Giant Towers, patrimônio etc. que ficam no LSoft.
--
-- ATENCAO 4: O ESPELHO FICA PROTEGIDO DOS DOIS IMPORTADORES. O antigo (255 linhas, ainda no checkout
-- principal careli-hub e em 7 worktrees) apaga TODAS as parcelas sem ler o erro e regrava o CSV SEM
-- categoria_lsoft. Por isso: categoria_lsoft NOT NULL (hoje 0 nulos em 32.660); um DELETE que deixaria
-- o espelho vazio é recusado; o trigger recusa INSERT de par migrado e UPDATE/DELETE de linha migrada;
-- e a FK de carteira_parcela_origens para lsoft_parcelas é RESTRICT.
--
-- ATENCAO 5: O VALOR É O DO CONTRATO (o nominal do LSoft). O reajuste continua no boleto; o que o
-- comprador pagou vai em valor_pago. O boleto de setembro é R$ 2.207,18 para uma parcela de R$ 2.119,05.
--
-- ATENCAO 6: UMA PARCELA DA CARTEIRA PODE VIR DE VÁRIAS LINHAS DO ESPELHO. O LSoft grava o pagamento
-- parcial como linha nova da MESMA parcela, com o saldo no valor (00000498, 004/084 de 10/06/2026:
-- 4.238,10 e 2.080,28, cada uma com 2.157,82 recebidos). Subir linha a linha inflaria o contrato em
-- R$ 171.762,22 nos 106. carteira_parcela_origens guarda cada linha e o papel dela.
--
-- ATENCAO 7: A TRILHA DE BAIXA SÓ CRESCE, E A PARCELA SÓ MUDA PELA PORTA. Desfazer uma baixa é um
-- estorno (linha nova). Situação, valor, contrato e vínculo só mudam pelas funções carteira_*, que
-- abrem a porta com a GUC local carteira.porta; UPDATE ou DELETE direto é recusado.
--
-- ATENCAO 8: RLS LIGADA SEM POLICY, revoke de anon e authenticated em tabela e view, e revoke de
-- execute de public, anon E authenticated em toda função. A carteira guarda CPF.
--
-- ATENCAO 9: CREATE OR REPLACE VIEW SEM "with (security_invoker = true)" ZERA A OPÇÃO, e DROP + CREATE
-- devolve os grants padrão ao anon (0148 mediu 248 CPFs abertos por isso).
--
-- ATENCAO 10: O CASADOR NASCE DESLIGADO. Ele só aplica pagamento do Asaas no empreendimento que está em
-- carteira_casador_ligado, e essa linha entra depois da conferência da subida, com OK do Lucas: antes
-- disso uma baixa do Asaas fecharia a janela do desfazer.
--
-- ATENCAO 11: FUNÇÃO "returns table" LEVA "#variable_conflict use_column". A coluna OUT "situacao"
-- colidia com carteira_parcelas.situacao: 42702 na primeira chamada, não na aplicação (o mesmo cuidado
-- da 0195).

begin;

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 0. O ESPELHO NÃO ACEITA LINHA SEM CATEGORIA (ATENCAO 4)
alter table public.lsoft_parcelas alter column categoria_lsoft set not null;

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 1. A MARCA NO LSOFT
create table if not exists public.lsoft_migracoes (
  id                             uuid primary key default gen_random_uuid(),
  cliente_codigo                 text not null references public.lsoft_clientes(codigo) on delete restrict,
  categoria_lsoft                integer not null,
  empreendimento                 text not null,
  destino                        text not null default 'carteira_panteon',
  marca_da_carga                 timestamptz not null,
  fonte_da_decisao               text not null,
  decisao                        text not null,
  linhas_no_corte                integer not null,
  abertas_no_corte               integer not null,
  nominal_no_corte               numeric(14,2) not null,
  saldo_aberto_no_corte          numeric(14,2) not null,
  recebido_no_corte              numeric(14,2) not null,
  status_validacao_anterior      text,
  observacao_validacao_anterior  text,
  validado_em_anterior           timestamptz,
  validado_por_anterior          text,
  migrado_por                    text not null,
  migrado_em                     timestamptz not null default now(),
  desfeito_em                    timestamptz,
  desfeito_por                   text,
  motivo_desfazer                text,
  constraint lsoft_migracoes_destino check (destino in ('carteira_panteon')),
  constraint lsoft_migracoes_desfeito_inteiro check (
    (desfeito_em is null and desfeito_por is null and motivo_desfazer is null)
    or (desfeito_em is not null and desfeito_por is not null and motivo_desfazer is not null)
  )
);
create unique index if not exists lsoft_migracoes_uma_viva
  on public.lsoft_migracoes (cliente_codigo, categoria_lsoft) where desfeito_em is null;
comment on table public.lsoft_migracoes is
  'Marca de que o par cliente x categoria saiu da integração do LSoft para a carteira do Panteon. '
  'Enquanto viva, a view lsoft_parcelas_no_espelho esconde o par e o trigger congela as linhas.';

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 2. O CONTRATO
create table if not exists public.carteira_contratos (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          text not null default 'careli',
  enterprise_id         text not null,
  origem                text not null,
  -- Chave de idempotência: 'lsoft:124:00000498:4/216'.
  chave_de_origem       text not null,
  lsoft_cliente_codigo  text references public.lsoft_clientes(codigo) on delete restrict,
  lsoft_categoria       integer,
  comprador_nome        text not null,
  comprador_documento   text,
  lotes_antigos         text[] not null default '{}',
  unidade_incerta       boolean not null default false,
  nota_da_unidade       text,
  situacao              text not null default 'ativo',
  valor_na_subida       numeric(14,2) not null,
  migracao_id           uuid references public.lsoft_migracoes(id) on delete restrict,
  criado_por            text not null,
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now(),
  constraint carteira_contratos_origem check (origem in ('lsoft', 'panteon')),
  constraint carteira_contratos_situacao check (situacao in ('ativo', 'quitado', 'distratado')),
  constraint carteira_contratos_documento check (
    comprador_documento is null or comprador_documento ~ '^([0-9]{11}|[0-9]{14})$'),
  constraint carteira_contratos_origem_lsoft check (
    origem <> 'lsoft' or (lsoft_cliente_codigo is not null and lsoft_categoria is not null and migracao_id is not null))
);
create unique index if not exists carteira_contratos_chave
  on public.carteira_contratos (workspace_id, chave_de_origem);
create index if not exists carteira_contratos_por_empreendimento
  on public.carteira_contratos (workspace_id, enterprise_id);
create index if not exists carteira_contratos_por_migracao
  on public.carteira_contratos (migracao_id) where migracao_id is not null;
comment on column public.carteira_contratos.valor_na_subida is
  'Soma nominal das parcelas no dia da subida. NÃO é o preço do lote nem o VGV de hoje.';

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 3. OS LOTES DO CONTRATO (um contrato pode ter dois lotes; um lote tem um contrato vivo)
create table if not exists public.carteira_contrato_unidades (
  contrato_id            uuid not null references public.carteira_contratos(id) on delete cascade,
  unidade_id             uuid not null references public.hercules_unidades(id) on delete restrict,
  principal              boolean not null default false,
  -- A chave com que o boleto nomeia o lote ('garden' + 'Q04-L13', chaveDeUnidade em emissao.ts:299).
  boleto_empreendimento  text,
  boleto_unidade         text,
  fonte                  text not null,
  vinculo_encerrado_em   timestamptz,
  criado_em              timestamptz not null default now(),
  primary key (contrato_id, unidade_id),
  constraint carteira_contrato_unidades_fonte check (fonte in ('cpf_do_boleto', 'cpf_do_boleto+mapa', 'manual')),
  constraint carteira_contrato_unidades_boleto check ((boleto_empreendimento is null) = (boleto_unidade is null))
);
create unique index if not exists carteira_um_contrato_vivo_por_unidade
  on public.carteira_contrato_unidades (unidade_id) where vinculo_encerrado_em is null;
create unique index if not exists carteira_um_principal_por_contrato
  on public.carteira_contrato_unidades (contrato_id) where principal and vinculo_encerrado_em is null;
create unique index if not exists carteira_unidade_por_boleto
  on public.carteira_contrato_unidades (boleto_empreendimento, boleto_unidade)
  where boleto_unidade is not null and vinculo_encerrado_em is null;

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 4. AS PARCELAS E AS LINHAS DO ESPELHO DE ONDE VIERAM (ATENCAO 6)
create table if not exists public.carteira_parcelas (
  id                    uuid primary key default gen_random_uuid(),
  contrato_id           uuid not null references public.carteira_contratos(id) on delete restrict,
  tipo                  text not null,
  rotulo                text,
  numero                integer,
  total                 integer,
  vencimento            date not null,
  valor                 numeric(14,2) not null,
  situacao              text not null default 'aberta',
  -- O que entrou. Numa parcela aberta, é o recebimento parcial (contrato de dois lotes, baixa manual menor).
  valor_pago            numeric(14,2),
  pago_em               date,
  baixa_origem          text,
  observacao            text,
  lote_antigo_digitado  text,
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now(),
  constraint carteira_parcelas_tipo check (tipo in ('entrada', 'mensal', 'anual', 'outra')),
  constraint carteira_parcelas_situacao check (situacao in ('aberta', 'paga', 'cancelada')),
  constraint carteira_parcelas_valores check (valor > 0 and (valor_pago is null or valor_pago > 0)),
  constraint carteira_parcelas_paga_completa check (
    situacao <> 'paga' or (pago_em is not null and valor_pago is not null and baixa_origem is not null)),
  constraint carteira_parcelas_aberta_sem_data check (situacao = 'paga' or (pago_em is null and baixa_origem is null)),
  constraint carteira_parcelas_baixa_origem check (baixa_origem is null or baixa_origem in ('lsoft', 'asaas', 'manual'))
);
create index if not exists carteira_parcelas_por_contrato
  on public.carteira_parcelas (contrato_id, vencimento);
comment on column public.carteira_parcelas.valor is
  'Nominal do contrato. O reajuste é do boleto; o que entrou está em valor_pago.';

create table if not exists public.carteira_parcela_origens (
  lsoft_parcela_id   uuid primary key references public.lsoft_parcelas(id) on delete restrict,
  parcela_id         uuid not null references public.carteira_parcelas(id) on delete restrict,
  -- principal: a linha que dá rótulo e vencimento · saldo_parcial: a linha que o LSoft criou com o
  -- saldo de um pagamento parcial · aberta_duplicada: a linha "a receber" de um mês já recebido.
  papel              text not null,
  impressao_digital  text not null,
  ordinal            integer not null,
  constraint carteira_parcela_origens_papel check (papel in ('principal', 'saldo_parcial', 'aberta_duplicada'))
);
create unique index if not exists carteira_uma_principal_por_parcela
  on public.carteira_parcela_origens (parcela_id) where papel = 'principal';
create index if not exists carteira_origens_por_parcela on public.carteira_parcela_origens (parcela_id);

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 5. A TRILHA DE BAIXA (só cresce)
create table if not exists public.carteira_baixas (
  id                uuid primary key default gen_random_uuid(),
  parcela_id        uuid not null references public.carteira_parcelas(id) on delete restrict,
  -- baixa: a parcela passou a paga · recebimento_parcial: entrou dinheiro e ela segue aberta ·
  -- confirmacao: o Asaas confirmou uma baixa do LSoft · estorno: desfaz uma baixa ou um recebimento.
  evento            text not null,
  origem            text not null,
  valor             numeric(14,2) not null,
  pago_em           date,
  cobranca_id       text,
  estorna_baixa_id  uuid references public.carteira_baixas(id) on delete restrict,
  autor             text not null,
  autor_origem      text not null,
  motivo            text,
  criado_em         timestamptz not null default now(),
  constraint carteira_baixas_evento check (evento in ('baixa', 'recebimento_parcial', 'confirmacao', 'estorno')),
  constraint carteira_baixas_origem check (origem in ('lsoft', 'asaas', 'manual')),
  constraint carteira_baixas_autor_origem check (autor_origem in ('careli', 'incorporador', 'sistema')),
  constraint carteira_baixas_valor check (valor >= 0),
  constraint carteira_baixas_estorno check ((evento = 'estorno') = (estorna_baixa_id is not null)),
  constraint carteira_baixas_asaas_tem_cobranca check (origem <> 'asaas' or cobranca_id is not null),
  constraint carteira_baixas_manual_tem_motivo check (origem <> 'manual' or length(trim(coalesce(motivo, ''))) > 0)
);
-- A idempotência do casador: UMA cobrança move dinheiro (ou confirma) UMA vez, seja qual for o evento.
-- Por (cobranca_id, evento) a mesma cobrança podia virar recebimento_parcial numa rodada e baixa na
-- seguinte, somando o valor duas vezes.
create unique index if not exists carteira_baixas_um_evento_por_cobranca
  on public.carteira_baixas (cobranca_id) where cobranca_id is not null and evento <> 'estorno';
create unique index if not exists carteira_baixas_um_estorno_por_baixa
  on public.carteira_baixas (estorna_baixa_id) where estorna_baixa_id is not null;
create index if not exists carteira_baixas_por_parcela
  on public.carteira_baixas (parcela_id, criado_em);

create or replace function public.carteira_baixas_so_cresce()
returns trigger language plpgsql set search_path = public as $$
begin
  -- Única porta: o desfazer da subida apaga as baixas 'lsoft' que ela criou e as confirmações.
  if tg_op = 'DELETE'
     and (old.origem = 'lsoft' or old.evento = 'confirmacao')
     and current_setting('carteira.porta', true) = 'desfazer' then
    return old;
  end if;
  raise exception 'carteira_baixas só cresce: para desfazer uma baixa, registre um estorno';
end $$;
drop trigger if exists carteira_baixas_so_cresce on public.carteira_baixas;
create trigger carteira_baixas_so_cresce
  before update or delete on public.carteira_baixas
  for each row execute function public.carteira_baixas_so_cresce();

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 6. AS PENDÊNCIAS (o que o casador, a subida e a baixa do portal deixam para uma pessoa resolver)
create table if not exists public.carteira_pendencias (
  id                     uuid primary key default gen_random_uuid(),
  workspace_id           text not null default 'careli',
  enterprise_id          text not null,
  contrato_id            uuid references public.carteira_contratos(id) on delete restrict,
  parcela_id             uuid references public.carteira_parcelas(id) on delete restrict,
  baixa_id               uuid references public.carteira_baixas(id) on delete restrict,
  cobranca_id            text,
  boleto_empreendimento  text,
  boleto_unidade         text,
  competencia            text,
  sequencia              integer,
  situacao_asaas         text,
  valor                  numeric(14,2),
  pago_em                date,
  motivo                 text not null,
  origem                 text not null,
  estado                 text not null default 'pendente',
  resolvido_por          text,
  resolvido_em           timestamptz,
  observacao             text,
  criado_em              timestamptz not null default now(),
  atualizado_em          timestamptz not null default now(),
  constraint carteira_pendencias_motivo check (motivo in (
    'vencida_herdada_do_lsoft', 'aberta_duplicada_no_espelho',
    'sem_parcela', 'ambigua', 'nao_confirmada_no_asaas', 'boleto_em_aberto_carteira_paga',
    'pago_em_dobro', 'estorno_no_asaas', 'estorno_sem_baixa', 'baixa_manual_do_portal')),
  constraint carteira_pendencias_origem check (origem in ('subida', 'casador', 'baixa_manual')),
  constraint carteira_pendencias_estado check (estado in ('pendente', 'resolvida', 'ignorada')),
  constraint carteira_pendencias_resolvida_inteira check (
    (estado = 'pendente') = (resolvido_por is null and resolvido_em is null))
);
create unique index if not exists carteira_pendencia_por_cobranca
  on public.carteira_pendencias (cobranca_id, motivo) where cobranca_id is not null;
create unique index if not exists carteira_pendencia_por_baixa
  on public.carteira_pendencias (baixa_id, motivo) where baixa_id is not null;
create unique index if not exists carteira_pendencia_por_parcela
  on public.carteira_pendencias (parcela_id, motivo)
  where parcela_id is not null and cobranca_id is null and baixa_id is null;
create index if not exists carteira_pendencias_abertas
  on public.carteira_pendencias (enterprise_id, estado, criado_em);

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 7. A TRILHA DAS CORREÇÕES (depois que o desfazer fecha, o caminho é corrigir; seção 7.4 do projeto)
create table if not exists public.carteira_correcoes (
  id                   uuid primary key default gen_random_uuid(),
  contrato_id          uuid not null references public.carteira_contratos(id) on delete restrict,
  contrato_destino_id  uuid references public.carteira_contratos(id) on delete restrict,
  parcela_id           uuid references public.carteira_parcelas(id) on delete restrict,
  acao                 text not null,
  antes                jsonb not null,
  depois               jsonb not null,
  autor                text not null,
  autor_origem         text not null default 'careli',
  motivo               text not null,
  criado_em            timestamptz not null default now(),
  constraint carteira_correcoes_acao check (acao in (
    'cancelar', 'reabrir', 'mudar_valor', 'mudar_vencimento', 'mover',
    'encerrar_lote', 'ligar_lote', 'trocar_principal', 'situacao')),
  constraint carteira_correcoes_motivo check (length(trim(motivo)) > 0)
);

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 8. A CHAVE DO CASADOR (ATENCAO 10)
create table if not exists public.carteira_casador_ligado (
  enterprise_id          text primary key,
  boleto_empreendimento  text not null unique,
  ligado_por             text not null,
  motivo                 text not null,
  ligado_em              timestamptz not null default now()
);

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 9. A CAIXA DE ENTRADA PÓS-MIGRAÇÃO (o que o Access mudou depois do corte; só com carga nova)
create table if not exists public.lsoft_pos_migracao (
  id                 uuid primary key default gen_random_uuid(),
  migracao_id        uuid not null references public.lsoft_migracoes(id) on delete restrict,
  sincronizacao_id   uuid references public.lsoft_sincronizacoes(id) on delete set null,
  cliente_codigo     text not null,
  categoria_lsoft    integer not null,
  -- NOT NULL com default: o supabase-js só gera ON CONFLICT por lista de colunas, e índice por
  -- expressão (coalesce) não casa com ela (42P10).
  impressao_digital  text not null default '',
  ordinal            integer not null default 0,
  tipo               text not null,
  no_corte           jsonb,
  no_lsoft           jsonb,
  situacao           text not null default 'pendente',
  resolvido_por      text,
  resolvido_em       timestamptz,
  observacao         text,
  criado_em          timestamptz not null default now(),
  constraint lsoft_pos_migracao_tipo check (tipo in ('baixa_nova', 'parcela_nova', 'sumiu', 'valor_mudou')),
  constraint lsoft_pos_migracao_situacao check (situacao in ('pendente', 'aplicada', 'ignorada'))
);
create unique index if not exists lsoft_pos_migracao_idempotente
  on public.lsoft_pos_migracao (migracao_id, impressao_digital, ordinal, tipo);

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 10. AS LINHAS VIVAS DO ESPELHO E AS DUAS VIEWS DA TELA
create or replace view public.lsoft_parcelas_no_espelho with (security_invoker = true) as
select p.*
  from public.lsoft_parcelas p
 where not exists (
   select 1 from public.lsoft_migracoes m
    where m.cliente_codigo = p.cliente_codigo
      and m.categoria_lsoft = p.categoria_lsoft
      and m.desfeito_em is null);

-- (a) por cliente: JOIN em vez de LEFT JOIN (hoje 0 de 475 clientes estão sem parcela, então só quem
-- migrou por inteiro some) e `empreendimentos` calculado das linhas vivas: o array da tabela só soma
-- (mesclar-cliente.ts) e manteria "Garden" nos 11 que têm outras carteiras.
create or replace view public.lsoft_carteira_por_cliente with (security_invoker = true) as
 select c.codigo, c.nome, c.cpf, c.cpf_formatado, c.celular, c.telefone, c.email, c.cidade,
        array_agg(distinct p.empreendimento order by p.empreendimento) as empreendimentos,
        c.status_validacao, c.enriquecido_em,
        case when c.sexo is not null then 1 else 0 end
      + case when c.estado_civil is not null then 1 else 0 end
      + case when c.escolaridade is not null then 1 else 0 end
      + case when c.profissao is not null then 1 else 0 end
      + case when c.faixa_renda is not null then 1 else 0 end
      + case when c.naturalidade is not null then 1 else 0 end
      + case when c.numero is not null then 1 else 0 end
      + case when c.nascimento is not null then 1 else 0 end
      + case when c.mae is not null then 1 else 0 end as campos_c2x_preenchidos,
        9 as campos_c2x_total,
        count(p.id) as parcelas,
        count(p.id) filter (where p.paga) as parcelas_pagas,
        count(p.id) filter (where not p.paga) as parcelas_abertas,
        count(p.id) filter (where not p.paga and p.vencimento < current_date) as parcelas_vencidas,
        coalesce(sum(p.valor) filter (where not p.paga), 0::numeric) as saldo_aberto,
        coalesce(sum(p.valor) filter (where not p.paga and p.vencimento < current_date), 0::numeric) as saldo_vencido,
        coalesce(sum(p.valor_recebido) filter (where p.paga), 0::numeric) as total_recebido,
        min(p.vencimento) filter (where not p.paga) as proximo_vencimento,
        array_remove(array_agg(distinct
          case when p.quadra is not null or p.lote is not null
               then concat_ws(' ', nullif('Q' || p.quadra, 'Q'), nullif('L' || p.lote, 'L'))
               else null end), null) as unidades
   from public.lsoft_clientes c
   join public.lsoft_parcelas_no_espelho p on p.cliente_codigo = c.codigo
  group by c.codigo, c.nome, c.cpf, c.cpf_formatado, c.celular, c.telefone, c.email, c.cidade,
           c.status_validacao, c.enriquecido_em, c.sexo, c.estado_civil, c.escolaridade, c.profissao,
           c.faixa_renda, c.naturalidade, c.numero, c.nascimento, c.mae;

-- (b) por cliente e empreendimento: a definição viva de hoje (pg_get_viewdef em 29/09/2026), trocando
-- SÓ a fonte das parcelas de lsoft_parcelas para lsoft_parcelas_no_espelho.
create or replace view public.lsoft_carteira_por_cliente_empreendimento with (security_invoker = true) as
 with classificada as (
   select p_1.id, p_1.cliente_codigo, p_1.empreendimento, p_1.valor, p_1.valor_recebido, p_1.paga,
          p_1.vencimento, p_1.quadra, p_1.lote,
          coalesce(k.situacao = 'confirmada' and k.classe = 'caixa', false) as eh_caixa,
          coalesce(k.situacao = 'a_validar', false) as aguarda_validacao
     from public.lsoft_parcelas_no_espelho p_1
     left join public.lsoft_classificacao_de_parcela k on k.parcela_id = p_1.id
 ), liberado_pela_caixa as (
   select cliente_codigo, sum(valor) as total,
          sum(valor) filter (where eh_principal) as principal,
          sum(valor) filter (where not eh_principal) as secundario,
          count(*) as creditos, max(data_movimento) as ultima_liberacao
     from public.lsoft_credito_da_caixa
    where cliente_codigo is not null
    group by cliente_codigo
 )
 select c.codigo, c.nome, c.cpf, c.cpf_formatado, c.celular, c.telefone, c.email, c.cidade,
        c.status_validacao, c.enriquecido_em, p.empreendimento,
        count(*) filter (where not p.eh_caixa) as parcelas,
        count(*) filter (where not p.eh_caixa and p.paga) as parcelas_pagas,
        count(*) filter (where not p.eh_caixa and not p.paga) as parcelas_abertas,
        count(*) filter (where not p.eh_caixa and not p.paga and p.vencimento < current_date) as parcelas_vencidas,
        coalesce(sum(p.valor) filter (where not p.eh_caixa and not p.paga), 0::numeric) as saldo_aberto,
        coalesce(sum(p.valor) filter (where not p.eh_caixa and not p.paga and p.vencimento < current_date), 0::numeric) as saldo_vencido,
        coalesce(sum(p.valor_recebido) filter (where not p.eh_caixa and p.paga), 0::numeric) as total_recebido,
        min(p.vencimento) filter (where not p.eh_caixa and not p.paga) as proximo_vencimento,
        count(*) filter (where p.eh_caixa) as parcelas_caixa,
        coalesce(sum(p.valor) filter (where p.eh_caixa), 0::numeric) as total_caixa,
        coalesce(max(lib.total), 0::numeric) as caixa_ja_liberado,
        coalesce(max(lib.principal), 0::numeric) as caixa_liberado_principal,
        coalesce(max(lib.secundario), 0::numeric) as caixa_liberado_secundario,
        coalesce(max(lib.creditos), 0::bigint) as caixa_creditos,
        max(lib.ultima_liberacao) as caixa_ultima_liberacao,
        greatest(coalesce(sum(p.valor) filter (where p.eh_caixa), 0::numeric) - coalesce(max(lib.total), 0::numeric), 0::numeric) as caixa_a_liberar,
        coalesce(sum(p.valor) filter (where p.eh_caixa), 0::numeric) > 0::numeric
          and coalesce(max(lib.total), 0::numeric) >= coalesce(sum(p.valor) filter (where p.eh_caixa), 0::numeric) as caixa_liquidada,
        count(*) filter (where p.aguarda_validacao) as parcelas_a_validar,
        coalesce(sum(p.valor) filter (where p.aguarda_validacao), 0::numeric) as valor_a_validar,
        array_remove(array_agg(distinct
          case when p.quadra is not null or p.lote is not null
               then concat_ws(' ', nullif('Q' || p.quadra, 'Q'), nullif('L' || p.lote, 'L'))
               else null end), null) as unidades
   from public.lsoft_clientes c
   join classificada p on p.cliente_codigo = c.codigo
   left join liberado_pela_caixa lib on lib.cliente_codigo = c.codigo
  group by c.codigo, c.nome, c.cpf, c.cpf_formatado, c.celular, c.telefone, c.email, c.cidade,
           c.status_validacao, c.enriquecido_em, p.empreendimento;

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 11. AS TRAVAS DO ESPELHO (ATENCAO 4)
create or replace function public.lsoft_parcela_migrada_trava()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.categoria_lsoft is null then
      raise exception 'lsoft: parcela sem categoria_lsoft (importador antigo?); a carga é recusada';
    end if;
    if exists (select 1 from public.lsoft_migracoes m
                where m.cliente_codigo = new.cliente_codigo
                  and m.categoria_lsoft = new.categoria_lsoft
                  and m.desfeito_em is null) then
      raise exception 'lsoft: o cliente % na categoria % foi migrado para a carteira do Panteon; a carga não traz de volta',
        new.cliente_codigo, new.categoria_lsoft;
    end if;
    return new;
  end if;
  if exists (select 1 from public.carteira_parcela_origens o where o.lsoft_parcela_id = old.id) then
    raise exception 'lsoft: a linha % foi migrada para a carteira do Panteon e está congelada no espelho', old.id;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists lsoft_parcela_migrada_trava on public.lsoft_parcelas;
create trigger lsoft_parcela_migrada_trava
  before insert or update or delete on public.lsoft_parcelas
  for each row execute function public.lsoft_parcela_migrada_trava();

-- O importador antigo faz DELETE de TODAS as linhas antes de regravar. Nenhuma carga legítima deixa o
-- espelho vazio (a nova grava antes de apagar, e só as categorias dela).
create or replace function public.lsoft_espelho_nunca_vazio()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from public.lsoft_parcelas limit 1) then
    raise exception 'lsoft: este DELETE esvaziaria o espelho inteiro (importador antigo?); recusado';
  end if;
  return null;
end $$;
drop trigger if exists lsoft_espelho_nunca_vazio on public.lsoft_parcelas;
create trigger lsoft_espelho_nunca_vazio
  after delete on public.lsoft_parcelas
  for each statement execute function public.lsoft_espelho_nunca_vazio();

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 12. O APAGAMENTO DA CARGA, SEM TOCAR NO PAR MIGRADO (substitui o .delete() do importador novo)
create or replace function public.lsoft_apagar_antigas(p_categorias integer[], p_marca timestamptz)
returns integer language plpgsql set search_path = public as $$
declare v integer;
begin
  delete from public.lsoft_parcelas p
   where p.categoria_lsoft = any(p_categorias)
     and p.sincronizado_em <> p_marca
     and not exists (select 1 from public.lsoft_migracoes m
                      where m.cliente_codigo = p.cliente_codigo
                        and m.categoria_lsoft = p.categoria_lsoft
                        and m.desfeito_em is null);
  get diagnostics v = row_count;
  return v;
end $$;

create or replace function public.lsoft_contar_antigas(p_categorias integer[], p_marca timestamptz)
returns integer language sql stable set search_path = public as $$
  select count(*)::integer from public.lsoft_parcelas p
   where p.categoria_lsoft = any(p_categorias)
     and p.sincronizado_em <> p_marca
     and not exists (select 1 from public.lsoft_migracoes m
                      where m.cliente_codigo = p.cliente_codigo
                        and m.categoria_lsoft = p.categoria_lsoft
                        and m.desfeito_em is null);
$$;

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 13. A PORTA DA CARTEIRA (ATENCAO 7)
create or replace function public.carteira_so_pela_porta()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('carteira.porta', true), '') in ('subida', 'baixa', 'desfazer', 'correcao') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  raise exception 'carteira: % em % só pelas funções carteira_* (subida, baixa, correção, desfazer)',
    tg_op, tg_table_name;
end $$;
drop trigger if exists carteira_so_pela_porta on public.carteira_parcelas;
create trigger carteira_so_pela_porta before update or delete on public.carteira_parcelas
  for each row execute function public.carteira_so_pela_porta();
drop trigger if exists carteira_so_pela_porta on public.carteira_contratos;
create trigger carteira_so_pela_porta before update or delete on public.carteira_contratos
  for each row execute function public.carteira_so_pela_porta();
drop trigger if exists carteira_so_pela_porta on public.carteira_contrato_unidades;
create trigger carteira_so_pela_porta before update or delete on public.carteira_contrato_unidades
  for each row execute function public.carteira_so_pela_porta();
drop trigger if exists carteira_so_pela_porta on public.carteira_parcela_origens;
create trigger carteira_so_pela_porta before update or delete on public.carteira_parcela_origens
  for each row execute function public.carteira_so_pela_porta();

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 14. A SUBIDA DE UM CLIENTE (atômica, idempotente, confere o espelho dentro da transação)
-- p_plano (um cliente, gerado pela F0 e revisado):
-- { "cliente": "00000498", "categoria": 124, "empreendimento": "Garden",
--   "fonte_da_decisao": "OBSERVAÇÕES DO GARDEN S.xlsx · OBS. LUCAS · linha 41", "decisao": "OK",
--   "conferencia": { "linhas": 96, "linhas_abertas": 88, "nominal_espelho": ..., "aberto_espelho": ...,
--                    "recebido": ..., "parcelas": 92, "nominal": ..., "aberto": ... },
--   "validacao": { "status": "validado", "observacao": "...", "validado_por": "..." },
--   "contratos": [ { "chave": "lsoft:124:00000498:4/216", "enterprise_id": "39",
--       "lotes_antigos": ["4/216", "4/217"], "unidade_incerta": false, "nota_da_unidade": null,
--       "unidades": [ { "unidade_id": "<uuid>", "principal": true, "boleto_empreendimento": "garden",
--                       "boleto_unidade": "Q04-L14", "fonte": "cpf_do_boleto+mapa" }, ... ],
--       "parcelas": [ { "tipo": "mensal", "valor": null,
--                       "origens": [ { "id": "<uuid lsoft>", "papel": "principal", "digital": "<md5>", "ordinal": 1 } ] },
--                     { "tipo": "mensal", "valor": 4238.10,
--                       "origens": [ { "id": "...", "papel": "principal", ... }, { "id": "...", "papel": "saldo_parcial", ... } ] } ] } ],
--   "pendencias": [ { "lsoft_parcela_id": "<uuid>", "motivo": "vencida_herdada_do_lsoft", "observacao": "..." } ] }
create or replace function public.carteira_subir_do_lsoft(p_plano jsonb, p_autor text)
returns table (resultado text, contratos integer, parcelas integer, nominal numeric, aberto numeric, recebido numeric)
language plpgsql set search_path = public as $$
#variable_conflict use_column
declare
  v_cliente    text    := p_plano->>'cliente';
  v_categoria  integer := (p_plano->>'categoria')::integer;
  v_conf       jsonb   := p_plano->'conferencia';
  v_val        jsonb   := p_plano->'validacao';
  v_pend       jsonb   := coalesce(p_plano->'pendencias', '[]'::jsonb);
  v_cli        public.lsoft_clientes%rowtype;
  v_mig        uuid;
  v_contrato   uuid;
  v_parcela    uuid;
  v_principal  uuid;
  v_c jsonb; v_u jsonb; v_p jsonb;
  v_n integer; v_abertas integer; v_qt integer; v_pagas integer; v_rotulos integer; v_principais integer; v_dup_paga integer;
  v_nominal numeric(14,2); v_aberto numeric(14,2); v_recebido numeric(14,2); v_dup numeric(14,2);
  v_rec numeric(14,2); v_menor numeric(14,2); v_maior numeric(14,2); v_valor numeric(14,2);
  v_ultimo date; v_marca timestamptz; v_no_plano integer; v_distintas integer;
begin
  if coalesce(trim(p_autor), '') = '' then raise exception 'subida: autor obrigatório'; end if;
  perform set_config('carteira.porta', 'subida', true);

  if exists (select 1 from public.lsoft_migracoes m
              where m.cliente_codigo = v_cliente and m.categoria_lsoft = v_categoria and m.desfeito_em is null) then
    return query select 'ja_migrado'::text, 0, 0, 0::numeric, 0::numeric, 0::numeric;
    return;
  end if;

  select * into v_cli from public.lsoft_clientes where codigo = v_cliente for update;
  if not found then raise exception 'subida: o cliente % não existe no espelho', v_cliente; end if;
  perform 1 from public.lsoft_parcelas where cliente_codigo = v_cliente and categoria_lsoft = v_categoria for update;

  -- 1. O espelho (linha a linha) ainda é o do plano.
  select count(*), count(*) filter (where not paga), coalesce(sum(valor), 0),
         coalesce(sum(valor) filter (where not paga), 0),
         coalesce(sum(valor_recebido) filter (where paga), 0), max(sincronizado_em)
    into v_n, v_abertas, v_nominal, v_aberto, v_recebido, v_marca
    from public.lsoft_parcelas where cliente_codigo = v_cliente and categoria_lsoft = v_categoria;
  if v_n <> (v_conf->>'linhas')::integer or v_abertas <> (v_conf->>'linhas_abertas')::integer
     or v_nominal <> (v_conf->>'nominal_espelho')::numeric or v_aberto <> (v_conf->>'aberto_espelho')::numeric
     or v_recebido <> (v_conf->>'recebido')::numeric then
    raise exception 'subida %: o espelho mudou desde o plano (linhas % x %, nominal % x %, aberto % x %, recebido % x %)',
      v_cliente, v_n, v_conf->>'linhas', v_nominal, v_conf->>'nominal_espelho', v_aberto, v_conf->>'aberto_espelho',
      v_recebido, v_conf->>'recebido';
  end if;

  -- 2. Cada linha do par está em exatamente uma parcela do plano, e nenhuma sobra.
  select count(*), count(distinct (x->>'id')) into v_no_plano, v_distintas
    from jsonb_array_elements(p_plano->'contratos') c(v),
         jsonb_array_elements(c.v->'parcelas') p(v),
         jsonb_array_elements(p.v->'origens') x;
  if v_no_plano <> v_n or v_distintas <> v_n or exists (
       select 1 from public.lsoft_parcelas l
        where l.cliente_codigo = v_cliente and l.categoria_lsoft = v_categoria
          and not exists (select 1 from jsonb_array_elements(p_plano->'contratos') c(v),
                                        jsonb_array_elements(c.v->'parcelas') p(v),
                                        jsonb_array_elements(p.v->'origens') x
                           where (x->>'id')::uuid = l.id)) then
    raise exception 'subida %: o plano não cobre as % linhas do par uma vez cada (no plano %, distintas %)',
      v_cliente, v_n, v_no_plano, v_distintas;
  end if;

  -- 3. A marca, com o que o cadastro tinha antes (o desfazer devolve).
  insert into public.lsoft_migracoes (
    cliente_codigo, categoria_lsoft, empreendimento, marca_da_carga, fonte_da_decisao, decisao,
    linhas_no_corte, abertas_no_corte, nominal_no_corte, saldo_aberto_no_corte, recebido_no_corte,
    status_validacao_anterior, observacao_validacao_anterior, validado_em_anterior, validado_por_anterior, migrado_por)
  values (
    v_cliente, v_categoria, p_plano->>'empreendimento', v_marca, p_plano->>'fonte_da_decisao', p_plano->>'decisao',
    v_n, v_abertas, v_nominal, v_aberto, v_recebido,
    v_cli.status_validacao, v_cli.observacao_validacao, v_cli.validado_em, v_cli.validado_por, p_autor)
  returning id into v_mig;

  -- 4. Contratos, lotes, parcelas, origens e a baixa que já veio do espelho.
  for v_c in select c.v from jsonb_array_elements(p_plano->'contratos') c(v) loop
    insert into public.carteira_contratos (
      enterprise_id, origem, chave_de_origem, lsoft_cliente_codigo, lsoft_categoria, comprador_nome,
      comprador_documento, lotes_antigos, unidade_incerta, nota_da_unidade, valor_na_subida, migracao_id, criado_por)
    values (
      v_c->>'enterprise_id', 'lsoft', v_c->>'chave', v_cliente, v_categoria, v_cli.nome,
      nullif(regexp_replace(coalesce(v_cli.cpf, ''), '[^0-9]', '', 'g'), ''),
      array(select jsonb_array_elements_text(v_c->'lotes_antigos')),
      coalesce((v_c->>'unidade_incerta')::boolean, false), v_c->>'nota_da_unidade', 0, v_mig, p_autor)
    returning id into v_contrato;

    for v_u in select u.v from jsonb_array_elements(v_c->'unidades') u(v) loop
      if not exists (select 1 from public.hercules_unidades h
                      where h.id = (v_u->>'unidade_id')::uuid and h.enterprise_id = v_c->>'enterprise_id') then
        raise exception 'subida %: o lote % não é do empreendimento %', v_cliente, v_u->>'unidade_id', v_c->>'enterprise_id';
      end if;
      insert into public.carteira_contrato_unidades (contrato_id, unidade_id, principal, boleto_empreendimento, boleto_unidade, fonte)
      values (v_contrato, (v_u->>'unidade_id')::uuid, coalesce((v_u->>'principal')::boolean, false),
              v_u->>'boleto_empreendimento', v_u->>'boleto_unidade', v_u->>'fonte');
    end loop;

    for v_p in select p.v from jsonb_array_elements(v_c->'parcelas') p(v) loop
      -- As linhas de uma parcela: do par, do mesmo rótulo e vencimento, uma principal, e a aberta
      -- duplicada só ao lado de uma linha paga (P8).
      select count(*), count(*) filter (where l.paga), coalesce(sum(l.valor_recebido) filter (where l.paga), 0),
             max(l.data_recebido) filter (where l.paga), min(l.valor), max(l.valor),
             count(distinct (l.parcela, l.vencimento)),
             count(*) filter (where x->>'papel' = 'principal'),
             count(*) filter (where x->>'papel' = 'aberta_duplicada' and l.paga),
             (max(l.id::text) filter (where x->>'papel' = 'principal'))::uuid
        into v_qt, v_pagas, v_rec, v_ultimo, v_menor, v_maior, v_rotulos, v_principais, v_dup_paga, v_principal
        from jsonb_array_elements(v_p->'origens') x
        join public.lsoft_parcelas l on l.id = (x->>'id')::uuid
                                    and l.cliente_codigo = v_cliente and l.categoria_lsoft = v_categoria;
      if v_qt <> jsonb_array_length(v_p->'origens') or v_principais <> 1 or v_rotulos <> 1 or v_dup_paga > 0
         or (v_qt > 1 and (v_pagas = 0 or (v_p->>'valor') is null
                           or (v_p->>'valor')::numeric not between v_menor and v_maior)) then
        raise exception 'subida %: parcela do plano inválida (origens %)', v_cliente, v_p->'origens';
      end if;
      v_valor := case when v_qt = 1 then v_maior else (v_p->>'valor')::numeric end;

      insert into public.carteira_parcelas (
        contrato_id, tipo, rotulo, numero, total, vencimento, valor, situacao, valor_pago, pago_em,
        baixa_origem, observacao, lote_antigo_digitado)
      select v_contrato, v_p->>'tipo', pr.parcela, pr.parcela_numero, pr.parcela_total, pr.vencimento, v_valor,
             case when v_pagas > 0 then 'paga' else 'aberta' end,
             case when v_pagas > 0 then v_rec end,
             case when v_pagas > 0 then v_ultimo end,
             case when v_pagas > 0 then 'lsoft' end,
             pr.observacoes, nullif(concat_ws('/', pr.quadra, pr.lote), '')
        from public.lsoft_parcelas pr where pr.id = v_principal
      returning id into v_parcela;

      insert into public.carteira_parcela_origens (lsoft_parcela_id, parcela_id, papel, impressao_digital, ordinal)
      select (x->>'id')::uuid, v_parcela, x->>'papel', x->>'digital', (x->>'ordinal')::integer
        from jsonb_array_elements(v_p->'origens') x;
    end loop;

    insert into public.carteira_baixas (parcela_id, evento, origem, valor, pago_em, autor, autor_origem, motivo)
    select cp.id, 'baixa', 'lsoft', cp.valor_pago, cp.pago_em,
           coalesce(ed.autor, 'LSoft (Access)'),
           case when ed.autor is null then 'sistema' when ed.autor ~ '\(.+\)$' then 'incorporador' else 'careli' end,
           'baixa trazida do espelho do LSoft na subida'
      from public.carteira_parcelas cp
      left join lateral (
        select max(nullif(trim(l.editada_por), '')) as autor
          from public.carteira_parcela_origens o
          join public.lsoft_parcelas l on l.id = o.lsoft_parcela_id
         where o.parcela_id = cp.id and l.paga) ed on true
     where cp.contrato_id = v_contrato and cp.situacao = 'paga';

    update public.carteira_contratos k
       set valor_na_subida = (select coalesce(sum(cp.valor), 0) from public.carteira_parcelas cp where cp.contrato_id = v_contrato)
     where k.id = v_contrato;
  end loop;

  -- 5. As pendências da subida (vencida herdada, aberta duplicada), ligadas à parcela da carteira.
  insert into public.carteira_pendencias (enterprise_id, contrato_id, parcela_id, motivo, origem, valor, observacao)
  select k.enterprise_id, k.id, cp.id, x->>'motivo', 'subida', cp.valor, x->>'observacao'
    from jsonb_array_elements(v_pend) x
    join public.carteira_parcela_origens o on o.lsoft_parcela_id = (x->>'lsoft_parcela_id')::uuid
    join public.carteira_parcelas cp on cp.id = o.parcela_id
    join public.carteira_contratos k on k.id = cp.contrato_id and k.migracao_id = v_mig;
  get diagnostics v_qt = row_count;
  if v_qt <> jsonb_array_length(v_pend) then
    raise exception 'subida %: % pendência(s) do plano não acharam parcela', v_cliente, jsonb_array_length(v_pend) - v_qt;
  end if;

  -- 6. A carteira fecha com o espelho. O recebido é o mesmo no centavo; o aberto só perde a linha
  -- aberta duplicada; o nominal é o que o plano declarou (P8).
  select coalesce(sum(l.valor), 0) into v_dup
    from public.carteira_parcela_origens o
    join public.lsoft_parcelas l on l.id = o.lsoft_parcela_id
    join public.carteira_parcelas cp on cp.id = o.parcela_id
    join public.carteira_contratos k on k.id = cp.contrato_id
   where k.migracao_id = v_mig and o.papel = 'aberta_duplicada';
  select count(*), coalesce(sum(cp.valor), 0),
         coalesce(sum(cp.valor) filter (where cp.situacao = 'aberta'), 0),
         coalesce(sum(cp.valor_pago) filter (where cp.situacao = 'paga'), 0)
    into v_no_plano, v_nominal, v_aberto, v_recebido
    from public.carteira_parcelas cp join public.carteira_contratos k on k.id = cp.contrato_id
   where k.migracao_id = v_mig;
  if v_no_plano <> (v_conf->>'parcelas')::integer or v_nominal <> (v_conf->>'nominal')::numeric
     or v_aberto <> (v_conf->>'aberto')::numeric or v_aberto <> (v_conf->>'aberto_espelho')::numeric - v_dup
     or v_recebido <> (v_conf->>'recebido')::numeric then
    raise exception 'subida %: a carteira não fecha (parcelas % x %, nominal % x %, aberto % x %, recebido % x %)',
      v_cliente, v_no_plano, v_conf->>'parcelas', v_nominal, v_conf->>'nominal', v_aberto, v_conf->>'aberto',
      v_recebido, v_conf->>'recebido';
  end if;

  -- 7. O OK do time, com trilha (seção 5 do projeto).
  if v_val is not null then
    update public.lsoft_clientes
       set status_validacao     = coalesce(v_val->>'status', status_validacao),
           observacao_validacao = coalesce(v_val->>'observacao', observacao_validacao),
           validado_em          = case when v_val->>'status' = 'validado' then now() else validado_em end,
           validado_por         = case when v_val->>'status' = 'validado' then v_val->>'validado_por' else validado_por end
     where codigo = v_cliente;
    insert into public.lsoft_clientes_edicoes (cliente_codigo, campo, valor_anterior, valor_novo, autor, autor_origem)
    select v_cliente, x.campo, x.antes, x.depois, p_autor, 'careli'
      from (values ('status_validacao', v_cli.status_validacao, v_val->>'status'),
                   ('observacao_validacao', v_cli.observacao_validacao, v_val->>'observacao')) as x(campo, antes, depois)
     where x.depois is not null and x.depois is distinct from x.antes;
  end if;

  return query
    select 'migrado'::text,
           (select count(*)::integer from public.carteira_contratos k where k.migracao_id = v_mig),
           v_no_plano, v_nominal, v_aberto, v_recebido;
end $$;

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 15. O DESFAZER DA SUBIDA (só se nada aconteceu na carteira depois dela)
create or replace function public.carteira_desfazer_subida_do_lsoft(
  p_cliente text, p_categoria integer, p_autor text, p_motivo text)
returns text language plpgsql set search_path = public as $$
declare v_mig public.lsoft_migracoes%rowtype;
begin
  if coalesce(trim(p_motivo), '') = '' or coalesce(trim(p_autor), '') = '' then
    raise exception 'desfazer: autor e motivo são obrigatórios';
  end if;
  perform set_config('carteira.porta', 'desfazer', true);
  select * into v_mig from public.lsoft_migracoes
   where cliente_codigo = p_cliente and categoria_lsoft = p_categoria and desfeito_em is null for update;
  if not found then return 'nada_a_desfazer'; end if;

  -- História que o desfazer apagaria: baixa, recebimento ou estorno depois da subida; correção;
  -- pendência que não nasceu da subida (do casador ou da baixa manual), resolvida ou não.
  if exists (select 1 from public.carteira_baixas b
               join public.carteira_parcelas p on p.id = b.parcela_id
               join public.carteira_contratos k on k.id = p.contrato_id
              where k.migracao_id = v_mig.id and b.origem <> 'lsoft' and b.evento <> 'confirmacao')
     or exists (select 1 from public.carteira_correcoes c
                  join public.carteira_contratos k on k.id in (c.contrato_id, c.contrato_destino_id)
                 where k.migracao_id = v_mig.id)
     or exists (select 1 from public.carteira_pendencias x
                  join public.carteira_contratos k on k.id = x.contrato_id
                 where k.migracao_id = v_mig.id and x.origem <> 'subida') then
    raise exception 'desfazer %: a carteira já tem história depois da subida (baixa, correção ou pendência); use a correção (seção 7.4)', p_cliente;
  end if;

  delete from public.carteira_pendencias x using public.carteira_contratos k
   where x.contrato_id = k.id and k.migracao_id = v_mig.id;
  delete from public.carteira_baixas b using public.carteira_parcelas p, public.carteira_contratos k
   where b.parcela_id = p.id and p.contrato_id = k.id and k.migracao_id = v_mig.id;
  delete from public.carteira_parcela_origens o using public.carteira_parcelas p, public.carteira_contratos k
   where o.parcela_id = p.id and p.contrato_id = k.id and k.migracao_id = v_mig.id;
  delete from public.carteira_parcelas p using public.carteira_contratos k
   where p.contrato_id = k.id and k.migracao_id = v_mig.id;
  delete from public.carteira_contratos where migracao_id = v_mig.id;  -- os lotes saem em cascata

  update public.lsoft_migracoes
     set desfeito_em = now(), desfeito_por = p_autor, motivo_desfazer = p_motivo
   where id = v_mig.id;
  update public.lsoft_clientes
     set status_validacao = coalesce(v_mig.status_validacao_anterior, 'pendente'),
         observacao_validacao = v_mig.observacao_validacao_anterior,
         validado_em = v_mig.validado_em_anterior,
         validado_por = v_mig.validado_por_anterior
   where codigo = p_cliente;
  insert into public.lsoft_clientes_edicoes (cliente_codigo, campo, valor_anterior, valor_novo, autor, autor_origem)
  values (p_cliente, 'migracao', 'carteira_panteon', 'desfeita: ' || p_motivo, p_autor, 'careli');
  return 'desfeito';
end $$;

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 16. BAIXA E ESTORNO
create or replace function public.carteira_registrar_baixa(
  p_parcela uuid, p_evento text, p_origem text, p_valor numeric, p_pago_em date,
  p_autor text, p_autor_origem text, p_motivo text default null, p_cobranca_id text default null,
  p_quitar_com_desconto boolean default false)
returns table (resultado text, baixa_id uuid, evento text, situacao text)
language plpgsql set search_path = public as $$
#variable_conflict use_column
declare
  v_p    public.carteira_parcelas%rowtype;
  v_k    public.carteira_contratos%rowtype;
  v_id   uuid;
  v_ev   text := p_evento;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  perform set_config('carteira.porta', 'baixa', true);
  if p_evento not in ('baixa', 'recebimento_parcial', 'confirmacao') then
    raise exception 'baixa: evento % inválido (estorno tem função própria)', p_evento;
  end if;
  if coalesce(trim(p_autor), '') = '' then raise exception 'baixa: autor obrigatório'; end if;
  if p_origem = 'asaas' and p_cobranca_id is null then raise exception 'baixa do Asaas sem cobrança'; end if;
  if p_origem = 'manual' and (p_evento = 'confirmacao' or coalesce(trim(p_motivo), '') = '') then
    raise exception 'baixa manual: motivo obrigatório';
  end if;
  if p_quitar_com_desconto and coalesce(trim(p_motivo), '') = '' then
    raise exception 'baixa: quitar com desconto exige motivo';
  end if;
  if p_evento <> 'confirmacao' and (p_valor is null or p_valor <= 0 or p_pago_em is null) then
    raise exception 'baixa: valor e data são obrigatórios';
  end if;
  if p_pago_em > v_hoje then raise exception 'baixa: data de pagamento no futuro (%)', p_pago_em; end if;

  select * into v_p from public.carteira_parcelas cp where cp.id = p_parcela for update;
  if not found then raise exception 'baixa: a parcela % não existe', p_parcela; end if;
  select * into v_k from public.carteira_contratos k where k.id = v_p.contrato_id;
  if v_k.situacao <> 'ativo' then
    return query select 'contrato_nao_ativo'::text, null::uuid, null::text, v_p.situacao; return;
  end if;
  if p_evento in ('baixa', 'recebimento_parcial') and v_p.situacao <> 'aberta' then
    return query select 'parcela_nao_esta_aberta'::text, null::uuid, null::text, v_p.situacao; return;
  end if;
  if p_evento = 'confirmacao' and (v_p.situacao <> 'paga' or v_p.baixa_origem <> 'lsoft') then
    return query select 'nao_confirmavel'::text, null::uuid, null::text, v_p.situacao; return;
  end if;

  -- Baixa manual abaixo do saldo não quita: vira recebimento parcial, salvo desconto declarado.
  if p_origem = 'manual' and v_ev = 'baixa' and not p_quitar_com_desconto
     and p_valor < v_p.valor - coalesce(v_p.valor_pago, 0) - 0.01 then
    v_ev := 'recebimento_parcial';
  end if;

  insert into public.carteira_baixas (parcela_id, evento, origem, valor, pago_em, cobranca_id, autor, autor_origem, motivo)
  values (p_parcela, v_ev, p_origem, coalesce(p_valor, 0), p_pago_em, p_cobranca_id, p_autor, p_autor_origem, p_motivo)
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    return query select 'ja_aplicada'::text, null::uuid, null::text, v_p.situacao; return;
  end if;

  if v_ev = 'baixa' then
    update public.carteira_parcelas cp
       set situacao = 'paga', valor_pago = coalesce(cp.valor_pago, 0) + p_valor, pago_em = p_pago_em,
           baixa_origem = p_origem, atualizado_em = now()
     where cp.id = p_parcela;
  elsif v_ev = 'recebimento_parcial' then
    update public.carteira_parcelas cp
       set valor_pago = coalesce(cp.valor_pago, 0) + p_valor, atualizado_em = now()
     where cp.id = p_parcela;
  end if;

  -- A baixa manual feita no portal entra na fila de conferência da Careli (não trava nada).
  if p_origem = 'manual' and p_autor_origem = 'incorporador' then
    insert into public.carteira_pendencias (enterprise_id, contrato_id, parcela_id, baixa_id, motivo, origem, valor, pago_em, observacao)
    values (v_k.enterprise_id, v_k.id, p_parcela, v_id, 'baixa_manual_do_portal', 'baixa_manual', p_valor, p_pago_em, p_motivo);
  end if;

  return query select 'aplicada'::text, v_id, v_ev,
                      (select cp.situacao from public.carteira_parcelas cp where cp.id = p_parcela);
end $$;

create or replace function public.carteira_estornar_baixa(
  p_baixa uuid, p_origem text, p_autor text, p_autor_origem text, p_motivo text, p_cobranca_id text default null)
returns table (resultado text, estorno_id uuid, situacao text)
language plpgsql set search_path = public as $$
#variable_conflict use_column
declare
  v_b  public.carteira_baixas%rowtype;
  v_id uuid;
begin
  perform set_config('carteira.porta', 'baixa', true);
  if coalesce(trim(p_motivo), '') = '' then raise exception 'estorno: motivo obrigatório'; end if;
  select * into v_b from public.carteira_baixas b where b.id = p_baixa;
  if not found or v_b.evento not in ('baixa', 'recebimento_parcial') then
    raise exception 'estorno: % não é baixa nem recebimento', p_baixa;
  end if;
  -- Quem desfaz o quê: baixa do Asaas, à mão, só a Careli; o portal só a baixa manual do portal.
  if p_origem = 'manual' and v_b.origem = 'asaas' and p_autor_origem <> 'careli' then
    raise exception 'estorno: baixa do Asaas só a Careli desfaz à mão';
  end if;
  if p_autor_origem = 'incorporador' and not (v_b.origem = 'manual' and v_b.autor_origem = 'incorporador') then
    raise exception 'estorno: o portal só desfaz baixa manual feita no portal';
  end if;
  perform 1 from public.carteira_parcelas cp where cp.id = v_b.parcela_id for update;

  insert into public.carteira_baixas (parcela_id, evento, origem, valor, pago_em, cobranca_id, estorna_baixa_id, autor, autor_origem, motivo)
  values (v_b.parcela_id, 'estorno', p_origem, v_b.valor, null, p_cobranca_id, p_baixa, p_autor, p_autor_origem, p_motivo)
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    return query select 'ja_estornada'::text, null::uuid,
                        (select cp.situacao from public.carteira_parcelas cp where cp.id = v_b.parcela_id);
    return;
  end if;

  -- Dinheiro que volta reabre a parcela, seja baixa ou recebimento parcial: parcela paga só fica paga
  -- enquanto nenhum dinheiro dela foi estornado.
  update public.carteira_parcelas cp
     set valor_pago = nullif(coalesce(cp.valor_pago, 0) - v_b.valor, 0),
         situacao = case when cp.situacao = 'paga' then 'aberta' else cp.situacao end,
         pago_em = null, baixa_origem = null, atualizado_em = now()
   where cp.id = v_b.parcela_id;

  return query select 'estornada'::text, v_id,
                      (select cp.situacao from public.carteira_parcelas cp where cp.id = v_b.parcela_id);
end $$;

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 17. AS CORREÇÕES (seção 7.4 do projeto; só a Careli, com motivo, e cada uma deixa antes e depois)
create or replace function public.carteira_corrigir_parcela(
  p_parcela uuid, p_acao text, p_dados jsonb, p_autor text, p_motivo text)
returns text language plpgsql set search_path = public as $$
declare
  v_antes  public.carteira_parcelas%rowtype;
  v_depois public.carteira_parcelas%rowtype;
  v_k      public.carteira_contratos%rowtype;
  v_dest   public.carteira_contratos%rowtype;
begin
  if coalesce(trim(p_autor), '') = '' or coalesce(trim(p_motivo), '') = '' then
    raise exception 'correção: autor e motivo são obrigatórios';
  end if;
  perform set_config('carteira.porta', 'correcao', true);
  select * into v_antes from public.carteira_parcelas where id = p_parcela for update;
  if not found then raise exception 'correção: a parcela % não existe', p_parcela; end if;
  select * into v_k from public.carteira_contratos where id = v_antes.contrato_id;

  if p_acao = 'cancelar' then
    if v_antes.situacao <> 'aberta' or v_antes.valor_pago is not null then
      raise exception 'correção: só se cancela parcela aberta sem dinheiro recebido; estorne antes';
    end if;
    update public.carteira_parcelas set situacao = 'cancelada', atualizado_em = now() where id = p_parcela;
  elsif p_acao = 'reabrir' then
    if v_antes.situacao <> 'cancelada' then raise exception 'correção: a parcela não está cancelada'; end if;
    update public.carteira_parcelas set situacao = 'aberta', atualizado_em = now() where id = p_parcela;
  elsif p_acao = 'mudar_valor' then
    if v_antes.situacao <> 'aberta' or (p_dados->>'valor')::numeric <= 0 then
      raise exception 'correção: valor só muda em parcela aberta, e maior que zero';
    end if;
    update public.carteira_parcelas set valor = (p_dados->>'valor')::numeric, atualizado_em = now() where id = p_parcela;
  elsif p_acao = 'mudar_vencimento' then
    if v_antes.situacao <> 'aberta' then raise exception 'correção: vencimento só muda em parcela aberta'; end if;
    update public.carteira_parcelas set vencimento = (p_dados->>'vencimento')::date, atualizado_em = now() where id = p_parcela;
  elsif p_acao = 'mover' then
    select * into v_dest from public.carteira_contratos where id = (p_dados->>'contrato_id')::uuid for update;
    if not found or v_dest.enterprise_id <> v_k.enterprise_id or v_dest.situacao <> 'ativo' then
      raise exception 'correção: contrato de destino inválido';
    end if;
    update public.carteira_parcelas set contrato_id = v_dest.id, atualizado_em = now() where id = p_parcela;
  else
    raise exception 'correção: ação % desconhecida', p_acao;
  end if;

  select * into v_depois from public.carteira_parcelas where id = p_parcela;
  insert into public.carteira_correcoes (contrato_id, contrato_destino_id, parcela_id, acao, antes, depois, autor, motivo)
  values (v_antes.contrato_id, case when p_acao = 'mover' then v_dest.id end, p_parcela, p_acao,
          to_jsonb(v_antes), to_jsonb(v_depois), p_autor, p_motivo);
  return 'corrigida';
end $$;

create or replace function public.carteira_corrigir_contrato(
  p_contrato uuid, p_acao text, p_dados jsonb, p_autor text, p_motivo text)
returns text language plpgsql set search_path = public as $$
declare
  v_k      public.carteira_contratos%rowtype;
  v_u      uuid := nullif(p_dados->>'unidade_id', '')::uuid;
  v_antes  jsonb;
begin
  if coalesce(trim(p_autor), '') = '' or coalesce(trim(p_motivo), '') = '' then
    raise exception 'correção: autor e motivo são obrigatórios';
  end if;
  perform set_config('carteira.porta', 'correcao', true);
  select * into v_k from public.carteira_contratos where id = p_contrato for update;
  if not found then raise exception 'correção: o contrato % não existe', p_contrato; end if;
  v_antes := jsonb_build_object('contrato', to_jsonb(v_k), 'lotes',
    (select coalesce(jsonb_agg(to_jsonb(u)), '[]') from public.carteira_contrato_unidades u where u.contrato_id = p_contrato));

  if p_acao = 'encerrar_lote' then
    update public.carteira_contrato_unidades set vinculo_encerrado_em = now()
     where contrato_id = p_contrato and unidade_id = v_u and vinculo_encerrado_em is null and not principal;
    if not found then raise exception 'correção: lote vivo e não principal não encontrado (troque o principal antes)'; end if;
  elsif p_acao = 'ligar_lote' then
    if not exists (select 1 from public.hercules_unidades h where h.id = v_u and h.enterprise_id = v_k.enterprise_id) then
      raise exception 'correção: o lote não é do empreendimento do contrato';
    end if;
    insert into public.carteira_contrato_unidades (contrato_id, unidade_id, principal, boleto_empreendimento, boleto_unidade, fonte)
    values (p_contrato, v_u, false, p_dados->>'boleto_empreendimento', p_dados->>'boleto_unidade', 'manual')
    on conflict (contrato_id, unidade_id) do update
      set vinculo_encerrado_em = null, boleto_empreendimento = excluded.boleto_empreendimento,
          boleto_unidade = excluded.boleto_unidade, fonte = 'manual';
  elsif p_acao = 'trocar_principal' then
    update public.carteira_contrato_unidades set principal = false where contrato_id = p_contrato and principal;
    update public.carteira_contrato_unidades set principal = true
     where contrato_id = p_contrato and unidade_id = v_u and vinculo_encerrado_em is null;
    if not found then raise exception 'correção: o lote não está vivo neste contrato'; end if;
  elsif p_acao = 'situacao' then
    if coalesce(p_dados->>'situacao', '') not in ('ativo', 'quitado', 'distratado') then
      raise exception 'correção: situação inválida';
    end if;
    update public.carteira_contratos set situacao = p_dados->>'situacao', atualizado_em = now() where id = p_contrato;
  else
    raise exception 'correção: ação % desconhecida', p_acao;
  end if;

  insert into public.carteira_correcoes (contrato_id, acao, antes, depois, autor, motivo)
  values (p_contrato, p_acao, v_antes,
          jsonb_build_object('contrato', (select to_jsonb(k) from public.carteira_contratos k where k.id = p_contrato), 'lotes',
            (select coalesce(jsonb_agg(to_jsonb(u)), '[]') from public.carteira_contrato_unidades u where u.contrato_id = p_contrato)),
          p_autor, p_motivo);
  return 'corrigido';
end $$;

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 18. O QUE O FINANCEIRO LÊ
-- "Hoje" é o dia de São Paulo. UMA régua para o recebimento parcial: a vencer e vencido pelo SALDO;
-- o parcial entra em "recebido"; recebido_no_mes vem dos eventos de dinheiro não estornados.
-- Fechamento: total_contrato = pago_nominal + recebido_parcial_em_aberto + a_vencer + vencido.
create or replace view public.carteira_resumo_por_contrato with (security_invoker = true) as
with hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d),
dinheiro as (
  select p.contrato_id, b.valor, b.pago_em
    from public.carteira_baixas b
    join public.carteira_parcelas p on p.id = b.parcela_id
   where b.evento in ('baixa', 'recebimento_parcial')
     and not exists (select 1 from public.carteira_baixas e where e.estorna_baixa_id = b.id)
)
select k.id as contrato_id, k.workspace_id, k.enterprise_id, k.origem, k.situacao as situacao_do_contrato,
       k.comprador_nome, k.comprador_documento, k.lsoft_cliente_codigo, k.lotes_antigos, k.unidade_incerta,
       k.nota_da_unidade, k.migracao_id, m.migrado_em,
       (select u.unidade_id from public.carteira_contrato_unidades u
         where u.contrato_id = k.id and u.principal and u.vinculo_encerrado_em is null) as unidade_principal_id,
       (select array_agg(h.codigo order by u.principal desc, h.codigo) from public.carteira_contrato_unidades u
          join public.hercules_unidades h on h.id = u.unidade_id
         where u.contrato_id = k.id and u.vinculo_encerrado_em is null) as unidades_codigos,
       (select string_agg('Q' || lpad(h.quadra, 2, '0') || ' L' || lpad(h.lote, 2, '0'), ' + ' order by u.principal desc, h.codigo)
          from public.carteira_contrato_unidades u join public.hercules_unidades h on h.id = u.unidade_id
         where u.contrato_id = k.id and u.vinculo_encerrado_em is null) as unidades_rotulo,
       coalesce(sum(p.valor) filter (where p.situacao <> 'cancelada'), 0) as total_contrato,
       coalesce(sum(p.valor) filter (where p.situacao = 'paga'), 0) as pago_nominal,
       coalesce(sum(p.valor_pago) filter (where p.situacao = 'aberta'), 0) as recebido_parcial_em_aberto,
       coalesce(sum(p.valor_pago) filter (where p.situacao <> 'cancelada'), 0) as recebido,
       coalesce(sum(greatest(p.valor - coalesce(p.valor_pago, 0), 0))
                filter (where p.situacao = 'aberta' and p.vencimento >= hoje.d), 0) as a_vencer,
       coalesce(sum(greatest(p.valor - coalesce(p.valor_pago, 0), 0))
                filter (where p.situacao = 'aberta' and p.vencimento < hoje.d), 0) as vencido,
       count(p.id) filter (where p.situacao = 'aberta' and p.vencimento < hoje.d) as parcelas_vencidas,
       coalesce(max(hoje.d - p.vencimento) filter (where p.situacao = 'aberta' and p.vencimento < hoje.d), 0) as max_dias_atraso,
       coalesce(sum(p.valor) filter (where p.situacao <> 'cancelada' and p.vencimento <= hoje.d), 0) as previsto_ate_hoje,
       (select coalesce(sum(d.valor), 0) from dinheiro d
         where d.contrato_id = k.id and date_trunc('month', d.pago_em) = date_trunc('month', hoje.d)) as recebido_no_mes,
       (select count(*) from public.carteira_pendencias x
         where x.contrato_id = k.id and x.estado = 'pendente') as pendencias_abertas
  from public.carteira_contratos k
  cross join hoje
  left join public.lsoft_migracoes m on m.id = k.migracao_id
  left join public.carteira_parcelas p on p.contrato_id = k.id
 group by k.id, m.migrado_em, hoje.d;

create or replace view public.carteira_parcelas_da_tela with (security_invoker = true) as
select p.id, p.contrato_id, k.enterprise_id, k.comprador_nome, k.comprador_documento, k.lsoft_cliente_codigo,
       u.unidade_id, h.codigo as unidade_codigo, h.quadra, h.lote, r.unidades_rotulo,
       p.tipo, p.rotulo, p.numero, p.total, p.vencimento, p.valor, p.situacao, p.valor_pago, p.pago_em, p.baixa_origem,
       (select max(b.pago_em) from public.carteira_baixas b
         where b.parcela_id = p.id and b.evento in ('baixa', 'recebimento_parcial')
           and not exists (select 1 from public.carteira_baixas e where e.estorna_baixa_id = b.id)) as ultimo_recebimento_em,
       exists (select 1 from public.carteira_pendencias x
                where x.parcela_id = p.id and x.estado = 'pendente') as em_conferencia
  from public.carteira_parcelas p
  join public.carteira_contratos k on k.id = p.contrato_id
  left join public.carteira_contrato_unidades u
    on u.contrato_id = k.id and u.principal and u.vinculo_encerrado_em is null
  left join public.hercules_unidades h on h.id = u.unidade_id
  left join lateral (
    select string_agg('Q' || lpad(h2.quadra, 2, '0') || ' L' || lpad(h2.lote, 2, '0'), ' + ' order by u2.principal desc, h2.codigo) as unidades_rotulo
      from public.carteira_contrato_unidades u2 join public.hercules_unidades h2 on h2.id = u2.unidade_id
     where u2.contrato_id = k.id and u2.vinculo_encerrado_em is null) r on true
 where p.situacao <> 'cancelada';

-- ───────────────────────────────────────────────────────────────────────────────────────────────
-- 19. RLS FECHADA E PERMISSÕES (ATENCAO 8)
alter table public.lsoft_migracoes            enable row level security;
alter table public.lsoft_pos_migracao         enable row level security;
alter table public.carteira_contratos         enable row level security;
alter table public.carteira_contrato_unidades enable row level security;
alter table public.carteira_parcelas          enable row level security;
alter table public.carteira_parcela_origens   enable row level security;
alter table public.carteira_baixas            enable row level security;
alter table public.carteira_pendencias        enable row level security;
alter table public.carteira_correcoes         enable row level security;
alter table public.carteira_casador_ligado    enable row level security;

revoke all on public.lsoft_migracoes, public.lsoft_pos_migracao, public.carteira_contratos,
              public.carteira_contrato_unidades, public.carteira_parcelas, public.carteira_parcela_origens,
              public.carteira_baixas, public.carteira_pendencias, public.carteira_correcoes,
              public.carteira_casador_ligado
  from anon, authenticated;
revoke all on public.lsoft_parcelas_no_espelho, public.lsoft_carteira_por_cliente,
              public.lsoft_carteira_por_cliente_empreendimento, public.carteira_resumo_por_contrato,
              public.carteira_parcelas_da_tela
  from anon, authenticated;

revoke all on function public.carteira_baixas_so_cresce() from public, anon, authenticated;
revoke all on function public.carteira_so_pela_porta() from public, anon, authenticated;
revoke all on function public.lsoft_parcela_migrada_trava() from public, anon, authenticated;
revoke all on function public.lsoft_espelho_nunca_vazio() from public, anon, authenticated;
revoke all on function public.lsoft_apagar_antigas(integer[], timestamptz) from public, anon, authenticated;
revoke all on function public.lsoft_contar_antigas(integer[], timestamptz) from public, anon, authenticated;
revoke all on function public.carteira_subir_do_lsoft(jsonb, text) from public, anon, authenticated;
revoke all on function public.carteira_desfazer_subida_do_lsoft(text, integer, text, text) from public, anon, authenticated;
revoke all on function public.carteira_registrar_baixa(uuid, text, text, numeric, date, text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.carteira_estornar_baixa(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.carteira_corrigir_parcela(uuid, text, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.carteira_corrigir_contrato(uuid, text, jsonb, text, text) from public, anon, authenticated;

grant execute on function public.lsoft_apagar_antigas(integer[], timestamptz) to service_role;
grant execute on function public.lsoft_contar_antigas(integer[], timestamptz) to service_role;
grant execute on function public.carteira_subir_do_lsoft(jsonb, text) to service_role;
grant execute on function public.carteira_desfazer_subida_do_lsoft(text, integer, text, text) to service_role;
grant execute on function public.carteira_registrar_baixa(uuid, text, text, numeric, date, text, text, text, text, boolean) to service_role;
grant execute on function public.carteira_estornar_baixa(uuid, text, text, text, text, text) to service_role;
grant execute on function public.carteira_corrigir_parcela(uuid, text, jsonb, text, text) to service_role;
grant execute on function public.carteira_corrigir_contrato(uuid, text, jsonb, text, text) to service_role;

commit;

-- COMO VOLTAR, se algo quebrar ANTES de qualquer subida (tabelas vazias):
--   drop trigger lsoft_parcela_migrada_trava e lsoft_espelho_nunca_vazio on public.lsoft_parcelas;
--   alter table public.lsoft_parcelas alter column categoria_lsoft drop not null;
--   recriar as duas views de carteira lendo lsoft_parcelas (apêndice B), com security_invoker e revoke;
--   drop das funções, das views novas e das tabelas carteira_*, lsoft_migracoes e lsoft_pos_migracao.
-- Depois de uma subida, voltar é desfazer cliente a cliente (carteira_desfazer_subida_do_lsoft).
```

**Conferência depois de aplicar** (skill `migration-supabase`, seção 4): `lsoft_parcelas.categoria_lsoft`
com `is_nullable = NO`; colunas e precisão por `information_schema.columns`; `relrowsecurity = true` nas
10 tabelas; `reloptions` com `security_invoker=true` nas 5 views; `has_table_privilege('anon', ...)`
falso em tabelas e views; `has_function_privilege('anon', ...)` e `('authenticated', ...)` falsos nas
12 funções; `get_advisors` sem `rls_disabled_in_public`; as duas views de carteira devolvendo os mesmos
475 clientes de antes.

### 3.3 O ensaio no banco

Arquivo: `packages/database/migrations/0199_a_carteira_mora_no_panteon.ensaio.sql`, no padrão da 0195
(tudo entre `begin` e `rollback`, cada bloco levanta exceção se o resultado não é o esperado).

**Roda ANTES de aplicar**, e não só depois: o `.sql` inteiro (sem o `begin`/`commit` dele) e o ensaio na
mesma transação, terminando em `rollback`, em produção. O homolog foi apagado (memória
`reference_preview_nao_loga_supabase_homolog`), e é o ensaio que pega o erro que só aparece na primeira
chamada de uma função (o 42702 da ATENCAO 11). É DDL dentro de transação desfeita, e precisa do mesmo
OK do Lucas. Entre os casos, `select set_config('carteira.porta', '', true)` limpa a porta, porque na
transação única ela fica aberta depois da primeira chamada.

Casos:

1. Sobe 00000498: 96 linhas viram 92 parcelas (4 grupos de pagamento parcial), 1 contrato, 2 lotes,
   96 origens e as somas; chama de novo e recebe `ja_migrado`.
2. Sobe 00000561: a entrada 001/001 de 4 linhas vira 1 parcela de R$ 20.000 paga com R$ 20.000.
3. Sobe 00000517: a 006/084 vira 1 parcela paga (R$ 4.238,10, pago R$ 4.387,58), com a linha aberta
   como `aberta_duplicada` e a pendência `aberta_duplicada_no_espelho`.
4. Sobe 00000493 e confere as 2 anuais do lote 16/297 no contrato dela, com `lote_antigo_digitado`.
5. Espelho: `update` e `delete` numa linha migrada falham; `insert` de linha nova do par falha;
   `insert` sem `categoria_lsoft` falha; `delete from lsoft_parcelas` (todas, o importador antigo)
   falha inteiro; `lsoft_apagar_antigas(array[124], now())` não apaga linha do par.
6. `lsoft_carteira_por_cliente_empreendimento` não traz mais o Garden do 00000498.
7. Baixa manual: sem motivo falha; com data de amanhã falha; valor menor que o saldo vira
   `recebimento_parcial`; estorno; estorno repetido responde `ja_estornada`; estorno de um
   recebimento parcial numa parcela paga reabre a parcela; a chamada de `carteira_estornar_baixa`
   termina sem 42702.
8. Baixa do Asaas com `cobranca_id`; repetida responde `ja_aplicada`; a MESMA cobrança como
   `recebimento_parcial` também responde `ja_aplicada`.
9. `update carteira_parcelas`, `update carteira_contratos` e `delete from carteira_contrato_unidades`
   diretos (porta limpa) falham; `update`/`delete` em `carteira_baixas` falham.
10. `carteira_desfazer_subida_do_lsoft` recusa o cliente do caso 7; num cliente sem evento novo,
    desfaz, a pendência da subida sai junto e o cliente volta à view com o status de antes.
11. Correção: cancelar parcela aberta grava `carteira_correcoes`; cancelar parcela com dinheiro recusa;
    encerrar o lote principal recusa.

### 3.4 O que muda na carga do LSoft

- O apagamento das antigas passa a ser `rpc('lsoft_apagar_antigas')` e a contagem
  `rpc('lsoft_contar_antigas')` (hoje `.delete().in('categoria_lsoft').neq('sincronizado_em')` em
  `scripts/lsoft/importar-para-supabase.mjs:409` e a contagem em `:422`).
- O importador separa as linhas do CSV que são de par migrado e NÃO as grava; compara cada uma com as
  origens da carteira pela impressão digital (`lib/lsoft/impressao-digital.ts:69`) e grava a diferença
  em `lsoft_pos_migracao` com `.upsert(..., { onConflict: 'migracao_id,impressao_digital,ordinal,tipo',
  ignoreDuplicates: true })`.
- A conferência de trilha (`importar-para-supabase.mjs:323`) ignora a trilha das linhas migradas (sem
  isso as linhas de trilha dos 106 virariam "sem par" e a carga seria recusada em `:351`).
- **Os dois importadores.** O novo (497 linhas, com `executarCarga`) esbarra no trigger ao gravar ou
  apagar par migrado, e o `carga.ts` desfaz pela marca da carga (`lib/lsoft/carga.ts:140`). O antigo
  (255 linhas, no checkout principal `careli-hub`, branch `feat/portal-cecilio-replica` de 18/09, e nos
  worktrees espelho-celular, hierarquia-anexos, lote-planos, pedido-orfao, planos-como-mmendes,
  status-unico e temis-dados-panteon) faz `delete().neq('id', ...)` sem ler o erro e `upsert` sem
  `categoria_lsoft`: o DELETE é recusado inteiro (`lsoft_espelho_nunca_vazio`, e depois da F4 também
  pelas linhas migradas) e o primeiro lote de parcelas falha no NOT NULL. O espelho fica intacto. O que
  ele ainda faz antes de falhar é o `upsert` de `lsoft_clientes` (sobrescreve cadastro), risco que já
  existe hoje: o diário registra que o importador de 255 linhas não pode rodar.

---

## 4. A subida dos dados

### 4.1 Em duas etapas: o plano (só leitura) e a gravação (RPC por cliente)

**Etapa 1, o plano.** Script `scripts/carteira/montar-plano-garden.mjs`, só leitura. Lê:

- a planilha `OBSERVAÇÕES DO GARDEN S.xlsx` (aba OBS. LUCAS) e casa por nome com a regra de
  `scratchpad/garden/casar.cjs` mais os três casamentos confirmados na decisão 6;
- o espelho: `lsoft_parcelas` da categoria 124 (paginado com `order by id`, lotes de 1.000) e
  `lsoft_clientes` (`.in()` em lotes de 100);
- a ponte: `boletos_documentos` do `garden` e `hercules_unidades` do `39`;
- o mapa de lote antigo para novo, reproduzido com `loteDeHoje` de
  `scripts/boletos/carregar-garden.mjs:152-200` a partir das três planilhas do Downloads (143 lotes
  antigos convertidos, 0 sem conversão), congelado em `scripts/carteira/dados/garden-lote-antigo-para-novo.json`.

E escreve `scripts/carteira/dados/garden-plano-2026-09-29.json`: um objeto por cliente no formato do
`p_plano` (seção 3.2), a lista dos que ficam com o motivo e o relatório de conferência (grupos
colapsados, linhas repetidas, vencidas herdadas). Sem CPF e sem nome no arquivo. A regra de montagem é
uma função pura (`apps/hub/lib/carteira/plano-da-subida.ts`) com teste.

**Etapa 2, a gravação.** Script `scripts/carteira/subir-do-lsoft.mjs`. **Ensaio por padrão**: relê o
plano, remede o espelho e imprime cliente a cliente e o total, sem gravar. Com `--gravar`, chama
`rpc('carteira_subir_do_lsoft', { p_plano, p_autor })` um cliente por vez; cada chamada é uma
transação.

### 4.2 O algoritmo do plano, cliente a cliente

Para cada cliente `c` com OK na planilha (menos o 00000179):

1. **Lotes pela ponte (U).** Dígitos do `lsoft_clientes.cpf` iguais a `boletos_documentos.documento`
   (empreendimento `garden`); a unidade do boleto (`Q04 L13`) vira `hercules_unidades` do `39`. Se o
   documento é CPF, o nome no boleto e o nome no LSoft precisam ter 2 palavras (de mais de 2 letras) em
   comum. Nos 111 que têm ponte, só 00000524 e 00000538 não passam.
2. **Linhas repetidas entre clientes (P7).** Nos 141, linha com o mesmo lote antigo digitado,
   vencimento, valor e texto em clientes diferentes: fica com o cliente cujo boleto é daquele lote; o
   outro cliente fica. Casos: 00000440 (com 00000527) e 00000560 (com 00000059).
3. **Grupos de pagamento parcial (P8).** Linhas do cliente com o mesmo rótulo, vencimento e lote
   digitado viram UMA parcela. Com todas pagas: valor = nominal da série (o valor mais frequente das
   parcelas de linha única do mesmo cliente, lote digitado e total), ou a linha de maior valor quando
   não há série (entrada 001/001); a linha que carrega esse valor é a `principal` e as outras são
   `saldo_parcial`. Com uma paga e uma aberta: a paga é a `principal` e a aberta é
   `aberta_duplicada`, com pendência. Nos 106: 22 grupos, 50 linhas, 14 clientes; o relatório lista os
   5 grupos em que o nominal da série não é o valor de nenhuma linha.
4. **Séries.** Linhas agrupadas pelo lote antigo DIGITADO (quadra e lote sem zero à esquerda); sem
   quadra ou sem lote vira o grupo "vazio". **Série principal** = grupo com 24 ou mais parcelas de
   `parcela_total >= 24`.
5. **Contratos.** Uma série principal = um contrato, e todas as outras parcelas do cliente vão para ele.
   Duas séries principais = dois contratos, e cada grupo secundário vai para o contrato do mesmo lote
   digitado (00000531). Grupo secundário sem destino certo: o cliente fica.
6. **Lotes do contrato.** Os lotes antigos da série (o digitado e os citados no texto) passam pelo mapa:
   primeiro com a quadra digitada; se a chave não existe, pelo número do lote quando ele aparece uma
   vez só no mapa. Entra todo lote de U alcançado assim; se U tem um lote só e o mapa não o contradiz,
   ele entra (fonte `cpf_do_boleto`). Principal = o lote do lote antigo digitado. Lote de U que nenhuma
   série alcança (Q07 L28 do 00000431) fica fora e vai no relatório.
7. **Travas (o cliente fica):** U vazio (00000440, 00000487, 00000548, 00000599); nome do boleto não
   confere ou o mapa leva o lote da série principal para fora de U (00000524, 00000538); lote antigo da
   série vai para lote cujo boleto é de OUTRO documento (00000587); nenhuma parcela a vencer e boleto na
   competência corrente (00000086); permuta ou serviço no texto (nenhum dos 106); linha repetida de
   outro cliente (00000440, 00000560). Exceção P2: 00000493.
8. **Tipo de cada parcela:** `entrada` se o texto tem "ENTRADA", se `parcela_total = 1`, ou se é série
   de 2 a 12 com vencimentos a cerca de 30 dias um do outro (00000504, 00000505, 00000508, 00000518 e
   00000571: 15 parcelas, R$ 120.000, que a regra antiga chamava de anual); senão `anual` se o texto
   tem "ANUA" ou `parcela_total` entre 2 e 12; senão `mensal` se `parcela_total >= 24`; senão `outra`.
   Nos 106: 241, 702, 8.897 e 0. O relatório lista as séries de 2 a 12 que não são nem de 30 em 30 nem
   de 12 em 12 meses (00000507, 00000518, 00000531, 00000546, 00000568) para conferência.
9. **Pendências da subida:** `vencida_herdada_do_lsoft` para cada parcela aberta que venceu antes do
   primeiro dia do mês da subida (11 hoje) e `aberta_duplicada_no_espelho` (1).
10. **Lote incerto:** `unidade_incerta = true` quando algum lote do contrato tem
    `boletos_parcelas.unidade_incerta` (8 contratos).
11. **Chave de idempotência:** `lsoft:124:<codigo>:<quadra>/<lote da série principal>` (ou `vazio`).
12. **Conferência do cliente:** linhas, linhas abertas, nominal, aberto e recebido do espelho; parcelas,
    nominal e aberto da carteira.

**Resultado esperado do plano** (o teste da função pura prova com os casos abaixo como fixture, e o
script recusa gravar se o total não bater):

| | Esperado |
|---|---:|
| Clientes que sobem | 106 |
| Contratos | 107 |
| Lotes novos ligados | 111 (103 contratos com 1, 4 com 2) |
| Linhas do espelho | 9.868 (8.996 abertas, R$ 30.556.722,22; 872 pagas, recebido R$ 4.484.836,13) |
| Parcelas na carteira | 9.840 (22 grupos de 50 linhas viram 22 parcelas) |
| Em aberto | 8.995 parcelas, R$ 30.552.334,74 |
| Pagas | 845 parcelas, recebido R$ 4.484.836,13, nominal R$ 4.425.958,41 |
| Nominal do contrato | R$ 34.978.293,15 (espelho R$ 35.155.023,62 menos R$ 176.730,47) |
| Por tipo | 8.897 mensais, 702 anuais, 241 entradas |
| Contratos com lote incerto | 8 |
| Pendências da subida | 12 (11 vencidas herdadas, R$ 38.428,60; 1 aberta duplicada) |
| Clientes com OK que ficam | 10 |

Casos de fixture: 00000498 (texto "216 e 217", dois lotes, quatro grupos de parcial), 00000248, 00000561
e 00000567 (entrada em várias linhas), 00000521 (nominal da série diferente da maior linha), 00000059
(nominal da série fora das linhas), 00000517 (aberta duplicada), 00000513 (lote 93 da Q8 citado numa
série digitada na Q7; dois lotes em quadras diferentes), 00000531 (dois contratos), 00000543 (8
parcelas sem lote indo para a Q06 L18), 00000493 (P2), 00000571 (série curta vira entrada), 00000074,
00000552, 00000559 e 00000578 (quadra digitada diferente da planilha de boletos), 00000612 (lote que o
mapa não conhece, lote incerto), 00000431 (lote a mais pela ponte), e os que ficam: 00000440, 00000560,
00000524, 00000538, 00000587, 00000086.

### 4.3 A ordem de gravação, as somas que fecham e o que cada tela mostra

1. Ensaio (`node scripts/carteira/subir-do-lsoft.mjs`): imprime os 106 e o total; **pára** se o total
   não for o da tabela acima. Imprime também as 12 pendências da subida e a tabela abaixo, que vai ao
   time junto com a mensagem da subida.
2. Com OK do Lucas, `--gravar`. Cada RPC confere dentro da transação: (a) o espelho do par é o do
   plano; (b) cada linha do par está em exatamente uma parcela; (c) a carteira fecha com o espelho
   (recebido no centavo, aberto menos a aberta duplicada, nominal declarado).
3. Conferência total (apêndice A.7): 106 marcas vivas, 107 contratos, 111 vínculos, 9.840 parcelas,
   9.868 origens, 845 pagas com baixa `lsoft`, 12 pendências da subida e as somas; a tela LSoft mostra
   35 clientes do Garden.
4. Registro dos que ficam (seção 5) e entrada no diário `docs/operations/engineering-operations.md` com
   a frase de autorização do Lucas.
5. Com novo OK, liga o casador (seção 7.1).

**O que cada tela deve mostrar para o recorte dos 106** (números de 29/09/2026; o ensaio da F4 imprime
os do dia):

| Card | Tela LSoft, filtro Garden, véspera (só os 106) | Financeiro, chip Garden, dia seguinte, antes do casador | Por que difere |
|---|---:|---:|---|
| Carteira total | R$ 35.041.558,35 (aberto + recebido) | R$ 34.978.293,15 (nominal do contrato) | A LSoft soma o que entrou de fato; o Financeiro soma o valor do contrato, com as 50 linhas de parcial feitas 22 parcelas. |
| Recebido | R$ 4.484.836,13 (o que entrou) | R$ 4.425.958,41 (nominal das pagas) | O card do Financeiro é o valor do contrato; o que entrou aparece em "Bruto pago pelos compradores", R$ 4.484.836,13. A dica do card diz isso. |
| A receber / Vencido | aberto R$ 30.556.722,22, dos quais R$ 77.958,98 vencidos (24) | a receber R$ 30.478.763,24 e vencido R$ 73.571,50 (23) | R$ 4.387,48 é a linha aberta duplicada do 00000517. |
| Inadimplência | 0,26% (vencido sobre o aberto) | 1,64% (vencido sobre o previsto até hoje, R$ 4.495.006,09) | Fórmulas diferentes das duas telas. |
| Clientes / contratos | 106 | 106 compradores, 107 contratos | 00000531 tem dois contratos. |

O script é **idempotente**: cliente já migrado responde `ja_migrado` e segue.

### 4.4 Desfazer

- **Um cliente:** `rpc('carteira_desfazer_subida_do_lsoft', { p_cliente, p_categoria: 124, p_autor,
  p_motivo })`. Recusa se a carteira já tem baixa, recebimento ou estorno que não veio do LSoft, alguma
  correção, ou pendência que não nasceu da subida. Com o casador desligado até a conferência (seção
  7.1), a janela do desfazer só fecha por baixa manual ou correção. Fechada a janela, o caminho é a
  correção (seção 7.4). Apaga a carteira do par e as pendências da subida, marca a migração como
  desfeita (a linha fica, com autor e motivo), devolve status, observação e carimbo de validação, e
  grava a trilha. O cliente volta à tela na hora.
- **Todos:** o mesmo script com `--desfazer --motivo "..."`, cliente a cliente, em ensaio por padrão.
- **Nada no espelho foi apagado ou alterado pela subida.**

---

## 5. O registro do OK do time

Hoje os 141 clientes do Garden estão `status_validacao = 'pendente'`, sem `validado_em` e sem
observação. O registro fica no banco, com trilha em `lsoft_clientes_edicoes`:

| Quem | status_validacao | observacao_validacao | Por onde |
|---|---|---|---|
| 95 que sobem e só têm o Garden | `validado`, com `validado_em` e `validado_por` = "Time adm da Cecília, planilha OBS. LUCAS de 29/09/2026 (registrado por <autor>)" | "Garden validado (linha N) e migrado para a carteira do Panteon em dd/mm/aaaa." | Dentro da RPC da subida |
| 11 que sobem e têm outra carteira (P3) | não muda | "Garden validado (linha N) e migrado para a carteira do Panteon em dd/mm/aaaa. As outras carteiras continuam aqui para validar." | Dentro da RPC da subida |
| 24 com observação | `em_analise` | O texto da planilha, com a linha. O 00000276 leva as linhas 14 e 20. | Script `scripts/carteira/registrar-validacao-garden.mjs` (usa `salvarValidacaoDoLsoft`, `lib/lsoft/carteira.ts:545`) |
| 10 com OK que ficam | `em_analise` | "OK do time adm (planilha OBS. LUCAS, linha N), mas fica na integração: <motivo da tabela 2.3>." | O mesmo script |
| 00000558 | não muda (`pendente`) | "Não estava na planilha OBS. LUCAS de 29/09/2026." | O mesmo script |

As 12 pendências da subida vão ao time adm na mesma mensagem: as 11 vencidas herdadas (baixar pelo
botão, se foram pagas depois de 16/09, ou manter) e a 006/084 do 00000517. O script de registro tem
ensaio por padrão e só grava com `--gravar` (OK do Lucas), DEPOIS da subida.

---

## 6. O Financeiro

### 6.1 Como a rota junta as duas fontes

Hoje `app/api/incorporador/carteira/route.ts` lê o bruto, o líquido, os Indicadores e o Ato e Sinal só
do MySQL do C2X (`:466`). O Garden já aparece como chip no `cecilio-rocha`
(`lib/apolo/incorporador/produtos-do-portal.ts:169-179`) e abre zerado.

A regra nova: **cada empreendimento tem UMA fonte, nunca as duas somadas dentro dele**, e a fonte
Panteon não depende do C2X no ar.

1. Depois de resolver `codes` (`route.ts:390`), e ANTES de `idsDoC2xDasSiglasAoVivo` (`:412`): se a
   sessão é de incorporador (não comercial) e o portal está em `portalVeCarteiraDoPanteon(slug)` (lista
   nova em `lib/carteira/portais.ts`, hoje só `cecilio-rocha`), a rota traduz as siglas pelo cadastro
   do Panteon que já carregou (`carregarCadastroDeEmpreendimentos`, `hercules_empreendimentos.codigo` e
   `c2x_enterprise_id`), cruza com `idsDaSessao` e pergunta a `carteira_contratos` quais desses ids têm
   contrato. Esses vão para a fonte Panteon; o resto segue pelo C2X.
2. Sobrou nada para o C2X: a rota não chama o MySQL (nem `idsDoC2xDasSiglasAoVivo`, nem o bruto, nem
   o líquido do C2X). Isso também protege de contar em dobro se um dia alguém digitar venda do Garden
   no C2X.
3. Em "Todos", se o C2X cai, a rota responde a parte do Panteon com o aviso "parte da carteira está
   indisponível agora", em vez do 503. O 503 fica para quando não há nada do Panteon no recorte.
4. O resumo final é a **soma dos valores absolutos** e os percentuais são **recalculados** depois da
   soma: `delinquencyRate = overdueAmount / expectedToDate` somados (teste: C2X com 10% de 1.000 e
   Panteon com 0% de 9.000 dá 1%, não 5%). `clients`, `contracts` e `criticalContracts` somam direto.
5. **Política da fonte Panteon** sai de `apolo_enterprise_settings` direto (gestão de carteira; comissão
   nula), sem MySQL. Hoje a política só existe para id que o C2X devolve (`route.ts:448-459`,
   `politica-comercial.ts:460-463`), e o Garden nunca ganharia política mesmo depois do cadastro.

Leitura (`apps/hub/lib/carteira/leitura.ts`): `carteira_resumo_por_contrato` para o bruto e as unidades
(107 linhas); `carteira_parcelas_da_tela` com `situacao = 'paga'` ou com recebimento parcial em TODA
chamada (845 linhas hoje, o líquido e "Parcelas pagas" da aba Carteira dependem delas) e completa (9.840
linhas, 10 páginas) só com `?indicadores=1`; sempre `order by id` em páginas de 1.000.

### 6.2 A régua, lado a lado

| Campo da tela | C2X (`lib/apolo/carteira.ts`) | Panteon (`carteira_resumo_por_contrato`) |
|---|---|---|
| `totalContract` (VGV da linha) | soma do principal, status 5, 6 e 7 | `total_contrato`: nominal, menos canceladas |
| `paidAmount` | principal das pagas (status 5) | `pago_nominal + recebido_parcial_em_aberto` |
| `toReceiveAmount` | principal com status 6 | `a_vencer`: saldo das abertas que vencem hoje ou depois |
| `overdueAmount` | em aberto com juros e multa (`OVERDUE`) | `vencido`: saldo das abertas vencidas, sem encargo (P6) |
| `overdueInstallments`, `maxOverdueDays` | régua `OVERDUE` | abertas com vencimento antes de hoje (dia de São Paulo) |
| `expectedToDate` | principal com vencimento até hoje | `previsto_ate_hoje` |
| `recoveryAmount` | pago no mês corrente | `recebido_no_mes`: eventos de dinheiro não estornados do mês |
| `clients`, `contracts` | distintos por pedido e cliente | 106 compradores, 107 contratos |

Com isso `Recebido + A receber + Vencido = Carteira total` também no Garden (teste de fechamento).

### 6.3 A unidade que a tela recebe

`UnidadeDoPortal` (`route.ts:241`) ganha campos opcionais, e sai assim para o Panteon:

| Campo | Valor para um contrato do Panteon |
|---|---|
| `id` | `hercules_unidades.id` do lote principal (uuid). É o que o modal manda. |
| `pedidoId` | `carteira_contratos.id` (a chave do líquido) |
| `code` | códigos dos lotes: `GDN0710 + GDN0807` |
| `block` / `lot` | 1 lote: `Q07` / `10`. 2 lotes: `block` = `unidades_rotulo` ("Q07 L10 + Q08 L07") e `lot` nulo |
| `client` | `comprador_nome` |
| `empreendimento` | "Garden" (`nomePorCode`) |
| `imobiliaria`, `faturadoAt`, `contractCode` | `null` |
| `temContrato` | `null` (sem dado), não `false` |
| `origem` (novo) | `"panteon"` |
| `lotesAntigos`, `codigoLsoft` (novos) | `lotes_antigos` e `lsoft_cliente_codigo` do contrato |
| `avisos` (novo) | lista curta: "Carteira migrada do LSoft em 29/09/2026", "Lote a confirmar", "Contrato cita também o lote antigo 417", "1 parcela vencida herdada do LSoft, a conferir" |

Na tabela: os avisos saem como texto curto na segunda linha da célula (no celular não há `title`), e o
lote antigo e o código do LSoft também; a busca (`TelaCarteira.tsx:289-293`) passa a olhar todos os
lotes, os lotes antigos e o código do LSoft. O cabeçalho, com o recorte só na fonte Panteon, diz
"N contratos, R$ X de carteira do Garden" (o 39 é `carteira_administrada = false` no cecilio-rocha, e
"administrada pela Careli" seria falso). A planilha por unidade (`planilha-da-carteira-por-unidade.ts`)
ganha a coluna "Avisos" e deixa "Contrato assinado" vazio quando `temContrato` é nulo.

### 6.4 O modal de parcelas

`app/api/incorporador/parcelas/route.ts:39` hoje recusa o que não é número. No ramo uuid
(`tipoDoIdDeUnidade`, `escopo.ts:341`), ANTES de ler qualquer dado: exige
`portalVeCarteiraDoPanteon(auth.sessao.slug)` e `!ehPortalComercial(auth.sessao.tipo)` (as mesmas travas
do Financeiro), depois `unidadeNoEscopo` e, por fim, que o `enterprise_id` do contrato vivo do lote
esteja no alcance da sessão; qualquer falha responde `foraDoEscopo()`. Sem isso, a mmendes (39 no
vínculo, 2 usuários ativos) e o coordenador da Gurgel (39 no vínculo do usuário) leriam o cronograma do
comprador da Cecília por um uuid que o próprio portal entrega (`unidades-do-panteon.ts:98`).

`carregarParcelasDaUnidadeNoPanteon(uuid)` entrega no formato `ApoloUnitInstallment` (`carteira.ts:378`):
`status` liquidada, vencida ou a vencer; `amount` = nominal; `paidAmount` = `valor_pago`; `number` =
"7 de 84"; `type` = Entrada, Mensal ou Anual; uma linha "recebido parcial R$ X em dd/mm" quando há
parcial; "em conferência pela Careli" quando `em_conferencia`; `invoiceUrl` = `null` nesta fase. A rota
do contrato continua 404 para uuid, e a tela não mostra o botão (`temContrato` nulo).

### 6.5 Indicadores, extrato e xlsx

`carteiraLiquidaDoIncorporador` (`lib/apolo/incorporador/carteira-liquida.ts:924`) ganha
`linhasExtras: LinhaCruaDaCarteira[]`, somadas às do C2X ANTES de `agregarPorPedido` (`:450`) e de
`montarIndicadores` (`:535`). Muda também:

- **A volta cedo** por `codes` vazio (`:940-957`) só vale quando também não há `linhasExtras`. Com o chip
  Garden sozinho, `codes` do C2X fica vazio e hoje as linhas do Panteon seriam descartadas
  (`indicadores: null`, o xlsx respondendo 503 em `route.ts:526-532`).
- **Perfil:** `perfilDaParcela` (`:311-321`) chama "entrada" e "anual" de `outro`, e `outro` cai na
  fórmula da entrada com o motivo "Política comercial incompleta no C2X". A linha crua ganha `perfil` e
  `perfil_rotulo` opcionais: mensal e anual = `parcela` (financiamento, gestão de carteira); entrada =
  `sinal` (rateio da entrada), até a pergunta 2; o rótulo do extrato vem do tipo da carteira ("Mensal",
  "Anual", "Entrada"), o mesmo do modal. O motivo em `liquido-incorporador.ts:186` perde o "no C2X".
- **Dia:** `agregarPorPedido` e `montarIndicadores` recebem `hoje` calculado por `hojeNaCasa`
  (`lib/guardian/hoje-na-casa.ts`) na rota, para as duas fontes. Hoje usam `isoDia` em UTC (`:504-506`):
  entre 21h e meia-noite as parcelas do dia viram "vencida" nos Indicadores e "a vencer" nos cards.
- **A linha crua do Panteon:** `ar_id` = contrato, `unit_id` = lote principal, `unit_block`/`unit_lot`
  do lote principal e `unidade` = `unidades_rotulo`, `enterprise_code` = `GDN`, `parcel_type` = tipo,
  `valor_previsto` = nominal (ou o saldo), `valor` = `valor_pago`, `payment_date` = `pago_em`,
  `status_id` = 5, 7 ou 6 pela régua de São Paulo. Parcela aberta com recebimento parcial vira DUAS
  linhas: uma paga (o parcial, `payment_date` = `ultimo_recebimento_em`) e uma aberta (o saldo). As
  linhas do Panteon não contam no teto de 30.000 do C2X (`:300`).
- **Líquido que não dá para apurar não é zero:** quando `semLiquido` é igual a `parcelasPagas`, a
  unidade sai com `liquido: null`, e o bloco "O que já entrou para você" (`TelaCarteira.tsx:868-887`)
  troca o número por "Líquido não apurado: gestão de carteira não cadastrada". Hoje ele mostraria
  "Seu líquido recebido R$ 0" para quem recebeu R$ 4,5 mi, e o Excel gravaria 0.

### 6.6 O que fica sem dado, e como a tela diz

| Sem dado | Por quê | O que a tela mostra |
|---|---|---|
| Data de faturamento | O LSoft não tem a etapa "Faturado" | Traço, e o aviso "carteira migrada do LSoft" |
| Contrato assinado | Não há contrato do Garden no D4Sign nem na Têmis | Sem o botão do PDF; no Excel, célula vazia |
| Imobiliária | O LSoft tem um único CNPJ de imobiliária para 140 clientes | Coluna vazia |
| Líquido | `gestao_carteira_percentual` do 39 é nulo | "Líquido não apurado: gestão de carteira não cadastrada" no bloco, "-" na coluna e célula vazia no Excel |
| Juros e multa no vencido | O LSoft não tem os campos | "Garden: vencido nominal, sem encargos" no card de vencido |
| Link do boleto no modal | `boletos_pagamentos` não guarda a fatura | Sem o link; fatia opcional F8 |
| Ato e Sinal (modo coordenador) | O LSoft não separa Ato e Sinal | A fonte Panteon só entra na sessão de incorporador do cecilio-rocha |

### 6.7 O que continua lendo só o C2X (divergência aceita pela decisão 6)

CRM do portal (lista e ficha), pessoa no escopo, Apolo interno (CarteiraTab, CRM 360, extratos), Hades
(overview, fila, régua), BI e o painel de vendas. Na aba CRM do cecilio-rocha entra uma linha de aviso:
"Garden: os compradores aparecem por enquanto só no Financeiro". O recado vai também na mensagem ao time
no dia da subida (o portal não mostra o changelog).

---

## 7. A baixa

### 7.1 Pelo Asaas: o casador

**Quando roda:** de hora em hora, dentro do cron que já existe (`/api/boletos/pagamentos/sincronizar`,
`vercel.json`: `10 * * * *`), depois dos upserts. **O webhook não aplica baixa**: continua só gravando o
retrato em `boletos_pagamentos`. Motivo: ele se autentica com UM token para as 7 contas
(`webhook/route.ts:46-47`), e empreendimento, unidade e competência vêm do `externalReference` do corpo
(`pagamento-do-asaas.ts:115-129`); um POST forjado com `?conta=on-sky` e
`boleto:garden:Q04-L13:2026-10` quitaria a parcela de outubro.

**A chave:** o casador só trabalha o empreendimento que está em `carteira_casador_ligado`. A linha do
Garden entra depois da conferência A.7 da subida, com OK próprio do Lucas. Até lá o retrato continua
sendo gravado, e a fila recupera tudo quando ligar.

**A fila, e não a listagem do Asaas:** a cada rodada o casador lê em `boletos_pagamentos` todas as
linhas dos empreendimentos ligados, de QUALQUER competência, e processa as que ainda não têm efeito:
paga ou desfeita sem evento em `carteira_baixas` nem pendência daquela cobrança; aberta ou vencida numa
parcela já paga, sem pendência. Hoje são 141 linhas. A varredura do Asaas passa a pedir a competência
do mês, a do mês anterior e a de dois meses atrás: a rede de hoje só cobre o mês corrente
(`sincronizar/route.ts:24`, `:70`, `:94-95`), e o boleto de outubro pago em novembro, com o webhook
perdido, nunca chegaria.

**Antes de gravar qualquer coisa, relê na API:** `GET /payments/{id}` com a chave da conta que emite
aquele empreendimento (`EMPREENDIMENTOS_DE_BOLETO`, `lib/apolo/boletos/empreendimentos.ts:64-146`). Só
aplica se a conta gravada no retrato é a do empreendimento e se situação, `externalReference` e valor
batem; senão, pendência `nao_confirmada_no_asaas` e nada muda.

**Casamento (função pura `apps/hub/lib/carteira/casar-pagamento.ts`, com teste):**

1. Acha o contrato por `carteira_contrato_unidades (boleto_empreendimento, boleto_unidade)` vivo. Lote
   sem contrato (quem ficou na integração, gente fora do LSoft, a Q07 L28): ignora, sem pendência.
2. Candidatas = parcelas não canceladas do contrato com vencimento no mês da competência. **Trava de
   valor:** fica a candidata cujo valor esperado da cobrança (nominal dividido pelo número de lotes do
   contrato) está entre 0,9 e 1,5 vez do `valor_cobrado`. Uma candidata na faixa: é ela. Duas: a
   sequência desempata (1 = mensal, 2 ou mais = a outra). Nenhuma ou mais de uma: pendência `ambigua`
   (ou `sem_parcela` se o mês não tem parcela). Hoje o Garden só emitiu sequência 1, e a entrada
   8/8 do 00000589 foi cobrada com sequência 1 em setembro; com a trava, o boleto de R$ 30.000 de
   novembro dele cai na ENTRADA INICIAL, e não na mensal de R$ 2.236,85.
3. Cobrança paga (`estaPago`):

| A parcela está | E | O casador faz |
|---|---|---|
| aberta, contrato de 1 lote | | `baixa` com o valor e a data do Asaas |
| aberta, contrato de N lotes | já existem eventos de dinheiro de N-1 cobranças dos outros lotes nessa competência | `baixa` |
| aberta, contrato de N lotes | ainda não | `recebimento_parcial` |
| paga por baixa `lsoft` | valor pago igual à soma das cobranças pagas dos lotes (até R$ 0,01 por lote) e data da baixa não anterior ao pagamento no Asaas menos 3 dias | `confirmacao` |
| paga por baixa `lsoft` | fora disso | pendência `pago_em_dobro` |
| paga por baixa `manual`, ou `asaas` de outra cobrança | | pendência `pago_em_dobro` |

   A decisão entre `baixa` e `recebimento_parcial` olha os eventos JÁ gravados, nunca o retrato: com A e
   B pagas na mesma rodada, A vira parcial e B completa. As linhas são processadas por data de
   pagamento e `cobranca_id`.
4. Cobrança devolvida ou contestada (`foiDesfeito`): se ela gerou `baixa` ou `recebimento_parcial`,
   estorno com origem `asaas` (a parcela reabre) e pendência `estorno_no_asaas`; se gerou só
   confirmação, pendência `estorno_no_asaas` (a baixa do LSoft foi a mesma entrada de dinheiro, e a
   Careli decide o estorno); se não gerou nada, `estorno_sem_baixa`.
5. Cobrança vencida ou pendente numa parcela já paga: pendência `boleto_em_aberto_carteira_paga`, para a
   Careli cancelar a cobrança no Asaas.

**Idempotência:** índice único por `cobranca_id` para todo evento que não é estorno (a mesma cobrança
move dinheiro ou confirma uma vez só); um estorno por baixa; pendência única por (cobrança, motivo).
Rodar de novo não duplica nada.

**Autor:** "Asaas", origem `sistema`.

**Primeira rodada esperada (2026-09, só os 106):** 91 confirmações; 7 parcelas baixadas por 11
cobranças (4 recebimentos parciais e 7 baixas; R$ 26.479,89 pagos, R$ 25.428,60 nominal); 3 pendências
(2 `boleto_em_aberto_carteira_paga` do 00000417 e do 00000421, 1 `pago_em_dobro` do 00000290).

### 7.2 Manual

**Para quê:** pagamento feito por fora do boleto (PIX direto, dinheiro, permuta aprovada), decisão 2.

**Quem pode:**

- Interno: `authorizeApoloWrite` (admin, leader, operator; `lib/apolo/auth.ts:61`). Autor = nome do
  usuário, origem `careli`. Rota `POST /api/carteira/parcelas/[id]/baixa`.
- Portal: sessão de incorporador do `cecilio-rocha` (`portalVeCarteiraDoPanteon`, não comercial), com a
  parcela de um contrato cujo empreendimento está no alcance da sessão, conferido ANTES de ler a
  parcela. Autor = `"<usuário> (cecilio-rocha)"`, origem `incorporador`. Rota
  `POST /api/incorporador/carteira/baixa`. Parcela de outro loteador responde 404. Quem, dentro do
  portal, pode baixar é a pergunta 4; o padrão é todo usuário ativo do cecilio-rocha (como a tela LSoft
  hoje), e cada baixa do portal abre a pendência `baixa_manual_do_portal` para a Careli conferir.

**O que pede:** valor (padrão: o SALDO, `valor - valor_pago`), data (padrão: hoje em São Paulo, nunca no
futuro) e motivo (obrigatório). Valor abaixo do saldo registra recebimento parcial; para quitar com
desconto, a pessoa marca "quitar com desconto" e o motivo diz qual.

**Desfazer:** "Desfazer baixa" com motivo obrigatório, pela `carteira_estornar_baixa`. O portal só
desfaz baixa manual feita pelo portal; o interno desfaz baixa manual e baixa `lsoft`; a baixa do Asaas,
à mão, só o papel admin (`authorizeApoloAdmin`), para o caso de erro. A devolução real vem do casador.

**Onde fica o botão:** no modal de parcelas do Financeiro (portal) e no bloco "Migrado para a carteira"
da ficha na tela LSoft (interno e portal). Baixa manual numa competência com boleto em aberto gera, na
rodada seguinte do casador, a pendência para cancelar a cobrança.

### 7.3 As pendências

Tudo o que só uma pessoa resolve cai em `carteira_pendencias`: as da subida (vencida herdada, aberta
duplicada), as do casador (sem parcela, ambígua, não confirmada, boleto em aberto, pago em dobro,
estorno) e as baixas manuais do portal.

- **Interno (resolve):** bloco "Pendências da carteira" no topo da tela LSoft Integração com o filtro
  do empreendimento: motivo, contrato, lote, competência, valor, e as ações "resolvida" e "ignorada",
  com autor e observação (`resolvido_por`, `resolvido_em`). Rota `GET/POST /api/carteira/pendencias`,
  `authorizeApoloWrite`. É a Careli quem cancela cobrança no Asaas (a aba Boletos é interna).
- **Portal (vê):** no modal de parcelas, a parcela com pendência aberta mostra "em conferência pela
  Careli"; na tabela, o aviso da unidade diz quantas.
- A primeira rodada do casador só roda com esse bloco no ar (F7b antes da F4).

### 7.4 Correção (depois que o desfazer fecha)

`carteira_corrigir_parcela` (cancelar, reabrir, mudar valor ou vencimento, mover para outro contrato do
mesmo empreendimento) e `carteira_corrigir_contrato` (encerrar lote, ligar lote, trocar o principal,
mudar a situação para quitado ou distratado). Sempre com autor e motivo, e cada uma grava o antes e o
depois em `carteira_correcoes`. Nesta fase não há tela: o script `scripts/carteira/corrigir.mjs` roda em
ensaio por padrão e grava com `--gravar`, com OK do Lucas a cada uso (é escrita no banco). Cobre os
casos que o risco 5 prevê: lote incerto, segundo lote antigo, anual digitada no lote errado.

---

## 8. A tela LSoft Integração depois da subida

- **Some:** o Garden dos 106. A lista do Garden cai de 141 para 35 clientes, e o saldo em aberto do
  Garden na tela cai de R$ 43.727.178,97 para R$ 13.170.456,75. As duas views leem
  `lsoft_parcelas_no_espelho`.
- **Continua:** os 35 que ficam, com observação e status novos (seção 5); o patrimônio (categoria 17) e
  as outras carteiras de todo mundo.
- **Os 11 com outras carteiras** continuam na lista, só com Giant Towers, patrimônio etc. Na ficha,
  `lerFichaDoLsoft` (`lib/lsoft/carteira.ts:427`) separa as linhas vivas do bloco somente leitura
  "Migrado para a carteira do Panteon em dd/mm", com a situação lida da carteira e o botão de baixa.
- **Filtro "Migrados":** lista os 106 a partir de `lsoft_migracoes`. Cada linha mostra os valores de
  `carteira_resumo_por_contrato` somados por cliente, com o selo "na carteira desde dd/mm", e os cards
  com esse filtro leem a mesma fonte (sem isso, apareceriam zerados, porque as views não têm mais as
  linhas deles).
- **Os cards de validação:** o bloco "Cadastro para o C2X" (`CarteiraLsoft.tsx:458-475`, herança da POC)
  vira "Validação do time", sem "C2X". "Validados" deixa de contar só a lista (`:178`), que perde os
  migrados, e passa a contar por `lsoft_clientes` e pelas marcas: com o filtro Garden, "106 migrados
  para a carteira em dd/mm" e "35 na integração (0 validados, 34 em análise, 1 pendente)".
- **Edição travada:** `salvarParcelaDoLsoft` (`carteira.ts:706`) recusa linha migrada com a mensagem
  "Esta parcela foi migrada para a carteira do Panteon em dd/mm; a baixa agora é na carteira". O trigger
  é a rede.
- **Exportação xlsx:** `lerParcelasDoRecorte` (`lib/lsoft/planilha-da-carteira.ts:200`, lê
  `lsoft_parcelas` cru em `:210`) passa a ler `lsoft_parcelas_no_espelho`, e o patrimônio (`:288`)
  também.
- **Prontidão dos boletos:** `app/api/boletos/prontidao/route.ts` passa a somar os
  `comprador_documento` dos contratos do empreendimento na carteira do Panteon.
- **Trilha, MOST e documentos:** ficam onde estão. Nada é apagado.
- **Carga do LSoft:** seção 3.4. O 00000587 continua travando a carga do Garden (PAN-122).

---

## 9. Fatias de implementação, em ordem

Regra de todas: `npm --prefix apps/hub run check-types` e `npm --prefix apps/hub run test` verdes
(conferindo também a linha de "Errors" do vitest, que fica fora da contagem); nenhum arquivo em duas
fatias paralelas; o `lib/changelog/changelog.ts` é escrito só por quem publica, no deploy.

| # | Fatia | Arquivos | Depende de | Testes que provam | OK do Lucas |
|---|---|---|---|---|---|
| F0 | O plano de subida (só leitura) | `scripts/carteira/montar-plano-garden.mjs`, `apps/hub/lib/carteira/plano-da-subida.ts`, `apps/hub/lib/carteira/plano-da-subida.test.ts`, `scripts/carteira/dados/garden-lote-antigo-para-novo.json`, `scripts/carteira/dados/garden-plano-2026-09-29.json` | nada | Fixtures da seção 4.2; o script reproduz 106/107/111/9.868/9.840 e as somas | Nenhum (leitura) |
| F1 | Migration 0199 | `packages/database/migrations/0199_a_carteira_mora_no_panteon.sql`, `packages/database/migrations/0199_a_carteira_mora_no_panteon.ensaio.sql` | nada | Ensaio 3.3 ANTES de aplicar (transação desfeita); conferência por objeto; `get_advisors` | **Rodar o ensaio** (DDL em transação desfeita) e **aplicar** |
| F2 | A carga do LSoft respeita a marca | `scripts/lsoft/importar-para-supabase.mjs`, `apps/hub/lib/lsoft/carga.ts`, `apps/hub/lib/lsoft/carga.test.ts`, `apps/hub/lib/lsoft/pos-migracao.ts`, `apps/hub/lib/lsoft/pos-migracao.test.ts` | F1 | Par migrado não é gravado e vira `lsoft_pos_migracao` (upsert idempotente); apagar antigas não toca o par; trilha do par não trava a carga; simulação do importador de 255 linhas (DELETE total com erro ignorado, depois INSERT sem categoria) deixa o espelho intacto | Merge; carga só com novo OK |
| F3 | A tela LSoft depois da subida | `apps/hub/lib/lsoft/carteira.ts`, `apps/hub/lib/lsoft/planilha-da-carteira.ts`, `apps/hub/lib/lsoft/filtro-da-tela.ts`, `apps/hub/lib/lsoft/filtro-da-tela.test.ts`, `apps/hub/modules/lsoft/CarteiraLsoft.tsx`, `apps/hub/modules/lsoft/api.ts`, `apps/hub/app/api/lsoft/carteira/route.ts`, `apps/hub/app/api/incorporador/lsoft/route.ts`, `apps/hub/app/api/boletos/prontidao/route.ts` | F1 | Filtro "Migrados" com os valores da carteira; cards de validação por `lsoft_clientes` e marcas (depois da subida: 106 migrados, 35 na integração); `salvarParcelaDoLsoft` recusa linha migrada; exportação sem o Garden migrado | **Deploy** |
| F5a | Funções puras do Financeiro | `apps/hub/lib/carteira/adaptador-da-tela.ts`, `apps/hub/lib/carteira/adaptador-da-tela.test.ts`, `apps/hub/lib/apolo/liquido-incorporador.ts` | nada | `somarResumos` recalcula a inadimplência; fechamento Recebido + A receber + Vencido = total; parcial vira linha paga + linha aberta; perfil e rótulo iguais no modal, no extrato e no xlsx; `semLiquido == parcelasPagas` dá `liquido: null`; política do Panteon pela gestão do settings; status pela régua de São Paulo às 22h | Nenhum (sem deploy sozinha) |
| F5b | Rota do Financeiro e líquido | `apps/hub/lib/carteira/portais.ts`, `apps/hub/lib/carteira/leitura.ts`, `apps/hub/app/api/incorporador/carteira/route.ts`, `apps/hub/lib/apolo/incorporador/carteira-liquida.ts`, `apps/hub/lib/apolo/incorporador/carteira-liquida.test.ts` | F1, F5a | Chip Garden sozinho: sem chamada ao MySQL, `indicadores` não nulo, xlsx com 9.840 linhas, "Parcelas pagas" 845, cards = soma da tabela = total do extrato; "Todos" com o C2X fora responde o Panteon com aviso; gestão cadastrada no 39 faz o líquido aparecer sem C2X | **Deploy** (com F5c e F5d) |
| F5c | Modal de parcelas | `apps/hub/app/api/incorporador/parcelas/route.ts`, `apps/hub/lib/carteira/parcelas-da-unidade.ts`, `apps/hub/lib/carteira/parcelas-da-unidade.test.ts` | F1, F5a | uuid do Garden com sessão cecilio-rocha responde; com sessão mmendes e com sessão comercial (Gurgel) responde 404; parcial e "em conferência" aparecem | **Deploy** (com F5b e F5d) |
| F5d | Tela do Financeiro | `apps/hub/modules/incorporador/TelaCarteira.tsx`, `apps/hub/lib/apolo/incorporador/planilha-da-carteira-por-unidade.ts`, `apps/hub/lib/apolo/incorporador/planilha-da-carteira-por-unidade.test.ts`, `apps/hub/modules/incorporador/TelaCrm.tsx` | F5b | Garden sem gestão não mostra R$ 0 em card, tabela, modal nem Excel; 00000513 com "Q07 L10 + Q08 L07" e achado por "Q08"; busca por lote antigo e por código do LSoft; Excel com "Avisos" e "Contrato assinado" vazio; cabeçalho "carteira do Garden"; aviso na aba CRM | **Deploy** (com F5b e F5c). Pode ir antes da F4: sem contrato, nada muda |
| F6 | O casador do Asaas (desligado) | `apps/hub/lib/carteira/casar-pagamento.ts`, `apps/hub/lib/carteira/casar-pagamento.test.ts`, `apps/hub/lib/carteira/aplicar-pagamentos.ts`, `apps/hub/lib/carteira/aplicar-pagamentos.test.ts`, `apps/hub/lib/apolo/boletos/emissao.ts`, `apps/hub/app/api/boletos/pagamentos/sincronizar/route.ts` | F1 | 1 lote; 2 lotes com A parcial numa rodada e B na seguinte; A e B na mesma rodada; mesma cobrança não move dinheiro duas vezes; parcela paga pelo Asaas por outra cobrança vira pago em dobro; estorno de parcial reabre; 00000417 pago por fora e boleto pago depois vira pago em dobro; 00000290; 00000555 com boleto de outubro; 00000589 em novembro cai na entrada; valor fora da faixa vira ambígua; retrato forjado (API diz outra coisa, ou conta errada) não aplica; competência antiga paga no mês seguinte entra pela fila; sem a chave, nada é gravado | **Deploy** (o casador nasce desligado) |
| F7a | Baixa manual | `apps/hub/lib/carteira/baixa-manual.ts`, `apps/hub/lib/carteira/baixa-manual.test.ts`, `apps/hub/app/api/incorporador/carteira/baixa/route.ts`, `apps/hub/app/api/carteira/parcelas/[id]/baixa/route.ts`, `apps/hub/modules/incorporador/TelaCarteira.tsx` (modal) | F1, F5c, F5d | Portal fora do cecilio-rocha e sessão comercial respondem 404; parcela de outro loteador 404; motivo obrigatório; data futura recusada; valor abaixo do saldo vira parcial; portal não desfaz baixa do interno nem do Asaas; estorno de baixa do Asaas só admin | **Deploy** |
| F7b | Pendências e bloco migrado | `apps/hub/lib/carteira/pendencias.ts`, `apps/hub/lib/carteira/pendencias.test.ts`, `apps/hub/app/api/carteira/pendencias/route.ts`, `apps/hub/modules/lsoft/CarteiraLsoft.tsx` (pendências e bloco migrado da ficha) | F3, F7a | Lista por empreendimento; resolver e ignorar gravam autor e data; o bloco migrado baixa pela rota da F7a | **Deploy** |
| F4 | A subida dos dados | `scripts/carteira/subir-do-lsoft.mjs`, `scripts/carteira/registrar-validacao-garden.mjs`, `scripts/carteira/corrigir.mjs`, `docs/operations/engineering-operations.md` | F0, F1, F3, F5b, F5c, F5d, F6, F7a e F7b em produção | Ensaio com os totais da seção 4.2 e a tabela das telas (4.3); conferência A.7; tela LSoft com 35 do Garden; Financeiro com 107 contratos | **Gravar no banco** (subida, registro da validação) |
| F6-on | Ligar o casador do Garden | linha em `carteira_casador_ligado` (sem arquivo) | F4 conferida (A.7) | Primeira rodada: 91 confirmações, 4 parciais e 7 baixas, 3 pendências | **Gravar no banco** (ligar a chave) |
| F8 (opcional) | Link do boleto no modal | `packages/database/migrations/0200_o_pagamento_guarda_a_fatura.sql` (número conferido na hora), `apps/hub/lib/apolo/boletos/pagamento-do-asaas.ts`, `apps/hub/lib/carteira/parcelas-da-unidade.ts` | F5c, F6 | `invoiceUrl` gravado no upsert da varredura; modal mostra o link | Aplicar migration e deploy |

Ordem: **F0, F1 e F5a** primeiro; depois **F2, F3, F5b, F5c e F6 em paralelo** (arquivos disjuntos);
**F5d**; **F7a**; **F7b**; tudo isso em produção antes da **F4** (o cliente não some da integração sem
aparecer no Financeiro, e o pagamento por fora tem onde ser lançado desde o primeiro dia); **F4**;
conferência A.7; **F6-on**; **F8** quando couber.

---

## 10. Riscos e perguntas

### Riscos

1. **Número da migration.** O 0198 já foi usado hoje; o 0199 é conferido de novo na hora de aplicar.
2. **O espelho muda entre o plano e a subida.** A RPC aborta o cliente e o plano é refeito.
3. **Baixa feita no Access depois de 16/09** não chega (decisão 4). As 11 vencidas herdadas vão com
   pendência e aviso até o time confirmar; o resto depende da pergunta 1.
4. **O mapa de conversão mora no Downloads.** A F0 congela no repositório.
5. **Lote incerto em 8 contratos** e segundo lote antigo sem lote novo em 15: sinalizado na tela e
   corrigível pela seção 7.4.
6. **P2 (00000493)**: se o time disser que as 2 anuais do lote 16/297 são de outro negócio, a correção
   move ou cancela as duas.
7. **Divergência entre telas** (seção 6.7), com aviso na aba CRM.
8. **Tempo da rota do Financeiro** com Indicadores: 10 páginas de 1.000 linhas, dentro de
   `maxDuration = 30`. A F5b mede no preview.
9. **Anuais e entradas de dezembro e janeiro** (100 parcelas, R$ 1.149.023,14) sem boleto próprio: ou
   ficam vencidas até alguém baixar, ou saem com sequência 2 (pergunta 5).
10. **CPF na carteira:** RLS fechada, revoke em tabela, view e função; leitura só por service role.
11. **O importador de 255 linhas** continua em 8 checkouts; a migration o faz falhar sem estrago, mas
    ele ainda sobrescreve cadastro de `lsoft_clientes` antes de falhar. O diário diz que não pode rodar.
12. **A carga do Garden continua travada pelo 00000587** (PAN-122); a subida não depende dela.

### Perguntas que só o Lucas responde

1. **Depois da subida, o time para de dar baixa do Garden no Access?** Padrão: sim; para os 106, a baixa
   passa a ser só pelo Asaas e pelo botão, e o Access vira histórico.
2. **A política do Garden** (`apolo_enterprise_settings` do 39 está nula): cadastrar a % de gestão de
   carteira (vale para mensal e anual) e dizer como a entrada rateia, ou deixar a tela dizendo "líquido
   não apurado"? Padrão: deixar dizendo, até o cadastro.
3. **Os 10 OK que não sobem** (00000440, 00000560, 00000487, 00000548, 00000599, 00000524, 00000538,
   00000086, 00000587, 00000179): o time indica o lote ou diz de quem são as linhas repetidas (a
   entrada 2/2 do lote 4/247 é do ATHOS ou do JFB? As 7 anuais do lote 12/402 são do WOLMERT, do URBANO
   ou dos dois?) e eles sobem pelo mesmo script depois, cliente a cliente? Padrão: sim.
4. **Quem baixa no portal:** os 10 usuários ativos do cecilio-rocha (o portal não tem papel por
   usuário) ou uma lista nomeada? Padrão: todos, com motivo obrigatório e cada baixa na fila de
   conferência da Careli.
5. **Anual e entrada no mesmo mês da mensal:** emitir boleto com sequência 2 a partir de dezembro (a
   aba Boletos já emite, o Vale do Sol tem 2 em setembro), ou o time baixa à mão as 100 parcelas de
   dezembro e janeiro? Padrão: sequência 2.

---

## 11. Críticas recebidas e resposta

Cada crítica foi conferida no código ou no banco em 29/09/2026 (apêndice A). Todas procedem; as
marcadas "com ajuste" foram aceitas com a correção que a medição pediu.

| # | Lente | Crítica | Resposta |
|---:|---|---|---|
| 1 | dinheiro | Pagamento parcial vira parcelas a mais e infla o contrato | Aceita, com ajuste: 22 grupos, 50 linhas, 14 clientes, R$ 171.762,22 (P8, `carteira_parcela_origens`). O valor da parcela é o nominal da série, não a maior linha, porque em 5 grupos a maior é o valor reajustado (R$ 580,77). |
| 2 | dinheiro | Confirmação sem conferir se é o mesmo pagamento | Aceita, com ajuste: a regra de data proposta recusaria 91 das 92, porque a baixa da tela é datada de 22/09, depois do Asaas. Vale valor igual e data não anterior ao Asaas menos 3 dias. Achou o 00000290 (pago em dobro). A linha 198 antiga estava errada: a baixa do 417 e do 421 veio do Access. |
| 3 | dinheiro | Idempotência por (cobrança, evento) soma duas vezes | Aceita: índice único por cobrança para todo evento que não é estorno; decisão pelos eventos já gravados; pago pelo Asaas por outra cobrança vira pago em dobro; estorno de parcial reabre a parcela. |
| 4 | dinheiro | A rede só cobre o mês corrente | Aceita: o casador trabalha a fila de `boletos_pagamentos` de qualquer competência, e a varredura pede m, m-1 e m-2. |
| 5 | dinheiro | Casamento sem trava de valor | Aceita: faixa de 0,9 a 1,5 vez do valor esperado; o 00000589 de novembro cai na entrada. Dezembro e janeiro viram a pergunta 5. |
| 6 | dinheiro | Parcela aberta e paga ao mesmo tempo | Aceita: 00000517, a linha aberta vira origem `aberta_duplicada` com pendência. Único caso nos 106. |
| 7 | dinheiro | Entrada 2/2 do lote 4/247 em dois clientes | Aceita: regra P7. A mesma busca achou as 7 anuais do URBANO idênticas às do WOLMERT; o 00000560 passa a ficar. |
| 8 | dinheiro | F6 no ar antes da F4 fecha a janela do desfazer | Aceita: chave `carteira_casador_ligado`, ligada só depois da A.7 (F6-on). |
| 9 | dinheiro | Vencidas antes de setembro sem conferência | Aceita: 11 (a 12a era a aberta duplicada do 517), R$ 38.428,60, com pendência e aviso até o time confirmar. |
| 10 | dinheiro | Recebimento parcial fora dos buckets | Aceita: uma régua só (saldo no a vencer e no vencido, parcial no recebido, mês pelos eventos) e teste de fechamento. |
| 11 | banco | Importador antigo passa pelo trigger com categoria nula | Aceita: `categoria_lsoft` NOT NULL, trigger recusa nulo e um DELETE que esvaziaria o espelho é recusado (sem isso, antes da F4 o antigo apagaria tudo e falharia). Teste na F2 e nota no diário. |
| 12 | banco | Modal aceita uuid com trava mais frouxa que o Financeiro | Aceita: mesmas travas do Financeiro antes de ler; teste com mmendes e Gurgel. |
| 13 | banco | Webhook forjável grava baixa | Aceita: o webhook só grava o retrato; o casador relê na API da conta do empreendimento e confere a conta; estorno de baixa do Asaas à mão só pelo admin. |
| 14 | banco | Não há função de correção e UPDATE direto passa | Aceita: `carteira_corrigir_parcela`, `carteira_corrigir_contrato`, trilha `carteira_correcoes` e trigger de porta nas 4 tabelas. |
| 15 | banco | Baixa manual do portal sem limite | Aceita, com ajuste: motivo obrigatório, data não futura, valor abaixo do saldo vira parcial e cada baixa do portal abre pendência de conferência. Restringir a usuários nomeados virou a pergunta 4. |
| 16 | banco | `situacao` ambígua em `carteira_estornar_baixa` (42702) | Aceita: `#variable_conflict use_column` e alias nas funções `returns table`; ensaio antes de aplicar, em transação desfeita (o homolog foi apagado). |
| 17 | banco | O 0198 já existe | Aceita: renumerada para 0199; F8 para 0200. |
| 18 | banco | Índice por expressão impede o upsert | Aceita: `impressao_digital` e `ordinal` NOT NULL com default e índice por colunas. |
| 19 | banco | Desfazer deixa conciliação órfã | Aceita: FK RESTRICT; o desfazer apaga as pendências da subida e recusa se houver outra. |
| 20 | tela | Líquido do Garden sairia R$ 0 | Aceita: `liquido: null` quando nenhuma parcela paga tem líquido, e o texto "Líquido não apurado". |
| 21 | tela | Entrada e anual viram "Outro" e caem na fórmula da entrada | Aceita: perfil e rótulo explícitos na linha crua e motivo sem "C2X". A medição achou 15 "anuais" que são entrada parcelada, e a regra do tipo foi corrigida. |
| 22 | tela | `codes` vazio descarta as linhas do Panteon | Aceita: a volta cedo só sem `linhasExtras`, e as pagas do Panteon entram em toda chamada. |
| 23 | tela | Conciliação sem tela | Aceita, com ajuste: bloco "Pendências da carteira" na tela LSoft, onde a Careli resolve; o portal vê "em conferência" no modal. A resolução fica no interno porque é a Careli quem cancela cobrança no Asaas. |
| 24 | tela | Entre a F4 e a F7 não há onde baixar | Aceita: F7a e F7b em produção antes da F4. |
| 25 | tela | Política do Garden só viria do C2X | Aceita: política da fonte Panteon lida de `apolo_enterprise_settings`. |
| 26 | tela | Parcial com réguas diferentes em cada lugar | Aceita: a mesma régua da crítica 10 na view, no adaptador (linha paga + linha aberta) e no modal; baixa manual sugere o saldo. |
| 27 | tela | Vários lotes não cabem em `block`/`lot` | Aceita: rótulo com todos os lotes, busca por todos, avisos visíveis e coluna "Avisos" no Excel, "Contrato assinado" vazio. |
| 28 | tela | "Validados" cai para 0 e o bloco fala de C2X | Aceita: contagem por `lsoft_clientes` e marcas, bloco renomeado, filtro "Migrados" com os valores da carteira. |
| 29 | tela | Conferência sem dizer o que cada tela mostra | Aceita: tabela da seção 4.3 e dica do card "Recebido". |
| 30 | tela | F5 grande demais | Aceita: F5a, F5b, F5c e F5d, com testes de paridade de ponta a ponta. |
| 31 | tela | Garden no Financeiro ainda depende do C2X no ar | Aceita: fonte Panteon resolvida pelo cadastro do Panteon; sem MySQL quando o recorte é só Panteon; "Todos" com aviso em vez de 503. |
| 32 | tela | Dia de UTC nos Indicadores | Aceita: `hojeNaCasa` para as duas fontes. |
| 33 | tela | Changelog não chega ao portal | Aceita: aviso na aba CRM e recado na mensagem ao time. |
| 34 | tela | "Administrada pela Careli" e busca sem lote antigo | Aceita: "carteira do Garden" no recorte Panteon; lote antigo e código do LSoft na unidade e na busca. |

---

## Apêndice A. Como foi medido (29/09/2026, produção `bxgukywoxgivlrhjkwjx`, só SELECT)

A.1 **Número da migration:** `select version, name from supabase_migrations.schema_migrations order by
version desc limit 4` devolve `20260929191055 0198_a_origem_faturamento_na_passagem`; o arquivo está em
`careli-hub-worktrees/assinatura-fonte-unica/packages/database/migrations/`.

A.2 **Mapa de lote antigo para novo:** `scratchpad/garden/mapa-lote.cjs` reproduz `loteDeHoje`: 143
linhas, 143 convertidas.

A.3 **Ponte e mapa:** CPF do LSoft em `boletos_documentos` (`garden`) em `hercules_unidades` (`39`),
cruzado com o mapa; 4 clientes OK sem ponte (00000440, 00000487, 00000548, 00000599); 00000524 e
00000538 com CPFs trocados. 00000560: 1 lote (Q13 L21, `GDN1321`, R$ 260.000, não incerto).

A.4 **Totais do recorte** (`lsoft_parcelas` categoria 124): sobe 106 clientes, 9.868 linhas, 8.996
abertas, R$ 30.556.722,22, 872 pagas, recebido R$ 4.484.836,13, nominal R$ 35.155.023,62; fica 35,
3.533, 3.213, R$ 13.170.456,75, 320, R$ 1.806.670,98. Carteira depois de P8: 9.840 parcelas, 8.995
abertas (R$ 30.552.334,74), 845 pagas (nominal R$ 4.425.958,41), nominal R$ 34.978.293,15; 23 vencidas
(R$ 73.571,50), 11 antes de setembro (R$ 38.428,60); previsto até 29/09 R$ 4.495.006,09.

A.5 **Lotes:** os 111 lotes da ponte dos 106 existem em `hercules_unidades`, todos `bloqueada`, 2 com
`preco_tabela <= 1`.

A.6 **Setembro:** `boletos_pagamentos` (`garden`, 2026-09) por lote do contrato contra `lsoft_parcelas`
com vencimento em setembro: 92 pagas nos dois lados (91 com valor igual e baixa do espelho datada
depois do Asaas, até 19 dias; o 00000290 com valor diferente e baixa 23 dias antes), 6 clientes e 7
parcelas pagas só no Asaas (11 cobranças, R$ 26.479,89), 2 pagas só no espelho, 1 antecipada sem
boleto, 5 abertas nos dois. `boletos_parcelas` do Garden: 989 linhas, todas sequência 1, e
`emissao_iniciada_em` nulo de 2026-02 a 2026-08.

A.7 **Conferência depois da subida** (a rodar na F4):

```sql
select (select count(*) from lsoft_migracoes m where m.categoria_lsoft = 124 and m.desfeito_em is null) as marcas_vivas,
       (select count(*) from carteira_contratos k where k.lsoft_categoria = 124) as contratos,
       (select count(*) from carteira_contrato_unidades u join carteira_contratos k on k.id = u.contrato_id
         where k.lsoft_categoria = 124 and u.vinculo_encerrado_em is null) as lotes,
       (select count(*) from carteira_parcelas p join carteira_contratos k on k.id = p.contrato_id
         where k.lsoft_categoria = 124) as parcelas,
       (select count(*) from carteira_parcela_origens o join carteira_parcelas p on p.id = o.parcela_id
          join carteira_contratos k on k.id = p.contrato_id where k.lsoft_categoria = 124) as origens,
       (select sum(p.valor) from carteira_parcelas p join carteira_contratos k on k.id = p.contrato_id
         where k.lsoft_categoria = 124) as nominal,
       (select sum(p.valor) filter (where p.situacao = 'aberta') from carteira_parcelas p
          join carteira_contratos k on k.id = p.contrato_id where k.lsoft_categoria = 124) as aberto,
       (select sum(p.valor_pago) filter (where p.situacao = 'paga') from carteira_parcelas p
          join carteira_contratos k on k.id = p.contrato_id where k.lsoft_categoria = 124) as recebido,
       (select count(*) from carteira_baixas b where b.origem = 'lsoft' and b.evento = 'baixa') as baixas_lsoft,
       (select count(*) from carteira_pendencias x where x.origem = 'subida') as pendencias_da_subida;
-- Esperado: 106, 107, 111, 9840, 9868, 34978293.15, 30552334.74, 4484836.13, 845, 12.
select count(distinct codigo) from lsoft_carteira_por_cliente_empreendimento where empreendimento = 'Garden';
-- Esperado: 35.
```

A.8 **Views vivas:** `pg_get_viewdef` de `lsoft_carteira_por_cliente` e
`lsoft_carteira_por_cliente_empreendimento`, as duas com `reloptions = {security_invoker=true}`.

A.9 **Pagamento parcial:** `group by cliente_codigo, parcela, quadra, lote, vencimento having count(*) > 1`
nos 106: 22 grupos, 50 linhas, 14 clientes; 21 só com linhas pagas (soma menos maior = R$ 171.762,22) e
1 misto (00000517). Nominal da série = `mode()` do valor nas parcelas de linha única do mesmo cliente,
lote e total.

A.10 **Linhas idênticas entre clientes:** autojunção de `lsoft_parcelas` categoria 124 por quadra,
lote, vencimento, valor e texto: 00000440 x 00000527 (1 linha) e 00000059 x 00000560 (7 linhas).

A.11 **Anuais de dezembro e janeiro** (106, não pagas): 2026-12, 60 parcelas, R$ 665.666,00; 2027-01,
40 parcelas, R$ 483.357,14. Séries de 2 a 12 com vencimentos a cerca de 30 dias: 5 séries, 15
parcelas, R$ 120.000.

A.12 **Importador antigo:** `wc -l scripts/lsoft/importar-para-supabase.mjs` e `grep -c executarCarga`
em todos os checkouts: 255 linhas e 0 no `careli-hub` e em 7 worktrees; `:233`
`delete().neq("id", ...)` sem ler o erro, `:164-190` sem `categoria_lsoft`. Banco:
`categoria_lsoft` `is_nullable = YES`, 0 nulos em 32.660; nenhum trigger em `lsoft_parcelas`.

A.13 **Portal:** `apolo_incorporador_empreendimentos` com o 39: cecilio-rocha (10 usuários ativos) e
mmendes (2), ambos `carteira_administrada = false`; `apolo_incorporador_usuario_empreendimentos` com o
39: 1 usuário da Gurgel; `apolo_incorporador_usuarios` não tem coluna de papel.

## Apêndice B. As duas views como estão hoje (para voltar)

`lsoft_carteira_por_cliente`: igual à versão da seção 3.2 (10a), com duas diferenças: a coluna
`empreendimentos` é `c.empreendimentos` (o array da tabela, também no `group by`) e a junção é
`left join public.lsoft_parcelas p on p.cliente_codigo = c.codigo`.

`lsoft_carteira_por_cliente_empreendimento`: igual à versão da seção 3.2 (10b), com a CTE
`classificada` lendo `public.lsoft_parcelas p_1` em vez de `public.lsoft_parcelas_no_espelho p_1`.

Recriar sempre `with (security_invoker = true)` e repetir o `revoke all ... from anon, authenticated`.
