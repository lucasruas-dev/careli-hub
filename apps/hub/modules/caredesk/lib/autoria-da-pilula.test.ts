import { describe, expect, it } from "vitest";

import { autoriaDaPilula } from "./autoria-da-pilula";

// QUEM FEZ A TRANSFERÊNCIA (chamado TI-000059).
//
// Os dados abaixo são transferências reais da Iris, lidas do banco em 21/09/2026.
const formatar = (iso: string) => (iso === "2026-09-17T19:32:37.666Z" ? "17/09/2026 16:32" : "—");

describe("a linha de autoria da pílula de sistema", () => {
  it("⚠️ transferência feita por uma PESSOA mostra o nome dela e a hora", () => {
    // Evento real: Beatriz Araújo passou o atendimento de Atendimento para Cobrança.
    expect(
      autoriaDaPilula(
        { createdAt: "2026-09-17T19:32:37.666Z", senderLabel: "Beatriz Araújo" },
        formatar,
      ),
    ).toBe("Beatriz Araújo · 17/09/2026 16:32");
  });

  it("transferência feita pela Cacá se identifica com o próprio nome", () => {
    // 1.852 das 2.521 transferências são dela: quem lê a conversa precisa ver que foi a máquina.
    expect(
      autoriaDaPilula({ createdAt: "2026-09-17T19:32:37.666Z", senderLabel: "Cacá" }, formatar),
    ).toBe("Cacá · 17/09/2026 16:32");
  });

  // ⚠️ SEM NOME NÃO SE INVENTA "OPERADOR". "Mensagem system recebida pelo WhatsApp" nasce sem autor
  // (7 casos medidos em produção); escrever um nome genérico ali seria afirmar que alguém agiu.
  it("mensagem de sistema sem autor mostra só a hora", () => {
    expect(autoriaDaPilula({ createdAt: "2026-09-17T19:32:37.666Z" }, formatar)).toBe(
      "17/09/2026 16:32",
    );
    expect(autoriaDaPilula({ createdAt: "2026-09-17T19:32:37.666Z", senderLabel: "   " }, formatar)).toBe(
      "17/09/2026 16:32",
    );
  });

  it("sem nome e sem data, a pílula fica como estava", () => {
    expect(autoriaDaPilula({}, formatar)).toBeNull();
    expect(autoriaDaPilula({ createdAt: null, senderLabel: null }, formatar)).toBeNull();
  });

  it("só o nome, quando a data não veio", () => {
    expect(autoriaDaPilula({ senderLabel: "Nivea Careli" }, formatar)).toBe("Nivea Careli");
  });

  // O formatador é o da tela; se ele devolver vazio, a linha não fica com um "·" solto.
  it("formatador que não sabe formatar não deixa separador órfão", () => {
    expect(autoriaDaPilula({ createdAt: "sei-la", senderLabel: "Cinthia Cruz" }, () => "")).toBe(
      "Cinthia Cruz",
    );
  });
});

// ⚠️ O TRAÇO É O VAZIO DA TELA. `formatDateTime` do IrisPage devolve "-" para data ausente ou
// inválida, e deixá-lo passar imprimiria "Beatriz Araújo · -" na conversa.
describe("o traço do formatador não vira data", () => {
  it("nome com data inválida sai só com o nome", () => {
    expect(autoriaDaPilula({ createdAt: "nao-e-data", senderLabel: "Beatriz Araújo" }, () => "-")).toBe(
      "Beatriz Araújo",
    );
  });

  it("sem nome e com data inválida, não sobra nada", () => {
    expect(autoriaDaPilula({ createdAt: "nao-e-data" }, () => "-")).toBeNull();
  });
});
