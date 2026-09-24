import { describe, expect, it } from "vitest";

import {
  nomeDeMercado,
  nomeDeMercadoDoEmpreendimento,
  semDivisao,
  type LinhaDoCadastro,
} from "./empreendimento-de-mercado";

// O NOME QUE VAI NO CABEÇALHO DA CAD. Os pares abaixo são os de produção, medidos em
// `hercules_empreendimentos` em 24/09/2026 (os 13 filhos têm o sufixo " · SIGLA"; o prefixo é o nome
// do pai). O que está travado aqui é a regra do Lucas: o corretor recebe esta CAD e não vê divisão.

const VLO: LinhaDoCadastro = { c2x_enterprise_id: "35", id: "h-vlo", nome: "Vale do Ouro", pai_id: null };
const VOC: LinhaDoCadastro = {
  c2x_enterprise_id: "37",
  id: "h-voc",
  nome: "Vale do Ouro · VOC",
  pai_id: "h-vlo",
};
const VDO: LinhaDoCadastro = { c2x_enterprise_id: "19", id: "h-vdo", nome: "Veredas do Ouro", pai_id: null };
const LAB: LinhaDoCadastro = { c2x_enterprise_id: "31", id: "h-lab", nome: "Lagoa Bonita", pai_id: null };
const LBF: LinhaDoCadastro = {
  c2x_enterprise_id: "33",
  id: "h-lbf",
  nome: "Lagoa Bonita · LBF",
  pai_id: "h-lab",
};
// Lavra do Ouro: o PAI não tem id no C2X (LOX), só os filhos. A subida é pelo `id` do cadastro.
const LOX: LinhaDoCadastro = { c2x_enterprise_id: null, id: "h-lox", nome: "Lavra do Ouro", pai_id: null };
const LOU: LinhaDoCadastro = {
  c2x_enterprise_id: "1",
  id: "h-lou",
  nome: "Lavra do Ouro · LOU",
  pai_id: "h-lox",
};

const CADASTRO = [VLO, VOC, VDO, LAB, LBF, LOX, LOU];

describe("nomeDeMercado (puro)", () => {
  it("filho 37 (VOC) com pai 35 dá o nome do PAI", () => {
    expect(nomeDeMercado("37", CADASTRO)).toBe("Vale do Ouro");
  });

  it("o próprio pai 35 dá Vale do Ouro", () => {
    expect(nomeDeMercado("35", CADASTRO)).toBe("Vale do Ouro");
    expect(nomeDeMercado(35, CADASTRO)).toBe("Vale do Ouro");
  });

  it("19 é Veredas do Ouro (o caso do Jonatas antes da correção): empreendimento sem pai", () => {
    expect(nomeDeMercado("19", CADASTRO)).toBe("Veredas do Ouro");
  });

  it("33 (LBF) dá Lagoa Bonita", () => {
    expect(nomeDeMercado("33", CADASTRO)).toBe("Lagoa Bonita");
  });

  it("filho de pai SEM id no C2X (LOU → LOX) também sobe", () => {
    expect(nomeDeMercado("1", CADASTRO)).toBe("Lavra do Ouro");
  });

  it("id de grupo do portal público vira o próprio nome", () => {
    expect(nomeDeMercado("group:Lagoa Bonita", [])).toBe("Lagoa Bonita");
    expect(nomeDeMercado(" group:Lagoa Bonita ", CADASTRO)).toBe("Lagoa Bonita");
  });

  it("filho com o pai AUSENTE nunca imprime a divisão", () => {
    const resultado = nomeDeMercado("37", [VOC]);
    expect(resultado).not.toBe("Vale do Ouro · VOC");
    expect(resultado).not.toContain("VOC");
    expect(resultado).toBe("Vale do Ouro");
  });

  it("filho com o pai ausente e SEM o separador não diz quem é o pai: vale a reserva, ou nada", () => {
    const semSeparador: LinhaDoCadastro = { ...VOC, nome: "VOC" };
    expect(nomeDeMercado("37", [semSeparador])).toBe("");
    expect(nomeDeMercado("37", [semSeparador], "VALE DO OURO")).toBe("VALE DO OURO");
  });

  it("o cadastro ganha da reserva quando o id está nele", () => {
    expect(nomeDeMercado("35", CADASTRO, "VALE DO OURO")).toBe("Vale do Ouro");
    expect(nomeDeMercado("37", CADASTRO, "Vale do Ouro · VOC")).toBe("Vale do Ouro");
  });

  it("id fora do cadastro usa a reserva, sem o sufixo da divisão", () => {
    expect(nomeDeMercado("99", CADASTRO, "Vale do Ouro · VOL")).toBe("Vale do Ouro");
    expect(nomeDeMercado("99", CADASTRO, "  RESIDENCIAL X ")).toBe("RESIDENCIAL X");
  });

  it("'EMPREENDIMENTO 30' não é nome de nada: a linha é omitida", () => {
    expect(nomeDeMercado("30", CADASTRO, "EMPREENDIMENTO 30")).toBe("");
    expect(nomeDeMercado("2", CADASTRO, "Empreendimento 2")).toBe("");
  });

  it("sem id e sem reserva: vazio", () => {
    expect(nomeDeMercado(null, CADASTRO)).toBe("");
    expect(nomeDeMercado("", CADASTRO, "")).toBe("");
    expect(nomeDeMercado(undefined, [], null)).toBe("");
  });

  it("semDivisao tira só o sufixo", () => {
    expect(semDivisao("Rio de Pedras · RPC")).toBe("Rio de Pedras");
    expect(semDivisao("Garden")).toBe("Garden");
    expect(semDivisao(null)).toBe("");
  });
});

// Cliente falso do supabase-js: devolve `{ data, error }` como a lib real (que NÃO lança em erro de
// consulta). `respostas` responde por (coluna, valor) do `.eq`.
function clienteFalso(respostas: {
  lanca?: boolean;
  porC2x?: { data: LinhaDoCadastro[] | null; error: { message: string } | null };
  porId?: { data: LinhaDoCadastro[] | null; error: { message: string } | null };
}) {
  const consultas: Array<{ coluna: string; tabela: string; valor: unknown }> = [];
  const client = {
    from(tabela: string) {
      let filtro: { coluna: string; valor: unknown } = { coluna: "", valor: null };
      const builder = {
        eq(coluna: string, valor: unknown) {
          filtro = { coluna, valor };
          return builder;
        },
        async limit() {
          if (respostas.lanca) throw new Error("rede caiu");
          consultas.push({ ...filtro, tabela });
          const vazio = { data: [], error: null };
          return filtro.coluna === "c2x_enterprise_id"
            ? (respostas.porC2x ?? vazio)
            : (respostas.porId ?? vazio);
        },
        select() {
          return builder;
        },
      };
      return builder;
    },
  };
  return { client: client as never, consultas };
}

describe("nomeDeMercadoDoEmpreendimento (banco)", () => {
  it("filho: lê a linha pelo c2x_enterprise_id e depois o pai pelo id", async () => {
    const { client, consultas } = clienteFalso({
      porC2x: { data: [VOC], error: null },
      porId: { data: [VLO], error: null },
    });
    expect(await nomeDeMercadoDoEmpreendimento(client, "37")).toBe("Vale do Ouro");
    expect(consultas).toEqual([
      { coluna: "c2x_enterprise_id", tabela: "hercules_empreendimentos", valor: "37" },
      { coluna: "id", tabela: "hercules_empreendimentos", valor: "h-vlo" },
    ]);
  });

  it("empreendimento sem pai: uma consulta só", async () => {
    const { client, consultas } = clienteFalso({ porC2x: { data: [VDO], error: null } });
    expect(await nomeDeMercadoDoEmpreendimento(client, "19", "VEREDAS DO OURO")).toBe("Veredas do Ouro");
    expect(consultas).toHaveLength(1);
  });

  it("leitura do PAI com erro (supabase-js não lança): nunca devolve o nome do filho", async () => {
    const { client } = clienteFalso({
      porC2x: { data: [VOC], error: null },
      porId: { data: null, error: { message: "timeout" } },
    });
    const nome = await nomeDeMercadoDoEmpreendimento(client, "37");
    expect(nome).not.toContain("VOC");
    expect(nome).toBe("Vale do Ouro");
  });

  it("leitura do CADASTRO com erro: só a reserva, sem sufixo", async () => {
    const { client } = clienteFalso({ porC2x: { data: null, error: { message: "timeout" } } });
    expect(await nomeDeMercadoDoEmpreendimento(client, "37", "Vale do Ouro · VOC")).toBe("Vale do Ouro");
    expect(await nomeDeMercadoDoEmpreendimento(client, "37")).toBe("");
  });

  it("exceção de verdade não derruba a CAD", async () => {
    const { client } = clienteFalso({ lanca: true });
    await expect(nomeDeMercadoDoEmpreendimento(client, "37", "VALE DO OURO")).resolves.toBe("VALE DO OURO");
  });

  it("grupo e id vazio não consultam o banco", async () => {
    const { client, consultas } = clienteFalso({});
    expect(await nomeDeMercadoDoEmpreendimento(client, "group:Lagoa Bonita")).toBe("Lagoa Bonita");
    expect(await nomeDeMercadoDoEmpreendimento(client, null)).toBe("");
    expect(consultas).toHaveLength(0);
  });

  it("id fora do cadastro com 'EMPREENDIMENTO 30' na esteira: vazio", async () => {
    const { client } = clienteFalso({ porC2x: { data: [], error: null } });
    expect(await nomeDeMercadoDoEmpreendimento(client, "30", "EMPREENDIMENTO 30")).toBe("");
  });
});
