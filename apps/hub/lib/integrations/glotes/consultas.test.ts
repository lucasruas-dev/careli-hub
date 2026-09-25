import { beforeEach, describe, expect, it, vi } from "vitest";

// O INCREMENTAL DO GLOTES NO RELÓGIO CERTO (25/09/2026).
//
// O C2X grava `datetime` sem fuso, no relógio de Brasília, e a sessão do MySQL é UTC. A porta
// entrega a marca de `alterado_desde` em UTC; até 25/09 vendas e recebimentos comparavam essa marca
// direto com a coluna local, e o corte andava 3 horas (desde 10/09 o incremental de recebimentos
// devolvia 534 parcelas contra 1.564 reais). E o relógio de vendas era só o contrato, quando cinco
// campos da venda saem das parcelas; o de recebimentos ignorava a venda, de onde sai o titular.
//
// Este arquivo trava: (1) a conversão da marca UTC para Brasília; (2) o `atualizado_em` em ISO com
// o fuso REAL daquele instante (inclusive horário de verão, que existiu até 2019); (3) a ida e volta
// com a porta; (4) que as três consultas passam a marca no relógio de Brasília e usam o relógio
// combinado, com todo argumento do GREATEST protegido por coalesce.

const m = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("@/lib/guardian/db", () => ({
  getHadesDbPool: () => ({ ok: true, pool: { query: m.query } }),
}));
// Sem Supabase: `clientes` fica só com o lado C2X (o merge com o Panteon é outro assunto).
vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () => null,
  hashIdentifier: (_tipo: string, valor: string) => `hash-${valor}`,
}));

import {
  listarClientes,
  listarRecebimentos,
  listarVendas,
  marcaNoRelogioDoC2x,
  relogioComFuso,
} from "./consultas";
import { lerAlteradoDesde } from "./porta";

const PISO = "cast('1970-01-01 00:00:00' as datetime)";

type Chamada = { params: unknown[]; sql: string };

/** O C2X de mentira: `count(*) as total` responde o total; o resto responde as linhas dadas. */
function c2xRespondendo(linhas: Record<string, unknown>[]): Chamada[] {
  const chamadas: Chamada[] = [];
  m.query.mockImplementation(async (sql: string, params: unknown[]) => {
    chamadas.push({ params, sql });
    if (/count\(\*\) as total/.test(sql)) return [[{ total: linhas.length }]];
    return [linhas];
  });
  return chamadas;
}

/** Os argumentos de primeiro nível de cada `greatest(...)` do SQL. */
function argumentosDosGreatest(sql: string): string[][] {
  const blocos: string[][] = [];
  const abertura = "greatest(";
  let inicio = sql.indexOf(abertura);
  while (inicio >= 0) {
    const argumentos: string[] = [];
    let profundidade = 0;
    let atual = "";
    for (let i = inicio + abertura.length; i < sql.length; i++) {
      const c = sql[i];
      if (c === ")" && profundidade === 0) {
        argumentos.push(atual.trim());
        break;
      }
      if (c === "(") profundidade++;
      if (c === ")") profundidade--;
      if (c === "," && profundidade === 0) {
        argumentos.push(atual.trim());
        atual = "";
        continue;
      }
      atual += c;
    }
    blocos.push(argumentos);
    inicio = sql.indexOf(abertura, inicio + 1);
  }
  return blocos;
}

/** Todo argumento de todo GREATEST é `coalesce(..., piso)`: GREATEST com um NULL vira NULL. */
function esperaGreatestProtegido(sql: string): string[][] {
  const blocos = argumentosDosGreatest(sql);
  expect(blocos.length).toBeGreaterThan(0);
  for (const argumentos of blocos) {
    expect(argumentos.length).toBeGreaterThanOrEqual(2);
    for (const argumento of argumentos) {
      expect(argumento.startsWith("coalesce(")).toBe(true);
      expect(argumento.replace(/\s+/g, " ").endsWith(`${PISO})`)).toBe(true);
    }
  }
  return blocos;
}

function marcaDaPorta(iso: string): string {
  const lida = lerAlteradoDesde(iso);
  if ("erro" in lida || !lida.valor) throw new Error(`a porta recusou ${iso}`);
  return lida.valor;
}

beforeEach(() => {
  m.query.mockReset();
});

describe("marcaNoRelogioDoC2x: a marca UTC da porta no relógio de Brasília", () => {
  it("leva a meia-noite de Brasília (03:00 UTC) de volta para 00:00", () => {
    expect(marcaNoRelogioDoC2x("2026-09-10 03:00:00")).toBe("2026-09-10 00:00:00");
  });

  it("atravessa o dia quando a hora UTC é de madrugada", () => {
    expect(marcaNoRelogioDoC2x("2026-09-25 02:30:15")).toBe("2026-09-24 23:30:15");
  });

  it("usa o fuso da época: no horário de verão de 2018 a diferença era de 2 horas", () => {
    expect(marcaNoRelogioDoC2x("2018-12-01 14:00:00")).toBe("2018-12-01 12:00:00");
    expect(marcaNoRelogioDoC2x("2019-06-01 15:00:00")).toBe("2019-06-01 12:00:00");
  });

  it("sem marca, sem corte", () => {
    expect(marcaNoRelogioDoC2x(null)).toBeNull();
    expect(marcaNoRelogioDoC2x(undefined)).toBeNull();
    expect(marcaNoRelogioDoC2x("")).toBeNull();
  });
});

describe("relogioComFuso: o atualizado_em em ISO com o deslocamento de Brasília daquele instante", () => {
  it("fora do horário de verão sai -03:00", () => {
    expect(relogioComFuso("2026-09-25 12:20:00")).toBe("2026-09-25T12:20:00-03:00");
    expect(relogioComFuso("2019-06-01 12:00:00")).toBe("2019-06-01T12:00:00-03:00");
  });

  it("no horário de verão antigo sai -02:00, e não o -03:00 colado", () => {
    expect(relogioComFuso("2018-12-01 12:00:00")).toBe("2018-12-01T12:00:00-02:00");
    // Primeiro instante do horário de verão 2018/2019 (a meia-noite de 04/11/2018 não existiu).
    expect(relogioComFuso("2018-11-04 01:00:00")).toBe("2018-11-04T01:00:00-02:00");
    // Última hora "só uma vez" antes do fim e a primeira depois dele (17/02/2019).
    expect(relogioComFuso("2019-02-16 22:59:59")).toBe("2019-02-16T22:59:59-02:00");
    expect(relogioComFuso("2019-02-17 00:00:00")).toBe("2019-02-17T00:00:00-03:00");
    // A hora repetida do fim do horário de verão fica com a primeira ocorrência.
    expect(relogioComFuso("2019-02-16 23:30:00")).toBe("2019-02-16T23:30:00-02:00");
  });

  it("aceita o separador T e não inventa relógio", () => {
    expect(relogioComFuso("2026-09-25T12:20:00")).toBe("2026-09-25T12:20:00-03:00");
    expect(relogioComFuso(null)).toBeNull();
    expect(relogioComFuso("")).toBeNull();
    expect(relogioComFuso("2026-09-25")).toBeNull();
    expect(relogioComFuso("lixo")).toBeNull();
  });

  it("o piso dos relógios combinados e a data zero do legado saem nulos, não como 1970", () => {
    expect(relogioComFuso("1970-01-01 00:00:00")).toBeNull();
    expect(relogioComFuso("0000-00-00 00:00:00")).toBeNull();
  });
});

describe("ida e volta: repassar o atualizado_em recebido devolve a mesma marca no relógio do C2X", () => {
  it.each([
    "2026-09-25 12:20:00",
    "2026-01-01 00:00:00",
    "2026-09-24 23:59:59",
    "2018-12-01 12:00:00",
    "2019-02-17 00:00:00",
  ])("%s", (local) => {
    const saida = relogioComFuso(local);
    expect(saida).not.toBeNull();
    expect(marcaNoRelogioDoC2x(marcaDaPorta(saida as string))).toBe(local);
  });

  it("o formato antigo de clientes (sem fuso) é recusado pela porta: era por isso que dava 400", () => {
    expect(lerAlteradoDesde("2026-09-25 12:20:00")).toHaveProperty("erro");
  });
});

describe("vendas: marca em Brasília e relógio combinado", () => {
  it("passa a marca no relógio de Brasília ao count e à página, com o relógio combinado", async () => {
    const chamadas = c2xRespondendo([
      { atualizado_em: "2026-09-25 12:20:00", codigo_cliente: "CLI1", id: 81, price: "100.00" },
    ]);

    const pagina = await listarVendas({ alteradoDesde: marcaDaPorta("2026-09-10T00:00:00-03:00") });

    expect(chamadas).toHaveLength(2);
    for (const { params, sql } of chamadas) {
      expect(params).toContain("2026-09-10 00:00:00");
      expect(params).not.toContain("2026-09-10 03:00:00");
      // O filtro antigo (só o contrato) não pode voltar.
      expect(sql).not.toMatch(/and ar\.updated_at >= \?/);
      expect(sql).toMatch(/greatest\([\s\S]*\)\s*>= \?/);
      const [relogio] = esperaGreatestProtegido(sql);
      const juntos = (relogio ?? []).join(" | ");
      expect(juntos).toContain("ar.updated_at");
      expect(juntos).toContain("eu.updated_at");
      expect(juntos).toMatch(/max\(coalesce\(pu\.updated_at, pu\.created_at\)\)/);
      expect(juntos).toContain("pu.parcel_type_id in (2, 3)");
      // Apagar muda qtd_parcelas: a parcela marcada para apagar TEM que mover o relógio.
      expect(juntos).not.toContain("payment_to_delete");
    }
    // O `atualizado_em` da saída é o MESMO relógio do filtro.
    const pagina1 = chamadas[1]?.sql ?? "";
    expect(pagina1).toMatch(/date_format\(greatest\([\s\S]*\), '%Y-%m-%d %H:%i:%s'\) as atualizado_em/);

    expect(pagina.dados).toEqual([
      expect.objectContaining({ atualizado_em: "2026-09-25T12:20:00-03:00", codigo_venda: "VEN-81" }),
    ]);
  });

  it("sem alterado_desde não há corte por relógio, mas o atualizado_em sai", async () => {
    const chamadas = c2xRespondendo([{ atualizado_em: "2026-09-18 03:15:55", id: 223 }]);

    const pagina = await listarVendas({});

    expect(chamadas[0]?.sql).not.toContain("greatest(");
    expect(chamadas[0]?.params).toEqual([[1, 4]]);
    expect(pagina.dados).toEqual([
      expect.objectContaining({ atualizado_em: "2026-09-18T03:15:55-03:00", codigo_venda: "VEN-223" }),
    ]);
  });

  it("incluir_canceladas tira a trava de venda aberta e mantém o corte por relógio", async () => {
    const chamadas = c2xRespondendo([]);

    await listarVendas({
      alteradoDesde: marcaDaPorta("2026-09-10T00:00:00-03:00"),
      incluirCanceladas: true,
    });

    for (const { params, sql } of chamadas) {
      expect(sql).not.toContain("ar.open = 1");
      expect(sql).toMatch(/greatest\([\s\S]*\)\s*>= \?/);
      expect(params).toContain("2026-09-10 00:00:00");
    }
  });
});

describe("recebimentos: marca em Brasília e relógio da parcela OU da venda", () => {
  it("passa a marca no relógio de Brasília e compara greatest(parcela, venda)", async () => {
    const chamadas = c2xRespondendo([
      {
        atualizado_em: "2026-09-15 17:18:26",
        codigo_cliente: "CLI4262",
        id: 9001,
        initial_value: "535.99",
        paid_value: "0",
        venda_id: 223,
      },
    ]);

    const pagina = await listarRecebimentos({
      alteradoDesde: marcaDaPorta("2026-09-10T00:00:00-03:00"),
    });

    expect(chamadas).toHaveLength(2);
    for (const { params, sql } of chamadas) {
      expect(params).toContain("2026-09-10 00:00:00");
      expect(params).not.toContain("2026-09-10 03:00:00");
      expect(sql).not.toMatch(/and p\.updated_at >= \?/);
      expect(sql).toMatch(/greatest\([\s\S]*\)\s*>= \?/);
      const [relogio] = esperaGreatestProtegido(sql);
      expect(relogio).toHaveLength(2);
      expect(relogio?.[0]).toContain("p.updated_at");
      expect(relogio?.[1]).toContain("ar.updated_at");
    }
    expect(chamadas[1]?.sql).toMatch(
      /date_format\(greatest\([\s\S]*\), '%Y-%m-%d %H:%i:%s'\) as atualizado_em/,
    );

    expect(pagina.dados).toEqual([
      expect.objectContaining({
        atualizado_em: "2026-09-15T17:18:26-03:00",
        codigo_recebimento: "REC-9001",
        codigo_venda: "VEN-223",
      }),
    ]);
  });

  it("o corte por relógio convive com os outros filtros, na ordem dos parâmetros", async () => {
    const chamadas = c2xRespondendo([]);

    await listarRecebimentos({
      alteradoDesde: marcaDaPorta("2026-09-25T10:00:00-03:00"),
      codigoVenda: "VEN-223",
      vencimentoDe: "2026-01-01",
    });

    const contagem = chamadas[0];
    expect(contagem?.params).toEqual([[1, 4], [5, 6, 7], "2026-09-25 10:00:00", 223, "2026-01-01"]);
  });
});

describe("clientes: relógio com endereço e cônjuge, corte no relógio local, saída com fuso", () => {
  it("o relógio do lado C2X inclui phones, addresses e spouses do usuário", async () => {
    const chamadas = c2xRespondendo([]);

    await listarClientes({});

    const pagina = chamadas.find((c) => !/count\(\*\) as total/.test(c.sql))?.sql ?? "";
    const [relogio] = esperaGreatestProtegido(pagina);
    const juntos = (relogio ?? []).join(" | ");
    expect(relogio).toHaveLength(5);
    expect(juntos).toContain("u.updated_at");
    for (const tabela of ["phones", "addresses", "spouses"]) {
      expect(juntos).toMatch(new RegExp(`from ${tabela} \\w+\\s+where \\w+\\.ownertable_type = 'User'`));
    }
  });

  // 25/09/2026: o CLI4258 virou titular da VEN-5008 em 16/09 e o relógio dele continuou no
  // cadastro de 10/09, então o incremental de clientes não o trazia (88 dos 224 que entraram no
  // recorte em 2024 tinham o mesmo desenho). O contrato do Lavra de que ele é titular move o relógio.
  it("o relógio de clientes inclui os contratos do Lavra de que ele é titular", async () => {
    const chamadas = c2xRespondendo([]);

    await listarClientes({ alteradoDesde: marcaDaPorta("2026-09-16T00:00:00-03:00") });

    const pagina = chamadas.find((c) => !/count\(\*\) as total/.test(c.sql));
    const [relogio] = esperaGreatestProtegido(pagina?.sql ?? "");
    const doContrato = (relogio ?? []).filter(
      (argumento) =>
        /^coalesce\(\s*\(select max\(coalesce\((\w+)\.updated_at, \1\.created_at\)\) from acquisition_requests \1\b/.test(
          argumento,
        ) && /\b\w+\.client_id = u\.id\b/.test(argumento),
    );
    expect(doContrato).toHaveLength(1);
    // Só as duas glebas do Lavra, no texto: um `?` aqui deslocaria [ENTERPRISES, desde, limite].
    expect(doContrato[0]).toMatch(/enterprise_id in \(1, 4\)/);
    expect(doContrato[0]).not.toContain("?");
    // Sem trava de venda aberta: o cancelamento não move o relógio, e trazer a mais é seguro.
    expect(doContrato[0]).not.toMatch(/\.open\s*=/);
    expect(pagina?.params).toEqual([[1, 4], 0, 500]);
  });

  it("corta com >= no relógio de Brasília e só formata o fuso na saída", async () => {
    c2xRespondendo([
      { atualizado_em: "2026-09-09 23:59:59", cpf: "11111111111", id: 1, person_type_id: 1 },
      { atualizado_em: "2026-09-10 00:00:00", cpf: "22222222222", id: 2, person_type_id: 1 },
      { atualizado_em: "2026-09-18 10:59:44", cpf: "33333333333", id: 3, person_type_id: 1 },
    ]);

    const pagina = await listarClientes({
      alteradoDesde: marcaDaPorta("2026-09-10T00:00:00-03:00"),
    });

    expect(pagina.dados.map((d) => (d as { atualizado_em: string }).atualizado_em)).toEqual([
      "2026-09-10T00:00:00-03:00",
      "2026-09-18T10:59:44-03:00",
    ]);
    expect(pagina.total).toBe(2);
  });
});
