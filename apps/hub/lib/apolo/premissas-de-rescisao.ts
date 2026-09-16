// AS PREMISSAS DE RESCISÃO CADASTRADAS — a ponte entre a tela do empreendimento e a conta.
//
// Lucas (14/09/2026): *"vamos precisar ter esses parâmetros de rescisão nas politicas comerciais,
// essas aliquotas precisam ser cadastradas para que o sistema puxe isso"*, e *"a ideia é ter as
// premissas para gente montar isso por empreendimento"*.
//
// ⚠️ ESTA TABELA EXISTE PORQUE LER O CONTRATO NÃO RESOLVE, e isso foi medido nos 3.020 contratos
// com texto do C2X: cláusula penal aparece em 13 dos 32 empreendimentos, publicidade em 6,
// corretagem em 18 (de 1,5% a 8%) e fruição em 26. Um documento que deduz 10% só quando acha a
// palavra no texto produz número diferente para dois clientes do mesmo empreendimento.
//
// ⚠️ E "MULTA PENAL" TEM MAIS DE UM DONO NO TEXTO, o que fecha a porta de vez para a leitura
// automática. `lib/hades/dossie/encargos.ts` casa "multa penal de X%" como multa DE MORA (2%), e
// está certo na minuta antiga da Lavra do Ouro. Mas o contrato 2038 do Cidade Jardim diz *"multa
// penal de 0,5% ... por dia em que perdurar esbulho"* — terceira coisa, terceiro sentido. Procurar
// a cláusula penal compensatória de 10% no texto devolveria 2% ou 0,5% num papel que ninguém
// reconfere.
//
// ⚠️ A MORA NÃO MORA AQUI. Juros e multa de parcela vencida já são cadastrados no C2X
// (`commercial_policies.non_compliance_interest` e `.non_compliance_fine`), preenchidos em 33 dos
// 37 empreendimentos com 1,00% e 2,00%, sem uma variação — e a aba Política Comercial do Apolo já
// os mostra. Os 4 sem cadastro não têm contrato algum. Repetir isso aqui criaria duas verdades.

import {
  itensDoMenorRecorte,
  type OrigemDoRecorte,
  type RecorteDaUnidade,
} from "@/lib/hercules/recorte-da-unidade";

import type {
  BaseDeCalculo,
  PremissaDaRescisao,
  RubricaCadastravel,
} from "@/lib/apolo/rescisao";

/** A linha como sai de `hercules_premissas_de_rescisao`. */
export type LinhaDePremissa = {
  ativa: boolean;
  base: string;
  clausula: null | string;
  enterpriseId: null | string;
  id?: string;
  percentual: null | number;
  periodicidade: string;
  rubrica: string;
};

/** O que a tela mostra para cada rubrica, na ordem em que o termo imprime. */
export const RUBRICAS: {
  ajuda: string;
  bases: BaseDeCalculo[];
  rotulo: string;
  valor: RubricaCadastravel;
}[] = [
  {
    ajuda: "A multa compensatória do distrato. Não confundir com a multa de mora da parcela vencida, que é cadastrada na política comercial.",
    bases: [
      "valor_de_tabela_menos_comissao",
      "valor_de_tabela",
      "valor_do_contrato",
      "valor_do_contrato_atualizado",
      "total_pago",
    ],
    rotulo: "Multa penal",
    valor: "clausula_penal",
  },
  {
    ajuda: "Ressarcimento das despesas de publicidade do empreendimento.",
    bases: [
      "valor_de_tabela_menos_comissao",
      "valor_de_tabela",
      "valor_do_contrato",
      "valor_do_contrato_atualizado",
      "total_pago",
    ],
    rotulo: "Publicidade",
    valor: "publicidade",
  },
  {
    ajuda: "A comissão paga ao corretor na venda. Quando o contrato registra o valor em reais, ele manda e o percentual vira só o rótulo.",
    bases: ["valor_efetivo", "valor_de_tabela", "valor_do_contrato"],
    rotulo: "Corretagem",
    valor: "corretagem",
  },
  {
    ajuda: "Tributos incidentes sobre o que a empresa recebeu. A base é o total pago, não o valor do imóvel.",
    bases: ["total_pago", "valor_do_contrato", "valor_de_tabela"],
    rotulo: "Tributos",
    valor: "tributos",
  },
  {
    ajuda: "Pelo tempo de ocupação do imóvel (Lei 13.786/18). Só entra na conta quando há data de posse cadastrada no contrato.",
    bases: ["valor_do_contrato_atualizado", "valor_do_contrato", "valor_de_tabela"],
    rotulo: "Fruição",
    valor: "fruicao",
  },
];

/**
 * Como a TELA escreve cada base, no seletor do formulario.
 *
 * ⚠️ O NOME CARREGA O "NA_TELA" DE PROPOSITO. `rescisao.ts` tem um `ROTULO_DA_BASE` privado com o
 * mesmo tipo `Record<BaseDeCalculo, string>` e textos DIFERENTES — la sao fragmentos de frase para
 * o papel ("10,00% sobre o valor de tabela"), aqui sao rotulos de campo. Com o mesmo nome, trocar
 * um import pelo outro compilaria sem um aviso e mudaria o que o termo imprime.
 */
export const ROTULO_DA_BASE_NA_TELA: Record<BaseDeCalculo, string> = {
  total_pago: "Total pago pelo cliente",
  valor_de_tabela: "Valor de tabela da unidade",
  valor_de_tabela_menos_comissao: "Valor de tabela menos a comissão",
  valor_do_contrato: "Valor do contrato",
  valor_do_contrato_atualizado: "Valor do contrato atualizado",
  valor_efetivo: "O valor em reais do contrato (sem recalcular)",
};

const RUBRICAS_VALIDAS = new Set<string>(RUBRICAS.map((r) => r.valor));
const BASES_VALIDAS = new Set<string>(Object.keys(ROTULO_DA_BASE_NA_TELA));

function ehRubrica(v: string): v is RubricaCadastravel {
  return RUBRICAS_VALIDAS.has(v);
}

function ehBase(v: string): v is BaseDeCalculo {
  return BASES_VALIDAS.has(v);
}

export type PremissasResolvidas = {
  /** De onde cada rubrica veio: o empreendimento da unidade, ou o pai. Vai impresso no termo. */
  origemPorRubrica: Partial<Record<RubricaCadastravel, OrigemDoRecorte>>;
  /**
   * Só as rubricas CADASTRADAS. Rubrica sem cadastro é CHAVE AUSENTE, nunca chave com `undefined`:
   * `calcularRescisao` distingue os dois, e um `undefined` explícito passaria por cadastro que
   * ninguém fez.
   */
  premissas: Partial<Record<RubricaCadastravel, PremissaDaRescisao>>;
};

/**
 * Resolve as premissas que valem para esta unidade, rubrica por rubrica.
 *
 * ⚠️ A PRECEDÊNCIA É POR RUBRICA, E NÃO PELO CONJUNTO — é aqui que esta régua se separa da dos
 * planos. Para planos, a tabela do filho SUBSTITUI a do pai inteira: a unidade é vendida por uma
 * tabela só. Para premissas, cada rubrica é independente, e aplicar o conjunto faria com que
 * cadastrar apenas "publicidade" no filho APAGASSE a cláusula penal herdada do pai — a dedução
 * mais pesada do termo sumiria do papel porque alguém cadastrou uma rubrica menor.
 *
 * O que continua igual é o motor: `itensDoMenorRecorte` é chamado uma vez por rubrica, então a
 * ordem categoria → filho → pai é exatamente a mesma régua da casa, sem segunda implementação.
 */
export function premissasDoRecorte(
  recorte: RecorteDaUnidade,
  linhas: readonly LinhaDePremissa[],
): PremissasResolvidas {
  const premissas: Partial<Record<RubricaCadastravel, PremissaDaRescisao>> = {};
  const origemPorRubrica: Partial<Record<RubricaCadastravel, OrigemDoRecorte>> = {};

  for (const rubrica of RUBRICAS) {
    // ⚠️ `ativa` É OLHADA DEPOIS DA RÉGUA, E NÃO ANTES — a ordem inverte o resultado. Filtrando
    // antes, o filho que DESLIGA a publicidade (com a cláusula explicando por que não cobra) fica
    // sem nenhuma linha daquela rubrica, a régua sobe para o pai e o termo deduz 4% de um cliente
    // cujo empreendimento decidiu não cobrar. É o oposto do que a própria coluna promete na 0166:
    // *"Desligada continua cadastrada ... para explicar por que aquele empreendimento nao cobra"*.
    // O nível que TEM cadastro fecha a questão, inclusive quando o cadastro diz "não cobre".
    const daRubrica = linhas.filter((l) => String(l.rubrica).trim() === rubrica.valor);
    if (daRubrica.length === 0) continue;

    const escolha = itensDoMenorRecorte(recorte, daRubrica);
    const linha = escolha.itens[0];
    if (!linha || !escolha.origem) continue;
    if (!linha.ativa) continue;

    const base = String(linha.base).trim();
    if (!ehBase(base)) continue;

    // ⚠️ A BASE TEM DE SERVIR À RUBRICA, e conferir isso na LEITURA é o que fecha a terceira porta.
    // São três réguas: o CHECK do banco aceita qualquer uma das seis bases para qualquer rubrica;
    // `conferirPremissa` (a gravação pela tela) só aceita as da rubrica; e a leitura ficaria no
    // meio. Uma linha nascida de SQL direto ou de backfill entraria com `fruicao` sobre
    // `total_pago` e a conta multiplicaria o total pago pelos meses de ocupação. Linha assim é
    // ignorada, e a rubrica cai na praxe — que já sai avisada no termo.
    if (!rubrica.bases.includes(base)) continue;

    premissas[rubrica.valor] = {
      base,
      clausula: linha.clausula,
      percentual:
        typeof linha.percentual === "number" && Number.isFinite(linha.percentual)
          ? linha.percentual
          : null,
      periodicidade: String(linha.periodicidade).trim() === "mensal" ? "mensal" : "unica",
    };
    origemPorRubrica[rubrica.valor] = escolha.origem;
  }

  return { origemPorRubrica, premissas };
}

/** O formato de erro da casa: o campo que errou e a frase que a tela mostra. */
export type ErroDePremissa = { campo: string; mensagem: string };

/**
 * Confere uma premissa antes de gravar.
 *
 * ⚠️ AS TRAVAS AQUI SÃO AS MESMAS DOS CHECKs DA MIGRATION 0166, de propósito. O banco é a garantia
 * final; esta função existe para que o operador leia "mensal só existe para fruição" em vez de um
 * `23514` com o nome da constraint.
 */
export function conferirPremissa(entrada: {
  ativa: unknown;
  base: unknown;
  clausula?: unknown;
  percentual: unknown;
  periodicidade: unknown;
  rubrica: unknown;
}): ErroDePremissa[] {
  const erros: ErroDePremissa[] = [];

  const rubrica = String(entrada.rubrica ?? "").trim();
  if (!ehRubrica(rubrica)) {
    erros.push({ campo: "rubrica", mensagem: "Rubrica desconhecida." });
  }

  const base = String(entrada.base ?? "").trim();
  if (!ehBase(base)) {
    erros.push({ campo: "base", mensagem: "Escolha sobre o que o percentual incide." });
  } else if (ehRubrica(rubrica)) {
    const permitidas = RUBRICAS.find((r) => r.valor === rubrica)?.bases ?? [];
    if (!permitidas.includes(base)) {
      erros.push({
        campo: "base",
        mensagem: `Esta base não se aplica a ${RUBRICAS.find((r) => r.valor === rubrica)?.rotulo}.`,
      });
    }
  }

  const periodicidade = String(entrada.periodicidade ?? "").trim();
  if (periodicidade !== "mensal" && periodicidade !== "unica") {
    erros.push({ campo: "periodicidade", mensagem: "Periodicidade inválida." });
  } else if (periodicidade === "mensal" && rubrica !== "fruicao") {
    erros.push({
      campo: "periodicidade",
      mensagem: "Só a fruição é cobrada por mês. As demais rubricas deduzem uma vez.",
    });
  }

  const ativa = entrada.ativa === true;
  const percentual = entrada.percentual;
  const temNumero = typeof percentual === "number" && Number.isFinite(percentual);

  if (temNumero && (percentual < 0 || percentual > 100)) {
    erros.push({ campo: "percentual", mensagem: "O percentual tem de estar entre 0 e 100." });
  }

  // ⚠️ A EXCEÇÃO DO `valor_efetivo` É DELIBERADA e vem da migration: a corretagem costuma ser o
  // valor em reais que saiu do caixa lá atrás. Exigir percentual nas cinco rubricas impediria de
  // cadastrar a corretagem do jeito que o próprio banco previu.
  if (ativa && base !== "valor_efetivo" && !temNumero) {
    erros.push({ campo: "percentual", mensagem: "Informe o percentual desta rubrica." });
  }

  const clausula = entrada.clausula == null ? "" : String(entrada.clausula);
  if (clausula.length > 2000) {
    erros.push({ campo: "clausula", mensagem: "O trecho do contrato passa de 2.000 caracteres." });
  }

  return erros;
}
