import { describe, expect, it } from "vitest";

import { lerEventoDoWebhook } from "./clicksign/webhook";
import { aplicarEventoDaClicksign } from "./estado-db";

// ⚠️ O QUE ESTE TESTE PROTEGE. Provedor reenvia evento quando não recebe 200, e os reenvios chegam
// FORA DE ORDEM. Sem as guardas daqui, um `sign` atrasado entregue depois do `auto_close` poria um
// contrato ASSINADO de volta em "parcialmente assinado" — e a Têmis mandaria alguém cobrar uma
// assinatura que já existe.

type Escrita = { payload: unknown; tabela: string };

function clienteFalso(
  envelope: null | Record<string, unknown>,
  escritas: Escrita[],
  // O card da Têmis daquela proposta. `null` = proposta sem card (envelope nascido fora do quadro).
  card: null | Record<string, unknown> = { id: "card-1", tipo: "contrato" },
) {
  const from = (tabela: string) => {
    const enc: Record<string, unknown> = {};
    for (const metodo of ["select", "eq", "neq", "order", "limit"]) enc[metodo] = () => enc;
    enc.update = (payload: unknown) => {
      escritas.push({ payload, tabela });
      return enc;
    };
    enc.maybeSingle = () =>
      Promise.resolve({
        data:
          tabela === "temis_envelopes"
            ? envelope
            : tabela === "temis_trabalhos"
              ? card
              : null,
        error: null,
      });
    enc.then = (aceitar: (r: unknown) => unknown) => Promise.resolve(aceitar({ data: null, error: null }));
    return enc;
  };
  return { from } as never;
}

const evento = (nome: string) =>
  lerEventoDoWebhook(JSON.stringify({ document: { id: "doc_1" }, event: { name: nome } }));

const AGUARDANDO = { estado: "aguardando", id: "reg-1", proposta_id: "prop-1" };

describe("o evento vira estado", () => {
  it("uma assinatura leva o envelope para parcial", async () => {
    const escritas: Escrita[] = [];
    const r = await aplicarEventoDaClicksign(clienteFalso(AGUARDANDO, escritas), evento("sign"));

    expect(r.aplicado).toBe(true);
    expect(r.estado).toBe("parcial");
    expect((escritas[0]?.payload as { estado: string }).estado).toBe("parcial");
  });

  // ⚠️ `sign` É UMA PESSOA, e não o fim. Mover o card a cada assinatura diria "finalizado" com
  // metade das assinaturas — e o board pisca a cada evento de bastidor.
  it("uma assinatura NÃO move o card da Têmis", async () => {
    const escritas: Escrita[] = [];
    await aplicarEventoDaClicksign(clienteFalso(AGUARDANDO, escritas), evento("sign"));
    expect(escritas.map((e) => e.tabela)).not.toContain("temis_trabalhos");
  });

  // ⚠️ CONTRATO ASSINADO NÃO É CONTRATO PRONTO, e esta é a mudança de 10/09/2026. Antes o card ia
  // direto para "finalizado"; agora assinar fecha a etapa 3, e sobram duas condições que a
  // Clicksign não conhece: os 7 dias de arrependimento e a entrada paga.
  it("o fechamento leva a assinado e manda o CONTRATO para o prazo legal", async () => {
    const escritas: Escrita[] = [];
    const r = await aplicarEventoDaClicksign(
      clienteFalso({ ...AGUARDANDO, estado: "parcial" }, escritas),
      evento("auto_close"),
    );

    expect(r.estado).toBe("assinado");
    const card = escritas.find((e) => e.tabela === "temis_trabalhos")?.payload as {
      arrependimento_inicio?: string;
      estagio: string;
    };
    expect(card.estagio).toBe("prazo_legal");
    // ⚠️ E A CONTAGEM DOS 7 DIAS NASCE AQUI. Sem este carimbo a etapa 4 não teria de quando
    // contar, e o prazo do comprador ficaria indefinido.
    expect(card.arrependimento_inicio).toBeTruthy();

    // O carimbo de fechamento entra junto com o estado terminal.
    const envelope = escritas.find((e) => e.tabela === "temis_envelopes")?.payload as {
      fechado_em?: string;
    };
    expect(envelope.fechado_em).toBeTruthy();
  });

  // ⚠️ CESSÃO, DISTRATO E CANCELAMENTO TÊM CAMINHO PRÓPRIO (Lucas, 10/09/2026: *"Caminho próprio,
  // mais curto"*): não há arrependimento nem entrada, então assinar já conclui.
  it("cessão e distrato vão direto para o fim, sem prazo legal", async () => {
    for (const tipo of ["cessao", "distrato", "cancelamento_correcao"]) {
      const escritas: Escrita[] = [];
      await aplicarEventoDaClicksign(
        clienteFalso({ ...AGUARDANDO, estado: "parcial" }, escritas, { id: "card-1", tipo }),
        evento("auto_close"),
      );

      const card = escritas.find((e) => e.tabela === "temis_trabalhos")?.payload as {
        arrependimento_inicio?: string;
        estagio: string;
      };
      expect(card.estagio, tipo).toBe("faturado");
      // Sem prazo legal, não há contagem para começar.
      expect(card.arrependimento_inicio, tipo).toBeUndefined();
    }
  });

  // Envelope que nasceu fora do quadro não tem card — e isso não é erro nem escrita.
  it("proposta sem card na Têmis não vira escrita", async () => {
    const escritas: Escrita[] = [];
    const r = await aplicarEventoDaClicksign(
      clienteFalso({ ...AGUARDANDO, estado: "parcial" }, escritas, null),
      evento("auto_close"),
    );

    expect(r.estado).toBe("assinado");
    expect(escritas.map((e) => e.tabela)).not.toContain("temis_trabalhos");
  });

  // ⚠️ ESTADO TERMINAL NÃO REGRIDE — a proteção que falta na maioria das integrações de webhook.
  it("um `sign` atrasado NÃO tira o contrato de assinado", async () => {
    const escritas: Escrita[] = [];
    const r = await aplicarEventoDaClicksign(
      clienteFalso({ ...AGUARDANDO, estado: "assinado" }, escritas),
      evento("sign"),
    );

    expect(r.aplicado).toBe(false);
    expect(r.estado).toBe("assinado");
    expect(escritas).toHaveLength(0);
  });

  it("um `sign` atrasado NÃO tira o contrato de recusado", async () => {
    const escritas: Escrita[] = [];
    const r = await aplicarEventoDaClicksign(
      clienteFalso({ ...AGUARDANDO, estado: "recusado" }, escritas),
      evento("sign"),
    );
    expect(r.aplicado).toBe(false);
    expect(escritas).toHaveLength(0);
  });

  // ⚠️ A MAIORIA DOS ~30 EVENTOS É DE BASTIDOR (`upload`, `add_signer`, as falhas de autenticação do
  // signatário). Registrar sim; mover o card, não.
  it("evento de bastidor não move nada", async () => {
    const escritas: Escrita[] = [];
    const r = await aplicarEventoDaClicksign(clienteFalso(AGUARDANDO, escritas), evento("add_signer"));
    expect(r.aplicado).toBe(false);
    expect(escritas).toHaveLength(0);
  });

  it("envelope desconhecido não vira erro nem escrita", async () => {
    const escritas: Escrita[] = [];
    const r = await aplicarEventoDaClicksign(clienteFalso(null, escritas), evento("sign"));
    expect(r.aplicado).toBe(false);
    expect(r.motivo).toContain("não achei");
    expect(escritas).toHaveLength(0);
  });

  // ⚠️ `deadline` VIRA `expirado`, E NÃO `cancelado`, mesmo que a Clicksign cancele por baixo: para
  // a operação, "perdemos o prazo" pede uma ação diferente de "alguém desistiu".
  it("prazo vencido é expirado, e não cancelado", async () => {
    const escritas: Escrita[] = [];
    const r = await aplicarEventoDaClicksign(clienteFalso(AGUARDANDO, escritas), evento("deadline"));
    expect(r.estado).toBe("expirado");
  });
});
