// AS VARIÁVEIS DO CONTRATO — o vocabulário que o jurídico já escreve.
//
// ⚠️ ESTE CATÁLOGO NÃO FOI INVENTADO. Ele foi MEDIDO: `scripts/temis/variaveis-das-minutas.mjs` leu
// as 60 minutas vivas do C2X e contou 223 nomes distintos no formato `[nome_da_variavel]`. Manter o
// mesmo vocabulário é o que permite o jurídico subir a minuta que já usa e reconhecer tudo — se
// renomeássemos para algo "melhor", cada minuta existente viraria retrabalho manual.
//
// O QUE O LEVANTAMENTO REVELOU, e que muda o desenho do módulo:
//
// 1. ATÉ CINCO COMPRADORES. Cada um com cônjuge, endereço e percentual de participação próprios
//    (`nome_cliente`, `nome_cliente_2` … `_5`). O primeiro NÃO tem sufixo e NÃO tem bloco
//    condicional — ele sempre existe. Do segundo em diante tudo vive dentro de
//    `[inicio_dados_cliente_N]` … `[fim_dados_cliente_N]`.
//
// 2. OS BLOCOS CONDICIONAIS SÃO O CORAÇÃO DA MINUTA, e são onde o legado erra. `[inicio_dados_
//    cliente_pf]` … `[fim_dados_cliente_pf]` marca o trecho que só sai para pessoa física, e o par
//    `_pj` o de jurídica. No contrato real do Villa Paris que auditamos, o bloco de PJ SAIU IMPRESSO
//    num comprador pessoa física — o motor do C2X não respeitou o par. É por isso que
//    `conferirBlocos` existe aqui e roda antes de publicar.
//
// 3. O "POR EXTENSO" É PAR, NÃO ENFEITE. Cada `[x]` numérico tem seu `[x_extenso]`, e os dois têm de
//    contar a mesma história. `lib/temis/por-extenso.ts` é quem escreve — e é ele que impede o
//    "trezentos metros quadrados metros quadrados" que saiu no contrato do Villa Paris.
//
// 4. HÁ VARIÁVEL FANTASMA NAS MINUTAS ANTIGAS: `[Nome]` e `[CPF]`, seis ocorrências, que nenhum
//    motor preenche — saem no papel como estão. Por isso `classificarVariaveis` separa as
//    desconhecidas em vez de ignorá-las: elas viram aviso na tela, antes de o contrato ir a
//    assinatura.

export type GrupoDeVariavel =
  | "bloco"
  | "comprador"
  | "conjuge"
  | "contrato"
  | "corretagem"
  | "empresa"
  | "gerado"
  | "plano"
  | "unidade"
  | "valores";

export type TipoDeVariavel =
  | "bloco_fim"
  | "bloco_inicio"
  | "data"
  | "dinheiro"
  | "extenso"
  | "gerado"
  | "numero"
  | "texto";

export type VariavelDoContrato = {
  /** Onde o Panteon busca o valor. Aparece na tela para o jurídico saber o que já é automático. */
  origem: string;
  exemplo: string;
  /** Quando é `x_extenso`, o nome da variável numérica que ela escreve. */
  extensoDe?: string;
  grupo: GrupoDeVariavel;
  /** Nome exato entre colchetes, sem os colchetes. */
  nome: string;
  rotulo: string;
  tipo: TipoDeVariavel;
};

/** O comprador 1 não tem sufixo; do 2 ao 5, sim. */
const SUFIXOS = ["", "_2", "_3", "_4", "_5"] as const;

type Base = Omit<VariavelDoContrato, "nome"> & { base: string };

// ── COMPRADOR (repete de 1 a 5) ──────────────────────────────────────────────
const COMPRADOR: Base[] = [
  { base: "nome_cliente", exemplo: "THIAGO HENRIQUE DE SOUZA", grupo: "comprador", origem: "Cadastro do comprador (CAD)", rotulo: "Nome", tipo: "texto" },
  { base: "identificacao_cliente", exemplo: "COMPRADOR", grupo: "comprador", origem: "Papel na venda", rotulo: "Identificação (comprador, cedente…)", tipo: "texto" },
  { base: "nacionalidade_cliente", exemplo: "brasileiro", grupo: "comprador", origem: "Cadastro do comprador (CAD)", rotulo: "Nacionalidade", tipo: "texto" },
  { base: "estado_civil_cliente", exemplo: "casado", grupo: "comprador", origem: "Cadastro do comprador (CAD)", rotulo: "Estado civil", tipo: "texto" },
  { base: "regime_casamento_cliente", exemplo: "comunhão parcial de bens", grupo: "comprador", origem: "Cadastro do comprador (CAD)", rotulo: "Regime de casamento", tipo: "texto" },
  { base: "profissao_cliente", exemplo: "engenheiro", grupo: "comprador", origem: "Cadastro do comprador (CAD)", rotulo: "Profissão", tipo: "texto" },
  { base: "cpf_cliente", exemplo: "123.456.789-00", grupo: "comprador", origem: "Cadastro do comprador (CAD)", rotulo: "CPF", tipo: "texto" },
  { base: "email_cliente", exemplo: "thiago@exemplo.com.br", grupo: "comprador", origem: "Cadastro do comprador (CAD)", rotulo: "E-mail", tipo: "texto" },
  { base: "telefone_cliente", exemplo: "(31) 99999-0000", grupo: "comprador", origem: "Cadastro do comprador (CAD)", rotulo: "Telefone", tipo: "texto" },
  { base: "rua_cliente", exemplo: "Rua das Acácias", grupo: "comprador", origem: "Endereço do cadastro", rotulo: "Logradouro", tipo: "texto" },
  { base: "numero_cliente", exemplo: "150", grupo: "comprador", origem: "Endereço do cadastro", rotulo: "Número", tipo: "texto" },
  { base: "bairro_cliente", exemplo: "Centro", grupo: "comprador", origem: "Endereço do cadastro", rotulo: "Bairro", tipo: "texto" },
  { base: "cidade_cliente", exemplo: "João Monlevade/MG", grupo: "comprador", origem: "Endereço do cadastro", rotulo: "Cidade/UF", tipo: "texto" },
  { base: "cep_cliente", exemplo: "35930-000", grupo: "comprador", origem: "Endereço do cadastro", rotulo: "CEP", tipo: "texto" },
  { base: "percentual_cliente", exemplo: "50%", grupo: "comprador", origem: "Participação definida na venda", rotulo: "Percentual de participação", tipo: "texto" },
];

// ── COMPRADOR PESSOA JURÍDICA ────────────────────────────────────────────────
const EMPRESA: Base[] = [
  { base: "razao_social_cliente", exemplo: "SOUZA PARTICIPAÇÕES LTDA.", grupo: "empresa", origem: "Cadastro PJ", rotulo: "Razão social", tipo: "texto" },
  { base: "nome_fantasia_cliente", exemplo: "Souza Participações", grupo: "empresa", origem: "Cadastro PJ", rotulo: "Nome fantasia", tipo: "texto" },
  { base: "cnpj_cliente", exemplo: "11.115.899/0001-04", grupo: "empresa", origem: "Cadastro PJ", rotulo: "CNPJ", tipo: "texto" },
];

// ── CÔNJUGE (um por comprador) ───────────────────────────────────────────────
const CONJUGE: Base[] = [
  { base: "nome_conjuge", exemplo: "MARIA DE SOUZA", grupo: "conjuge", origem: "Cônjuge no cadastro (CAD)", rotulo: "Nome do cônjuge", tipo: "texto" },
  { base: "nacionalidade_conjuge", exemplo: "brasileira", grupo: "conjuge", origem: "Cônjuge no cadastro (CAD)", rotulo: "Nacionalidade do cônjuge", tipo: "texto" },
  { base: "profissao_conjuge", exemplo: "professora", grupo: "conjuge", origem: "Cônjuge no cadastro (CAD)", rotulo: "Profissão do cônjuge", tipo: "texto" },
  { base: "cpf_conjuge", exemplo: "987.654.321-00", grupo: "conjuge", origem: "Cônjuge no cadastro (CAD)", rotulo: "CPF do cônjuge", tipo: "texto" },
  { base: "email_conjuge", exemplo: "maria@exemplo.com.br", grupo: "conjuge", origem: "Cônjuge no cadastro (CAD)", rotulo: "E-mail do cônjuge", tipo: "texto" },
  { base: "telefone_conjuge", exemplo: "(31) 98888-0000", grupo: "conjuge", origem: "Cônjuge no cadastro (CAD)", rotulo: "Telefone do cônjuge", tipo: "texto" },
];

// ── BLOCOS CONDICIONAIS (repetem por comprador) ──────────────────────────────
//
// ⚠️ O par `pf`/`pj` é o que decide QUAL parágrafo sai. Ele existe porque um contrato de pessoa
// jurídica não pode trazer estado civil e regime de bens, e um de pessoa física não pode trazer
// razão social. É exatamente aqui que o contrato do Villa Paris saiu errado.
const BLOCOS_POR_COMPRADOR: { fim: string; inicio: string; rotulo: string }[] = [
  { fim: "fim_dados_cliente_pf", inicio: "inicio_dados_cliente_pf", rotulo: "Só quando o comprador é pessoa FÍSICA" },
  { fim: "fim_dados_cliente_pj", inicio: "inicio_dados_cliente_pj", rotulo: "Só quando o comprador é pessoa JURÍDICA" },
  { fim: "fim_dados_conjuge", inicio: "inicio_dados_conjuge", rotulo: "Só quando o comprador tem cônjuge" },
];

// ── UNIDADE ──────────────────────────────────────────────────────────────────
const UNIDADE: VariavelDoContrato[] = [
  { exemplo: "12", grupo: "unidade", nome: "numero_quadra", origem: "Unidade vendida (Hércules)", rotulo: "Quadra", tipo: "texto" },
  { exemplo: "doze", extensoDe: "numero_quadra", grupo: "unidade", nome: "numero_quadra_extenso", origem: "Escrito pelo sistema", rotulo: "Quadra por extenso", tipo: "extenso" },
  { exemplo: "07", grupo: "unidade", nome: "numero_lote", origem: "Unidade vendida (Hércules)", rotulo: "Lote", tipo: "texto" },
  { exemplo: "sete", extensoDe: "numero_lote", grupo: "unidade", nome: "numero_lote_extenso", origem: "Escrito pelo sistema", rotulo: "Lote por extenso", tipo: "extenso" },
  { exemplo: "300,00 m²", grupo: "unidade", nome: "area_lote", origem: "Unidade vendida (Hércules)", rotulo: "Área do lote", tipo: "numero" },
  // ⚠️ SEM A UNIDADE NO EXTENSO: ver `areaPorExtenso` em por-extenso.ts. Foi o dado que já trazia
  // "m²" somado ao template que produziu "trezentos metros quadrados metros quadrados".
  { exemplo: "trezentos metros quadrados", extensoDe: "area_lote", grupo: "unidade", nome: "area_lote_extenso", origem: "Escrito pelo sistema", rotulo: "Área por extenso", tipo: "extenso" },
  { exemplo: "45.678", grupo: "unidade", nome: "numero_matricula", origem: "Matrícula da unidade", rotulo: "Matrícula", tipo: "texto" },
  { exemplo: "3", grupo: "unidade", nome: "numero_ficha_matricula", origem: "Matrícula da unidade", rotulo: "Ficha da matrícula", tipo: "texto" },
  { exemplo: "(recorte do masterplan)", grupo: "unidade", nome: "imagem_unidade", origem: "Masterplan do empreendimento", rotulo: "Imagem do lote", tipo: "gerado" },
  { exemplo: "12", grupo: "unidade", nome: "unidade_quadra", origem: "Unidade vendida (Hércules)", rotulo: "Quadra (nome alternativo)", tipo: "texto" },
  { exemplo: "07", grupo: "unidade", nome: "unidade_lote", origem: "Unidade vendida (Hércules)", rotulo: "Lote (nome alternativo)", tipo: "texto" },
  { exemplo: "300,00", grupo: "unidade", nome: "unidade_area", origem: "Unidade vendida (Hércules)", rotulo: "Área (nome alternativo)", tipo: "numero" },
];

// ── VALORES DA VENDA ─────────────────────────────────────────────────────────
const VALORES: VariavelDoContrato[] = [
  { exemplo: "R$ 185.400,00", grupo: "valores", nome: "valor_imovel_venda", origem: "Preço da venda", rotulo: "Valor do imóvel", tipo: "dinheiro" },
  { exemplo: "cento e oitenta e cinco mil e quatrocentos reais", extensoDe: "valor_imovel_venda", grupo: "valores", nome: "valor_imovel_venda_extenso", origem: "Escrito pelo sistema", rotulo: "Valor do imóvel por extenso", tipo: "extenso" },
  { exemplo: "R$ 185.400,00", grupo: "valores", nome: "preco_venda", origem: "Preço da venda", rotulo: "Preço de venda", tipo: "dinheiro" },
  { exemplo: "cento e oitenta e cinco mil e quatrocentos reais", extensoDe: "preco_venda", grupo: "valores", nome: "preco_venda_extenso", origem: "Escrito pelo sistema", rotulo: "Preço de venda por extenso", tipo: "extenso" },
  { exemplo: "R$ 148.320,00", grupo: "valores", nome: "valor_divida_financiada", origem: "Preço menos o sinal (plano)", rotulo: "Valor financiado", tipo: "dinheiro" },
  { exemplo: "cento e quarenta e oito mil trezentos e vinte reais", extensoDe: "valor_divida_financiada", grupo: "valores", nome: "valor_divida_financiada_extenso", origem: "Escrito pelo sistema", rotulo: "Valor financiado por extenso", tipo: "extenso" },
  // ⚠️ O MESMO NÚMERO COM DOIS PAPÉIS. Na minuta auditada, 185.400 aparecia como preço E como
  // garantia fiduciária. Trocar um pelo outro numa substituição global trocaria os dois — foi o que
  // o teste do marcador pegou, e é por isso que a substituição aqui nunca é cega.
  { exemplo: "R$ 185.400,00", grupo: "valores", nome: "valor_garantia_fiduciaria", origem: "Garantia definida no contrato", rotulo: "Valor da garantia fiduciária", tipo: "dinheiro" },
  { exemplo: "cento e oitenta e cinco mil e quatrocentos reais", extensoDe: "valor_garantia_fiduciaria", grupo: "valores", nome: "valor_garantia_fiduciaria_extenso", origem: "Escrito pelo sistema", rotulo: "Garantia fiduciária por extenso", tipo: "extenso" },
  { exemplo: "120", grupo: "valores", nome: "prazo_meses_amortizacao", origem: "Parcelas do plano", rotulo: "Prazo em meses", tipo: "numero" },
  { exemplo: "cento e vinte", extensoDe: "prazo_meses_amortizacao", grupo: "valores", nome: "prazo_meses_amortizacao_extenso", origem: "Escrito pelo sistema", rotulo: "Prazo por extenso", tipo: "extenso" },
];

// ── PLANOS NA FOLHA DA PROPOSTA ──────────────────────────────────────────────
//
// Estes nomes casam um a um com o `slot` do plano (`avista`, `curto`, `investidor`, `normal`) — foi
// o legado que fixou o vocabulário, e o cadastro do Temis o preservou.
const SLOTS_NA_MINUTA = ["normal", "normal_2", "investidor", "curto"] as const;
const CAMPOS_DO_PLANO: { rotulo: string; sufixo: string; tipo: TipoDeVariavel }[] = [
  { rotulo: "valor de tabela", sufixo: "valor_tabela", tipo: "dinheiro" },
  { rotulo: "sinal", sufixo: "valor_sinal", tipo: "dinheiro" },
  { rotulo: "quantidade de parcelas", sufixo: "quantidade_parcelas", tipo: "numero" },
  { rotulo: "valor da parcela", sufixo: "valor_parcelas", tipo: "dinheiro" },
];

// ── CORRETAGEM ───────────────────────────────────────────────────────────────
const CORRETAGEM: VariavelDoContrato[] = [
  { exemplo: "IMOBILIÁRIA CENTRAL LTDA.", grupo: "corretagem", nome: "nome_vinculado", origem: "Imobiliária ou corretor da venda", rotulo: "Nome do vinculado", tipo: "texto" },
  { exemplo: "11.222.333/0001-44", grupo: "corretagem", nome: "cpf_cnpj_vinculado", origem: "Imobiliária ou corretor da venda", rotulo: "CPF/CNPJ do vinculado", tipo: "texto" },
  { exemplo: "CRECI 12345", grupo: "corretagem", nome: "creci_vinculado", origem: "Imobiliária ou corretor da venda", rotulo: "CRECI do vinculado", tipo: "texto" },
  { exemplo: "(31) 3333-0000", grupo: "corretagem", nome: "telefone_vinculado", origem: "Imobiliária ou corretor da venda", rotulo: "Telefone do vinculado", tipo: "texto" },
  { exemplo: "contato@imobiliaria.com.br", grupo: "corretagem", nome: "email_vinculado", origem: "Imobiliária ou corretor da venda", rotulo: "E-mail do vinculado", tipo: "texto" },
  { exemplo: "Careli Vendas", grupo: "corretagem", nome: "nome_fantasia_coordenadora_vendas", origem: "Coordenadora de vendas do empreendimento", rotulo: "Coordenadora de vendas", tipo: "texto" },
  { exemplo: "11.115.899/0001-04", grupo: "corretagem", nome: "cnpj_coordenadora_vendas", origem: "Coordenadora de vendas do empreendimento", rotulo: "CNPJ da coordenadora", tipo: "texto" },
  { exemplo: "Avenida Central", grupo: "corretagem", nome: "rua_coordenadora_vendas", origem: "Coordenadora de vendas do empreendimento", rotulo: "Logradouro da coordenadora", tipo: "texto" },
  { exemplo: "1000", grupo: "corretagem", nome: "numero_coordenadora_vendas", origem: "Coordenadora de vendas do empreendimento", rotulo: "Número da coordenadora", tipo: "texto" },
  { exemplo: "Centro", grupo: "corretagem", nome: "bairro_coordenadora_vendas", origem: "Coordenadora de vendas do empreendimento", rotulo: "Bairro da coordenadora", tipo: "texto" },
  { exemplo: "Belo Horizonte/MG", grupo: "corretagem", nome: "cidade_coordenadora_vendas", origem: "Coordenadora de vendas do empreendimento", rotulo: "Cidade da coordenadora", tipo: "texto" },
  { exemplo: "30110-000", grupo: "corretagem", nome: "cep_coordenadora_vendas", origem: "Coordenadora de vendas do empreendimento", rotulo: "CEP da coordenadora", tipo: "texto" },
  { exemplo: "(31) 3333-1111", grupo: "corretagem", nome: "telefone_coordenadora_vendas", origem: "Coordenadora de vendas do empreendimento", rotulo: "Telefone da coordenadora", tipo: "texto" },
  { exemplo: "vendas@careli.adm.br", grupo: "corretagem", nome: "email_coordenadora_vendas", origem: "Coordenadora de vendas do empreendimento", rotulo: "E-mail da coordenadora", tipo: "texto" },
  { exemplo: "R$ 11.124,00", grupo: "corretagem", nome: "valor_total_comissao", origem: "Comissão do empreendimento sobre o preço", rotulo: "Comissão total", tipo: "dinheiro" },
  { exemplo: "onze mil cento e vinte e quatro reais", extensoDe: "valor_total_comissao", grupo: "corretagem", nome: "valor_total_comissao_extenso", origem: "Escrito pelo sistema", rotulo: "Comissão total por extenso", tipo: "extenso" },
  { exemplo: "R$ 3.708,00", grupo: "corretagem", nome: "valor_pago_coordenadora_vendas", origem: "Rateio da comissão", rotulo: "Parte da coordenadora", tipo: "dinheiro" },
  { exemplo: "três mil setecentos e oito reais", extensoDe: "valor_pago_coordenadora_vendas", grupo: "corretagem", nome: "valor_pago_coordenadora_vendas_extenso", origem: "Escrito pelo sistema", rotulo: "Parte da coordenadora por extenso", tipo: "extenso" },
  { exemplo: "R$ 7.416,00", grupo: "corretagem", nome: "valor_corretagem_menos_coordenadora_vendas", origem: "Rateio da comissão", rotulo: "Corretagem menos a coordenadora", tipo: "dinheiro" },
  { exemplo: "sete mil quatrocentos e dezesseis reais", extensoDe: "valor_corretagem_menos_coordenadora_vendas", grupo: "corretagem", nome: "valor_corretagem_menos_coordenadora_vendas_extenso", origem: "Escrito pelo sistema", rotulo: "Corretagem menos coordenadora por extenso", tipo: "extenso" },
];

// ── CONTRATO E TRECHOS GERADOS ───────────────────────────────────────────────
const CONTRATO: VariavelDoContrato[] = [
  { exemplo: "01 de setembro de 2026", grupo: "contrato", nome: "data_emissao_contrato", origem: "Data em que o contrato é gerado", rotulo: "Data de emissão", tipo: "data" },
];

// ⚠️ ESTES NÃO SÃO CAMPOS, SÃO TRECHOS INTEIROS que o sistema escreve — parágrafo e tabela. Quem
// edita a minuta posiciona o marcador; o texto sai do plano da venda. Apagar o marcador não deixa a
// frase em branco: some com o parágrafo do contrato.
const GERADOS: VariavelDoContrato[] = [
  { exemplo: "(parágrafo do sinal, com valor e vencimento)", grupo: "gerado", nome: "paragrafo_sinal", origem: "Plano da venda", rotulo: "Parágrafo do sinal", tipo: "gerado" },
  { exemplo: "(parágrafo do parcelamento)", grupo: "gerado", nome: "paragrafo_parcelamento", origem: "Plano da venda", rotulo: "Parágrafo do parcelamento", tipo: "gerado" },
  { exemplo: "(parágrafo dos vencimentos)", grupo: "gerado", nome: "paragrafo_vencimento", origem: "Plano da venda", rotulo: "Parágrafo do vencimento", tipo: "gerado" },
  { exemplo: "(tabela das parcelas)", grupo: "gerado", nome: "tabela_pagamentos", origem: "Plano da venda", rotulo: "Tabela de pagamentos", tipo: "gerado" },
  { exemplo: "(tabela geral das parcelas)", grupo: "gerado", nome: "tabela_geral_pagamentos", origem: "Plano da venda", rotulo: "Tabela geral de pagamentos", tipo: "gerado" },
];

/** Acrescenta o sufixo ao nome mantendo a leitura ("nome_cliente" + "_2"). */
function comSufixo(base: string, sufixo: string): string {
  return `${base}${sufixo}`;
}

function expandirPorComprador(bases: Base[]): VariavelDoContrato[] {
  const saida: VariavelDoContrato[] = [];
  for (const [indice, sufixo] of SUFIXOS.entries()) {
    const ordinal = indice + 1;
    for (const b of bases) {
      saida.push({
        exemplo: b.exemplo,
        grupo: b.grupo,
        nome: comSufixo(b.base, sufixo),
        origem: b.origem,
        rotulo: ordinal === 1 ? b.rotulo : `${b.rotulo} — ${ordinal}º comprador`,
        tipo: b.tipo,
      });
    }
  }
  return saida;
}

function expandirBlocos(): VariavelDoContrato[] {
  const saida: VariavelDoContrato[] = [];

  for (const [indice, sufixo] of SUFIXOS.entries()) {
    const ordinal = indice + 1;

    // ⚠️ O PRIMEIRO COMPRADOR NÃO TEM BLOCO PRÓPRIO, e não é esquecimento do legado: ele sempre
    // existe. Do segundo em diante o bloco é o que faz o trecho sumir quando a venda tem menos gente.
    if (ordinal > 1) {
      saida.push(
        {
          exemplo: "",
          grupo: "bloco",
          nome: `inicio_dados_cliente${sufixo}`,
          origem: "Sai só quando a venda tem esse comprador",
          rotulo: `Início — dados do ${ordinal}º comprador`,
          tipo: "bloco_inicio",
        },
        {
          exemplo: "",
          grupo: "bloco",
          nome: `fim_dados_cliente${sufixo}`,
          origem: "Sai só quando a venda tem esse comprador",
          rotulo: `Fim — dados do ${ordinal}º comprador`,
          tipo: "bloco_fim",
        },
      );
    }

    for (const bloco of BLOCOS_POR_COMPRADOR) {
      saida.push(
        {
          exemplo: "",
          grupo: "bloco",
          nome: comSufixo(bloco.inicio, sufixo),
          origem: bloco.rotulo,
          rotulo: ordinal === 1 ? `Início — ${bloco.rotulo}` : `Início — ${bloco.rotulo} (${ordinal}º)`,
          tipo: "bloco_inicio",
        },
        {
          exemplo: "",
          grupo: "bloco",
          nome: comSufixo(bloco.fim, sufixo),
          origem: bloco.rotulo,
          rotulo: ordinal === 1 ? `Fim — ${bloco.rotulo}` : `Fim — ${bloco.rotulo} (${ordinal}º)`,
          tipo: "bloco_fim",
        },
      );
    }
  }

  return saida;
}

function expandirPlanos(): VariavelDoContrato[] {
  const saida: VariavelDoContrato[] = [];
  for (const slot of SLOTS_NA_MINUTA) {
    for (const campo of CAMPOS_DO_PLANO) {
      saida.push({
        exemplo: campo.tipo === "dinheiro" ? "R$ 185.400,00" : "120",
        grupo: "plano",
        nome: `plano_${slot}_${campo.sufixo}`,
        origem: `Plano na posição "${slot.replace("_2", " (segundo)")}" do empreendimento`,
        rotulo: `Plano ${slot.replace("_", " ")} — ${campo.rotulo}`,
        tipo: campo.tipo,
      });
    }
  }
  return saida;
}

/**
 * Todas as variáveis que o Temis sabe preencher.
 *
 * ⚠️ É a lista MEDIDA nas minutas do C2X, não uma lista desejada. Ver a nota do topo.
 */
export const VARIAVEIS_DO_CONTRATO: VariavelDoContrato[] = [
  ...expandirPorComprador(COMPRADOR),
  ...expandirPorComprador(EMPRESA),
  ...expandirPorComprador(CONJUGE),
  ...expandirBlocos(),
  ...UNIDADE,
  ...VALORES,
  ...expandirPlanos(),
  ...CORRETAGEM,
  ...CONTRATO,
  ...GERADOS,
];

const PORNOME = new Map(VARIAVEIS_DO_CONTRATO.map((v) => [v.nome, v]));

/** A variável, se o Temis souber preenchê-la. */
export function acharVariavel(nome: string): undefined | VariavelDoContrato {
  return PORNOME.get(nome);
}

/** Os nomes entre colchetes que aparecem no texto, na ordem em que aparecem. */
export function variaveisDoTexto(texto: string): string[] {
  return [...texto.matchAll(/\[([A-Za-z0-9_]{2,80})\]/g)].map((m) => m[1] as string);
}

export type Classificacao = {
  /** Quantas vezes cada variável conhecida aparece. */
  conhecidas: { nome: string; ocorrencias: number; variavel: VariavelDoContrato }[];
  /** Aparecem no texto mas nenhum motor preenche — saem impressas como estão. */
  desconhecidas: { nome: string; ocorrencias: number }[];
};

/**
 * Separa o que o sistema preenche do que vai sair impresso literalmente.
 *
 * ⚠️ ISTO É O AVISO QUE FALTAVA NO LEGADO. `[Nome]` e `[CPF]` existem em minutas antigas e nenhum
 * motor os conhece: o contrato sai com "[Nome]" escrito no papel. Aqui elas aparecem na tela antes
 * de o documento ir para assinatura.
 */
export function classificarVariaveis(texto: string): Classificacao {
  const contagem = new Map<string, number>();
  for (const nome of variaveisDoTexto(texto)) {
    contagem.set(nome, (contagem.get(nome) ?? 0) + 1);
  }

  const conhecidas: Classificacao["conhecidas"] = [];
  const desconhecidas: Classificacao["desconhecidas"] = [];

  for (const [nome, ocorrencias] of contagem) {
    const variavel = PORNOME.get(nome);
    if (variavel) conhecidas.push({ nome, ocorrencias, variavel });
    else desconhecidas.push({ nome, ocorrencias });
  }

  conhecidas.sort((a, b) => b.ocorrencias - a.ocorrencias);
  desconhecidas.sort((a, b) => b.ocorrencias - a.ocorrencias);
  return { conhecidas, desconhecidas };
}

export type ProblemaDeBloco = {
  bloco: string;
  problema: "abre_sem_fechar" | "fecha_sem_abrir" | "fora_de_ordem";
  texto: string;
};

/**
 * Confere se cada `[inicio_x]` tem o seu `[fim_x]`, na ordem certa.
 *
 * ⚠️ ESTE É O DEFEITO QUE JÁ CHEGOU AO CLIENTE. No contrato do Villa Paris o bloco de pessoa
 * jurídica saiu impresso num comprador pessoa física. Um bloco desbalanceado faz o motor imprimir o
 * trecho que devia sumir — ou sumir com o trecho que devia sair. Nenhum dos dois dá erro; os dois
 * saem no papel que o cliente assina. Por isso a conferência roda ANTES de publicar a minuta.
 */
export function conferirBlocos(texto: string): ProblemaDeBloco[] {
  const problemas: ProblemaDeBloco[] = [];
  const pilha: string[] = [];

  for (const nome of variaveisDoTexto(texto)) {
    if (nome.startsWith("inicio_")) {
      pilha.push(nome.slice("inicio_".length));
      continue;
    }
    if (!nome.startsWith("fim_")) continue;

    const bloco = nome.slice("fim_".length);
    const topo = pilha[pilha.length - 1];

    if (topo === bloco) {
      pilha.pop();
      continue;
    }

    if (pilha.includes(bloco)) {
      // Fecha um bloco que não é o mais interno: os trechos se cruzam, e o motor decide sozinho
      // onde cada um termina.
      problemas.push({
        bloco,
        problema: "fora_de_ordem",
        texto: `O bloco "${bloco}" fecha antes de "${topo}", que foi aberto depois dele. Os trechos estão cruzados.`,
      });
      // Descarta até o bloco fechado para não repetir o mesmo aviso em cascata.
      while (pilha.length && pilha.pop() !== bloco) {
        /* desempilha */
      }
      continue;
    }

    problemas.push({
      bloco,
      problema: "fecha_sem_abrir",
      texto: `Existe [fim_${bloco}] sem o [inicio_${bloco}] correspondente.`,
    });
  }

  for (const bloco of pilha) {
    problemas.push({
      bloco,
      problema: "abre_sem_fechar",
      texto: `Existe [inicio_${bloco}] sem o [fim_${bloco}] correspondente.`,
    });
  }

  return problemas;
}

/**
 * Pares valor/extenso em que só um dos dois está na minuta.
 *
 * O contrato que escreve "R$ 185.400,00" sem o extenso ao lado é aceito pelo cartório, mas o que
 * escreve só o extenso perde o número — e o que tem o extenso de um valor que não aparece no texto
 * quase sempre é sobra de um copiar e colar.
 */
export function extensosOrfaos(texto: string): string[] {
  const presentes = new Set(variaveisDoTexto(texto));
  const orfaos: string[] = [];
  for (const nome of presentes) {
    const v = PORNOME.get(nome);
    if (v?.extensoDe && !presentes.has(v.extensoDe)) orfaos.push(nome);
  }
  return orfaos.sort();
}

/** Rótulo do grupo, para o menu do editor. */
export function rotuloDoGrupo(grupo: GrupoDeVariavel): string {
  const mapa: Record<GrupoDeVariavel, string> = {
    bloco: "Blocos condicionais",
    comprador: "Comprador",
    conjuge: "Cônjuge",
    contrato: "Contrato",
    corretagem: "Corretagem",
    empresa: "Comprador pessoa jurídica",
    gerado: "Trechos escritos pelo sistema",
    plano: "Planos de pagamento",
    unidade: "Unidade",
    valores: "Valores da venda",
  };
  return mapa[grupo];
}

/** A ordem em que os grupos aparecem no menu: do mais usado ao mais raro. */
export const ORDEM_DOS_GRUPOS: GrupoDeVariavel[] = [
  "comprador",
  "conjuge",
  "empresa",
  "unidade",
  "valores",
  "plano",
  "corretagem",
  "contrato",
  "gerado",
  "bloco",
];
