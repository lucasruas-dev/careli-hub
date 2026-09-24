import { afterEach, describe, expect, it, vi } from "vitest";

import {
  etapaDoCompromisso,
  linhasDaEtapaDoDetalhe,
  type LinhaDaEtapa,
} from "./etapa-do-compromisso";

// O QUE ESTES TESTES TRAVAM (Nívea, 24/09/2026): *"Erro no processo. O comprador fez promessa e
// não pagou. Deve voltar para o status de acionar."* Medido no mesmo dia em
// `guardian_compromissos`: 59 compromissos, `broken_at` NULO em 59, `status='quebrado'` em 0, e 3
// promessas ativas com `promised_date` já passada (a mais antiga 18/09, a do Vitorino Energy),
// somando R$ 7.825,27 — todas escritas na tela como "Promessa de pagamento / Aguardar a data
// prometida (régua de lembretes)".
//
// A etapa é DERIVADA, e não gravada: aqui não há banco, não há rotina e não há acusação de calote.

const linha = (patch: Partial<LinhaDaEtapa> = {}): LinhaDaEtapa => ({
  approvalStatus: "aprovado",
  approvedAt: "2026-09-05T12:00:00.000Z",
  kind: "promessa",
  promisedDate: "2026-09-30",
  status: "ativo",
  ...patch,
});

const HOJE = "2026-09-24";

describe("etapaDoCompromisso", () => {
  it("promessa aprovada com data prometida de ONTEM e sem baixa devolve A acionar", () => {
    const etapa = etapaDoCompromisso([linha({ promisedDate: "2026-09-23" })], HOJE);

    expect(etapa?.stage).toBe("A acionar");
    expect(etapa?.nextAction).toContain("23/09");
    expect(etapa?.nextAction).toContain("Confirmar o pagamento no C2X");
  });

  it("promessa aprovada com data prometida de AMANHÃ continua Promessa de pagamento", () => {
    const etapa = etapaDoCompromisso([linha({ promisedDate: "2026-09-25" })], HOJE);

    expect(etapa?.stage).toBe("Promessa de pagamento");
  });

  it("a data prometida de HOJE ainda é promessa: o dia não venceu", () => {
    const etapa = etapaDoCompromisso([linha({ promisedDate: HOJE })], HOJE);

    expect(etapa?.stage).toBe("Promessa de pagamento");
  });

  it("promessa vencida sem approved_at não promete régua de lembretes na próxima ação", () => {
    const vencida = etapaDoCompromisso(
      [linha({ approvedAt: null, promisedDate: "2026-09-18" })],
      HOJE,
    );
    const emDia = etapaDoCompromisso(
      [linha({ approvedAt: null, promisedDate: "2026-09-30" })],
      HOJE,
    );

    expect(vencida?.nextAction).not.toContain("régua");
    // ⚠️ E NEM NA PROMESSA EM DIA: sem `approved_at` a régua nunca dispara (a trava de
    // `podeDispararLembrete` exige o carimbo), então prometer régua é prometer o que não vem.
    expect(emDia?.stage).toBe("Promessa de pagamento");
    expect(emDia?.nextAction).not.toContain("régua");
  });

  it("promessa em dia COM approved_at continua mandando aguardar a régua", () => {
    const etapa = etapaDoCompromisso([linha({ promisedDate: "2026-09-30" })], HOJE);

    expect(etapa?.nextAction).toContain("régua");
  });

  it("acordo aprovado vence a promessa vencida do mesmo cliente (a ordem dos ramos não muda)", () => {
    const etapa = etapaDoCompromisso(
      [
        linha({ promisedDate: "2026-09-18" }),
        linha({ kind: "acordo", promisedDate: null }),
      ],
      HOJE,
    );

    expect(etapa?.stage).toBe("Acordo");
  });

  it("uma promessa viva no meio das vencidas segura a etapa em Promessa de pagamento", () => {
    const etapa = etapaDoCompromisso(
      [
        linha({ promisedDate: "2026-09-18" }),
        linha({ promisedDate: "2026-10-02" }),
      ],
      HOJE,
    );

    expect(etapa?.stage).toBe("Promessa de pagamento");
  });

  it("promessa vencida mas JÁ CUMPRIDA não aciona ninguém", () => {
    const etapa = etapaDoCompromisso(
      [linha({ promisedDate: "2026-09-18", status: "cumprido" })],
      HOJE,
    );

    expect(etapa?.stage).not.toBe("A acionar");
  });

  it("promessa aprovada SEM data prometida não vira A acionar (não há fato para afirmar)", () => {
    const etapa = etapaDoCompromisso([linha({ promisedDate: null })], HOJE);

    expect(etapa?.stage).toBe("Promessa de pagamento");
  });

  // ⚠️ E A PROMESSA SEM DATA NÃO SEGURA A ETAPA DO IRMÃO VENCIDO. A conta era
  // `aprovadas.length > vencidas.length`, e por ela a linha sem prazo contava como viva: o cliente
  // com uma promessa vencida ao lado ficava preso em "Promessa de pagamento / Aguardar a data
  // prometida" para sempre, que é o defeito da Nívea intacto. Medido em 24/09/2026: 0 promessas
  // ativas sem data, então isto é risco futuro, e o campo é opcional.
  it("promessa sem data não segura a etapa de uma promessa vencida do mesmo cliente", () => {
    const etapa = etapaDoCompromisso(
      [linha({ promisedDate: "2026-09-18" }), linha({ promisedDate: null })],
      HOJE,
    );

    expect(etapa?.stage).toBe("A acionar");
    expect(etapa?.nextAction).toContain("18/09");
  });

  // Medido em 24/09/2026 (select protocol, promised_date, approved_at, client_c2x_id from
  // guardian_compromissos where kind='promessa' and status='ativo' and approval_status='aprovado'
  // and promised_date < current_date): PR-000015, cliente 3954 = Vitorino Energy Ltda (Veredas do
  // Ouro), prometeu 18/09 e foi aprovado em 14/09 11:15 UTC.
  it("o caso PR-000015 (Vitorino, prometeu 18/09, lido em 24/09) não devolve Promessa de pagamento", () => {
    const etapa = etapaDoCompromisso(
      [
        {
          approvalStatus: "aprovado",
          approvedAt: "2026-09-14T11:15:31.175Z",
          kind: "promessa",
          promisedDate: "2026-09-18",
          status: "ativo",
        },
      ],
      HOJE,
    );

    expect(etapa?.stage).toBe("A acionar");
    expect(etapa?.nextAction).not.toContain("Aguardar a data prometida");
    expect(etapa?.nextAction).toContain("18/09");
  });

  // ⚠️ E A TERCEIRA VENCIDA É A QUE NUNCA TEVE CARIMBO. Medida no mesmo select: PR-000058, cliente
  // 3029 (Cristina Guimarães Pinto, Lavra do Ouro), prometeu 22/09 com `approved_at` NULO — a
  // promessa que a régua nunca chamaria, e para quem a frase antiga mandava esperar régua.
  it("o caso PR-000058 (approved_at nulo, prometeu 22/09) também volta a acionar", () => {
    const etapa = etapaDoCompromisso(
      [
        {
          approvalStatus: "aprovado",
          approvedAt: null,
          kind: "promessa",
          promisedDate: "2026-09-22",
          status: "ativo",
        },
      ],
      HOJE,
    );

    expect(etapa?.stage).toBe("A acionar");
    expect(etapa?.nextAction).toContain("22/09");
    expect(etapa?.nextAction).not.toContain("régua");
  });

  it("os ramos antigos continuam onde estavam: pendente vira Negociação, quebrado vira Quebra", () => {
    const pendente = etapaDoCompromisso(
      [linha({ approvalStatus: "pendente", approvedAt: null })],
      HOJE,
    );
    const quebrado = etapaDoCompromisso(
      [linha({ approvalStatus: "aprovado", status: "quebrado" })],
      HOJE,
    );

    expect(pendente?.stage).toBe("Negociação");
    expect(quebrado?.stage).toBe("Quebra");
  });

  it("sem linha nenhuma não há etapa", () => {
    expect(etapaDoCompromisso([], HOJE)).toBeNull();
  });
});

// ⚠️ O CAMINHO DE PRODUÇÃO É O QUE NÃO PASSA `hoje`. Os casos acima fixam o dia na entrada, que é
// exatamente o ponto em que o defeito nascia: a fila (`compromissos.ts`) e o detalhe
// (`ClientDetailPanel.tsx`) chamam a peça SEM o segundo parâmetro, e o default é o único "hoje"
// que roda de verdade. Enquanto ele era `toISOString()`, das 21h à meia-noite de Brasília a
// promessa que vence HOJE era lida como vencida — todo dia, três horas por dia.
describe("o hoje do default (o único que roda em produção)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("às 23h30 de Brasília a promessa que vence HOJE ainda é Promessa de pagamento", () => {
    vi.useFakeTimers();
    // 2026-09-24 23h30 em São Paulo = 2026-09-25 02h30 UTC.
    vi.setSystemTime(new Date("2026-09-25T02:30:00.000Z"));

    const etapa = etapaDoCompromisso([linha({ promisedDate: "2026-09-24" })]);

    expect(etapa?.stage).toBe("Promessa de pagamento");
  });

  it("no dia seguinte, já em Brasília, a mesma promessa volta a acionar", () => {
    vi.useFakeTimers();
    // 2026-09-25 09h00 em São Paulo = 12h00 UTC.
    vi.setSystemTime(new Date("2026-09-25T12:00:00.000Z"));

    const etapa = etapaDoCompromisso([linha({ promisedDate: "2026-09-24" })]);

    expect(etapa?.stage).toBe("A acionar");
    expect(etapa?.nextAction).toContain("24/09");
  });
});

// ⚠️ O `map` DO DETALHE SAIU DO `@ts-nocheck` PARA PODER SER TESTADO. `ClientDetailPanel.tsx` tem
// `// @ts-nocheck` na linha 2: um campo trocado ali passaria pelo `tsc` calado e a etapa do
// detalhe voltaria a divergir da fila.
describe("linhasDaEtapaDoDetalhe", () => {
  it("leva promisedDate e approvedAt adiante (é por eles que a promessa vence)", () => {
    const linhas = linhasDaEtapaDoDetalhe([
      {
        approvalStatus: "aprovado",
        approvedAt: "2026-09-14T11:15:31.175Z",
        kind: "promessa",
        promisedDate: "2026-09-18",
        status: "ativo",
      },
    ]);

    expect(linhas[0]).toEqual<LinhaDaEtapa>({
      approvalStatus: "aprovado",
      approvedAt: "2026-09-14T11:15:31.175Z",
      kind: "promessa",
      promisedDate: "2026-09-18",
      status: "ativo",
    });
    expect(etapaDoCompromisso(linhas, HOJE)?.stage).toBe("A acionar");
  });

  it("campo ausente vira nulo, e não `undefined` solto", () => {
    expect(linhasDaEtapaDoDetalhe([{}])[0]).toEqual<LinhaDaEtapa>({
      approvalStatus: null,
      approvedAt: null,
      kind: "",
      promisedDate: null,
      status: "",
    });
  });
});
