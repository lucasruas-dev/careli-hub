import { describe, expect, it } from "vitest";

import {
  deveFecharPorSemInteracao,
  ehDaCaca,
  MOTIVO_SEM_INTERACAO_CACA,
} from "./fechar-sem-interacao";

// Este codigo fecha atendimento em massa: cada caso abaixo e' um jeito de fechar errado.
const LIMITE = "2026-07-24T08:00:00.000Z"; // agora - 4h

const daCaca = {
  created_at: "2026-07-24T03:00:00.000Z",
  direction: "outbound",
  sender_type: "operator",
  sender_user_id: null,
  ticket_id: "3494013a-33cd-4d1f-a1a7-cc6297ccf5ec",
};

describe("ehDaCaca", () => {
  it("reconhece a CACA: sai como operador, mas sem usuario do hub", () => {
    expect(ehDaCaca(daCaca)).toBe(true);
  });

  it("nao confunde com operador humano (tem sender_user_id)", () => {
    expect(
      ehDaCaca({ ...daCaca, sender_user_id: "8f1c1e2a-0000-0000-0000-000000000000" }),
    ).toBe(false);
  });

  it("nao confunde com mensagem do cliente", () => {
    expect(
      ehDaCaca({ ...daCaca, direction: "inbound", sender_type: "contact" }),
    ).toBe(false);
  });
});

describe("deveFecharPorSemInteracao", () => {
  it("fecha quando a CACA falou por ultimo e passou da janela", () => {
    expect(deveFecharPorSemInteracao(daCaca, LIMITE)).toBe(true);
  });

  it("NAO fecha quando a CACA respondeu ha pouco (dentro da janela)", () => {
    expect(
      deveFecharPorSemInteracao(
        { ...daCaca, created_at: "2026-07-24T11:30:00.000Z" },
        LIMITE,
      ),
    ).toBe(false);
  });

  it("NAO fecha quem esta esperando resposta: ultima mensagem e' do cliente", () => {
    expect(
      deveFecharPorSemInteracao(
        { ...daCaca, direction: "inbound", sender_type: "contact" },
        LIMITE,
      ),
    ).toBe(false);
  });

  it("NAO fecha atendimento humano parado (isso e' fila do time, nao lixo)", () => {
    expect(
      deveFecharPorSemInteracao(
        { ...daCaca, sender_user_id: "8f1c1e2a-0000-0000-0000-000000000000" },
        LIMITE,
      ),
    ).toBe(false);
  });

  it("NAO fecha ticket sem mensagem nenhuma", () => {
    expect(deveFecharPorSemInteracao(undefined, LIMITE)).toBe(false);
    expect(deveFecharPorSemInteracao({ ...daCaca, created_at: null }, LIMITE)).toBe(
      false,
    );
  });
});

describe("motivo de encerramento", () => {
  it("e' o texto que o Lucas definiu, separado do 'Sem Interacao' manual", () => {
    expect(MOTIVO_SEM_INTERACAO_CACA).toBe("Sem interação - Assistente Virtual");
  });
});
