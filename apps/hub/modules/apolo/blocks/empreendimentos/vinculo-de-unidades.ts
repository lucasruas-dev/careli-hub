// A CONVERSA DA TELA COM A PORTA DO VÍNCULO — só o transporte, nenhuma régua.
//
// A régua inteira (quem pode, o gêmeo do terreno, a trava da divisão) mora no servidor
// (`lib/apolo/vinculo-de-unidades-servidor.ts`). Aqui fica o que a tela precisa para falar com ela:
// o formato da resposta, o envio em blocos e a soma das prévias.
//
// ⚠️ ESTE ARQUIVO NÃO DECIDE NADA. Se um dia ele começar a julgar (por exemplo, esconder a unidade
// vendida em vez de mostrar o que o servidor respondeu), a tela e o motor passam a discordar — e o
// operador acredita no que viu por último.

import { lerCsvDeVinculo, type LinhaDaPlanilhaDeVinculo } from "@/lib/hercules/unidade-vinculo";
import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";

export const ROTA_DO_VINCULO = "/api/apolo/empreendimentos/unidades/vinculo";

/**
 * O teto por chamada do servidor. A tela divide o envio em blocos deste tamanho.
 *
 * ⚠️ O LAGOA BONITA TEM 907 UNIDADES NA FAMÍLIA: "o empreendimento inteiro" não cabe numa chamada,
 * e sem o bloco a tela respondia 422 justamente no caso que mais importa.
 */
export const TETO_POR_CHAMADA = 500;

export type UnidadeDoVinculo = {
  apartamento: string;
  categoriaId: null | string;
  codigo: string;
  enterpriseId: string;
  id: string;
  lote: string;
  quadra: string;
  situacao: string;
  torre: string;
  /** O carimbo da 0181. Nulo = vínculo anterior a ela, ou nenhum. */
  vinculo: null | { em: string; origem: null | string; por: null | string };
};

export type CategoriaDoVinculo = { enterpriseId: string; id: string; nome: string };
export type DivisaoDoVinculo = { codigo: string; enterpriseId: string; nome: string; pai: boolean };

export type Universo = {
  categorias: CategoriaDoVinculo[];
  divisoes: DivisaoDoVinculo[];
  empreendimento: { ids: string[]; nome: string };
  /** `true` = a migration 0181 ainda não entrou: o carimbo não é lido nem gravado. */
  semCarimbo: boolean;
  unidades: UnidadeDoVinculo[];
};

export type PreviaDaCategoria = {
  categoriaId: null | string;
  nome: string;
  previa: {
    ids: string[];
    jaEstao: number;
    porParentesco: number;
    semCategoria: number;
    terrenos: number;
    trocamDeCategoria: { de: string; terrenos: number }[];
    vendaAndando: number;
  };
};

export type RelatorioDaPlanilha = {
  casaram: { linha: number; rotulo: string }[];
  naoCasaram: { linha: number; motivo: string; valor: string }[];
  resumo: { comCategoria: number; comDivisao: number; naoCasaram: number; semMudanca: number; total: number };
};

export type Previsao = {
  avisos: string[];
  categorias: PreviaDaCategoria[];
  divisoes: { destino: string; nome: string; plano: { jaNoDestino: number; mover: unknown[] } }[];
  planilha: null | RelatorioDaPlanilha;
  recusas: { motivo: string; rotulo: string; unidadeId: string }[];
  resumo: { linhas: number; movem: number; terrenos: number };
};

export type Aplicacao = {
  avisos: string[];
  gravadas: number;
  movidas: number;
  naoMovidas: number;
  planilha: null | RelatorioDaPlanilha;
  porParentesco: number;
  recusas: { motivo: string; rotulo: string; unidadeId: string }[];
  semCarimbo: boolean;
  terrenos: number;
};

type Resposta<T> = { data?: T; error?: string };

async function chamar<T>(corpo: Record<string, unknown>): Promise<{ data: T } | { erro: string }> {
  const token = await getApoloAccessToken();
  const resposta = await fetch(ROTA_DO_VINCULO, {
    body: JSON.stringify(corpo),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    method: "POST",
  });
  const payload = (await resposta.json().catch(() => ({}))) as Resposta<T>;
  // ⚠️ FALHA FECHADA: cair para um objeto vazio faria a tela dizer "nada a mudar" a partir de um
  // timeout, e alguém aplicaria tudo de novo por cima.
  if (!resposta.ok || !payload.data) {
    return { erro: payload.error ?? "Não foi possível falar com o servidor." };
  }
  return { data: payload.data };
}

export async function lerUniverso(pedido: {
  codigo?: null | string;
  enterpriseId: string;
}): Promise<{ data: Universo } | { erro: string }> {
  const token = await getApoloAccessToken();
  const query = new URLSearchParams({ enterpriseId: pedido.enterpriseId });
  if (pedido.codigo) query.set("codigo", pedido.codigo);
  const resposta = await fetch(`${ROTA_DO_VINCULO}?${query.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = (await resposta.json().catch(() => ({}))) as Resposta<Universo>;
  if (!resposta.ok || !payload.data) {
    return { erro: payload.error ?? "Não foi possível carregar os lotes." };
  }
  return { data: payload.data };
}

/** Divide uma lista em blocos do tamanho do teto do servidor. */
export function emBlocos<T>(lista: readonly T[], tamanho = TETO_POR_CHAMADA): T[][] {
  const blocos: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) blocos.push(lista.slice(i, i + tamanho));
  return blocos.length > 0 ? blocos : [[]];
}

/**
 * Soma as prévias de vários blocos numa só.
 *
 * ⚠️ SOMA, E NÃO MOSTRA A DO PRIMEIRO BLOCO. Uma prévia que fala de 500 lotes quando o operador
 * marcou 907 é pior do que prévia nenhuma: ela dá confiança na metade errada do número.
 */
export function somarPrevisoes(partes: readonly Previsao[]): Previsao {
  const porCategoria = new Map<string, PreviaDaCategoria>();
  const avisos = new Set<string>();
  const recusas: Previsao["recusas"] = [];
  let movem = 0;

  for (const parte of partes) {
    for (const a of parte.avisos) avisos.add(a);
    recusas.push(...parte.recusas);
    movem += parte.resumo.movem;

    for (const grupo of parte.categorias) {
      const chave = grupo.categoriaId ?? "";
      const atual = porCategoria.get(chave);
      if (!atual) {
        porCategoria.set(chave, { ...grupo, previa: { ...grupo.previa } });
        continue;
      }
      atual.previa.ids = [...atual.previa.ids, ...grupo.previa.ids];
      atual.previa.jaEstao += grupo.previa.jaEstao;
      atual.previa.porParentesco += grupo.previa.porParentesco;
      atual.previa.semCategoria += grupo.previa.semCategoria;
      atual.previa.terrenos += grupo.previa.terrenos;
      atual.previa.vendaAndando += grupo.previa.vendaAndando;
      for (const troca of grupo.previa.trocamDeCategoria) {
        const achada = atual.previa.trocamDeCategoria.find((t) => t.de === troca.de);
        if (achada) achada.terrenos += troca.terrenos;
        else atual.previa.trocamDeCategoria.push({ ...troca });
      }
    }
  }

  const categorias = [...porCategoria.values()];
  return {
    avisos: [...avisos],
    categorias,
    divisoes: partes.flatMap((p) => p.divisoes),
    planilha: partes.find((p) => p.planilha)?.planilha ?? null,
    recusas,
    resumo: {
      linhas: categorias.reduce((n, c) => n + c.previa.ids.length, 0),
      movem,
      terrenos: categorias.reduce((n, c) => n + c.previa.terrenos, 0),
    },
  };
}

export type PedidoDoVinculo = {
  categoriaId?: null | string;
  codigo?: null | string;
  confirmarDivisao?: boolean;
  csv?: string;
  divisaoDestino?: string;
  enterpriseId: string;
  origem: "ficha" | "massa" | "planilha";
  unidadeIds?: string[];
};

function corpoDe(
  pedido: PedidoDoVinculo,
  acao: "aplicar" | "previa",
  bloco?: { ids?: string[]; linhas?: LinhaDaPlanilhaDeVinculo[] },
) {
  return {
    acao,
    ...(pedido.confirmarDivisao ? { confirmarDivisao: true } : {}),
    ...("categoriaId" in pedido ? { categoriaId: pedido.categoriaId ?? null } : {}),
    ...(pedido.divisaoDestino ? { divisaoDestino: pedido.divisaoDestino } : {}),
    ...(bloco?.ids ? { unidadeIds: bloco.ids } : {}),
    ...(bloco?.linhas ? { linhas: bloco.linhas } : {}),
    codigo: pedido.codigo ?? null,
    enterpriseId: pedido.enterpriseId,
    origem: pedido.origem,
  };
}

/**
 * Os blocos que este pedido vira. Um por chamada ao servidor.
 *
 * ⚠️ A PLANILHA TAMBÉM SE DIVIDE, e até 21/09/2026 ela não se dividia: os IDS iam em blocos de
 * 500 e o CSV ia inteiro numa chamada só. Acima do teto a porta devolvia 422 mandando *"dividir a
 * seleção por quadra ou por faixa de lotes"* — filtros que só existem na OUTRA aba. Cidade Jardim
 * tem 532 lotes, Lavra do Ouro 493, Lagoa Bonita 495 (medido em 21/09/2026): a planilha do
 * loteamento inteiro, que é o caminho normal do Lucas, era recusada por inteiro.
 *
 * ⚠️ E O CSV É LIDO AQUI, NO NAVEGADOR, com a MESMA `lerCsvDeVinculo` do servidor. Escrever um
 * segundo leitor de CSV na tela faria o bloco 1 e o bloco 2 discordarem do arquivo no dia em que um
 * dos dois mudasse de separador.
 */
function blocosDoPedido(pedido: PedidoDoVinculo): { ids?: string[]; linhas?: LinhaDaPlanilhaDeVinculo[] }[] {
  if (pedido.csv) {
    const linhas = lerCsvDeVinculo(pedido.csv);
    return emBlocos(linhas).map((parte) => ({ linhas: parte }));
  }
  return emBlocos(pedido.unidadeIds ?? []).map((ids) => ({ ids }));
}

/** A prévia, em blocos quando a seleção (ou a planilha) passa do teto. */
export async function conferir(
  pedido: PedidoDoVinculo,
): Promise<{ data: Previsao } | { erro: string }> {
  const partes: Previsao[] = [];
  for (const bloco of blocosDoPedido(pedido)) {
    const r = await chamar<Previsao>(corpoDe(pedido, "previa", bloco));
    if ("erro" in r) return r;
    partes.push(r.data);
  }
  return { data: somarPrevisoes(partes) };
}

/** A gravação, em blocos, somando o que cada bloco respondeu. */
export async function aplicar(
  pedido: PedidoDoVinculo,
): Promise<{ data: Aplicacao } | { erro: string; parcial: Aplicacao }> {
  const blocos = blocosDoPedido(pedido);
  const total: Aplicacao = {
    avisos: [],
    gravadas: 0,
    movidas: 0,
    naoMovidas: 0,
    planilha: null,
    porParentesco: 0,
    recusas: [],
    semCarimbo: false,
    terrenos: 0,
  };

  for (const bloco of blocos) {
    const r = await chamar<Aplicacao>(corpoDe(pedido, "aplicar", bloco));
    // ⚠️ PARA NO PRIMEIRO ERRO E DEVOLVE O QUE JÁ ENTROU — e até 21/09/2026 o comentário prometia
    // isso e o código devolvia só `{ erro }`, jogando fora o acumulador. Com 532 ids, o primeiro
    // bloco gravava 500 lotes, o segundo falhava, e a resposta não dizia uma palavra sobre os 500:
    // a tela mostrava só o erro, em cima da lista velha, e o operador clicava de novo.
    if ("erro" in r) return { erro: r.erro, parcial: total };
    total.avisos = [...new Set([...total.avisos, ...r.data.avisos])];
    total.gravadas += r.data.gravadas;
    total.movidas += r.data.movidas;
    total.naoMovidas += r.data.naoMovidas;
    total.planilha = r.data.planilha ?? total.planilha;
    total.porParentesco += r.data.porParentesco;
    total.recusas.push(...r.data.recusas);
    total.semCarimbo = total.semCarimbo || r.data.semCarimbo;
    total.terrenos += r.data.terrenos;
  }

  return { data: total };
}
