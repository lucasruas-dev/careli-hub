// SÓ O ESPELHO — o masterplan sem a casca dele.
//
// Lucas (03/09/2026), vendo o masterplan embutido na tela Venda: *"é para trazer somente o
// espelho, não a tela toda"*. E ele está certo: a tela do masterplan (o A-INTERNO) tem barra de
// busca, filtros, painel de indicadores à esquerda e painel de unidade à direita — tudo isso a
// tela Venda já tem, do lado de fora do quadro. Embutida inteira, ela dava dois painéis de unidade,
// duas legendas e duas buscas na mesma tela.
//
// ⚠️ O ARQUIVO NÃO É REESCRITO. A tela aprovada continua sendo entregue byte a byte; o que entra é
// um `<style>` no fim, escondendo a casca e refazendo o grid para o desenho ocupar tudo. Assim o
// mesmo arquivo serve os dois usos, e a tela cheia do Apolo não muda em nada.
//
// ⚠️ E O SCRIPT DA TELA CONTINUA VIVO. Esconder com `display:none` (e não remover do HTML) é de
// propósito: o JS do masterplan procura os elementos da casca ao iniciar (`document.getElementById`
// em campos de filtro, chips de legenda, painel de unidade) e quebraria com eles ausentes — e um
// script quebrado leva o clique no lote embora, que é o que importa aqui.

/** O que é casca no A-INTERNO: barra de cima, rail, painel esquerdo, painel direito e rodapé. */
const CASCA = [".topo", ".rail", ".macro", ".unidade", ".rodape"];

const ESTILO = `
<style id="so-espelho">
  /* O grid do body tem 4 colunas (rail, macro, cena, unidade) e 3 linhas (topo, corpo, rodapé).
     Sem a casca, sobra uma célula só — e a cena precisa ser dona dela. */
  body {
    grid-template-columns: minmax(0, 1fr) !important;
    grid-template-rows: minmax(0, 1fr) !important;
  }
  ${CASCA.join(", ")} { display: none !important; }
  .cena { grid-column: 1 !important; grid-row: 1 !important; }
</style>`;

/**
 * Devolve o HTML mostrando apenas o desenho do loteamento.
 *
 * Injeta antes de `</body>` para vencer o CSS do arquivo por ordem de cascata, sem depender de
 * especificidade — e o `!important` cobre o resto. Sem `</body>` (arquivo estranho), acrescenta no
 * fim: pior caso é o estilo valer igual.
 */
export function soOEspelho(html: string): string {
  const fim = html.lastIndexOf("</body>");
  return fim === -1 ? html + ESTILO : html.slice(0, fim) + ESTILO + html.slice(fim);
}

/** O pedido veio pedindo só o espelho? */
export function pediuSoOEspelho(valor: null | string | undefined): boolean {
  return String(valor ?? "").trim().toLowerCase() === "espelho";
}
