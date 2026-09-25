import { describe, expect, it } from "vitest";

import { acaoDeCancelamento, type SituacaoDaUnidade } from "./acao-de-cancelamento";

const base = { propostaDoLegado: false, propostaNativa: false };

describe("acaoDeCancelamento", () => {
  it("na reserva, cancela a reserva", () => {
    const a = acaoDeCancelamento({ ...base, etapa: "reservado" });
    expect(a.tipo).toBe("reserva");
    expect(a.rotulo).toBe("Cancelar reserva");
  });

  it("na proposta nativa, cancela a proposta", () => {
    const a = acaoDeCancelamento({ ...base, etapa: "proposta", propostaNativa: true });
    expect(a.tipo).toBe("proposta");
    expect(a.rotulo).toBe("Cancelar proposta");
  });

  // ⚠️ A PROPOSTA HERDADA DO C2X SE CANCELA AQUI (Lucas, 25/09/2026: *"essas reservas tem que
  // comportar iguais as outras"*). O caso antigo devolvia `tipo: null` com "o cancelamento dela é
  // feito lá": a premissa era que o Panteon não escreveria a mudança de volta no legado, e a carga
  // do C2X foi ENCERRADA em 21/09/2026. É a mesma revogação que o Lucas já tinha feito para o
  // contrato em 16/09/2026 (*"será feito aqui"*).
  it("⚠️ proposta do C2X se cancela AQUI, como a nativa, e o motivo não fala do legado", () => {
    const a = acaoDeCancelamento({ ...base, etapa: "proposta", propostaDoLegado: true });
    expect(a.tipo).toBe("proposta");
    expect(a.rotulo).toBe("Cancelar proposta");
    expect(a.motivo).not.toContain("C2X");
  });

  // ⚠️ A AÇÃO VEM DA ETAPA E DE ONDE A LINHA MORA, NUNCA DA COLUNA `origem`. As 11 herdadas em
  // `reservado` são linha de `hercules_propostas` e NÃO têm linha em `hercules_reservas` (medido em
  // 25/09/2026, projeto bxgukywoxgivlrhjkwjx, zero em 13/13): quem cancela é a rota da PROPOSTA. O
  // RÓTULO continua "Cancelar reserva", que é o que o coordenador lê na grade.
  it("⚠️ reservado herdado SEM reserva do Hércules: rota da proposta, rótulo de reserva", () => {
    const a = acaoDeCancelamento({
      ...base,
      etapa: "reservado",
      propostaDoLegado: true,
      reservaDoHercules: false,
    });
    expect(a.tipo).toBe("reserva_do_legado");
    expect(a.rotulo).toBe("Cancelar reserva");
    expect(a.motivo).not.toContain("C2X");
  });

  it("reservado COM reserva do Hércules continua na rota da reserva", () => {
    const a = acaoDeCancelamento({ ...base, etapa: "reservado", reservaDoHercules: true });
    expect(a.tipo).toBe("reserva");
    expect(a.rotulo).toBe("Cancelar reserva");
  });

  it("⚠️ na situação em_cancelamento, a ficha diz que o pedido JÁ EXISTE", () => {
    // Desde 21/09/2026 a régua troca a etapa por `em_cancelamento` na tela. Sem este caso a função
    // caía no fim e respondia "não há reserva nem proposta para cancelar" — sobre uma venda cujo
    // cancelamento está na fila do jurídico.
    const a = acaoDeCancelamento({ ...base, etapa: "em_cancelamento" });
    expect(a.tipo).toBeNull();
    expect(a.rotulo).toBe("Cancelamento pedido");
    expect(a.motivo).toContain("Têmis");
  });

  it("⚠️ depois do contrato, o que existe é PEDIDO — e o rótulo não promete desfazer", () => {
    // A venda em contrato não tinha saída nenhuma: os quatro botões apagados numa ficha que mostra
    // cliente, valor e plano. Quem despachou por engano ficava sem um botão sequer.
    const a = acaoDeCancelamento({ ...base, etapa: "contrato" });
    expect(a.tipo).toBe("pedido");
    expect(a.rotulo).toBe("Solicitar cancelamento");
    expect(a.motivo).toContain("Têmis");
    // A promessa que a modal repete: a etapa NÃO se mexe aqui.
    expect(a.motivo).toContain("continua na etapa");
  });

  it("assinatura e faturamento também têm a saída — é a mesma mão do jurídico", () => {
    for (const etapa of ["assinatura", "faturado"]) {
      expect(acaoDeCancelamento({ ...base, etapa }).tipo).toBe("pedido");
    }
  });

  it("⚠️ contrato que veio do C2X também abre pedido daqui (Lucas, 16/09/2026: \"será feito aqui\")", () => {
    // Antes ficava apagado com \"o cancelamento dele é feito lá\". A origem da venda não entra mais
    // na régua: o pedido abre o mesmo card na Têmis e o jurídico conclui pelo Panteon.
    const a = acaoDeCancelamento({ ...base, etapa: "assinatura" });
    expect(a.tipo).toBe("pedido");
    expect(a.motivo).not.toContain("C2X");
  });

  it("⚠️ um pedido por venda: o segundo clique não abre outro card", () => {
    const a = acaoDeCancelamento({
      ...base,
      etapa: "contrato",
      pedidoAberto: true,
    });
    expect(a.tipo).toBeNull();
    expect(a.rotulo).toBe("Cancelamento pedido");
    expect(a.motivo).toContain("Já existe");
  });

  it("⚠️ no lote vendido a frase não mente dizendo que não há o que cancelar", () => {
    // `vendida` são 114 unidades hoje, sem proposta viva que as sustente. "Não há reserva nem
    // proposta" manda o coordenador procurar defeito onde não há.
    const a = acaoDeCancelamento({ ...base, etapa: "vendida" });
    expect(a.tipo).toBeNull();
    expect(a.motivo).toContain("jurídico");
  });

  it("na unidade disponível não há nada a cancelar, e o botão diz isso", () => {
    const a = acaoDeCancelamento({ ...base, etapa: "disponivel" });
    expect(a.tipo).toBeNull();
    expect(a.motivo).toContain("Não há reserva nem proposta");
  });

  it("etapa ausente não quebra", () => {
    expect(acaoDeCancelamento({ ...base, etapa: null }).tipo).toBeNull();
  });

  it("nenhum motivo tem travessão", () => {
    const casos: SituacaoDaUnidade[] = [
      { ...base, etapa: "reservado" },
      { ...base, etapa: "reservado", propostaDoLegado: true, reservaDoHercules: false },
      { ...base, etapa: "proposta", propostaNativa: true },
      { ...base, etapa: "proposta", propostaDoLegado: true },
      { ...base, etapa: "contrato" },
      { ...base, etapa: "contrato", pedidoAberto: true },
      { ...base, etapa: "em_cancelamento" },
      { ...base, etapa: "vendida" },
      { ...base, etapa: "disponivel" },
    ];
    for (const caso of casos) expect(acaoDeCancelamento(caso).motivo).not.toContain("—");
  });
});
