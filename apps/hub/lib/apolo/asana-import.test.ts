import { describe, expect, it } from "vitest";

import { DESTINO_POR_SECAO, normalizarNome, similaridade } from "./asana-import";

// O casamento entre a CAD do Asana e a entidade do Apolo é feito por NOME normalizado. Os dois
// foram digitados por pessoas diferentes, em momentos diferentes, então a normalização é o que
// decide quem casa com quem — e casar errado imprime credencial com o nome trocado no dia do
// evento. Estes testes travam o comportamento.

describe("normalizarNome", () => {
  it("ignora acento", () => {
    expect(normalizarNome("José Antônio")).toBe(normalizarNome("Jose Antonio"));
    expect(normalizarNome("Conceição")).toBe("conceicao");
  });

  it("ignora caixa", () => {
    expect(normalizarNome("MARIA DA SILVA")).toBe(normalizarNome("maria da silva"));
  });

  it("colapsa espaço repetido e apara as pontas", () => {
    expect(normalizarNome("  Ana   Paula  ")).toBe("ana paula");
  });

  it("ignora pontuação que aparece em nome digitado", () => {
    expect(normalizarNome("D'Ávila")).toBe(normalizarNome("D Avila"));
    expect(normalizarNome("Silva, João")).toBe("silva joao");
  });

  it("trata nulo e vazio sem quebrar", () => {
    expect(normalizarNome(null)).toBe("");
    expect(normalizarNome(undefined)).toBe("");
    expect(normalizarNome("   ")).toBe("");
  });

  // A regra é deliberadamente CONSERVADORA: nome parcial NÃO casa. É melhor cair na lista
  // "sem cadastro" e a pessoa resolver do que casar o cliente errado.
  it("não casa nome parcial com nome completo", () => {
    expect(normalizarNome("Joao Silva")).not.toBe(normalizarNome("Joao Silva Junior"));
    expect(normalizarNome("Maria")).not.toBe(normalizarNome("Maria Souza"));
  });

  it("não confunde pessoas diferentes com sobrenome parecido", () => {
    expect(normalizarNome("Carlos Eduardo Lima")).not.toBe(
      normalizarNome("Carlos Eduardo Lima Neto"),
    );
  });
});

// Sugestão de "quase casou": nome com erro de digitação. O limiar de produção é 0,86 e estes
// são os três casos REAIS que apareceram na importação do Vale do Ouro (20/jul).
describe("similaridade — sugestão de nome quase igual", () => {
  const LIMIAR = 0.86;
  const sim = (a: string, b: string) => similaridade(normalizarNome(a), normalizarNome(b));

  it("reconhece os erros de digitação reais da importação", () => {
    expect(sim("Jessica Cristiana de Lima", "Jessica Cristina de Lima")).toBeGreaterThan(LIMIAR);
    expect(sim("Jose Higno", "Jose Higino")).toBeGreaterThan(LIMIAR);
    expect(sim("Marcel Feliphe", "Marcel Felipe")).toBeGreaterThan(LIMIAR);
  });

  it("é 1 para nome idêntico depois de normalizar", () => {
    expect(sim("JOSÉ ANTÔNIO", "jose antonio")).toBe(1);
  });

  // O ponto que justifica NUNCA aplicar sozinho: sobrenome trocado por uma letra passa do
  // limiar e é outra pessoa. Por isso a tela pede confirmação em vez de casar automático.
  it("também pontua alto para pessoas DIFERENTES de nome parecido", () => {
    expect(sim("Joao Silva", "Joao Silvo")).toBeGreaterThan(LIMIAR);
  });

  it("não sugere quando os nomes são realmente diferentes", () => {
    expect(sim("Ana Paula Souza", "Carlos Eduardo Lima")).toBeLessThan(LIMIAR);
    expect(sim("Maria Santos", "Maria Fernanda Rodrigues")).toBeLessThan(LIMIAR);
  });
});

describe("DESTINO_POR_SECAO", () => {
  // O recorte que o Lucas definiu: recepção e em cadastro entram para validar; finalizado já
  // entra credenciado (essas CADs já viraram cadastro no Apolo).
  it("manda recepção e em cadastro para validação", () => {
    expect(DESTINO_POR_SECAO[normalizarNome("Recepção de CAD")]).toBe("validacao");
    expect(DESTINO_POR_SECAO[normalizarNome("Em cadastro")]).toBe("validacao");
  });

  it("manda finalizado para credenciado", () => {
    expect(DESTINO_POR_SECAO[normalizarNome("Finalizado")]).toBe("credenciado");
    expect(DESTINO_POR_SECAO[normalizarNome("Finalizada")]).toBe("credenciado");
  });

  it("seção desconhecida não tem destino (não importa por engano)", () => {
    expect(DESTINO_POR_SECAO[normalizarNome("Arquivo morto")]).toBeUndefined();
  });
});
