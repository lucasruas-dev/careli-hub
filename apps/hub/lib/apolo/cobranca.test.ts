import { afterEach, describe, expect, it, vi } from "vitest";

import { buildFunnel } from "./cobranca";

// O QUE ESTE TESTE TRAVA: o significado da janela de "Recuperado (30d)".
//
// ⚠️ A COLUNA MUDOU DE SENTIDO EM 24/09/2026. Até aqui `paid_at` era "quando o cron percebeu", e
// toda baixa detectada caía dentro da janela por construção. Agora é "quando o cliente pagou" (a
// `payment_date` do C2X), por causa do apontamento da Nívea. A defasagem medida entre pagar e
// conciliar foi de 44 e 49 dias nas 3 únicas baixas do sistema, então a parcela conciliada hoje e
// paga há 44 dias NÃO entra mais — o número do painel do gestor e o do painel do incorporador caem
// no mesmo dia, e é por isso que isto está escrito num teste e não só num comentário.

const HOJE = new Date("2026-09-24T12:00:00.000Z");

const parcela = (paidAt: string) => ({
  amount: "599.25",
  compromisso_id: "c-1",
  paid_at: paidAt,
  status: "paga",
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Recuperado (30d) do painel de cobrança", () => {
  it("parcela paga há 44 dias e conciliada hoje NÃO entra na janela", () => {
    vi.useFakeTimers();
    vi.setSystemTime(HOJE);

    // 13/07/2026: o caso medido da PR-000006 (DÉBORA SANTANA VIANA, VALE08).
    const funil = buildFunnel([], [parcela("2026-07-13T12:00:00.000Z")]);

    expect(funil.recuperado30d).toEqual({ count: 0, value: 0 });
  });

  it("parcela paga dentro dos 30 dias entra", () => {
    vi.useFakeTimers();
    vi.setSystemTime(HOJE);

    const funil = buildFunnel([], [parcela("2026-09-10T12:00:00.000Z")]);

    expect(funil.recuperado30d).toEqual({ count: 1, value: 599.25 });
  });

  it("parcela paga sem data nenhuma nunca entra na janela", () => {
    vi.useFakeTimers();
    vi.setSystemTime(HOJE);

    const funil = buildFunnel(
      [],
      [{ amount: "599.25", compromisso_id: "c-1", paid_at: null, status: "paga" }],
    );

    expect(funil.recuperado30d).toEqual({ count: 0, value: 0 });
  });
});
