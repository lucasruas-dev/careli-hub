import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MOTIVOS_DE_BLOQUEIO } from "@/lib/hercules/bloqueio-de-unidade";

// BLOQUEAR E DESBLOQUEAR PELO APOLO, CHAMADO DE VERDADE.
//
// Lucas (18/09/2026): *"eu posso por exemplo, bloquear uma unidade dentro do apolo e isso tem que
// refletir no hercules"*. A regra é a MESMA do portal (lib/hercules/bloquear-unidade-server.ts), e a
// régua roda de verdade sobre um banco falso que entende os filtros. O que se prova aqui é a PORTA
// do hub (sessão de escrita do Apolo, autor do hub no carimbo) e que a regra é a mesma: lote com
// dono não bloqueia, bloqueio herdado do C2X não se desfaz, falha de leitura não grava.

type Linha = Record<string, unknown>;

const estado = vi.hoisted(() => ({
  /** Roda no instante de cada UPDATE, antes de ele casar as linhas: é por aqui que a corrida entra. */
  antesDaGravacao: null as null | ((tabela: string, valores: Record<string, unknown>) => void),
  auth: { nome: "Nívea" as null | string, ok: true, userId: "8f14e45f-ceea-467a-9575-0a1b2c3d4e5f" },
  falha: null as null | string,
  /** Falha só a partir da N-ésima leitura desta tabela (a régua lê antes; a trava, depois). */
  falhaNaLeitura: null as null | { tabela: string; vez: number },
  gravacoes: [] as Array<{ ids: unknown[]; tabela: string; valores: Linha }>,
  leituras: {} as Record<string, number>,
  negado: false,
  tabelas: {} as Record<string, Linha[]>,
}));

vi.mock("@/lib/apolo/auth", () => ({
  authorizeApoloWrite: vi.fn(async () =>
    estado.negado
      ? { ok: false, response: NextResponse.json({ error: "Usuario sem acesso ao Apolo." }, { status: 403 }) }
      : estado.auth,
  ),
}));

vi.mock("@/lib/apolo/server", () => {
  const consulta = (tabela: string) => {
    const filtros: Array<(l: Linha) => boolean> = [];
    let atualizacao: Linha | null = null;
    let unica = false;
    const resposta = () => {
      if (estado.falha === tabela) return { data: null, error: { message: `${tabela} fora do ar` } };
      if (!atualizacao) estado.leituras[tabela] = (estado.leituras[tabela] ?? 0) + 1;
      const tardia = estado.falhaNaLeitura;
      if (tardia && tardia.tabela === tabela && (estado.leituras[tabela] ?? 0) >= tardia.vez) {
        return { data: null, error: { message: `${tabela} caiu no meio` } };
      }
      if (atualizacao) estado.antesDaGravacao?.(tabela, atualizacao);
      const achadas = (estado.tabelas[tabela] ?? []).filter((l) => filtros.every((f) => f(l)));
      if (atualizacao) {
        estado.gravacoes.push({ ids: achadas.map((l) => l.id), tabela, valores: atualizacao });
        for (const l of achadas) Object.assign(l, atualizacao);
        return { data: achadas.map((l) => ({ id: l.id })), error: null };
      }
      if (unica) return { data: achadas[0] ?? null, error: null };
      return { data: achadas, error: null };
    };
    const cadeia: Linha = {
      eq: (coluna: string, valor: unknown) => {
        filtros.push((l) => String(l[coluna]) === String(valor));
        return cadeia;
      },
      in: (coluna: string, valores: unknown[]) => {
        const aceitos = new Set(valores.map(String));
        filtros.push((l) => aceitos.has(String(l[coluna])));
        return cadeia;
      },
      limit: () => cadeia,
      maybeSingle: () => {
        unica = true;
        return cadeia;
      },
      not: (coluna: string, operador: string, valor: unknown) => {
        if (operador === "is" && valor === null) {
          filtros.push((l) => l[coluna] !== null && l[coluna] !== undefined);
        }
        return cadeia;
      },
      or: (expressao: string) => {
        const clausulas = [...expressao.matchAll(/(\w+)\.in\.\(([^)]*)\)/g)].map(([, coluna, lista]) => ({
          coluna: String(coluna),
          valores: new Set(String(lista).split(",").map((v) => v.replace(/"/g, "").trim())),
        }));
        filtros.push((l) => clausulas.some((c) => c.valores.has(String(l[c.coluna]))));
        return cadeia;
      },
      order: () => cadeia,
      range: () => cadeia,
      select: () => cadeia,
      then: (ok: (r: unknown) => unknown, falha?: (e: unknown) => unknown) =>
        Promise.resolve(resposta()).then(ok, falha),
      update: (valores: Linha) => {
        atualizacao = valores;
        return cadeia;
      },
    };
    return cadeia;
  };
  return { createApoloAdminClient: () => ({ from: consulta }) };
});

import { DELETE, POST } from "./route";

/** O terreno dividido: a linha viva da gleba (VOC) e a antiga do pai (VLO), que aponta para ela. */
function terreno(viva: Partial<Linha> = {}): Linha[] {
  return [
    {
      bloqueado_em: null,
      codigo: "VOC0305",
      enterprise_id: "37",
      espelho_de: null,
      id: "u-voc",
      lote: "05",
      origem_c2x_id: 7001,
      quadra: "03",
      situacao: "disponivel",
      workspace_id: "careli",
      ...viva,
    },
    {
      bloqueado_em: null,
      codigo: "VLO0305",
      enterprise_id: "34",
      espelho_de: "u-voc",
      id: "u-vlo",
      lote: "05",
      origem_c2x_id: 6001,
      quadra: "03",
      situacao: "reservada",
      workspace_id: "careli",
    },
  ];
}

async function bloquear(corpo: Record<string, unknown> = { motivo: MOTIVOS_DE_BLOQUEIO[0], unidadeId: "u-voc" }) {
  const resposta = await POST(
    new Request("https://c2x.app.br/api/apolo/empreendimentos/unidades/bloqueio", {
      body: JSON.stringify(corpo),
      headers: { authorization: "Bearer token" },
      method: "POST",
    }),
  );
  return {
    corpo: (await resposta.json()) as { data?: Record<string, unknown>; erros?: unknown[]; error?: string },
    status: resposta.status,
  };
}

async function desbloquear(unidadeId = "u-voc") {
  const resposta = await DELETE(
    new Request("https://c2x.app.br/api/apolo/empreendimentos/unidades/bloqueio", {
      body: JSON.stringify({ unidadeId }),
      headers: { authorization: "Bearer token" },
      method: "DELETE",
    }),
  );
  return { corpo: (await resposta.json()) as { error?: string }, status: resposta.status };
}

beforeEach(() => {
  estado.antesDaGravacao = null;
  estado.auth = { nome: "Nívea", ok: true, userId: "8f14e45f-ceea-467a-9575-0a1b2c3d4e5f" };
  estado.falha = null;
  estado.falhaNaLeitura = null;
  estado.gravacoes = [];
  estado.leituras = {};
  estado.negado = false;
  estado.tabelas = {
    hercules_propostas: [],
    hercules_reservas: [],
    hercules_unidades: terreno(),
    prometeu_reservas: [],
  };
});

describe("a porta do hub", () => {
  it("sem papel de escrita no Apolo, a resposta do gate passa direto e nada é lido", async () => {
    estado.negado = true;
    expect((await bloquear()).status).toBe(403);
    expect((await desbloquear()).status).toBe(403);
    expect(estado.gravacoes).toHaveLength(0);
  });

  it("motivo fora da lista é 422 no formato da casa, antes de qualquer leitura", async () => {
    estado.falha = "hercules_unidades";
    const { corpo, status } = await bloquear({ motivo: "Porque sim", unidadeId: "u-voc" });
    expect(status).toBe(422);
    expect(corpo.erros).toEqual([{ campo: "motivo", mensagem: "Motivo de bloqueio desconhecido." }]);
  });

  it("\"Outro\" sem detalhe não passa", async () => {
    const { corpo, status } = await bloquear({ motivo: "Outro", unidadeId: "u-voc" });
    expect(status).toBe(422);
    expect(JSON.stringify(corpo.erros)).toContain("Escreva o motivo do bloqueio.");
  });

  it("unidade que não existe é 404", async () => {
    expect((await bloquear({ motivo: MOTIVOS_DE_BLOQUEIO[0], unidadeId: "nao-existe" })).status).toBe(404);
  });
});

describe("bloquear pelo Apolo: a mesma regra do Hércules", () => {
  it("lote livre bloqueia, com o carimbo de quem está no hub", async () => {
    const { corpo, status } = await bloquear({ detalhe: "matrícula 25.862", motivo: "Matrícula com problema", unidadeId: "u-voc" });
    expect(status).toBe(200);
    expect(corpo.data).toMatchObject({ bloqueadoPor: "Nívea", motivo: "Matrícula com problema · matrícula 25.862" });
    expect(estado.gravacoes).toHaveLength(1);
    expect(estado.gravacoes[0]?.ids).toEqual(["u-voc"]);
    expect(estado.gravacoes[0]?.valores).toMatchObject({
      bloqueado_por: "8f14e45f-ceea-467a-9575-0a1b2c3d4e5f",
      bloqueado_por_nome: "Nívea",
      bloqueio_motivo: "Matrícula com problema · matrícula 25.862",
      situacao: "bloqueada",
    });
    expect(typeof estado.gravacoes[0]?.valores.bloqueado_em).toBe("string");
  });

  it("autor que não é uuid (o atalho local do hub) grava sem id, sem derrubar o UPDATE", async () => {
    estado.auth = { nome: null, ok: true, userId: "local-hub-user" };
    expect((await bloquear()).status).toBe(200);
    expect(estado.gravacoes[0]?.valores).toMatchObject({ bloqueado_por: null, bloqueado_por_nome: null });
  });

  it("⚠️ lote reservado no evento não bloqueia", async () => {
    estado.tabelas.prometeu_reservas = [{ id: 1, situacao: "reservada", unidade_c2x_id: 7001 }];
    const { corpo, status } = await bloquear();
    expect(status).toBe(409);
    expect(corpo.error).toContain("processo de venda em andamento (Reservado)");
    expect(estado.gravacoes).toHaveLength(0);
  });

  it("⚠️ proposta viva na linha antiga do pai trava a viva (a pergunta é pelo terreno)", async () => {
    estado.tabelas.hercules_propostas = [
      { criado_em_c2x: null, etapa: "contrato", etapa_desde: "2026-09-08T10:00:00Z", id: "p-1", unidade_id: "u-vlo", workspace_id: "careli" },
    ];
    const { corpo, status } = await bloquear();
    expect(status).toBe(409);
    expect(corpo.error).toContain("(Contrato)");
    expect(estado.gravacoes).toHaveLength(0);
  });

  it("⚠️ reserva que nasce entre a leitura e o bloqueio: o bloqueio se desfaz, e a reserva fica", async () => {
    // A porta única grava a reserva e só depois passa o cadastro a `reservada`. Nesse intervalo o
    // UPDATE do bloqueio ainda casa (o cadastro diz `disponivel`); a segunda conferência vê a
    // reserva e devolve o lote. Sem ela ficava lote bloqueado com reserva viva, e a proposta nascia
    // num lote de permuta.
    let reservou = false;
    estado.antesDaGravacao = (tabela, valores) => {
      if (reservou || tabela !== "hercules_unidades" || valores.situacao !== "bloqueada") return;
      reservou = true;
      estado.tabelas.hercules_reservas = [
        { id: "r-corrida", origem: "coordenador", situacao: "ativa", unidade_id: "u-voc", workspace_id: "careli" },
      ];
    };
    const { corpo, status } = await bloquear();
    expect(status).toBe(409);
    expect(corpo.error).toContain("ganhou um dono");
    expect(estado.gravacoes.map((g) => g.valores.situacao)).toEqual(["bloqueada", "disponivel"]);
    const viva = estado.tabelas.hercules_unidades?.find((l) => l.id === "u-voc");
    expect(viva).toMatchObject({ bloqueado_em: null, bloqueio_motivo: null, situacao: "disponivel" });
    expect(estado.tabelas.hercules_reservas).toHaveLength(1);
  });

  it("a linha antiga do terreno é recusada", async () => {
    expect((await bloquear({ motivo: MOTIVOS_DE_BLOQUEIO[0], unidadeId: "u-vlo" })).status).toBe(409);
    expect(estado.gravacoes).toHaveLength(0);
  });

  it("⚠️ falha na leitura da situação NÃO vira livre: 500 e nada gravado", async () => {
    estado.falha = "hercules_reservas";
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await bloquear()).status).toBe(500);
    expect(estado.gravacoes).toHaveLength(0);
    erro.mockRestore();
  });
});

describe("desbloquear pelo Apolo", () => {
  const bloqueadaAqui = { bloqueado_em: "2026-09-15T10:00:00Z", situacao: "bloqueada" };

  it("bloqueio feito no Panteon, sem nada vivo, volta ao estoque e limpa o carimbo", async () => {
    estado.tabelas.hercules_unidades = terreno(bloqueadaAqui);
    expect((await desbloquear()).status).toBe(200);
    expect(estado.gravacoes[0]?.valores).toMatchObject({
      bloqueado_em: null,
      bloqueado_por: null,
      bloqueado_por_nome: null,
      bloqueio_motivo: null,
      situacao: "disponivel",
    });
  });

  it("⚠️ bloqueio herdado do C2X não se desfaz aqui", async () => {
    estado.tabelas.hercules_unidades = terreno({ bloqueado_em: null, situacao: "bloqueada" });
    const { corpo, status } = await desbloquear();
    expect(status).toBe(409);
    expect(corpo.error).toContain("veio do C2X");
    expect(estado.gravacoes).toHaveLength(0);
  });

  it("⚠️ com outro dono no terreno (reserva do Hércules já em proposta), não volta", async () => {
    estado.tabelas.hercules_unidades = terreno(bloqueadaAqui);
    estado.tabelas.hercules_reservas = [
      { id: "r-9", origem: "coordenador", situacao: "proposta", unidade_id: "u-vlo", workspace_id: "careli" },
    ];
    expect((await desbloquear()).status).toBe(409);
    expect(estado.gravacoes).toHaveLength(0);
  });

  it("⚠️ a régua leu, mas a trava não conseguiu procurar o cupom do evento: 500 e nada gravado", async () => {
    // A régua lê `prometeu_reservas` uma vez; a segunda leitura é a da trava, fresca. Ela falhando,
    // não se sabe se o lote tem dono, e sem saber ele não volta à prateleira.
    estado.tabelas.hercules_unidades = terreno(bloqueadaAqui);
    estado.falhaNaLeitura = { tabela: "prometeu_reservas", vez: 2 };
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await desbloquear()).status).toBe(500);
    expect(estado.gravacoes).toHaveLength(0);
    erro.mockRestore();
  });

  it("unidade que não está bloqueada responde 409", async () => {
    const { corpo, status } = await desbloquear();
    expect(status).toBe(409);
    expect(corpo.error).toBe("Esta unidade não está bloqueada.");
  });
});
