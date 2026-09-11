# Têmis · o redesenho do quadro — decisões do Lucas

## A SOLICITAÇÃO, nas palavras dele (09/09/2026)

> eu gosto da ideia do kaban, mas queria ela **informativa**, ao clicar no card abrisse uma **tela
> de trabalho**.
>
> **primeiro, na primeira etapa**, acho que deveria trazer os dados dos proponentes, imobiliaria, a
> proposta e as aquela tela de **chat - documentos - (trazer os documentos dos propronentes)
> historico** e ter dois estágios: uma **Abrir contrato** (aqui seria legal trazer o contrato
> preenchido mais **editavel** pois assim dou liberdade para o usuario pode editar ele manualmente
> caso necessario, depois da edição um botão de **salva (ou fechar contrato)** e o botão gerar
> contrato pega essa versão atualizada quando tiver edição ou então somente segue para geração).
> **botão de indeferimento** (ae ter toda a parte de justificativa, o porque está sendo indeferido)
> e o **botão de gerar o contrato**. Ele move para proxima etapa.
>
> **Nessa etapa**, acho valido ter o contrato gerado ao **lado direito (PDF)** — aqui eu já vejo o
> PDF mesmo —, e no **lado esquerdo quem assina**, se tiver ordem a ordem de assinatura, as edições,
> de cpf, e-mail (**também a exclusão**) para o usuario ver quem vai assinar, a ordem, enfim. tudo
> certo vai ter um botão de **enviar para assinatura**, é quando mandamos para assinar que é a
> proxima etapa.
>
> **nesse** ao clicar no card trazer os **indicadores de assinatura, visualização, de erro**
> (e-mail errado, alguma coisa do tipo), uma **tela de monitoramento** e ter um botão para poder
> **cobrar assinatura ao clientes (iris)** — ao clicar, abrir um ticket na iris do contrato com o
> template que temos de cobrança de assinatura.
>
> depois que todos assinam vai para uma proxima etapa de **aguardando prazo legal**, que seria o
> prazo de desistência de **7 dias após assinatura dos compradores**. nesse queria ter os
> **indicadores de dias que se passaram** das assinaturas dos compradores, após identificar **da
> entrada** — se for avista integral, se for parcelado a primeira parcela (trazer essa informação,
> **data de vencimento**). passado 7 dias da assinatura **e** os pagamentos foram realizados, mover
> para ultima sessão de **faturado**. ficou claro?

E, em mensagens seguintes:

> **chat - documento - historico ficam em todas as etapas**

> pagamento de venda será alimentado temporariamente pelo c2x, igual temos hoje na carteira do apolo

---

> Mockup aprovado: [`docs/mockups/temis-quadro-e-tela-de-trabalho.html`](../mockups/temis-quadro-e-tela-de-trabalho.html)
> (desenhado em 09/09/2026, salvo no repo em 10/09 — ele vivia num diretório temporário do Claude).
>
> As cinco perguntas que o mockup deixou em aberto foram respondidas pelo Lucas em **10/09/2026**.
> Este arquivo é o registro delas: o que decidiu, e o que isso obriga a construir.

---

## 1. Pagamento da entrada — RESOLVIDO em 09/09

Vem do C2X, pelo painel de sinal que o Apolo já usa (`lib/apolo/painel-sinal.ts`), pelo elo
`hercules_propostas.origem_c2x_id → acquisition_requests.id`. Não há botão de "confirmar
pagamento" na Têmis: ela LÊ.

⚠️ **Fio solto declarado no mockup:** venda que nasce no Panteon não chega ao C2X (o endpoint de
reserva do legado nunca foi entregue, e `hercules_vendas` está vazia). Então a etapa Prazo legal só
enxerga pagamento de venda que passou pelo legado. Não é defeito do redesenho — é o limite dele.

---

## 2. Indeferimento — é uma FRENTE, não um botão

Lucas (10/09/2026): *"credito? não tem credito na temis"* — corrigindo a leitura errada de que o
botão vermelho do mockup seria reprova de crédito. Crédito é do Apolo (esteira de CAD + Serasa);
a Têmis indefere o **trabalho**, não o comprador.

E: *"Temos que ter uma sessão de Indeferimento, o deferimento tem que chegar no corretor -
imobiliaria - coordenador. Ae temos que ter os motivos e tal"*.

**O que isso obriga:**

| peça | decisão |
|---|---|
| motivo | **lista pronta + observação livre**. O catálogo permite contar qual motivo mais repete; a observação diz o caso. |
| coordenador | avisado **dentro do Panteon** (notificação) |
| corretor e imobiliária | avisados pela **central de Relacionamento** |

⚠️ **A CENTRAL É A DE RELACIONAMENTO, E ISSO É REGRA DA CASA** — não escolha deste desenho.
Imobiliária e corretor falam pela Relacionamento; cliente fala pela Atendimento
(`[[project_apolo_disparo_por_central]]`). Mandar pela central errada põe a conversa na caixa de
quem atende comprador.

---

## 3. Os 7 dias de arrependimento — da ÚLTIMA assinatura do comprador

Só começa a contar quando **todos os compradores** assinaram. A **vendedora não entra na conta** —
ela não se arrepende.

⚠️ Isso torna a contagem dependente de saber **quem é comprador** dentro do envelope. Os
signatários ficam congelados em `temis_envelopes.signatarios` com papel; é de lá que sai a
distinção, e não da ordem de assinatura.

---

## 4. Cessão, distrato e cancelamento — CAMINHO PRÓPRIO, mais curto

Não passam pelas cinco etapas do contrato: não têm prazo de arrependimento nem entrada a pagar.
O caminho deles é o que faz sentido para um documento que se assina e se arquiva.

A casa já tem as réguas puras e testadas: `lib/temis/cessao.ts` (travas de entrada) e
`lib/temis/cancelamento.ts` (`classificarCancelamento` decide cancelamento × distrato pelas duas
perguntas: assinou? pagou?).

---

## 5. Excluir signatário depois do PDF gerado — SÓ SAI DO ENVELOPE

O PDF fica como está; a pessoa apenas não é convidada a assinar.

⚠️ **RISCO ACEITO, E QUE A TELA TEM DE MOSTRAR:** o contrato impresso continua citando quem não
assinou. A decisão é do Lucas (10/09/2026); o que cabe ao desenho é não esconder — o signatário
removido aparece com o aviso ao lado, e não some da tela.

---

## O que isso obriga no banco

O `check` de `temis_trabalhos.estagio` aceita hoje **quatro** valores
(`entrada`, `confeccao`, `assinatura`, `finalizado`) e **recusa** os nomes do mockup. Migration
necessária, com tradução das linhas existentes:

| hoje | vira |
|---|---|
| `entrada` | `analise` |
| `confeccao` | `contrato` |
| `assinatura` | `assinatura` |
| `finalizado` | `faturado` |

Mais: `prazo_legal` (etapa 4, nova) e `indeferido`.

⚠️ **`estagio_desde` É A BASE DE TODOS OS PRAZOS e não pode andar para trás** — a regra já está
escrita em `lib/assinatura/estado-db.ts`. Uma tradução de nome não é um avanço de etapa: o
carimbo fica como está.

E colunas novas para o indeferimento: quando, quem, motivo (código do catálogo) e observação.

---

# 10/09/2026 — a tela de análise, e por que o desconto não era detectável

## O pedido

> *"se tiver desconto tem que vir falando, se tiver algo fora tem que vir pontuando, o operador
> tem que ter todas as informações para ele analisar"*

E, sobre forma: *"eu gosto das coisas blocadas, bem organizada na tela"* · *"só trocaria esse
estágio por workflow de setinhas"* · *"não gostei desse botão dourado não"* / *"pode ser branco"* ·
*"pode ser um bloco só com abas, igual temos no hercules"* · *"a tela está cortando, o flow acho
que deveria estar na direita"*.

## O que a medição mostrou

Comparar `hercules_propostas.valor` com `hercules_unidades.preco_tabela` **é uma tautologia**. A
carga inicial escreveu o mesmo número nos dois lados — `importar-fluxo-de-venda.mjs` lê
`u.price as valor`. Medido em 10/09/2026: **4.856 das 4.863** propostas batem ao centavo, e as 6
que divergem são resíduo do retrato de 01/09 (o cadastro de unidades não tem cron), não desconto
negociado. Um alerta montado sobre isso dispararia em 0,12% dos casos e ainda estaria errado nos 6.

O desconto **existia na tela e morria no banco**: `lib/hercules/ajuste-de-preco.ts` foi feito em
08/09 a pedido do Lucas (*"desconto em valor ou % que influencia o valor da proposta — isso não
pode mudar o valor original de tabela"*), o simulador o usa, mas a rota gravava só
`valor = valorNegociado`. Depois de salvo ninguém sabia se R$ 142.500 foram desconto de 5%, tabela
desatualizada ou erro de digitação — que é textualmente o defeito que aquele módulo foi escrito
para evitar.

⚠️ **E a saída não é olhar o legado.** Lucas: *"por que estamos consultando o legado? já cansei de
falar que não vamos usar o legado mais como referência"*. A proposta de ler o `audits` do C2X (onde
o preço original de fato sobrevive, porque lá o desconto é dado APAGANDO o preço) foi descartada.

## A decisão — migration 0151, aplicada

A proposta passa a **congelar** o que precisa para se explicar sozinha:

| coluna | o que guarda |
|---|---|
| `preco_tabela` | o preço do lote no instante em que a proposta nasceu |
| `ajuste_modo` | `percentual` ou `reais` — a moeda em que o desconto foi PENSADO |
| `ajuste_valor` | quanto foi dado (negativo = desconto) |

⚠️ **Congelado, não consultado.** Ler o cadastro na hora de analisar faria o passado mudar toda vez
que alguém corrigisse o preço do lote: a proposta de agosto "ganharia desconto" porque o preço subiu
em outubro.

⚠️ **Exige as DUAS pontas para apontar.** Sem `ajuste_modo` registrado, a diferença entre tabela e
negociado pode ser qualquer coisa — é o que impede a tautologia de voltar por outro caminho. As
propostas anteriores à 0151 ficam caladas, de propósito: alerta inventado ensina o operador a
ignorar todos.

## Outras correções que o dado real obrigou

**`identificacao_cliente` não é RG.** É o PAPEL na venda, e sai como o literal `"COMPRADOR"` para
todo proponente (`dados-do-contrato.ts`). A etapa 1 mostrava "Identidade: COMPRADOR". O RG é
`rg_cliente`, montado como número + órgão — e só quando o número existe.

**"Sem correção" era mentira.** Na proposta do Otavio (TST Q01 L03) `plano_correcao` e
`plano_juros` estão NULOS, e mesmo assim o cronograma tem **10 faixas de reajuste**, levando a
parcela de R$ 1.012,50 a R$ 1.954,32 em dez anos. A correção passou a sair do CRONOGRAMA (a foto do
que o cliente leu), não da coluna; e sem taxa gravada o campo vira pendência em vez de afirmar
"sem juros". Entrou também **"Parcela ao fim"**, com a faixa inteira.

**`totais.geral` não é o valor do contrato.** É o desembolso somado com reajuste — R$ 183.871,20
numa unidade de R$ 135.000. Rotulado como "Desembolso".

## A forma

Blocos fechados na ordem do trabalho: **parecer → proposta comercial → quem compra → quem vendeu e
onde → contrato**. Paleta e tokens do Panteon (`packages/uix/styles.css`), nos dois temas. Faixa de
etapas em setas encaixadas, à direita do nome. Nenhuma ação tem cor de fundo — o dourado da marca
ficou significando uma coisa só: em que etapa o card está.

**"Abrir contrato" é a `PreviaDoContrato` do Hércules**, não uma segunda tela: ela já monta o
documento preenchido e lista o que ficou sem valor. Ver funciona para qualquer tipo, inclusive
cancelamento e distrato — conferir não é emitir. **Editar** antes de gerar continua faltando, e
precisa de tabela própria: o editor de hoje altera a minuta do EMPREENDIMENTO.

⚠️ **A tela cortava** porque a moldura é `absolute inset-0` e herdava a altura do QUADRO, que
encolhe quando há poucos cards. O pai ganhou altura mínima de viewport enquanto ela está aberta.

## O que continua faltando

- **A etapa 1 é idêntica nos cinco tipos.** `analiseDoTrabalho` nem recebe o `tipo`: um distrato
  abre mostrando qualificação de comprador e condições de venda, nada sobre o que se desfaz.
- **A apuração de distrato/cancelamento já existe e é jogada fora na tela.** Assinou? Pagou?
  Devolve valores? Tudo isso foi apurado e concatenado em `temis_trabalhos.observacao` — coluna que
  o `select` da rota da tela não pede.
- **Cessão não tem cedente nem cessionário** em lugar nenhum do repo, e `podeAbrirCessao` não tem
  chamador: ninguém abre cessão pelo fluxo.
- Régua de política (entrada abaixo do mínimo, prazo acima do plano) ainda não está no parecer.

## 11/09/2026 — a tela passa a dizer O QUE é o trabalho

Lucas, abrindo o card do Otavio: *"agora entendi, não é contrato novo, um cancelamento, então
faltou o motivo do cancelamento e eu preciso saber o que é, quando abro a tela eu não identifiquei
que era um cancelamento"*.

- **O tipo virou etiqueta no cabeçalho**, colada no nome, com cor por família: neutra no contrato,
  âmbar na cessão, rose no que desfaz (cancelamento, distrato). A etapa 1 é quase igual nos cinco
  tipos — mesma proposta, mesmo proponente, mesma unidade —, então quem abria um cancelamento lia
  uma tela de venda.
- **O pedido virou o primeiro bloco da análise**, acima da proposta. O dado sempre existiu em
  `temis_trabalhos.observacao`; faltava a coluna no `select` da rota. `lib/temis/pedido-do-trabalho.ts`
  separa o que o Hércules grava (`origem · COD · motivo · apuração · classificação`) e preserva
  inteiro o texto livre dos pedidos abertos pelo coordenador. Sem observação, o bloco vira pendência
  — "Registrar o motivo" é a primeira atividade do tipo.
- **O título da proposta muda com o tipo**: "A venda que se quer desfazer" no cancelamento e no
  distrato, "A venda que muda de titular" na cessão.

### O fluxo do card: uma proposta pode ter DOIS cards

Medido: a proposta do Henrique (Q01 L05) tem a venda (06/09) **e** o pedido de cancelamento dela
(08/09). `moverCardDaTemis` casava só por `proposta_id` e empurrou os dois para `assinatura` quando
o envelope do contrato saiu — e cancelamento não percorre esse estágio. Pior: `concluirAssinaturaDoCard`
lia o card com `maybeSingle`, que com duas linhas devolve **erro**; o card vinha nulo e a função saía
sem fazer nada — contrato assinado ficaria preso em "Em assinatura", calado.

Agora quem move lê todos os cards da proposta e só aceita os que percorrem o estágio de destino,
perguntando a `estagiosDoTipo`. E `caminhoDoCard` garante que a faixa nunca fique apagada: estágio
fora do caminho entra na posição canônica em vez de sumir.

⚠️ **Resíduo**: o card do Henrique continua gravado em `assinatura`. Corrigir é UPDATE em produção —
espera OK.

### O modal da prévia não tinha cartão

`T` (o tema do Hércules) é `var(--inc-*)` **sem fallback**, e essas variáveis só nascem dentro da
casca `.inc` do `PortalIncorporador`. Na Têmis elas não existem: a declaração vira inválida em tempo
de cálculo e a propriedade cai no valor inicial — `background` vira `transparent`, `border` perde o
estilo, `box-shadow` vira `none`. O painel de 900px estava lá; não pintava nada.

Cada token de `T` ganhou fallback para o token equivalente do Panteon. O `--inc-*` continua vencendo
onde existe, então o portal não muda. ⚠️ `gold` **não** cai em `--uix-color-brand-primary`: aquele é
o mesmo `#a07c3b`, e o dourado foi recusado duas vezes na Têmis — fora do portal ele vira grafite.

O carregamento também ganhou forma: piso de altura no painel e um esqueleto com a silhueta da folha,
no lugar da frase solta. Antes o cartão nascia com ~176px e saltava para a tela inteira.

### O contrato editável (aguarda OK)

`0152_temis_contrato_editado_a_mao.sql` — uma linha por proposta com o HTML já faxinado no servidor,
a impressão sha-256 da base (para avisar quando o cadastro mudar depois da edição) e o autor. A
trava de variável em branco passou a medir o texto final, não a montagem.

### Testes com cliente falso, removidos

Lucas: *"pode tirar os fakes, deixa só os testes reais"*. Saíram `estado-db`, `envio-db`, `ordem-db`
e `trabalhos-db` (31 testes). O Supabase falso concorda com quem o escreveu, não com o Postgres — foi
por isso que o `maybeSingle` com duas linhas passou meses sem ser notado. Restam 25 arquivos com o
mesmo padrão em Apolo, Íris e Prometeu, ainda não varridos.
