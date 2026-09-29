// O EMPREENDIMENTO NO C2X PELO ID: a casca que lê o catálogo e o cadastro para a régua pura de
// lib/apolo/c2x-pelo-id.ts (PAN-124). É o que uma leitura do C2X chama quando recebe SIGLA (a tela do
// Apolo manda `?codes=`) ou id do Panteon (a sessão, o settings), e precisa do `enterprises.id`.
//
// ⚠️ SEPARADA DA RÉGUA DE PROPÓSITO. A régua não importa nada que leia banco, então lib/apolo/server.ts
// e as demais leituras podem usá-la sem ciclo de import (o cadastro do Panteon importa server.ts).
//
// ⚠️ NADA AQUI LANÇA. O catálogo já devolve lista vazia quando o C2X cai; o cadastro, que lança, é
// pego aqui. Quem chama recebe `ok: false` com o motivo e responde como já respondia ao C2X fora do ar.
//
// ⚠️ O QUE A TRADUÇÃO PELA SIGLA GARANTE, E O QUE NÃO (revisão de 25/09/2026). A sigla é o que muda num
// renome; nenhuma tradução dela é à prova de renome. O que cada caminho entrega:
//   • quem tem o id (sessão, settings, cadastro, evento do Prometeu) chama a versão `...PorIds` da
//     leitura e não depende de sigla nenhuma. É o único caminho que atravessa qualquer renome;
//   • quem tira a sigla do MESMO catálogo que a traduz (o portal: `codigosDaSessao` e esta tradução
//     leem o catálogo em cache) também atravessa: depois do renome, os dois lados já falam a sigla nova;
//   • quem GUARDOU a sigla de antes (a tela do Apolo aberta antes do renome, uma sigla gravada) só é
//     salvo enquanto o catálogo em cache for anterior ao renome (até 10 minutos), ou pelo cadastro do
//     Panteon, se quem chama o passar (o cadastro guarda a sigla de quando o produto foi semeado).
//     Depois disso a sigla velha não acha nada, como `e.code in (...)` já não achava.

import { catalogoDeEmpreendimentos } from "@/lib/apolo/catalogo-empreendimentos";
import {
  type CadastroParaId,
  type CatalogoParaId,
  idDoC2x,
  type IdsDoC2x,
  idsDoC2xDasSiglas,
  idsDoC2xDosPedidos,
  type OpcoesDoIdDoC2x,
  PREFIXO_DO_GRUPO,
  semExcluidos,
} from "@/lib/apolo/c2x-pelo-id";
import { getHadesDbPool } from "@/lib/guardian/db";
import { carregarCadastroDeEmpreendimentos } from "@/lib/hercules/cadastro";

export type IdsDoC2xAoVivo = ({ ok: true } & IdsDoC2x) | { erro: string; ok: false };

/**
 * De onde veio a sigla, para a tradução saber em quem confiar primeiro.
 *
 * `conferirNoC2x: true` = a sigla foi lida AO VIVO do C2X por quem chama, sem cache: a tela de
 * Empreendimentos do Apolo (`loadApoloEnterprises`), as linhas do extrato e da defasagem. Ela é
 * conferida no C2X no mesmo instante (`select e.id, e.code from enterprises e where e.code in (...)`,
 * só para traduzir) e só o que o C2X não conhece mais cai no catálogo em cache.
 *
 * ⚠️ POR QUE A TELA DO APOLO NÃO PODE CONFIAR PRIMEIRO NO CATÁLOGO. O catálogo pode ter até 10 minutos:
 *   (a) se a Nívea troca as siglas entre dois empreendimentos, ou libera a X num renome e a dá a outro,
 *       o catálogo ainda diz X = o id antigo, e carteira, cobrança, vendas, unidades, ficha, política,
 *       extrato e defasagem sairiam com os dados do OUTRO empreendimento, rotulados como o pedido;
 *   (b) a sigla recém-criada ou renomeada que a tela já mostra voltaria vazia com `ok: true` até a
 *       releitura. É o vazio calado que o PAN-124 combate.
 * Conferida no C2X, a sigla que existe agora acha o mesmo que `e.code in (...)` achava; a sigla que o C2X
 * não conhece mais (a tela aberta antes do renome) ainda é salva pelo catálogo, se ele for de antes.
 *
 * ⚠️ O PORTAL NÃO CONFERE, E É DE PROPÓSITO. As siglas dele saem do catálogo (`codigosDaSessao`), já
 * recortadas pela permissão da sessão, que é por id. Conferir no C2X primeiro, numa troca de siglas
 * dentro da janela do cache, entregaria ao incorporador os dados do empreendimento que ficou com a
 * sigla, e não os do que ele tem. O catálogo é o mesmo retrato de onde a permissão saiu.
 *
 * O custo: uma consulta a mais, de uma linha por sigla, numa tabela de 37 linhas, por leitura da tela
 * interna (que abre por clique, sem polling). O portal não paga nada a mais.
 */
export type OrigemDaSigla = { conferirNoC2x?: boolean };

export const ERRO_CATALOGO_INDISPONIVEL =
  "Catálogo de empreendimentos do C2X indisponível: não dá para traduzir a sigla em id agora.";

/**
 * De quanto em quanto tempo, no máximo, uma MESMA sigla desconhecida pode forçar a releitura do catálogo.
 *
 * ⚠️ POR QUE RELER. O catálogo tem cache de 10 minutos. Uma sigla que ele ainda não conhece pode
 * existir no C2X (empreendimento criado há pouco, que o cadastro do Panteon já liga à sessão e
 * `linhasSoDoPanteon` põe no escopo). `e.code in (...)` a acharia na hora; sem a releitura, a leitura
 * ficaria vazia até o cache vencer.
 *
 * ⚠️ POR QUE UM TETO, E POR SIGLA. Sigla que nunca estará no catálogo (o ZZ TESTE/TST, único produto do
 * Panteon fora do C2X hoje; as siglas excluídas) forçaria uma releitura a cada leitura do portal. O teto
 * limita isso a um `select id, code, name from enterprises` (37 linhas) por minuto, por sigla, por
 * instância. É por sigla, e não um só para todas, para a TST não gastar o minuto de uma sigla que
 * acabou de nascer. Ver [[project_hermes_cost]]: leitura repetida já virou fatura.
 *
 * ⚠️ A RELEITURA NÃO APAGA O CATÁLOGO (`forcar: true`): se o C2X falhar nela, fica o anterior, para
 * este leitor e para todos os outros da instância (Board, escopo do portal).
 */
export const RELEITURA_MINIMA_MS = 60 * 1000;
const ultimaReleituraPorSigla = new Map<string, number>();
// Siglas diferentes são poucas (as do C2X e as do Panteon); o teto só protege contra lixo na URL.
const MAXIMO_DE_SIGLAS_LEMBRADAS = 500;

/** Só para teste: esquece quando cada sigla forçou a última releitura do catálogo. */
export function esquecerReleituraDoCatalogo(): void {
  ultimaReleituraPorSigla.clear();
}

function siglaNormalizada(texto: unknown): string {
  return String(texto ?? "").trim().toUpperCase();
}

/** As siglas desta lista que ainda podem forçar a releitura agora, já marcadas como usadas. */
function reservarReleitura(siglas: readonly string[], agoraMs: number): string[] {
  const podem = siglas.filter(
    (s) => agoraMs - (ultimaReleituraPorSigla.get(s) ?? Number.NEGATIVE_INFINITY) >= RELEITURA_MINIMA_MS,
  );
  if (podem.length === 0) return podem;
  if (ultimaReleituraPorSigla.size + podem.length > MAXIMO_DE_SIGLAS_LEMBRADAS) {
    ultimaReleituraPorSigla.clear();
  }
  // Marca ANTES de ler: a leitura é assíncrona, e o pedido que chegar enquanto ela corre não relê de novo.
  for (const s of podem) ultimaReleituraPorSigla.set(s, agoraMs);
  return podem;
}

async function cadastroOuNulo(): Promise<CadastroParaId | null> {
  try {
    return await carregarCadastroDeEmpreendimentos();
  } catch (erro) {
    console.error("[apolo][c2x-pelo-id] cadastro do Panteon indisponível", erro);
    return null;
  }
}

/**
 * Os ids que o C2X dá HOJE para estas siglas, ou `null` se a consulta não rodou.
 *
 * É o mesmo predicado da consulta antiga (`e.code in (...)`, com as siglas como vieram), só para
 * traduzir: os dados continuam indo pelo id. Devolve todos os ids que o MySQL casou, e o conjunto das
 * siglas (normalizadas) que acharam linha.
 */
async function siglasNoC2xAgora(
  siglas: readonly string[],
): Promise<null | { achadas: Set<string>; ids: number[] }> {
  const poolResult = getHadesDbPool();
  if (!poolResult.ok) return null;
  try {
    const [linhas] = await poolResult.pool.query(
      `select e.id, e.code
         from enterprises e
        where e.code in (${siglas.map(() => "?").join(", ")})`,
      [...siglas],
    );
    const ids: number[] = [];
    const achadas = new Set<string>();
    for (const linha of linhas as Array<{ code: null | string; id: number | string }>) {
      const id = idDoC2x(linha.id);
      if (id === null) continue;
      ids.push(id);
      achadas.add(siglaNormalizada(linha.code));
    }
    return { achadas, ids };
  } catch (erro) {
    console.error("[apolo][c2x-pelo-id] conferência da sigla no C2X falhou; fica o catálogo", erro);
    return null;
  }
}

/**
 * Os ids do C2X destas siglas (ver `idsDoC2xDasSiglas` e `OrigemDaSigla`).
 *
 * A ordem das fontes:
 *   1. com `conferirNoC2x`, o C2X agora (a sigla que existe hoje acha o que `e.code in` achava);
 *   2. o catálogo (o que quem chama passou, ou o do cache) e, se veio, o cadastro do Panteon;
 *   3. sem `conferirNoC2x`, a sigla que nenhum dos dois conhece força UMA releitura do catálogo, com o
 *      teto de `RELEITURA_MINIMA_MS` por sigla. Com `conferirNoC2x` não relê: o C2X acabou de dizer
 *      que a sigla não existe, e o catálogo em cache é o que ainda pode salvar a sigla de antes do renome.
 *
 * ⚠️ CATÁLOGO VAZIO É FALHA, NÃO "NENHUM EMPREENDIMENTO". `catalogoDeEmpreendimentos` devolve `[]`
 * quando o C2X não responde e não há catálogo anterior; tratar isso como "sigla sem id" faria a carteira
 * sair ZERADA com `ok: true` no dia em que o C2X cair, em vez do erro que ela mostra hoje. Por isso
 * `ok: false`, e quem chama responde como respondia ao C2X fora do ar. (Com `conferirNoC2x`, o C2X que
 * respondeu à conferência está no ar: o que ele não conhece é sigla que `e.code in` também não acharia.)
 *
 * @param opcoes.cadastro O cadastro do Panteon, se quem chama já o tem (não é lido aqui).
 * @param opcoes.catalogo O catálogo, se quem chama já o tem (a maioria das rotas do portal tem).
 */
export async function idsDoC2xDasSiglasAoVivo(
  siglas: Iterable<unknown>,
  opcoes: OpcoesDoIdDoC2x &
    OrigemDaSigla & {
      agoraMs?: number;
      cadastro?: CadastroParaId | null;
      catalogo?: CatalogoParaId | null;
    } = {},
): Promise<IdsDoC2xAoVivo> {
  const pedidas = [...new Set([...siglas].map((s) => String(s ?? "").trim()).filter(Boolean))];
  if (pedidas.length === 0) return { ids: [], ok: true, semId: [] };

  const agoraMs = opcoes.agoraMs ?? Date.now();
  const cadastro = opcoes.cadastro ?? null;
  // A exclusão é aplicada UMA vez, no fim, sobre o que veio de todas as fontes.
  const sem = (ids: number[]) => semExcluidos(ids, opcoes.excluir);

  // 1. A sigla lida ao vivo é conferida ao vivo.
  const doC2xAgora = opcoes.conferirNoC2x ? await siglasNoC2xAgora(pedidas) : null;
  const pendentes = doC2xAgora
    ? pedidas.filter((p) => !doC2xAgora.achadas.has(siglaNormalizada(p)))
    : pedidas;
  const idsDoC2xAgora = doC2xAgora?.ids ?? [];
  if (pendentes.length === 0) return { ids: sem(idsDoC2xAgora), ok: true, semId: [] };

  // 2. O catálogo (e o cadastro, se veio).
  const catalogo =
    opcoes.catalogo && opcoes.catalogo.length > 0
      ? opcoes.catalogo
      : await catalogoDeEmpreendimentos(agoraMs);
  if (catalogo.length === 0) {
    if (!doC2xAgora) return { erro: ERRO_CATALOGO_INDISPONIVEL, ok: false };
    return { ids: sem(idsDoC2xAgora), ok: true, semId: pendentes.map(siglaNormalizada) };
  }

  let traduzido = idsDoC2xDasSiglas(pendentes, { cadastro, catalogo }, { excluir: [] });

  // 3. A releitura, para a sigla que ninguém conhece (só quando o C2X não foi conferido agora).
  if (!doC2xAgora && traduzido.semId.length > 0 && reservarReleitura(traduzido.semId, agoraMs).length > 0) {
    const relido = await catalogoDeEmpreendimentos(agoraMs, { forcar: true });
    // Releitura que falhou devolve o catálogo anterior (ou vazio): nada muda na tradução.
    if (relido.length > 0 && relido !== catalogo) {
      traduzido = idsDoC2xDasSiglas(pendentes, { cadastro, catalogo: relido }, { excluir: [] });
    }
  }

  return { ids: sem([...idsDoC2xAgora, ...traduzido.ids]), ok: true, semId: traduzido.semId };
}

/**
 * Os ids do C2X destes ids do Panteon (ver `idsDoC2xDosPedidos`).
 *
 * Só lê o que precisa: id numérico não precisa de catálogo nem de cadastro; o catálogo e o cadastro
 * são lidos (juntos) só quando há `group:<Nome>` no pedido, e mesmo sem os dois o grupo ainda se
 * resolve pelos ids fixos de `ENTERPRISE_GROUPS`. Por isso esta nunca devolve `ok: false`.
 */
export async function idsDoC2xDosPedidosAoVivo(
  pedidos: Iterable<unknown>,
  opcoes: OpcoesDoIdDoC2x & {
    agoraMs?: number;
    cadastro?: CadastroParaId | null;
    catalogo?: CatalogoParaId | null;
  } = {},
): Promise<{ ok: true } & IdsDoC2x> {
  const lista = [...pedidos];
  const temGrupo = lista.some((p) =>
    String(p ?? "").trim().toLowerCase().startsWith(PREFIXO_DO_GRUPO),
  );

  let catalogo = opcoes.catalogo ?? null;
  let cadastro = opcoes.cadastro ?? null;
  if (temGrupo) {
    [catalogo, cadastro] = await Promise.all([
      catalogo ?? catalogoDeEmpreendimentos(opcoes.agoraMs ?? Date.now()),
      cadastro ?? cadastroOuNulo(),
    ]);
  }

  return { ok: true, ...idsDoC2xDosPedidos(lista, { cadastro, catalogo }, opcoes) };
}
