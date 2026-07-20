import { describe, expect, it } from "vitest";

import { classificarCad } from "./cad-diagnostico";

// Casos REAIS de produção (21/jul). Cada um destes já enganou alguém — a mim, inclusive.
describe("classificarCad", () => {
  // O caso que me fez errar o diagnóstico: eu olhei o documento lido (era da Karla, com o
  // nome da mãe dela batendo) e concluí que a ficha estava certa. Estava errada: o Asana diz
  // que o PROPONENTE é o Mateus. O documento diz os dados; só o Asana diz o lugar de cada um.
  it("acusa troca quando a ficha ficou com o cônjuge (Mateus x Karla)", () => {
    const r = classificarCad({
      casado: true,
      conjugeAsana: "Karla Rodrigues Lopes",
      conjugeRegistrado: "Karla Rodrigues Lopes",
      proponenteAsana: "Mateus Lázaro Duarte dos santos",
      tituloApolo: "KARLA RODRIGUES LOPES",
    });
    expect(r.veredito).toBe("trocado");
    expect(r.detalhe).toContain("Mateus");
  });

  it("acusa troca no caso Márcia x Hélio", () => {
    const r = classificarCad({
      casado: true,
      conjugeAsana: "Hélio Geraldo de souza",
      conjugeRegistrado: "Hélio Geraldo de souza",
      proponenteAsana: "Márcia aparecida de paula souza",
      tituloApolo: "HELIO GERALDO DE SOUZA",
    });
    expect(r.veredito).toBe("trocado");
  });

  // O OCR leu "JOÃO MARCUS REZENDE COMO" onde o Asana diz "JOAO MARCOS REZENDE COELHO".
  // A distância de edição sozinha reprovaria; primeiro nome + último sobrenome resolvem.
  it("reconhece o cônjuge mesmo com o sobrenome lido errado pelo OCR", () => {
    const r = classificarCad({
      casado: true,
      conjugeAsana: "JOAO MARCOS REZENDE COELHO",
      conjugeRegistrado: "JOAO MARCOS REZENDE COELHO",
      proponenteAsana: "MARIA EDUARDA CONCEIÇÃO BRAGA",
      tituloApolo: "JOÃO MARCUS REZENDE COMO",
    });
    expect(r.veredito).toBe("trocado");
  });

  it("aceita a ficha quando o titular é o proponente, só variando acento", () => {
    const r = classificarCad({
      casado: false,
      conjugeAsana: null,
      conjugeRegistrado: null,
      proponenteAsana: "Antônio Carlos Batista",
      tituloApolo: "ANTONIO CARLOS BATISTA",
    });
    expect(r.veredito).toBe("ok");
  });

  it("marca falta_conjuge quando é casado, a ficha está certa e o cônjuge não existe", () => {
    const r = classificarCad({
      casado: true,
      conjugeAsana: "Fulana de Tal",
      conjugeRegistrado: null,
      proponenteAsana: "Beltrano da Silva",
      tituloApolo: "BELTRANO DA SILVA",
    });
    expect(r.veredito).toBe("falta_conjuge");
  });

  // ⚠️ O empate tem que ir para o PROPONENTE. Trocar a identidade de um cliente por engano é
  // muito pior do que deixar a ficha como está.
  it("no empate entre nomes parecidos, mantém o proponente", () => {
    const r = classificarCad({
      casado: true,
      conjugeAsana: "Jose Silva Santos",
      conjugeRegistrado: "Jose Silva Santos",
      proponenteAsana: "Jose Silva Santos",
      tituloApolo: "JOSE SILVA SANTOS",
    });
    expect(r.veredito).not.toBe("trocado");
  });

  // O OCR leu um DIPLOMA e o nome virou um pedaço do texto do certificado.
  it("manda para conferência quando o titular não casa com ninguém", () => {
    const r = classificarCad({
      casado: false,
      conjugeAsana: null,
      conjugeRegistrado: null,
      proponenteAsana: "Edvania Domingos da Silva",
      tituloApolo: "DE EDUCACAO BASICA II",
    });
    expect(r.veredito).toBe("conferir");
  });

  // BUG REAL encontrado ao conferir o laudo em produção (21/jul): a CAD da "Angelica Maria da
  // Silva" apontava para a ficha do "IGOR JUNIO DA SILVA" — duas pessoas diferentes. O "da" e
  // o "silva" em comum levavam a média a exatamente 0,60 e a ficha passava como correta.
  it("não confunde pessoas que só dividem preposição e sobrenome", () => {
    const r = classificarCad({
      casado: true,
      conjugeAsana: null,
      conjugeRegistrado: null,
      proponenteAsana: "Angelica Maria da Silva",
      tituloApolo: "IGOR JUNIO DA SILVA",
    });
    expect(r.veredito).toBe("conferir");
  });

  // Mesma família, primeiro nome diferente: é parente, não a mesma pessoa.
  it("não trata pai e filho como a mesma pessoa", () => {
    const r = classificarCad({
      casado: false,
      conjugeAsana: null,
      conjugeRegistrado: null,
      proponenteAsana: "Leandro Pereira Melgaço",
      tituloApolo: "JOSE EUSTAQUIO MELGACO",
    });
    expect(r.veredito).toBe("conferir");
  });

  // A JFL é PJ e entrou como PF, com o nome e o CPF do representante.
  it("manda para conferência a empresa que virou pessoa física", () => {
    const r = classificarCad({
      casado: false,
      conjugeAsana: null,
      conjugeRegistrado: null,
      proponenteAsana: "Jfl industria e Agro ltda",
      tituloApolo: "GIANI SILVIO GALVAO AGUIAR",
    });
    expect(r.veredito).toBe("conferir");
  });

  it("manda para conferência quando a CAD não informa o proponente", () => {
    const r = classificarCad({
      casado: false,
      conjugeAsana: null,
      conjugeRegistrado: null,
      proponenteAsana: null,
      tituloApolo: "QUALQUER NOME",
    });
    expect(r.veredito).toBe("conferir");
  });

  // Erro de digitação de UMA letra continua sendo a mesma pessoa (caso real: Cristiana/Cristina).
  it("tolera erro de digitação no nome do proponente", () => {
    const r = classificarCad({
      casado: false,
      conjugeAsana: null,
      conjugeRegistrado: null,
      proponenteAsana: "Jessica Cristiana de Lima",
      tituloApolo: "JESSICA CRISTINA DE LIMA",
    });
    expect(r.veredito).toBe("ok");
  });
});
