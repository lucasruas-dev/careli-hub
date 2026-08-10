import { describe, expect, it } from "vitest";

import {
  normalizarCarteira,
  recorteDaCarteira,
  sqlDaCoerencia,
} from "./bi-vale-do-ouro";

// O QUE ESTE TESTE PROTEGE: o recorte por carteira do BI do Vale do Ouro.
// O erro que sai caro e silencioso no painel público é misturar o master (35) com as carteiras:
// as unidades do 35 são as MESMAS de 36/37 (contá-las dobraria o empreendimento) e as propostas
// do 35 são a SEGUNDA CÓPIA de vendas que já vivem nas carteiras. Enquanto elas entravam, o card
// do topo dizia 84 vendas no VOC e o ranking de imobiliária somava 89.
// O teste é de SQL montado (sem banco): é a peça que decide o universo das duas contagens.

describe("normalizarCarteira", () => {
  it("aceita voc e vol", () => {
    expect(normalizarCarteira("voc")).toBe("voc");
    expect(normalizarCarteira("VOL")).toBe("vol");
    expect(normalizarCarteira(" voc ")).toBe("voc");
  });

  it("cai no lançamento inteiro com valor ausente ou desconhecido", () => {
    expect(normalizarCarteira(null)).toBe("todos");
    expect(normalizarCarteira(undefined)).toBe("todos");
    expect(normalizarCarteira("")).toBe("todos");
    expect(normalizarCarteira("35")).toBe("todos");
    expect(normalizarCarteira("voc; DROP TABLE users")).toBe("todos");
  });
});

describe("recorteDaCarteira", () => {
  it("no recorte inteiro conta as duas carteiras vivas", () => {
    expect(recorteDaCarteira("todos").listaUnidades).toBe("36, 37");
  });

  it("no VOC conta só o 37", () => {
    expect(recorteDaCarteira("voc").listaUnidades).toBe("37");
  });

  it("no VOL conta só o 36", () => {
    expect(recorteDaCarteira("vol").listaUnidades).toBe("36");
  });

  it("nunca inclui o master (35), nem para unidade nem para proposta", () => {
    for (const carteira of ["todos", "voc", "vol"] as const) {
      expect(recorteDaCarteira(carteira).listaUnidades).not.toMatch(/\b35\b/);
    }
  });

  it("devolve UMA lista só, a mesma para unidade e para proposta", () => {
    // O card do topo conta unidade e o ranking conta proposta. Se cada um enxergasse um universo
    // diferente, a mesma tela mostraria dois totais de venda, que é o defeito de 09/08.
    expect(Object.keys(recorteDaCarteira("voc"))).toEqual(["listaUnidades"]);
  });
});

// O VIGIA existe porque o painel passou a contar pela SITUAÇÃO DA UNIDADE (regra do Lucas, 09/08)
// e a unidade não se desfaz sozinha quando a proposta cai: "proposta podem ser canceladas, temos
// que ficar de olho nas atualizações". Estes testes protegem as duas coisas que fariam o vigia
// mentir em silêncio — ele olhar o empreendimento errado, ou perder etapa de venda.
describe("sqlDaCoerencia", () => {
  it("nunca vigia o master (35): lá 'sem proposta' é o normal, não é erro", () => {
    for (const carteira of ["todos", "voc", "vol"] as const) {
      const sql = sqlDaCoerencia(recorteDaCarteira(carteira).listaUnidades);
      expect(sql).not.toMatch(/\b35\b/);
    }
  });

  it("conta os dois sentidos do erro e a ordem no tempo", () => {
    const sql = sqlDaCoerencia("36, 37");

    expect(sql).toContain("carimbo_sem_venda"); // lote vendido sem proposta viva
    expect(sql).toContain("venda_sem_carimbo"); // proposta viva sem lote carimbado
    expect(sql).toContain("reserva_sem_lastro");
    expect(sql).toContain("p.morte > eu.updated_at"); // a proposta morreu DEPOIS do carimbo
  });

  it("enxerga a venda que andou para a frente, não só contrato gerado e proposta realizada", () => {
    const sql = sqlDaCoerencia("37");

    // Em 09/08 o VOC tinha 41 propostas em "Em assinatura" (5) fora da conta: com 3 e 9 apenas, o
    // vigia acusaria 41 divergências falsas e o ranking mostraria 43 vendas onde havia 84.
    expect(sql).toContain("acquisition_request_stage_id IN (3, 4, 5, 6, 9)");
    // E as mortas (cancelado/reprovado/distrato) precisam continuar do lado de fora da venda.
    expect(sql).toContain("acquisition_request_stage_id IN (7, 8, 10, 11)");
  });

  it("vigia só o lote comercial (o não lançado a R$ 1,00 nunca teve proposta)", () => {
    expect(sqlDaCoerencia("36, 37")).toContain("eu.price > 1");
  });
});
