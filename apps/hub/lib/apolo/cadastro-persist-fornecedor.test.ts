import { describe, expect, it } from "vitest";

import { createApoloEntity } from "./cadastro-persist";

// O CADASTRO DE FORNECEDOR NA CAMADA QUE GRAVA (02/10/2026).
//
// Lucas, ao habilitar: o fornecedor é CPF ou CNPJ e "já fica ativo" (fora da validação). Ele também
// NÃO É CAD: a pessoa que já compra com a gente pode prestar serviço, e ganha o papel na MESMA ficha.
//
// O que está travado aqui:
//   • ficha nova nasce `active` (entidade e índice de busca), com `bornRole: fornecedor`;
//   • CAD de comprador que a pessoa já tenha não recusa o cadastro de fornecedor, e o papel entra na
//     ficha que existe, sem reescrever os dados de compra dela;
//   • quem solta as travas é a PORTA (`cadastroDeFornecedor`), e o papel tem de concordar: o `role` do
//     corpo sozinho não solta nada, e a porta com papel de comprador também não;
//   • o cliente continua nascendo `review`.
//
// O simulador de banco é o mesmo do teste do corretor (cadastro-persist-corretor.test.ts).

const CPF = "529.982.247-25";
const FICHA = "ent-do-corretor";

type Escrita = { opcoes?: unknown; operacao: string; tabela: string; valores: unknown };

function clienteFake(opcoes: {
  cads?: Array<{ empreendimento: null | string; enterprise_id: null | string; entity_id: string }>;
  codigoDaFicha?: null | string;
  contatos?: Array<Record<string, unknown>>;
  copiaDoDocumento?: string;
  // O `select("display_name, metadata")` do modo anexo falha: é o estado em que o jsonb da ficha
  // NÃO pode ser reescrito (não se mescla o que não se leu).
  erroNaLeituraDaFicha?: { code?: string; message: string };
  fichaExiste?: boolean;
  metadataDaFicha?: Record<string, unknown>;
}) {
  const escritas: Escrita[] = [];

  const client = {
    from(tabela: string) {
      let operacao = "select";
      let colunas = "";
      const builder: Record<string, unknown> = {};

      function resposta(): { data: unknown; error: unknown } {
        if (operacao === "insert" && tabela === "apolo_entities") {
          return { data: [{ id: "ent-nova" }], error: null };
        }
        if (operacao !== "select") return { data: null, error: null };
        if (tabela === "apolo_entity_identifiers") {
          if (!opcoes.fichaExiste) return { data: [], error: null };
          return { data: [{ entity_id: FICHA, identifier_type: "cpf" }], error: null };
        }
        if (tabela === "apolo_entities") {
          if (colunas === "display_name, metadata" && opcoes.erroNaLeituraDaFicha) {
            return { data: null, error: opcoes.erroNaLeituraDaFicha };
          }
          const fichas: Array<Record<string, unknown>> = opcoes.fichaExiste
            ? [
                {
                  broker_code: opcoes.codigoDaFicha ?? null,
                  display_name: "JOAO CORRETOR",
                  id: FICHA,
                  metadata: opcoes.metadataDaFicha ?? {},
                },
              ]
            : [];
          if (colunas === "id" && opcoes.copiaDoDocumento) {
            fichas.push({
              broker_code: null,
              display_name: "JOAO CORRETOR",
              id: opcoes.copiaDoDocumento,
              metadata: {},
            });
          }
          return { data: fichas, error: null };
        }
        if (tabela === "apolo_esteira") return { data: opcoes.cads ?? [], error: null };
        if (tabela === "apolo_contacts") return { data: opcoes.contatos ?? [], error: null };
        return { data: [], error: null };
      }

      for (const metodo of ["eq", "in", "is", "limit", "neq", "not", "order", "range", "ilike", "or"]) {
        builder[metodo] = () => builder;
      }
      builder.select = (selecao?: string) => {
        if (operacao === "select") colunas = String(selecao ?? "");
        return builder;
      };
      const registrar = (op: string, valores: unknown, extra?: unknown) => {
        operacao = op;
        escritas.push({ opcoes: extra, operacao: op, tabela, valores });
        return builder;
      };
      builder.insert = (valores: unknown) => registrar("insert", valores);
      builder.update = (valores: unknown) => registrar("update", valores);
      builder.upsert = (valores: unknown, extra?: unknown) => registrar("upsert", valores, extra);
      builder.maybeSingle = async () => {
        const r = resposta();
        return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
      };
      builder.single = builder.maybeSingle;
      builder.then = (ok: (valor: unknown) => unknown, falha: (e: unknown) => unknown) =>
        Promise.resolve(resposta()).then(ok, falha);

      return builder;
    },
  };

  return { client: client as never, escritas };
}

const FORNECEDOR = {
  dedupPorDocumento: true,
  identidade: { cpf: CPF, nome: "Joao Pedreiro" },
  perfil: { email: "joao@pedreiro.com", telefone: "(62) 98888-0002" },
  persona: "pf" as const,
  role: "fornecedor" as const,
};

const PORTA = { cadastroDeFornecedor: true };

const CAD_NO_VALE = [
  { empreendimento: "VALE DO OURO", enterprise_id: "37", entity_id: FICHA },
];

describe("o fornecedor nasce ativo", () => {
  it("ficha nova: `active` na entidade e no índice, com bornRole e papel de fornecedor", async () => {
    const { client, escritas } = clienteFake({ fichaExiste: false });

    const r = await createApoloEntity(client, FORNECEDOR, PORTA);

    expect(r.ok).toBe(true);
    const ficha = escritas.find((e) => e.tabela === "apolo_entities" && e.operacao === "insert");
    expect(ficha?.valores).toMatchObject({
      entity_kind: "pf",
      metadata: { bornRole: "fornecedor" },
      status: "active",
    });
    const indice = escritas.find((e) => e.tabela === "apolo_search_entries");
    expect((indice?.valores as Array<Record<string, unknown>>)[0]).toMatchObject({
      profile_labels: ["Fornecedor"],
      status: "active",
    });
    const papel = escritas.find((e) => e.tabela === "apolo_entity_profiles");
    expect(papel?.valores).toEqual([
      { entity_id: "ent-nova", profile: "fornecedor", status: "active" },
    ]);
  });

  it("o cliente continua nascendo em `review` (a fila de validação dele não muda)", async () => {
    const { client, escritas } = clienteFake({ fichaExiste: false });

    await createApoloEntity(client, { ...FORNECEDOR, role: "prospect" });

    const ficha = escritas.find((e) => e.tabela === "apolo_entities" && e.operacao === "insert");
    expect(ficha?.valores).toMatchObject({ status: "review" });
  });
});

describe("a pessoa que já compra com a gente pode ser fornecedora", () => {
  it("CAD existente não recusa: o papel de fornecedor entra na ficha que existe", async () => {
    const { client, escritas } = clienteFake({ cads: CAD_NO_VALE, fichaExiste: true });

    const r = await createApoloEntity(client, FORNECEDOR, PORTA);

    expect(r).toMatchObject({ entityId: FICHA, ok: true });
    expect(escritas.filter((e) => e.tabela === "apolo_entities" && e.operacao === "insert")).toHaveLength(0);
    const papel = escritas.find((e) => e.tabela === "apolo_entity_profiles");
    expect(papel?.valores).toEqual([{ entity_id: FICHA, profile: "fornecedor", status: "active" }]);
  });

  it("os dados de compra da ficha vencem o que o cadastro de fornecedor traz", async () => {
    const { client, escritas } = clienteFake({
      cads: CAD_NO_VALE,
      fichaExiste: true,
      metadataDaFicha: {
        bornRole: "prospect",
        cadastro: { estadoCivilId: "2", nomeMae: "MAE DA FICHA" },
        origemCadPublica: "publico-cad",
      },
    });

    await createApoloEntity(
      client,
      { ...FORNECEDOR, identidade: { ...FORNECEDOR.identidade, nomeMae: "OUTRA MAE" } },
      PORTA,
    );

    const anexo = escritas.find((e) => e.tabela === "apolo_entities" && e.operacao === "update");
    expect(anexo?.valores).toMatchObject({
      metadata: {
        bornRole: "prospect",
        cadastro: { estadoCivilId: "2", nomeMae: "MAE DA FICHA" },
        origemCadPublica: "publico-cad",
      },
    });
  });

  it("o papel no CORPO não solta trava nenhuma: sem a porta, a CAD existente recusa", async () => {
    const { client } = clienteFake({ cads: CAD_NO_VALE, fichaExiste: true });

    const r = await createApoloEntity(client, FORNECEDOR);

    expect(r).toMatchObject({ motivo: "cad-no-empreendimento", ok: false });
  });

  it("a porta com papel de comprador não solta nada", async () => {
    const { client } = clienteFake({ cads: CAD_NO_VALE, fichaExiste: true });

    const r = await createApoloEntity(client, { ...FORNECEDOR, role: "prospect" }, PORTA);

    expect(r).toMatchObject({ motivo: "cad-no-empreendimento", ok: false });
  });
});
