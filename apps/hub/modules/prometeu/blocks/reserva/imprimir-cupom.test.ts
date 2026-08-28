import { describe, expect, it } from "vitest";

import { CUPOM_CSS, cupomHTML } from "./imprimir-cupom";

// AS TRÊS REGRAS DO PAPEL TÉRMICO, presas por teste.
//
// Elas nasceram do primeiro cupom impresso de verdade (28/08/2026): o texto em peso normal saiu
// tão apagado que "COMPROVANTE DE RESERVA" imprimiu "PESERVA" — o R não marcou. A térmica não
// tem cinza, e o antialiasing do Chrome entrega cinza; o driver aproxima por pontilhado e o
// traço fino vira uma fileira de furos.
//
// Sem estes testes, o próximo campo que alguém acrescentar ao cupom volta a nascer fino.

const MENOR_TAMANHO_QUE_IMPRIME = 11;

function tamanhosDeFonte(css: string): number[] {
  return [...css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) =>
    Number(m[1]),
  );
}

describe("o CSS do cupom respeita o papel térmico", () => {
  it("o body é negrito — todo o resto herda", () => {
    expect(CUPOM_CSS).toMatch(/body\s*\{[^}]*font-weight:\s*700/s);
  });

  it("nenhuma regra volta para peso normal", () => {
    const pesos = [...CUPOM_CSS.matchAll(/font-weight:\s*([a-z0-9]+)/g)].map(
      (m) => m[1],
    );
    expect(pesos.length).toBeGreaterThan(0);
    for (const peso of pesos) expect(peso).toBe("700");
  });

  it("nada abaixo de 11px", () => {
    const tamanhos = tamanhosDeFonte(CUPOM_CSS);
    expect(tamanhos.length).toBeGreaterThan(0);
    for (const tamanho of tamanhos) {
      expect(tamanho).toBeGreaterThanOrEqual(MENOR_TAMANHO_QUE_IMPRIME);
    }
  });

  it("o Chrome não suaviza a borda das letras", () => {
    expect(CUPOM_CSS).toContain("-webkit-font-smoothing: none");
  });

  it("continua sendo bobina de 80mm, sem margem", () => {
    expect(CUPOM_CSS).toContain("size: 80mm auto");
    expect(CUPOM_CSS).toMatch(/@page\s*\{[^}]*margin:\s*0/);
  });
});

const DADOS = {
  cliente: "MARIA EDUARDA BOTELHO MAGALHAES",
  codigoEvento: "RVP",
  dataHora: "28/08/2026, 19:20",
  evento: "RESIDENCIAL VILLA PARIS · 22/08/2026",
  grupoId: "ca332abc-dbf5-4109-bb41-47f8f81ee63c",
  logoSrc: "https://c2x.app.br/prometeu/c2x-logo.png",
  origem: "F M S MACIEL IMOVEIS · IGOR FERNANDO CLODOMIRO",
  outrosProponentes: [] as { nome: string }[],
  qrDataUrl: "data:image/png;base64,iVBORw0KGgo=",
  unidades: [
    { lote: "06", quadra: "G" },
    { lote: "07", quadra: "G" },
    { lote: "08", quadra: "G" },
  ],
};

describe("o HTML do cupom", () => {
  it("não carrega tamanho de fonte solto no atributo style", () => {
    const html = cupomHTML({
      ...DADOS,
      outrosProponentes: [{ nome: "JOAO DA SILVA" }],
    });
    // O proponente extra já teve `style="font-size:10px"` embutido, que escapava das regras
    // acima justamente por não estar no CSS.
    expect(html).not.toMatch(/style="[^"]*font-size/);
    expect(html).toContain('class="cup-prop"');
  });

  it("fala QUADRA e LOTE, do jeito que o operador confere", () => {
    const html = cupomHTML(DADOS);
    expect(html).toContain("QUADRA G · LOTE 06");
    expect(html).toContain("QUADRA G · LOTE 08");
  });

  // Lucas, 28/08: "pode tirar os 50%, isso só vai na PA". A divisão entre proponentes é
  // cláusula da proposta; o cupom só diz QUEM está na reserva.
  it("lista os outros proponentes pelo nome, sem percentual", () => {
    const html = cupomHTML({
      ...DADOS,
      outrosProponentes: [
        { nome: "JOAO DA SILVA" },
        { nome: "ANA PAULA REIS" },
      ],
    });
    expect(html).toContain("+ JOAO DA SILVA");
    expect(html).toContain("+ ANA PAULA REIS");
    expect(html).not.toContain("%");
  });

  // Lucas, 28/08, olhando o cupom impresso: "faltou na impressao o nome da imobiliairia".
  it("traz a imobiliária, no mesmo formato da tela", () => {
    const html = cupomHTML(DADOS);
    expect(html).toContain("F M S MACIEL IMOVEIS · IGOR FERNANDO CLODOMIRO");
    expect(html).toContain('class="cup-org"');
  });

  it("sem imobiliária o cupom não ganha linha em branco nem rótulo órfão", () => {
    const html = cupomHTML({ ...DADOS, origem: null });
    expect(html).not.toContain("cup-org");
  });

  // Lucas, 28/08: "eu to achando o cupom feio, tem como deixar com um layout turbinado?
  // trazer a logo da C2X".
  it("abre com a faixa preta da marca, igual à etiqueta da credencial", () => {
    const html = cupomHTML(DADOS);
    expect(html).toContain('class="cup-topo"');
    expect(html).toContain('class="cup-logo"');
    expect(html).toContain("https://c2x.app.br/prometeu/c2x-logo.png");
  });

  it("quebra o rótulo do lançamento em nome e data", () => {
    const html = cupomHTML(DADOS);
    expect(html).toContain(">RESIDENCIAL VILLA PARIS<");
    expect(html).toContain(">22/08/2026<");
  });

  it("lançamento sem data no rótulo não gera linha vazia", () => {
    const html = cupomHTML({ ...DADOS, evento: "GARDEN" });
    expect(html).toContain(">GARDEN<");
    expect(html).not.toContain("cup-dataev");
  });

  it("conta os lotes, e concorda no singular", () => {
    expect(cupomHTML(DADOS)).toContain("LOTES RESERVADOS · 3");
    const um = cupomHTML({ ...DADOS, unidades: [{ lote: "06", quadra: "G" }] });
    expect(um).toContain("LOTE RESERVADO · 1");
  });

  // A faixa e o bloco do código são fundo preto: sem print-color-adjust o Chrome descarta o
  // fundo na impressão e sobra texto branco em papel branco, ou seja, nada.
  it("os blocos invertidos mandam o navegador imprimir o fundo", () => {
    const faixa = CUPOM_CSS.slice(CUPOM_CSS.indexOf(".cup-topo"));
    expect(faixa).toContain("print-color-adjust: exact");
    const codigo = CUPOM_CSS.slice(CUPOM_CSS.indexOf(".cup-cod"));
    expect(codigo).toContain("print-color-adjust: exact");
  });

  it("escapa o que veio do cadastro", () => {
    const html = cupomHTML({
      ...DADOS,
      cliente: 'MARIA <script>alert("x")</script>',
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
