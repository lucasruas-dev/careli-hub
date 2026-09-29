import { describe, expect, it, vi } from "vitest";

import type { LinhaDoCadastro } from "./empreendimento-de-mercado";
import {
  lerNomesDeMercado,
  mapaDeNomesDeMercado,
  nomeDoEmpreendimentoPorId,
} from "./nome-de-mercado-por-id";

// O NOME QUE O SYNC DO APOLO GRAVA PASSA A SER O DE MERCADO DO PANTEON, PELO ID (24/09/2026).
//
// O que estes testes cobram:
//   1. o nome é o do PAI, sem a divisão interna (o VOC grava "Vale do Ouro", não "Vale do Ouro · VOC");
//   2. o 43 renomeado no Panteon grava "Portal do Ibituruna", qualquer que seja o nome do C2X;
//   3. id que o Panteon não conhece fica com o nome do C2X (não some da ficha nem da busca);
//   4. leitura que falha devolve mapa vazio, e mapa vazio grava o nome do C2X, como antes;
//   5. a leitura é paginada e filtrada pelo workspace.

// Fotografia de produção de 24/09/2026 (SELECT em hercules_empreendimentos), só o que interessa.
const CADASTRO: LinhaDoCadastro[] = [
  { c2x_enterprise_id: "35", id: "u-vlo", nome: "Vale do Ouro", pai_id: null },
  { c2x_enterprise_id: "37", id: "u-voc", nome: "Vale do Ouro · VOC", pai_id: "u-vlo" },
  { c2x_enterprise_id: "36", id: "u-vol", nome: "Vale do Ouro · VOL", pai_id: "u-vlo" },
  { c2x_enterprise_id: null, id: "u-lox", nome: "Lavra do Ouro", pai_id: null },
  { c2x_enterprise_id: "1", id: "u-lou", nome: "Lavra do Ouro · LOU", pai_id: "u-lox" },
  { c2x_enterprise_id: "43", id: "u-pdi", nome: "Portal do Ibituruna", pai_id: null },
  { c2x_enterprise_id: "42", id: "u-acp", nome: "Aldeia das Cachoeiras das Pedras", pai_id: null },
];

describe("mapaDeNomesDeMercado", () => {
  const mapa = mapaDeNomesDeMercado(CADASTRO);

  it("o filho grava o nome do PAI, sem a divisão", () => {
    expect(mapa.get("37")).toBe("Vale do Ouro");
    expect(mapa.get("36")).toBe("Vale do Ouro");
    // Pai só do Panteon (sem id do C2X): o filho sobe para ele do mesmo jeito.
    expect(mapa.get("1")).toBe("Lavra do Ouro");
  });

  it("o empreendimento único grava o próprio nome do Panteon", () => {
    expect(mapa.get("43")).toBe("Portal do Ibituruna");
    expect(mapa.get("42")).toBe("Aldeia das Cachoeiras das Pedras");
  });

  it("linha sem id do C2X não vira chave", () => {
    expect([...mapa.keys()].sort()).toEqual(["1", "35", "36", "37", "42", "43"]);
  });
});

describe("nomeDoEmpreendimentoPorId", () => {
  const mapa = mapaDeNomesDeMercado(CADASTRO);

  it("id conhecido: vale o Panteon, e não o que o C2X diz hoje", () => {
    // A grafia do C2X desde 12/09, que fragmentou apolo_commercial_links em 27 + 20 linhas.
    expect(nomeDoEmpreendimentoPorId(mapa, "42", "ALDEIA DA CACHOEIRA DAS PEDRAS")).toBe(
      "Aldeia das Cachoeiras das Pedras",
    );
    expect(nomeDoEmpreendimentoPorId(mapa, 43, "RECANTO DO VALE")).toBe("Portal do Ibituruna");
    expect(nomeDoEmpreendimentoPorId(mapa, " 37 ", "VALE DO OURO")).toBe("Vale do Ouro");
    // Texto longo de group_concat pode chegar do mysql2 como Buffer.
    expect(nomeDoEmpreendimentoPorId(mapa, Buffer.from("37"), "VALE DO OURO")).toBe("Vale do Ouro");
  });

  it("id que o Panteon não conhece: fica o nome do C2X", () => {
    expect(nomeDoEmpreendimentoPorId(mapa, "44", "EMPREENDIMENTO NOVO NO C2X")).toBe(
      "EMPREENDIMENTO NOVO NO C2X",
    );
  });

  it("sem id (cliente sem compra) ou sem mapa: fica o nome do C2X", () => {
    expect(nomeDoEmpreendimentoPorId(mapa, "", "VALE DO OURO")).toBe("VALE DO OURO");
    expect(nomeDoEmpreendimentoPorId(mapa, null, null)).toBeNull();
    expect(nomeDoEmpreendimentoPorId(undefined, "37", "VALE DO OURO")).toBe("VALE DO OURO");
    expect(nomeDoEmpreendimentoPorId(new Map(), "37", "VALE DO OURO")).toBe("VALE DO OURO");
  });
});

// Cliente fake do Supabase: guarda os filtros e devolve a página pedida por `range`.
function clienteFake(linhas: LinhaDoCadastro[], erro?: { message: string }) {
  const chamadas: { filtros: Array<[string, unknown]>; range: [number, number]; tabela: string }[] = [];
  const client = {
    from(tabela: string) {
      const chamada = { filtros: [] as Array<[string, unknown]>, range: [0, 0] as [number, number], tabela };
      chamadas.push(chamada);
      const builder = {
        eq(coluna: string, valor: unknown) {
          chamada.filtros.push([coluna, valor]);
          return builder;
        },
        order() {
          return builder;
        },
        range(de: number, ate: number) {
          chamada.range = [de, ate];
          return Promise.resolve(
            erro ? { data: null, error: erro } : { data: linhas.slice(de, ate + 1), error: null },
          );
        },
        select() {
          return builder;
        },
      };
      return builder;
    },
  };
  return { chamadas, client: client as never };
}

describe("lerNomesDeMercado", () => {
  it("lê o cadastro do workspace e devolve o mapa", async () => {
    const { chamadas, client } = clienteFake(CADASTRO);
    const mapa = await lerNomesDeMercado(client);

    expect(mapa.get("37")).toBe("Vale do Ouro");
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.tabela).toBe("hercules_empreendimentos");
    expect(chamadas[0]?.filtros).toContainEqual(["workspace_id", "careli"]);
  });

  it("pagina: o teto de 1.000 do PostgREST não esconde o fim do cadastro", async () => {
    const muitas: LinhaDoCadastro[] = Array.from({ length: 1000 }, (_, i) => ({
      c2x_enterprise_id: String(1000 + i),
      id: `u-${i}`,
      nome: `Produto ${i}`,
      pai_id: null,
    }));
    muitas.push({ c2x_enterprise_id: "43", id: "u-pdi", nome: "Portal do Ibituruna", pai_id: null });

    const { chamadas, client } = clienteFake(muitas);
    const mapa = await lerNomesDeMercado(client);

    expect(chamadas.map((c) => c.range)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(mapa.get("43")).toBe("Portal do Ibituruna");
  });

  it("erro de leitura: mapa vazio, sem lançar (o sync da carteira não pode cair pelo nome)", async () => {
    const espiao = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { client } = clienteFake(CADASTRO, { message: "fora do ar" });

    const mapa = await lerNomesDeMercado(client);

    expect(mapa.size).toBe(0);
    expect(nomeDoEmpreendimentoPorId(mapa, "37", "VALE DO OURO")).toBe("VALE DO OURO");
    expect(espiao).toHaveBeenCalled();
    espiao.mockRestore();
  });
});
