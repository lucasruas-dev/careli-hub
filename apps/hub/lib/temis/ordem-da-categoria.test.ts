import { describe, expect, it } from "vitest";

import {
  lerOrdemDoCorpo,
  type NivelDeOrdem,
  resolverOrdemDeAssinatura,
  temOrdemPropria,
} from "./ordem-da-categoria";

// O QUE ESTÁ TRAVADO AQUI: a cadeia categoria → empreendimento → padrão da casa, e a porta de
// entrada da gravação.
//
// ⚠️ O CASO QUE MAIS IMPORTA É O DA HERANÇA QUE MORRE CALADA. Uma categoria com lista vazia, ou com
// `ordenada = true` e lista nula, não derruba nada: ela vira uma regra que a tela mostra e o envio
// do contrato ignora. Estes testes existem para essa combinação nunca chegar ao banco.

const empreendimento = (ordem: unknown, ordenada = false): NivelDeOrdem => ({
  ordem,
  ordenada,
  origem: "empreendimento",
  rotulo: "Lagoa Bonita",
});

const categoria = (ordem: unknown, ordenada = false): NivelDeOrdem => ({
  ordem,
  ordenada,
  origem: "categoria",
  rotulo: "Condomínio",
});

describe("temOrdemPropria", () => {
  it("o par intacto é HERANÇA — é como as duas categorias vivas estão hoje", () => {
    // Condomínio e Loteamento (Lagoa Bonita), medidas em 08/09/2026: booleano falso, lista nula.
    expect(temOrdemPropria({ ordem: null, ordenada: false })).toBe(false);
  });

  it("lista com papel decide", () => {
    expect(temOrdemPropria({ ordem: ["comprador"], ordenada: true })).toBe(true);
  });

  it("espelha `foiCadastrada` do motor do envio", () => {
    // ⚠️ ESTES DOIS CASOS SÓ EXISTEM POR SQL NA MÃO — a rota nunca grava o booleano sem lista nem
    // a lista vazia. Estão travados porque `lib/assinatura/ordem-db.ts` os trata como REGRA, e uma
    // tela que os lesse como herança mostraria uma ordem e o contrato sairia em outra.
    expect(temOrdemPropria({ ordem: null, ordenada: true })).toBe(true);
    expect(temOrdemPropria({ ordem: [], ordenada: false })).toBe(true);
  });
});

describe("resolverOrdemDeAssinatura", () => {
  it("categoria sem ordem HERDA o empreendimento", () => {
    const r = resolverOrdemDeAssinatura([
      categoria(null),
      empreendimento(["vendedora", "comprador"], true),
    ]);

    expect(r.origem).toBe("empreendimento");
    expect(r.rotulo).toBe("Lagoa Bonita");
    expect(r.regra.ordenada).toBe(true);
    expect(r.regra.papeis.slice(0, 2)).toEqual(["vendedora", "comprador"]);
  });

  it("categoria com ordem SOBREPÕE o empreendimento", () => {
    const r = resolverOrdemDeAssinatura([
      categoria(["testemunha", "comprador"], true),
      empreendimento(["vendedora"], true),
    ]);

    expect(r.origem).toBe("categoria");
    expect(r.rotulo).toBe("Condomínio");
    expect(r.regra.papeis.slice(0, 2)).toEqual(["testemunha", "comprador"]);
  });

  it("categoria pode voltar ao paralelo dentro de empreendimento ordenado", () => {
    // ⚠️ ISTO É REGRA PRÓPRIA, e não ausência de regra: `ordenada: false` COM lista é a decisão
    // "todos ao mesmo tempo". Se a lista fosse ignorada por causa do booleano, a categoria cairia
    // na herança e sairia ordenada — exatamente o contrário do que foi cadastrado.
    const r = resolverOrdemDeAssinatura([
      categoria(["comprador", "vendedora"], false),
      empreendimento(["comprador", "vendedora"], true),
    ]);

    expect(r.origem).toBe("categoria");
    expect(r.regra.ordenada).toBe(false);
  });

  it("ninguém cadastrou nada: cai no padrão da casa, DESLIGADO", () => {
    const r = resolverOrdemDeAssinatura([categoria(null), empreendimento(null)]);

    expect(r.origem).toBe("padrao");
    expect(r.rotulo).toBe("Padrão da casa");
    // O padrão nasce desligado de propósito: ligar a ordem na carteira inteira pararia contratos
    // que hoje saem em paralelo.
    expect(r.regra.ordenada).toBe(false);
    expect(r.regra.papeis[0]).toBe("comprador");
  });

  it("o booleano em FALSO com lista nula não cria regra", () => {
    // O par intacto é o default da 0142 e existe em toda linha: se ele bastasse para a categoria
    // vencer, criar uma categoria apagaria a ordem do empreendimento em silêncio.
    const r = resolverOrdemDeAssinatura([categoria(null, false), empreendimento(["corretor"], true)]);
    expect(r.origem).toBe("empreendimento");
  });

  it("subcategoria herda da mãe antes de chegar ao empreendimento", () => {
    const r = resolverOrdemDeAssinatura([
      { ordem: null, ordenada: false, origem: "categoria", rotulo: "Fase 1" },
      { ordem: ["corretor"], ordenada: true, origem: "categoria", rotulo: "Loteamento" },
      empreendimento(["vendedora"], true),
    ]);

    expect(r.rotulo).toBe("Loteamento");
    expect(r.regra.papeis[0]).toBe("corretor");
  });

  it("papel que saiu do código é descartado, e a regra continua de pé", () => {
    const r = resolverOrdemDeAssinatura([categoria(["avalista", "comprador"], true)]);

    expect(r.origem).toBe("categoria");
    expect(r.regra.papeis).not.toContain("avalista");
    expect(r.regra.papeis[0]).toBe("comprador");
  });

  it("papel ausente da lista assina por último", () => {
    const r = resolverOrdemDeAssinatura([categoria(["testemunha"], true)]);

    expect(r.regra.papeis[0]).toBe("testemunha");
    expect(r.regra.papeis).toContain("comprador");
    expect(r.regra.papeis.indexOf("comprador")).toBeGreaterThan(0);
  });
});

describe("lerOrdemDoCorpo", () => {
  it("ausente = não mexeu", () => {
    const r = lerOrdemDoCorpo({});
    expect(r.ok && r.mudancas).toBe(null);
  });

  it("nulo = limpou, e volta a herdar", () => {
    const r = lerOrdemDoCorpo({ assinaturaOrdem: null, assinaturaOrdenada: false });
    expect(r.ok && r.mudancas).toEqual({ assinatura_ordem: null, assinatura_ordenada: false });
  });

  it("limpar zera o booleano mesmo se ele não veio", () => {
    const r = lerOrdemDoCorpo({ assinaturaOrdem: null });
    expect(r.ok && r.mudancas).toEqual({ assinatura_ordem: null, assinatura_ordenada: false });
  });

  it("lista válida grava o par", () => {
    const r = lerOrdemDoCorpo({
      assinaturaOrdem: ["comprador", "conjuge", "vendedora"],
      assinaturaOrdenada: true,
    });
    expect(r.ok && r.mudancas).toEqual({
      assinatura_ordem: ["comprador", "conjuge", "vendedora"],
      assinatura_ordenada: true,
    });
  });

  it("recusa lista vazia", () => {
    const r = lerOrdemDoCorpo({ assinaturaOrdem: [], assinaturaOrdenada: true });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.erro).toMatch(/vazia/i);
  });

  it("recusa lista vazia mesmo desligada", () => {
    const r = lerOrdemDoCorpo({ assinaturaOrdem: [], assinaturaOrdenada: false });
    expect(r.ok).toBe(false);
  });

  it("recusa papel que não existe, dizendo qual", () => {
    const r = lerOrdemDoCorpo({
      assinaturaOrdem: ["comprador", "avalista"],
      assinaturaOrdenada: true,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.erro).toContain("avalista");
  });

  it("recusa papel repetido, dizendo qual", () => {
    const r = lerOrdemDoCorpo({
      assinaturaOrdem: ["comprador", "vendedora", "comprador"],
      assinaturaOrdenada: true,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.erro).toContain("comprador");
    expect(!r.ok && r.erro).toMatch(/repetido/i);
  });

  it("recusa o liga/desliga sozinho", () => {
    const r = lerOrdemDoCorpo({ assinaturaOrdenada: true });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.erro).toMatch(/junto/i);
  });

  it("recusa ordenada = true com lista nula", () => {
    const r = lerOrdemDoCorpo({ assinaturaOrdem: null, assinaturaOrdenada: true });
    expect(r.ok).toBe(false);
  });

  it("recusa o que não é lista", () => {
    expect(lerOrdemDoCorpo({ assinaturaOrdem: "comprador" }).ok).toBe(false);
    expect(lerOrdemDoCorpo({ assinaturaOrdem: { comprador: 1 } }).ok).toBe(false);
  });

  it("recusa liga/desliga que não é booleano", () => {
    const r = lerOrdemDoCorpo({ assinaturaOrdem: ["comprador"], assinaturaOrdenada: "sim" });
    expect(r.ok).toBe(false);
  });
});
