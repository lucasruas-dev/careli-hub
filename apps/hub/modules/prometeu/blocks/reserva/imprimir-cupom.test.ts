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
  origem: "F M S MACIEL IMOVEIS · IGOR FERNANDO CLODOMIRO",
  outrosProponentes: [] as { nome: string; percentual: number }[],
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
      outrosProponentes: [{ nome: "JOAO DA SILVA", percentual: 50 }],
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

  it("a participação sai com vírgula decimal", () => {
    const html = cupomHTML({
      ...DADOS,
      outrosProponentes: [{ nome: "JOAO DA SILVA", percentual: 33.33 }],
    });
    expect(html).toContain("33,33%");
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

  it("escapa o que veio do cadastro", () => {
    const html = cupomHTML({
      ...DADOS,
      cliente: 'MARIA <script>alert("x")</script>',
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
