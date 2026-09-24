import { PDFPage } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";

import { montarCadPdf, type CadDoc } from "./cad-pdf";

// O CABEÇALHO DA CAD, medido pelo que é DESENHADO (spy no drawText do pdf-lib), e não pelo tamanho
// do arquivo. Lucas (24/09/2026): "vamos trazer o empreendimento a qual aquela cad esta vinculada?
// pode ser abaixo de corretor". O que está travado aqui:
//   • a linha "Empreendimento" sai ABAIXO da do Corretor (y menor no PDF, que cresce para cima);
//   • sem o campo (a ficha da imobiliária), a linha não existe;
//   • a régua do cabeçalho continua abaixo da última linha (nada se sobrepõe);
//   • o valor passa pelo saneamento WinAnsi (um travessão não derruba a geração).

type Chamada = { texto: string; y: number };

const CAD: CadDoc = {
  arquivo: "CAD - Jonatas - 24/09/2026 12:23",
  autenticacao: "CAD-2026-90D26E89",
  corretor: "RONILSON BELTRAO DINIZ",
  data: "21/09/2026",
  hora: "15:14",
  imobiliaria: "BELTRAO DINIZ IMOVEIS LTDA",
  nome: "Jonatas Bruce De Oliveira",
  papel: "Prospect",
  secoes: [{ fields: [{ label: "CPF", value: "529.982.247-25" }], title: "Identificação" }],
};

function espionar() {
  const texto = vi.spyOn(PDFPage.prototype, "drawText");
  const linha = vi.spyOn(PDFPage.prototype, "drawLine");
  const desenhados = (): Chamada[] =>
    texto.mock.calls.map(([t, opcoes]) => ({ texto: String(t), y: Number(opcoes?.y ?? NaN) }));
  const regua = () => {
    const chamada = linha.mock.calls.find(([opcoes]) => opcoes.thickness === 1.4);
    return chamada ? chamada[0].start.y : NaN;
  };
  return { desenhados, regua };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cabeçalho da CAD: empreendimento", () => {
  it("desenha 'Empreendimento' ABAIXO de 'Corretor', com o valor na mesma linha", async () => {
    const { desenhados, regua } = espionar();
    const bytes = await montarCadPdf({ ...CAD, empreendimento: "Vale do Ouro" });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");

    const chamadas = desenhados();
    const corretor = chamadas.find((c) => c.texto === "Corretor ");
    const rotulo = chamadas.find((c) => c.texto === "Empreendimento ");
    const valor = chamadas.find((c) => c.texto === "Vale do Ouro");

    expect(corretor).toBeDefined();
    expect(rotulo).toBeDefined();
    expect(valor).toBeDefined();
    // O PDF cresce para CIMA: "abaixo" é y menor. Uma linha de meta (11pt) abaixo do corretor.
    expect(rotulo!.y).toBeLessThan(corretor!.y);
    expect(corretor!.y - rotulo!.y).toBeCloseTo(11);
    expect(valor!.y).toBe(rotulo!.y);
    // A régua grossa do cabeçalho fica abaixo da última linha: nada se sobrepõe.
    expect(regua()).toBeLessThan(rotulo!.y);
  });

  it("sem o campo, a linha não é desenhada (a ficha da imobiliária segue como era)", async () => {
    const { desenhados } = espionar();
    await montarCadPdf({ ...CAD, empreendimento: undefined });
    expect(desenhados().some((c) => c.texto.startsWith("Empreendimento"))).toBe(false);
    expect(desenhados().some((c) => c.texto === "Corretor ")).toBe(true);
  });

  it("empreendimento só com espaços conta como vazio", async () => {
    const { desenhados } = espionar();
    await montarCadPdf({ ...CAD, empreendimento: "   " });
    expect(desenhados().some((c) => c.texto.startsWith("Empreendimento"))).toBe(false);
  });

  it("sem corretor, o empreendimento sobe para a linha dele (não fica buraco)", async () => {
    const { desenhados } = espionar();
    await montarCadPdf({ ...CAD, corretor: undefined, empreendimento: "Lagoa Bonita" });
    const chamadas = desenhados();
    const imobiliaria = chamadas.find((c) => c.texto === "Imobiliaria ");
    const rotulo = chamadas.find((c) => c.texto === "Empreendimento ");
    expect(imobiliaria!.y - rotulo!.y).toBeCloseTo(11);
  });

  it("valor fora do WinAnsi é saneado em vez de derrubar a CAD", async () => {
    const { desenhados } = espionar();
    const bytes = await montarCadPdf({
      ...CAD,
      corretor: "ANA — SOUZA",
      empreendimento: "Vale do Ouro ✓",
    });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const textos = desenhados().map((c) => c.texto);
    expect(textos).toContain("ANA - SOUZA");
    expect(textos.some((t) => t.trim() === "Vale do Ouro")).toBe(true);
    expect(textos.some((t) => t.includes("✓"))).toBe(false);
  });
});
