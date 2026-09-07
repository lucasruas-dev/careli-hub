import { describe, expect, it } from "vitest";

import {
  ehFalhaDeAutenticacao,
  estadoDaClicksign,
  estadoDoD4Sign,
  estadoDoEventoClicksign,
  rotuloDoEstado,
} from "./traduzir";
import { ehTerminal, estaEmMovimento, type EstadoDaAssinatura } from "./tipos";

// ⚠️ O QUE ESTES TESTES PROTEGEM. Estado mal traduzido não dá erro — pinta a tela com a situação
// errada de um contrato que alguém vai assinar. E com DOIS provedores vivos (decisão do Lucas em
// 07/09/2026: *"a minha ideia é ter as duas, não vou desfazer da d4sign"*), a tradução é o único
// lugar onde as duas línguas se encontram.

describe("D4Sign", () => {
  // Os quatro medidos no catálogo inteiro em 18/08/2026.
  it("traduz os quatro status que existem de verdade", () => {
    expect(estadoDoD4Sign("4").estado).toBe("assinado");
    expect(estadoDoD4Sign("6").estado).toBe("cancelado");
    expect(estadoDoD4Sign("3").estado).toBe("aguardando");
    expect(estadoDoD4Sign("2").estado).toBe("aguardando");
  });

  // ⚠️ O D4Sign chama de "Aguardando Assinaturas" tanto o contrato em que ninguém assinou quanto
  // aquele em que três dos quatro já assinaram. Quem sabe a diferença é a lista de signatários.
  it("distingue aguardando de parcial pela lista de signatários, não pelo status", () => {
    expect(estadoDoD4Sign("3", { algumJaAssinou: false }).estado).toBe("aguardando");
    expect(estadoDoD4Sign("3", { algumJaAssinou: true }).estado).toBe("parcial");
  });

  it("status desconhecido não vira chute", () => {
    expect(estadoDoD4Sign("9").estado).toBe("desconhecido");
    expect(estadoDoD4Sign(null).estado).toBe("desconhecido");
    expect(estadoDoD4Sign("").estado).toBe("desconhecido");
    expect(estadoDoD4Sign(undefined).estado).toBe("desconhecido");
  });

  it("guarda o código cru, para a tela poder mostrar o que não soube traduzir", () => {
    expect(estadoDoD4Sign("9").estadoCru).toBe("d4sign:9");
  });

  // O statusId chega como STRING no JSON ("4", não 4).
  it("aceita número e string", () => {
    expect(estadoDoD4Sign(4).estado).toBe("assinado");
    expect(estadoDoD4Sign("4").estado).toBe("assinado");
  });
});

describe("Clicksign", () => {
  it("traduz os quatro estados do envelope", () => {
    expect(estadoDaClicksign("draft").estado).toBe("rascunho");
    expect(estadoDaClicksign("running").estado).toBe("aguardando");
    expect(estadoDaClicksign("canceled").estado).toBe("cancelado");
    expect(estadoDaClicksign("closed", { todosAssinaram: true }).estado).toBe("assinado");
  });

  // ⚠️ A ARMADILHA MAIS SÉRIA DA CLICKSIGN. `deadline_partial_signature_action` pode FECHAR o
  // envelope no vencimento com as assinaturas que tiver: um contrato com o comprador assinado e a
  // vendedora não vira `closed`, com cara de concluído e sem valor nenhum.
  it("closed SEM todos assinarem é prazo vencido, não assinado", () => {
    expect(estadoDaClicksign("closed", { todosAssinaram: false }).estado).toBe("expirado");
  });

  // Não saber é diferente de saber que não. `undefined` manda alguém conferir; um chute mandaria o
  // contrato adiante.
  it("closed sem saber se todos assinaram não afirma nada", () => {
    expect(estadoDaClicksign("closed").estado).toBe("desconhecido");
  });

  it("running distingue aguardando de parcial", () => {
    expect(estadoDaClicksign("running", { algumJaAssinou: true }).estado).toBe("parcial");
  });

  it("aceita as duas grafias de cancelado e ignora caixa e espaço", () => {
    expect(estadoDaClicksign("canceled").estado).toBe("cancelado");
    expect(estadoDaClicksign("cancelled").estado).toBe("cancelado");
    expect(estadoDaClicksign("  RUNNING  ").estado).toBe("aguardando");
  });

  it("estado desconhecido não vira chute", () => {
    expect(estadoDaClicksign("inventado").estado).toBe("desconhecido");
    expect(estadoDaClicksign(null).estado).toBe("desconhecido");
    expect(estadoDaClicksign(42).estado).toBe("desconhecido");
  });
});

describe("os eventos do webhook da Clicksign", () => {
  // ⚠️ `sign` é UMA pessoa. Tratar como conclusão daria o contrato por assinado no primeiro dos
  // quatro compradores.
  it("sign é parcial, não assinado", () => {
    expect(estadoDoEventoClicksign("sign")).toBe("parcial");
  });

  it("só os três eventos de fechamento concluem o contrato", () => {
    expect(estadoDoEventoClicksign("auto_close")).toBe("assinado");
    expect(estadoDoEventoClicksign("close")).toBe("assinado");
    expect(estadoDoEventoClicksign("document_closed")).toBe("assinado");
  });

  // O evento que o D4Sign não tem.
  it("refusal vira recusado", () => {
    expect(estadoDoEventoClicksign("refusal")).toBe("recusado");
  });

  // ⚠️ Prazo vencido pede ação diferente de "alguém desistiu", mesmo que a Clicksign cancele por
  // baixo dos panos.
  it("deadline vira expirado, e não cancelado", () => {
    expect(estadoDoEventoClicksign("deadline")).toBe("expirado");
  });

  it("evento de bastidor não move o card", () => {
    for (const evento of [
      "add_signer",
      "remove_signer",
      "update_auto_close",
      "update_locale",
      "add_image",
      "custom",
      "acceptance_term_sent",
      "facematch_refused",
    ]) {
      expect(estadoDoEventoClicksign(evento), evento).toBeNull();
    }
  });

  it("evento desconhecido não move o card", () => {
    expect(estadoDoEventoClicksign("evento_que_a_clicksign_criar_amanha")).toBeNull();
    expect(estadoDoEventoClicksign(null)).toBeNull();
  });
});

describe("falha de autenticação do signatário", () => {
  // Não muda o documento, mas é a pessoa TRAVADA na hora de assinar — a que liga no atendimento.
  it("reconhece as recusas de biometria, selfie, documentoscopia e OCR", () => {
    for (const evento of [
      "liveness_refused",
      "facematch_refused",
      "documentscopy_refused",
      "biometric_refused",
      "ocr_refused",
      "registro_civil_refused",
      "identity_biometrics_refused",
    ]) {
      expect(ehFalhaDeAutenticacao(evento), evento).toBe(true);
    }
  });

  it("reconhece as tentativas excedidas", () => {
    expect(ehFalhaDeAutenticacao("attempts_by_whatsapp_exceeded")).toBe(true);
    expect(ehFalhaDeAutenticacao("attempts_by_liveness_or_facematch_exceeded")).toBe(true);
  });

  // ⚠️ `refusal` é o CLIENTE recusando o contrato — decisão dele, e muda o estado. Confundir com
  // falha técnica esconderia a recusa de verdade num aviso de atendimento.
  it("NÃO confunde com a recusa do contrato", () => {
    expect(ehFalhaDeAutenticacao("refusal")).toBe(false);
    expect(ehFalhaDeAutenticacao("acceptance_term_refused")).toBe(false);
  });

  it("evento comum não é falha", () => {
    expect(ehFalhaDeAutenticacao("sign")).toBe(false);
    expect(ehFalhaDeAutenticacao(null)).toBe(false);
  });
});

describe("o vocabulário", () => {
  const TODOS: EstadoDaAssinatura[] = [
    "rascunho",
    "aguardando",
    "parcial",
    "assinado",
    "recusado",
    "cancelado",
    "expirado",
    "desconhecido",
  ];

  it("todo estado tem rótulo", () => {
    for (const e of TODOS) expect(rotuloDoEstado(e), e).toBeTruthy();
  });

  it("em movimento e terminal não se sobrepõem", () => {
    for (const e of TODOS) {
      expect(estaEmMovimento(e) && ehTerminal(e), e).toBe(false);
    }
  });

  it("os quatro estados finais são terminais", () => {
    for (const e of ["assinado", "recusado", "cancelado", "expirado"] as EstadoDaAssinatura[]) {
      expect(ehTerminal(e), e).toBe(true);
    }
  });

  // ⚠️ `desconhecido` NÃO é terminal e NÃO está em movimento: ele é um pedido de conferência. Se
  // fosse terminal, o contrato sairia da fila de acompanhamento sem ninguém ter olhado.
  it("desconhecido fica de fora dos dois grupos, de propósito", () => {
    expect(estaEmMovimento("desconhecido")).toBe(false);
    expect(ehTerminal("desconhecido")).toBe(false);
  });
});
