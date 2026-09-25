import { NextResponse } from "next/server";

import type { EmpreendimentoDoCatalogo } from "@/lib/apolo/catalogo-empreendimentos";
import { carregarCadastroDeEmpreendimentos, type LinhaDoCadastro } from "@/lib/hercules/cadastro";

import { idsDaSessao, linhasSoDoPanteon } from "./escopo";
import type { SessaoIncorporador } from "./sessao";

// O EMPREENDIMENTO QUE SÓ EXISTE NO PANTEON, NAS ROTAS DA FICHA DO PRODUTO.
//
// ⚠️ POR QUE ISTO EXISTE. O escopo do portal vira CÓDIGO pelo catálogo do C2X (`codigosDaSessao` →
// `catalogoDeEmpreendimentos`, um select em `enterprises` do legado). Empreendimento que nasceu no
// Panteon (o ZZ TESTE, id 9001, e todo produto cadastrado aqui antes de subir para o legado) não
// vira código, e a rota responde "Nao encontrado." para um produto que É da sessão. A rota /venda
// já tinha o conserto (`soDoPanteon`, app/api/incorporador/venda/route.ts); as da ficha
// (produto/resumo, unidades, links, imobiliarias, cadastro) e vendas/assinaturas não tinham, e a
// ficha aberta pelo painel mostrava a aba Resumo e dava 404 nas outras.
//
// A FORMA É A MESMA DA /venda, de propósito: o catálogo diz quem existe no C2X, `soDoPanteon`
// devolve o que a sessão JÁ traz e o legado não conhece, e os códigos desses entram na lista de
// autorizados E vão como `proprios` para `resolverCodigosDoPedido` — que é quem sabe traduzir o
// `emp` nos dois caminhos (pai do cadastro e id numérico). É TRADUÇÃO, NÃO PERMISSÃO: nada sai
// daqui que a sessão não tenha.
//
// ⚠️ A ÚNICA DIFERENÇA PARA A /venda É A QUEDA DO CADASTRO. Lá a leitura não tem guarda (uma falha
// do Supabase vira 500). Aqui ela DEGRADA para "sem próprios", e o motivo está escrito em
// codigos-do-pedido.ts: *"O id numérico NÃO carrega o cadastro (não precisa dele), então um pico
// do Supabase não derruba o filho"*. Carregar o cadastro sempre, sem guarda, desfaria essa decisão
// nas cinco rotas. Em troca, quem chama tem duas obrigações, e as duas estão nas rotas:
//   • pedido "pai:<uuid>" com cadastro fora do ar → 503 (sem cadastro não dá para provar o pai);
//   • pedido que não sobrou nada com cadastro fora do ar → 503, e não 404 (pode ser um produto
//     do Panteon que só não deu para traduzir; "não é seu" seria afirmação errada).

export type ProprioDoPanteon = { codigo: string; enterpriseId: string };

export type PropriosDoPortal = {
  /** O cadastro do Panteon, já lido. `null` = a leitura falhou (ver as duas obrigações acima). */
  cadastro: LinhaDoCadastro[] | null;
  /** `codesAutorizados` (do catálogo do C2X) mais os códigos dos próprios, sem repetição. */
  codesComProprios: string[];
  /** O escopo expandido da sessão (`idsDaSessao`), devolvido para a rota não ler duas vezes. */
  idsDaSessao: string[];
  proprios: ProprioDoPanteon[];
};

/**
 * O núcleo PURO: o que dá para testar sem banco.
 *
 * ⚠️ A TRAVA DO LAB (revisão de 16/09/2026). Os próprios saem de `linhasSoDoPanteon`, a MESMA régua
 * do escopo, e não de `soDoPanteon` cru: o catálogo do C2X esconde de propósito os empreendimentos de
 * `EXCLUDED_ENTERPRISE_IDS` (2 = SDT, 31 = LAB, o espelho da Lagoa Bonita, 34 = TSC), e `soDoPanteon`
 * lia "não está no catálogo" como "só existe no Panteon". Uma sessão com o 31 ganhava o LAB como
 * produto próprio (código autorizado, unidades lidas duas vezes). A régua do escopo barra a linha
 * cujo ID está nessa lista, e deixa passar o produto nascido no Panteon (>= 100000); tira também
 * linha repetida e linha sem código.
 *
 * ⚠️ A TRAVA É PELO ID, NÃO PELA SIGLA DO CADASTRO (PAN-124, 25/09/2026). Até o PAN-124 ela comparava
 * o `codigo` com `EXCLUDED_ENTERPRISE_CODES`. Hoje uma linha com sigla LAB, TSC ou SDT e um id do C2X
 * FORA de {2, 31, 34} passa; uma com o 31 e qualquer sigla, não.
 */
export function montarPropriosDoPortal(entrada: {
  cadastro: LinhaDoCadastro[] | null;
  catalogo: Pick<EmpreendimentoDoCatalogo, "stageIds">[];
  codesAutorizados: string[];
  idsDaSessao: string[];
}): PropriosDoPortal {
  const { cadastro, catalogo, codesAutorizados } = entrada;
  const proprios = linhasSoDoPanteon({ cadastro, catalogo, permitidos: entrada.idsDaSessao }).map(
    (linha) => ({ codigo: linha.codigo, enterpriseId: linha.c2xEnterpriseId as string }),
  );

  return {
    cadastro,
    codesComProprios: [...new Set([...codesAutorizados, ...proprios.map((p) => p.codigo)])],
    idsDaSessao: entrada.idsDaSessao,
    proprios,
  };
}

/**
 * Os ids (do C2X, como o cadastro guarda) dos próprios cujo código está no recorte.
 *
 * É o que as tabelas do Apolo (esteira, vínculos) precisam no caminho do id do CATÁLOGO, onde a
 * rota monta os ids por `idsDaSessao(sessao, pedido)`: aquele filtro compara o pedido com os ids
 * da sessão, e um pedido pelo CÓDIGO do produto do Panteon ("TST") não casa com nenhum. Os
 * `codes` já passaram pelo escopo, então isto não amplia nada.
 */
export function idsDosProprios(proprios: ProprioDoPanteon[], codes: string[]): string[] {
  const doRecorte = new Set(codes.map((code) => String(code).trim().toUpperCase()));
  return proprios
    .filter((p) => doRecorte.has(p.codigo.toUpperCase()))
    .map((p) => p.enterpriseId);
}

/**
 * Os produtos do recorte cujo ESTOQUE é lido do Panteon (`hercules_unidades`) nas abas Unidades e
 * Resumo da ficha: os próprios (só existem no Panteon) e os que têm DONO MARCADO.
 *
 * ⚠️ O PRODUTO COM DONO SAI DO C2X (D2 do Lucas, 16/09/2026). O Garden da Cecílio veio do C2X, mas
 * passou a ter preço, área e matrícula corrigidos no Panteon, e a carga do C2X e o semeador pulam
 * produto com `operado_por`. Ler a aba Unidades do C2X depois disso mostraria o preço antigo ao
 * lado da correção que a pessoa acabou de gravar: as "duas fontes" que o Lucas vetou em 04/09.
 *
 * ⚠️ É TRADUÇÃO, NÃO PERMISSÃO, E NÃO DEPENDE DE QUEM PEDE. Só entra código que já está em `codes`
 * (recortado pela sessão) e id que a sessão traz; a Gurgel olhando o Garden lê do mesmo lugar que a
 * Cecílio, porque a verdade do estoque é uma só. Sem a 0170 (`operadoPor` sai nulo em toda linha) e
 * com o cadastro fora do ar (`null`), sobra só o que já era próprio: a leitura cai no C2X como antes.
 */
export function lidosDoPanteon(entrada: {
  cadastro: LinhaDoCadastro[] | null;
  codes: string[];
  idsDaSessao: string[];
  proprios: ProprioDoPanteon[];
}): ProprioDoPanteon[] {
  const doRecorte = new Set(entrada.codes.map((code) => String(code).trim().toUpperCase()));
  const daSessao = new Set(entrada.idsDaSessao.map((id) => String(id).trim()));

  const saida = new Map<string, ProprioDoPanteon>();
  for (const proprio of entrada.proprios) {
    if (doRecorte.has(proprio.codigo.trim().toUpperCase())) saida.set(proprio.enterpriseId, proprio);
  }
  for (const linha of entrada.cadastro ?? []) {
    const id = String(linha.c2xEnterpriseId ?? "").trim();
    const codigo = String(linha.codigo ?? "").trim();
    if (!id || !codigo || saida.has(id)) continue;
    if (!String(linha.operadoPor ?? "").trim()) continue;
    if (!daSessao.has(id) || !doRecorte.has(codigo.toUpperCase())) continue;
    saida.set(id, { codigo, enterpriseId: id });
  }
  return [...saida.values()];
}

/** A casca que as rotas chamam: lê o cadastro (com a guarda) e o escopo expandido. */
export async function propriosDoPortal(entrada: {
  catalogo: EmpreendimentoDoCatalogo[];
  codesAutorizados: string[];
  sessao: SessaoIncorporador;
}): Promise<PropriosDoPortal> {
  let cadastro: LinhaDoCadastro[] | null = null;

  try {
    cadastro = await carregarCadastroDeEmpreendimentos();
  } catch (erro) {
    console.error("[incorporador] cadastro de empreendimentos indisponível", erro);
  }

  return montarPropriosDoPortal({
    cadastro,
    catalogo: entrada.catalogo,
    codesAutorizados: entrada.codesAutorizados,
    idsDaSessao: await idsDaSessao(entrada.sessao),
  });
}

/** O 503 de "não deu para ler os empreendimentos", com o texto que as rotas irmãs já usam. */
export function empreendimentosIndisponiveis(): NextResponse {
  return NextResponse.json(
    { error: "Não foi possível carregar os empreendimentos agora." },
    { status: 503 },
  );
}
