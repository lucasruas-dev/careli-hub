import { describe, expect, it } from "vitest";

import {
  empreendimentosNovos,
  podeHabilitar,
  posicaoDaImobiliaria,
  tudoLiberado,
  type EmpreendimentoDaTela,
} from "./credenciamento-etapa";

// Casos travados com o dado real de 17/08/2026: 418 imobiliárias com papel `active` e entidade
// ainda em `review` (é a combinação normal, não um defeito), 19 em `review`/`review` e 1 em
// `review`/`attention`.

const TOTAL = 2; // Validação -> Habilitada

describe("posição da imobiliária na trilha", () => {
  it("habilitada é CONCLUÍDA, não 'etapa atual' (o caso da EDSON LUIZ BARBOSA)", () => {
    expect(
      posicaoDaImobiliaria({ entidadeStatus: "review", papelStatus: "active", totalEtapas: TOTAL }),
    ).toBe(TOTAL);
  });

  it("habilitada com a entidade em active também é concluída", () => {
    expect(
      posicaoDaImobiliaria({ entidadeStatus: "active", papelStatus: "active", totalEtapas: TOTAL }),
    ).toBe(TOTAL);
  });

  it("em validação fica no primeiro passo", () => {
    expect(
      posicaoDaImobiliaria({ entidadeStatus: "review", papelStatus: "review", totalEtapas: TOTAL }),
    ).toBe(0);
  });

  it("em correção volta para a Validação, que é onde o trabalho está", () => {
    expect(
      posicaoDaImobiliaria({
        entidadeStatus: "attention",
        papelStatus: "review",
        totalEtapas: TOTAL,
      }),
    ).toBe(0);
  });

  it("recusada fica na Validação (o selo de recusa é outro)", () => {
    expect(
      posicaoDaImobiliaria({ entidadeStatus: "review", papelStatus: "blocked", totalEtapas: TOTAL }),
    ).toBe(0);
  });

  it("sem papel carregado NÃO afirma nada: a tela mantém o que tinha", () => {
    expect(posicaoDaImobiliaria({ papelStatus: null, totalEtapas: TOTAL })).toBeNull();
    expect(posicaoDaImobiliaria({ totalEtapas: TOTAL })).toBeNull();
  });
});

const emp = (enterpriseId: string, habilitado = false): EmpreendimentoDaTela => ({
  enterpriseId,
  habilitado,
});

describe("quando o botão Habilitar faz sentido", () => {
  it("marcar o que JÁ está habilitado não libera nada (era o clique que redisparava o WhatsApp)", () => {
    const lista = [emp("35", true), emp("40", true)];
    const marcados = { "35": true, "40": true };

    expect(empreendimentosNovos(lista, marcados)).toEqual([]);
    expect(podeHabilitar(lista, marcados)).toBe(false);
  });

  it("empreendimento NOVO marcado libera o botão, mesmo com os outros já habilitados", () => {
    const lista = [emp("35", true), emp("40", false)];
    const marcados = { "35": true, "40": true };

    expect(empreendimentosNovos(lista, marcados)).toEqual(["40"]);
    expect(podeHabilitar(lista, marcados)).toBe(true);
  });

  it("nada marcado, nada a fazer", () => {
    const lista = [emp("35"), emp("40")];
    expect(podeHabilitar(lista, {})).toBe(false);
  });

  it("desmarcado explicitamente não conta", () => {
    expect(podeHabilitar([emp("35")], { "35": false })).toBe(false);
  });

  it("'tudo liberado' é estado; lista vazia não é 'tudo liberado'", () => {
    expect(tudoLiberado([emp("35", true), emp("40", true)])).toBe(true);
    expect(tudoLiberado([emp("35", true), emp("40", false)])).toBe(false);
    expect(tudoLiberado([])).toBe(false);
  });
});
