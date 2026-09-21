import { describe, expect, it } from "vitest";

import { assuntoParaAFila, filaDaAbertura } from "./fila-da-abertura";

// Os dados são os de produção, lidos em 21/09/2026 (chamado TI-000126).
const RELACIONAMENTO = { id: "6338a346-a8c9-4e76-b893-13f4439677da", slug: "relacionamento-direct" };
const COBRANCA = { id: "93c87d0f-eb8e-4e3c-a27a-010d047191e0", slug: "cobranca" };
const ATENDIMENTO = { id: "f515082e-ee16-4025-9d08-c1421f163766", slug: "atendimento" };

// "Primeiro contato", o assunto padrão do sistema, pertence à fila COBRANÇA.
const PRIMEIRO_CONTATO = { id: "assunto-primeiro-contato", queue_id: COBRANCA.id };

describe("a fila em que o atendimento nasce", () => {
  it("⚠️ a fila ESCOLHIDA na tela ganha do assunto padrão de outra fila", () => {
    // O caso do chamado: a pessoa escolhe Central de Relacionamento, que não tem assunto nenhum,
    // e o servidor caía no "Primeiro contato" da Cobrança — o atendimento nascia em Cobrança,
    // na outra central, e sumia da tela de quem o abriu.
    expect(filaDaAbertura(RELACIONAMENTO, COBRANCA, ATENDIMENTO)).toBe(RELACIONAMENTO);
  });

  it("sem fila escolhida, a fila do assunto decide", () => {
    // É como o Hades e o Apolo abrem: mandam o assunto, e a fila dele É a intenção.
    expect(filaDaAbertura(null, COBRANCA, ATENDIMENTO)).toBe(COBRANCA);
  });

  it("sem fila e sem assunto, sobra a fila padrão", () => {
    expect(filaDaAbertura(null, null, ATENDIMENTO)).toBe(ATENDIMENTO);
  });

  it("sem nada, não inventa fila", () => {
    expect(filaDaAbertura(null, null, null)).toBeNull();
  });
});

describe("o assunto que pode ser gravado", () => {
  it("⚠️ assunto de OUTRA fila é descartado: ele carrega SLA, prioridade e nome", () => {
    expect(assuntoParaAFila(PRIMEIRO_CONTATO, RELACIONAMENTO)).toBeNull();
  });

  it("assunto da própria fila fica", () => {
    expect(assuntoParaAFila(PRIMEIRO_CONTATO, COBRANCA)).toBe(PRIMEIRO_CONTATO);
  });

  it("assunto sem fila serve para qualquer uma", () => {
    const solto = { id: "assunto-solto", queue_id: null };
    expect(assuntoParaAFila(solto, RELACIONAMENTO)).toBe(solto);
  });

  it("sem assunto, nada a gravar", () => {
    expect(assuntoParaAFila(null, RELACIONAMENTO)).toBeNull();
    expect(assuntoParaAFila(undefined, RELACIONAMENTO)).toBeNull();
  });

  it("sem fila resolvida, o assunto passa como está", () => {
    expect(assuntoParaAFila(PRIMEIRO_CONTATO, null)).toBe(PRIMEIRO_CONTATO);
  });
});
