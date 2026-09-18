import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  avisoDaConclusao,
  conferirDeclaracoes,
  DECLARACOES_DO_DISTRATO,
  podeConcluir,
  podeRetomar,
  rotuloDaConclusao,
} from "./conclusao-do-cancelamento";

// A PARTE PURA DA CONCLUSÃO DO CANCELAMENTO E DO DISTRATO — onde o botão aparece, o que a
// confirmação promete e o que o distrato exige de quem conclui.
//
// Lucas (18/09/2026): *"o time administrativo quando finaliza um cancelamento de contrato, a unidade
// nao esta voltando para disponibilidade"*. Não havia botão de concluir; o único que havia
// (Indeferir) recusava o pedido.

describe("onde o botão de concluir aparece", () => {
  it.each(["analise", "contrato", "assinatura", "prazo_legal"])(
    "cancelamento e distrato em %s concluem",
    (estagio) => {
      expect(podeConcluir("cancelamento", estagio)).toBe(true);
      expect(podeConcluir("distrato", estagio)).toBe(true);
    },
  );

  // Concluído já acabou; Indeferido é o pedido recusado: concluir dali seria desfazer a venda
  // pelo card que disse não.
  it.each(["faturado", "indeferido"])("em %s não aparece", (estagio) => {
    expect(podeConcluir("cancelamento", estagio)).toBe(false);
    expect(podeConcluir("distrato", estagio)).toBe(false);
  });

  // O card de contrato FAZ a venda: o que o desfaz é o pedido de cancelamento, pelo Hércules.
  it.each(["contrato", "cessao", "cancelamento_correcao"])("o card de %s nunca conclui por aqui", (tipo) => {
    expect(podeConcluir(tipo, "analise")).toBe(false);
  });

  it("o rótulo diz qual das duas coisas o botão faz", () => {
    expect(rotuloDaConclusao("cancelamento")).toBe("Concluir cancelamento");
    expect(rotuloDaConclusao("distrato")).toBe("Concluir distrato");
  });
});

describe("as duas declarações do distrato", () => {
  it("o cancelamento não pede declaração nenhuma", () => {
    expect(conferirDeclaracoes("cancelamento", undefined)).toEqual({ declaradas: [], ok: true });
  });

  it("o distrato sem as duas é recusado, dizendo o que falta", () => {
    const r = conferirDeclaracoes("distrato", {});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain("termo de distrato assinado");
    expect(r.erro).toContain("devolução de valores acertada com o cliente");
  });

  it("uma só não basta", () => {
    const r = conferirDeclaracoes("distrato", { termoAssinado: true });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).not.toContain("termo de distrato assinado");
    expect(r.erro).toContain("devolução de valores");
  });

  // ⚠️ SÓ `true` VALE: a caixa marcada na tela manda `true`, e qualquer outra coisa é cliente da API
  // inventando o que ninguém marcou.
  it.each([["sim"], [1], ["true"]])("%s não é declaração", (valor) => {
    expect(conferirDeclaracoes("distrato", { devolucaoAcertada: valor, termoAssinado: valor }).ok).toBe(false);
  });

  it("as duas marcadas passam, e voltam em texto para o motivo e o histórico", () => {
    expect(conferirDeclaracoes("distrato", { devolucaoAcertada: true, termoAssinado: true })).toEqual({
      declaradas: ["Termo de distrato assinado", "Devolução de valores acertada com o cliente"],
      ok: true,
    });
  });

  it("os rótulos são os do pedido do Lucas", () => {
    expect(DECLARACOES_DO_DISTRATO.map((d) => d.rotulo)).toEqual([
      "Termo de distrato assinado",
      "Devolução de valores acertada com o cliente",
    ]);
  });
});

describe("o que a confirmação diz antes do clique", () => {
  it("cancelamento: a venda cai, a reserva cai, o lote volta SE não houver outro dono, e o envelope morre", () => {
    const texto = avisoDaConclusao({ codigo: "COD 000019", tipo: "cancelamento" });
    expect(texto).toContain("A venda COD 000019 é cancelada");
    expect(texto).toContain("a reserva cai");
    expect(texto).toContain("volta para a disponibilidade se não houver outro dono");
    expect(texto).toContain("ainda sem todas as assinaturas é cancelado na Clicksign");
  });

  it("distrato: o envelope ainda assinável morre, o contrato assinado por todos fica como está", () => {
    const texto = avisoDaConclusao({ codigo: "COD VOC3", tipo: "distrato" });
    expect(texto).toContain("A venda COD VOC3 é distratada");
    expect(texto).toContain("se não houver outro dono");
    expect(texto).toContain("ainda sem todas as assinaturas é cancelado na Clicksign");
    expect(texto).toContain("contrato já assinado por todos fica como está");
  });

  it("retomada: só a nova tentativa de devolver a unidade, sem prometer desfazer a venda de novo", () => {
    const texto = avisoDaConclusao({ codigo: "COD VOC3", retomada: true, tipo: "distrato" });
    expect(texto).toContain("já foi desfeita por este card");
    expect(texto).toContain("volta para a disponibilidade se não houver outro dono");
    expect(texto).not.toContain("é distratada");
  });

  it("podeRetomar: só no card concluído de pedido, com a venda viva ou o lote ocupado", () => {
    const livre = { unidadeLivre: true, vendaDesfeita: true };
    expect(podeRetomar("distrato", "faturado", { ...livre, unidadeLivre: false })).toBe(true);
    expect(podeRetomar("cancelamento", "faturado", { ...livre, vendaDesfeita: false })).toBe(true);
    expect(podeRetomar("cancelamento", "faturado", livre)).toBe(false);
    expect(podeRetomar("cancelamento", "faturado", null)).toBe(false);
    expect(podeRetomar("cancelamento", "analise", { ...livre, unidadeLivre: false })).toBe(false);
    expect(podeRetomar("contrato", "faturado", { ...livre, unidadeLivre: false })).toBe(false);
    expect(rotuloDaConclusao("distrato", true)).toBe("Tentar liberar a unidade");
  });

  it("sem código, a frase continua inteira", () => {
    expect(avisoDaConclusao({ codigo: null, tipo: "cancelamento" })).toMatch(/^A venda deste card é cancelada/);
  });

  // ⚠️ SEM TRAVESSÃO no texto que a pessoa lê ([[feedback_sem_travessao]]).
  it.each(["cancelamento", "distrato"] as const)("%s: nenhum travessão", (tipo) => {
    expect(avisoDaConclusao({ codigo: "COD 1", tipo })).not.toMatch(/[—–]/);
  });
});

// ⚠️ A TELA LÊ DESTE MÓDULO, E NÃO DE UMA CÓPIA. Ele não importa nada do servidor, então a tela de
// trabalho (`"use client"`) pode importá-lo direto; o teste garante que ela continua importando.
describe("a tela usa as mesmas frases e a mesma régua", () => {
  const TELA = readFileSync(
    join(__dirname, "../../modules/temis/blocks/trabalho/tela-de-trabalho.tsx"),
    "utf8",
  );

  it("importa régua, rótulo, aviso e declarações daqui", () => {
    expect(TELA).toContain('from "@/lib/temis/conclusao-do-cancelamento"');
    for (const nome of ["avisoDaConclusao", "DECLARACOES_DO_DISTRATO", "podeConcluir", "rotuloDaConclusao"]) {
      expect(TELA).toContain(nome);
    }
  });

  it("manda a ação `concluir` para a mesma rota das outras decisões do card", () => {
    expect(TELA).toContain('acao: "concluir"');
  });

  it("a frase do Indeferir no pedido de cancelamento diz que ele RECUSA o pedido", () => {
    expect(TELA).toContain("Indeferir recusa o pedido: a venda continua como está");
  });
});
