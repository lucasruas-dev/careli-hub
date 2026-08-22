import { describe, expect, it } from "vitest";

import {
  ehReativacao,
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

  // ⚠️ Regra mudou em 22/08 (pedido do Lucas: mesma cara da CAD): em correção a trilha ganha a
  // etapa própria entre Validação e Habilitada, e a posição aponta para ELA. Com trilha curta
  // (sem a etapa inserida) continua na Validação, para nunca apontar além da lista.
  it("em correção aponta para a etapa Correção da trilha de 3 passos", () => {
    expect(
      posicaoDaImobiliaria({
        entidadeStatus: "attention",
        papelStatus: "review",
        totalEtapas: 3,
      }),
    ).toBe(1);
  });

  it("em correção com trilha SEM a etapa inserida fica na Validação", () => {
    expect(
      posicaoDaImobiliaria({
        entidadeStatus: "attention",
        papelStatus: "review",
        totalEtapas: 2,
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

// ---------------------------------------------------------------------------
// O BECO SEM SAÍDA (achado da revisão adversarial, 17/08/2026)
// ---------------------------------------------------------------------------

describe("habilitar depois que o credenciamento foi derrubado", () => {
  // Medido em produção: das 420 imobiliárias com papel `active`, as 38 que têm vínculo de
  // empreendimento têm 100% deles `verified`. Com a trava olhando só para "empreendimento novo",
  // NENHUMA delas voltaria a ser habilitada pela tela depois de a validação ser reaberta — o
  // botão exigia algo novo que não existia, e não há outro caminho no rodapé.
  const lista = [
    { enterpriseId: "35", habilitado: true },
    { enterpriseId: "40", habilitado: true },
  ];
  const todosMarcados = { "35": true, "40": true };

  it("papel derrubado + tudo já verified: o botão ACENDE para reativar", () => {
    expect(podeHabilitar(lista, todosMarcados, "review")).toBe(true);
    expect(ehReativacao(lista, todosMarcados, "review")).toBe(true);
  });

  it("recusada também consegue voltar", () => {
    expect(podeHabilitar(lista, todosMarcados, "blocked")).toBe(true);
  });

  it("já habilitada e sem nada novo continua TRAVADA: é a regra do clique repetido", () => {
    expect(podeHabilitar(lista, todosMarcados, "active")).toBe(false);
    expect(ehReativacao(lista, todosMarcados, "active")).toBe(false);
  });

  it("empreendimento NOVO acende o botão em qualquer estado, e não é reativação", () => {
    const comNovo = [...lista, { enterpriseId: "42", habilitado: false }];
    const marcados = { ...todosMarcados, "42": true };

    expect(podeHabilitar(comNovo, marcados, "active")).toBe(true);
    expect(ehReativacao(comNovo, marcados, "review")).toBe(false);
  });

  it("sem marcar nada, nem a reativação acende", () => {
    // Reativar sem escolher empreendimento nenhum gravaria uma habilitação vazia.
    expect(podeHabilitar(lista, {}, "review")).toBe(false);
  });

  it("sem saber o papel, mantém o comportamento antigo", () => {
    // Chamada sem o terceiro argumento (código que ainda não passa o papel) não pode virar
    // botão aceso por engano.
    expect(podeHabilitar(lista, todosMarcados)).toBe(false);
  });
});
