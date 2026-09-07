import { describe, expect, it } from "vitest";

import { faixaDoTrecho, pedacosDeTexto, textoDoDocumento } from "./achar-trecho";

// ⚠️ ESTA CAMADA DECIDE ONDE A VARIÁVEL É INSERIDA. Um offset errado marca o pedaço errado do
// contrato — e o resultado parece certo na tela até alguém ler o papel assinado.

const doc = (...paragrafos: unknown[][]) => paragrafos.map((children) => ({ children, type: "p" }));

describe("percorrer o documento", () => {
  it("concatena o texto na ordem em que se lê", () => {
    const valor = doc([{ text: "COMPRADOR: " }, { bold: true, text: "JOÃO" }, { text: " DA SILVA" }]);
    expect(textoDoDocumento(valor)).toBe("COMPRADOR: JOÃO DA SILVA");
  });

  it("atravessa parágrafos", () => {
    const valor = doc([{ text: "primeiro" }], [{ text: "segundo" }]);
    expect(textoDoDocumento(valor)).toBe("primeirosegundo");
  });

  it("desce em estrutura aninhada (tabela)", () => {
    const valor = [
      {
        children: [
          { children: [{ children: [{ text: "célula A" }], type: "td" }], type: "tr" },
          { children: [{ children: [{ text: "célula B" }], type: "td" }], type: "tr" },
        ],
        type: "table",
      },
    ];
    expect(textoDoDocumento(valor)).toBe("célula Acélula B");
  });

  it("guarda o caminho e o início de cada nó de texto", () => {
    const valor = doc([{ text: "abc" }, { text: "def" }]);
    const { pedacos } = pedacosDeTexto(valor);
    expect(pedacos).toEqual([
      { caminho: [0, 0], inicio: 0, texto: "abc" },
      { caminho: [0, 1], inicio: 3, texto: "def" },
    ]);
  });

  // ⚠️ O NÓ DE VARIÁVEL É VOID DE TEXTO VAZIO. Se ele contasse `[nome_cliente]` como texto, todos os
  // offsets seguintes sairiam deslocados em 14 caracteres e a marcação cairia no lugar errado.
  it("conta o nó de variável como comprimento zero", () => {
    const valor = doc([
      { text: "Eu, " },
      { children: [{ text: "" }], nome: "nome_cliente", type: "variavel" },
      { text: ", casado" },
    ]);
    expect(textoDoDocumento(valor)).toBe("Eu, , casado");
  });
});

describe("achar a faixa do trecho", () => {
  it("acha um trecho dentro de um nó só", () => {
    const valor = doc([{ text: "COMPRADOR: JOÃO DA SILVA, casado" }]);
    const faixa = faixaDoTrecho(valor, "JOÃO DA SILVA");
    expect(faixa?.inicio).toEqual({ offset: 11, path: [0, 0] });
    expect(faixa?.fim).toEqual({ offset: 24, path: [0, 0] });
  });

  // ⚠️ O CASO COMUM, NÃO A EXCEÇÃO. O nome fica partido porque alguém deixou metade em negrito — é
  // o mesmo fenômeno que fez `[nome_cl</strong>iente]` sair impresso no primeiro teste do JDG.
  it("acha um trecho PARTIDO entre nós, por causa de uma marca", () => {
    const valor = doc([{ text: "Eu, " }, { bold: true, text: "JOÃO" }, { text: " DA SILVA, casado" }]);
    const faixa = faixaDoTrecho(valor, "JOÃO DA SILVA");
    expect(faixa?.inicio).toEqual({ offset: 0, path: [0, 1] });
    expect(faixa?.fim).toEqual({ offset: 9, path: [0, 2] });
  });

  it("acha um trecho que atravessa parágrafos", () => {
    const valor = doc([{ text: "fim do um" }], [{ text: "começo do dois" }]);
    const faixa = faixaDoTrecho(valor, "umcomeço");
    expect(faixa?.inicio.path).toEqual([0, 0]);
    expect(faixa?.fim.path).toEqual([1, 0]);
  });

  // ⚠️ A SEGUNDA BARREIRA. A rota já recusa trecho ambíguo; aqui é o caso de o documento ter mudado
  // entre a proposta e o clique — marcar a primeira ocorrência seria escolher no escuro.
  it("devolve null quando o trecho aparece mais de uma vez", () => {
    const valor = doc([{ text: "CPF n.º 111 e CPF n.º 222" }]);
    expect(faixaDoTrecho(valor, "CPF n.º")).toBeNull();
  });

  it("devolve null quando o trecho não existe", () => {
    const valor = doc([{ text: "COMPRADOR: JOÃO" }]);
    expect(faixaDoTrecho(valor, "MARIA")).toBeNull();
  });

  it("devolve null para trecho vazio", () => {
    expect(faixaDoTrecho(doc([{ text: "abc" }]), "")).toBeNull();
  });

  it("acha trecho no fim do documento", () => {
    const valor = doc([{ text: "Quadra 12 - Lote 07" }]);
    const faixa = faixaDoTrecho(valor, "07");
    expect(faixa?.fim).toEqual({ offset: 19, path: [0, 0] });
  });

  it("documento vazio não quebra", () => {
    expect(faixaDoTrecho([], "qualquer")).toBeNull();
    expect(textoDoDocumento([])).toBe("");
  });
});
