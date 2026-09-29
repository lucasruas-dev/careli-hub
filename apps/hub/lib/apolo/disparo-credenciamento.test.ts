import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CadastroDoC2xPorId, FontesDoCoordenador } from "./coordenador-do-empreendimento";

// O gateway do Relacionamento é um espião: aqui se mede QUEM seria avisado e o que fica registrado,
// não o que a Evolution faz com o payload.
const gateway = vi.hoisted(() => ({ enviados: [] as Array<{ telefone: string; text: string }> }));

vi.mock("@/lib/iris/evolution-api", () => ({
  sendEvolutionDirectMedia: vi.fn(async () => ({ ok: true, providerMessageId: "m2" })),
  sendEvolutionDirectText: vi.fn(async (p: { telefone: string; text: string }) => {
    gateway.enviados.push(p);
    return { ok: true, providerMessageId: "m1" };
  }),
}));

import {
  avisarCredenciamentoAprovado,
  coordenadoresDosEmpreendimentosPorId,
  enviarPeloRelacionamento,
  telefoneDaImobiliaria,
  telefoneParaEnvio,
} from "./disparo-credenciamento";

describe("telefoneDaImobiliaria", () => {
  it("prefere o representante legal ao contato da empresa", () => {
    // O contato da empresa costuma ser FIXO, e o WhatsApp não entrega em fixo.
    expect(
      telefoneDaImobiliaria(["(31) 99496-2518", "(31) 3852-3113"]),
    ).toBe("(31) 99496-2518");
  });

  it("cai no contato da empresa quando não há representante", () => {
    // O caso real das fichas vindas do C2X: elas não têm `socios[]` no cadastro, e o celular da
    // empresa é a única fonte. Sem este passo, 3 imobiliárias habilitadas em 16/08 não receberam
    // nada, tendo celular gravado o tempo todo.
    expect(telefoneDaImobiliaria([null, "(33) 98303-3877"])).toBe("(33) 98303-3877");
  });

  it("PULA STRING VAZIA, que é o que o `??` deixava passar", () => {
    // `normalizarTelefone(undefined)` devolve "", e `"" ?? x` continua "" — a origem do
    // "sem telefone" com o número cadastrado logo ali.
    expect(telefoneDaImobiliaria(["", "(31) 99212-5520"])).toBe("(31) 99212-5520");
    expect(telefoneDaImobiliaria(["   ", "31985104553"])).toBe("31985104553");
  });

  it("devolve null quando nenhuma fonte tem valor, em vez de string vazia", () => {
    expect(telefoneDaImobiliaria([])).toBeNull();
    expect(telefoneDaImobiliaria([null, undefined, "", "  "])).toBeNull();
  });
});

describe("telefoneParaEnvio", () => {
  it("acrescenta o DDI ao número nacional", () => {
    expect(telefoneParaEnvio("(31) 99212-5520")).toBe("5531992125520");
    expect(telefoneParaEnvio("3185104553")).toBe("553185104553");
  });

  it("mantém o número que já vem com DDI", () => {
    expect(telefoneParaEnvio("5531992125520")).toBe("5531992125520");
  });

  it("recusa o que não dá para entregar, em vez de mandar para o número errado", () => {
    expect(telefoneParaEnvio("")).toBeNull();
    expect(telefoneParaEnvio(null)).toBeNull();
    expect(telefoneParaEnvio("31 9999")).toBeNull();
  });
});

// ── O COORDENADOR PELO ID (Lucas, 24/09/2026) ────────────────────────────────────────────────────
//
// A habilitação da CONECTTA IMOVEIS no 43 saiu sem aviso à LUNA: a busca ia ao C2X pela sigla RDV
// que o Panteon guardava, e a Nivea tinha acabado de renomear o 43 para PDI. A lista de
// coordenadores voltou vazia, e lista vazia não mandava nada NEM registrava nada.

type Linha = Record<string, unknown>;

/** Supabase de mentira: aplica os `.in()` e guarda cada insert em `apolo_disparos`. */
function supabaseFalso(tabelas: Record<string, Linha[]>) {
  const inseridos: Linha[] = [];
  const client = {
    from(tabela: string) {
      const filtros: Array<[string, unknown]> = [];
      const resposta = () => {
        let linhas = tabelas[tabela] ?? [];
        for (const [coluna, valores] of filtros) {
          if (Array.isArray(valores)) linhas = linhas.filter((l) => valores.includes(l[coluna]));
        }
        return { data: linhas, error: null };
      };
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.in = (coluna: string, valores: unknown) => {
        filtros.push([coluna, valores]);
        return q;
      };
      q.insert = async (linha: Linha) => {
        inseridos.push(linha);
        return { error: null };
      };
      q.then = (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) =>
        Promise.resolve(resposta()).then(ok, falha);
      return q;
    },
  } as unknown as SupabaseClient;
  return { client, inseridos };
}

const LUNA = { entityId: "luna", name: "LUNA NEGOCIOS IMOBILIARIOS", phone: "(31) 99596-0000", relation: "coordenador_vendas" };
const HUBER = { entityId: "huber", name: "HUBER NEGOCIOS IMOBILIARIOS LTDA", phone: "(31) 98765-0000", relation: "coordenador_vendas" };

function c2xPorId(porId: Record<string, CadastroDoC2xPorId["players"]>): FontesDoCoordenador {
  return {
    cadastroDoC2x: async (ids) => ({
      cadastros: ids.filter((id) => porId[id]).map((id) => ({ enterpriseId: id, players: porId[id]! })),
      ok: true,
    }),
    cadastroDoPanteon: async () => [],
  };
}

beforeEach(() => {
  gateway.enviados = [];
});

describe("coordenadoresDosEmpreendimentosPorId", () => {
  it("⚠️ RDV -> PDI: com a sigla velha no Panteon, a LUNA é achada pelo id 43", async () => {
    const { client } = supabaseFalso({
      apolo_enterprise_settings: [{ code: "RDV", coordenador_entity_id: null, enterprise_id: "43" }],
    });

    const coordenadores = await coordenadoresDosEmpreendimentosPorId(
      client,
      [{ enterpriseId: "43", label: "PORTAL DO IBITURUNA" }],
      c2xPorId({ "43": [LUNA] }),
    );

    expect(coordenadores).toEqual([
      {
        empreendimentos: [{ label: "PORTAL DO IBITURUNA" }],
        nome: "LUNA NEGOCIOS IMOBILIARIOS",
        telefone: "(31) 99596-0000",
      },
    ]);
  });

  it("agrupa por coordenador: quem cuida de dois produtos recebe UMA mensagem com os dois", async () => {
    const { client } = supabaseFalso({});
    const coordenadores = await coordenadoresDosEmpreendimentosPorId(
      client,
      [
        { enterpriseId: "43", label: "PORTAL DO IBITURUNA" },
        { enterpriseId: "42", label: "ALDEIA" },
        { enterpriseId: "37", label: "VALE DO OURO" },
      ],
      c2xPorId({ "37": [HUBER], "42": [LUNA], "43": [LUNA] }),
    );

    expect(coordenadores.map((c) => [c.nome, c.empreendimentos.map((e) => e.label)])).toEqual([
      ["LUNA NEGOCIOS IMOBILIARIOS", ["PORTAL DO IBITURUNA", "ALDEIA"]],
      ["HUBER NEGOCIOS IMOBILIARIOS LTDA", ["VALE DO OURO"]],
    ]);
  });

  it("⚠️ não achar vira uma entrada COM MOTIVO, e o coordenador sem telefone também entra", async () => {
    const { client } = supabaseFalso({});
    const coordenadores = await coordenadoresDosEmpreendimentosPorId(
      client,
      [
        { enterpriseId: "9001", label: "ZZ TESTE" },
        { enterpriseId: "1", label: "LAVRA DO OURO" },
      ],
      c2xPorId({ "1": [{ ...LUNA, entityId: "glender", name: "GLENDER", phone: null }] }),
    );

    expect(coordenadores).toEqual([
      {
        empreendimentos: [{ label: "LAVRA DO OURO" }],
        motivo: "Coordenador GLENDER sem telefone no C2X.",
        nome: "GLENDER",
        telefone: null,
      },
      {
        empreendimentos: [{ label: "ZZ TESTE" }],
        motivo: "ZZ TESTE: Empreendimento sem coordenador de vendas no Panteon nem no C2X.",
        nome: "não encontrado",
        telefone: null,
      },
    ]);
  });
});

describe("⚠️ coordenador não encontrado fica REGISTRADO", () => {
  it("avisarCredenciamentoAprovado grava 'falhou' com o motivo e não chama o gateway para ele", async () => {
    const { client, inseridos } = supabaseFalso({});

    const r = await avisarCredenciamentoAprovado(client, {
      coordenadores: [
        {
          empreendimentos: [{ label: "PORTAL DO IBITURUNA" }],
          motivo: "PORTAL DO IBITURUNA: Empreendimento sem coordenador de vendas no Panteon nem no C2X.",
          nome: "não encontrado",
          telefone: null,
        },
      ],
      corretores: 0,
      empreendimentos: [{ label: "PORTAL DO IBITURUNA" }],
      entityId: "conectta",
      imobiliaria: "CONECTTA IMOVEIS",
      imobiliariaTelefone: "(33) 98303-3877",
      primeiraVez: false,
    });

    // Só a imobiliária recebeu mensagem.
    expect(gateway.enviados.map((e) => e.telefone)).toEqual(["5533983033877"]);
    expect(r.coordenador.ok).toBe(false);

    const doCoordenador = inseridos.find((l) => l.tipo === "credenciamento_coordenador");
    expect(doCoordenador).toMatchObject({
      destinatario: "coordenador:não encontrado",
      entity_id: "conectta",
      erro: "PORTAL DO IBITURUNA: Empreendimento sem coordenador de vendas no Panteon nem no C2X.",
      status: "falhou",
      telefone: null,
    });
  });

  it("enviarPeloRelacionamento com impedimento registra e não envia, mesmo havendo telefone", async () => {
    const { client, inseridos } = supabaseFalso({});
    const r = await enviarPeloRelacionamento(client, {
      destinatario: "coordenador",
      entityId: "imob-1",
      impedimento: "Coordenador CARELI ACESSORIA sem telefone no cadastro do Panteon.",
      telefone: "31999990000",
      texto: "oi",
      tipo: "hercules_reserva",
    });

    expect(r).toEqual({ erro: "Coordenador CARELI ACESSORIA sem telefone no cadastro do Panteon.", ok: false });
    expect(gateway.enviados).toHaveLength(0);
    expect(inseridos).toEqual([
      expect.objectContaining({ status: "falhou", telefone: null, tipo: "hercules_reserva" }),
    ]);
  });
});
