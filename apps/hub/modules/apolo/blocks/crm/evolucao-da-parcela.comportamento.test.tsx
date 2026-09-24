// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// EVOLUÇÃO DA PARCELA — o que esta sub-aba não pode deixar de fazer.
//
// Os números do dublê são os do contrato REAL do print do Lucas (LOS0617, Thiago): contrato de
// R$ 452,43, 8% a.a. + IPCA ANUAL, e o quadro anual que a regra do contrato dá para ele.
//
// ⚠️ O QUE ESTE ARQUIVO TRAVA:
//   • é a conta do CONTRATO: nem a parcela que a cobrança lançou (R$ 481,94) nem os degraus do
//     caixa aparecem, porque contradiriam o quadro (R$ 484,00 no mesmo ano);
//   • cada linha decompõe a parcela, e o ano estimado vem marcado;
//   • a premissa (% ao mês) fica VISÍVEL, e só quando há ano estimado;
//   • trocar de cenário NÃO refaz a busca: os três quadros vêm na mesma resposta;
//   • PRICE não chama de amortização a parcela que já tem juros;
//   • correção negativa aparece com sinal;
//   • contrato sem quadro DIZ por quê, em vez de sumir com a seção;
//   • manda o Bearer (a lição que custou a v1.366.0, no mesmo dia).
//
// ⚠️ NÃO MOCKE `apolo-derive` AQUI, e a razão é medida: mockar o módulo inteiro (só para trocar
// `entityC2xId`) apaga o resto dele — `buyerStatusLabel`, `resolveCarteiraRoles` — para os outros
// arquivos que dividem o mesmo worker do vitest. Com esse mock, SEIS testes de outras frentes
// (espelho público, simulador, TelaVenda, termo de acordo) caíam, e passavam isolados; sem ele, a
// suíte fecha em 8.292. Custou quatro pushes barrados para eu olhar no lugar certo. A função real
// só lê `hadesClientId`, então basta montar a entity como ela é.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/modules/apolo/data/apolo-operations", () => ({
  getApoloAccessToken: async () => "token-de-teste",
}));

const { EvolucaoDaParcela } = await import("./evolucao-da-parcela");

// O quadro anual real do LOS0617 (aniversário 02/08, IPCA mês a mês), três primeiros ciclos.
const QUADRO = {
  jurosAnualPct: 8,
  linhas: [
    { amortizacao: 452.43, ate: "202507", ateParcela: 11, ciclo: 1, correcao: 0, de: "202409",
      deParcela: 1, indicePct: 0, juros: 0, origem: "sem-reajuste" as const, parcela: 452.43,
      taxaDoAnoPct: 0, totalDoCiclo: 4976.73 },
    { amortizacao: 452.43, ate: "202607", ateParcela: 23, ciclo: 2, correcao: 12.2, de: "202508",
      deParcela: 12, indicePct: 5.13, juros: 19.37, origem: "publicado" as const, parcela: 484.0,
      taxaDoAnoPct: 13.13, totalDoCiclo: 5808.0 },
    { amortizacao: 452.43, ate: "202807", ateParcela: 47, ciclo: 4, correcao: 72.51, de: "202708",
      deParcela: 36, indicePct: 5.37, juros: 97.88, origem: "estimado" as const, parcela: 622.82,
      taxaDoAnoPct: 13.37, totalDoCiclo: 7473.84 },
  ],
  sistema: "sacoc" as const,
  totalDeAmortizacao: 65149.92,
  totalDeCorrecao: 35933.66,
  totalDeJuros: 35166.96,
  totalDoContrato: 136250.54,
};

// O conservador diverge do tendência SÓ no ano estimado: é o que prova que o cenário troca o quadro.
const QUADRO_CONSERVADOR = {
  ...QUADRO,
  linhas: [
    ...QUADRO.linhas.slice(0, 2),
    { ...QUADRO.linhas[2]!, correcao: 83.38, indicePct: 6.14, parcela: 633.69, totalDoCiclo: 7604.28 },
  ],
  totalDeCorrecao: 42103.66,
  totalDoContrato: 142420.54,
};

const CONTRATO = {
  codigo: "LOS0617",
  contratoId: 1066,
  defasagemPct: 6.52,
  empreendimento: "LAVRA DO OURO",
  encerrado: false,
  eventos: [
    {
      competencia: "07/2026",
      de: 452.43,
      parcela: 10,
      para: 481.94,
      persistencia: 3,
      // O rótulo no formato REAL de `rotuloDoEvento`: ele traz o valor que a cobrança lançou.
      rotulo: "Reajuste contratual aplicado em 03/2026: de R$ 452,43 para R$ 481,94 (+6,5%).",
      tipo: "reajuste" as const,
      variacao: 0.0652,
    },
  ],
  indice: "IPCA" as const,
  indiceDoContrato: "IPCA ANUAL",
  indiceNoAno: 4.22,
  indicePublicadoAte: "202608",
  linhas: [
    { competencia: "202609", origem: "real" as const, valor: 481.94 },
    { competencia: "202709", origem: "projetado" as const, valor: 507.83 },
    { competencia: "202809", origem: "projetado" as const, valor: 535.12 },
  ],
  mensalidadeBase: 452.43,
  mensalidadeVigente: 481.94,
  mesTipicoPct: 0.437,
  jurosAnualPct: 8,
  sistema: "sacoc" as const,
  mesTipicoPorCenario: { conservador: 0.498, otimista: 0.296, tendencia: 0.437 },
  quadros: {
    conservador: QUADRO_CONSERVADOR,
    otimista: QUADRO,
    tendencia: QUADRO,
  },
};

let container: HTMLDivElement;
let root: Root;
let pedidos: { init?: RequestInit; url: string }[] = [];

function texto(): string {
  return container.textContent ?? "";
}

/** A forma real: `entityC2xId` tira o número do fim de `hadesClientId`. */
const COM_CARTEIRA = { hadesClientId: "c2x-1398" };
const SEM_CARTEIRA = { hadesClientId: null };

async function montar(payload: unknown = [CONTRATO], entity: unknown = COM_CARTEIRA) {
  pedidos = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      pedidos.push({ init, url });
      // A rota do PDF devolve blob, não JSON: o dublê precisa das duas formas, senão o teste do
      // botão passaria por um caminho que não existe em produção.
      if (url.includes("/pdf")) {
        return {
          blob: async () => new Blob(["%PDF-1.7"], { type: "application/pdf" }),
          headers: new Headers({
            "content-disposition": 'attachment; filename="Evolucao.pdf"',
          }),
          ok: true,
        };
      }
      return { json: async () => ({ data: payload }), ok: true };
    }),
  );

  await act(async () => {
    root.render(React.createElement(EvolucaoDaParcela, { entity } as never));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  // ⚠️ O DOWNLOAD AGENDA UM TIMER DE 60 s para revogar o blob (a correção do defeito do Isac).
  // Sem limpar, cada teste que clica no PDF deixa esse timer pendurado no ambiente do jsdom até o
  // fim da suíte — e a suíte inteira roda com 8.292 testes disputando a mesma máquina.
  vi.clearAllTimers();
});

describe("EvolucaoDaParcela", () => {
  it("mostra os insumos do quadro: valor de contrato, juros e índice do contrato", async () => {
    await montar();
    const t = texto();
    expect(t).toContain("452,43");
    expect(t).toContain("8,00% a.a.");
    expect(t).toContain("IPCA ANUAL");
  });

  it("⚠️ NÃO mostra a 'parcela de hoje' nem os degraus do caixa: contradiriam o quadro", async () => {
    // R$ 481,94 é o que o lote da Lavra lançou (IPCA de 2025 fechado); o quadro, pela regra do
    // contrato, dá R$ 484,00 no mesmo ano. O dublê traz o evento com o rótulo REAL, que carrega o
    // 481,94: se a lista de degraus voltar para a tela, este teste cai.
    await montar();
    expect(texto()).not.toContain("481,94");
    expect(texto()).not.toContain("O que já aconteceu");
  });

  it("⚠️ cada ciclo decompõe a parcela: amortização, juros, correção e valor", async () => {
    await montar();
    const t = texto();
    expect(t).toContain("ago/2025 a jul/2026");
    expect(t).toContain("19,37");
    expect(t).toContain("12,20");
    expect(t).toContain("484,00");
    // O índice do aniversário aparece ao lado da correção.
    expect(t).toContain("5,13%");
  });

  it("⚠️ o ano estimado vem MARCADO, e o aviso de que não é promessa fica no corpo", async () => {
    await montar();
    const t = texto();
    expect(t).toContain("estimativa");
    expect(t).toContain("Não é promessa");
  });

  it("fecha o contrato inteiro: amortização + juros + correção = total", async () => {
    await montar();
    const t = texto();
    expect(t).toContain("Total do contrato");
    expect(t).toContain("65.149,92");
    expect(t).toContain("35.166,96");
    expect(t).toContain("35.933,66");
    expect(t).toContain("136.250,54");
  });

  it("⚠️ a premissa fica visível: a regra SACOC e a taxa do cenário", async () => {
    await montar();
    const t = texto();
    expect(t).toContain("SACOC");
    expect(t).toContain("somado");
    expect(t).toContain("0,44% ao mês");
  });

  it("mostra até quando o índice está publicado, porque a fonte atrasa um mês", async () => {
    await montar();
    const t = texto();
    expect(t).toContain("ago/2026");
    expect(t).toContain("a fonte atrasa um mês");
  });

  it("⚠️ trocar de cenário troca o QUADRO sem refazer a busca (C2X e IBGE custam)", async () => {
    await montar();
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]?.url).not.toContain("cenario=");
    expect(texto()).toContain("622,82");

    const botao = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Conservador",
    );
    expect(botao).toBeDefined();
    await act(async () => {
      botao?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(pedidos).toHaveLength(1);
    expect(texto()).toContain("633,69");
    expect(texto()).toContain("142.420,54");
    expect(texto()).toContain("0,50% ao mês");
  });

  it("⚠️ manda o Bearer: sem ele a rota devolve 401", async () => {
    await montar();
    const cabecalhos = (pedidos[0]?.init?.headers ?? {}) as Record<string, string>;
    expect(cabecalhos.Authorization).toBe("Bearer token-de-teste");
  });

  it("⚠️ contrato sem quadro DIZ por quê, em vez de sumir com a seção", async () => {
    await montar([
      {
        ...CONTRATO,
        indice: null,
        indiceDoContrato: null,
        linhas: [],
        motivo: "O contrato não registra índice de correção, então o quadro não pode ser calculado.",
        quadros: undefined,
      },
    ]);
    const t = texto();
    expect(t).toContain("não registra índice de correção");
    // O insumo continua aparecendo.
    expect(t).toContain("452,43");
  });

  it("⚠️ juro NÃO registrado aparece como tal, e não como '0,00% a.a.'", async () => {
    await montar([
      {
        ...CONTRATO,
        jurosAnualPct: null,
        motivo: "O plano do contrato não registra a taxa de juros, então o quadro não pode ser calculado.",
        quadros: undefined,
      },
    ]);
    const t = texto();
    expect(t).toContain("não registrado");
    expect(t).not.toContain("0,00% a.a.");
  });

  it("⚠️ PRICE: a coluna é 'Parcela de origem' (ela já tem juros), e o total de juros não diz R$ 0,00", async () => {
    const price = {
      ...QUADRO,
      jurosAnualPct: 0,
      linhas: QUADRO.linhas.map((l) => ({ ...l, juros: 0, parcela: l.amortizacao + l.correcao })),
      sistema: "price" as const,
      totalDeJuros: 0,
    };
    await montar([
      { ...CONTRATO, quadros: { conservador: price, otimista: price, tendencia: price }, sistema: "price" },
    ]);
    const t = texto();
    expect(t).toContain("Parcela de origem");
    expect(t).not.toContain("Amortização");
    expect(t).toContain("já com juros");
    expect(t).toContain("PRICE");
    expect(t).not.toContain("R$ 0,00");
  });

  it("⚠️ correção NEGATIVA (IGP-M de 2023/24) aparece com sinal, e não como '-'", async () => {
    const negativo = {
      ...QUADRO,
      linhas: [
        QUADRO.linhas[0]!,
        { ...QUADRO.linhas[1]!, correcao: -20.64, indicePct: -7.71, parcela: 451.16 },
      ],
    };
    await montar([
      { ...CONTRATO, quadros: { conservador: negativo, otimista: negativo, tendencia: negativo } },
    ]);
    const t = texto();
    expect(t).toContain("-7,71%");
    expect(t).toMatch(/-R\$\s?20,64/);
  });

  it("sem ano estimado, a tela não fala em taxa de cenário", async () => {
    const soPublicado = { ...QUADRO, linhas: QUADRO.linhas.slice(0, 2) };
    await montar([
      {
        ...CONTRATO,
        quadros: { conservador: soPublicado, otimista: soPublicado, tendencia: soPublicado },
      },
    ]);
    const t = texto();
    expect(t).not.toContain("marcados como estimativa");
    expect(t).toContain("Não é promessa");
  });

  it("contrato SEM correção diz 'sem correção' na linha e não soma R$ 0,00 de correção", async () => {
    const semCorrecao = {
      ...QUADRO,
      linhas: [
        QUADRO.linhas[0]!,
        { ...QUADRO.linhas[1]!, correcao: 0, indicePct: 0, origem: "sem-correcao" as const, parcela: 471.8 },
      ],
      totalDeCorrecao: 0,
    };
    await montar([
      {
        ...CONTRATO,
        indice: null,
        indiceDoContrato: "SEM CORREÇÃO",
        quadros: { conservador: semCorrecao, otimista: semCorrecao, tendencia: semCorrecao },
      },
    ]);
    const t = texto();
    expect(t).toContain("sem correção");
    expect(t).not.toContain("R$ 0,00");
  });

  it("⚠️ o PDF leva o cenário que está na TELA (para a rota saber qual é o destacado)", async () => {
    await montar();

    const conservador = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "Conservador",
    );
    await act(async () => {
      conservador?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const pdf = [...container.querySelectorAll("button")].find((b) => b.textContent === "PDF");
    expect(pdf).toBeDefined();
    await act(async () => {
      pdf?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const doPdf = pedidos.find((p) => p.url.includes("/pdf"));
    expect(doPdf?.url).toContain("cenario=conservador");
    const cabecalhos = (doPdf?.init?.headers ?? {}) as Record<string, string>;
    expect(cabecalhos.Authorization).toBe("Bearer token-de-teste");
  });

  it("cadastro sem ligação com o C2X explica, em vez de girar para sempre", async () => {
    await montar([CONTRATO], SEM_CARTEIRA);
    expect(texto()).toContain("não está ligado a um cliente do C2X");
    expect(pedidos).toHaveLength(0);
  });

  it("cliente sem contrato não deixa a aba vazia sem explicação", async () => {
    await montar([]);
    expect(texto()).toContain("não tem contrato com parcelas");
  });

  it("erro da rota aparece, com caminho de volta", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ json: async () => ({ error: "C2X fora do ar." }), ok: false })),
    );
    await act(async () => {
      root.render(
        React.createElement(EvolucaoDaParcela, { entity: COM_CARTEIRA } as never),
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(texto()).toContain("C2X fora do ar.");
    expect(texto()).toContain("Tentar de novo");
  });
});
