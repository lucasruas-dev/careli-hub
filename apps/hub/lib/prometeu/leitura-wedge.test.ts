import { describe, expect, it } from "vitest";

import {
  avaliarLeituraDoWedge,
  decidirEnterDoWedge,
  focoEmCampoDeTexto,
} from "./leitura-wedge";

const ID_DA_FLAVIA = "b61427ca-3d5b-407b-937e-7c47769531f5";

describe("o que conta como bip de leitor", () => {
  it("a leitura real da etiqueta (com o separador que o layout trocou) é aceita e normalizada", () => {
    expect(avaliarLeituraDoWedge({ emCampo: false, texto: "b61427ca;3d5b;407b;937e;7c47769531f5" }))
      .toEqual({ aceita: true, valor: ID_DA_FLAVIA });
  });

  it("Enter sozinho não é leitura — e por isso o Enter humano continua ativando botão", () => {
    expect(avaliarLeituraDoWedge({ emCampo: false, texto: "" }).aceita).toBe(false);
    expect(avaliarLeituraDoWedge({ emCampo: false, texto: "   " }).aceita).toBe(false);
  });

  it("rajada curta fora de campo não vale (menos de 6)", () => {
    expect(avaliarLeituraDoWedge({ emCampo: false, texto: "ABC12" }).aceita).toBe(false);
    expect(avaliarLeituraDoWedge({ emCampo: false, texto: "VLO-0212" }).aceita).toBe(true);
  });

  it("dentro de um input só passa o que tem tamanho de UUID", () => {
    expect(avaliarLeituraDoWedge({ emCampo: true, texto: "VLO-0212" }).aceita).toBe(false);
    expect(avaliarLeituraDoWedge({ emCampo: true, texto: ID_DA_FLAVIA }).aceita).toBe(true);
  });

  it("código de unidade passa intacto (a normalização não estraga o que não é UUID)", () => {
    expect(avaliarLeituraDoWedge({ emCampo: false, texto: "VLO-0212" }).valor).toBe("VLO-0212");
  });
});

describe("foco em campo de texto", () => {
  it("reconhece input, textarea e contentEditable", () => {
    expect(focoEmCampoDeTexto({ tagName: "INPUT" })).toBe(true);
    expect(focoEmCampoDeTexto({ tagName: "TEXTAREA" })).toBe(true);
    expect(focoEmCampoDeTexto({ isContentEditable: true, tagName: "DIV" })).toBe(true);
  });

  it("botão e nulo não são campo", () => {
    expect(focoEmCampoDeTexto({ tagName: "BUTTON" })).toBe(false);
    expect(focoEmCampoDeTexto(null)).toBe(false);
  });
});

// A rajada de verdade: o wedge despeja o UUID em ~200ms (36 teclas, ~6ms cada).
const RAJADA_DE_MAQUINA = { charsDaRajada: 36, duracaoDaRajadaMs: 200 };
const NUNCA_LEU = { msDesdeAUltimaLeitura: 999_999 };

describe("o Enter do leitor não pode clicar o botão focado", () => {
  it("leitura boa: entrega para a tela E cancela a ação padrão", () => {
    const d = decidirEnterDoWedge({
      ...RAJADA_DE_MAQUINA,
      ...NUNCA_LEU,
      emCampo: false,
      texto: "b61427ca;3d5b;407b;937e;7c47769531f5",
    });
    expect(d).toEqual({ aceita: true, cancelarPadrao: true, valor: ID_DA_FLAVIA });
  });

  it("sufixo CR+LF do leitor: não vira leitura, mas o Enter morre aqui", () => {
    const d = decidirEnterDoWedge({
      charsDaRajada: 0,
      duracaoDaRajadaMs: 0,
      emCampo: false,
      msDesdeAUltimaLeitura: 12,
      texto: "",
    });
    expect(d.aceita).toBe(false);
    expect(d.cancelarPadrao).toBe(true);
  });

  it("etiqueta amassada (rajada curta em ritmo de máquina) também não re-clica o lote", () => {
    const d = decidirEnterDoWedge({
      charsDaRajada: 4,
      duracaoDaRajadaMs: 24,
      emCampo: false,
      ...NUNCA_LEU,
      texto: "b614",
    });
    expect(d.aceita).toBe(false);
    expect(d.cancelarPadrao).toBe(true);
  });

  it("Enter humano com botão focado continua clicando o botão", () => {
    const d = decidirEnterDoWedge({
      charsDaRajada: 0,
      duracaoDaRajadaMs: 0,
      emCampo: false,
      ...NUNCA_LEU,
      texto: "",
    });
    expect(d.cancelarPadrao).toBe(false);
  });

  it("digitação humana fora de campo (ritmo de gente) não é roubada", () => {
    const d = decidirEnterDoWedge({
      charsDaRajada: 3,
      duracaoDaRajadaMs: 420,
      emCampo: false,
      ...NUNCA_LEU,
      texto: "abc",
    });
    expect(d.cancelarPadrao).toBe(false);
  });

  it("dentro de um campo, o Enter que não é leitura NUNCA é cancelado (submit é da pessoa)", () => {
    const d = decidirEnterDoWedge({
      ...RAJADA_DE_MAQUINA,
      msDesdeAUltimaLeitura: 10,
      emCampo: true,
      texto: "flavia",
    });
    expect(d.aceita).toBe(false);
    expect(d.cancelarPadrao).toBe(false);
  });

  it("dentro de um campo, leitura de tamanho de UUID passa e cancela", () => {
    const d = decidirEnterDoWedge({
      ...RAJADA_DE_MAQUINA,
      ...NUNCA_LEU,
      emCampo: true,
      texto: ID_DA_FLAVIA,
    });
    expect(d).toEqual({ aceita: true, cancelarPadrao: true, valor: ID_DA_FLAVIA });
  });
});
