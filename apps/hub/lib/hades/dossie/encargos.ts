// OS ENCARGOS SAEM DO CONTRATO DO CLIENTE — não de uma constante nossa.
//
// Regra do Lucas (03/08): "tem que buscar dentro do contrato do cliente". Cada contrato pode ter
// cláusula diferente, e num documento que vai para processo o número precisa ter origem citável.
// Por isso este módulo LÊ o texto do contrato (acquisition_request_contracts.complete_text),
// extrai multa/juros/índice e DEVOLVE A CLÁUSULA junto — o dossiê imprime a citação embaixo da
// conta, para o advogado conferir de onde veio.
//
// O que os contratos da casa dizem (conferido no texto real, 03/08):
//   "...multa moratória de 2% (dois por cento), juros de mora de 1% (um por cento) ao mês,
//    pro rata die, e atualização monetária pelo índice contratual..."
//
// ⚠️ CORREÇÃO MONETÁRIA É MANUAL. Os índices existem cadastrados no C2X
// (index_monetary_corrections: IPCA anual, IGPM anual, INCC-M...), mas a tabela de VALORES está
// vazia — ninguém alimenta os percentuais mês a mês. Calcular sozinho seria inventar número em
// peça processual, então quem gera o dossiê DIGITA o percentual acumulado do período e a
// referência (índice + intervalo), que saem impressos ao lado da conta. Sem percentual digitado,
// o documento declara a correção como devida e pendente de apuração (decisão do Lucas, 03/08).

export type EncargosDoContrato = {
  // % de multa moratória sobre a parcela vencida (ex.: 2 = 2%).
  multaPercent: number;
  // % de juros de mora ao mês (ex.: 1 = 1% a.m.), aplicados pro rata die.
  jurosMesPercent: number;
  // Índice de correção declarado no contrato (ex.: "IPCA"). Só informativo — não entra na conta.
  indiceCorrecao: string | null;
  // O trecho literal do contrato de onde saiu a regra. Vai impresso no dossiê.
  clausula: string | null;
  // Como cada valor foi obtido: "contrato" (extraído do texto) ou "padrão" (não achou no texto).
  origem: "contrato" | "padrao";
};

// Fallback SÓ quando o contrato não traz a cláusula (contrato antigo, minuta diferente). O dossiê
// deixa isso explícito na folha — o jurídico precisa saber que veio de praxe, não do instrumento.
const PADRAO: EncargosDoContrato = {
  clausula: null,
  indiceCorrecao: null,
  jurosMesPercent: 1,
  multaPercent: 2,
  origem: "padrao",
};

// O contrato vem em HTML COM ENTIDADES (&ccedil;, &atilde;...). Sem decodificar, "correção" fica
// "corre&ccedil;&atilde;o" e nenhuma busca por acento casa — foi o que o teste pegou.
const ENTIDADES: Record<string, string> = {
  aacute: "á", acirc: "â", agrave: "à", atilde: "ã", auml: "ä",
  ccedil: "ç",
  eacute: "é", ecirc: "ê", egrave: "è",
  iacute: "í", icirc: "î",
  oacute: "ó", ocirc: "ô", otilde: "õ", ouml: "ö",
  uacute: "ú", ucirc: "û", uuml: "ü",
};

function limpar(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    // &Ccedil; e &ccedil; — a maiúscula preserva o caixa-alta do original.
    .replace(/&([A-Za-z]+);/g, (inteiro, nome: string) => {
      const minuscula = nome.toLowerCase();
      const letra = ENTIDADES[minuscula];
      if (!letra) return inteiro;
      return nome[0] === nome[0]?.toUpperCase() ? letra.toUpperCase() : letra;
    })
    // &#233; (numérica) também aparece em contrato exportado de editor.
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

// Vira número aceitando vírgula decimal ("0,72" -> 0.72).
function num(bruto: string | undefined): number | null {
  if (!bruto) return null;
  const n = Number(bruto.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function extrairEncargosDoContrato(textoContrato: string | null): EncargosDoContrato {
  if (!textoContrato) return PADRAO;
  const texto = limpar(textoContrato);

  // DUAS MINUTAS EM USO, conferidas no banco em 03/08:
  //   • nova (Vale do Ouro): "multa moratória de 2% ... juros de mora de 1% ao mês, pro rata die"
  //   • antiga (Lavra do Ouro): "juros compensatórios de 1% ao mês e multa penal de 2% sobre o
  //     valor do débito" — mesmos percentuais, redação e ORDEM invertidas.
  // Os contratos antigos são justamente os que vão ao jurídico (900+ dias de atraso), então
  // reconhecer as duas não é refinamento: é o caso principal.
  const juntas = [
    // nova: multa antes, juros depois
    /multa\s+(?:morat[óo]ria|penal|contratual)\s+de\s+([\d.,]+)\s*%[^.]{0,140}?juros\s+(?:de\s+mora|morat[óo]rios?|compensat[óo]rios?)\s+de\s+([\d.,]+)\s*%\s*(?:\([^)]*\)\s*)?ao\s+m[êe]s/i,
  ];
  // antiga: juros antes, multa depois (grupos trocados)
  const juntasInvertidas = [
    /juros\s+(?:compensat[óo]rios?|morat[óo]rios?|de\s+mora)\s+de\s+([\d.,]+)\s*%\s*(?:\([^)]*\)\s*)?ao\s+m[êe]s[^.]{0,140}?multa\s+(?:penal|morat[óo]ria|contratual)\s+de\s+([\d.,]+)\s*%/i,
  ];

  let multa: number | null = null;
  let juros: number | null = null;
  let clausula: string | null = null;

  for (const re of juntas) {
    const m = texto.match(re);
    if (m) {
      multa = num(m[1]);
      juros = num(m[2]);
      clausula = m[0].trim();
      break;
    }
  }
  if (multa === null) {
    for (const re of juntasInvertidas) {
      const m = texto.match(re);
      if (m) {
        juros = num(m[1]);
        multa = num(m[2]);
        clausula = m[0].trim();
        break;
      }
    }
  }

  // Último recurso: cada um isolado (minuta que separa as cláusulas em parágrafos distantes).
  if (multa === null) {
    const m = texto.match(/multa\s+(?:morat[óo]ria|penal|contratual)\s+de\s+([\d.,]+)\s*%/i);
    if (m) {
      multa = num(m[1]);
      clausula = clausula ?? m[0].trim();
    }
  }
  if (juros === null) {
    const j = texto.match(
      /juros\s+(?:de\s+mora|morat[óo]rios?|compensat[óo]rios?)\s+de\s+([\d.,]+)\s*%\s*(?:\([^)]*\)\s*)?ao\s+m[êe]s/i,
    );
    if (j) {
      juros = num(j[1]);
      clausula = clausula ? `${clausula} ${j[0].trim()}` : j[0].trim();
    }
  }

  // Índice: minuta nova traz "Correção monetária: variação positiva do IPCA"; a antiga fala em
  // "índice acumulado de reajuste da poupança".
  const idx =
    texto.match(/Corre[çc][ãa]o\s+monet[áa]ria:\s*(?:varia[çc][ãa]o\s+positiva\s+d[oe]\s+)?([A-ZÀ-Ú][A-ZÀ-Ú\-/]{2,12})/i) ??
    texto.match(/[íi]ndice\s+acumulado\s+de\s+reajuste\s+d[ao]\s+(poupan[çc]a)/i);

  // Sem multa E sem juros no texto = contrato que não declara: cai no padrão, sinalizado.
  if (multa === null && juros === null) {
    return { ...PADRAO, indiceCorrecao: idx?.[1]?.toUpperCase() ?? null };
  }

  return {
    clausula,
    indiceCorrecao: idx?.[1]?.toUpperCase() ?? null,
    jurosMesPercent: juros ?? PADRAO.jurosMesPercent,
    multaPercent: multa ?? PADRAO.multaPercent,
    origem: "contrato",
  };
}

export type ParcelaAtualizada = {
  atualizado: number;
  // Correção monetária. Só é diferente de zero quando quem gera o dossiê digita o percentual
  // acumulado do período — o sistema não tem os índices alimentados para calcular sozinho.
  correcao: number;
  diasAtraso: number;
  juros: number;
  multa: number;
  numero: string;
  valorOriginal: number;
  vencimento: string;
};

// Atualiza UMA parcela vencida: multa fixa + juros pro rata die (1% ao mês ÷ 30 × dias)
// + correção monetária, esta última só se o percentual for informado à mão.
export function atualizarParcela(input: {
  // % de correção acumulada no período, digitado por quem gera o dossiê. Ausente = não aplica.
  correcaoPercent?: number | null;
  encargos: EncargosDoContrato;
  hoje?: Date;
  numero: string;
  valorOriginal: number;
  vencimento: Date;
}): ParcelaAtualizada {
  const hoje = input.hoje ?? new Date();
  const dias = Math.max(
    0,
    Math.floor((hoje.getTime() - input.vencimento.getTime()) / 86_400_000),
  );
  const multa = input.valorOriginal * (input.encargos.multaPercent / 100);
  const juros = input.valorOriginal * ((input.encargos.jurosMesPercent / 100) / 30) * dias;
  const pct = Number(input.correcaoPercent);
  const correcao = Number.isFinite(pct) && pct > 0 ? input.valorOriginal * (pct / 100) : 0;

  return {
    atualizado: input.valorOriginal + multa + juros + correcao,
    correcao,
    diasAtraso: dias,
    juros,
    multa,
    numero: input.numero,
    valorOriginal: input.valorOriginal,
    vencimento: input.vencimento.toLocaleDateString("pt-BR"),
  };
}

export function somarAtualizacao(parcelas: ParcelaAtualizada[]) {
  return parcelas.reduce(
    (acc, p) => ({
      atualizado: acc.atualizado + p.atualizado,
      correcao: acc.correcao + p.correcao,
      juros: acc.juros + p.juros,
      multa: acc.multa + p.multa,
      original: acc.original + p.valorOriginal,
    }),
    { atualizado: 0, correcao: 0, juros: 0, multa: 0, original: 0 },
  );
}
