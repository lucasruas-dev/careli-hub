// AS TELAS DE TV — a lista curta do que pode ficar num telão de stand, e o que sai nele.
//
// Lucas (22/09/2026): *"preciso criar um espelho do garden para ficar fixo em uma tv, então precisa
// ser assim, em tela cheia mostrando o que está liberado e o que não está com as marcas (...) só que
// não teria os dados de disponivel, nem a parte de unidades, seria somente uma visão para ficar na
// televisão. de preferencia, criar um link curto pois vou ter que digitar na tv"*.
//
// ⚠️ ESTE LINK NÃO TEM SELO, E FOI ESCOLHA MEDIDA. O espelho público mora em
// `/e/garden-<selo8>`, e os 8 caracteres de assinatura existem para ninguém varrer `/e/<nome>` e
// montar o catálogo da casa ([[link-do-espelho.ts]]). Numa TV o selo é justamente o pedaço ruim:
// ele vai ser DIGITADO no teclado virtual do controle remoto, letra por letra, com as setas — e
// cada caractere aleatório é um erro a mais no meio do stand. Aqui a varredura é barrada de outro
// jeito: **esta lista é escrita à mão**. A rota não resolve nome de empreendimento, não consulta o
// cadastro para descobrir slug e não devolve "o primeiro que casar": `/tv/<qualquer outra coisa>`
// é 404, inclusive para empreendimento que existe. Quem quiser uma segunda TV escreve a linha.
//
// ⚠️ E O QUE A TV MOSTRA É ESTRITAMENTE MENOS DO QUE JÁ ESTÁ PÚBLICO. `c2x.app.br/garden/
// masterplan.html` está no ar hoje, sem login, com o mapa inteiro E o preço de tabela de 405
// lotes. A TV mostra duas cores. Sem isso o argumento do link sem selo não se sustentaria.
//
// O QUE QUEBRA SEM ESTE ARQUIVO: ou a rota da TV teria de resolver o slug consultando
// `hercules_empreendimentos.nome` (e aí `/tv/<nome>` vira oráculo do que a Careli vende, sem selo
// nenhum barrando), ou o link voltaria a carregar os 8 caracteres aleatórios que o Lucas precisa
// digitar no controle remoto.

import type { EstadoDoEspelho } from "./estado-do-espelho";
import type { SituacaoPublica } from "./situacao-publica";

/** Uma marca da moldura: o arquivo em `/public` e o texto alternativo. */
export type MarcaDaTv = { alt: string; src: string };

export type TelaDeTv = {
  /** O código do empreendimento PAI, dono do masterplan. É ele que vira token do espelho. */
  codigo: string;
  /**
   * As marcas da coluna da esquerda, portadas do masterplan aprovado
   * (`public/garden/masterplan.html`, a moldura de `.m-topo` a `.m-rodape`).
   *
   * ⚠️ MORAM AQUI, E NÃO NO COMPONENTE, porque são do EMPREENDIMENTO. Chumbadas na tela, a
   * segunda TV nasceria com o logo do Garden em cima do mapa de outro loteamento.
   */
  marcas: {
    /** A marca do empreendimento, no meio da coluna. É a única obrigatória. */
    empreendimento: MarcaDaTv;
    /** Quem vende, no rodapé. */
    rodape: MarcaDaTv | null;
    /** A construtora, no topo. */
    topo: MarcaDaTv | null;
  };
  /** O que se digita na TV: `c2x.app.br/tv/<slug>`. Só minúsculas, dígitos e hífen. */
  slug: string;
};

/**
 * AS TELAS LIBERADAS PARA TV. Uma linha por telão.
 *
 * ⚠️ ACRESCENTAR UMA LINHA AQUI PUBLICA UM MAPA SEM LOGIN. Antes de escrever a próxima, a
 * pergunta é a mesma do espelho: as duas cores deste loteamento podem ficar numa tela que
 * qualquer um abre digitando 20 caracteres?
 */
export const TELAS_DE_TV: readonly TelaDeTv[] = [
  {
    codigo: "GDN",
    marcas: {
      // ⚠️ CÓPIA EM `/marcas`, E NÃO `/garden/logo-garden.png`. A pasta `public/garden` guarda a
      // tela aprovada e o `interno-<hash>.html` que já está marcado para sair (página sem login
      // com nome e preço juntos). Apontar a TV para lá amarraria o telão do stand a uma pasta que
      // alguém vai apagar — e o defeito apareceria como logo quebrado, no stand, sem aviso.
      empreendimento: { alt: "Garden Resort Residence", src: "/marcas/garden.png" },
      rodape: { alt: "MMendes Empreendimentos", src: "/marcas/mmendes.svg" },
      topo: { alt: "Cecílio Rocha Construtora", src: "/marcas/cecilio-rocha.svg" },
    },
    slug: "garden",
  },
] as const;

/**
 * O slug como a TV o entrega.
 *
 * ⚠️ MINÚSCULA E SEM AS BORDAS. O teclado virtual da televisão começa MAIÚSCULO, e quem digita
 * "Garden" no controle remoto não está errado — mas cairia em 404 e ligaria para o suporte no meio
 * do stand. A barra também sai, para `/garden` colado da barra de endereço resolver igual.
 */
function normalizar(slug: null | string | undefined): string {
  return String(slug ?? "").trim().replace(/^\/+|\/+$/g, "").toLowerCase();
}

/** A tela daquele slug, ou `null`. `null` é 404 — nunca um padrão, nunca a primeira da lista. */
export function telaDeTv(slug: null | string | undefined): null | TelaDeTv {
  const limpo = normalizar(slug);
  if (!limpo) return null;
  return TELAS_DE_TV.find((t) => t.slug === limpo) ?? null;
}

/** Só o código do empreendimento daquele slug. */
export function codigoDaTelaDeTv(slug: null | string | undefined): null | string {
  return telaDeTv(slug)?.codigo ?? null;
}

/** Um lote na TV: onde ele está no desenho, e de que cor. Nada mais. */
export type LoteNaTv = {
  /** O `inkscape:label` do contorno — o código da unidade do PAI. */
  codigo: string;
  situacao: SituacaoPublica;
};

export type EstadoDaTv = {
  /** ISO da leitura. A tela mostra a hora, discreta: é como se percebe um mapa congelado. */
  atualizadoEm: string;
  lotes: LoteNaTv[];
};

/**
 * O estado do espelho reduzido ao que a TV pode carregar.
 *
 * ⚠️ OBJETO NOVO, COM DOIS CAMPOS NOMEADOS — nunca `{ ...lote }` e nunca `delete`. O que sai daqui
 * viaja num link SEM SELO, que qualquer um abre digitando 20 caracteres; então o que trafega nele é
 * o que qualquer um lê. `estadoDoEspelho` devolve preço de tabela, área, rótulo, quadra e lote de
 * cada unidade, e um espalhamento publicaria os 404 de uma vez. É a lição do Garden, onde uma
 * página interna sem senha mostrou nome e preço juntos — e é o pedido literal do Lucas: *"não teria
 * os dados de disponivel, nem a parte de unidades"*.
 *
 * ⚠️ E A CONTAGEM TAMBÉM FICA DE FORA. Ela é barata de calcular na tela, mas *"não teria os dados
 * de disponivel"* é exatamente sobre ela: quantos lotes sobraram é informação comercial, e num
 * telão de stand ela responde a pergunta que o corretor prefere responder pessoalmente.
 *
 * ⚠️ A COR NÃO É DECIDIDA AQUI. `situacao` já vem de `situacaoPublicaDoLote`, que traduz a régua
 * única (`../situacao-da-unidade.ts`). Se a cor sair errada na TV, o defeito é lá.
 */
export function estadoParaTv(estado: EstadoDoEspelho): EstadoDaTv {
  return {
    atualizadoEm: estado.atualizadoEm,
    lotes: estado.lotes.map((lote) => ({ codigo: lote.codigo, situacao: lote.situacao })),
  };
}
