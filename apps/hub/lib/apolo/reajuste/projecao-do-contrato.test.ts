import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type ExtratoClienteContrato,
  type ExtratoClienteData,
  type ExtratoClienteRelatorio,
  TIPO_MENSAL,
} from "@/lib/apolo/extrato-cliente";
import { mesAnterior, type SerieMensal } from "@/lib/apolo/reajuste/serie-de-indice";

// ⚠️ SÓ AS DUAS PORTAS PARA FORA SÃO TROCADAS: o C2X e a fonte do índice. O resto (a regra, o
// quadro, a decisão de montar ou não) roda de verdade. E a série entra por mock PARCIAL, porque o
// `quadro-anual` usa o `mesAnterior` de verdade do mesmo módulo.
vi.mock("@/lib/apolo/extrato-cliente-c2x", () => ({ loadExtratoDoCliente: vi.fn() }));
vi.mock("@/lib/apolo/reajuste/serie-de-indice", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/apolo/reajuste/serie-de-indice")>()),
  buscarSerie: vi.fn(),
}));

const { loadExtratoDoCliente } = await import("@/lib/apolo/extrato-cliente-c2x");
const { buscarSerie } = await import("@/lib/apolo/reajuste/serie-de-indice");
const { evolucaoDosContratos } = await import("@/lib/apolo/reajuste/projecao-do-contrato");

function serieDe(ate: string, meses: number, variacao: number): SerieMensal {
  const serie: SerieMensal = new Map();
  let cursor = ate;
  for (let i = 0; i < meses; i += 1) {
    serie.set(cursor, variacao);
    cursor = mesAnterior(cursor);
  }
  return serie;
}

/** `quantas` mensais a partir da parcela `desde`, vencendo todo dia 20 desde `vencimento`. */
function mensais(desde: number, vencimento: string, quantas: number, valor = 452.43) {
  return Array.from({ length: quantas }, (_, i) => {
    const total = Number(vencimento.slice(0, 4)) * 12 + Number(vencimento.slice(5, 7)) - 1 + i;
    const mes = String((total % 12) + 1).padStart(2, "0");
    return {
      ordem: desde + i,
      tipoId: TIPO_MENSAL,
      valorContratual: valor,
      vencimento: `${Math.floor(total / 12)}-${mes}-20`,
    };
  });
}

// O LOS0617: ato em 02/08/2024, 144 × R$ 452,43, 8% a.a. + IPCA, empreendimento SACOOC.
const CONTRATO: ExtratoClienteContrato = {
  area: 250,
  codigo: "LOS0617",
  dataAssinatura: "2024-08-05",
  dataAto: "2024-08-02",
  empreendimentoCodigo: "LOS",
  empreendimentoNome: "LAVRA DO OURO",
  encerrado: false,
  estagio: 5,
  estagioNome: "Faturado",
  id: 1398,
  indiceCorrecao: "IPCA ANUAL",
  jurosContratuais: 8,
  lote: "17",
  planoNome: "PLANO-NORMAL",
  planoPadraoParcelas: 144,
  planoParcelas: 144,
  planoPersonalizado: false,
  precoTabela: 72388,
  quadra: "06",
  tabelaDoEmpreendimento: "SACOOC",
  titulares: [],
};

function extratoCom(
  contrato: Partial<ExtratoClienteContrato> = {},
  parcelas = mensais(1, "2024-09-20", 144),
  mensalidadeBase = 452.43,
): { data: ExtratoClienteData; ok: true } {
  const relatorio = {
    abertas: parcelas,
    contrato: { ...CONTRATO, ...contrato },
    eventos: [],
    notas: [],
    posicaoEm: "2026-09-24",
    realizados: [],
    totais: { defasagem: 0, mensalidadeBase, mensalidadeVigente: mensalidadeBase },
  } as unknown as ExtratoClienteRelatorio;
  return {
    data: {
      cliente: { c2xId: 1398, documentoMascarado: null, nome: "Cliente de teste" },
      contratos: [relatorio],
      posicaoEm: "2026-09-24",
    } as ExtratoClienteData,
    ok: true,
  };
}

async function evolucaoDe(...args: Parameters<typeof extratoCom>) {
  vi.mocked(loadExtratoDoCliente).mockResolvedValue(extratoCom(...args));
  const resultado = await evolucaoDosContratos({ c2xId: 1398 });
  if (!resultado.ok) throw new Error(resultado.error);
  const contrato = resultado.data[0];
  if (!contrato) throw new Error("sem contrato");
  return contrato;
}

beforeEach(() => {
  vi.mocked(buscarSerie).mockReset();
  vi.mocked(buscarSerie).mockResolvedValue(serieDe("202608", 240, 0.35));
});

describe("evolucaoDosContratos · quando o quadro sai", () => {
  it("o contrato em andamento sai com os TRÊS quadros e sem motivo", async () => {
    const c = await evolucaoDe();
    expect(c.motivo).toBeUndefined();
    expect(Object.keys(c.quadros ?? {}).sort()).toEqual(["conservador", "otimista", "tendencia"]);
    expect(c.sistema).toBe("sacoc");
    expect(c.jurosAnualPct).toBe(8);
    expect(c.mesTipicoPorCenario?.tendencia).not.toBeNull();
    expect(c.quadros?.tendencia.linhas[0]).toMatchObject({ de: "202409", deParcela: 1 });
  });

  it("contrato SEM CORREÇÃO sai com o quadro (só os juros), e sem motivo", async () => {
    const c = await evolucaoDe({ indiceCorrecao: "SEM CORREÇÃO" });
    expect(c.motivo).toBeUndefined();
    expect(c.quadros?.tendencia.linhas[1]?.origem).toBe("sem-correcao");
  });
});

describe("evolucaoDosContratos · ⚠️ quando o quadro NÃO sai, e diz por quê", () => {
  it("⚠️ contrato ENCERRADO não é projetado até o fim do prazo", async () => {
    // Antes: aviso "não há parcela futura" e, logo abaixo, 13 ciclos até 2036.
    const c = await evolucaoDe({ encerrado: true });
    expect(c.quadros).toBeUndefined();
    expect(c.motivo).toMatch(/encerrado/i);
  });

  it("⚠️ pedido SEM PLANO (juro e índice nulos) não vira 'juros 0,00%'", async () => {
    // O LOS0619: mesmo produto do LOS0617, e o quadro saía R$ 71 mil abaixo do real.
    const c = await evolucaoDe({ indiceCorrecao: null, jurosContratuais: null });
    expect(c.quadros).toBeUndefined();
    expect(c.jurosAnualPct).toBeNull();
    expect(c.motivo).toMatch(/não tem plano comercial/);
  });

  it("plano com índice mas sem taxa de juros também não sai (SACOC precisa do juro)", async () => {
    const c = await evolucaoDe({ jurosContratuais: null });
    expect(c.quadros).toBeUndefined();
    expect(c.motivo).toMatch(/não registra a taxa de juros/);
  });

  it("contrato sem índice registrado não sai com correção zerada", async () => {
    const c = await evolucaoDe({ indiceCorrecao: null });
    expect(c.quadros).toBeUndefined();
    expect(c.motivo).toMatch(/não registra índice de correção/);
  });

  it("índice sem série pública (TR) diz que a correção não pode ser calculada", async () => {
    const c = await evolucaoDe({ indiceCorrecao: "TR MENSAL" });
    expect(c.quadros).toBeUndefined();
    expect(c.motivo).toMatch(/não tem série pública/);
  });

  it("⚠️ série FORA DO AR: sem quadro, e o contrato avisa que é falha de agora", async () => {
    // Antes: o quadro saía com o total SEM correção (R$ 100 mil em vez de R$ 136 mil).
    vi.mocked(buscarSerie).mockRejectedValue(new Error("IBGE fora do ar"));
    const silencio = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const c = await evolucaoDe();
    silencio.mockRestore();
    expect(c.quadros).toBeUndefined();
    expect(c.serieIndisponivel).toBe(true);
    expect(c.motivo).toMatch(/Não consegui buscar a série do IPCA/);
  });
});

describe("evolucaoDosContratos · ⚠️ o que o C2X declara", () => {
  it("empreendimento PRICE (MDS) sai em PRICE mesmo quando a parcela não 'encaixa' na dedução", async () => {
    // MDS0805: erro PRICE de 2,1%, fora da tolerância de 2%; a dedução mandava para SACOC e o
    // quadro somava 8% a.a. por cima de uma parcela que já tem juros.
    const c = await evolucaoDe(
      {
        codigo: "MDS0805",
        jurosContratuais: 0.6434,
        planoNome: "MDS-NORMAL",
        planoParcelas: 60,
        precoTabela: 73278 * 1.021,
        tabelaDoEmpreendimento: "PRICE",
      },
      mensais(1, "2024-09-20", 60, 1446.31),
      1446.31,
    );
    expect(c.sistema).toBe("price");
    for (const linha of c.quadros?.tendencia.linhas ?? []) expect(linha.juros).toBe(0);
  });

  it("⚠️ LOS0404: o C2X começa na 18ª parcela, e o quadro começa na 1ª, em set/2024", async () => {
    const c = await evolucaoDe({}, mensais(18, "2026-02-20", 127));
    const linhas = c.quadros?.tendencia.linhas ?? [];
    expect(linhas[0]).toMatchObject({ de: "202409", deParcela: 1 });
    // E termina em ago/2036, como o contrato, e não em jan/2038.
    expect(linhas.at(-1)).toMatchObject({ ate: "203608", ateParcela: 144 });
  });
});
