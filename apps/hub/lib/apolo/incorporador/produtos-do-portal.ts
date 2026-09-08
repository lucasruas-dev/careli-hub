// OS PRODUTOS QUE O SELETOR DO PORTAL MOSTRA — pai e recortes, derivados do CADASTRO do Panteon.
//
// Lucas (08/09/2026), olhando /comercial/gurgel > Financeiro > Parcelas: *"ainda continua
// aparecendo 4 vale do ouro. por favor revisa isso, não pode ter esses, o conceito de pai e filho
// tem que ficar muito bem definido"*. E o modelo, dele mesmo: *"o pai é que organiza tudo, os
// filhos vêm do pai. o filho é um recorte do pai"*.
//
// ⚠️ A LISTA FIXA EM CÓDIGO É QUE DUPLICAVA O VALE DO OURO. O seletor do Financeiro montava os
// chips com `empreendimentosDoPortal(catalogo, …)`, e o catálogo agrupa por `ENTERPRISE_GROUPS`
// (lib/guardian/c2x-analytics.ts). No C2X os QUATRO registros do Vale do Ouro têm o `name`
// EXATAMENTE igual — a string "VALE DO OURO" (medido em 08/09/2026: 35 VLO, 36 VOL, 37 VOC,
// 41 VOR) —, então fora da lista cada um virava um chip com o mesmo rótulo. O commit 7cf0b6e3 pôs
// VOC+VOL+VOR na lista e a tela caiu de quatro chips para DOIS iguais: o VLO (35) continuou linha
// própria com o nome idêntico. E o segundo abria vazio — medido no mesmo dia, o VLO tem ZERO
// parcelas em carteira ativa (VOC 13.242 · VOL 13.150 · VOR 104 · VLO 0).
//
// ⚠️ O ESPELHO NÃO SOME DO CADASTRO, e não pode sumir: o VLO é a casa do masterplan do Vale do
// Ouro, das CADs da esteira (`apolo_esteira` é 100% enterprise_id 35) e do painel do coordenador.
// O que ele não pode é aparecer como um SEGUNDO chip com o mesmo nome. A regra é a mesma de
// `alcanceDoPai`, que o painel de Produtos já usa: pai com filho autorizado É os filhos, e o
// espelho fica CONSUMIDO (nem soma, nem sobra para a lista residual).
//
// POR QUE ESTE ARQUIVO EXISTE AO LADO DE `painel-de-produtos.ts`. Os dois derivam a MESMA árvore
// do MESMO cadastro, pelas MESMAS primitivas (`filhosDoCadastro` + `alcanceDoPai` +
// `idDoPainelDoPai`) — a diferença é o que cada um precisa carregar:
//   • `montarPainelDeProdutos` monta os seis cards da aba Produtos, e para isso precisa dos
//     NÚMEROS: `loadApoloEnterprises()` (a leitura cara do C2X, com dez agregações sobre todas as
//     unidades) mais duas leituras paginadas do Panteon (5.528 unidades + 4.857 propostas);
//   • aqui o seletor precisa de NOME e ID, e nada mais. Pendurar aquelas três leituras numa rota
//     que já paga `loadApoloEnterpriseCarteira` seria triplicar o custo do Financeiro para
//     escrever um rótulo em cima de um chip.
//
// ⚠️ ESTE ARQUIVO NÃO AUTORIZA NADA (a mesma regra de `empreendimentos-do-portal.ts`). Ele recebe
// `permitidos` (o que `idsDaSessao` já expandiu) e `codesAutorizados` (o que `codigosDaSessao` já
// liberou), e só consegue REDUZIR os dois. A assimetria do escopo é preservada por construção,
// porque quem decide o que o pai alcança é `alcanceDoPai`: sessão que só tem a divisão 37 (VOC)
// recebe o produto "Vale do Ouro" com UM recorte e o código VOC — nunca o grupo inteiro.
import type { EmpreendimentoDoCatalogo } from "@/lib/apolo/catalogo-empreendimentos";
import type { LinhaDoCadastro } from "@/lib/hercules/cadastro";
import {
  alcanceDoPai,
  codigosDosIdsDoC2x,
  filhosDoCadastro,
  idDoPainelDoPai,
} from "@/lib/hercules/expandir-id-do-painel";

import type { EmpreendimentoDoPortal } from "./empreendimentos-do-portal";

/** Um recorte (filho) dentro do produto: o VOC do Cecílio dentro do Vale do Ouro. */
export type RecorteDoProduto = {
  /** Os códigos do C2X deste recorte, dentro do que a sessão autoriza. */
  codes: string[];
  codigo: string;
  /**
   * O id REAL do C2X do filho. É o que o subfiltro manda de volta na URL, e `codigosDoPedido` já
   * entende id numérico solto — o mesmo caminho que a tela Venda usa.
   */
  id: string;
  nome: string;
};

export type ProdutoDoPortal = {
  /** Os códigos do C2X que este produto alcança NESTA sessão. Nunca vazio (ver a regra abaixo). */
  codes: string[];
  /** Os recortes autorizados. Vazio no pai sem filho e na linha que o cadastro não conhece. */
  filhos: RecorteDoProduto[];
  /** "pai:<uuid>" para o pai do cadastro; o id do catálogo do C2X para a linha residual. */
  id: string;
  nome: string;
};

const maiusculo = (code: unknown): string => String(code ?? "").trim().toUpperCase();

/**
 * Os produtos do seletor: um por PAI do cadastro que a sessão alcança, com os recortes dentro.
 *
 * ⚠️ PRODUTO QUE NÃO RESOLVE EM CÓDIGO NENHUM NÃO VIRA CHIP. A leitura da carteira é por CÓDIGO
 * do C2X, e o cadastro do Panteon tem empreendimento que o legado não conhece — medido em
 * 08/09/2026: o "ZZ TESTE" (c2x_enterprise_id 9001) não existe entre os 37 registros de
 * `enterprises`. Sem esta regra ele viraria um chip que abre vazio, que é exatamente a queixa do
 * Lucas sobre o segundo "Vale do Ouro".
 *
 * @param cadastro          `hercules_empreendimentos` inteiro (pais e filhos). Vazio = degrada
 *                          para a lista do catálogo, que é a tela de antes.
 * @param catalogo          O catálogo do C2X, para traduzir id → código.
 * @param codesAutorizados  O que `codigosDaSessao` liberou. Fail-closed: nada sai daqui sem estar
 *                          nesta lista.
 * @param doCatalogo        `empreendimentosDoPortal(catalogo, codesAutorizados)` — a lista antiga,
 *                          que vira o RESIDUAL (o que o cadastro do Panteon ainda não conhece).
 * @param permitidos        Os ids que `idsDaSessao` já expandiu.
 */
export function produtosDoPortal(entrada: {
  cadastro: LinhaDoCadastro[];
  catalogo: EmpreendimentoDoCatalogo[];
  codesAutorizados: string[];
  doCatalogo: EmpreendimentoDoPortal[];
  permitidos: Set<string>;
}): ProdutoDoPortal[] {
  const { cadastro, catalogo, codesAutorizados, doCatalogo, permitidos } = entrada;

  const autorizados = new Set(codesAutorizados.map(maiusculo).filter(Boolean));
  const codesDoId = (c2xIds: string[]): string[] =>
    codigosDosIdsDoC2x(catalogo, c2xIds).filter((code) => autorizados.has(maiusculo(code)));

  const filhosDe = filhosDoCadastro(cadastro);
  /** Ids do C2X que já responderam por algum produto: não podem voltar como linha residual. */
  const consumidos = new Set<string>();
  const produtos: ProdutoDoPortal[] = [];

  for (const pai of cadastro) {
    if (pai.paiId !== null) continue;

    const alcance = alcanceDoPai(pai, filhosDe.get(pai.id) ?? [], permitidos);

    if (alcance.filhos.length > 0) {
      const filhos: RecorteDoProduto[] = alcance.filhos
        .filter(
          (filho): filho is LinhaDoCadastro & { c2xEnterpriseId: string } =>
            filho.c2xEnterpriseId !== null,
        )
        .map((filho) => ({
          codes: codesDoId([filho.c2xEnterpriseId]),
          codigo: filho.codigo,
          id: filho.c2xEnterpriseId,
          nome: filho.nome,
        }))
        // Recorte sem código no C2X abriria vazio, igual ao pai: fora do subfiltro.
        .filter((filho) => filho.codes.length > 0);

      // ⚠️ CONSUMIR ACONTECE ANTES DE DESISTIR DO CHIP. Mesmo que o pai não resolva em código
      // nenhum, os ids que ele reclamou não podem reaparecer soltos na lista residual: seriam a
      // segunda linha com o mesmo nome que este arquivo existe para impedir.
      for (const filho of alcance.filhos) {
        if (filho.c2xEnterpriseId) consumidos.add(filho.c2xEnterpriseId);
      }
      // ⚠️ O ESPELHO SAI DA LISTA, NÃO DO CADASTRO. É esta linha que apaga o segundo chip "Vale
      // do Ouro": o VLO (35) continua existindo em `hercules_empreendimentos`, no masterplan e na
      // esteira — só não aparece ao lado dos próprios filhos.
      if (pai.c2xEnterpriseId) consumidos.add(pai.c2xEnterpriseId);

      const codes = [...new Set(filhos.flatMap((filho) => filho.codes))];
      if (codes.length === 0) continue;

      produtos.push({ codes, filhos, id: idDoPainelDoPai(pai.id), nome: pai.nome });
      continue;
    }

    if (alcance.espelho) {
      consumidos.add(alcance.espelho);

      // Pai sem filho autorizado responde pelo próprio registro: o Garden, e também a sessão
      // antiga que carrega o 35 e nenhuma divisão — aí o espelho é o único número que ela tem
      // direito de ver.
      const codes = codesDoId([alcance.espelho]);
      if (codes.length === 0) continue;

      produtos.push({ codes, filhos: [], id: idDoPainelDoPai(pai.id), nome: pai.nome });
    }
  }

  // O que a sessão alcança e o cadastro do Panteon ainda não conhece: a linha do catálogo, como
  // sempre foi. Some quando TODOS os códigos dela já responderam por um produto — é assim que o
  // "group:Vale do Ouro" e o "35" saem de cena depois que o pai do cadastro assumiu os dois.
  const codesConsumidos = new Set(codesDoId([...consumidos]).map(maiusculo));

  for (const emp of doCatalogo) {
    const codes = emp.codes.map(maiusculo).filter((code) => !codesConsumidos.has(code));
    if (codes.length === 0) continue;

    produtos.push({ codes, filhos: [], id: emp.id, nome: emp.nome });
  }

  // Ordem alfabética, a MESMA de `empreendimentosDoPortal`: assim a única mudança visível na
  // fileira de chips é o Vale do Ouro deixar de aparecer duas vezes — nada mais muda de lugar.
  return produtos.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}
