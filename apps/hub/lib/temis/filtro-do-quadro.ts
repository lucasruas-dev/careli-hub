// PESQUISA, FILTROS E ORDEM DO QUADRO DA TÊMIS. Uma folha pura, sem banco: o quadro é "use client".
//
// Lucas, 03/10/2026: *"preciso de um prompt para tela da temis ter ordenação, filtro, pesquisa"*.
//
// ⚠️ TUDO RODA SOBRE O QUE O QUADRO JÁ CARREGOU. A rota devolve todos os cards de uma vez
// (`trabalhosDoBoard`), então pesquisar e filtrar no navegador não custa chamada nenhuma. Sem rota
// nova e sem polling: a casa já pagou fatura alta por tela que consulta demais.
//
// ⚠️ A ORDEM PADRÃO É A DO SERVIDOR, e ela já é "há mais tempo na etapa primeiro": a consulta ordena
// por `estagio_desde` crescente, com desempate pelo `id`. Por isso ela não é reordenada aqui, e toda
// outra ordem desempata pela posição de chegada. Mexer nisso muda o quadro de quem não escolheu nada.

import { situacaoDoPrazo, type EstagioDoTrabalho, type TipoDeTrabalho } from "./trabalhos";

/** O que a pesquisa, os filtros e a ordem leem de um card (os nomes de `TrabalhoDaTela`). */
export type CardParaFiltrar = {
  assinaturas?: null | {
    assinaram: number;
    compradores?: null | { assinaram: number; total: number };
    conviteNaoEntregue: boolean;
    total: number;
  };
  atividadesFeitas: string[];
  categoriaNome?: null | string;
  clienteCpf: null | string;
  clienteNome: string;
  criadoEm: string;
  empreendimentoCodigo: string;
  empreendimentoNome: string;
  estagio: EstagioDoTrabalho;
  estagioDesde: string;
  operadoPor?: null | string;
  tipo: TipoDeTrabalho;
  unidade: string;
};

// ── pesquisa ────────────────────────────────────────────────────────────────────────────────────

/** "Ândrea" → "andrea". */
export function semAcento(texto: null | string | undefined): string {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Um pedaço de unidade: a palavra (quadra, lote, bloco, apartamento, ou a abreviação) e o valor
 * logo depois, com uma letra opcional na frente do número ("Quadra C03").
 *
 * ⚠️ O `(?<![a-z])` E NÃO `\b`: em "Q11L02" o "L" vem colado no "1", e `\b` não vê fronteira entre
 * letra e número. A ordem da alternância também importa: "qd03" tem de casar "qd" antes de "q".
 */
const PEDACO_DA_UNIDADE =
  /(?<![a-z])(quadra|qd|q|lote|lt|l|bloco|bl|b|apartamento|apto|ap)\s*[.:-]?\s*([a-z]?)(\d+)/g;

const CURTO: Record<string, string> = {
  ap: "ap",
  apartamento: "ap",
  apto: "ap",
  b: "b",
  bl: "b",
  bloco: "b",
  l: "l",
  lote: "l",
  lt: "l",
  q: "q",
  qd: "q",
  quadra: "q",
};

/**
 * Tira da escrita os pedaços de unidade, já normalizados, e devolve o resto.
 *
 * "Quadra 11 · Lote 02", "q11 l02", "quadra 11 lote 2" e "Q11L02" dão todos `["q11", "l2"]`.
 *
 * ⚠️ O NÚMERO VALE INTEIRO, sem o zero à esquerda: Lote 2 é Lote 02, e nunca Lote 20. A primeira
 * versão comparava pedaço de texto ("l2" dentro de "q11l20") e a pesquisa por "q11 l02" trazia o
 * lote vizinho junto.
 */
export function separarUnidade(texto: null | string | undefined): { pedacos: string[]; resto: string } {
  const pedacos: string[] = [];
  const resto = semAcento(texto).replace(
    PEDACO_DA_UNIDADE,
    (_inteiro, palavra: string, letra: string, numero: string) => {
      pedacos.push(`${CURTO[palavra]}${letra}${Number(numero)}`);
      return " ";
    },
  );
  return { pedacos, resto };
}

/**
 * O card casa com a pesquisa? Vazia casa com tudo.
 *
 * Cada palavra precisa aparecer em algum lugar do card (nome, empreendimento pela sigla ou pelo nome,
 * categoria, unidade), sem diferença de acento nem de maiúscula. Os pedaços de unidade da pesquisa
 * precisam existir na unidade do card. Um número com 3 dígitos ou mais, com ou sem pontuação, também
 * procura no CPF.
 */
export function pesquisaCasa(card: CardParaFiltrar, pesquisa: string): boolean {
  const { pedacos, resto } = separarUnidade(pesquisa);
  if (pedacos.length > 0) {
    const daUnidade = new Set(separarUnidade(card.unidade).pedacos);
    if (!pedacos.every((p) => daUnidade.has(p))) return false;
  }

  // O "·" de uma unidade colada, a vírgula, o apóstrofo: separam palavras e não precisam casar.
  // Ponto, hífen e barra ficam, porque são a pontuação do CPF.
  const palavras = resto
    .replace(/[^a-z0-9./-]+/g, " ")
    .split(" ")
    .filter((p) => /[a-z0-9]/.test(p));
  if (palavras.length === 0) return true;

  const texto = semAcento(
    [
      card.clienteNome,
      card.empreendimentoCodigo,
      card.empreendimentoNome,
      card.categoriaNome,
      card.unidade,
    ].join(" "),
  );
  const cpf = String(card.clienteCpf ?? "").replace(/\D/g, "");

  return palavras.every((palavra) => {
    if (texto.includes(palavra)) return true;
    const digitos = palavra.replace(/\D/g, "");
    return digitos.length >= 3 && /^[\d./-]+$/.test(palavra) && cpf.includes(digitos);
  });
}

// ── filtros ─────────────────────────────────────────────────────────────────────────────────────

export type DonoDoCard = "careli" | "incorporador";

export type FiltrosDoQuadro = {
  compradorPendente: boolean;
  conviteDevolvido: boolean;
  /** `null` = os dois. Só vale na supervisão ("Ver também os do incorporador"). */
  dono: DonoDoCard | null;
  /** As chaves de `empreendimentosDosCards`. Vazio = todos. */
  empreendimentos: string[];
  prazoVencido: boolean;
};

export const FILTROS_VAZIOS: FiltrosDoQuadro = {
  compradorPendente: false,
  conviteDevolvido: false,
  dono: null,
  empreendimentos: [],
  prazoVencido: false,
};

/** A chave do empreendimento no filtro: a sigla, ou o nome quando a sigla falta. */
export function chaveDoEmpreendimento(card: Pick<CardParaFiltrar, "empreendimentoCodigo" | "empreendimentoNome">): string {
  return card.empreendimentoCodigo?.trim() || card.empreendimentoNome?.trim() || "";
}

/** Os empreendimentos que aparecem nos cards, pelo nome, sem repetir. */
export function empreendimentosDosCards(cards: readonly CardParaFiltrar[]): { chave: string; nome: string }[] {
  const vistos = new Map<string, string>();
  for (const c of cards) {
    const chave = chaveDoEmpreendimento(c);
    if (chave && !vistos.has(chave)) vistos.set(chave, c.empreendimentoNome?.trim() || chave);
  }
  return [...vistos.entries()]
    .map(([chave, nome]) => ({ chave, nome }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }));
}

/**
 * Em assinatura, com o selo de compradores abaixo do total.
 *
 * ⚠️ A MESMA CONTA DO SELO (`seloDeAssinaturaDoCard`): só "Em assinatura" conta compradores, e sem
 * comprador marcado no quadro não há o que estar pendente.
 */
export function temCompradorPendente(card: Pick<CardParaFiltrar, "assinaturas" | "estagio">): boolean {
  const compradores = card.assinaturas?.compradores;
  return card.estagio === "assinatura" && !!compradores && compradores.total > 0 && compradores.assinaram < compradores.total;
}

/**
 * Os filtros que valem agora.
 *
 * ⚠️ O FILTRO GUARDADO PODE TER FICADO VELHO. Um empreendimento escolhido ontem que hoje não tem card
 * nenhum, ou o dono escolhido com a supervisão ligada que depois foi desligada, filtrariam o quadro
 * inteiro para "Nada aqui" sem nenhuma etiqueta na tela para explicar. Saem daqui.
 */
export function filtrosQueValem(
  filtros: FiltrosDoQuadro,
  contexto: { comDono: boolean; empreendimentos: readonly string[] },
): FiltrosDoQuadro {
  const presentes = new Set(contexto.empreendimentos);
  return {
    ...filtros,
    dono: contexto.comDono ? filtros.dono : null,
    empreendimentos: filtros.empreendimentos.filter((e) => presentes.has(e)),
  };
}

/** Quantos filtros estão ligados: o número do botão. */
export function quantosFiltrosLigados(filtros: FiltrosDoQuadro): number {
  return (
    filtros.empreendimentos.length +
    (filtros.prazoVencido ? 1 : 0) +
    (filtros.conviteDevolvido ? 1 : 0) +
    (filtros.compradorPendente ? 1 : 0) +
    (filtros.dono ? 1 : 0)
  );
}

/**
 * O card passa nos filtros? Eles se somam: com dois ligados, só fica o card que atende os dois.
 *
 * ⚠️ PRAZO VENCIDO É O RELÓGIO VERMELHO DO CARD, e não outra conta: `situacaoDoPrazo(...).atrasado`,
 * a mesma que pinta a borda. Esperar o cliente assinar não conta como vencido.
 */
export function passaNosFiltros(card: CardParaFiltrar, filtros: FiltrosDoQuadro, agora: Date = new Date()): boolean {
  if (filtros.empreendimentos.length > 0 && !filtros.empreendimentos.includes(chaveDoEmpreendimento(card))) {
    return false;
  }
  if (filtros.prazoVencido && !situacaoDoPrazo(card, agora).atrasado) return false;
  if (filtros.conviteDevolvido && !card.assinaturas?.conviteNaoEntregue) return false;
  if (filtros.compradorPendente && !temCompradorPendente(card)) return false;
  if (filtros.dono === "careli" && card.operadoPor) return false;
  if (filtros.dono === "incorporador" && !card.operadoPor) return false;
  return true;
}

// ── ordem ───────────────────────────────────────────────────────────────────────────────────────

export type OrdemDoQuadro = "etapa" | "nome" | "recentes" | "vencidos";

/**
 * As ordens, na ordem do menu. A primeira é a padrão.
 *
 * ⚠️ "PADRÃO" E "HÁ MAIS TEMPO NA ETAPA" SÃO UMA SÓ (decisão do Lucas, 03/10/2026). O pedido listava
 * as duas, e as duas dariam o mesmo quadro: é assim que o servidor sempre entregou.
 * ⚠️ "RECENTES" É PELA DATA DE ENVIO, a "Enviado dd/mm" que o card mostra (também decisão dele).
 */
export const ORDENS_DO_QUADRO: readonly { id: OrdemDoQuadro; nome: string }[] = [
  { id: "etapa", nome: "Há mais tempo na etapa" },
  { id: "recentes", nome: "Enviados mais recentes" },
  { id: "vencidos", nome: "Prazo vencido primeiro" },
  { id: "nome", nome: "Nome de A a Z" },
];

export const ORDEM_PADRAO: OrdemDoQuadro = "etapa";

const instante = (iso: string) => {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
};

/**
 * Os cards de uma coluna na ordem escolhida. Não mexe na lista que recebe.
 *
 * ⚠️ O EMPATE FICA NA ORDEM EM QUE OS CARDS CHEGARAM, que é a padrão. Dois cards com o mesmo nome ou
 * dois vencidos continuam na ordem de antes, e o quadro não embaralha a cada recarga de um minuto.
 */
export function ordenarCards<T extends CardParaFiltrar>(
  cards: readonly T[],
  ordem: OrdemDoQuadro,
  agora: Date = new Date(),
): T[] {
  const posicao = new Map<T, number>(cards.map((c, i) => [c, i]));
  const empate = (a: T, b: T) => posicao.get(a)! - posicao.get(b)!;

  if (ordem === "recentes") {
    return [...cards].sort((a, b) => instante(b.criadoEm) - instante(a.criadoEm) || empate(a, b));
  }
  if (ordem === "vencidos") {
    const vencido = new Map<T, number>(cards.map((c) => [c, situacaoDoPrazo(c, agora).atrasado ? 1 : 0]));
    return [...cards].sort((a, b) => vencido.get(b)! - vencido.get(a)! || empate(a, b));
  }
  if (ordem === "nome") {
    return [...cards].sort(
      (a, b) =>
        a.clienteNome.trim().localeCompare(b.clienteNome.trim(), "pt-BR", { sensitivity: "base" }) || empate(a, b),
    );
  }
  return [...cards];
}

// ── o que fica guardado ─────────────────────────────────────────────────────────────────────────

export type PreferenciasDoQuadro = { filtros: FiltrosDoQuadro; ordem: OrdemDoQuadro };

/**
 * Lê as preferências guardadas no navegador. Qualquer coisa estranha vira o padrão, campo a campo.
 *
 * ⚠️ A PESQUISA NÃO FICA GUARDADA, de propósito: ela começa vazia a cada abertura. Um nome esquecido
 * na caixa faria o quadro abrir com um card só, e quem chega acharia que a fila sumiu.
 */
export function lerPreferencias(texto: null | string | undefined): PreferenciasDoQuadro {
  let cru: unknown = null;
  try {
    cru = texto ? JSON.parse(texto) : null;
  } catch {
    cru = null;
  }
  const obj = (cru && typeof cru === "object" ? cru : {}) as Record<string, unknown>;
  const f = (obj.filtros && typeof obj.filtros === "object" ? obj.filtros : {}) as Record<string, unknown>;

  const ordem = ORDENS_DO_QUADRO.some((o) => o.id === obj.ordem) ? (obj.ordem as OrdemDoQuadro) : ORDEM_PADRAO;
  return {
    filtros: {
      compradorPendente: f.compradorPendente === true,
      conviteDevolvido: f.conviteDevolvido === true,
      dono: f.dono === "careli" || f.dono === "incorporador" ? f.dono : null,
      empreendimentos: Array.isArray(f.empreendimentos)
        ? [...new Set(f.empreendimentos.filter((e): e is string => typeof e === "string" && e.length > 0))]
        : [],
      prazoVencido: f.prazoVencido === true,
    },
    ordem,
  };
}
