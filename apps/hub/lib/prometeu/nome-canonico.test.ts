import { describe, expect, it } from "vitest";

import { nomeCanonico } from "./data";

// O NOME NA ETIQUETA TEM QUE SER O NOME DE HOJE.
//
// `prometeu_credenciados.nome` é gravado uma única vez, quando a pessoa entra na fila, e não há
// um só UPDATE dessa coluna no repositório. Quem corrigia o nome no board via tela de identidade
// não via a correção chegar na fila nem na etiqueta — e nem clicar em "Trazer CADs" resolvia,
// porque a rotina sai antes de reler a ficha quando a pessoa já está na fila. O caso que abriu
// esta correção: "AA MARIA FERNANDES DA SILVA" corrigido para "ANA MARIA FERNANDES DA SILVA" no
// board, e a fila do Villa Paris seguiu chamando a pessoa de "AA MARIA". Eram 17 de 653.
//
// A leitura agora resolve o nome pela entidade, e estes testes prendem a REGRA de composição —
// que precisa ser idêntica à da gravação (credenciado-para-fila.ts:99 e :119), senão a fila passa
// a alternar entre duas grafias da mesma pessoa.

describe("nomeCanonico", () => {
  it("usa o nome da entidade, que é onde a correção acontece", () => {
    expect(nomeCanonico(null, "ANA MARIA FERNANDES DA SILVA", "AA MARIA FERNANDES DA SILVA")).toBe(
      "ANA MARIA FERNANDES DA SILVA",
    );
  });

  it("põe em MAIÚSCULAS: é o que faz a etiqueta ser lida de longe no salão", () => {
    expect(nomeCanonico(null, "Ana Maria Fernandes", "X")).toBe("ANA MARIA FERNANDES");
  });

  it("prefere legal_name a display_name — mesma ordem da gravação", () => {
    // Trocar essa ordem faria a leitura discordar da escrita, e o nome ficaria alternando
    // conforme a linha fosse recriada ou não.
    expect(nomeCanonico("RAZAO SOCIAL LTDA", "Nome Fantasia", "X")).toBe("RAZAO SOCIAL LTDA");
  });

  it("cai no display_name quando legal_name é vazio ou só espaço", () => {
    expect(nomeCanonico("   ", "MARIA DE SOUZA", "X")).toBe("MARIA DE SOUZA");
    expect(nomeCanonico(undefined, "MARIA DE SOUZA", "X")).toBe("MARIA DE SOUZA");
  });

  it("mantém o nome antigo quando a entidade não tem nome: etiqueta em branco é pior", () => {
    expect(nomeCanonico(null, null, "JOSE DA SILVA")).toBe("JOSE DA SILVA");
    expect(nomeCanonico("", "   ", "JOSE DA SILVA")).toBe("JOSE DA SILVA");
  });

  it("preserva acento — só a caixa muda", () => {
    expect(nomeCanonico(null, "João Marcus Rezende Coelho", "X")).toBe(
      "JOÃO MARCUS REZENDE COELHO",
    );
  });

  it("tira o espaço das pontas, que apareceria como recuo na etiqueta", () => {
    expect(nomeCanonico(null, "  ANA MARIA  ", "X")).toBe("ANA MARIA");
  });
});
