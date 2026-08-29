import { describe, expect, it } from "vitest";

import { CUPOM_CSS, cupomHTML } from "./imprimir-cupom";

// O QUE O PAPEL TÉRMICO EXIGE, preso por teste.
//
// A lista encolheu depois que a densidade do driver foi corrigida (28/08/2026). Enquanto ela
// estava em "default", metade do cupom saía apagada — "COMPROVANTE DE RESERVA" imprimiu
// "PESERVA", porque o R não marcou — e a única saída era pôr TUDO em negrito. Com a densidade
// alta e uma fonte de traço grosso, o peso normal imprime limpo, e o negrito voltou a ser
// hierarquia em vez de muleta.
//
// O que continua valendo, e por isso segue aqui: fonte grossa, piso de 11px e nenhum tom de
// cinza no caminho. Sem isso, o próximo campo que alguém acrescentar nasce ilegível.

const MENOR_TAMANHO_QUE_IMPRIME = 11;

function tamanhosDeFonte(css: string): number[] {
  return [...css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) =>
    Number(m[1]),
  );
}

describe("o CSS do cupom respeita o papel térmico", () => {
  // A fonte é o que mais marca o papel depois da densidade: Courier é fina por desenho e
  // deixava o texto rendilhado mesmo em negrito.
  it("usa fonte de traço grosso, não monoespaçada fina", () => {
    expect(CUPOM_CSS).toContain("font-family: Arial");
    expect(CUPOM_CSS).not.toContain("Courier");
  });

  // O que se lê DE LONGE é negrito; o que se lê de perto fica no peso normal. Sem isto o
  // cupom perde a hierarquia que o operador usa para conferir de relance.
  it("os destaques estão em negrito", () => {
    for (const classe of [
      ".cup-selo",
      ".cup-emp",
      ".cup-cli",
      ".cup-lote",
      ".cup-cod",
    ]) {
      // Com a chave junto: `.cup-lote` sozinho casaria com `.cup-lotes`, que vem antes e é
      // outra regra.
      const daClasse = CUPOM_CSS.slice(CUPOM_CSS.indexOf(classe + " {"));
      const regra = daClasse.slice(0, daClasse.indexOf("}"));
      expect(regra, classe).toContain("font-weight: 700");
    }
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
    expect(html).toContain("QUADRA G - LOTE 06");
    expect(html).toContain("QUADRA G - LOTE 08");
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
    expect(html).toContain("F M S MACIEL IMOVEIS - IGOR FERNANDO CLODOMIRO");
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
    expect(cupomHTML(DADOS)).toContain("LOTES RESERVADOS - 3");
    const um = cupomHTML({ ...DADOS, unidades: [{ lote: "06", quadra: "G" }] });
    expect(um).toContain("LOTE RESERVADO - 1");
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
