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
  /** Marcador de bloco sozinho na linha (`[inicio_cada_comprador]`), como o legado escreve. */
  | "marcador"
  /** Título da cláusula, em negrito. */
  | "titulo";

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

const PARTES: BlocoPronto = {
  descricao: "Vendedora e compradores qualificados, com PF, PJ e cônjuge já separados.",
  id: "partes",
  linhas: [
    { estilo: "titulo", texto: "CLÁUSULA PRIMEIRA — DAS PARTES" },
    {
      estilo: "corpo",
      texto:
        "[vendedora_razao_social], pessoa jurídica de direito privado, [vendedora_natureza_juridica], inscrita no CNPJ sob o nº [vendedora_cnpj], com sede na [vendedora_rua], [vendedora_numero], [vendedora_bairro], [vendedora_cidade], [vendedora_uf], CEP [vendedora_cep], neste ato representada por [vendedora_representante_nome], inscrito no CPF sob o nº [vendedora_representante_cpf], doravante denominada VENDEDORA.",
    },
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
  rotulo: "Partes",
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
  PARTES,
  OBJETO,
  PRECO,
  FLUXO_TABELA,
  FLUXO_ESCRITO,
  CORRETAGEM,
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
    case "marcador":
      return { children: [texto], type: "p" };
    case "titulo":
      return { children: [{ ...texto, bold: true }], type: "p" };
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
