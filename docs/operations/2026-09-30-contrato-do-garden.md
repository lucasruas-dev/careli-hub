# Contrato do Garden no portal da Cecílio (30/09/2026)

Pedido do Lucas, com o Termo de Adesão e o Anexo 1 em PDF (Clicksign, jan/2026): *"eu preciso criar
o contrato do Garden e ligar a parte de emissão de contrato do portal da cecilio, o que ele fazem hoje
é os pdfs que eu te mandei"*. Roadmap: PAN-128.

## O que já existia (medido em 30/09, só SELECT)

- A emissão no portal está no ar desde a v1.348.0: a aba Contratos do `cecilio-rocha` abre o board da
  Têmis operável (`ContratosDaCecilio`), com prévia, gerar PDF e envio pela Clicksign da Careli, e a
  ficha do produto tem a aba de minutas (`MinutasDoProduto`) com o quadro de assinatura.
- Ela nunca rodou: **0 minuta** no Garden (39), **0 card** da Têmis com `operado_por`, **0 proposta**
  do Garden no Panteon. Sem minuta publicada, gerar o contrato devolve 409.
- Quadro de assinatura do 39: uma linha só, o coordenador da Gurgel (vinda da 0191).
- `apolo_enterprise_settings` do 39: a vendedora cadastrada é outra empresa do grupo (não a Sócia
  Ostensiva da SCP) e a coordenadora é a da Gurgel. A minuta nova não usa nenhuma das duas.
- Planos do Garden no Panteon: PROMOÇÃO PARCELADO 84x, INVESTIDOR 60x e PROMOÇÃO À VISTA 36x, todos
  com IPCA anual; os dois primeiros com 6% a.a. em SACOC.

## O que foi feito

- **NO AR: v1.400.0**, publicada pela sessão Publicação em 30/09/2026 às 15:08 (commit 2a20b405,
  deployment `dpl_5K6Xocz3PUDvPCE7mMCjYgaJ3A7m`, rollback `305ce566`). Conferido depois: `/api/version`
  = 1.400.0 e `c2x.app.br` 200. Levou o commit 22ccfae6: sete variáveis para escrever o fluxo em
  frase, preenchidas pelo cronograma da proposta: `data_limite_entrada`, `valor_parcela_mensal`
  (+ extenso), `primeiro_vencimento_mensal`, `valor_total_anuais` (+ extenso),
  `primeiro_vencimento_anual`, `dia_mes_vencimento_anual` e `plano_anuais_quantidade_extenso`.
- **Na branch, AINDA NÃO no ar: commit 5167585b**, juros e índice pelo plano da proposta (ver a
  decisão abaixo). `[plano_indice_correcao]` e `[plano_juros]` passam a ser preenchidas por
  `condicoes.plano` (estavam no catálogo e ninguém preenchia); a taxa é escrita por `jurosDoPlano`, a
  mesma função da coluna Juros do quadro, e taxa zero sai "sem juros"; pares novos `tem_juros` e
  `tem_correcao`, respondidos só quando há plano gravado. E a frase do envio que manda arrumar o
  Quadro de assinatura passa a citar o caminho do hub e o do portal (antes só o do hub, que não existe
  para a Cecílio).
- **A minuta** `GDN - TERMO DE ADESÃO SCP + ANEXO 1`: o texto dos dois PDFs, palavra por palavra, num
  documento só (Termo, folha de assinaturas, Anexo 1, folha de assinaturas). O sócio participante
  entra pelo laço de comprador (PF ou PJ), o lote e a quadra pela unidade, e o fluxo pelas variáveis
  novas. Fica FORA do repositório porque traz os documentos da Sócia Ostensiva e do administrador:
  está no scratchpad da sessão (`garden-minuta/minuta-garden.mjs` e `minuta-garden.json`).
- **Ensaio local pelo motor de verdade** (`dadosDaProposta` → `preencherContrato` →
  `documentoParaHtml` → PDF), venda fictícia no formato do simulador: plano com 6% a.a., plano sem
  juros (o À VISTA), plano sem anuais e dois sócios. Nos quatro: 51 variáveis, 0 desconhecida,
  0 bloco quebrado, 0 sem valor. Prévias em `Relatórios Panteon/2026-09-30 Garden - previa do
  contrato*.pdf`.

## A decisão: juros e correção seguem a proposta

Lucas, 30/09/2026, sobre a cláusula de correção do Anexo 1 (o exemplo dizia "INCC-DI ou IPCA, o que
performar maior" e não falava em juros): *"é para seguir o que está na proposta, o que eu mandei é so
um exemplo"*.

O item 2 do Anexo passou a ser:
- título "Correção monetária e juros das parcelas" (o "e juros" some quando o plano não tem juros);
- a) correção pelo `[plano_indice_correcao]`, só a variação positiva, com data-base
  `[data_emissao_contrato]`, sobre a PARCELA DE OBRA e, quando há, a PARCELA INTERMEDIÁRIA;
- b) e c) do modelo da Cecílio, palavra por palavra (sem deflação; índice extinto);
- d) juros remuneratórios de `[plano_juros]` sobre o saldo da PARCELA DE OBRA, pela
  `[plano_sistema_amortizacao]`, só quando o plano tem juros.

No Garden de hoje: PROMOÇÃO PARCELADO e INVESTIDOR saem "IPCA ANUAL" e "6% a.a."; o PROMOÇÃO À VISTA
sai sem a alínea d). As anuais do Garden entram no saldo pelo valor de face, sem juros, e por isso os
juros são declarados só sobre a obra. A redação das alíneas a) e d) é nossa, montada sobre o item VII
das minutas publicadas da casa: vale a leitura do jurídico da Cecílio antes de publicar.

## ⚠️ O laço do comprador fica DENTRO do parágrafo

O marcador `[inicio_cada_comprador]` sozinho num parágrafo deixa um parágrafo vazio por comprador no
papel (o motor repete o que sobra do parágrafo do marcador, e o Plate sempre põe um texto vazio antes
de uma variável). Na minuta do Garden o laço abre e fecha no mesmo parágrafo, com `\n` separando um
sócio do outro. Mudar o motor para ignorar o texto vazio mexeria no papel das minutas publicadas da
Gurgel (VOL, VOC, VOR, RVP, Veredas), e isso não foi feito.

## O que falta

1. ~~Go-live das variáveis~~: feito na v1.400.0.
2. **Go-live do commit 5167585b** (juros e índice pela proposta) pela sessão Publicação. ⚠️ A minuta
   do Garden usa `[plano_juros]`, `[plano_indice_correcao]` e os pares `tem_juros`/`tem_correcao`:
   publicada ANTES desse go-live, a produção trataria os pares como desconhecidos (o motor liga par
   desconhecido) e a variável dos juros sem valor travaria a geração. Rascunho pode existir antes;
   PUBLICAR, só depois.
3. **Gravar a minuta como rascunho no 39** (1 linha em `temis_minutas`; OK do Lucas em 30/09/2026):
   `node gravar-rascunho.mjs --gravar` no scratchpad, depois da revisão independente do texto.
   Publicar fica na tela (Produtos → Garden → Ver mais → aba Minutas), pela conferência de lá.
4. **Quadro de assinatura do 39, pela tela** (Produtos → Garden → Ver mais → aba Minutas, card no fim
   da página): tirar o coordenador da Gurgel e incluir quem assina pela Garden Residence (bloco
   Vendedora) e as testemunhas. Quem pode: qualquer conta ativa do `cecilio-rocha`. Regras que travam
   o envio: e-mail próprio para cada pessoa, nome com sobrenome e sem número. A ordem de assinatura
   não tem tela no portal (só no hub): o Garden fica em "todos ao mesmo tempo".
5. ~~Decisão juros × correção~~: decidido, segue a proposta (ver acima).

Avisos que vão aparecer no envio e não travam: tirando o coordenador do quadro, a tela avisa que "o
contrato qualifica a COORDENADORA DE VENDAS" porque o cadastro do 39 ainda tem a Gurgel como
coordenadora (a conferência olha o cadastro, não o texto da minuta). A minuta do Garden não cita a
coordenadora; o aviso só some trocando a coordenadora do cadastro do 39.

Pontos menores, do próprio modelo da Cecílio: a qualificação da Sócia Ostensiva cita um
administrador e a folha de assinatura traz outra pessoa; o complemento do endereço (apartamento) não
tem variável e não sai.
