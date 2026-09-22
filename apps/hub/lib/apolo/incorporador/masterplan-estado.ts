import type { RowDataPacket } from "mysql2/promise";

import { getHadesDbPool } from "@/lib/guardian/db";
import {
  baldeDaSituacao,
  type SituacaoDasUnidades,
  type SituacaoDaUnidade,
  situacaoDoTerreno,
} from "@/lib/hercules/situacao-da-unidade";

import { situacoesDoArquivo } from "./masterplan-dois-estados";
import { chaveDoLote, lerLinhasDoMapa } from "./masterplan-recorte";

// O MASTERPLAN NÃO ACREDITA NO ARQUIVO, E A COR DO LOTE VEM DO PANTEON.
//
// Regra do Lucas (19/08/2026): *"o masterplan é dinâmico, não pode ser estático"*, depois de achar
// a divergência no VOL: *"na tela de vendas está correto, 91 vendidos, 2 disponível e 48 bloqueado,
// contudo, quando eu abro o masterplan me retorna 6 disponível"*. O `vale-do-ouro.html` é um
// arquivo GERADO, com a situação de cada lote gravada dentro dele
// (`[quadra,"lote",situação,área,valor,"comprador","polígono"]`), e ele congela o dia em que foi
// gerado. Por isso o que MUDA é reescrito ao servir: situação, comprador e preço.
//
// ⚠️ A SITUAÇÃO SAI DE `lib/hercules/situacao-da-unidade.ts`, E SÓ DE LÁ (Lucas, 18/09/2026:
// *"esses status tem que morar em um so lugar"* · *"no c2x não precisa olhar"*). Até aqui este
// arquivo tinha a própria régua, `situacaoDoMapa`, que convertia `sale_status_id`/`sale_blocked`
// do C2X nas quatro cores — e não via nada feito no Panteon: lote reservado ou em proposta no
// Hércules abria VERDE neste mapa, e os bloqueados do Panteon também. A régua do legado saiu
// inteira; a leitura do C2X não traz mais nem a coluna de status, para ninguém ser tentado a
// usá-la de novo.
//
// O QUE CONTINUA VINDO DO C2X, E POR QUÊ:
//   • o ESCOPO (quais lotes este portal pode ver). É permissão, não situação: a divisão do
//     loteamento entre os donos foi feita no legado, e o recorte fail-closed de
//     `masterplan-recorte.ts` segue sendo a última palavra sobre o que sai;
//   • o COMPRADOR e o PREÇO, que a régua única não responde.
//
// O DESENHO CONTINUA VINDO DO ARQUIVO: polígono, quadra, lote e área são geometria.

/** As quatro cores do mapa, na ordem que o HTML gravou: `['Disponível','Reservado','Vendido','Bloqueado']`. */
export const MAPA = { BLOQUEADO: 3, DISPONIVEL: 0, RESERVADO: 1, VENDIDO: 2 } as const;

// Propostas que NÃO dão dono ao lote. O resto (inclusive `Finalizado` e `Em distrato`) dá: enquanto
// o distrato não fecha, o comprador ainda é aquele. Serve SÓ para achar o nome; quem diz se o lote
// tem dono é a situação do Panteon.
const PROPOSTA_MORTA = [7, 8, 11]; // Cancelado · Reprovado análise de crédito · Distratado

export type EstadoDoLote = {
  /** Nome do comprador, ou "" quando o lote não tem dono hoje. */
  comprador: string;
  /** Já na régua do mapa (0..3). */
  situacao: number;
  valor: number;
};

/**
 * Um lote do escopo, como o C2X o conhece: QUEM ele é, o comprador e o preço.
 *
 * ⚠️ SEM SITUAÇÃO, DE PROPÓSITO. O tipo não tem campo para o status do legado: a situação só entra
 * em `estadoDosLotes`, e só pela régua única.
 */
export type LoteDoC2x = {
  /** Para desempatar duas linhas do mesmo terreno: a mais recente ganha. */
  atualizadoEm: number;
  chave: string;
  /** `enterprise_unities.name` ("VOC0305", "LBPC0101"): é o `codigo` que a carga gravou em `hercules_unidades`. */
  codigo: null | string;
  /** Nome já limpo, ou "" quando o C2X não tem proposta viva no lote. */
  comprador: string;
  /** `enterprises.id` do C2X: é o `enterprise_id` que `hercules_unidades` guarda ("35", "37"...). */
  enterpriseId: string;
  /** `enterprise_unities.id`: é o `origem_c2x_id` de `hercules_unidades`. */
  origemC2xId: string;
  preco: number;
};

type LinhaDoC2x = RowDataPacket & {
  block: null | number | string;
  comprador: null | string;
  enterprise_id: number | string;
  id: number | string;
  lot: null | number | string;
  name: null | string;
  price: null | number | string;
  updated_at: Date | null;
};

/**
 * Os lotes destes empreendimentos no C2X: o ESCOPO do mapa, com comprador e preço.
 *
 * Devolve `null` quando o C2X não responde ou não há lote nenhum — e quem chama trata isso como
 * "não sei de quem é este mapa", que é o fail-closed do escopo.
 */
export async function lerLotesDoEscopo(codes: string[]): Promise<LoteDoC2x[] | null> {
  if (codes.length === 0) return null;

  const pool = getHadesDbPool();
  if (!pool.ok) return null;

  try {
    const [linhas] = await pool.pool.query<LinhaDoC2x[]>(
      `select u.id, u.name, u.enterprise_id, u.block, u.lot, u.price, u.updated_at,
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

    const lotes: LoteDoC2x[] = [];
    for (const linha of linhas) {
      if (linha.block == null || linha.lot == null) continue;
      lotes.push({
        atualizadoEm: linha.updated_at ? linha.updated_at.getTime() : 0,
        chave: chaveDoLote(linha.block, linha.lot),
        codigo: String(linha.name ?? "").trim() || null,
        comprador: limpar(linha.comprador),
        enterpriseId: String(linha.enterprise_id),
        origemC2xId: String(linha.id),
        preco: Number(linha.price ?? 0),
      });
    }

    return lotes.length > 0 ? lotes : null;
  } catch (error) {
    console.error("[incorporador][masterplan] falha ao ler os lotes do escopo", error);
    return null;
  }
}

/**
 * Os cinco baldes da régua única -> o índice de cor que o arquivo grava.
 *
 * ⚠️ O ARQUIVO DO MAPA SÓ TEM QUATRO CORES (o Garden, três). "Em negociação" (proposta, contrato,
 * assinatura) pinta de VENDIDO, como o mapa sempre fez com o "em negociação" do legado. Sem esta
 * linha o balde caía no BLOQUEADO: o lote em contrato aparecia bloqueado e sem o comprador.
 */
const COR_DO_BALDE: Record<ReturnType<typeof baldeDaSituacao>, number> = {
  bloqueado: MAPA.BLOQUEADO,
  disponivel: MAPA.DISPONIVEL,
  // ⚠️ O CANCELAMENTO PEDIDO PINTA DE VENDIDO no mapa, e não ganha cor própria: o arquivo do
  // masterplan só tem quatro slots, e enquanto o jurídico não desfaz o contrato aquele lote tem
  // dono. Pintar de bloqueado apagaria o nome do comprador e zeraria o valor no painel do lote.
  em_cancelamento: MAPA.VENDIDO,
  negociacao: MAPA.VENDIDO,
  reservado: MAPA.RESERVADO,
  vendido: MAPA.VENDIDO,
};

/**
 * A situação da régua única -> a cor do mapa.
 *
 * Não decide nada: quem decide é `situacaoDoTerreno`, e os cinco baldes são de `baldeDaSituacao`
 * (proposta, contrato, assinatura e faturado pintam de VENDIDO, que é o mesmo agrupamento que o
 * mapa sempre fez com o "em negociação" do legado). Aqui é só a tradução de vocabulário para o
 * índice que o arquivo entende.
 */
export function corDoMapa(situacao: SituacaoDaUnidade): number {
  return COR_DO_BALDE[baldeDaSituacao(situacao)] ?? MAPA.BLOQUEADO;
}

/**
 * A situação de um lote que o Panteon não conhece. Quem responde é a própria régua (cadastro
 * ausente, sem processo nenhum), e não este arquivo: hoje é "bloqueada", e se a régua mudar a
 * resposta, o mapa muda junto.
 */
const FORA_DO_PANTEON: SituacaoDaUnidade = situacaoDoTerreno({
  cadastro: null,
  propostasVivas: [],
  reservada: false,
});

/**
 * Junta o escopo do C2X com a situação do Panteon, lote a lote. PURA.
 *
 * O lote é achado no Panteon pelo ID DO LEGADO (`porOrigemC2x`) e, se ele não casar, pelo CÓDIGO
 * (`porCodigo`): a mesma ordem de `acharUnidade`, usada pela aba Unidades e pelos cards. Com a ordem
 * invertida, duas linhas com o mesmo código (unidade renomeada numa carga) davam verde aqui e
 * Reservado no Apolo. Os dois índices respondem por QUALQUER linha do terreno: no produto dividido
 * o mesmo lote é `VOC0305` na gleba e `VLO0305` no pai, e os dois dão a mesma resposta.
 *
 * ⚠️ LOTE QUE O PANTEON NÃO CONHECE NÃO SAI LIVRE. `hercules_unidades` é carregada do C2X por sync;
 * unidade criada no legado depois da carga não tem linha aqui. Sem situação, o lote pinta como a
 * régua pinta um cadastro ausente (BLOQUEADO, ver `FORA_DO_PANTEON`) e entra em `semSituacao`,
 * para aparecer no log. Pintar de verde o que não se sabe é convidar a segunda venda.
 */
export function estadoDosLotes(
  lotes: readonly LoteDoC2x[],
  situacoes: Pick<SituacaoDasUnidades, "porCodigo" | "porOrigemC2x">,
): { estados: Map<string, EstadoDoLote>; semSituacao: number } {
  const estados = new Map<string, EstadoDoLote>();
  const escolhido = new Map<string, { atualizadoEm: number; comComprador: boolean; temDono: boolean }>();
  let semSituacao = 0;

  for (const lote of lotes) {
    const unidade =
      situacoes.porOrigemC2x.get(lote.origemC2xId) ??
      (lote.codigo ? situacoes.porCodigo.get(lote.codigo.trim().toUpperCase()) : undefined);

    if (!unidade) semSituacao += 1;
    const situacao = corDoMapa(unidade?.situacao ?? FORA_DO_PANTEON);
    const temDono = situacao === MAPA.RESERVADO || situacao === MAPA.VENDIDO;
    // O nome só aparece em lote que o PANTEON diz ter dono: lote livre exibindo comprador é o erro
    // que a reescrita existe para corrigir.
    const comprador = temDono ? lote.comprador : "";

    // ⚠️ A CHAVE QUADRA-LOTE COLIDE QUANDO A SESSÃO TEM O PAI E A GLEBA JUNTOS (VLO com VOC ou VOL):
    // o mesmo terreno vem duas vezes do C2X. Ganha quem tem dono; empatado, quem tem o nome do
    // comprador (o pai não tem proposta: elas foram movidas para a gleba na divisão); empatado de
    // novo, o mais recente. É a escolha de QUAL LINHA dá o nome e o preço; a situação, lida pelo
    // terreno, já é a mesma nas duas.
    const antes = escolhido.get(lote.chave);
    if (antes) {
      const ficaOAnterior =
        antes.temDono !== temDono
          ? antes.temDono
          : antes.comComprador !== (comprador !== "")
            ? antes.comComprador
            : antes.atualizadoEm >= lote.atualizadoEm;
      if (ficaOAnterior) continue;
    }

    estados.set(lote.chave, {
      comprador,
      situacao,
      // ⚠️ BLOQUEADO GRAVA ZERO, que é a convenção do próprio arquivo (os 108 bloqueados vieram com
      // valor 0). E o preço de R$ 1 também vira zero: é o marcador de "sem preço" que o C2X grava nos
      // lotes que ele bloqueia, e um lote livre no Panteon e bloqueado no legado apareceria na tabela
      // e no total do mapa custando "R$ 1,00".
      valor: situacao === MAPA.BLOQUEADO || !(lote.preco > 1) ? 0 : Math.round(lote.preco),
    });
    escolhido.set(lote.chave, {
      atualizadoEm: lote.atualizadoEm,
      comComprador: comprador !== "",
      temDono,
    });
  }

  return { estados, semSituacao };
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
  /**
   * `false` quando nada foi escrito: bloco `DADOS` ilegível, ou arquivo que não declara quantas
   * situações conhece. Quem chama RECUSA o mapa: servir a situação gravada no arquivo seria mostrar
   * como livre o lote que o arquivo congelou livre.
   */
  escrito: boolean;
  html: string;
  /** Linhas que o escopo não conhece: ficam como estavam, e o recorte as tira do `DADOS`. */
  semEstado: number;
};

/**
 * Devolve o HTML com situação, comprador e valor trocados pelo estado de agora.
 *
 * Linha de lote que o escopo não conhece fica exatamente como estava: ela não é deste portal, e o
 * recorte, que roda depois, a tira do `DADOS` e devolve só o polígono.
 *
 * ⚠️ O ÍNDICE DE "OCUPADO" MUDA DE ARQUIVO PARA ARQUIVO. Quatro arquivos têm quatro situações
 * (`TOT=[0,0,0,0]`); o `garden.html` tem TRÊS (`['Disponível','Reservado','Vendido']`) e não tem
 * slot de bloqueado. Gravar `3` nele fazia o lote sumir do mapa: o `pintar()` de lá só percorre
 * `s<3` e o filtro `F.sit[3]` é `undefined`. Então a situação que não cabe no arquivo, e qualquer
 * valor fora da régua, vai para o ÚLTIMO slot que ele tem — nunca para o `0`. O erro possível passa
 * a ser chamar de "Vendido" um lote bloqueado do Garden, e nunca oferecer um lote que tem dono.
 */
export function aplicarEstadoAtual(
  html: string,
  estados: Map<string, EstadoDoLote>,
): Atualizacao {
  const bloco = lerLinhasDoMapa(html);
  const slots = situacoesDoArquivo(html);
  if (!bloco || bloco.desconhecidas > 0 || slots === null) {
    return { corrigidos: 0, escrito: false, html, semEstado: 0 };
  }
  const ultimo = slots - 1;

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

    const situacao =
      Number.isInteger(estado.situacao) && estado.situacao >= 0 && estado.situacao <= ultimo
        ? estado.situacao
        : ultimo;

    if (Number(partes[2]) !== situacao) corrigidos += 1;

    // `limpar` e `numero` de novo, e de propósito: a leitura do C2X já normaliza, mas é a ESCRITA
    // que quebraria o arquivo, e é aqui que o valor vira texto dentro dele.
    return `${partes[1]}${situacao}${partes[3]}${numero(estado.valor)},"${limpar(estado.comprador)}"${partes[6]}`;
  });

  return {
    corrigidos,
    escrito: true,
    html: html.slice(0, bloco.inicio) + "\n" + linhas.join(",\n") + "];" + html.slice(bloco.fim),
    semEstado,
  };
}
