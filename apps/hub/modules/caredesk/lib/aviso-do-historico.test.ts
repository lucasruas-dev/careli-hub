import { describe, expect, it } from "vitest";

import { avisoDoHistorico } from "./aviso-do-historico";

// O QUE ESTES TESTES TRAVAM (relato do Lucas em 09/09/2026): "na iris não está trazendo os
// tickets ABERTOS para um determinado cliente". Não era defeito — é o desenho da tela:
// `sourceTickets = focus ? focusTickets : closedTickets` (iris-history-view.tsx). Sem foco, o
// Histórico mostra SÓ encerrados, então procurar o cliente digitando o nome nunca traz um
// atendimento em aberto. A tela não dizia isso em lugar nenhum, e quem buscava concluía que o
// sistema tinha perdido o atendimento.

describe("avisoDoHistorico", () => {
  it("avisa quando alguém busca sem foco: a lista aqui não tem os abertos", () => {
    const aviso = avisoDoHistorico({ resultados: 3, temFoco: false, termo: "raiane" });

    expect(aviso).not.toBeNull();
    expect(aviso).toMatch(/encerrados/i);
    expect(aviso).toMatch(/Board/);
  });

  // Sem termo digitado a pessoa está só navegando: o cabeçalho já diz o que a aba é, e um
  // aviso permanente vira ruído que ninguém lê.
  it("fica calado quando ninguém está buscando", () => {
    expect(avisoDoHistorico({ resultados: 337, temFoco: false, termo: "" })).toBeNull();
    expect(avisoDoHistorico({ resultados: 337, temFoco: false, termo: "   " })).toBeNull();
  });

  // ⚠️ COM FOCO A LISTA MUDA DE FONTE e passa a incluir os abertos daquele cliente. Repetir o
  // aviso ali seria dizer o contrário do que a tela está fazendo.
  it("fica calado quando há um cliente em foco, porque aí os abertos entram", () => {
    expect(avisoDoHistorico({ resultados: 8, temFoco: true, termo: "raiane" })).toBeNull();
    expect(avisoDoHistorico({ resultados: 0, temFoco: true, termo: "raiane" })).toBeNull();
  });

  // A busca vazia é o momento em que a pessoa mais precisa da explicação: ela procurou o
  // cliente, não achou, e a conclusão natural e errada é "o atendimento sumiu".
  it("é mais explícito quando a busca não achou nada", () => {
    const semResultado = avisoDoHistorico({ resultados: 0, temFoco: false, termo: "raiane" });
    const comResultado = avisoDoHistorico({ resultados: 5, temFoco: false, termo: "raiane" });

    expect(semResultado).not.toBeNull();
    expect(comResultado).not.toBeNull();
    expect(semResultado).not.toBe(comResultado);
    expect(semResultado).toMatch(/mais antigos|carregar/i);
  });
});
