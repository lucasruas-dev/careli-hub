import { describe, expect, it } from "vitest";

import { diaNaTela } from "../apolo/incorporador/dia-na-tela";
import {
  dataDaBaixa,
  isParcelaPaid,
  pagamentosDoC2x,
  type PagamentoDoC2x,
} from "./regua-cron";

// O QUE ESTES TESTES TRAVAM (Nívea, 24/09/2026): *"O Hades está apresentando uma informação que
// não procede."* A coluna "Pagamento" da Central de Propostas mostrava a hora em que o CRON
// percebeu a baixa, e não a data em que o cliente pagou — `markParcelaPaid` gravava `new Date()`
// enquanto a `payment_date` do C2X passava pela mão do código e era jogada fora.
//
// Medido em 24/09/2026 (as 3 únicas parcelas pagas do sistema inteiro): PR-000006 (DÉBORA SANTANA
// VIANA, VALE08) pagou em 13/07/2026 e a tela dizia 26/08/2026 (44 dias); PR-000008 (JOSÉ ARNALDO
// DE MOURA, REPD132) pagou em 08/07/2026 e a tela dizia 26/08/2026 (49 dias).

const parcela = (patch: Partial<Parametros> = {}): Parametros => ({
  payment_c2x_id: 5001,
  status: "pendente",
  ...patch,
});

type Parametros = Parameters<typeof isParcelaPaid>[0];

const AGORA = new Date("2026-08-26T12:00:00.000Z");

describe("pagamentosDoC2x", () => {
  it("guarda a DATA do pagamento, e não só o sim ou não", () => {
    const mapa = pagamentosDoC2x([
      { id: 5001, payment_date: "2026-07-13", payment_status_id: 5 },
    ]);

    expect(mapa.get(5001)).toEqual<PagamentoDoC2x>({
      pago: true,
      pagoEm: "2026-07-13T12:00:00.000Z",
    });
  });

  it("a data vinda do mysql como Date não escorrega de dia", () => {
    // mysql2 devolve coluna DATE como `Date` na meia-noite LOCAL. Converter com `toISOString()`
    // direto empurraria o dia para trás em fuso a leste de Greenwich.
    const mapa = pagamentosDoC2x([
      { id: 5002, payment_date: new Date(2026, 6, 13, 0, 0, 0), payment_status_id: 5 },
    ]);

    expect(mapa.get(5002)?.pagoEm).toBe("2026-07-13T12:00:00.000Z");
  });

  it("liquidada por status, sem data, é paga e sem data", () => {
    const mapa = pagamentosDoC2x([{ id: 5003, payment_date: null, payment_status_id: 5 }]);

    expect(mapa.get(5003)).toEqual<PagamentoDoC2x>({ pago: true, pagoEm: null });
  });

  it("em aberto no C2X não é paga", () => {
    const mapa = pagamentosDoC2x([{ id: 5004, payment_date: null, payment_status_id: 1 }]);

    expect(mapa.get(5004)?.pago).toBe(false);
  });
});

describe("dataDaBaixa", () => {
  it("parcela paga no C2X em 13/07 grava paid_at 13/07, e não a hora da rodada", () => {
    const mapa = pagamentosDoC2x([
      { id: 5001, payment_date: "2026-07-13", payment_status_id: 5 },
    ]);

    expect(dataDaBaixa(parcela(), mapa, AGORA)).toBe("2026-07-13T12:00:00.000Z");
  });

  // ⚠️ ESTE É O TESTE QUE OLHA A TELA, E NÃO A STRING. Travar só a ISO deixava passar verde o dia
  // ERRADO: `paid_at` é `timestamptz` e a coluna "Pagamento" formata no fuso do navegador da
  // Nívea, então `2026-07-13T00:00:00.000Z` imprimiria 12/07/2026 em São Paulo. A pergunta do
  // apontamento é o que a operadora LÊ, e é ela que este teste faz.
  it("o que a coluna Pagamento IMPRIME para quem pagou em 13/07 é 13/07, não 12/07", () => {
    const mapa = pagamentosDoC2x([
      { id: 5001, payment_date: "2026-07-13", payment_status_id: 5 },
    ]);

    const gravado = dataDaBaixa(parcela(), mapa, AGORA);

    // A mesma função que a tela usa (`formatDateOnly` delega para `diaNaTela`).
    expect(diaNaTela(gravado, "—")).toBe("13/07/2026");
    // E o caminho cru de um navegador em São Paulo também tem de acertar o dia.
    expect(
      new Date(gravado).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    ).toBe("13/07/2026");
  });

  // ⚠️ O PIOR CASO É O CLIENTE QUE PAGA NO DIA DO VENCIMENTO: com meia-noite UTC a tela imprimia o
  // dia anterior e a promessa parecia paga ANTES de existir.
  it("pagamento no próprio dia do vencimento não aparece um dia antes", () => {
    const mapa = pagamentosDoC2x([
      { id: 5001, payment_date: "2026-07-20", payment_status_id: 5 },
    ]);

    expect(diaNaTela(dataDaBaixa(parcela(), mapa, AGORA), "—")).toBe("20/07/2026");
  });

  // ⚠️ E AS 3 LINHAS JÁ GRAVADAS CONTINUAM SENDO INSTANTES (12:00 UTC, medido em 24/09/2026): a
  // tela tem de continuar acertando o dia delas também.
  it("a baixa antiga, gravada como instante das 12:00 UTC, segue imprimindo o dia certo", () => {
    expect(diaNaTela("2026-08-26T12:00:04.929Z", "—")).toBe("26/08/2026");
  });

  it("parcela paga por payment_status_id com payment_date nulo cai para a hora da rodada", () => {
    const mapa = pagamentosDoC2x([{ id: 5001, payment_date: null, payment_status_id: 5 }]);

    expect(dataDaBaixa(parcela(), mapa, AGORA)).toBe(AGORA.toISOString());
  });

  it("parcela sem payment_c2x_id cai para a hora da rodada", () => {
    expect(dataDaBaixa(parcela({ payment_c2x_id: null }), new Map(), AGORA)).toBe(
      AGORA.toISOString(),
    );
  });
});

describe("isParcelaPaid", () => {
  it("parcela sem payment_c2x_id continua sem baixa (a cegueira medida não muda neste item)", () => {
    // Medido em 24/09/2026: 394 de 397 parcelas em aberto estão sem `payment_c2x_id`, e é por ele
    // que a conciliação filtra. Enquanto isso o sistema não sabe dizer se a promessa foi paga.
    expect(isParcelaPaid(parcela({ payment_c2x_id: null }), new Map())).toBe(false);
  });

  it("parcela já marcada paga no motor não volta a perguntar ao C2X", () => {
    expect(isParcelaPaid(parcela({ status: "paga" }), new Map())).toBe(true);
  });

  it("parcela liquidada no C2X é paga", () => {
    const mapa = pagamentosDoC2x([
      { id: 5001, payment_date: "2026-07-13", payment_status_id: 5 },
    ]);

    expect(isParcelaPaid(parcela(), mapa)).toBe(true);
  });
});
