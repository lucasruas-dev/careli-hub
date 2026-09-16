import { describe, expect, it } from "vitest";

import { historicoDaFicha, type LinhaAuditoria } from "@/lib/apolo/board-do-servidor";

import {
  EQUIPE_CARELI,
  filtroDoHistoricoDoComercial,
  filtroDoHistoricoDoPortal,
} from "./historico-do-portal";

// `historicoDaFicha` DE VERDADE, com um cliente do Supabase falso: o mesmo miolo servindo o hub
// (sem filtro, igual a antes) e o portal (com filtro). O que se prova aqui e a regra pura sozinha
// não prova: no portal a consulta ao `hub_users` nem pede nome e e-mail, e o evento de outro
// empreendimento não chega à resposta.

type Consulta = { colunas: string; tabela: string };

const HUB_USERS = [{ display_name: "Ana da Careli", email: "ana@careli.adm.br", id: "hub-ana" }];

const EVENTOS: LinhaAuditoria[] = [
  {
    action: "edit_ficha",
    actor_user_id: "hub-ana",
    created_at: "2026-09-16T12:00:10Z",
    field_name: "telefone",
    metadata: { autorNome: null, de: "(37) 1", enterpriseId: "37", para: "(37) 2" },
  },
  {
    action: "edit_ficha",
    actor_user_id: "conta-portal",
    created_at: "2026-09-16T11:00:10Z",
    field_name: "email",
    metadata: { autorNome: "Maria do Cecílio", de: "a@x", enterpriseId: "39", para: "b@x" },
  },
  {
    action: "edit_ficha",
    actor_user_id: "hub-ana",
    created_at: "2026-09-16T10:00:10Z",
    field_name: "cidade",
    metadata: { autorNome: null, de: "Pitangui", enterpriseId: "12", para: "Divinópolis" },
  },
  {
    action: "edit_identity",
    actor_user_id: "hub-ana",
    created_at: "2026-09-15T10:00:10Z",
    field_name: "identidade",
    metadata: { de: { nome: "A" }, origem: "board-validacao", para: { nome: "B" } },
  },
];

function clienteFalso(consultas: Consulta[]) {
  const construtor = (tabela: string) => {
    let colunas = "";
    const resultado = () =>
      tabela === "hub_users"
        ? {
            data: HUB_USERS.map((u) =>
              colunas === "id" ? { id: u.id } : { display_name: u.display_name, email: u.email, id: u.id },
            ),
            error: null,
          }
        : { data: EVENTOS, error: null };
    const cadeia = {
      eq: () => cadeia,
      in: () => (tabela === "hub_users" ? Promise.resolve(resultado()) : cadeia),
      limit: () => Promise.resolve(resultado()),
      order: () => cadeia,
      select: (lista: string) => {
        colunas = lista;
        consultas.push({ colunas: lista, tabela });
        return cadeia;
      },
    };
    return cadeia;
  };
  return { from: construtor } as unknown as Parameters<typeof historicoDaFicha>[0];
}

describe("historicoDaFicha no servidor", () => {
  it("HUB (sem filtro): tudo, com o nome de quem da Careli editou, como antes", async () => {
    const consultas: Consulta[] = [];
    const resposta = await historicoDaFicha(clienteFalso(consultas), "e1");
    const corpo = (await resposta.json()) as {
      data: { edicoes: Array<{ alteracoes: unknown[]; autor: string }> };
    };

    expect(corpo.data.edicoes.map((e) => e.autor)).toEqual([
      "Ana da Careli",
      "Maria do Cecílio",
      "Ana da Careli",
      "Ana da Careli",
    ]);
    expect(consultas).toContainEqual({ colunas: "id, display_name, email", tabela: "hub_users" });
  });

  it("PORTAL (com filtro): só o recorte, sem o evento sem marca, e a Careli sem nome", async () => {
    const consultas: Consulta[] = [];
    const resposta = await historicoDaFicha(
      clienteFalso(consultas),
      "e1",
      filtroDoHistoricoDoPortal(new Set(["37", "39"])),
    );
    const corpo = (await resposta.json()) as {
      data: { edicoes: Array<{ alteracoes: Array<{ campo: string }>; autor: string }> };
    };

    expect(corpo.data.edicoes.map((e) => [e.autor, e.alteracoes.map((a) => a.campo)])).toEqual([
      [EQUIPE_CARELI, ["Telefone"]],
      ["Maria do Cecílio", ["E-mail"]],
    ]);
    expect(JSON.stringify(corpo)).not.toMatch(/Ana da Careli|ana@careli|Divinópolis|hub-ana/);
    expect(consultas.filter((c) => c.tabela === "hub_users")).toEqual([
      { colunas: "id", tabela: "hub_users" },
    ]);
  });

  // (16/09/2026, D4 do Lucas) A Gurgel voltou a ver os nomes dos analistas e a ficha inteira, como
  // antes da onda 1. Só sai o evento MARCADO com produto fora do recorte (o 12, aqui).
  it("COMERCIAL (D4): nomes do hub, evento sem marca incluído; só o marcado fora do recorte some", async () => {
    const consultas: Consulta[] = [];
    const resposta = await historicoDaFicha(
      clienteFalso(consultas),
      "e1",
      filtroDoHistoricoDoComercial(new Set(["37", "39"])),
    );
    const corpo = (await resposta.json()) as {
      data: { edicoes: Array<{ alteracoes: Array<{ campo: string }>; autor: string }> };
    };

    expect(corpo.data.edicoes.map((e) => e.autor)).toEqual(["Ana da Careli", "Maria do Cecílio", "Ana da Careli"]);
    expect(JSON.stringify(corpo)).not.toMatch(/Divinópolis/);
    expect(JSON.stringify(corpo)).not.toContain(EQUIPE_CARELI);
    expect(consultas).toContainEqual({ colunas: "id, display_name, email", tabela: "hub_users" });
  });
});
