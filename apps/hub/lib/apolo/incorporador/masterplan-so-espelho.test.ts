import { describe, expect, it } from "vitest";

import { pediuSoOEspelho, soOEspelho } from "./masterplan-so-espelho";

const TELA = `<!doctype html><html><head><style>body{display:grid}</style></head>
<body>
<nav class="rail"></nav>
<header class="topo"><input id="busca"></header>
<aside class="macro">indicadores</aside>
<main class="cena" id="cena"><svg></svg></main>
<aside class="unidade">painel</aside>
<footer class="rodape">dicas</footer>
<script>document.getElementById("busca").value = "";</script>
</body></html>`;

describe("soOEspelho", () => {
  it("esconde a casca e devolve o grid para o desenho", () => {
    const html = soOEspelho(TELA);

    expect(html).toContain('id="so-espelho"');
    for (const casca of [".topo", ".rail", ".macro", ".unidade", ".rodape"]) {
      expect(html).toContain(casca);
    }
    expect(html).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\) !important/);
    expect(html).toMatch(/\.cena\s*\{[^}]*grid-column:\s*1 !important/);
  });

  it("⚠️ ESCONDE, não remove: o script da tela procura os elementos da casca", () => {
    // O JS do A-INTERNO faz getElementById em campos de filtro e no painel de unidade ao iniciar.
    // Arrancar os elementos quebraria o script — e com ele o clique no lote, que é justamente o
    // que o quadro embutido existe para dar.
    const html = soOEspelho(TELA);

    expect(html).toContain('class="topo"');
    expect(html).toContain('id="busca"');
    expect(html).toContain('class="unidade"');
    expect(html).toContain("display: none !important");
  });

  it("entra ANTES do fecha-body, para vencer o CSS do arquivo na cascata", () => {
    const html = soOEspelho(TELA);
    expect(html.indexOf('id="so-espelho"')).toBeLessThan(html.indexOf("</body>"));
    // E o desenho continua lá: nada do conteúdo original se perdeu.
    expect(html).toContain('<main class="cena" id="cena"><svg></svg></main>');
  });

  it("sem fecha-body, acrescenta no fim em vez de perder o estilo", () => {
    const html = soOEspelho("<div class='cena'></div>");
    expect(html).toContain('id="so-espelho"');
    expect(html).toContain("class='cena'");
  });

  it("o pedido só vale escrito por extenso", () => {
    expect(pediuSoOEspelho("espelho")).toBe(true);
    expect(pediuSoOEspelho(" ESPELHO ")).toBe(true);
    // Qualquer outra coisa entrega a tela inteira, que é o comportamento de sempre.
    expect(pediuSoOEspelho("1")).toBe(false);
    expect(pediuSoOEspelho("mapa")).toBe(false);
    expect(pediuSoOEspelho(null)).toBe(false);
    expect(pediuSoOEspelho(undefined)).toBe(false);
  });
});
