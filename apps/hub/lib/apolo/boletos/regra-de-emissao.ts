// QUEM RECEBE BOLETO NO MÊS — e, quando não recebe, por quê.
//
// ⚠️ TER VALOR NA CÉLULA DO MÊS NÃO SIGNIFICA EMITIR. É a regra inteira deste arquivo, e ela
// nasceu de um erro meu: na conferência do Garden somei a coluna do mês e listei como pendentes
// dois clientes que já tinham pago — a informação estava numa coluna de observação que eu não
// tinha lido. O Lucas corrigiu: *"a meire pagou até dezembro (...) o GUSTAVO MENDES DUARTE,
// pagou a de setembro, isso estava na tabela, vc não leu"*.
//
// No arquivo de 31/08 o mesmo padrão aparece em oito clientes, e num deles de forma perigosa: o
// GUSTAVO AUGUSTO COLEHO (Ed. Esmeralda) tem R$ 1.682,16 calculados para setembro E a observação
// "Não fazer", com o rodapé da aba explicando que a obra atrasou e a parcela foi paralisada.
// Quem somasse a coluna emitiria um boleto que ninguém mandou emitir.
//
// ⚠️ AS MARCAÇÕES VÊM DE TRÊS LUGARES, e os três precisam ser lidos:
//   1. DENTRO da célula do mês, no lugar do número ("Não fazer");
//   2. numa coluna SOLTA depois do último mês, sem cabeçalho ("PAGO ATÉ DEZ/26 RETOMA JAN/27");
//   3. NA COLUNA DE CONTATO, no lugar do telefone ("PAGA AQUI -NÃO FAZER").
//
// ⚠️ O TERCEIRO LUGAR CUSTOU R$ 3.245,08 PARA APARECER. O ROMULO ANTONIO SIQUEIRA GARCIA (Ed.
// Rubi, apto 402) tem o valor de setembro calculado normalmente na planilha e nenhuma observação
// — o recado está onde deveria estar o telefone dele. Com a regra lendo só os dois primeiros
// lugares, ele era o único da CER que sairia errado: boleto cheio para quem já paga direto.
// Medido em 01/09/2026 varrendo as seis primeiras colunas das nove abas: é o único caso do
// arquivo, e é justamente na carteira que emite primeiro.
//
// ⚠️ E NEM TODA OBSERVAÇÃO BLOQUEIA. "PARCELA IREAJUSTAVEL" e "PARCELA FIXA PAGA TODOS OS
// REAJUSTES DO ANO ATUAL NO PROXIMO" são informativas: o cliente recebe boleto normalmente.
// Tratar toda observação como bloqueio deixaria dois clientes sem cobrança.

export type LinhaDaPlanilha = {
  /**
   * A coluna de contato — telefone, "WHATSAPP", "EMAIL"…
   *
   * ⚠️ ELA TAMBÉM CARREGA RECADO. Só um texto de bloqueio conhecido impede a emissão; qualquer
   * outro conteúdo é contato normal e passa. Tratar "texto no contato" como bloqueio deixaria
   * sem boleto todo mundo das abas de loteamento, onde a coluna diz a forma de envio.
   */
  contato?: null | string;
  /** Texto encontrado NA célula do mês, quando não era número. */
  marcaNoMes?: null | string;
  nome: string;
  /** Texto das colunas soltas depois do último mês. */
  observacao?: null | string;
  /** O número na célula do mês, quando havia. */
  valor?: null | number;
};

export type MotivoDeNaoEmitir =
  | "carne-ja-enviado"
  | "marcado-nao-fazer"
  | "nao-comecou"
  | "pago-adiantado"
  | "paralisado"
  | "sem-valor"
  | "valor-zerado";

export type Veredito =
  | { emite: false; explicacao: string; motivo: MotivoDeNaoEmitir }
  | { emite: true; observacao: null | string; valor: number };

const semAcento = (t: string) =>
  String(t ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/**
 * O texto bloqueia a emissão? Devolve o motivo, ou `null` quando é apenas informativo.
 *
 * ⚠️ Reconhece "nao fazer" **sem acento e sem caixa** de propósito: no arquivo aparece como
 * "Não fazer", e uma comparação literal perderia a linha.
 */
export function bloqueioDoTexto(texto: null | string | undefined): MotivoDeNaoEmitir | null {
  const t = semAcento(texto ?? "");
  if (!t.trim()) return null;
  if (t.includes("nao fazer")) return "marcado-nao-fazer";
  if (t.includes("paralis")) return "paralisado";
  if (t.includes("carne enviado") || t.includes("carne ja enviado")) return "carne-ja-enviado";
  if (t.includes("comeca pagar") || t.includes("comeca a pagar")) return "nao-comecou";
  // "PAGO ATÉ DEZ/26 RETOMA JAN/27" · "PAGOU A DE SET" · "PAGOU ATÉ NOV/2026"
  if (/pag(o|ou) (ate|a de)/.test(t)) return "pago-adiantado";
  return null;
}

const EXPLICACAO: Record<MotivoDeNaoEmitir, string> = {
  "carne-ja-enviado": "carnê já entregue ao cliente",
  "marcado-nao-fazer": "marcado como “não fazer” na planilha",
  "nao-comecou": "ainda não começou a pagar",
  "pago-adiantado": "parcela já paga adiantado",
  paralisado: "parcela paralisada",
  "sem-valor": "sem valor para o mês na planilha",
  "valor-zerado": "valor zerado na planilha",
};

/**
 * Decide se a linha vira boleto.
 *
 * A ordem das perguntas É a regra: uma marcação de "não fazer" vence o valor calculado, sempre.
 */
export function vereditoDaLinha(linha: LinhaDaPlanilha): Veredito {
  const naCelula = bloqueioDoTexto(linha.marcaNoMes);
  if (naCelula) {
    return {
      emite: false,
      explicacao: `${EXPLICACAO[naCelula]} — “${String(linha.marcaNoMes).trim()}”`,
      motivo: naCelula,
    };
  }
  // ⚠️ Texto na célula do mês que NÃO é bloqueio conhecido também impede: é um recado que
  // ninguém previu, e emitir por cima dele seria decidir no lugar de quem escreveu.
  if (linha.marcaNoMes && String(linha.marcaNoMes).trim()) {
    return {
      emite: false,
      explicacao: `a planilha traz um texto no lugar do valor — “${String(linha.marcaNoMes).trim()}”`,
      motivo: "marcado-nao-fazer",
    };
  }

  const naObservacao = bloqueioDoTexto(linha.observacao);
  if (naObservacao) {
    return {
      emite: false,
      explicacao: `${EXPLICACAO[naObservacao]} — “${String(linha.observacao).trim()}”`,
      motivo: naObservacao,
    };
  }

  // ⚠️ O contato vem por último de propósito: é o lugar improvável, e quando o recado está lá a
  // linha tem valor calculado e nada mais que a denuncie.
  const noContato = bloqueioDoTexto(linha.contato);
  if (noContato) {
    return {
      emite: false,
      explicacao: `${EXPLICACAO[noContato]} — “${String(linha.contato).trim()}” (escrito na coluna de contato)`,
      motivo: noContato,
    };
  }

  if (typeof linha.valor !== "number" || Number.isNaN(linha.valor)) {
    return { emite: false, explicacao: EXPLICACAO["sem-valor"], motivo: "sem-valor" };
  }
  if (linha.valor <= 0) {
    return { emite: false, explicacao: EXPLICACAO["valor-zerado"], motivo: "valor-zerado" };
  }

  // Observação informativa acompanha o boleto, para o operador ver na linha.
  return {
    emite: true,
    observacao: linha.observacao?.trim() || null,
    valor: linha.valor,
  };
}

export type ResumoDaEmissao = {
  emitem: number;
  fora: { explicacao: string; motivo: MotivoDeNaoEmitir; nome: string }[];
  total: number;
};

/** O resumo que a tela mostra antes de qualquer clique. */
export function resumirEmissao(linhas: LinhaDaPlanilha[]): ResumoDaEmissao {
  const resumo: ResumoDaEmissao = { emitem: 0, fora: [], total: 0 };
  for (const linha of linhas) {
    const v = vereditoDaLinha(linha);
    if (v.emite) {
      resumo.emitem += 1;
      resumo.total += v.valor;
    } else {
      resumo.fora.push({ explicacao: v.explicacao, motivo: v.motivo, nome: linha.nome });
    }
  }
  // Centavos: a soma de muitos valores com casas longas acumula ruído de ponto flutuante.
  resumo.total = Math.round(resumo.total * 100) / 100;
  return resumo;
}
