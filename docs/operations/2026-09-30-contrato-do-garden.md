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
- **Revisão independente** (workflow de 3 lentes, cada achado verificado por um cético): 11 achados
  confirmados, 7 descartados. Consertados no commit 8dbc7716 (motor) e na minuta:
  - blocos prontos PRECO e FLUXO_TABELA com juros e correção em orações próprias, cada uma no seu par
    (com as variáveis preenchidas, a frase única imprimia "juros de sem juros");
  - `data_limite_entrada` pelo vencimento mais tarde, não pela última posição da lista;
  - par novo `tem_mensais` (entrada de 100% zera a série mensal);
  - extenso no feminino para contar parcelas: `prazo_parcelas_extenso` e
    `plano_anuais_quantidade_extenso` ("2 (duas) parcelas");
  - `numero_e_complemento_cliente` ("150, AP 700"), sem mexer em `[numero_cliente]` das minutas
    publicadas;
  - na minuta: sócio pessoa jurídica pela razão social e "representada na forma de seu contrato
    social"; alínea a.1) do bem e da permuta; cláusula 2 só com correção e juros como cláusula 3;
    "reajustáveis" só com correção; texto vazio entre variáveis vizinhas (regra do editor).
  - Descartado de propósito: travar o contrato quando as mensais do SACOC variam. O item 1 declara o
    valor nominal (a primeira parcela), a mesma convenção da coluna Valor do quadro; a cláusula 3 diz
    que os valores são nominais e recebem os juros e a correção.
- **A minuta** `GDN - TERMO DE ADESÃO SCP + ANEXO 1` está GRAVADA COMO RASCUNHO no 39 desde
  30/09/2026 (id `00f85737-2e55-484c-8435-3630eb3ee848`, versão 1, 59 variáveis, OK do Lucas). O texto
  dos dois PDFs vai num documento só (Termo, folha de assinaturas, Anexo 1, folha de assinaturas). O
  fonte fica FORA do repositório porque traz os documentos da Sócia Ostensiva e do administrador:
  scratchpad da sessão (`garden-minuta/minuta-garden.mjs`, `ensaio-casos.mjs`, `gravar-rascunho.mjs`).
- **Ensaio local pelo motor de verdade** com o cronograma REAL do simulador (`montarCronograma`), oito
  vendas fictícias: parcelado 84x com juros, investidor 60x com dois sócios, à vista sem juros, à vista
  com prazo curto, entrada de 100%, sócia pessoa jurídica com permuta, plano sem índice com juros e
  entrada em 3x com datas fora de ordem. Nos oito: 59 variáveis, 0 desconhecida, 0 bloco quebrado,
  0 sem valor, nenhum colchete no papel. Prévias em `Relatórios Panteon/2026-09-30 Garden - previa do
  contrato*.pdf`.

## A decisão: juros e correção seguem a proposta

Lucas, 30/09/2026, sobre a cláusula de correção do Anexo 1 (o exemplo dizia "INCC-DI ou IPCA, o que
performar maior" e não falava em juros): *"é para seguir o que está na proposta, o que eu mandei é so
um exemplo"*.

O Anexo passou a ter:
- **2) Correção monetária das parcelas** (só quando o plano tem índice): a) correção pelo
  `[plano_indice_correcao]` sobre as prestações do Anexo, exceto a entrada, só a variação positiva,
  data-base `[data_emissao_contrato]`; b) e c) do modelo da Cecílio, palavra por palavra.
- **3) Juros das parcelas** (só quando o plano tem juros e há mensais): a) juros remuneratórios de
  `[plano_juros]` sobre o saldo da PARCELA DE OBRA, pela `[plano_sistema_amortizacao]`; b) os valores
  do item 1 são nominais e recebem os juros e a correção.

No Garden de hoje: PROMOÇÃO PARCELADO e INVESTIDOR saem "IPCA ANUAL" e "6% a.a."; o PROMOÇÃO À VISTA
sai sem a cláusula 3. As anuais do Garden entram no saldo pelo valor de face, sem juros, e por isso os
juros são declarados só sobre a obra. Plano sem índice e com juros (só por troca do coordenador) sai
com a cláusula 3 sem a 2, buraco de numeração aceito. A redação das cláusulas 2a e 3 é nossa, montada
sobre o item VII das minutas publicadas da casa: vale a leitura do jurídico da Cecílio antes de publicar.

## ⚠️ O laço do comprador fica DENTRO do parágrafo

O marcador `[inicio_cada_comprador]` sozinho num parágrafo deixa um parágrafo vazio por comprador no
papel (o motor repete o que sobra do parágrafo do marcador, e o Plate sempre põe um texto vazio antes
de uma variável). Na minuta do Garden o laço abre e fecha no mesmo parágrafo, com uma quebra de
linha separando um sócio do outro. Mudar o motor para ignorar o texto vazio mexeria no papel das minutas publicadas da
Gurgel (VOL, VOC, VOR, RVP, Veredas), e isso não foi feito.

## O que falta

1. ~~Go-live das variáveis~~: feito na v1.400.0.
2. **Go-live dos commits 5167585b e 8dbc7716** pela sessão Publicação (resumo de entrega). ⚠️ A minuta
   do Garden usa `[plano_juros]`, `[plano_indice_correcao]`, `[prazo_parcelas_extenso]`,
   `[numero_e_complemento_cliente]` e os pares `tem_juros`, `tem_correcao` e `tem_mensais`: publicada
   ANTES desse go-live, a produção trataria os pares como desconhecidos (o motor liga par desconhecido)
   e as variáveis novas sem valor travariam a geração. O rascunho já existe; PUBLICAR, só depois.
3. ~~Gravar a minuta como rascunho no 39~~: feito em 30/09/2026 (ver acima).
4. **Publicar a minuta pela tela**, depois do item 2: Produtos → Garden → Ver mais → aba Minutas.
5. **Quadro de assinatura do 39:** o coordenador da Gurgel foi DESATIVADO em 30/09/2026 com OK do Lucas
   (exclusão lógica, autor "Zeus (OK do Lucas...)"); o quadro está vazio. Falta a Cecílio incluir pela
   tela (mesmo caminho, card no fim da página) quem assina pela Garden Residence (bloco Vendedora) e as
   testemunhas. Decisão do Lucas: a Cecílio cadastra. Quem pode: qualquer conta ativa do
   `cecilio-rocha`. Regras que travam o envio: e-mail próprio para cada pessoa, nome com sobrenome e
   sem número. A ordem de assinatura não tem tela no portal (só no hub): o Garden fica em "todos ao
   mesmo tempo".
6. ~~Decisão juros × correção~~: decidido, segue a proposta (ver acima).

Avisos que vão aparecer no envio e não travam: com o quadro sem coordenador, a tela avisa que "o
contrato qualifica a COORDENADORA DE VENDAS" porque o cadastro do 39 ainda tem a Gurgel como
coordenadora (a conferência olha o cadastro, não o texto da minuta). A minuta do Garden não cita a
coordenadora; o aviso só some trocando a coordenadora do cadastro do 39.

Ponto menor, do próprio modelo da Cecílio: a qualificação da Sócia Ostensiva cita um administrador e a
folha de assinatura traz outra pessoa. Vale confirmar com eles quem assina.
