import { describe, expect, it } from "vitest";

import { avisoDoHercules, etapaDaVendaParaOCard } from "./reflexo-da-temis";

// A TABELA DE TRADUÇÃO DO CARD DA TÊMIS PARA A VENDA DO HÉRCULES — uma linha por movimento.
//
// Lucas, 24/09/2026: *"preciso garantir que tudo que acontece na temis reflete no hercules, pode
// corrigir isso, o contrato da vitoria tem que estar em assinatura"*. Medido em 24/09/2026: os 5
// cards de contrato enviados para assinatura em 23/09 deixaram a venda em `contrato` (5 de 5).

describe("o card de CONTRATO leva a venda", () => {
  it("envio para assinatura: a venda vai de contrato para assinatura (o caso da Vitória)", () => {
    expect(etapaDaVendaParaOCard("contrato", "contrato", "assinatura")).toEqual({
      destino: "assinatura",
      origensAceitas: ["contrato"],
    });
  });

  it.each(["assinatura", "prazo_legal"])(
    "volta para correção a partir de %s: a venda volta de assinatura para contrato",
    (de) => {
      expect(etapaDaVendaParaOCard("contrato", de, "analise")).toEqual({
        destino: "contrato",
        origensAceitas: ["assinatura"],
      });
    },
  );

  it("volta para correção a partir de Contrato: a venda já está em contrato, e não sai de assinatura por aqui", () => {
    expect(etapaDaVendaParaOCard("contrato", "contrato", "analise")).toEqual({
      destino: "contrato",
      origensAceitas: [],
    });
  });

  it("Gerar contrato (análise para contrato): a venda já está em contrato, nunca sai de assinatura", () => {
    expect(etapaDaVendaParaOCard("contrato", "analise", "contrato")).toEqual({
      destino: "contrato",
      origensAceitas: [],
    });
  });

  it.each(["assinatura", "prazo_legal"])(
    "card de %s para Contrato (o Gerar atrasado): a venda NUNCA volta de assinatura por este passo",
    (de) => {
      // O único caminho de volta é a volta para correção, que vai para a Análise e mata o envelope.
      expect(etapaDaVendaParaOCard("contrato", de, "contrato")?.origensAceitas ?? []).not.toContain("assinatura");
    },
  );

  it("assinado por todos (Pré-faturamento): a venda FICA em assinatura, e alcança de contrato", () => {
    // Decisão pendente do Lucas: o Hércules não tem etapa de pré-faturamento.
    expect(etapaDaVendaParaOCard("contrato", "assinatura", "prazo_legal")).toEqual({
      destino: "assinatura",
      origensAceitas: ["contrato"],
    });
  });

  it("faturado: só a partir de assinatura, nunca pulando de contrato", () => {
    const t = etapaDaVendaParaOCard("contrato", "prazo_legal", "faturado");
    expect(t).toEqual({ destino: "faturado", origensAceitas: ["assinatura"] });
    expect(t?.origensAceitas).not.toContain("contrato");
  });

  it("nenhum movimento aceita tirar a venda de reservado ou de proposta", () => {
    for (const para of ["analise", "contrato", "assinatura", "prazo_legal", "faturado"]) {
      const t = etapaDaVendaParaOCard("contrato", "analise", para);
      expect(t?.origensAceitas ?? []).not.toContain("proposta");
      expect(t?.origensAceitas ?? []).not.toContain("reservado");
    }
  });
});

describe("o que NÃO mexe na venda", () => {
  it("indeferido tem dono próprio (devolverAQuemVendeu)", () => {
    expect(etapaDaVendaParaOCard("contrato", "analise", "indeferido")).toBeNull();
    expect(etapaDaVendaParaOCard("contrato", "assinatura", "indeferido")).toBeNull();
  });

  it("o nascimento do card: a rota do Hércules já gravou contrato", () => {
    expect(etapaDaVendaParaOCard("contrato", null, "analise")).toBeNull();
  });

  it("card parado não é passagem", () => {
    expect(etapaDaVendaParaOCard("contrato", "assinatura", "assinatura")).toBeNull();
  });

  it.each(["cancelamento", "distrato", "cessao", "cancelamento_correcao"])(
    "card de %s nunca reflete, em nenhum movimento",
    (tipo) => {
      for (const [de, para] of [
        ["analise", "contrato"],
        ["contrato", "assinatura"],
        ["assinatura", "faturado"],
        ["contrato", "faturado"],
        ["assinatura", "analise"],
      ] as const) {
        expect(etapaDaVendaParaOCard(tipo, de, para)).toBeNull();
      }
    },
  );
});

describe("o aviso para a tela", () => {
  it("andou, já estava ou não se aplica: sem aviso", () => {
    expect(avisoDoHercules([])).toBeNull();
    expect(
      avisoDoHercules([{ de: "contrato", feito: "andou", para: "assinatura" }, { feito: "ja_estava" }]),
    ).toBeNull();
    expect(avisoDoHercules([{ feito: "nao_se_aplica" }])).toBeNull();
  });

  it("recusado: diz que o card andou, que a venda não acompanhou e onde ela ficou", () => {
    const aviso = avisoDoHercules([{ etapaLida: "proposta", feito: "recusado", porque: "etapa_fora_da_origem" }]);
    expect(aviso).toContain("O card andou, mas a venda no Hércules não acompanhou");
    expect(aviso).toContain('continua em "proposta"');
    // Sem travessão, regra da casa para texto que alguém lê.
    expect(aviso).not.toMatch(/[—–]/);
  });
});
