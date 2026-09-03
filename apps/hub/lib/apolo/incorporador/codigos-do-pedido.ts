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

export type CodigosDoPedido = { codes: string[]; ok: true } | { ok: false; response: NextResponse };

const SO_DIGITOS = /^\d+$/;

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
}): string[] {
  const { cadastro, catalogo, codesAutorizados, empreendimentos, pedido, permitidos } = entrada;
  const limpo = String(pedido ?? "").trim();

  if (!pedidoPrecisaDeExpansao(limpo)) {
    return codesDoRecorte(empreendimentos, pedido);
  }

  const autorizados = new Set(
    codesAutorizados.map((code) => String(code ?? "").trim().toUpperCase()).filter(Boolean),
  );
  const ids = expandirIdDoPainel(limpo, cadastro, permitidos);

  return codigosDosIdsDoC2x(catalogo, ids).filter((code) => autorizados.has(code));
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
  sessao: SessaoIncorporador;
}): Promise<CodigosDoPedido> {
  const { catalogo, codesAutorizados, empreendimentos, pedido, sessao } = entrada;
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
      }),
      ok: true,
    };
  }

  let cadastro: LinhaDoCadastro[] = [];

  if (ehIdDoPai(limpo)) {
    try {
      cadastro = await carregarCadastroDeEmpreendimentos();
    } catch {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Não foi possível carregar os empreendimentos agora." },
          { status: 503 },
        ),
      };
    }
  }

  const permitidos = new Set(await idsDaSessao(sessao));

  return {
    codes: resolverCodigosDoPedido({
      cadastro,
      catalogo,
      codesAutorizados,
      empreendimentos,
      pedido: limpo,
      permitidos,
    }),
    ok: true,
  };
}
