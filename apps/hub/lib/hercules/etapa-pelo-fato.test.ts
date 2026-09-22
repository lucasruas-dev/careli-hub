import { describe, expect, it } from "vitest";

import { etapaPeloFato } from "./etapa-pelo-fato";

// Lucas, 21/09/2026: *"esse foi faturado no dia 17"* e *"se tem no panteon tinha que está
// refletindo aqui. porque não está?"*.
//
// Os três casos são reais e foram medidos nos dois bancos: VOC0719 (Erilene), VOC0607 (Adilson) e
// VOC0501 (Natanael) faturaram em 17/09/2026 (estágio 4 no C2X) e a tela do Panteon mostrava
// "Em assinatura", porque o rótulo `etapa_c2x` parou em 5 quando a linha deixou de ser recarregada.
const HOJE = new Date(2026, 8, 21);

describe("a etapa segue o fato", () => {
  it("assinatura com faturamento no passado é faturado", () => {
    expect(etapaPeloFato("assinatura", "2026-09-17", HOJE)).toBe("faturado");
  });

  it("vale para qualquer passo anterior do caminho", () => {
    expect(etapaPeloFato("contrato", "2024-12-23", HOJE)).toBe("faturado");
    expect(etapaPeloFato("proposta", "2025-09-22", HOJE)).toBe("faturado");
    expect(etapaPeloFato("reservado", "2026-01-10", HOJE)).toBe("faturado");
  });

  it("faturado no próprio dia já conta", () => {
    expect(etapaPeloFato("assinatura", "2026-09-21", HOJE)).toBe("faturado");
  });

  // ⚠️ AGENDADO NÃO É FATURADO. Antecipar na tela faria o coordenador tratar como fechada uma venda
  // que ainda não faturou, que é o oposto do que esta régua existe para consertar.
  it("faturamento marcado para o futuro NÃO promove", () => {
    expect(etapaPeloFato("assinatura", "2026-09-22", HOJE)).toBe("assinatura");
    expect(etapaPeloFato("assinatura", "2026-12-01", HOJE)).toBe("assinatura");
  });

  it("sem data, nada muda", () => {
    expect(etapaPeloFato("assinatura", null, HOJE)).toBe("assinatura");
    expect(etapaPeloFato("assinatura", undefined, HOJE)).toBe("assinatura");
    expect(etapaPeloFato("assinatura", "  ", HOJE)).toBe("assinatura");
    expect(etapaPeloFato("assinatura", "data-torta", HOJE)).toBe("assinatura");
  });

  // ⚠️ VENDA DESFEITA NÃO VOLTA A FATURAR. As duas guardam a data do faturamento que existiu antes
  // do cancelamento; promovê-las ressuscitaria a venda na tela e prenderia o lote.
  it("cancelado e distrato ficam onde estão, mesmo com data antiga", () => {
    expect(etapaPeloFato("cancelado", "2026-09-17", HOJE)).toBe("cancelado");
    expect(etapaPeloFato("distrato", "2026-09-17", HOJE)).toBe("distrato");
  });

  it("quem já está faturado continua faturado", () => {
    expect(etapaPeloFato("faturado", "2026-09-17", HOJE)).toBe("faturado");
    expect(etapaPeloFato("faturado", null, HOJE)).toBe("faturado");
  });

  // O fuso é a armadilha clássica aqui: `new Date("2026-09-21")` nasce em UTC e, no horário de
  // Brasília, viraria o dia 20. A comparação é de texto para não depender disso.
  it("a data de hoje não escorrega por fuso", () => {
    const meiaNoiteEMeia = new Date(2026, 8, 21, 0, 30);
    expect(etapaPeloFato("assinatura", "2026-09-21", meiaNoiteEMeia)).toBe("faturado");
  });
});
