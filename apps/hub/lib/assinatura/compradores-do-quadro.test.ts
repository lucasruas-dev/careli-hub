import { describe, expect, it } from "vitest";

import { compradoresDoQuadro, ehCompradorNoQuadro, todosOsCompradoresAssinaram } from "./compradores-do-quadro";
import type { ItemDoQuadro } from "./registro-db";

// QUEM É COMPRADOR NO QUADRO (02/10/2026). Lucas: *"vamos mudar esse 3/11 eu preciso ver somente dos
// compradores"*. A régua é uma só para a porta que move o card, o início dos 7 dias e o selo do card.

let contador = 0;
const pessoa = (extra: Partial<ItemDoQuadro>): ItemDoQuadro => ({
  chave: `k-${(contador += 1)}`,
  email: "",
  nome: "",
  ordem: 1,
  papel: null,
  ...extra,
});

describe("ehCompradorNoQuadro", () => {
  it("Clicksign: o papel comprador ou cônjuge (sem diferença de caixa); os outros papéis não", () => {
    expect(ehCompradorNoQuadro({ papel: "comprador" })).toBe(true);
    expect(ehCompradorNoQuadro({ papel: "Conjuge" })).toBe(true);
    for (const papel of ["vendedora", "testemunha", "coordenadora", "corretor"]) {
      expect(ehCompradorNoQuadro({ papel })).toBe(false);
    }
  });

  it("D4Sign: papel vazio com o perfil 'Comprador'; 'Sem perfil' e 'Imobiliária' não", () => {
    expect(ehCompradorNoQuadro({ papel: null, perfil: "Comprador" })).toBe(true);
    expect(ehCompradorNoQuadro({ papel: "", perfil: "Comprador" })).toBe(true);
    expect(ehCompradorNoQuadro({ papel: null, perfil: "Sem perfil" })).toBe(false);
    expect(ehCompradorNoQuadro({ papel: null, perfil: "Imobiliária" })).toBe(false);
    expect(ehCompradorNoQuadro({ papel: null })).toBe(false);
  });

  it("⚠️ papel escrito manda: a testemunha com perfil 'Comprador' não vira comprador", () => {
    expect(ehCompradorNoQuadro({ papel: "testemunha", perfil: "Comprador" })).toBe(false);
  });
});

describe("compradoresDoQuadro e todosOsCompradoresAssinaram", () => {
  it("conta só os compradores, só marca com data legível, e devolve a última como foi guardada", () => {
    const quadro = [
      pessoa({ assinado_em: "2026-09-26T10:00:00.000-03:00", papel: "comprador" }),
      pessoa({ assinado_em: "2026-09-26T13:30:00.000Z", papel: "conjuge" }),
      pessoa({ assinado_em: "2026-09-26T18:00:00.000-03:00", papel: "vendedora" }),
      pessoa({ assinado_em: "ontem", papel: "comprador" }),
    ];
    expect(compradoresDoQuadro(quadro)).toEqual({ assinaram: 2, total: 3, ultima: "2026-09-26T13:30:00.000Z" });
    expect(todosOsCompradoresAssinaram(quadro)).toBe(false);
  });

  it("todos os compradores assinados, com a testemunha ainda por assinar: verdadeiro", () => {
    const quadro = [
      pessoa({ assinado_em: "2026-09-26T10:00:00.000-03:00", papel: "comprador" }),
      pessoa({ assinado_em: "2026-09-26T11:00:00.000-03:00", papel: "conjuge" }),
      pessoa({ papel: "testemunha" }),
    ];
    expect(todosOsCompradoresAssinaram(quadro)).toBe(true);
  });

  it("⚠️ quadro sem comprador: falso, nunca 'todos os zero assinaram'", () => {
    expect(todosOsCompradoresAssinaram([])).toBe(false);
    expect(todosOsCompradoresAssinaram([pessoa({ assinado_em: "2026-09-26T10:00:00.000-03:00", papel: "vendedora" })])).toBe(
      false,
    );
    expect(compradoresDoQuadro([])).toEqual({ assinaram: 0, total: 0, ultima: null });
  });
});
