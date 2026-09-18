import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PropostaParaPdf } from "@/lib/hercules/proposta-pdf";

// REVISÃO DE SEGURANÇA DA ROTA PÚBLICA DO PDF DA SIMULAÇÃO (rodada 3, 18/09/2026).
//
// A página não tem login e a folha sai com a marca da casa. Aqui se escreve o corpo À MÃO, como um
// curioso com o DevTools aberto faria, e se confere o que chega à folha. Os dublês são os de
// `route.test.ts` (token, estado do espelho, planos, piso e o desenhista do PDF, que só guarda a
// folha); `montarCronograma` e `montarFolhaDaProposta` são os de verdade.
//
// Os quatro casos que tinham DEFEITO no nome (entrada em vezes sem teto, 20.000 vezes, a mensagem
// interna do motor e o corpo `null`) foram corrigidos na rodada 3 (18/09/2026): a entrada em vezes
// entrou na régua do plano (`valoresDaSimulacaoPublica`, presa em 1 a `ENTRADA_VEZES_MAXIMA`), só a
// frase do motor vai ao visitante, e corpo que não é objeto é corpo vazio (400). Perderam o DEFEITO.

const estado = vi.hoisted(() => ({
  codigosPedidos: [] as unknown[],
  folhas: [] as unknown[],
  idsPedidos: [] as unknown[],
  lotes: [] as Array<{ codigo: string; preco: null | number; situacao: "disponivel" | "indisponivel" }>,
  piso: 8 as null | number,
  semColunaDeDesconto: false,
}));

const BASE_DO_PLANO = {
  indiceCorrecao: "IPCA_ANUAL",
  jurosConvencao: "equivalente",
  jurosPeriodicidade: "anual",
  sistemaAmortizacao: "sacoc",
} as const;

vi.mock("@/lib/hercules/espelho/abrir-espelho", () => {
  // A unidade que o `select` de `hercules_unidades` devolve. Guarda o recorte pedido (ids da árvore
  // e código) para conferir que a leitura nunca sai do empreendimento do token.
  const cadeia = {
    eq: (_c: string, v: unknown) => {
      estado.codigosPedidos.push(v);
      return cadeia;
    },
    in: (_c: string, v: unknown) => {
      estado.idsPedidos.push(v);
      return cadeia;
    },
    maybeSingle: async () => ({
      data: {
        area: 420,
        codigo: "GDN1110",
        lote: "10",
        preco_tabela: 435_000,
        quadra: "11",
        situacao: "disponivel",
      },
      error: null,
    }),
    select: () => cadeia,
  };
  const client = {
    from: () => cadeia,
    storage: { from: () => ({ download: async () => ({ data: null, error: { message: "sem logo" } }) }) },
  };
  return {
    abrirEspelho: async (token: null | string) =>
      token
        ? {
            espelho: {
              client,
              codigo: "garden",
              filhosC2xIds: [],
              masterplan: null,
              nome: "Garden",
              paiC2xId: "39",
            },
            ok: true,
          }
        : { erro: "sem_token", ok: false },
    ERRO_GENERICO: "Link inválido ou indisponível.",
  };
});

vi.mock("@/lib/hercules/espelho/estado-do-espelho", () => ({
  estadoDoEspelho: async () => ({
    atualizadoEm: "2026-09-18T12:00:00.000Z",
    contagem: { disponivel: 0, indisponivel: 0 },
    lotes: estado.lotes,
  }),
}));

vi.mock("@/lib/hercules/espelho/planos-publicos", () => ({
  pisoDeEntradaPublico: async () => estado.piso,
  planosPublicos: async () =>
    [
      { ...BASE_DO_PLANO, anuaisQuantidade: 5, anuaisValor: 25_000, descontoPercentual: 0, entradaPercentual: 10, jurosTaxa: 6, nome: "NORMAL", parcelas: 60 },
      { ...BASE_DO_PLANO, anuaisQuantidade: 4, anuaisValor: 25_000, descontoPercentual: 8, entradaPercentual: 8, jurosTaxa: 6, nome: "INVESTIDOR PARCELADO", parcelas: 84 },
      { ...BASE_DO_PLANO, anuaisQuantidade: 3, anuaisValor: 30_000, descontoPercentual: 12, entradaPercentual: 40, jurosTaxa: 0, nome: "INVESTIDOR", parcelas: 36 },
    ].map((p) =>
      // A 0178 ainda não aplicada: `planosPublicos` devolve o plano sem desconto (0).
      estado.semColunaDeDesconto ? { ...p, descontoPercentual: 0 } : p,
    ),
}));

vi.mock("@/lib/hercules/proposta-pdf", () => ({
  montarPropostaPdf: async (folha: unknown) => {
    estado.folhas.push(folha);
    return new Uint8Array([37, 80, 68, 70]);
  },
}));

const { POST } = await import("./route");

function pedirCru(corpo: string, token: null | string = "tok") {
  return POST(
    new Request(`https://c2x.app.br/api/publico/espelho/simulacao${token ? `?e=${token}` : ""}`, {
      body: corpo,
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
}
const pedir = (corpo: Record<string, unknown>, token: null | string = "tok") =>
  pedirCru(JSON.stringify(corpo), token);

type Folha = PropostaParaPdf & {
  condicoes: Array<{ rotulo: string; valor: string }>;
  destaques: Array<{ detalhe: string; rotulo: string; valor: string }>;
};
const ultimaFolha = () => estado.folhas.at(-1) as Folha;
const destaque = (rotulo: string) => ultimaFolha().destaques.find((d) => d.rotulo === rotulo);
const condicao = (rotulo: string) => ultimaFolha().condicoes.find((c) => c.rotulo === rotulo)?.valor;

/** O maior desconto que a folha pode dizer, em %, lido do texto "8% · R$ 34.800,00". */
function descontoImpresso(): number {
  const texto = condicao("Desconto");
  if (!texto) return 0;
  return Number(texto.split("%")[0]!.replace(",", "."));
}
/** A entrada impressa, em reais. */
function reaisDoTexto(texto: string | undefined): number {
  return Number(String(texto).replace(/[^\d,]/g, "").replace(",", "."));
}

/** O que a tela manda para o INVESTIDOR PARCELADO do lote de R$ 435.000. */
const DA_TELA = {
  anuaisQuantidade: 4,
  anuaisValor: 25_000,
  codigo: "GDN1110",
  entrada: 32_016,
  entradaVezes: 1,
  parcelas: 84,
  plano: "INVESTIDOR PARCELADO",
  valor: 400_200,
};

/** O desconto e a entrada mínima que CADA plano permite, no prazo dele. */
const REGRA = {
  INVESTIDOR: { desconto: 12, entradaMin: 0.4, parcelas: 36 },
  "INVESTIDOR PARCELADO": { desconto: 8, entradaMin: 0.08, parcelas: 84 },
  NORMAL: { desconto: 0, entradaMin: 0.1, parcelas: 60 },
} as const;

beforeEach(() => {
  estado.folhas.length = 0;
  estado.idsPedidos.length = 0;
  estado.codigosPedidos.length = 0;
  estado.lotes = [{ codigo: "GDN1110", preco: 435_000, situacao: "disponivel" }];
  estado.piso = 8;
  estado.semColunaDeDesconto = false;
});

describe("revisão de segurança: o que um corpo forjado NÃO consegue imprimir (conferido)", () => {
  it("desconto: nenhuma combinação de plano × prazo × valor imprime mais que o desconto do plano no prazo dele", async () => {
    const valores: unknown[] = [1, 0, -1, "1", "abc", null, 1e308, 217_500, 382_800, 400_199.99, "400200", 3.5e5];
    const prazos: unknown[] = [undefined, 0, -84, 1, 12, 35, 36, 36.4, 35.6, "36", 59, 60, 61, 83, 83.5, 84, "84", 84.4, "1e1"];
    let folhas = 0;
    let maiorExcesso = -Infinity;
    for (const plano of Object.keys(REGRA) as Array<keyof typeof REGRA>) {
      for (const parcelas of prazos) {
        for (const valor of valores) {
          const antes = estado.folhas.length;
          const r = await pedir({ ...DA_TELA, anuaisQuantidade: 0, entrada: 0, parcelas, plano, valor });
          if (r.status !== 200) {
            expect([422]).toContain(r.status);
            continue;
          }
          expect(estado.folhas.length).toBe(antes + 1);
          folhas += 1;
          const mensais = Number(condicao("Parcelas mensais"));
          // O desconto só vale no prazo EXATO do plano; fora dele, zero.
          const permitido = mensais === REGRA[plano].parcelas || mensais === 0 ? REGRA[plano].desconto : 0;
          maiorExcesso = Math.max(maiorExcesso, descontoImpresso() - permitido);
          expect(descontoImpresso()).toBeLessThanOrEqual(permitido);
        }
      }
    }
    // Medido: 12 valores × 19 prazos × 3 planos, e nenhuma folha passou do desconto do plano.
    expect(folhas).toBeGreaterThan(400);
    expect(maiorExcesso).toBeLessThanOrEqual(0);
  });

  it("entrada: nenhum corpo imprime entrada abaixo do maior entre o piso (8%), o plano e o degrau do prazo", async () => {
    const entradas: unknown[] = [0, -1, 1, "abc", null, "1e3", 32_015.99, Number.MIN_VALUE, 1e-9];
    for (const plano of Object.keys(REGRA) as Array<keyof typeof REGRA>) {
      for (const entrada of entradas) {
        const r = await pedir({ ...DA_TELA, anuaisQuantidade: 0, entrada, parcelas: REGRA[plano].parcelas, plano, valor: 1 });
        expect(r.status).toBe(200);
        const valor = reaisDoTexto(destaque("Valor da unidade")?.valor);
        const impressa = reaisDoTexto(destaque("Entrada")?.valor);
        expect(impressa).toBeGreaterThanOrEqual(Math.max(0.08, REGRA[plano].entradaMin) * valor - 0.01);
      }
    }
  });

  it("anuais: quantidade presa a floor(prazo/12) em qualquer lixo (10, 1e9, '7', 3.6, -1)", async () => {
    for (const [parcelas, pedidas, esperado] of [
      [36, 10, 3],
      [36, 1e9, 3],
      [84, "7", 7],
      [84, 3.6, 4],
      [84, -1, 4], // lixo vira o do plano
      [11, 5, 0],
    ] as const) {
      const plano = parcelas === 36 ? "INVESTIDOR" : "INVESTIDOR PARCELADO";
      const r = await pedir({ ...DA_TELA, anuaisQuantidade: pedidas, anuaisValor: 1_000, entrada: 0, parcelas, plano, valor: 1 });
      expect(r.status).toBe(200);
      const texto = condicao("Parcelas anuais");
      expect(texto ? Number(texto.split(" ")[0]) : 0).toBe(esperado);
    }
  });

  it("prazo além do plano, em qualquer grafia, é 422 sem folha (37, '37', 36.6, 1e308)", async () => {
    for (const parcelas of [37, "37", 36.6, 1e308]) {
      const r = await pedir({ ...DA_TELA, anuaisQuantidade: 0, parcelas, plano: "INVESTIDOR", valor: 1 });
      expect(r.status).toBe(422);
    }
    expect(estado.folhas).toHaveLength(0);
  });

  it("valores enormes nas anuais não viram folha: 422 com a frase, e nenhuma folha", async () => {
    for (const anuaisValor of [1e308, 9e15, 500_000]) {
      const r = await pedir({ ...DA_TELA, anuaisValor });
      expect(r.status).toBe(422);
    }
    expect(estado.folhas).toHaveLength(0);
  });

  it("lote: fora do verde é 409, de outro empreendimento (fora do espelho) é 409, e a leitura da unidade fica na árvore do token", async () => {
    estado.lotes = [
      { codigo: "GDN1110", preco: 435_000, situacao: "disponivel" },
      { codigo: "GDN0101", preco: 435_000, situacao: "indisponivel" },
    ];
    expect((await pedir({ ...DA_TELA, codigo: "GDN0101" })).status).toBe(409);
    // Um código do Vale do Ouro, que este espelho não pinta.
    expect((await pedir({ ...DA_TELA, codigo: "VLO0701" })).status).toBe(409);
    // Minúsculo e com espaço: é o mesmo lote, e continua na árvore.
    expect((await pedir({ ...DA_TELA, codigo: "  gdn1110 " })).status).toBe(200);
    expect(estado.idsPedidos.every((ids) => JSON.stringify(ids) === JSON.stringify(["39"]))).toBe(true);
    expect(estado.folhas).toHaveLength(1);
  });

  it("sem a coluna do desconto (0178 não aplicada), nenhum plano imprime desconto", async () => {
    estado.semColunaDeDesconto = true;
    for (const plano of Object.keys(REGRA) as Array<keyof typeof REGRA>) {
      const r = await pedir({ ...DA_TELA, anuaisQuantidade: 0, entrada: 0, parcelas: REGRA[plano].parcelas, plano, valor: 1 });
      expect(r.status).toBe(200);
      expect(condicao("Desconto")).toBeUndefined();
      expect(destaque("Valor da unidade")?.valor).toBe("R$ 435.000,00");
    }
  });

  it("plano com nome forjado cai no primeiro plano (NORMAL), sem desconto", async () => {
    for (const plano of ["investidor", "INVESTIDOR ", { nome: "INVESTIDOR" }, ["INVESTIDOR"], null]) {
      const r = await pedir({ ...DA_TELA, anuaisQuantidade: 0, entrada: 0, parcelas: 60, plano, valor: 1 });
      expect(r.status).toBe(200);
      expect(condicao("Desconto")).toBeUndefined();
    }
  });
});

describe("revisão de segurança: a entrada em vezes, a mensagem do motor e o corpo que não é objeto", () => {
  it("medição: entradaVezes acima de 12 é preso ao teto da tela (era sem teto até o cronograma)", async () => {
    const linhas: string[] = [];
    for (const entradaVezes of [12, 13, 60, 84, 240]) {
      const r = await pedir({ ...DA_TELA, entradaVezes });
      expect(r.status).toBe(200);
      const f = ultimaFolha();
      linhas.push(
        `${entradaVezes}x: entrada ${destaque("Entrada")?.valor} (${destaque("Entrada")?.detalhe}) · ` +
          `1ª mensal ${condicao("Primeira mensal")} · última ${condicao("Última parcela")} · ` +
          `mensal ${destaque("Parcela mensal")?.valor} · linhas da entrada ${f.entrada?.length ?? "?"}`,
      );
    }
    console.log(linhas.join("\n"));
  });

  it("entradaVezes além do teto da tela (12) não imprime entrada em 84 vezes nem 7 anos de carência", async () => {
    const r = await pedir({ ...DA_TELA, entradaVezes: 84 });
    // A régua certa: ou prende em 12 (como o valor e as anuais), ou recusa com 422.
    if (r.status === 200) {
      expect(destaque("Entrada")?.detalhe).not.toMatch(/84/);
      expect(destaque("Entrada")?.detalhe).toMatch(/(^|\D)(1[0-2]|[1-9])\s*(x|×|vezes)/i);
    } else {
      expect(r.status).toBe(422);
      expect(estado.folhas).toHaveLength(0);
    }
  });

  // ⚠️ O MESMO CAMPO É UM AMPLIFICADOR (medido no rascunho r3/seg, 18/09/2026): com o desenhista de
  // PDF de verdade, 20.000 vezes deram 573 páginas e 1,4 s; 100.000 vezes, 2.858 páginas, 9,7 MB,
  // 7,4 s e 936 MB de heap; 10.000.000 vezes derrubam o processo (heap de 2 GB esgotado em 15 s,
  // ainda no cronograma). Um corpo de 200 bytes, sem login.
  it("entradaVezes 20.000 não vira 20.000 linhas de entrada na folha (eram 573 páginas no PDF real)", async () => {
    const r = await pedir({ ...DA_TELA, entradaVezes: 20_000 });
    const linhas = r.status === 200 ? ultimaFolha().entrada.length : 0;
    console.log(`20.000 vezes: status ${r.status}, ${linhas} linhas de entrada na folha`);
    expect(linhas).toBeLessThanOrEqual(12);
  });

  it("medição (não é defeito da rota: a tela deixa o mesmo): o valor da anual não tem teto, e a mensal vai a quase zero", async () => {
    const r = await pedir({ ...DA_TELA, anuaisQuantidade: 7, anuaisValor: 52_500 });
    expect(r.status).toBe(200);
    console.log(
      `7 × R$ 52.500 no INVESTIDOR PARCELADO: financiado ${destaque("Financiado")?.valor}, mensal ${destaque("Parcela mensal")?.valor}`,
    );
  });

  it("entradaVezes enorme (1e10) não devolve a mensagem interna do motor ('Invalid array length') ao visitante", async () => {
    // Antes: 422 com "Invalid array length". Agora a régua prende as vezes em 12 e a folha sai; se
    // algum dia o motor lançar um erro que não é a recusa dele, a frase ao visitante é a genérica.
    const r = await pedir({ ...DA_TELA, entradaVezes: 1e10 });
    if (r.status === 200) {
      expect(ultimaFolha().entrada.length).toBe(12);
    } else {
      const corpo = (await r.json()) as { error: string };
      expect(corpo.error).not.toMatch(/array|length|undefined|TypeError|RangeError/i);
    }
    expect(r.status).toBe(200);
  });

  it("corpo JSON 'null' não derruba a rota (era exceção não tratada, 500): é 400", async () => {
    let status: number | string;
    try {
      status = (await pedirCru("null")).status;
    } catch (erro) {
      status = `lançou ${(erro as Error).constructor.name}: ${(erro as Error).message}`;
    }
    console.log(`corpo null: ${status}`);
    expect(status).toBe(400);
  });

  it("número, lista ou texto no lugar do corpo também são 400, sem folha", async () => {
    for (const cru of ["7", "[]", '["GDN1110"]', '"GDN1110"', "true"]) {
      expect((await pedirCru(cru)).status).toBe(400);
    }
    expect(estado.folhas).toHaveLength(0);
  });
});
