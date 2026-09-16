// OS CARDS DE PRODUTO QUE SÓ EXISTEM NO PANTEON (rota /api/incorporador/produtos).
//
// ⚠️ POR QUE ISTO EXISTE. A rota de cards montava a lista 100% pelo C2X (`loadApoloEnterprises`,
// recortado pelos ids da sessão). Produto nascido no Panteon (id a partir de 100000; decisão do
// Lucas em 16/09/2026: mesmo banco, mesmas tabelas, cada produto marca quem opera) não está em
// `enterprises` do legado e simplesmente não tinha card — nem na TelaProdutos do incorporador, nem
// na lista de masterplans que a TelaVenda cruza com o painel. No portal da Cecílio, que vai
// cadastrar os prédios (Ed. Jade, Ed. Rubi, On Sky…) direto aqui, isso seria a aba vazia.
//
// A MOLDURA SAI DO CADASTRO (nome, cidade, UF) e o NÚMERO sai de `hercules_unidades` (a mesma régua
// do painel, `estoquePorEmpreendimento`). Os cards do C2X seguem como eram: `estoque` nulo neles,
// porque contar o legado inteiro aqui triplicaria o custo de uma tela que só abre masterplan.
//
// ⚠️ NÃO AUTORIZA NADA. Quem decide que linha entra é `linhasSoDoPanteon` (escopo.ts): só id que a
// sessão JÁ traz, e só o que o C2X não traduz. Função pura: a rota lê as fontes e chama daqui.
import type { EmpreendimentoDoCatalogo } from "@/lib/apolo/catalogo-empreendimentos";
import type { LinhaDoCadastro } from "@/lib/hercules/cadastro";
import { ehIdDoPanteon, tipoProdutoDe, type TipoProduto } from "@/lib/hercules/produto-novo";

import { masterplanInternoDe, nomeApresentavel } from "./empreendimentos-do-portal";
import { linhasSoDoPanteon } from "./escopo";
import type { Cenario } from "./painel-de-produtos";

export type ProdutoDoIncorporador = {
  carteiraAdministrada: boolean;
  /** Cidade do empreendimento. Nulo quando a fonte não sabe. */
  cidade: null | string;
  code: string;
  /** Ids REAIS que este card representa (mais de um quando o produto tem etapas). */
  enterpriseIds: string[];
  /**
   * O estoque contado no Panteon (`hercules_unidades` + proposta viva). Só vem no card do produto
   * do Panteon; nos do C2X fica nulo (ver o topo do arquivo).
   */
  estoque: Cenario | null;
  id: string;
  logoUrl: string | null;
  /** Endereço do masterplan publicado. Nulo = o card mostra o botão desligado. */
  masterplanUrl: string | null;
  /**
   * Código do C2X cujo masterplan INTERNO (a tela A-INTERNO) abre dentro da aba Produtos. Nulo
   * quando o empreendimento ainda não tem os lotes desenhados, e aí o card cai no `masterplanUrl`.
   */
  masterplanInterno: null | string;
  nome: string;
  /** De onde o card saiu: do legado (`c2x`) ou do cadastro do Panteon (`panteon`). */
  origem: "c2x" | "panteon";
  /**
   * Loteamento ou prédio. Opcional só no tipo (quem monta o card do C2X à mão não quebra); o card do
   * Panteon sempre traz, e quem lê trata ausente como loteamento.
   */
  tipoProduto?: TipoProduto;
  uf: null | string;
};

/**
 * Os cards dos produtos que só o Panteon conhece, dentro da sessão.
 *
 * ⚠️ O PAI QUE TEM FILHO NA LISTA NÃO VIRA SEGUNDO CARD. É a regra do espelho (`alcanceDoPai`):
 * quando os filhos estão autorizados, eles respondem pelo produto, e um card do pai ao lado
 * mostraria o mesmo estoque duas vezes. Pai sozinho (sem filho autorizado) é o card dele mesmo.
 *
 * @param idsNoC2x Quem o C2X conhece (`stageIds` do catálogo, ou os ids reais das linhas de
 *                 `loadApoloEnterprises`). Vazio = C2X fora do ar: o cadastro responde por tudo o
 *                 que a sessão traz (ver `linhasSoDoPanteon`).
 */
export function cardsDoPanteon(entrada: {
  cadastro: LinhaDoCadastro[] | null;
  comCarteira: Set<string>;
  estoque: Map<string, Cenario>;
  idsNoC2x: Array<Pick<EmpreendimentoDoCatalogo, "stageIds">>;
  logos: Record<string, null | string>;
  masterplans: Record<string, string>;
  permitidos: Iterable<string>;
}): ProdutoDoIncorporador[] {
  const linhas = linhasSoDoPanteon({
    cadastro: entrada.cadastro,
    catalogo: entrada.idsNoC2x,
    permitidos: entrada.permitidos,
  });

  const paisComFilhoNaLista = new Set(
    linhas.map((linha) => linha.paiId).filter((paiId): paiId is string => paiId !== null),
  );

  return linhas
    .filter((linha) => !paisComFilhoNaLista.has(linha.id))
    .map((linha) => {
      const id = linha.c2xEnterpriseId as string;
      return {
        carteiraAdministrada: entrada.comCarteira.has(id),
        cidade: linha.cidade,
        code: linha.codigo,
        enterpriseIds: [id],
        estoque: entrada.estoque.get(id) ?? null,
        id,
        logoUrl: entrada.logos[id] ?? null,
        masterplanInterno: masterplanInternoDe([linha.codigo]),
        masterplanUrl: entrada.masterplans[id] ?? null,
        nome: nomeApresentavel(linha.nome),
        origem: "panteon" as const,
        tipoProduto: tipoProdutoDe(linha.tipoProduto),
        uf: linha.uf,
      };
    });
}

/** Junta os cards das duas fontes, sem repetir id, na ordem alfabética que a tela sempre usou. */
export function juntarCards(
  doC2x: ProdutoDoIncorporador[],
  doPanteon: ProdutoDoIncorporador[],
): ProdutoDoIncorporador[] {
  const vistos = new Set(doC2x.map((card) => card.id));
  return [...doC2x, ...doPanteon.filter((card) => !vistos.has(card.id))].sort((a, b) =>
    a.nome.localeCompare(b.nome, "pt-BR"),
  );
}

/**
 * Com o C2X fora do ar, a rota de cards pode responder só com o cadastro do Panteon?
 *
 * ⚠️ SÓ QUANDO A SESSÃO É 100% DO PANTEON (revisão de 16/09/2026). Com o catálogo em cache, os cards
 * do legado não saem e só os do Panteon sairiam, com `avisoDaFonte`; mas nenhuma tela lê o aviso
 * ainda (TelaProdutos, TelaVenda), e o Garden e o Vale do Ouro sumiriam da aba Produtos sem nada
 * dizer. Sessão com qualquer id do legado (inclusive grupo e o ZZ TESTE 9001) volta ao 503 de sempre.
 */
export function cardsSaemSemOC2x(entrada: { linhasDoPanteon: readonly unknown[]; permitidos: Iterable<string> }): boolean {
  const ids = [...entrada.permitidos].map((id) => String(id).trim()).filter(Boolean);
  return entrada.linhasDoPanteon.length > 0 && ids.length > 0 && ids.every((id) => ehIdDoPanteon(id));
}
