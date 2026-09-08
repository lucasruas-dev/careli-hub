import type { NoDoDocumento } from "./documento-html";

// OS BLOCOS PRONTOS DA MINUTA — o contrato já vem meio escrito.
//
// Pedido do Lucas (07/09/2026): *"podia ter um bloco de Partes, e já meio que trazer pronto, bloco
// de preços e tal, isso ia facilitar"*. E, na mesma conversa, sobre a participação de cada
// comprador: *"em vez de ser detentor de 100% do imóvel, troca para unidade"* — por isso o texto
// daqui diz **unidade** em todo lugar, que é a palavra do Hércules e do masterplan.
//
// ⚠️ POR QUE ISTO EXISTE. Marcar uma minuta variável a variável é o trabalho mais caro da Têmis:
// a qualificação das partes sozinha tem ~20 marcas, e cada uma é uma chance de escolher a errada
// (`[nome_cliente]` no lugar de `[nome_conjuge]` sai impresso e ninguém vê). O bloco pronto entrega
// o parágrafo inteiro já marcado, com os pares de bloco fechados — o jurídico ajusta a redação,
// que é o trabalho dele, em vez de montar a marcação, que é trabalho de máquina.
//
// ⚠️ TODA VARIÁVEL AQUI EXISTE EM `variaveis.ts`. Um nome inventado vira `[assim]` impresso no
// contrato — foi como `[Nome]` e `[CPF]` entraram nas minutas do legado. O teste
// `blocos-prontos.test.ts` confere nome por nome contra o catálogo, e confere que cada
// `[inicio_x]` daqui fecha com o seu `[fim_x]`.
//
// ⚠️ A VENDEDORA VEM DA CATEGORIA, não do empreendimento. Lucas (07/09/2026): *"acho legal ter pois
// agora com as categorias, eu posso dentro de um mesmo empreendimento ter dois vendedores"*. O
// parágrafo de qualificação daqui é o do contrato real que ele mandou (BILL EMPREENDIMENTOS), com
// cada dado trocado pela variável correspondente — ver o grupo `vendedora` em `variaveis.ts`.

export type EstiloDaLinha =
  /** Centralizado, sem justificar: data, linha de assinatura, nome sob a linha. */
  | "assinatura"
  /** Itálico: instrução para quem escreve a minuta, não texto do contrato. Apagar antes de publicar. */
  | "aviso"
  /** Parágrafo comum do contrato, justificado. */
  | "corpo"
  /** Linha de ficha ("Nome: [x]"), à esquerda e SEM justificar — justificar espalharia os espaços. */
  | "ficha"
  /** Marcador de bloco sozinho na linha (`[inicio_cada_comprador]`), como o legado escreve. */
  | "marcador"
  /** Quebra de página: o que vem depois começa em folha nova. Ver `quebra-de-pagina-base.ts`. */
  | "quebra"
  /** Título da cláusula, em negrito. */
  | "titulo"
  /** Cabeçalho de um documento que começa em folha nova: negrito e centralizado. */
  | "titulo_centro";

export type LinhaDoBloco = {
  estilo: EstiloDaLinha;
  texto: string;
};

export type BlocoPronto = {
  /** Uma linha dizendo o que o bloco resolve — é o que aparece no painel, sob o rótulo. */
  descricao: string;
  id: string;
  linhas: LinhaDoBloco[];
  rotulo: string;
};

// ── O LAÇO ───────────────────────────────────────────────────────────────────
//
// `[inicio_cada_comprador]` … `[fim_cada_comprador]` REPETE o trecho, um por comprador da venda.
// É a decisão de 07/09/2026 (`project_contrato_so_no_panteon`): como o contrato não roda mais no
// C2X, a minuta não precisa mais dos sufixos `_2`…`_5`, que escreviam a mesma qualificação cinco
// vezes e ainda assim paravam no quinto comprador. Escreve-se uma vez; o motor repete quantas
// vezes a venda pedir, e o cônjuge de cada um nasce do `[inicio_dados_conjuge]` de dentro do laço.
const ABRE_COMPRADOR = "[inicio_cada_comprador]";
const FECHA_COMPRADOR = "[fim_cada_comprador]";

// ⚠️ AS PARTES SÃO DOIS BLOCOS, e não um. Lucas (07/09/2026): *"acho separar, podemos ter o sub
// bloco da vendedora e dos compradores"*.
//
// Não é organização: são coisas que mudam por motivos diferentes. A qualificação da VENDEDORA muda
// quando o incorporador troca de representante ou de endereço — uma vez a cada anos, e vale para
// todos os contratos daquele produto. A dos COMPRADORES muda a cada venda. Quem está ajustando uma
// não quer a outra na frente, e num bloco só a pessoa insere as duas para usar metade.
const PARTES_VENDEDORA: BlocoPronto = {
  descricao: "A qualificação da vendedora, com CNPJ, sede e representante legal.",
  id: "partes-vendedora",
  linhas: [
    { estilo: "titulo", texto: "CLÁUSULA PRIMEIRA — DAS PARTES" },
    {
      estilo: "corpo",
      texto:
        "VENDEDORA E CREDORA FIDUCIÁRIA: [vendedora_razao_social], pessoa jurídica de direito privado, [vendedora_natureza_juridica], inscrita no CNPJ sob o nº [vendedora_cnpj], com sede na [vendedora_rua], [vendedora_numero], [vendedora_bairro], [vendedora_cidade], [vendedora_uf], CEP [vendedora_cep], neste ato representada por [vendedora_representante_nome], [vendedora_representante_nacionalidade], [vendedora_representante_estado_civil], [vendedora_representante_profissao], nascido em [vendedora_representante_nascimento], portador do RG nº [vendedora_representante_rg] e do CPF nº [vendedora_representante_cpf], residente em [vendedora_representante_endereco], e-mail [vendedora_representante_email], telefone [vendedora_representante_telefone], doravante denominada VENDEDORA.",
    },
  ],
  rotulo: "Partes — vendedora",
};

const PARTES_COMPRADORES: BlocoPronto = {
  descricao: "Os compradores qualificados, com PF, PJ e cônjuge já separados.",
  id: "partes-compradores",
  linhas: [
    { estilo: "corpo", texto: "E, de outro lado, na qualidade de COMPRADORES:" },
    { estilo: "marcador", texto: ABRE_COMPRADOR },
    {
      estilo: "corpo",
      texto:
        "[nome_cliente], [inicio_dados_cliente_pf][nacionalidade_cliente], [estado_civil_cliente], casado sob o regime de [regime_casamento_cliente], [profissao_cliente], portador da cédula de identidade nº [rg_cliente] e inscrito no CPF sob o nº [cpf_cliente][fim_dados_cliente_pf][inicio_dados_cliente_pj]pessoa jurídica de direito privado, com razão social [razao_social_cliente], inscrita no CNPJ sob o nº [cnpj_cliente][fim_dados_cliente_pj], residente e domiciliado na [rua_cliente], nº [numero_cliente], [bairro_cliente], [cidade_cliente], CEP [cep_cliente], detentor de [percentual_cliente] da unidade objeto deste instrumento.",
    },
    {
      estilo: "corpo",
      texto:
        "[inicio_dados_conjuge]E, na qualidade de cônjuge, [nome_conjuge], [nacionalidade_conjuge], [profissao_conjuge], inscrito no CPF sob o nº [cpf_conjuge], que a este comparece para os fins do artigo 1.647 do Código Civil.[fim_dados_conjuge]",
    },
    { estilo: "marcador", texto: FECHA_COMPRADOR },
  ],
  rotulo: "Partes — compradores",
};

const OBJETO: BlocoPronto = {
  descricao: "A unidade vendida: quadra, lote, área, matrícula e empreendimento.",
  id: "objeto",
  linhas: [
    { estilo: "titulo", texto: "CLÁUSULA SEGUNDA — DO OBJETO" },
    {
      estilo: "corpo",
      texto:
        "O objeto deste contrato é a unidade do tipo [tipo_unidade], de código [codigo_unidade], situada na Quadra [numero_quadra] ([numero_quadra_extenso]), Lote [numero_lote] ([numero_lote_extenso]), com área de [area_lote] ([area_lote_extenso]), integrante do empreendimento [empreendimento_nome], no município de [empreendimento_cidade]/[empreendimento_uf], objeto da matrícula nº [numero_matricula] do Cartório de Registro de Imóveis competente.",
    },
  ],
  rotulo: "Objeto — a unidade",
};

const PRECO: BlocoPronto = {
  descricao: "Preço, sinal, entrada e saldo financiado, cada valor com o seu extenso.",
  id: "preco",
  linhas: [
    { estilo: "titulo", texto: "CLÁUSULA TERCEIRA — DO PREÇO E DA FORMA DE PAGAMENTO" },
    {
      estilo: "corpo",
      texto:
        "O preço certo e ajustado da unidade é de [preco_venda] ([preco_venda_extenso]), que os COMPRADORES se obrigam a pagar na forma dos parágrafos seguintes.",
    },
    {
      estilo: "corpo",
      texto:
        "Parágrafo primeiro — A título de sinal e princípio de pagamento, o valor de [valor_sinal] ([valor_sinal_extenso]).",
    },
    {
      estilo: "corpo",
      texto: "Parágrafo segundo — A título de entrada, o valor de [valor_entrada] ([valor_entrada_extenso]).",
    },
    {
      estilo: "corpo",
      texto:
        "Parágrafo terceiro — O saldo de [valor_divida_financiada] ([valor_divida_financiada_extenso]) será pago em [prazo_meses_amortizacao] ([prazo_meses_amortizacao_extenso]) parcelas mensais e sucessivas, vencíveis no dia [dia_vencimento] ([dia_vencimento_extenso]) de cada mês.",
    },
    {
      estilo: "corpo",
      texto:
        "Parágrafo quarto — O plano contratado é o [plano_nome], com correção por [plano_indice_correcao], juros de [plano_juros] e amortização pelo sistema [plano_sistema_amortizacao].",
    },
  ],
  rotulo: "Preço e pagamento",
};

// ── O FLUXO DE PAGAMENTO, NOS DOIS FORMATOS ──────────────────────────────────
//
// Lucas, 07/09/2026, mandando um contrato de cada tipo: *"gosto muito dessa tabela, podemos ter os
// dois tipos, tabela e escrita, no lagoa é escrito"*.
//
// São dois jeitos de dizer a MESMA coisa, e a escolha é do empreendimento, não do gosto de quem
// escreve a minuta — trocar o formato de um empreendimento que já assinou muda a cara do contrato
// no meio da carteira:
//
//   TABELA   um quadro com uma linha por série (SINAL, MENSAL…) e as colunas correção, juros,
//            primeiro vencimento, quantidade, valor da parcela e total, fechando com o VALOR TOTAL.
//   ESCRITA  o Quadro Resumo do Lagoa Bonita: Sinal, Parcelamento, Vencimento e Meio de pagamento
//            em parágrafos redigidos, cada valor seguido do extenso.
//
// ⚠️ USE UM OU OUTRO, nunca os dois. O contrato que traz o quadro E os parágrafos diz o preço duas
// vezes, e o dia em que uma parcela é renegociada só um dos dois é corrigido — é o mesmo defeito do
// número com dois papéis que já apareceu na minuta auditada (ver `valor_garantia_fiduciaria`).
const FLUXO_TABELA: BlocoPronto = {
  descricao: "O quadro de parcelas: uma linha por série, fechando com o valor total.",
  id: "fluxo-tabela",
  linhas: [
    { estilo: "titulo", texto: "CLÁUSULA — DO FLUXO DE PAGAMENTO" },
    {
      estilo: "corpo",
      texto:
        "O preço de [preco_venda] ([preco_venda_extenso]) será pago conforme o quadro abaixo, parte integrante deste instrumento:",
    },
    // ⚠️ O QUADRO INTEIRO SAI DESTA VARIÁVEL. `[tabela_geral_pagamentos]` é escrito pelo motor a
    // partir do plano da venda, com as colunas do contrato que o Lucas mandou: tipo de parcela,
    // correção monetária, juros, primeiro vencimento, nº de parcelas, valor da parcela e total.
    // Escrever a tabela à mão na minuta a congelaria: o plano muda e o quadro fica no valor velho.
    { estilo: "corpo", texto: "[tabela_geral_pagamentos]" },
    {
      estilo: "corpo",
      texto:
        "Sobre o saldo devedor incidirão correção por [plano_indice_correcao] e juros de [plano_juros], apurados pelo sistema [plano_sistema_amortizacao], na forma do plano [plano_nome].",
    },
  ],
  rotulo: "Fluxo — tabela",
};

const FLUXO_ESCRITO: BlocoPronto = {
  descricao: "O Quadro Resumo em parágrafos, como no Lagoa Bonita: sinal, parcelamento, vencimento.",
  id: "fluxo-escrito",
  linhas: [
    { estilo: "titulo", texto: "CLÁUSULA — DO FLUXO DE PAGAMENTO" },
    {
      estilo: "corpo",
      texto: "O preço certo e ajustado da unidade é de [preco_venda] ([preco_venda_extenso]).",
    },
    { estilo: "titulo", texto: "Sinal" },
    // Os três `[paragrafo_*]` saem REDIGIDOS pelo motor a partir do plano — o parágrafo inteiro,
    // com os valores e as datas de cada parcela do sinal. É o que o Quadro Resumo do Lagoa traz.
    { estilo: "corpo", texto: "[paragrafo_sinal]" },
    // ⚠️ A CONDIÇÃO SUSPENSIVA É O QUE DÁ DENTE AO SINAL. Sem ela, sinal não pago vira cobrança; com
    // ela, o contrato se resolve sozinho e a unidade volta para venda. O texto é o do contrato real,
    // e fica fixo na minuta porque é cláusula, não dado.
    { estilo: "titulo", texto: "Condição suspensiva — pagamento do sinal" },
    {
      estilo: "corpo",
      texto:
        "O pagamento do sinal, no valor e nas datas estabelecidos acima, é condição suspensiva para a eficácia deste contrato, cujos efeitos permanecerão suspensos até que o pagamento seja realizado, sem gerar obrigações entre as partes.",
    },
    {
      estilo: "corpo",
      texto:
        "Caso o sinal não seja pago na data fixada, este contrato será automaticamente resolvido, sem necessidade de prévia interpelação ou comunicação, considerado sem efeito, liberando a unidade para comercialização, sem quaisquer ônus, obrigações ou direitos indenizatórios para as partes.",
    },
    { estilo: "titulo", texto: "Parcelamento" },
    { estilo: "corpo", texto: "[paragrafo_parcelamento]" },
    {
      estilo: "corpo",
      texto:
        "[inicio_tem_anuais]Além das parcelas mensais, o COMPRADOR pagará [plano_anuais_quantidade] parcelas anuais de [plano_anuais_valor] ([plano_anuais_valor_extenso]), vencíveis a cada doze meses contados da primeira parcela mensal.[fim_tem_anuais]",
    },
    { estilo: "titulo", texto: "Vencimento" },
    { estilo: "corpo", texto: "[paragrafo_vencimento]" },
    { estilo: "titulo", texto: "Meio de pagamento" },
    {
      estilo: "corpo",
      texto:
        "Os boletos bancários e os códigos PIX serão expedidos pela VENDEDORA e enviados ao COMPRADOR. A falta de recebimento do boleto ou do código PIX não exime o COMPRADOR de efetuar o pagamento tempestivamente, nem das penalidades moratórias em que incorra, uma vez que, pelos canais de comunicação disponibilizados pela VENDEDORA, poderá obter as informações necessárias com antecedência aos vencimentos, destacando-se a solicitação de segunda via do boleto na sede da VENDEDORA, no endereço indicado neste instrumento, nos dias úteis.",
    },
  ],
  rotulo: "Fluxo — escrito",
};

const CORRETAGEM: BlocoPronto = {
  descricao: "Imobiliária, corretor e comissão da venda.",
  id: "corretagem",
  linhas: [
    { estilo: "titulo", texto: "CLÁUSULA QUARTA — DA CORRETAGEM" },
    {
      estilo: "corpo",
      texto:
        "A intermediação desta venda foi realizada por [imobiliaria_nome], inscrita no CNPJ sob o nº [imobiliaria_cnpj], CRECI [imobiliaria_creci], por meio do corretor [corretor_nome], CRECI [corretor_creci].",
    },
    {
      estilo: "corpo",
      texto:
        "A comissão de corretagem, no valor de [valor_total_comissao] ([valor_total_comissao_extenso]), é devida na forma ajustada entre as partes.",
    },
  ],
  rotulo: "Corretagem",
};

// -- O CONTRATO DE CORRETAGEM, INTEIRO ---------------------------------------
//
// Lucas, 08/09/2026: *"o contrato de corretagem e padrao, podemos fazer um bloco so com ele.
// Lembrando que temos que trazer o nome da coordenadora de vendas, segue ele para deixar ele padrao,
// quando ele entra tem que ter a quebra de pagina inicial e no final"*. O texto abaixo e o que ele
// mandou, clausula por clausula.
//
// ATENCAO: NAO CONFUNDIR COM O BLOCO `corretagem`. Aquele e UMA CLAUSULA dentro do contrato de venda
// ("a intermediacao foi feita por..."). Este e um CONTRATO SEPARADO, com partes, foro e assinaturas
// proprias, que viaja junto com a venda. Os dois convivem: o comprador assina os dois.
//
// ATENCAO: ELE COMECA E TERMINA COM QUEBRA DE PAGINA. Foi pedido explicito, e a razao e juridica: um
// contrato que comeca no meio da folha do contrato anterior parece clausula daquele contrato. As
// duas quebras vem dentro do bloco para ninguem precisar lembrar de po-las.
//
// O QUE FOI TROCADO POR VARIAVEL no texto que ele mandou, e por que:
//
//   "RESIDENCIAL VILLA PARIS"     -> [empreendimento_nome]     o bloco e padrao, serve a todos
//   "WLM INCORPORACOES..."        -> as [vendedora_*]          a vendedora vem da CATEGORIA
//   "Joao Monlevade/MG"           -> [empreendimento_cidade]   municipio e foro seguem o produto
//   "CRECI: 8.015" (tres vezes)   -> [creci_coordenadora_vendas]
//   "3%" e "4%"                   -> [percentual_comissao_*]   a comissao ja varia por empreendimento
//   os sufixos _2.._5             -> [inicio_cada_comprador]   ver a nota do laco, acima
//
// ATENCAO: AS TESTEMUNHAS FICARAM ESCRITAS, com nome e CPF, como no texto que ele mandou. E a unica
// coisa aqui que nao e variavel, e e decisao consciente: testemunha nao tem cadastro no Panteon, e
// inventar um campo pendente para ela deixaria duas linhas em branco no contrato assinado. Quem
// trocar de testemunha edita a minuta -- mesmo trabalho de trocar um cadastro, e visivel.
//
// ATENCAO: "IMOVEL" APARECE AQUI, e e de proposito. O vocabulario da casa e "unidade" (Lucas,
// 07/09/2026), e a participacao do comprador diz "da unidade" tambem neste texto. Mas as clausulas
// de intermediacao citam a Lei no 6.530/1978 e o CDC, onde o bem e o *imovel* -- reescrever isso
// mudaria a citacao legal, nao o vocabulario. Por isso o teste da regra da unidade abre excecao
// nominal para este bloco, em vez de afrouxar para todos.
//
// ATENCAO: "Area: [area_lote]" SEM "m2" DEPOIS. A variavel ja traz a unidade ("300,00 m2"); escrever
// "[area_lote] m2" como no original imprimiria "300,00 m2 m2" -- o mesmo defeito que produziu
// "trezentos metros quadrados metros quadrados" no contrato auditado do Villa Paris.
const CONTRATO_CORRETAGEM: BlocoPronto = {
  descricao: "O contrato de corretagem completo, em folha propria, com a coordenadora de vendas.",
  id: "contrato-corretagem",
  linhas: [
    { estilo: "quebra", texto: "" },
    { estilo: "titulo_centro", texto: "CONTRATO PARTICULAR DE CORRETAGEM IMOBILIÁRIA" },
    { estilo: "titulo_centro", texto: "[empreendimento_nome]" },
    { estilo: "titulo_centro", texto: "QUADRA [numero_quadra] — LOTE [numero_lote]" },
    { estilo: "corpo", texto: "Pelo presente instrumento particular, de um lado:" },
    { estilo: "titulo", texto: "I – CONTRATANTE(S)" },
    { estilo: "marcador", texto: "[inicio_cada_comprador]" },
    { estilo: "corpo", texto: "[inicio_dados_cliente_pf][nome_cliente], de nacionalidade [nacionalidade_cliente], [estado_civil_cliente], [inicio_dados_conjuge][regime_casamento_cliente], [fim_dados_conjuge][profissao_cliente], portador do CPF n.º [cpf_cliente], e do e-mail: [email_cliente] e de telefone: [telefone_cliente],[inicio_dados_conjuge] e [nome_conjuge], de nacionalidade [nacionalidade_conjuge], [profissao_conjuge], portador do CPF n.º [cpf_conjuge], e do e-mail: [email_conjuge] e de telefone: [telefone_conjuge],[fim_dados_conjuge] residente(s) e domiciliado(s) no endereço [rua_cliente], [numero_cliente], [bairro_cliente], [cidade_cliente], [cep_cliente].[fim_dados_cliente_pf][inicio_dados_cliente_pj][nome_fantasia_cliente], pessoa jurídica de direito privado, CNPJ [cnpj_cliente], com sede na [rua_cliente], [numero_cliente], [bairro_cliente], [cidade_cliente], [cep_cliente], e-mail: [email_cliente], neste ato representada por seus representantes legais e/ou procuradores, conforme disposições de seu Contrato Social.[fim_dados_cliente_pj] O(s) COMPRADOR(ES) e DEVEDOR(ES) FIDUCIANTE(S) detém(êm) a fração ideal correspondente a [percentual_cliente] sobre os direitos possessórios da unidade objeto deste instrumento." },
    { estilo: "marcador", texto: "[fim_cada_comprador]" },
    { estilo: "corpo", texto: "Doravante denominado(s), individual ou conjuntamente, CONTRATANTE(S) ou COMPRADOR(ES). Havendo mais de um CONTRATANTE, todos declaram ciência das obrigações assumidas neste instrumento e respondem na forma da legislação aplicável pelas obrigações por eles contratadas." },
    { estilo: "titulo", texto: "II – INTERMEDIADORES E BENEFICIÁRIOS DA CORRETAGEM" },
    { estilo: "titulo", texto: "2.1. COORDENADORA DE VENDAS" },
    { estilo: "ficha", texto: "Nome: [nome_fantasia_coordenadora_vendas]" },
    { estilo: "ficha", texto: "CNPJ: [cnpj_coordenadora_vendas]" },
    { estilo: "ficha", texto: "CRECI: [creci_coordenadora_vendas]" },
    { estilo: "ficha", texto: "Endereço: [rua_coordenadora_vendas], [numero_coordenadora_vendas], [bairro_coordenadora_vendas], [cidade_coordenadora_vendas], [cep_coordenadora_vendas]" },
    { estilo: "ficha", texto: "Telefone: [telefone_coordenadora_vendas]" },
    { estilo: "ficha", texto: "E-mail: [email_coordenadora_vendas]" },
    { estilo: "corpo", texto: "doravante denominada COORDENADORA DE VENDAS." },
    { estilo: "titulo", texto: "2.2. CORRETOR(ES) / INTERMEDIADOR(ES)" },
    { estilo: "ficha", texto: "Nome: [nome_vinculado]" },
    { estilo: "ficha", texto: "CNPJ: [cpf_cnpj_vinculado]" },
    { estilo: "ficha", texto: "CRECI: [creci_vinculado]" },
    { estilo: "ficha", texto: "Telefone: [telefone_vinculado]" },
    { estilo: "ficha", texto: "E-mail: [email_vinculado]" },
    { estilo: "corpo", texto: "A COORDENADORA DE VENDAS e os demais profissionais acima identificados serão denominados, em conjunto, INTERMEDIADORES, respeitada a individualização de cada beneficiário da remuneração." },
    { estilo: "titulo", texto: "III – IDENTIFICAÇÃO DO NEGÓCIO IMOBILIÁRIO" },
    { estilo: "corpo", texto: "3.1. O presente contrato refere-se exclusivamente aos serviços de intermediação imobiliária relacionados à aquisição do seguinte imóvel:" },
    { estilo: "ficha", texto: "Empreendimento: [empreendimento_nome]" },
    { estilo: "ficha", texto: "Quadra: [numero_quadra]" },
    { estilo: "ficha", texto: "Lote: [numero_lote]" },
    { estilo: "ficha", texto: "Área: [area_lote]" },
    { estilo: "ficha", texto: "Município: [empreendimento_cidade]/[empreendimento_uf]" },
    { estilo: "corpo", texto: "VENDEDORA: [vendedora_razao_social], [vendedora_natureza_juridica], inscrita no CNPJ sob o nº [vendedora_cnpj], com sede na [vendedora_rua], nº [vendedora_numero], bairro [vendedora_bairro], CEP [vendedora_cep], [vendedora_cidade]/[vendedora_uf]." },
    { estilo: "corpo", texto: "3.2. Os INTERMEDIADORES declaram possuir autorização para atuar na comercialização e intermediação das unidades do empreendimento, dentro dos limites de suas atribuições profissionais." },
    { estilo: "corpo", texto: "3.3. A atuação dos INTERMEDIADORES não lhes confere poderes para assumir obrigações em nome da VENDEDORA, modificar condições do negócio, conceder descontos, alterar preço, fluxo financeiro, características do imóvel, prazos, condições de entrega ou qualquer disposição do Instrumento Particular de Venda e Compra de Imóvel com Alienação Fiduciária em Garantia e Outras Avenças, salvo mediante autorização expressa da VENDEDORA." },
    { estilo: "titulo", texto: "IV – QUADRO-RESUMO DA CORRETAGEM" },
    { estilo: "titulo", texto: "4.1. PREÇO DO LOTE" },
    { estilo: "corpo", texto: "[valor_imovel_venda] ([valor_imovel_venda_extenso])." },
    { estilo: "titulo", texto: "4.2. VALOR TOTAL DA COMISSÃO DE CORRETAGEM" },
    { estilo: "corpo", texto: "[valor_total_comissao] ([valor_total_comissao_extenso])" },
    { estilo: "titulo", texto: "4.3. CUSTO TOTAL DA AQUISIÇÃO" },
    { estilo: "corpo", texto: "O custo total da aquisição corresponde à soma do preço do lote e da comissão de corretagem:" },
    { estilo: "corpo", texto: "[valor_custo_total_aquisicao] ([valor_custo_total_aquisicao_extenso])" },
    { estilo: "corpo", texto: "O valor da comissão de corretagem é expressamente destacado do preço do lote, ainda que seu fluxo de pagamento seja operacionalmente vinculado ao fluxo das parcelas de SINAL/ATO estabelecido no Instrumento Particular de Venda e Compra." },
    { estilo: "titulo", texto: "4.4. BENEFICIÁRIOS DA COMISSÃO" },
    { estilo: "ficha", texto: "Nome: [nome_fantasia_coordenadora_vendas]" },
    { estilo: "ficha", texto: "CNPJ: [cnpj_coordenadora_vendas]" },
    { estilo: "ficha", texto: "CRECI: [creci_coordenadora_vendas]" },
    { estilo: "ficha", texto: "Percentual de Comissão de Corretagem: [percentual_comissao_coordenadora_vendas]" },
    { estilo: "ficha", texto: "Valor de Comissão de Corretagem: [valor_pago_coordenadora_vendas]" },
    { estilo: "ficha", texto: "Nome: [nome_vinculado]" },
    { estilo: "ficha", texto: "CNPJ: [cpf_cnpj_vinculado]" },
    { estilo: "ficha", texto: "CRECI: [creci_vinculado]" },
    { estilo: "ficha", texto: "Percentual de Comissão de Corretagem: [percentual_comissao_vinculado]" },
    { estilo: "ficha", texto: "Valor de Comissão de Corretagem: [valor_corretagem_menos_coordenadora_vendas]" },
    { estilo: "corpo", texto: "O valor total e os beneficiários deverão corresponder integralmente às informações constantes do Quadro-Resumo do Instrumento Particular de Venda e Compra." },
    { estilo: "titulo", texto: "V – DO OBJETO DA CORRETAGEM" },
    { estilo: "corpo", texto: "5.1. O presente contrato tem por objeto a remuneração dos serviços de intermediação imobiliária realizados pelos INTERMEDIADORES, compreendendo a aproximação das partes, apresentação do imóvel, fornecimento das informações inerentes à negociação e atuação destinada à celebração do Instrumento Particular de Venda e Compra de Imóvel com Alienação Fiduciária em Garantia e Outras Avenças do imóvel identificado neste contrato." },
    { estilo: "corpo", texto: "5.2. Os INTERMEDIADORES deverão atuar com diligência, prudência, transparência e observância das normas profissionais aplicáveis, prestando ao(s) CONTRATANTE(S) as informações relacionadas à negociação que sejam de seu conhecimento e possam influenciar a decisão de aquisição." },
    { estilo: "corpo", texto: "5.3. Os serviços de corretagem não compreendem assessoria jurídica, contábil, tributária, técnica de engenharia ou qualquer serviço diverso da atividade de intermediação imobiliária." },
    { estilo: "titulo", texto: "VI – DA REMUNERAÇÃO E DO RESULTADO DA INTERMEDIAÇÃO" },
    { estilo: "corpo", texto: "6.1. Pela prestação dos serviços de intermediação, o(s) CONTRATANTE(S) pagará(ão) aos INTERMEDIADORES a comissão total estabelecida no item 4.2, observada a distribuição individualizada prevista no item 4.4." },
    { estilo: "corpo", texto: "6.2. Considera-se alcançado o resultado útil da intermediação com a efetiva celebração do Instrumento Particular de Venda e Compra de Imóvel com Alienação Fiduciária em Garantia e Outras Avenças entre o(s) CONTRATANTE(S) e a VENDEDORA." },
    { estilo: "corpo", texto: "6.3. Alcançado o resultado da intermediação, a remuneração da corretagem torna-se devida, ficando o seu pagamento submetido aos vencimentos e ao fluxo financeiro definidos neste instrumento." },
    { estilo: "corpo", texto: "6.4. A comissão de corretagem constitui remuneração autônoma pelos serviços de intermediação e não se confunde com sinal, arras, entrada ou parcela destinada à amortização do preço do lote." },
    { estilo: "titulo", texto: "VII – DO FLUXO DE PAGAMENTO DA COMISSÃO DE CORRETAGEM" },
    { estilo: "corpo", texto: "7.1. A comissão de corretagem será paga em conformidade com o fluxo financeiro das parcelas de SINAL/ATO previsto no item 6.1 do Instrumento Particular de Venda e Compra, observada a divisão e destinação dos valores entre o preço do lote e os respectivos beneficiários da corretagem." },
    { estilo: "corpo", texto: "7.2. A vinculação ao fluxo financeiro do SINAL/ATO possui finalidade exclusivamente operacional, permanecendo os valores de corretagem juridicamente individualizados e distintos dos valores destinados à VENDEDORA para pagamento do preço do lote." },
    { estilo: "titulo", texto: "VIII – DO MEIO EXCLUSIVO DE PAGAMENTO" },
    { estilo: "corpo", texto: "8.1. O pagamento da comissão de corretagem deverá ser realizado, preferencialmente, por meio de boleto bancário ou cobrança PIX emitidos e disponibilizados pelo ASAAS, conforme as instruções encaminhadas ao(s) COMPRADOR(ES). Excepcionalmente, será admitido o pagamento em dinheiro, desde que previamente autorizado e formalmente recebido pela INTERMEDIADORA ou por pessoa expressamente autorizada para esse fim, mediante emissão de recibo ou documento equivalente que identifique o pagador, o valor recebido, a data do pagamento, a unidade imobiliária a que se refere e o beneficiário da comissão." },
    { estilo: "corpo", texto: "8.2. Serão considerados meios válidos e oficiais para pagamento da comissão de corretagem:" },
    { estilo: "corpo", texto: "I – boleto bancário emitido pelo ASAAS;" },
    { estilo: "corpo", texto: "II – cobrança PIX, mediante QR Code e/ou chave PIX expressamente disponibilizada pelo ASAAS para a respectiva cobrança; ou" },
    { estilo: "corpo", texto: "III – pagamento em dinheiro, em caráter excepcional, desde que realizado na forma prevista no item 8.1 e acompanhado da respectiva comprovação de recebimento." },
    { estilo: "corpo", texto: "8.3. Não serão reconhecidos como forma válida de pagamento depósitos, transferências bancárias, PIX para chaves diversas das oficialmente indicadas, pagamentos a terceiros não autorizados ou quaisquer outros meios distintos daqueles previstos no item 8.2, salvo autorização prévia, expressa e documentada da INTERMEDIADORA." },
    { estilo: "corpo", texto: "8.4. Qualquer solicitação de pagamento da comissão por meio diverso dos previstos nesta cláusula deverá ser desconsiderada pelo(s) CONTRATANTE(S), que deverá(ão) solicitar nova cobrança oficial pelos canais informados para atendimento." },
    { estilo: "corpo", texto: "8.5. Os INTERMEDIADORES não poderão solicitar que o(s) CONTRATANTE(S) efetue(m) o pagamento da comissão para conta bancária, chave PIX ou terceiro diferente daquele indicado na cobrança oficial emitida pelo ASAAS." },
    { estilo: "corpo", texto: "8.6. A comissão será considerada paga somente após a efetiva liquidação da cobrança emitida pelo ASAAS e a confirmação do respectivo crédito no sistema." },
    { estilo: "corpo", texto: "8.7. Quando tecnicamente disponível, o ASAAS poderá realizar a divisão automática dos valores entre os respectivos beneficiários da corretagem, conforme a composição indicada neste contrato, sem que tal procedimento altere o valor total devido pelo(s) CONTRATANTE(S)." },
    { estilo: "corpo", texto: "8.8. A eventual divisão interna promovida pelo ASAAS entre os beneficiários não atribui ao(s) CONTRATANTE(S) responsabilidade pelo repasse ou distribuição posterior da comissão, considerando-se cumprida sua obrigação mediante a liquidação integral da cobrança oficial." },
    { estilo: "corpo", texto: "8.9. O não recebimento ou a indisponibilidade do boleto ou da cobrança PIX deverá ser comunicado pelo(s) CONTRATANTE(S) antes do vencimento, para emissão de segunda via ou disponibilização de nova cobrança pelo ASAAS." },
    { estilo: "corpo", texto: "8.10. Não poderão ser imputados ao(s) CONTRATANTE(S) encargos decorrentes exclusivamente da indisponibilidade do meio oficial de pagamento quando comprovadamente não lhes for imputável." },
    { estilo: "titulo", texto: "IX – DA IMPONTUALIDADE" },
    { estilo: "corpo", texto: "9.1. O pagamento de parcela da comissão após o respectivo vencimento ficará sujeito, sobre o valor efetivamente vencido e não pago, aos seguintes encargos:" },
    { estilo: "corpo", texto: "I – multa moratória de 2% (dois por cento);" },
    { estilo: "corpo", texto: "II – juros de mora de 1% (um por cento) ao mês, calculados pro rata die; e" },
    { estilo: "corpo", texto: "III – atualização monetária pela variação positiva do IPCA/IBGE, calculada do vencimento até a data do efetivo pagamento." },
    { estilo: "corpo", texto: "9.2. O inadimplemento de parcela da corretagem não autoriza o(s) CONTRATANTE(S) a utilizar meio de pagamento diverso do ASAAS, permanecendo obrigatória a emissão da respectiva cobrança oficial." },
    { estilo: "corpo", texto: "9.3. O recebimento de parcela posterior não importa novação, remissão, renúncia ou quitação de eventual parcela anterior ainda pendente." },
    { estilo: "corpo", texto: "9.4. O inadimplemento da comissão de corretagem não implica, por si só, resolução automática do Instrumento Particular de Venda e Compra, cuja mora, resolução e demais consequências observarão exclusivamente aquele instrumento e a legislação aplicável." },
    { estilo: "titulo", texto: "X – DA NÃO CONCLUSÃO DO NEGÓCIO" },
    { estilo: "corpo", texto: "10.1. Caso o Instrumento Particular de Venda e Compra não seja efetivamente celebrado entre o(s) CONTRATANTE(S) e a VENDEDORA, não se considerará alcançado o resultado da intermediação para os fins deste contrato." },
    { estilo: "corpo", texto: "10.2. Na hipótese prevista no item anterior, eventuais valores pagos antecipadamente a título de corretagem serão restituídos ao(s) CONTRATANTE(S), observada a legislação aplicável." },
    { estilo: "corpo", texto: "10.3. O disposto nesta cláusula não se confunde com eventual desistência ou desfazimento ocorrido após a celebração do Instrumento Particular de Venda e Compra, hipótese em que serão observadas as cláusulas seguintes." },
    { estilo: "titulo", texto: "XI – DA DESISTÊNCIA, DISTRATO E RESOLUÇÃO DO NEGÓCIO" },
    { estilo: "corpo", texto: "11.1. Uma vez alcançado o resultado da intermediação e celebrado o Instrumento Particular de Venda e Compra, eventual desistência posterior do(s) CONTRATANTE(S), distrato ou resolução do negócio não acarretará, por si só, a extinção automática da remuneração decorrente dos serviços de corretagem efetivamente prestados, observados os direitos e limitações estabelecidos pela legislação aplicável." },
    { estilo: "corpo", texto: "O Código Civil estabelece que a remuneração do corretor é devida uma vez alcançado o resultado previsto no contrato de mediação." },
    { estilo: "corpo", texto: "11.2. Na hipótese de exercício válido do direito de arrependimento legalmente assegurado ao consumidor, serão observadas as consequências previstas na legislação, inclusive quanto à restituição dos valores eventualmente pagos." },
    { estilo: "corpo", texto: "Quando a contratação estiver sujeita ao art. 49 do CDC, o consumidor dispõe de sete dias para desistência e os valores pagos durante o período de reflexão devem ser devolvidos." },
    { estilo: "corpo", texto: "11.3. Na hipótese de resolução da compra e venda por fato exclusivamente imputável à VENDEDORA, os efeitos eventualmente incidentes sobre os valores da corretagem observarão a legislação aplicável e as circunstâncias concretas do desfazimento." },
    { estilo: "titulo", texto: "XII – DOS COMPROVANTES E DOCUMENTOS FISCAIS" },
    { estilo: "corpo", texto: "12.1. O comprovante de liquidação emitido pelo ASAAS comprovará o pagamento da respectiva cobrança, sem prejuízo da emissão do documento fiscal ou recibo pertinente pelo beneficiário da comissão." },
    { estilo: "corpo", texto: "12.2. Cada beneficiário será responsável pela emissão dos documentos fiscais legalmente exigíveis correspondentes aos valores por ele recebidos." },
    { estilo: "corpo", texto: "12.3. Os valores comprovadamente pagos a título de corretagem poderão ser utilizados pelo(s) CONTRATANTE(S) para fins fiscais e tributários na forma da legislação vigente, cabendo-lhes conservar os respectivos comprovantes e documentos fiscais." },
    { estilo: "titulo", texto: "XIII – DAS RESPONSABILIDADES DOS INTERMEDIADORES" },
    { estilo: "corpo", texto: "13.1. Os INTERMEDIADORES obrigam-se a:" },
    { estilo: "corpo", texto: "a) prestar informações claras e adequadas relacionadas à intermediação;" },
    { estilo: "corpo", texto: "b) identificar corretamente o imóvel objeto da negociação;" },
    { estilo: "corpo", texto: "c) preservar a confidencialidade das informações recebidas, ressalvadas as hipóteses legais de compartilhamento;" },
    { estilo: "corpo", texto: "d) não prometer condições que não estejam formalmente autorizadas pela VENDEDORA;" },
    { estilo: "corpo", texto: "e) informar corretamente o preço, a comissão, o fluxo comercial e os beneficiários da corretagem;" },
    { estilo: "corpo", texto: "f) orientar o(s) CONTRATANTE(S) a realizar qualquer pagamento de corretagem exclusivamente pelos meios previstos na Cláusula VIII; e" },
    { estilo: "corpo", texto: "g) manter regular sua habilitação profissional quando legalmente exigida." },
    { estilo: "corpo", texto: "A intermediação de compra e venda de imóveis é atividade atribuída aos profissionais habilitados nos termos da Lei nº 6.530/1978." },
    { estilo: "titulo", texto: "XIV – DAS DECLARAÇÕES DO(S) CONTRATANTE(S)" },
    { estilo: "corpo", texto: "14.1. O(s) CONTRATANTE(S) declara(m), para todos os fins, que previamente à contratação:" },
    { estilo: "corpo", texto: "a) teve/tiveram conhecimento do preço do lote;" },
    { estilo: "corpo", texto: "b) teve/tiveram conhecimento do valor total da comissão de corretagem;" },
    { estilo: "corpo", texto: "c) recebeu/receberam informação sobre os respectivos beneficiários;" },
    { estilo: "corpo", texto: "d) recebeu/receberam informação acerca do custo total da aquisição;" },
    { estilo: "corpo", texto: "e) compreendeu/compreenderam que a comissão é obrigação autônoma e distinta do preço do lote;" },
    { estilo: "corpo", texto: "f) está/estão ciente(s) de que o pagamento da corretagem acompanha o fluxo das parcelas de sinal/entrada do Instrumento Particular de Venda e Compra;" },
    { estilo: "corpo", texto: "g) está/estão ciente(s) de que somente boleto ou PIX emitidos pelo ASAAS poderão ser utilizados para pagamento da comissão; e" },
    { estilo: "corpo", texto: "h) teve/tiveram oportunidade de ler este instrumento antes de sua assinatura." },
    { estilo: "corpo", texto: "A separação e o destaque prévio da corretagem seguem a lógica de transparência exigida pela legislação de loteamentos, que determina a indicação do valor, das condições de pagamento e do beneficiário." },
    { estilo: "titulo", texto: "XV – DA INTEGRAÇÃO COM O INSTRUMENTO PARTICULAR DE VENDA E COMPRA" },
    { estilo: "corpo", texto: "15.1. O presente instrumento deverá ser interpretado em conjunto com o Instrumento Particular de Venda e Compra de Imóvel com Alienação Fiduciária em Garantia e Outras Avenças do respectivo lote, especialmente quanto:" },
    { estilo: "corpo", texto: "a) à identificação da unidade;" },
    { estilo: "corpo", texto: "b) ao preço do lote;" },
    { estilo: "corpo", texto: "c) ao custo total da aquisição;" },
    { estilo: "corpo", texto: "d) ao valor da comissão de corretagem;" },
    { estilo: "corpo", texto: "e) aos beneficiários;" },
    { estilo: "corpo", texto: "f) aos vencimentos; e" },
    { estilo: "corpo", texto: "g) ao fluxo das parcelas de SINAL/ATO." },
    { estilo: "corpo", texto: "15.2. Em nenhuma hipótese poderá haver duplicidade de cobrança da comissão de corretagem." },
    { estilo: "corpo", texto: "15.3. O valor total da comissão indicado neste contrato deverá corresponder ao valor de corretagem informado no Quadro-Resumo do Instrumento Particular de Venda e Compra." },
    { estilo: "corpo", texto: "15.4. Eventual alteração posterior no fluxo financeiro das parcelas de SINAL/ATO que repercuta no vencimento das parcelas da corretagem somente produzirá efeitos sobre este instrumento quando formalmente comunicada e aceita pelos beneficiários afetados." },
    { estilo: "corpo", texto: "15.5. A comissão de corretagem, embora considerada para determinação do custo total da aquisição, não integra o preço do lote e não amortiza o saldo devedor imobiliário, salvo disposição expressa e juridicamente aplicável em sentido diverso." },
    { estilo: "titulo", texto: "XVI – DO TRATAMENTO DE DADOS PESSOAIS" },
    { estilo: "corpo", texto: "16.1. Os dados pessoais fornecidos pelo(s) CONTRATANTE(S) poderão ser tratados na medida necessária à execução deste contrato, à intermediação imobiliária, emissão e gestão das cobranças pelo ASAAS, emissão de documentos fiscais, atendimento a obrigações legais e regulatórias, prevenção à fraude e exercício regular de direitos." },
    { estilo: "corpo", texto: "16.2. Os dados poderão ser compartilhados, na extensão necessária, com a VENDEDORA, INTERMEDIADORES, plataforma ou instituição responsável pelo processamento dos pagamentos, prestadores de serviços, autoridades públicas e demais terceiros cuja participação seja necessária à execução do negócio ou ao cumprimento de obrigação legal." },
    { estilo: "titulo", texto: "XVII – DAS COMUNICAÇÕES" },
    { estilo: "corpo", texto: "17.1. As comunicações relacionadas a este contrato poderão ser realizadas por e-mail, WhatsApp, plataforma de assinatura eletrônica ou outro canal oficial que permita identificar a origem e o conteúdo da comunicação." },
    { estilo: "corpo", texto: "17.2. O(s) CONTRATANTE(S) obriga(m)-se a manter seus dados de contato atualizados." },
    { estilo: "corpo", texto: "17.3. Alterações de dados bancários ou meios de pagamento não serão comunicadas mediante envio de conta particular ou chave PIX de terceiro, devendo toda cobrança válida permanecer obrigatoriamente vinculada ao ASAAS." },
    { estilo: "titulo", texto: "XVIII – DO TÍTULO EXECUTIVO E DAS ASSINATURAS" },
    { estilo: "corpo", texto: "18.1. Este instrumento poderá constituir título executivo extrajudicial quando preenchidos os requisitos estabelecidos na legislação processual civil para obrigação líquida, certa e exigível." },
    { estilo: "corpo", texto: "18.2. As partes reconhecem como válidas as assinaturas eletrônicas ou digitais apostas neste contrato por plataforma que permita a identificação dos signatários e assegure a integridade do documento." },
    { estilo: "corpo", texto: "18.3. O presente instrumento obriga as partes e seus sucessores, respeitados os direitos assegurados pela legislação aplicável." },
    { estilo: "titulo", texto: "XIX – DAS DISPOSIÇÕES GERAIS" },
    { estilo: "corpo", texto: "19.1. A tolerância de qualquer das partes em relação ao descumprimento de obrigação não constituirá novação, renúncia ou alteração contratual." },
    { estilo: "corpo", texto: "19.2. A eventual invalidade ou ineficácia de disposição específica não prejudicará as demais cláusulas, que permanecerão válidas na extensão juridicamente possível." },
    { estilo: "corpo", texto: "19.3. Nenhuma promessa, declaração ou condição comercial realizada verbalmente modificará este contrato ou o Instrumento Particular de Venda e Compra." },
    { estilo: "corpo", texto: "19.4. Os INTERMEDIADORES não garantem valorização futura do imóvel, aprovação de financiamento, obtenção de licenças, possibilidade de exercício de atividade comercial específica ou quaisquer resultados estranhos aos serviços de intermediação." },
    { estilo: "corpo", texto: "19.5. Este instrumento substitui entendimentos anteriores relacionados especificamente às condições de pagamento da comissão de corretagem do imóvel aqui identificado." },
    { estilo: "titulo", texto: "XX – DO FORO" },
    { estilo: "corpo", texto: "20.1. Fica eleito o foro da Comarca de [empreendimento_cidade]/[empreendimento_uf] para dirimir eventuais controvérsias decorrentes deste contrato, sem prejuízo do foro legalmente assegurado ao consumidor quando aplicável." },
    { estilo: "corpo", texto: "E, por estarem de acordo, as partes firmam o presente instrumento por meio de assinatura eletrônica ou digital." },
    { estilo: "assinatura", texto: "[empreendimento_cidade]/[empreendimento_uf], [data_emissao_contrato]." },
    { estilo: "assinatura", texto: "(Assinado eletronicamente)" },
    { estilo: "assinatura", texto: "[nome_fantasia_coordenadora_vendas]" },
    { estilo: "assinatura", texto: "COORDENADORA DE VENDAS" },
    { estilo: "assinatura", texto: "(Assinado eletronicamente)" },
    { estilo: "assinatura", texto: "[nome_vinculado]" },
    { estilo: "assinatura", texto: "ASSOCIADO" },
    { estilo: "marcador", texto: "[inicio_cada_comprador]" },
    { estilo: "assinatura", texto: "(Assinado eletronicamente)" },
    { estilo: "assinatura", texto: "[inicio_dados_cliente_pf][nome_cliente][fim_dados_cliente_pf][inicio_dados_cliente_pj][nome_fantasia_cliente][fim_dados_cliente_pj]" },
    { estilo: "assinatura", texto: "COMPROMISSÁRIO(A) COMPRADOR(A)" },
    { estilo: "marcador", texto: "[inicio_dados_conjuge]" },
    { estilo: "assinatura", texto: "(Assinado eletronicamente)" },
    { estilo: "assinatura", texto: "[nome_conjuge]" },
    { estilo: "assinatura", texto: "CÔNJUGE" },
    { estilo: "marcador", texto: "[fim_dados_conjuge]" },
    { estilo: "marcador", texto: "[fim_cada_comprador]" },
    { estilo: "corpo", texto: "Testemunhas:" },
    { estilo: "assinatura", texto: "(Assinado eletronicamente)" },
    { estilo: "assinatura", texto: "Nome: VALERIO MANCUZO DE FIGUEIREDO" },
    { estilo: "assinatura", texto: "CPF: 001.539.686-05" },
    { estilo: "assinatura", texto: "(Assinado eletronicamente)" },
    { estilo: "assinatura", texto: "Nome: PAOLA CARLA DE CASTRO LINHARES" },
    { estilo: "assinatura", texto: "CPF: 092.158.996-42" },
    { estilo: "quebra", texto: "" },
  ],
  rotulo: "Contrato de corretagem",
};

const ANEXOS: BlocoPronto = {
  // OS ANEXOS — pedido do Lucas em 07/09/2026: *"ae podemos ter o bloco dos anexo"*, depois de
  // explicar que *"muita peça do contrato são PDF prontos que podemos somente anexar"* e que *"vai
  // ter situação que cada contrato tem que trazer a planta específica daquela unidade"*.
  //
  // ⚠️ A VARIÁVEL DE ANEXO NÃO VIRA TEXTO — ela marca um LUGAR. `[anexo_planta]` no meio da cláusula
  // insere a página ali; `[anexos_do_contrato]` no fim traz os que o texto não posicionou. É a
  // diferença entre estas e as outras ~280 do catálogo, e é por isso que a planta posicionada não
  // aparece de novo no fim.
  //
  // ⚠️ O ANEXO É UMA POSIÇÃO, NÃO UM TIPO. Lucas: *"não queria esses nomes já de uma vez, dei
  // somente exemplos"* e *"podemos ter já definido os campos anexo, 1,2,3"*. O que o `anexo_1` É
  // fica no cadastro do empreendimento; a minuta é daquele empreendimento, então quem escreve sabe
  // o que numerou. A quantidade também vem de lá: *"à medida que eu vou importando os anexos vai
  // fazendo essa conta"*.
  //
  // ⚠️ O TÍTULO DA LINHA SE ESCREVE SOZINHO. `[anexo_1_nome]` traz o nome do arquivo importado —
  // *"pode trazer o nome do anexo que foi importado na hora de ir para o contrato"*. Datilografar
  // "Convenção de condomínio" na minuta parece mais simples, até o dia em que o arquivo é trocado e
  // o contrato passa a anunciar um documento com o nome do anterior.
  //
  // ⚠️ E CADA UM VEM DENTRO DE UM PAR. Posição vazia é o normal, não a exceção. A cláusula que
  // anuncia "ANEXO II —" sem nada em seguida é pior do que não existir: o contrato assinado promete
  // uma peça que não está lá. `[inicio_tem_anexo_1]` faz a linha inteira sumir junto com o arquivo.
  descricao: "A cláusula que puxa as peças anexas — cada linha se nomeia e some se não houver arquivo.",
  id: "anexos",
  linhas: [
    { estilo: "titulo", texto: "CLÁUSULA — DOS ANEXOS" },
    {
      estilo: "corpo",
      texto:
        "Integram este contrato, para todos os fins de direito, os documentos relacionados a seguir, que os COMPRADORES declaram conhecer e aceitar como parte integrante e inseparável deste instrumento.",
    },
    {
      estilo: "corpo",
      texto: "[inicio_tem_anexo_1]ANEXO I — [anexo_1_nome][anexo_1][fim_tem_anexo_1]",
    },
    {
      estilo: "corpo",
      texto: "[inicio_tem_anexo_2]ANEXO II — [anexo_2_nome][anexo_2][fim_tem_anexo_2]",
    },
    {
      estilo: "corpo",
      texto: "[inicio_tem_anexo_3]ANEXO III — [anexo_3_nome][anexo_3][fim_tem_anexo_3]",
    },
    // O curinga fecha a lista: traz da posição 4 em diante o que o texto não posicionou, cada um com
    // o seu nome, sem que a minuta precise escrever uma linha por anexo.
    { estilo: "corpo", texto: "[anexos_do_contrato]" },
    {
      estilo: "corpo",
      texto:
        "Em caso de divergência entre o texto deste contrato e o conteúdo dos anexos, prevalecem as disposições deste instrumento.",
    },
  ],
  rotulo: "Anexos",
};

const FECHO: BlocoPronto = {
  // ⚠️ AS ASSINATURAS TAMBÉM ENTRAM NO LAÇO. Numa venda de três compradores casados são seis linhas
  // de assinatura, e é o lugar onde a minuta do legado mais errava: como cada linha era escrita à
  // mão com sufixo, sobrava linha de comprador que não existe e faltava linha de cônjuge que existe.
  descricao: "Foro, data e as linhas de assinatura — uma por comprador e por cônjuge.",
  id: "fecho",
  linhas: [
    { estilo: "titulo", texto: "CLÁUSULA — DO FORO" },
    {
      estilo: "corpo",
      texto:
        "Fica eleito o foro da comarca de [empreendimento_cidade]/[empreendimento_uf] para dirimir as questões oriundas deste contrato, com renúncia a qualquer outro, por mais privilegiado que seja.",
    },
    {
      estilo: "assinatura",
      texto: "[empreendimento_cidade]/[empreendimento_uf], [data_emissao_contrato_extenso].",
    },
    { estilo: "assinatura", texto: "_______________________________________" },
    { estilo: "assinatura", texto: "[vendedora_razao_social] — VENDEDORA" },
    { estilo: "marcador", texto: ABRE_COMPRADOR },
    { estilo: "assinatura", texto: "_______________________________________" },
    { estilo: "assinatura", texto: "[nome_cliente] — CPF [cpf_cliente]" },
    { estilo: "marcador", texto: "[inicio_dados_conjuge]" },
    { estilo: "assinatura", texto: "_______________________________________" },
    { estilo: "assinatura", texto: "[nome_conjuge] — CPF [cpf_conjuge]" },
    { estilo: "marcador", texto: "[fim_dados_conjuge]" },
    { estilo: "marcador", texto: FECHA_COMPRADOR },
  ],
  rotulo: "Foro e assinaturas",
};

/**
 * Os blocos, na ordem em que um contrato é escrito.
 *
 * ⚠️ A ORDEM É A DO CONTRATO, não a alfabética: partes, objeto, preço, corretagem, fecho. Quem monta
 * uma minuta do zero desce a lista clicando, e o documento sai na ordem certa sem reordenar nada.
 */
export const BLOCOS_PRONTOS: BlocoPronto[] = [
  PARTES_VENDEDORA,
  PARTES_COMPRADORES,
  OBJETO,
  PRECO,
  FLUXO_TABELA,
  FLUXO_ESCRITO,
  CORRETAGEM,
  CONTRATO_CORRETAGEM,
  ANEXOS,
  FECHO,
];

export function acharBlocoPronto(id: string): BlocoPronto | undefined {
  return BLOCOS_PRONTOS.find((b) => b.id === id);
}

/** Como cada estilo vira parágrafo na folha. O `marcador` fica igual ao corpo, só sem justificar. */
function paragrafo(linha: LinhaDoBloco): NoDoDocumento {
  const texto = { text: linha.texto };
  switch (linha.estilo) {
    case "assinatura":
      return { align: "center", children: [texto], type: "p" };
    case "aviso":
      return { children: [{ ...texto, italic: true }], type: "p" };
    case "ficha":
      return { children: [texto], type: "p" };
    case "marcador":
      return { children: [texto], type: "p" };
    // ⚠️ O ÚNICO NÓ DAQUI QUE NÃO É `p`. A quebra é um void de bloco (ver
    // `modules/temis/plugins/quebra-de-pagina-base.ts`): o `texto` da linha é ignorado de propósito,
    // porque conteúdo dentro dela vira linha em branco no topo da folha nova.
    case "quebra":
      return { children: [{ text: "" }], type: "quebra_pagina" };
    case "titulo":
      return { children: [{ ...texto, bold: true }], type: "p" };
    case "titulo_centro":
      return { align: "center", children: [{ ...texto, bold: true }], type: "p" };
    default:
      return { align: "justify", children: [texto], type: "p" };
  }
}

/**
 * O bloco como parágrafos, prontos para entrar na folha.
 *
 * ⚠️ AS VARIÁVEIS SAEM DAQUI COMO TEXTO `[nome]`, de propósito. Quem insere chama
 * `promoverVariaveisNoValor` (ou deixa o `normalizeNode` do plugin fazer), e aí cada `[nome]` vira o
 * nó de variável — o MESMO caminho por onde passa o que é colado e o que vem do .docx. Montar o nó
 * aqui duplicaria essa regra num segundo lugar, e o dia em que as duas divergissem produziria um
 * chip que o painel não conta.
 */
export function nosDoBloco(bloco: BlocoPronto): NoDoDocumento[] {
  return bloco.linhas.map(paragrafo);
}

/** O texto corrido do bloco — é o que `conferirBlocos` e `variaveisDoTexto` sabem ler. */
export function textoDoBloco(bloco: BlocoPronto): string {
  return bloco.linhas.map((l) => l.texto).join("\n");
}
