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

- **Branch `feat/portal-cecilio-melhorias`, commit 22ccfae6** (a versão sai na sessão Publicação):
  sete variáveis para
  escrever o fluxo em frase, preenchidas pelo cronograma da proposta: `data_limite_entrada`,
  `valor_parcela_mensal` (+ extenso), `primeiro_vencimento_mensal`, `valor_total_anuais` (+ extenso),
  `primeiro_vencimento_anual`, `dia_mes_vencimento_anual` e `plano_anuais_quantidade_extenso`.
- **A minuta** `GDN - TERMO DE ADESÃO SCP + ANEXO 1`: o texto dos dois PDFs, palavra por palavra, num
  documento só (Termo, folha de assinaturas, Anexo 1, folha de assinaturas). O sócio participante
  entra pelo laço de comprador (PF ou PJ), o lote e a quadra pela unidade, e o fluxo pelas variáveis
  novas. Fica FORA do repositório porque traz os documentos da Sócia Ostensiva e do administrador:
  está no scratchpad da sessão (`garden-minuta/minuta-garden.mjs` e `minuta-garden.json`).
- **Ensaio local pelo motor de verdade** (`dadosDaProposta` → `preencherContrato` →
  `documentoParaHtml` → PDF), venda fictícia com um e com dois sócios: 43 variáveis, 0 desconhecida,
  0 bloco quebrado, 0 sem valor. Prévias em `Relatórios Panteon/2026-09-30 Garden - previa do
  contrato*.pdf`.

## ⚠️ O laço do comprador fica DENTRO do parágrafo

O marcador `[inicio_cada_comprador]` sozinho num parágrafo deixa um parágrafo vazio por comprador no
papel (o motor repete o que sobra do parágrafo do marcador, e o Plate sempre põe um texto vazio antes
de uma variável). Na minuta do Garden o laço abre e fecha no mesmo parágrafo, com `\n` separando um
sócio do outro. Mudar o motor para ignorar o texto vazio mexeria no papel das minutas publicadas da
Gurgel (VOL, VOC, VOR, RVP, Veredas), e isso não foi feito.

## O que falta

1. **Go-live das variáveis** pela sessão Publicação (resumo de entrega; push na `main` com OK do
   Lucas).
2. **Gravar a minuta como rascunho no 39** (1 linha em `temis_minutas`, OK do Lucas):
   `node gravar-rascunho.mjs --gravar` no scratchpad. Publicar fica na tela (Produtos → Garden →
   Minutas), pela conferência de lá.
3. **Quadro de assinatura do 39, pela tela:** tirar o coordenador da Gurgel e pôr quem assina pela
   Garden Residence e a testemunha.
4. **Decisão do Lucas sobre a cláusula de correção:** o Anexo diz INCC-DI ou IPCA, o que for maior,
   corrigido mês a mês, e não fala de juros; os planos do Garden no Panteon calculam IPCA anual e 6%
   a.a. em SACOC (a parcela sobe no 13º mês pelos juros). O contrato precisa dizer o que o simulador
   calculou.

Pontos menores, do próprio modelo da Cecílio: a qualificação da Sócia Ostensiva cita um
administrador e a folha de assinatura traz outra pessoa; o complemento do endereço (apartamento) não
tem variável e não sai.
