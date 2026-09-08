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

  // ⚠️ COM QUEBRA DE LINHA ENTRE ELES. Até 08/09/2026 os parágrafos vinham colados
  // ("primeirosegundo"), e era o maior defeito do agente: ele lia "…deste instrumento.II –
  // INTERMEDIADORES…" e citava trechos com o espaço que consertava sozinho na leitura — que depois
  // não casavam. Lucas viu o resultado: *"11 propostas… 17 não casou com o texto"*.
  it("separa parágrafos por quebra de linha", () => {
    const valor = doc([{ text: "primeiro" }], [{ text: "segundo" }]);
    expect(textoDoDocumento(valor)).toBe("primeiro\nsegundo");
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
    // Célula também é bloco: sem a quebra, "célula A" e "célula B" viravam uma palavra só.
    expect(textoDoDocumento(valor)).toBe("célula A\ncélula B");
  });

  it("guarda o caminho e o início de cada nó de texto", () => {
    const valor = doc([{ text: "abc" }, { text: "def" }]);
    const { pedacos } = pedacosDeTexto(valor);
    // O último é o separador do parágrafo: existe no texto, não existe no documento.
    expect(pedacos.filter((x) => !x.virtual)).toEqual([
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

  // ⚠️ O SEPARADOR NÃO É UM LUGAR NO DOCUMENTO. Ele existe no texto que a IA lê, mas não em nó
  // nenhum: um ponto que caísse nele não teria caminho no Slate. Aqui a faixa começa no fim do
  // primeiro parágrafo e termina no começo do segundo, que é o que se vê na tela.
  it("acha um trecho que atravessa parágrafos", () => {
    const valor = doc([{ text: "fim do um" }], [{ text: "começo do dois" }]);
    const faixa = faixaDoTrecho(valor, "um começo");
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

describe("a busca tolera a forma, e só a forma", () => {
  // ⚠️ ESTES SÃO OS CASOS QUE DERRUBAVAM AS 17 PROPOSTAS. Nenhum deles muda uma letra do contrato —
  // são o que o Word faz sozinho com o texto enquanto alguém digita, e o que sobrevive à importação.

  it("acha apesar do espaço duro do Word", () => {
    // U+00A0 entre "n.º" e o número: na tela é um espaço; no `indexOf`, outro caractere.
    const valor = doc([{ text: "portador do CPF n.º\u00A0123.456.789-00, casado" }]);
    expect(faixaDoTrecho(valor, "CPF n.º 123.456.789-00")).not.toBeNull();
  });

  it("acha apesar do espaço dobrado", () => {
    const valor = doc([{ text: "o valor de  R$ 100,00 será pago" }]);
    expect(faixaDoTrecho(valor, "o valor de R$ 100,00")).not.toBeNull();
  });

  it("acha apesar das aspas e do travessão curvos", () => {
    const valor = doc([{ text: "a “VENDEDORA” – doravante assim chamada" }]);
    expect(faixaDoTrecho(valor, 'a "VENDEDORA" - doravante')).not.toBeNull();
  });

  it("devolve a posição do texto ORIGINAL, não do normalizado", () => {
    const valor = doc([{ text: "Eu,  JOÃO, casado" }]);
    const faixa = faixaDoTrecho(valor, "JOÃO");
    // Dois espaços depois da vírgula: no normalizado o nome começa em 4, no original em 5.
    expect(faixa?.inicio).toEqual({ offset: 5, path: [0, 0] });
    expect(faixa?.fim).toEqual({ offset: 9, path: [0, 0] });
  });

  // ⚠️ A TOLERÂNCIA PARA NA FORMA. Acento e letra continuam valendo — "quase achar" o trecho é o que
  // faz a substituição cair no lugar errado do contrato.
  it("não acha quando o acento é diferente", () => {
    expect(faixaDoTrecho(doc([{ text: "José da Silva" }]), "Jose da Silva")).toBeNull();
  });

  it("não acha quando a pontuação é diferente", () => {
    expect(faixaDoTrecho(doc([{ text: "CPF n.º 111" }]), "CPF no 111")).toBeNull();
  });
});
