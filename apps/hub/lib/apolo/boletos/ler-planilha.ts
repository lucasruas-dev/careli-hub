import {
  type EmpreendimentoDeBoleto,
  empreendimentoDaAba,
} from "./empreendimentos";
import { type LinhaDaPlanilha, vereditoDaLinha } from "./regra-de-emissao";

// LEITURA DA PLANILHA DE BOLETOS — uma aba por empreendimento, cada uma com o seu layout.
//
// ⚠️ NÃO EXISTE UM LAYOUT ÚNICO, e supor que existe perde carteira inteira. No arquivo de
// 31/08/2026 as abas de prédio começam em `Nome cliente | Contato | Aptos`, as de loteamento em
// `Nº | Nome cliente | FORMA ENVIO | Aptos`, e o Vale do Ouro traz `LOTE | QUADRA | METRAGEM |
// REAJUSTE`. Por isso o cabeçalho é PROCURADO (a linha que tem "nome" e pelo menos uma data),
// e cada coluna é reconhecida pelo que ela diz — nunca pela posição.
//
// ⚠️ AS COLUNAS DEPOIS DO ÚLTIMO MÊS NÃO TÊM CABEÇALHO, e é ali que moram os recados que
// decidem a emissão: "PAGO ATÉ DEZ/26 RETOMA JAN/27", "CARNÊ ENVIADO ATÉ DEZ/2026". Foi
// exatamente uma dessas colunas que eu não li na conferência do Garden, e dois clientes que já
// tinham pago entraram na lista de cobrança. Tudo o que vier depois do último mês é observação.

export type ClienteDaPlanilha = {
  contato: null | string;
  /** Só nas abas de loteamento. */
  lote?: null | string;
  marcaNoMes: null | string;
  nome: string;
  observacao: null | string;
  parcelaAtual: null | number;
  quadra?: null | string;
  totalParcelas: null | number;
  /** Apartamento, ou quadra/lote nas abas de loteamento. */
  unidade: null | string;
  valor: null | number;
  /** Dia do vencimento (10, 15, 20…). */
  vencimento: null | number;
};

export type AbaLida = {
  aba: string;
  clientes: ClienteDaPlanilha[];
  empreendimento: EmpreendimentoDeBoleto | null;
  /** As competências encontradas no cabeçalho, em ordem (`2026-09`). */
  meses: string[];
};

export type PlanilhaLida = {
  abas: AbaLida[];
  /** Abas que não deram para ler, com o motivo. Nunca somem em silêncio. */
  ignoradas: { aba: string; motivo: string }[];
};

const semAcento = (t: unknown) =>
  String(t ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();

/**
 * A competência que a coluna do cabeçalho representa (`2026-09`).
 *
 * ⚠️ EM UTC, E NÃO NO FUSO LOCAL. O ExcelJS converte o serial do Excel para `Date` em UTC, então
 * setembro/2026 chega como `2026-09-01T00:00:00Z`. Lido com `getMonth()` aqui no Brasil (UTC−3)
 * isso vira 31/08 às 21h — ou seja, AGOSTO. Medido no arquivo real de 31/08/2026: as 23 colunas
 * de mês do Vale do Sol deslizavam todas uma casa para trás, e pedir setembro não achava coluna
 * nenhuma. O erro perigoso é o outro: pedir um mês e receber, sem aviso, os valores do anterior.
 */
function competencia(valor: unknown): null | string {
  if (!(valor instanceof Date) || Number.isNaN(valor.getTime())) return null;
  return `${valor.getUTCFullYear()}-${String(valor.getUTCMonth() + 1).padStart(2, "0")}`;
}

function numero(valor: unknown): null | number {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  if (typeof valor === "string") {
    const limpo = valor.trim().replace(/\./g, "").replace(",", ".");
    const n = Number(limpo);
    if (limpo && Number.isFinite(n)) return n;
  }
  return null;
}

function texto(valor: unknown): null | string {
  if (valor === null || valor === undefined) return null;
  if (valor instanceof Date) return null;
  const t = String(valor).trim();
  return t || null;
}

/** O papel de cada coluna, pelo que o cabeçalho diz. */
function papelDaColuna(rotulo: string): null | string {
  const n = semAcento(rotulo);
  if (!n) return null;
  if (n.includes("nome")) return "nome";
  if (n.includes("forma") || n.includes("contato")) return "contato";
  if (n.includes("apto")) return "unidade";
  // ⚠️ O CABEÇALHO DO LOTE VEM NUMERADO EM ALGUMAS ABAS: o Vale do Ouro escreve `LOTE`, o Garden
  // escreve `N° LOTE`. Com a comparação exata que estava aqui, o Garden perdia a coluna do lote e a
  // unidade virava só a quadra — os 146 clientes viravam 13 unidades, e a carga morria com 868
  // chaves repetidas. Aceitar qualquer coisa que CONTENHA "lote" seria pior (`VALOR DO LOTE`,
  // `LOTEAMENTO`), então o que entra é "lote" com um prefixo de numeração opcional.
  if (/^(?:n[.º°o]*\s*)?lote$/.test(n)) return "lote";
  if (n.includes("quadra")) return "quadra";
  if (n.includes("venc")) return "vencimento";
  if (n.includes("parc") && n.includes("atual")) return "parcelaAtual";
  if (n.includes("parc")) return "totalParcelas";
  return null;
}

type Celula = { texto: null | string; valor: unknown };
type Grade = Celula[][];

/**
 * Acha a linha de cabeçalho: a que tem "nome" E pelo menos uma data.
 *
 * As abas começam com título e linha de índices antes do cabeçalho de verdade, e o número de
 * linhas antes dele varia por aba.
 */
function acharCabecalho(grade: Grade): number {
  for (let i = 0; i < Math.min(8, grade.length); i += 1) {
    const linha = grade[i] ?? [];
    const temNome = linha.some((c) => semAcento(c?.texto).includes("nome"));
    const temData = linha.some((c) => competencia(c?.valor));
    if (temNome && temData) return i;
  }
  return -1;
}

/** Transforma a grade de uma aba nos clientes dela, para a competência pedida. */
export function lerAba(aba: string, grade: Grade, mes: string): AbaLida | { motivo: string } {
  const iCab = acharCabecalho(grade);
  if (iCab < 0) return { motivo: "não achei a linha de cabeçalho (nome + meses)" };

  const cab = grade[iCab] ?? [];
  const papeis = new Map<number, string>();
  const meses = new Map<number, string>();
  cab.forEach((celula, j) => {
    const comp = competencia(celula?.valor);
    if (comp) {
      meses.set(j, comp);
      return;
    }
    const papel = papelDaColuna(celula?.texto ?? "");
    if (papel) papeis.set(j, papel);
  });

  if (meses.size === 0) return { motivo: "nenhuma coluna de mês no cabeçalho" };
  const colDoMes = [...meses.entries()].find(([, m]) => m === mes)?.[0] ?? null;
  const ultimoMes = Math.max(...meses.keys());

  const clientes: ClienteDaPlanilha[] = [];
  for (let i = iCab + 1; i < grade.length; i += 1) {
    const linha = grade[i] ?? [];
    const idxNome = [...papeis.entries()].find(([, p]) => p === "nome")?.[0];
    const nome = idxNome === undefined ? null : texto(linha[idxNome]?.valor);
    // Rodapé da aba ("Obs: Paralisamos a parcela…") não é cliente.
    if (!nome || semAcento(nome).startsWith("obs")) continue;

    const reg: ClienteDaPlanilha = {
      contato: null,
      marcaNoMes: null,
      nome,
      observacao: null,
      parcelaAtual: null,
      totalParcelas: null,
      unidade: null,
      valor: null,
      vencimento: null,
    };

    for (const [j, papel] of papeis) {
      const bruto = linha[j]?.valor;
      if (papel === "nome") continue;
      if (papel === "vencimento" || papel === "parcelaAtual" || papel === "totalParcelas") {
        (reg as Record<string, unknown>)[papel] = numero(bruto);
      } else {
        (reg as Record<string, unknown>)[papel] = texto(bruto);
      }
    }
    // Loteamento: a unidade é quadra + lote.
    if (!reg.unidade && (reg.quadra || reg.lote)) {
      reg.unidade = [reg.quadra && `Q${reg.quadra}`, reg.lote && `L${reg.lote}`]
        .filter(Boolean)
        .join(" ");
    }

    if (colDoMes !== null) {
      const bruto = linha[colDoMes]?.valor;
      const n = numero(bruto);
      if (n !== null) reg.valor = n;
      else reg.marcaNoMes = texto(bruto);
    }

    // ⚠️ Tudo depois do último mês é observação — ver a nota do topo.
    const obs: string[] = [];
    for (let j = ultimoMes + 1; j < linha.length; j += 1) {
      const t = texto(linha[j]?.valor);
      if (t) obs.push(t);
    }
    if (obs.length) reg.observacao = obs.join(" | ");

    clientes.push(reg);
  }

  return {
    aba,
    clientes,
    empreendimento: empreendimentoDaAba(aba),
    meses: [...meses.values()],
  };
}

/**
 * O que a regra de emissão precisa saber sobre um cliente da planilha.
 *
 * ⚠️ PASSA POR AQUI, SEMPRE. Antes cada chamador montava o objeto à mão, e quando a regra passou a
 * olhar a coluna de contato (01/09/2026) os dois lugares continuaram mandando os campos antigos:
 * a correção existia e não valia, porque o campo novo chegava `undefined`. Um ponto só de
 * conversão faz o compilador achar o próximo campo esquecido — ver
 * [[reference_camada_nova_exige_varrer_leitores]].
 */
export function linhaDoCliente(c: ClienteDaPlanilha): LinhaDaPlanilha {
  return {
    contato: c.contato,
    marcaNoMes: c.marcaNoMes,
    nome: c.nome,
    observacao: c.observacao,
    valor: c.valor,
  };
}

export type ResumoDaAba = {
  aba: string;
  emitem: number;
  empreendimento: EmpreendimentoDeBoleto | null;
  fora: { explicacao: string; nome: string }[];
  total: number;
};

/** O resumo por empreendimento que a tela mostra depois de ler o arquivo. */
export function resumirAba(lida: AbaLida): ResumoDaAba {
  const resumo: ResumoDaAba = {
    aba: lida.aba,
    emitem: 0,
    empreendimento: lida.empreendimento,
    fora: [],
    total: 0,
  };
  for (const c of lida.clientes) {
    const v = vereditoDaLinha(linhaDoCliente(c));
    if (v.emite) {
      resumo.emitem += 1;
      resumo.total += v.valor;
    } else {
      resumo.fora.push({ explicacao: v.explicacao, nome: c.nome });
    }
  }
  resumo.total = Math.round(resumo.total * 100) / 100;
  return resumo;
}
