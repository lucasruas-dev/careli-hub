import type { RowDataPacket } from "mysql2/promise";

import { getHadesDbPool } from "@/lib/guardian/db";

import { chaveDoLote, lerLinhasDoMapa } from "./masterplan-recorte";

// O MASTERPLAN PASSA A LER A SITUAÇÃO DO C2X, EM VEZ DE ACREDITAR NO ARQUIVO.
//
// Regra do Lucas (19/08/2026): *"o masterplan é dinâmico, não pode ser estático"*, depois de achar
// a divergência no VOL: *"na tela de vendas está correto, 91 vendidos, 2 disponível e 48 bloqueado,
// contudo, quando eu abro o masterplan me retorna 6 disponível, e alguns lotes que realmente está
// disponível consta como vendido... teve cancelamento ontem que o masterplan não atualizou"*.
//
// ⚠️ A CAUSA. O `vale-do-ouro.html` é um arquivo GERADO, com a situação de cada lote gravada dentro
// dele (`[quadra,"lote",situação,área,valor,"comprador","polígono"]`). O arquivo em produção é de
// 11/08: tudo o que aconteceu depois — venda nova, cancelamento, bloqueio — não chega nele. Medido
// contra o C2X no dia do pedido: 8 lotes errados no VOL (os 6 disponíveis que o Lucas viu contra os
// 2 reais) e 4 no VOC, além de 21 compradores defasados.
//
// O DESENHO CONTINUA VINDO DO ARQUIVO. Polígono, quadra, lote e área são geometria: não mudam com
// venda, e regerar isso a cada request seria trocar um mapa aprovado por um desenhado na hora. O
// que passa a vir do C2X é só o que MUDA: situação, comprador e preço.
//
// ⚠️ ISTO NÃO É UMA SEGUNDA RÉGUA DE SITUAÇÃO. A conversão de `sale_status_id`/`sale_blocked` para
// as quatro cores do mapa é a mesma de `mapUnitRow` (lib/apolo/empreendimentos.ts), que é o que a
// tela de Vendas usa — era com ela que o Lucas estava comparando. Uma régua própria aqui faria o
// mapa e a tela discordarem de novo, só que por outro motivo.
//
// ⚠️ NADA DISTO ALARGA ESCOPO. Este módulo só descreve os lotes que já vão ser servidos; quem
// decide o que sai continua sendo o recorte fail-closed de `masterplan-recorte.ts`, que roda
// depois. Aliás, a consulta é a MESMA que já definia o escopo: era um `select block, lot`, e agora
// traz as colunas de estado junto — um SELECT, não dois.

/** As quatro cores do mapa, na ordem que o HTML gravou: `['Disponível','Reservado','Vendido','Bloqueado']`. */
export const MAPA = { BLOQUEADO: 3, DISPONIVEL: 0, RESERVADO: 1, VENDIDO: 2 } as const;

/** `sale_statuses` do C2X. Igual ao `SALE_STATUS` de `empreendimentos.ts`. */
const C2X = { BLOQUEADO: 5, DISPONIVEL: 1, EM_NEGOCIACAO: 3, RESERVADO: 2, VENDIDO: 4 } as const;

// Propostas que NÃO dão dono ao lote. O resto (inclusive `Finalizado` e `Em distrato`) dá: enquanto
// o distrato não fecha, o comprador ainda é aquele.
const PROPOSTA_MORTA = [7, 8, 11]; // Cancelado · Reprovado análise de crédito · Distratado

export type EstadoDoLote = {
  /** Nome do comprador, ou "" quando o lote não tem dono hoje. */
  comprador: string;
  /** Já na régua do mapa (0..3). */
  situacao: number;
  valor: number;
};

type LinhaDoC2x = RowDataPacket & {
  block: null | number | string;
  comprador: null | string;
  lot: null | number | string;
  price: null | number | string;
  sale_blocked: null | number;
  sale_status_id: null | number;
  updated_at: Date | null;
};

/**
 * A situação de cada lote destes empreendimentos, AGORA, na régua do mapa.
 *
 * Devolve `null` quando o C2X não responde ou não há lote nenhum — e quem chama trata isso como
 * "não sei de quem é este mapa", que é o fail-closed do escopo.
 */
export async function lerEstadoDosLotes(
  codes: string[],
): Promise<Map<string, EstadoDoLote> | null> {
  if (codes.length === 0) return null;

  const pool = getHadesDbPool();
  if (!pool.ok) return null;

  try {
    const [linhas] = await pool.pool.query<LinhaDoC2x[]>(
      `select u.block, u.lot, u.price, u.sale_status_id, u.sale_blocked, u.updated_at,
              cli.name as comprador
         from enterprise_unities u
         join enterprises e on e.id = u.enterprise_id
         left join acquisition_requests ar on ar.id = (
           select a2.id
             from acquisition_requests a2
            where a2.enterprise_unity_id = u.id
              and coalesce(a2.acquisition_request_stage_id, 0) not in (${PROPOSTA_MORTA.join(", ")})
            order by a2.created_at desc, a2.id desc
            limit 1)
         left join users cli on cli.id = ar.client_id
        where e.code in (${codes.map(() => "?").join(", ")})`,
      codes,
    );

    const estados = new Map<string, EstadoDoLote>();
    const quando = new Map<string, number>();

    for (const linha of linhas) {
      if (linha.block == null || linha.lot == null) continue;

      const chave = chaveDoLote(linha.block, linha.lot);
      const situacao = situacaoDoMapa(linha.sale_status_id, linha.sale_blocked);
      const temDono = situacao === MAPA.RESERVADO || situacao === MAPA.VENDIDO;

      // ⚠️ A CHAVE QUADRA-LOTE COLIDE QUANDO A SESSÃO TEM DIVISÃO E HISTÓRICO JUNTOS. O Vale do
      // Ouro foi dividido (VLO -> VOC + VOL): o VLO ficou com os mesmos 298 lotes, agora só como
      // histórico, e casar sem desempate deixa o fantasma sobrescrever o lote vivo — 165 lotes
      // "errados" que na verdade eram o VLO parado. Ganha quem tem dono; empate, o mais recente.
      const anterior = estados.get(chave);
      if (anterior) {
        const antesTemDono = anterior.comprador !== "";
        const antesQuando = quando.get(chave) ?? 0;
        const agora = linha.updated_at ? linha.updated_at.getTime() : 0;
        if (antesTemDono !== temDono ? antesTemDono : antesQuando >= agora) continue;
      }

      estados.set(chave, {
        comprador: temDono ? limpar(linha.comprador) : "",
        situacao,
        // ⚠️ BLOQUEADO GRAVA ZERO, que é a convenção do próprio arquivo (os 108 bloqueados vieram
        // com valor 0). O C2X guarda `price = 1` nesses lotes, e copiar isso cru poria "R$ 1,00"
        // na tabela e no total do mapa.
        valor: situacao === MAPA.BLOQUEADO ? 0 : Math.round(Number(linha.price ?? 0)),
      });
      quando.set(chave, linha.updated_at ? linha.updated_at.getTime() : 0);
    }

    return estados.size > 0 ? estados : null;
  } catch (error) {
    console.error("[incorporador][masterplan] falha ao ler o estado dos lotes", error);
    return null;
  }
}

/** `sale_status_id` + `sale_blocked` -> a cor do mapa. Mesma régua de `mapUnitRow`. */
export function situacaoDoMapa(statusId: null | number, bloqueado: null | number): number {
  const status = Number(statusId ?? 0);

  // O status 5 vale por si só, sem depender do flag: o legado é editado à mão, e limpar o flag
  // deixando o status pintaria de disponível um lote cujo texto ainda diz "Bloqueado para venda".
  if (status === C2X.BLOQUEADO || Number(bloqueado ?? 0) === 1) return MAPA.BLOQUEADO;
  // "Em negociação" é vendido no mapa: são as 4 cores contra os 5 status do C2X, e é assim que a
  // tela de Vendas conta (os 91 "em negociação" do VOL são os 91 vendidos que o Lucas viu lá).
  if (status === C2X.VENDIDO || status === C2X.EM_NEGOCIACAO) return MAPA.VENDIDO;
  if (status === C2X.RESERVADO) return MAPA.RESERVADO;
  return MAPA.DISPONIVEL;
}

/**
 * O nome, seguro para voltar dentro de uma string do arquivo.
 *
 * ⚠️ ISTO NÃO É COSMÉTICA, E O RECORTE NÃO SALVA. Uma aspas no meio do nome fecha a string do
 * campo e o `DADOS` deixa de ser JavaScript válido: o array inteiro morre no parse e o mapa abre
 * EM BRANCO — sem erro de servidor, sem log, sem nada. E o recorte não pega: ele confere a CABEÇA
 * da linha (quadra e lote) e a CAUDA (o polígono), e o miolo passa intacto entre os dois. Foi o
 * teste que mostrou isso, esperando uma recusa que não veio.
 *
 * Por isso a limpeza mora aqui, no ponto em que o texto ENTRA no arquivo, e não só na leitura do
 * C2X: quem escrever a próxima chamada não precisa saber deste detalhe para não quebrar a tela.
 */
function limpar(nome: null | string): string {
  return String(nome ?? "").replace(/["\\]/g, " ").replace(/\s+/g, " ").trim();
}

/** Um inteiro que sempre volta como número no arquivo: `NaN` ou `Infinity` matariam o `DADOS`. */
function numero(valor: number): number {
  return Number.isFinite(valor) ? Math.max(0, Math.round(valor)) : 0;
}

// `[quadra,"lote",situação,área,valor,"comprador","polígono"]` — reescreve situação, valor e
// comprador, e não encosta em quadra, lote, área nem polígono, que são o desenho.
const LINHA = /^(\[(?:\d+|"[^"]*"),"[^"]*",)(\d+)(,[\d.]+,)([\d.]+),"([^"]*)"(,"[^"]*"\])$/;

export type Atualizacao = {
  /** Lotes cuja situação MUDOU — o que o arquivo estava contando errado. */
  corrigidos: number;
  html: string;
  /** Linhas que o C2X não conhece: ficam como estavam. */
  semEstado: number;
};

/**
 * Devolve o HTML com situação, comprador e valor trocados pelo estado atual do C2X.
 *
 * ⚠️ DEGRADA PARA O ARQUIVO, NÃO PARA O ERRO. Linha que não casa com o formato, ou lote que o C2X
 * não conhece, fica exatamente como estava: o pior caso volta a ser o comportamento de hoje. Isto
 * é o oposto do recorte, que recusa — porque aqui o risco é mostrar um dado velho, e lá era
 * mostrar a carteira do vizinho.
 */
export function aplicarEstadoAtual(
  html: string,
  estados: Map<string, EstadoDoLote>,
): Atualizacao {
  const bloco = lerLinhasDoMapa(html);
  if (!bloco || bloco.desconhecidas > 0) return { corrigidos: 0, html, semEstado: 0 };

  let corrigidos = 0;
  let semEstado = 0;

  const linhas = bloco.linhas.map((item) => {
    const estado = estados.get(item.chave);
    if (!estado) {
      semEstado += 1;
      return item.miolo;
    }

    const partes = item.miolo.match(LINHA);
    if (!partes) {
      semEstado += 1;
      return item.miolo;
    }

    // A tela só conhece quatro cores; um índice fora disso deixaria o lote sem legenda e fora de
    // todo filtro. Qualquer coisa que não seja 0..3 cai em "disponível", que é o estado neutro.
    const situacao = [0, 1, 2, 3].includes(estado.situacao) ? estado.situacao : MAPA.DISPONIVEL;

    if (Number(partes[2]) !== situacao) corrigidos += 1;

    // `limpar` e `numero` de novo, e de propósito: a leitura do C2X já normaliza, mas é a ESCRITA
    // que quebraria o arquivo, e é aqui que o valor vira texto dentro dele.
    return `${partes[1]}${situacao}${partes[3]}${numero(estado.valor)},"${limpar(estado.comprador)}"${partes[6]}`;
  });

  return {
    corrigidos,
    html: html.slice(0, bloco.inicio) + "\n" + linhas.join(",\n") + "];" + html.slice(bloco.fim),
    semEstado,
  };
}
