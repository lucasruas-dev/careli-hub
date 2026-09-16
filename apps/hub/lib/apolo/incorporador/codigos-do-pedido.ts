import { NextResponse } from "next/server";

import type { EmpreendimentoDoCatalogo } from "@/lib/apolo/catalogo-empreendimentos";
import { carregarCadastroDeEmpreendimentos, type LinhaDoCadastro } from "@/lib/hercules/cadastro";
import {
  codigosDosIdsDoC2x,
  ehIdDoPai,
  expandirIdDoPainel,
} from "@/lib/hercules/expandir-id-do-painel";

import { codesDoRecorte, type EmpreendimentoDoPortal } from "./empreendimentos-do-portal";
import { idsDaSessao } from "./escopo";
import type { SessaoIncorporador } from "./sessao";

// O `emp` QUE A TELA MANDOU → OS CÓDIGOS QUE A LEITURA RECEBE. Num lugar só.
//
// Três rotas leem o mesmo recorte (vendas, vendas/assinaturas, vendas/contratos) e a TelaVendas
// manda o MESMO `emp` para as três — inclusive o `empFixo` que o "Ver mais" da aba Produtos abre.
// Na revisão de 02/09/2026 a resolução do pai vivia só em vendas/route.ts: a pílula "Contratos"
// dentro de um produto aberto pelo pai chamava /assinaturas?emp=pai:<uuid>, a rota só conhecia
// `codesDoRecorte`, sobrava lista vazia e a tela mostrava "Nao encontrado." em vermelho para um
// produto que É do coordenador. Regra nova numa rota só é bug nas outras duas: por isso a
// tradução mora aqui e as três chamam.
//
// O `emp` chega em TRÊS formatos, e os três só REDUZEM o que a sessão já autorizou:
//   • "pai:<uuid>" — o PAI do cadastro do Panteon (hercules_empreendimentos), que é o que o
//     "Ver mais" da linha do pai manda. Expande para os c2x ids dos filhos autorizados (ou o do
//     próprio pai, quando não tem filho) pela MESMA regra que montou os cards (`alcanceDoPai`);
//   • um id NUMÉRICO do C2X ("33") — o que o "Ver mais" da linha de um FILHO manda. ⚠️ Não passa
//     por `codesDoRecorte`: o catálogo agrupa a Lagoa Bonita como "group:Lagoa Bonita", nenhuma
//     linha dele tem id "33", e o LBF aberto pelo filho respondia 404. Passa pela mesma expansão
//     do pai, que para id solto devolve [id] se autorizado — e daí vira código pelo catálogo;
//   • o id do catálogo ("group:Lagoa Bonita", "37") — o que o seletor da TelaVendas manda —
//     resolvido por `codesDoRecorte`, como sempre foi. (O "37" cai no caso numérico acima e chega
//     ao mesmo VOC: os dois caminhos concordam por construção.)
//
// ⚠️ FAIL-CLOSED EM DUAS CAMADAS no caminho expandido: a expansão cruza com `idsDaSessao` (escopo
// expandido: grupo + divisões) e o código resultante ainda é cruzado com `codesAutorizados`.
// Cadastro fora do ar responde 503, e não 404: sem cadastro não dá para provar que o pai é dele,
// e "não encontrado" para um produto que É dele vira ligação para a Careli. O id numérico NÃO
// carrega o cadastro (não precisa dele), então um pico do Supabase não derruba o filho.
//
// ⚠️ PRODUTO DO PANTEON SEM `proprios` (16/09/2026). `codigosDaSessao` passou a devolver também os
// códigos dos produtos nascidos no Panteon, e as rotas que nunca somaram `soDoPanteon` (vendas,
// vendas/contratos, carteira) mandam só `codesAutorizados`. Então a tradução aprendeu a achar o
// produto do Panteon sem depender de a rota passar `proprios`:
//   • sem pedido, ou pedido pelo CÓDIGO: o que está em `codesAutorizados` e o catálogo do C2X não
//     conhece É o produto do Panteon (já passou pelo escopo em `codigosDaSessao`);
//   • pedido pelo id numérico (100000): o código sai do cadastro. A casca só lê o cadastro quando
//     a sessão tem o id, o catálogo não o conhece e a rota não mandou `proprios` — o filho do C2X
//     continua sem depender do Supabase.
// Tudo por `Set` e em caixa alta: a rota que ainda soma `proprios` recebe o MESMO resultado, sem
// código repetido.

export type CodigosDoPedido = { codes: string[]; ok: true } | { ok: false; response: NextResponse };

const SO_DIGITOS = /^\d+$/;

const maiusculo = (code: unknown): string => String(code ?? "").trim().toUpperCase();

/** Sem repetição, em caixa alta, sem vazio: a forma única dos códigos que saem daqui. */
function unicos(codes: string[]): string[] {
  return [...new Set(codes.map(maiusculo).filter(Boolean))];
}

/**
 * O pedido é um id numérico da sessão que o catálogo do C2X não traduz? É o caso em que a casca
 * precisa do cadastro para achar o código (produto do Panteon, ou C2X fora do ar).
 */
export function pedidoPrecisaDoCadastro(entrada: {
  catalogo: Array<Pick<EmpreendimentoDoCatalogo, "stageIds">>;
  pedido: null | string | undefined;
  permitidos: Set<string>;
}): boolean {
  const limpo = String(entrada.pedido ?? "").trim();
  if (ehIdDoPai(limpo)) return true;
  if (!SO_DIGITOS.test(limpo) || !entrada.permitidos.has(limpo)) return false;

  return !entrada.catalogo.some((emp) => emp.stageIds.some((id) => String(id).trim() === limpo));
}

/** O pedido precisa da expansão por id do C2X (pai do cadastro ou id numérico solto)? */
export function pedidoPrecisaDeExpansao(pedido: null | string | undefined): boolean {
  const limpo = String(pedido ?? "").trim();
  return ehIdDoPai(limpo) || SO_DIGITOS.test(limpo);
}

/**
 * O núcleo PURO da tradução — o que dá para testar sem banco. `permitidos` é o que `idsDaSessao`
 * já expandiu; `cadastro` pode vir vazio quando o pedido não é pai (não é consultado).
 */
export function resolverCodigosDoPedido(entrada: {
  cadastro: LinhaDoCadastro[];
  catalogo: EmpreendimentoDoCatalogo[];
  codesAutorizados: string[];
  empreendimentos: EmpreendimentoDoPortal[];
  pedido: null | string | undefined;
  permitidos: Set<string>;
  /**
   * Os empreendimentos que existem SÓ no Panteon (ver `soDoPanteon`), com o id do C2X que o
   * cadastro guarda para eles.
   *
   * ⚠️ SEM ELES O PRODUTO RESPONDE 404 nos DOIS caminhos, porque a tradução id → código passa pelo
   * catálogo, que é um select em `enterprises` do legado. Foi o que aconteceu com o empreendimento
   * de teste: as unidades estavam gravadas, o produto aparecia no seletor (que lê o cadastro do
   * Panteon), e a Venda respondia "Produto não encontrado".
   */
  proprios?: { codigo: string; enterpriseId: string }[];
}): string[] {
  const { cadastro, catalogo, codesAutorizados, empreendimentos, pedido, permitidos } = entrada;
  const proprios = entrada.proprios ?? [];
  const limpo = String(pedido ?? "").trim();

  if (!pedidoPrecisaDeExpansao(limpo)) {
    const doCatalogo = codesDoRecorte(empreendimentos, pedido);
    // Sem pedido, "todos" inclui os do Panteon; com pedido, só quando é o código dele.
    const casa = (code: string) => !limpo || code === limpo.toUpperCase();
    const dosProprios = proprios.map((p) => maiusculo(p.codigo)).filter(casa);
    // Os autorizados que o catálogo do C2X não conhece: os produtos do Panteon que
    // `codigosDaSessao` já traduziu. Vale também sem `proprios` (ver o topo do arquivo).
    const codesDoC2x = new Set(catalogo.flatMap((emp) => emp.codes.map(maiusculo)));
    const doPanteon = codesAutorizados
      .map(maiusculo)
      .filter((code) => code && !codesDoC2x.has(code))
      .filter(casa);
    return unicos([...doCatalogo, ...dosProprios, ...doPanteon]);
  }

  const autorizados = new Set(codesAutorizados.map(maiusculo).filter(Boolean));
  const ids = expandirIdDoPainel(limpo, cadastro, permitidos);
  const idsPedidos = new Set(ids.map(String));

  // O código do produto do Panteon pelo cadastro, quando a rota não mandou `proprios`: só o id que
  // a expansão já liberou e que o catálogo do C2X não traduz (a mesma régua de `soDoPanteon`).
  const idsNoC2x = new Set(catalogo.flatMap((emp) => emp.stageIds.map((id) => String(id).trim())));
  const doCadastro = cadastro
    .filter(
      (linha) =>
        linha.c2xEnterpriseId !== null &&
        idsPedidos.has(linha.c2xEnterpriseId) &&
        !idsNoC2x.has(linha.c2xEnterpriseId),
    )
    .map((linha) => linha.codigo);

  // ⚠️ O `.filter(autorizados)` continua valendo para os três: a expansão já cruzou com o escopo
  // da sessão, e o código ainda precisa estar entre os autorizados. Fail-closed nas duas camadas.
  return unicos([
    ...codigosDosIdsDoC2x(catalogo, ids),
    ...proprios.filter((p) => idsPedidos.has(p.enterpriseId)).map((p) => p.codigo),
    ...doCadastro,
  ]).filter((code) => autorizados.has(code));
}

/**
 * A casca que as rotas chamam: carrega o cadastro (só quando o pedido é pai) e a sessão
 * expandida, e devolve os códigos — ou a resposta pronta (503) quando o cadastro não veio.
 *
 * Lista vazia NÃO vira resposta aqui de propósito: cada rota decide o 404 (`foraDoEscopo`) no
 * mesmo ponto em que sempre decidiu, para o comportamento visível não mudar de rota para rota.
 */
export async function codigosDoPedido(entrada: {
  catalogo: EmpreendimentoDoCatalogo[];
  codesAutorizados: string[];
  empreendimentos: EmpreendimentoDoPortal[];
  pedido: null | string | undefined;
  /** Ver o campo homônimo em `resolverCodigosDoPedido`. */
  proprios?: { codigo: string; enterpriseId: string }[];
  sessao: SessaoIncorporador;
}): Promise<CodigosDoPedido> {
  const { catalogo, codesAutorizados, empreendimentos, pedido, sessao } = entrada;
  const proprios = entrada.proprios ?? [];
  const limpo = String(pedido ?? "").trim();

  if (!pedidoPrecisaDeExpansao(limpo)) {
    return {
      codes: resolverCodigosDoPedido({
        cadastro: [],
        catalogo,
        codesAutorizados,
        empreendimentos,
        pedido,
        permitidos: new Set(),
        proprios,
      }),
      ok: true,
    };
  }

  const permitidos = new Set(await idsDaSessao(sessao));

  // O cadastro entra em dois casos: o pedido é PAI (sempre precisou), ou é o id numérico de um
  // produto que o catálogo do C2X não traduz e a rota não mandou `proprios` (quem manda já leu o
  // cadastro e responde pela própria queda). Id que a sessão não tem não lê nada: vira 404.
  const precisaDoCadastro = ehIdDoPai(limpo)
    ? true
    : entrada.proprios === undefined &&
      pedidoPrecisaDoCadastro({ catalogo, pedido: limpo, permitidos });

  let cadastro: LinhaDoCadastro[] = [];

  if (precisaDoCadastro) {
    try {
      cadastro = await carregarCadastroDeEmpreendimentos();
    } catch {
      // Sem cadastro não dá para provar nem o pai nem o produto do Panteon: 503, e não 404.
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Não foi possível carregar os empreendimentos agora." },
          { status: 503 },
        ),
      };
    }
  }

  return {
    codes: resolverCodigosDoPedido({
      cadastro,
      catalogo,
      codesAutorizados,
      empreendimentos,
      pedido: limpo,
      permitidos,
      proprios,
    }),
    ok: true,
  };
}
