import { describe, expect, it } from "vitest";

import { anotarContexto, contextoDoRequest } from "./log-erros";

// O contexto é o que transforma o Log Erros de "lista de erros anônimos" em "quem travou".
// Se ele se perder no meio do caminho, a tela mostra "—" na coluna que o Lucas pediu.

function req(): Request {
  return new Request("https://c2x.app.br/api/publico/cad/sessao", { method: "POST" });
}

describe("anotarContexto", () => {
  it("guarda o que a rota descobriu", () => {
    const r = req();
    anotarContexto(r, { corretorNome: "Ana Paula", imobiliariaNome: "Raiane Imóveis" });

    expect(contextoDoRequest(r)).toEqual({
      corretorNome: "Ana Paula",
      imobiliariaNome: "Raiane Imóveis",
    });
  });

  it("ACUMULA entre chamadas: o passo seguinte não apaga o anterior", () => {
    const r = req();
    anotarContexto(r, { corretorCpf: "12345678901" });
    anotarContexto(r, { imobiliariaNome: "Raiane Imóveis" });

    expect(contextoDoRequest(r)).toEqual({
      corretorCpf: "12345678901",
      imobiliariaNome: "Raiane Imóveis",
    });
  });

  it("string vazia NÃO apaga o que já se sabia", () => {
    // A armadilha real: a rota anota o nome da sessão e, no passo seguinte, anota "" porque a
    // consulta não achou. Com `??` o nome sumiria e a linha ficaria anônima.
    const r = req();
    anotarContexto(r, { imobiliariaNome: "Raiane Imóveis" });
    anotarContexto(r, { imobiliariaNome: "" });

    expect(contextoDoRequest(r)?.imobiliariaNome).toBe("Raiane Imóveis");
  });

  it("null e undefined também não apagam", () => {
    const r = req();
    anotarContexto(r, { corretorNome: "Ana Paula" });
    anotarContexto(r, { corretorNome: null });
    anotarContexto(r, { corretorNome: undefined });

    expect(contextoDoRequest(r)?.corretorNome).toBe("Ana Paula");
  });

  it("valor novo SUBSTITUI o antigo quando não é vazio", () => {
    const r = req();
    anotarContexto(r, { imobiliariaNome: "Nome do token" });
    anotarContexto(r, { imobiliariaNome: "Razão social conferida" });

    expect(contextoDoRequest(r)?.imobiliariaNome).toBe("Razão social conferida");
  });

  it("apara espaço em volta", () => {
    const r = req();
    anotarContexto(r, { corretorNome: "  Ana Paula  " });

    expect(contextoDoRequest(r)?.corretorNome).toBe("Ana Paula");
  });

  it("uma requisição NÃO enxerga o contexto de outra", () => {
    // O erro clássico seria guardar isto num módulo: a imobiliária de um corretor apareceria na
    // linha de erro de outro, e a tela acusaria quem não tentou.
    const a = req();
    const b = req();
    anotarContexto(a, { imobiliariaNome: "Raiane Imóveis" });

    expect(contextoDoRequest(b)).toBeUndefined();
  });

  it("requisição sem anotação nenhuma devolve undefined", () => {
    expect(contextoDoRequest(req())).toBeUndefined();
  });
});
