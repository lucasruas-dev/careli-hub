import { describe, expect, it } from "vitest";

import { marcarSituacao, type LinhaAssinatura } from "./painel-assinatura";

// A fila de um contrato REAL do Vale do Ouro (lida do C2X em 17/08/2026):
//   1 corretor · 2 comprador · 3 financeiro e administrativo do Cecílio Rocha (dois no mesmo
//   degrau) · 4 e 5 Lino e Cecílio · 6 Gurgel e imobiliária · 7 Northon · 8 Nívea.

function linha(p: Partial<LinhaAssinatura> & { contrato: number; degrau: number }): LinhaAssinatura {
  return {
    assinadoEm: null,
    assinou: false,
    diasDesdeEnvio: 0,
    email: `${p.usuario ?? "x"}@exemplo.com`,
    emp: "VOC",
    envio: "2026-08-01",
    lote: "1",
    perfil: "Backoffice",
    prazo: null,
    quadra: "A",
    situacao: "aguardando",
    un: "VOCA1",
    usuario: "Fulano",
    valor: 100,
    ...p,
  };
}

describe("marcarSituacao", () => {
  it("com só o corretor assinado, a bola está no comprador e mais ninguém", () => {
    const linhas = marcarSituacao([
      linha({ assinou: true, contrato: 1, degrau: 1, usuario: "Corretor" }),
      linha({ contrato: 1, degrau: 2, usuario: "Comprador" }),
      linha({ contrato: 1, degrau: 7, usuario: "Northon" }),
      linha({ contrato: 1, degrau: 8, usuario: "Nivea" }),
    ]);

    const por = (nome: string) => linhas.find((l) => l.usuario === nome)?.situacao;

    expect(por("Corretor")).toBe("assinado");
    expect(por("Comprador")).toBe("vez");
    expect(por("Northon")).toBe("aguardando");
    expect(por("Nivea")).toBe("aguardando");
  });

  it("quem divide o degrau assina em paralelo: os dois estão na vez", () => {
    // O contrato real tem DOIS no degrau 3 e TRÊS no 5. Nenhum segura o outro.
    const linhas = marcarSituacao([
      linha({ assinou: true, contrato: 1, degrau: 1, usuario: "Corretor" }),
      linha({ assinou: true, contrato: 1, degrau: 2, usuario: "Comprador" }),
      linha({ contrato: 1, degrau: 3, usuario: "Yasmin" }),
      linha({ contrato: 1, degrau: 3, usuario: "Rafael" }),
      linha({ contrato: 1, degrau: 4, usuario: "Cecilio" }),
    ]);

    const por = (nome: string) => linhas.find((l) => l.usuario === nome)?.situacao;

    expect(por("Yasmin")).toBe("vez");
    expect(por("Rafael")).toBe("vez");
    expect(por("Cecilio")).toBe("aguardando");
  });

  it("um pendente no degrau 3 trava o 4, mesmo com o outro do 3 já assinado", () => {
    const linhas = marcarSituacao([
      linha({ assinou: true, contrato: 1, degrau: 3, usuario: "Yasmin" }),
      linha({ contrato: 1, degrau: 3, usuario: "Rafael" }),
      linha({ contrato: 1, degrau: 4, usuario: "Cecilio" }),
    ]);

    expect(linhas.find((l) => l.usuario === "Rafael")?.situacao).toBe("vez");
    expect(linhas.find((l) => l.usuario === "Cecilio")?.situacao).toBe("aguardando");
  });

  it("contrato inteiro assinado não deixa ninguém na vez", () => {
    const linhas = marcarSituacao([
      linha({ assinou: true, contrato: 1, degrau: 1, usuario: "A" }),
      linha({ assinou: true, contrato: 1, degrau: 2, usuario: "B" }),
    ]);

    expect(linhas.every((l) => l.situacao === "assinado")).toBe(true);
  });

  it("a fila de um contrato NÃO interfere na de outro", () => {
    // O erro que isto previne: calcular a frente da fila globalmente, e não por contrato. O
    // Northon estaria "aguardando" em tudo por causa de um contrato atrasado alheio.
    const linhas = marcarSituacao([
      linha({ contrato: 1, degrau: 1, usuario: "Corretor" }),
      linha({ contrato: 1, degrau: 7, usuario: "Northon-1" }),
      linha({ assinou: true, contrato: 2, degrau: 1, usuario: "Corretor2" }),
      linha({ assinou: true, contrato: 2, degrau: 6, usuario: "Gurgel" }),
      linha({ contrato: 2, degrau: 7, usuario: "Northon-2" }),
    ]);

    const por = (nome: string) => linhas.find((l) => l.usuario === nome)?.situacao;

    expect(por("Northon-1")).toBe("aguardando");
    // No contrato 2 tudo antes dele já assinou: é a vez dele.
    expect(por("Northon-2")).toBe("vez");
  });

  it("o caso do Northon, com os números medidos: 181 pendências, 2 de verdade", () => {
    // 2 contratos prontos para ele e 179 travados antes. O painel mostrava 181 em "assinar".
    const linhas: LinhaAssinatura[] = [];
    for (let c = 1; c <= 181; c += 1) {
      const prontoParaEle = c <= 2;
      linhas.push(
        linha({ assinou: prontoParaEle, contrato: c, degrau: 6, usuario: "Gurgel" }),
        linha({ contrato: c, degrau: 7, usuario: "Northon" }),
      );
    }

    const doNorthon = marcarSituacao(linhas).filter((l) => l.usuario === "Northon");

    expect(doNorthon.filter((l) => l.situacao === "vez")).toHaveLength(2);
    expect(doNorthon.filter((l) => l.situacao === "aguardando")).toHaveLength(179);
  });
});
