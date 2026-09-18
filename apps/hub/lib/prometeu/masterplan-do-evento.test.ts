import { afterEach, describe, expect, it, vi } from "vitest";

// ⚠️ O TELÃO NÃO PERGUNTA MAIS AO C2X (Lucas, 18/09/2026: *"no c2x não precisa olhar"*). Se alguém
// religar o pool do legado neste caminho, quem quebra é o teste, e não o mapa projetado no salão.
vi.mock("@/lib/guardian/db", () => ({
  getHadesDbPool: () => {
    throw new Error("o telão não lê o C2X: a situação vem do Panteon");
  },
}));

import { masterplanDoEvento } from "./masterplan-do-evento";

// O mapa do telão passa pela MESMA leitura da tela Venda (lib/hercules/situacao-da-unidade.ts).
// Estes testes rodam a leitura de verdade sobre um banco de mentira: é o único jeito de provar que
// a reserva feita no tótem chega à cor do lote, e não só que a régua pura está certa.

type Linha = Record<string, unknown>;

function clienteFalso(tabelas: Record<string, Linha[]>, opts: { falhaEm?: string } = {}) {
  return {
    from(tabela: string) {
      const filtros: Array<(l: Linha) => boolean> = [];
      let faixa: null | [number, number] = null;
      const consulta = {
        eq(coluna: string, valor: unknown) {
          filtros.push((l) => String(l[coluna]) === String(valor));
          return consulta;
        },
        in(coluna: string, valores: readonly unknown[]) {
          const aceitos = new Set(valores.map(String));
          filtros.push((l) => aceitos.has(String(l[coluna])));
          return consulta;
        },
        // As irmãs de gleba são lidas com `.is("espelho_de", null)` (ver "A FAMÍLIA DO PAI").
        is(coluna: string, valor: unknown) {
          filtros.push((l) => (valor === null ? l[coluna] === null || l[coluna] === undefined : l[coluna] === valor));
          return consulta;
        },
        not(coluna: string, operador: string, valor: unknown) {
          // Só o `not(coluna, "is", null)` que a leitura usa; qualquer outro é teste desatualizado.
          if (operador !== "is" || valor !== null) throw new Error(`not(${operador}) sem suporte no falso`);
          filtros.push((l) => l[coluna] !== null && l[coluna] !== undefined);
          return consulta;
        },
        order() {
          return consulta;
        },
        range(de: number, ate: number) {
          faixa = [de, ate];
          return consulta;
        },
        select() {
          return consulta;
        },
        then(resolver: (v: unknown) => unknown, rejeitar?: (e: unknown) => unknown) {
          if (opts.falhaEm === tabela) {
            return Promise.resolve({ data: null, error: { message: "fora do ar" } }).then(resolver, rejeitar);
          }
          const linhas = (tabelas[tabela] ?? []).filter((l) => filtros.every((f) => f(l)));
          const data = faixa ? linhas.slice(faixa[0], faixa[1] + 1) : linhas;
          return Promise.resolve({ data, error: null }).then(resolver, rejeitar);
        },
      };
      return consulta;
    },
  } as unknown as Parameters<typeof masterplanDoEvento>[0];
}

function unidade(p: {
  codigo: string;
  enterprise?: string;
  espelhoDe?: string;
  id: string;
  origem?: string;
  situacao?: string;
}): Linha {
  return {
    codigo: p.codigo,
    enterprise_id: p.enterprise ?? "50",
    espelho_de: p.espelhoDe ?? null,
    id: p.id,
    lote: p.codigo.slice(-2),
    origem_c2x_id: p.origem ?? null,
    quadra: p.codigo.slice(3, -2),
    situacao: p.situacao ?? "disponivel",
    workspace_id: "careli",
  };
}

const EVENTO = { config: null, enterpriseId: "50", id: "evento-1" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a reserva do salão pinta o lote na hora", () => {
  it("reserva viva do tótem vira reservado, e a cancelada não segura o lote", async () => {
    const client = clienteFalso({
      hercules_unidades: [
        unidade({ codigo: "JDG0101", id: "u1", origem: "9001" }),
        unidade({ codigo: "JDG0102", id: "u2", origem: "9002" }),
      ],
      prometeu_reservas: [
        { evento_id: "evento-1", id: "r1", situacao: "reservada", unidade_c2x_id: "9001" },
        { evento_id: "evento-1", id: "r2", situacao: "cancelada", unidade_c2x_id: "9002" },
      ],
    });

    const { dados, error } = await masterplanDoEvento(client, EVENTO);

    expect(error).toBeUndefined();
    expect(dados?.lotes).toEqual({ JDG0101: "reservado", JDG0102: "disponivel" });
  });

  // ⚠️ A resposta sai por link público, para máquina de terceiro: situação e nada mais.
  it("o mapa carrega só a situação, nunca comprador nem valor", async () => {
    const client = clienteFalso({
      hercules_unidades: [unidade({ codigo: "JDG0101", id: "u1", origem: "9001" })],
    });

    const { dados } = await masterplanDoEvento(client, EVENTO);

    expect(Object.keys(dados ?? {}).sort()).toEqual(["atualizadoEm", "contagem", "lotes"]);
    expect(Object.values(dados?.lotes ?? {})).toEqual(["disponivel"]);
  });
});

describe("a mesma régua da tela Venda", () => {
  it("proposta viva e reserva do Hércules ocupam o lote; bloqueio do Panteon fica indisponível", async () => {
    const client = clienteFalso({
      hercules_propostas: [
        { criado_em_c2x: null, etapa: "contrato", etapa_desde: "2026-09-10", id: "p1", unidade_id: "u1", workspace_id: "careli" },
        { criado_em_c2x: null, etapa: "cancelado", etapa_desde: "2026-09-12", id: "p2", unidade_id: "u3", workspace_id: "careli" },
      ],
      hercules_reservas: [{ id: "h1", situacao: "ativa", unidade_id: "u2", workspace_id: "careli" }],
      hercules_unidades: [
        unidade({ codigo: "JDG0101", id: "u1" }),
        unidade({ codigo: "JDG0102", id: "u2" }),
        unidade({ codigo: "JDG0103", id: "u3" }),
        // ⚠️ O caso dos 93 lotes do LBP: bloqueado no Panteon, "Disponível" para quem lia o C2X.
        unidade({ codigo: "JDG0104", id: "u4", situacao: "bloqueada" }),
      ],
    });

    const { dados } = await masterplanDoEvento(client, EVENTO);

    expect(dados?.lotes).toEqual({
      JDG0101: "negociacao",
      JDG0102: "reservado",
      JDG0103: "disponivel",
      JDG0104: "indisponivel",
    });
    expect(dados?.contagem).toEqual({ disponivel: 1, indisponivel: 1, negociacao: 1, reservado: 1, vendido: 0 });
  });

  it("produto dividido: o código do pai e o da gleba respondem o mesmo, e o terreno conta uma vez", async () => {
    const client = clienteFalso({
      // A reserva nasceu na linha do PAI (medido em 14/09/2026: VLO0305 reservado, VOC0305 livre).
      hercules_reservas: [{ id: "h1", situacao: "ativa", unidade_id: "pai-1", workspace_id: "careli" }],
      hercules_unidades: [
        unidade({ codigo: "VLO0305", enterprise: "35", espelhoDe: "gleba-1", id: "pai-1" }),
        unidade({ codigo: "VLO0306", enterprise: "35", espelhoDe: "gleba-2", id: "pai-2" }),
        unidade({ codigo: "VOC0305", enterprise: "37", id: "gleba-1" }),
        unidade({ codigo: "VOC0306", enterprise: "37", id: "gleba-2" }),
      ],
    });

    const { dados } = await masterplanDoEvento(client, { ...EVENTO, enterpriseId: "35" });

    expect(dados?.lotes.VLO0305).toBe("reservado");
    expect(dados?.lotes.VOC0305).toBe("reservado");
    expect(dados?.lotes.VLO0306).toBe("disponivel");
    expect(dados?.contagem).toEqual({ disponivel: 1, indisponivel: 0, negociacao: 0, reservado: 1, vendido: 0 });
  });
});

describe("na dúvida, nunca anuncia disponível", () => {
  it("falha de leitura vira erro, e não mapa verde", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const client = clienteFalso(
      { hercules_unidades: [unidade({ codigo: "JDG0101", id: "u1" })] },
      { falhaEm: "prometeu_reservas" },
    );

    const { dados, error } = await masterplanDoEvento(client, EVENTO);

    expect(dados).toBeUndefined();
    expect(error).toBeTruthy();
    // A mensagem crua do banco fica no log: a rota é pública.
    expect(error).not.toContain("fora do ar");
  });

  it("empreendimento sem unidades no Panteon vira aviso de sync, e não mapa sem cor", async () => {
    const client = clienteFalso({
      hercules_unidades: [unidade({ codigo: "RVPA01", enterprise: "60", id: "u1" })],
    });

    const { dados, error } = await masterplanDoEvento(client, EVENTO);

    expect(dados).toBeUndefined();
    expect(error).toMatch(/Sincronize/);
  });

  it("evento sem empreendimento no Setup não monta mapa", async () => {
    const { error } = await masterplanDoEvento(clienteFalso({}), { ...EVENTO, enterpriseId: null });
    expect(error).toBe("Evento sem empreendimento vinculado no Setup.");
  });
});

// ⚠️ A TRAVA DO SETUP BLOQUEIA POR CIMA (era assim até 18/09/2026; a primeira passada a tinha
// rebaixado a "só tapa buraco", e o lote travado com cadastro voltava a pintar verde).
describe("a trava do evento bloqueia por cima", () => {
  it("lote sem cadastro no Panteon entra indisponível; lote com cadastro livre também sai indisponível", async () => {
    const client = clienteFalso({
      hercules_unidades: [
        unidade({ codigo: "JDG0101", id: "u1" }),
        unidade({ codigo: "JDG0102", id: "u2" }),
      ],
    });

    const { dados } = await masterplanDoEvento(client, {
      ...EVENTO,
      config: { lotesBloqueados: ["jdg0201", "JDG0101"] },
    });

    // Sem a trava, JDG0201 ficaria sem chave e o telão não o pintaria: lido como livre.
    expect(dados?.lotes.JDG0201).toBe("indisponivel");
    expect(dados?.lotes.JDG0101).toBe("indisponivel");
    expect(dados?.lotes.JDG0102).toBe("disponivel");
    expect(dados?.contagem).toEqual({ disponivel: 1, indisponivel: 2, negociacao: 0, reservado: 0, vendido: 0 });
  });

  it("travar o código do pai trava a gleba: é o mesmo chão", async () => {
    const client = clienteFalso({
      hercules_unidades: [
        unidade({ codigo: "VLO0305", enterprise: "35", espelhoDe: "gleba-1", id: "pai-1" }),
        unidade({ codigo: "VOC0305", enterprise: "37", id: "gleba-1" }),
      ],
    });

    const { dados } = await masterplanDoEvento(client, {
      ...EVENTO,
      config: { lotesBloqueados: ["VLO0305"] },
      enterpriseId: "35",
    });

    expect(dados?.lotes.VLO0305).toBe("indisponivel");
    expect(dados?.lotes.VOC0305).toBe("indisponivel");
    expect(dados?.contagem.indisponivel).toBe(1);
  });

  it("lote já ocupado pela régua fica com a palavra dela (a cor é a mesma, a contagem bate com o Apolo)", async () => {
    const client = clienteFalso({
      hercules_reservas: [{ id: "h1", situacao: "ativa", unidade_id: "u1", workspace_id: "careli" }],
      hercules_unidades: [unidade({ codigo: "JDG0101", id: "u1" })],
    });

    const { dados } = await masterplanDoEvento(client, {
      ...EVENTO,
      config: { lotesBloqueados: ["JDG0101"] },
    });

    expect(dados?.lotes.JDG0101).toBe("reservado");
  });
});
