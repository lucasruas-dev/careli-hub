import { beforeEach, describe, expect, it, vi } from "vitest";

// O DONO DO TRABALHO DA TÊMIS — quem confecciona (migration 0172).
//
// O que está travado aqui: o board da Careli filtra `operado_por is null` POR PADRÃO (a Careli deixa
// de ver o que a Cecílio confecciona); `todos` tira o filtro; o uuid recorta um incorporador; valor
// torto não consulta. E as tolerâncias à 0172 não aplicada: a leitura da Careli repete sem o
// filtro (e o processo lembra, para não pagar a consulta que falha a cada minuto), a do incorporador
// sai vazia, e o insert com dono RECUSA, salvo quando quem chama pede para gravar sem ele (revisão
// da onda 3, 16/09/2026).
//
// O Supabase é um construtor falso que ANOTA os filtros: o teste é da consulta que sai daqui, não do
// banco.

type Registro = { filtros: unknown[][]; insert?: Record<string, unknown> };

const estado = vi.hoisted(() => ({
  chamadas: [] as Registro[],
  respostas: [] as Array<{ data: unknown; error: unknown }>,
}));

vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () => ({
    from: () => {
      const registro: Registro = { filtros: [] };
      estado.chamadas.push(registro);
      const q: Record<string, unknown> = {};
      for (const metodo of ["select", "eq", "order", "in", "is", "limit", "range", "update"]) {
        q[metodo] = (...args: unknown[]) => {
          registro.filtros.push([metodo, ...args]);
          return q;
        };
      }
      q.insert = (valores: Record<string, unknown>) => {
        registro.insert = valores;
        return q;
      };
      q.single = () => q;
      q.maybeSingle = () => q;
      q.then = (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) =>
        Promise.resolve(estado.respostas.shift() ?? { data: [], error: null }).then(ok, falha);
      return q;
    },
  }),
}));

vi.mock("./contrato-guardado-db", () => ({
  contratosDasPropostas: async () => new Map(),
}));

const passagens = vi.hoisted(() => ({ registradas: [] as Array<Record<string, unknown>> }));

vi.mock("./passagem-de-etapa-db", () => ({
  registrarPassagemDeEtapa: async (_sb: unknown, passagem: Record<string, unknown>) => {
    passagens.registradas.push(passagem);
  },
}));

import {
  abrirTrabalho,
  donoDoTrabalho,
  ehColunaDoDonoAusente,
  esquecerAusenciaDaColunaDoDono,
  marcarAtividade,
  recorteDoDono,
  trabalhosDoBoard,
} from "./trabalhos-db";

const CECILIO = "0f6d2c1e-3b4a-4c5d-8e9f-a1b2c3d4e5f6";

const COLUNA_AUSENTE_NO_FILTRO = {
  code: "42703",
  message: "column temis_trabalhos.operado_por does not exist",
};
const COLUNA_AUSENTE_NO_INSERT = {
  code: "PGRST204",
  message: "Could not find the 'operado_por' column of 'temis_trabalhos' in the schema cache",
};

const LINHA = {
  atividades_feitas: [],
  canal: "hercules",
  cliente_cpf: null,
  cliente_nome: "Cliente",
  criado_em: "2026-09-16T10:00:00Z",
  enterprise_codigo: "VOC",
  enterprise_id: "37",
  enterprise_nome: "Vale do Ouro",
  estagio: "analise",
  estagio_desde: "2026-09-16T10:00:00Z",
  evidencia_path: null,
  id: "t-1",
  iris_ticket_id: null,
  observacao: null,
  proposta_id: null,
  tipo: "contrato",
  trabalho_origem_id: null,
  unidade: "Q01 L01",
};

function filtroDoDono(registro: Registro | undefined): unknown[] | undefined {
  return registro?.filtros.find((f) => f[1] === "operado_por");
}

beforeEach(() => {
  estado.chamadas.length = 0;
  estado.respostas.length = 0;
  passagens.registradas.length = 0;
  esquecerAusenciaDaColunaDoDono();
});

function selectDe(registro: Registro | undefined): string {
  return String(registro?.filtros.find((f) => f[0] === "select")?.[1] ?? "");
}

describe("recorteDoDono", () => {
  it("ausente e nulo são a Careli", () => {
    expect(recorteDoDono(undefined)).toEqual({ tipo: "careli" });
    expect(recorteDoDono(null)).toEqual({ tipo: "careli" });
    expect(recorteDoDono("careli")).toEqual({ tipo: "careli" });
  });

  it("todos e uuid", () => {
    expect(recorteDoDono("todos")).toEqual({ tipo: "todos" });
    expect(recorteDoDono(` ${CECILIO.toUpperCase()} `)).toEqual({
      id: CECILIO,
      tipo: "incorporador",
    });
  });

  it("string vazia ou torta não vira Careli nem todos: vira nenhum", () => {
    expect(recorteDoDono("")).toEqual({ tipo: "nenhum" });
    expect(recorteDoDono("cecilio-rocha")).toEqual({ tipo: "nenhum" });
    expect(recorteDoDono("TODOS ou nada")).toEqual({ tipo: "nenhum" });
  });
});

describe("ehColunaDoDonoAusente", () => {
  it("reconhece o 42703 do filtro e o PGRST204 do insert quando citam a coluna", () => {
    expect(ehColunaDoDonoAusente(COLUNA_AUSENTE_NO_FILTRO)).toBe(true);
    expect(ehColunaDoDonoAusente(COLUNA_AUSENTE_NO_INSERT)).toBe(true);
  });

  it("não engole coluna ausente de OUTRA coluna, nem erro qualquer", () => {
    expect(
      ehColunaDoDonoAusente({ code: "42703", message: "column temis_trabalhos.xpto does not exist" }),
    ).toBe(false);
    expect(ehColunaDoDonoAusente({ code: "23503", message: "operado_por fkey" })).toBe(false);
    expect(ehColunaDoDonoAusente(null)).toBe(false);
  });
});

describe("trabalhosDoBoard, recorte de dono", () => {
  it("POR PADRÃO filtra os trabalhos da Careli (operado_por nulo)", async () => {
    estado.respostas.push({ data: [LINHA], error: null });
    const trabalhos = await trabalhosDoBoard();
    expect(trabalhos).toHaveLength(1);
    expect(filtroDoDono(estado.chamadas[0])).toEqual(["is", "operado_por", null]);
  });

  it("todos tira o filtro de dono", async () => {
    estado.respostas.push({ data: [LINHA], error: null });
    await trabalhosDoBoard({ operadoPor: "todos" });
    expect(filtroDoDono(estado.chamadas[0])).toBeUndefined();
  });

  it("uuid recorta o incorporador, junto com o recorte de empreendimento", async () => {
    estado.respostas.push({ data: [LINHA], error: null });
    await trabalhosDoBoard({ enterpriseIds: ["37"], operadoPor: CECILIO });
    expect(filtroDoDono(estado.chamadas[0])).toEqual(["eq", "operado_por", CECILIO]);
    expect(estado.chamadas[0]?.filtros).toContainEqual(["in", "enterprise_id", ["37"]]);
  });

  it("valor torto devolve vazio SEM consultar", async () => {
    expect(await trabalhosDoBoard({ operadoPor: "" })).toEqual([]);
    expect(estado.chamadas).toHaveLength(0);
  });

  it("0172 pendente: a Careli repete a consulta sem o filtro e vê o board de hoje", async () => {
    const silencio = vi.spyOn(console, "info").mockImplementation(() => undefined);
    estado.respostas.push({ data: null, error: COLUNA_AUSENTE_NO_FILTRO });
    estado.respostas.push({ data: [LINHA], error: null });

    const trabalhos = await trabalhosDoBoard();

    expect(trabalhos).toHaveLength(1);
    expect(estado.chamadas).toHaveLength(2);
    expect(filtroDoDono(estado.chamadas[1])).toBeUndefined();
    silencio.mockRestore();
  });

  it("0172 pendente: o incorporador recebe vazio, sem segunda consulta", async () => {
    const silencio = vi.spyOn(console, "info").mockImplementation(() => undefined);
    estado.respostas.push({ data: null, error: COLUNA_AUSENTE_NO_FILTRO });

    expect(await trabalhosDoBoard({ operadoPor: CECILIO })).toEqual([]);
    expect(estado.chamadas).toHaveLength(1);
    silencio.mockRestore();
  });

  it("0172 pendente: depois de descobrir, as leituras seguintes não repetem o log", async () => {
    const silencio = vi.spyOn(console, "info").mockImplementation(() => undefined);
    estado.respostas.push({ data: null, error: COLUNA_AUSENTE_NO_FILTRO });
    estado.respostas.push({ data: [LINHA], error: null });
    await trabalhosDoBoard();
    expect(estado.chamadas).toHaveLength(2);

    // Segunda leitura da Careli, coluna ainda ausente: tenta com a coluna, cai sem ela, e sem log novo.
    estado.chamadas.length = 0;
    silencio.mockClear();
    estado.respostas.push({ data: null, error: COLUNA_AUSENTE_NO_FILTRO });
    estado.respostas.push({ data: [LINHA], error: null });
    expect(await trabalhosDoBoard()).toHaveLength(1);
    expect(estado.chamadas).toHaveLength(2);
    expect(filtroDoDono(estado.chamadas[1])).toBeUndefined();

    // O incorporador: uma consulta (a que falha) e vazio.
    estado.chamadas.length = 0;
    estado.respostas.push({ data: null, error: COLUNA_AUSENTE_NO_FILTRO });
    expect(await trabalhosDoBoard({ operadoPor: CECILIO })).toEqual([]);
    expect(estado.chamadas).toHaveLength(1);
    expect(silencio).not.toHaveBeenCalled();
    silencio.mockRestore();
  });

  // (16/09/2026, revisão do conjunto) ⚠️ O código sobe antes da 0172, a instância aprende a ausência, a
  // 0172 entra e a Cecília abre um card com dono. A Careli não pode receber esse card pela memória.
  it("⚠️ 0172 aplicada logo depois de descobrir a ausência: a Careli volta ao filtro na hora", async () => {
    const silencio = vi.spyOn(console, "info").mockImplementation(() => undefined);
    estado.respostas.push({ data: null, error: COLUNA_AUSENTE_NO_FILTRO });
    estado.respostas.push({ data: [LINHA], error: null });
    await trabalhosDoBoard();

    estado.chamadas.length = 0;
    estado.respostas.push({ data: [LINHA], error: null });
    await trabalhosDoBoard();
    expect(estado.chamadas).toHaveLength(1);
    expect(filtroDoDono(estado.chamadas[0])).toBeDefined();

    estado.chamadas.length = 0;
    estado.respostas.push({ data: [{ ...LINHA, operado_por: CECILIO }], error: null });
    expect(await trabalhosDoBoard({ operadoPor: CECILIO })).toHaveLength(1);
    expect(filtroDoDono(estado.chamadas[0])).toBeDefined();
    silencio.mockRestore();
  });
});

describe("trabalhosDoBoard, o dono no card e a paginação (arrumação da onda 3)", () => {
  it("o card traz quem opera: o incorporador ou nulo (a Careli)", async () => {
    estado.respostas.push({
      data: [
        { ...LINHA, id: "t-careli", operado_por: null },
        { ...LINHA, id: "t-cecilio", operado_por: CECILIO },
      ],
      error: null,
    });
    const trabalhos = await trabalhosDoBoard({ operadoPor: "todos" });
    expect(trabalhos.map((t) => [t.id, t.operadoPor])).toEqual([
      ["t-careli", null],
      ["t-cecilio", CECILIO],
    ]);
    expect(selectDe(estado.chamadas[0])).toContain("operado_por");
  });

  it("0172 pendente na supervisão (todos): lê de novo sem a coluna, e todo card sai da Careli", async () => {
    const silencio = vi.spyOn(console, "info").mockImplementation(() => undefined);
    estado.respostas.push({ data: null, error: COLUNA_AUSENTE_NO_FILTRO });
    estado.respostas.push({ data: [LINHA], error: null });

    const trabalhos = await trabalhosDoBoard({ operadoPor: "todos" });

    expect(trabalhos).toHaveLength(1);
    expect(trabalhos[0]?.operadoPor).toBeNull();
    expect(estado.chamadas).toHaveLength(2);
    expect(selectDe(estado.chamadas[1])).not.toContain("operado_por");
    silencio.mockRestore();
  });

  it("pagina de mil em mil: a segunda página é pedida quando a primeira vem cheia", async () => {
    const cheia = Array.from({ length: 1000 }, (_, i) => ({ ...LINHA, id: `t-${i}` }));
    estado.respostas.push({ data: cheia, error: null });
    estado.respostas.push({ data: [{ ...LINHA, id: "t-1000" }], error: null });

    const trabalhos = await trabalhosDoBoard({ operadoPor: "todos" });

    expect(trabalhos).toHaveLength(1001);
    expect(estado.chamadas[0]?.filtros).toContainEqual(["range", 0, 999]);
    expect(estado.chamadas[1]?.filtros).toContainEqual(["range", 1000, 1999]);
  });
});

describe("marcarAtividade, autor da passagem de etapa", () => {
  it("quando o card anda, a passagem grava quem marcou", async () => {
    // Todas as atividades da análise do contrato já feitas, menos a última: marcá-la faz o card andar.
    const { ATIVIDADES } = await import("./trabalhos");
    const doEstagio = ATIVIDADES.contrato.filter((a) => a.estagio === "analise").map((a) => a.texto);
    const [ultima, ...antes] = [...doEstagio].reverse();
    estado.respostas.push({ data: { ...LINHA, atividades_feitas: antes }, error: null });
    estado.respostas.push({ data: null, error: null });

    const r = await marcarAtividade({
      atividade: ultima ?? "",
      feita: true,
      id: "t-1",
      quem: "usuario-portal-1",
      quemNome: "Maria do Jurídico",
    });

    expect(r).toMatchObject({ andou: true, ok: true });
    expect(passagens.registradas[0]).toMatchObject({
      origem: "atividade",
      quem: "usuario-portal-1",
      quemNome: "Maria do Jurídico",
    });
  });
});

describe("abrirTrabalho, dono", () => {
  const NOVO = {
    canal: "hercules" as const,
    clienteCpf: null,
    clienteNome: "Cliente",
    empreendimentoCodigo: "VOC",
    empreendimentoId: "37",
    empreendimentoNome: "Vale do Ouro",
    tipo: "contrato" as const,
    unidade: "Q01 L01",
  };

  it("sem dono, o insert nem cita a coluna (o hub abre card igual a hoje)", async () => {
    estado.respostas.push({ data: { estagio: "analise", id: "t-1" }, error: null });
    const r = await abrirTrabalho(NOVO);
    expect(r).toEqual({ id: "t-1", ok: true });
    expect(estado.chamadas[0]?.insert).not.toHaveProperty("operado_por");
  });

  it("com dono, grava operado_por", async () => {
    estado.respostas.push({ data: { estagio: "analise", id: "t-2" }, error: null });
    await abrirTrabalho({ ...NOVO, operadoPor: CECILIO });
    expect(estado.chamadas[0]?.insert).toMatchObject({ operado_por: CECILIO });
  });

  it("0172 pendente e sem a opção: RECUSA, sem segunda tentativa, e avisa quem chama", async () => {
    const grito = vi.spyOn(console, "error").mockImplementation(() => undefined);
    estado.respostas.push({ data: null, error: COLUNA_AUSENTE_NO_INSERT });

    const r = await abrirTrabalho({ ...NOVO, operadoPor: CECILIO });

    expect(r).toMatchObject({ colunaDoDonoAusente: true, ok: false });
    expect(estado.chamadas).toHaveLength(1);
    expect(grito).toHaveBeenCalled();
    grito.mockRestore();
  });

  it("0172 pendente COM a opção (a venda): grava sem o dono e loga", async () => {
    const grito = vi.spyOn(console, "error").mockImplementation(() => undefined);
    estado.respostas.push({ data: null, error: COLUNA_AUSENTE_NO_INSERT });
    estado.respostas.push({ data: { estagio: "analise", id: "t-3" }, error: null });

    const r = await abrirTrabalho(
      { ...NOVO, operadoPor: CECILIO },
      { semDonoSeFaltarColuna: true },
    );

    expect(r).toEqual({ id: "t-3", ok: true });
    expect(estado.chamadas[1]?.insert).not.toHaveProperty("operado_por");
    expect(grito).toHaveBeenCalled();
    grito.mockRestore();
  });

  it("outro erro com dono NÃO tenta de novo sem ele", async () => {
    estado.respostas.push({ data: null, error: { code: "23503", message: "violates fkey" } });
    const r = await abrirTrabalho({ ...NOVO, operadoPor: CECILIO });
    expect(r.ok).toBe(false);
    expect(estado.chamadas).toHaveLength(1);
  });
});

describe("donoDoTrabalho", () => {
  it("devolve o empreendimento e o dono", async () => {
    estado.respostas.push({ data: { enterprise_id: "37", operado_por: CECILIO }, error: null });
    expect(await donoDoTrabalho("t-1")).toEqual({ enterprise_id: "37", operado_por: CECILIO });
  });

  it("id vazio não consulta; não achado é nulo", async () => {
    expect(await donoDoTrabalho("  ")).toBeNull();
    expect(estado.chamadas).toHaveLength(0);

    estado.respostas.push({ data: null, error: null });
    expect(await donoDoTrabalho("t-9")).toBeNull();
  });

  it("id que não é uuid (22P02) é nulo e calado", async () => {
    const grito = vi.spyOn(console, "error").mockImplementation(() => undefined);
    estado.respostas.push({ data: null, error: { code: "22P02", message: "invalid input syntax" } });
    expect(await donoDoTrabalho("abc")).toBeNull();
    expect(grito).not.toHaveBeenCalled();
    grito.mockRestore();
  });

  it("0172 pendente: lê só o empreendimento e o dono volta nulo (a Careli)", async () => {
    estado.respostas.push({ data: null, error: COLUNA_AUSENTE_NO_FILTRO });
    estado.respostas.push({ data: { enterprise_id: "37" }, error: null });
    expect(await donoDoTrabalho("t-1")).toEqual({ enterprise_id: "37", operado_por: null });
  });
});
