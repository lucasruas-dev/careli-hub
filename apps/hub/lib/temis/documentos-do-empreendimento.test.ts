import { describe, expect, it } from "vitest";

import {
  DOCUMENTO_DO_SERVICO,
  oQueFaltaNoSetup,
  servicoDisponivel,
  type PreparoDoEmpreendimento,
} from "./documentos-do-empreendimento";

const PRONTO: PreparoDoEmpreendimento = {
  documentosPublicados: ["contrato", "cessao", "distrato", "cancelamento"],
  taxaDeCessao: 500,
};

describe("o que cada serviço precisa do Setup", () => {
  it("com tudo publicado, todos os serviços atendem", () => {
    expect(oQueFaltaNoSetup(PRONTO)).toEqual([]);
  });

  it("sem a minuta, contrato e correção travam", () => {
    const preparo = { ...PRONTO, documentosPublicados: ["cessao", "distrato", "cancelamento"] as const };
    expect(servicoDisponivel("contrato", { ...preparo, documentosPublicados: [...preparo.documentosPublicados] }).ok).toBe(false);
    expect(servicoDisponivel("cancelamento_correcao", { ...preparo, documentosPublicados: [...preparo.documentosPublicados] }).ok).toBe(false);
    expect(servicoDisponivel("distrato", { ...preparo, documentosPublicados: [...preparo.documentosPublicados] }).ok).toBe(true);
  });

  // ⚠️ CORRIGIR É REFAZER O CONTRATO, e não emitir um termo próprio: o comprador assina o mesmo
  // instrumento de novo. Um documento a mais é um a mais que pode faltar bem na hora.
  it("o cancelamento por correção usa a minuta do contrato", () => {
    expect(DOCUMENTO_DO_SERVICO.cancelamento_correcao).toBe("contrato");
    expect(DOCUMENTO_DO_SERVICO.contrato).toBe("contrato");
  });

  it("cada serviço aponta para um documento", () => {
    for (const [servico, documento] of Object.entries(DOCUMENTO_DO_SERVICO)) {
      expect(documento, servico).toBeTruthy();
    }
  });
});

describe("a taxa de cessão", () => {
  it("sem taxa configurada, a cessão não abre", () => {
    const r = servicoDisponivel("cessao", { ...PRONTO, taxaDeCessao: null });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.faltando.join(" ")).toContain("taxa");
  });

  // ⚠️ ZERO É DECISÃO, NULL É ESQUECIMENTO. Tratar os dois igual faria a cessão travar onde a
  // isenção é intencional.
  it("taxa zero é isenção válida, e a cessão abre", () => {
    expect(servicoDisponivel("cessao", { ...PRONTO, taxaDeCessao: 0 }).ok).toBe(true);
  });

  it("a taxa só afeta a cessão", () => {
    const sem = { ...PRONTO, taxaDeCessao: null };
    for (const servico of ["contrato", "distrato", "cancelamento"] as const) {
      expect(servicoDisponivel(servico, sem).ok, servico).toBe(true);
    }
  });
});

describe("o que falta, junto", () => {
  it("lista serviço a serviço o que impede", () => {
    const falta = oQueFaltaNoSetup({ documentosPublicados: ["contrato"], taxaDeCessao: null });
    const porServico = new Map(falta.map((f) => [f.servico, f.faltando]));
    expect(porServico.get("cessao")).toHaveLength(2);
    expect(porServico.get("distrato")).toHaveLength(1);
    expect(porServico.has("contrato")).toBe(false);
  });
});
