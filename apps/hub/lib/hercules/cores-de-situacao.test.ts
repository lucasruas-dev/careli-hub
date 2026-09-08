import { describe, expect, it } from "vitest";

import {
  CLASSES_DO_SELO,
  CORES_DA_SITUACAO,
  cssDasCores,
  ROTULO_DA_SITUACAO,
  situacaoConhecida,
} from "./cores-de-situacao";

describe("a paleta é uma só", () => {
  it("as cinco situações têm cor, rótulo e selo", () => {
    for (const s of Object.keys(CORES_DA_SITUACAO) as (keyof typeof CORES_DA_SITUACAO)[]) {
      expect(CORES_DA_SITUACAO[s].claro, s).toMatch(/^#[0-9a-f]{6}$/);
      expect(CORES_DA_SITUACAO[s].escuro, s).toMatch(/^#[0-9a-f]{6}$/);
      expect(ROTULO_DA_SITUACAO[s], s).toBeTruthy();
      expect(CLASSES_DO_SELO[s], s).toBeTruthy();
    }
  });

  // ⚠️ OS TONS SÃO OS DO PAINEL DE PRODUTOS, onde a paleta nasceu e foi aprovada. Se alguém mudar
  // um deles aqui sem mudar lá, as duas telas voltam a divergir — que é o defeito que este módulo
  // veio resolver.
  it("os tons são exatamente os do painel de produtos do portal", () => {
    expect(CORES_DA_SITUACAO.vendido.claro).toBe("#1d4ed8");
    expect(CORES_DA_SITUACAO.bloqueado.claro).toBe("#c24135");
    expect(CORES_DA_SITUACAO.disponivel.claro).toBe("#2f7d59");
    expect(CORES_DA_SITUACAO.reservado.claro).toBe("#b45309");
    expect(CORES_DA_SITUACAO.negociacao.claro).toBe("#6d28d9");
  });

  // ⚠️ NENHUMA COR PODE EXISTIR SÓ NO ESCURO. É assim que nasce tela com texto de um tema sobre
  // fundo do outro: basta um token faltar no bloco claro para o navegador não ter o que pintar.
  it("o CSS declara os cinco tokens nos três estados do tema", () => {
    const css = cssDasCores(".teste");
    for (const s of Object.keys(CORES_DA_SITUACAO)) {
      expect((css.match(new RegExp(`--sit-${s}:`, "g")) ?? []).length, s).toBe(3);
    }
    expect(css).toContain('[data-inc-tema="escuro"]');
    expect(css).toContain(':not([data-inc-tema="claro"])');
  });
});

describe("a situação vinda do banco", () => {
  it("reconhece as cinco pelo nome exato", () => {
    expect(situacaoConhecida("vendido")).toBe("vendido");
    expect(situacaoConhecida("BLOQUEADO")).toBe("bloqueado");
  });

  // O legado escreve variações; nenhuma delas pode virar a cor errada.
  it("reconhece as variações do legado", () => {
    expect(situacaoConhecida("Vendida")).toBe("vendido");
    expect(situacaoConhecida("reservada")).toBe("reservado");
    expect(situacaoConhecida("indisponivel")).toBe("bloqueado");
    expect(situacaoConhecida("em negociação")).toBe("negociacao");
    expect(situacaoConhecida("proposta")).toBe("negociacao");
  });

  it("o desconhecido cai em disponível, que é o estado neutro", () => {
    expect(situacaoConhecida("")).toBe("disponivel");
    expect(situacaoConhecida(null)).toBe("disponivel");
    expect(situacaoConhecida("qualquer coisa")).toBe("disponivel");
  });
});
