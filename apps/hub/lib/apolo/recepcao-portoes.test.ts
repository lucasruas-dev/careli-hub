import { describe, expect, it } from "vitest";

import { listEnterprisesRecebendo } from "./enterprise-settings";

// PORTÕES PÚBLICOS separados do master (migration 0110). Regra do Lucas (26/08): CAD e
// habilitação de imobiliária acontecem em MOMENTOS DIFERENTES — o Recanto do Vale habilita
// imobiliárias antes da convenção de vendas e só recebe CAD depois.
//
// O que estes testes cobram:
//   1. portão CAD = master AND recepcao_cad; portão imobiliária = master AND recepcao_imobiliaria;
//   2. linha antiga com o flag null conta como LIGADO (bate com o DEFAULT true da migration);
//   3. coluna ainda inexistente (migration 0110 pendente) NÃO quebra: cai no master sozinho,
//      que é o comportamento de antes — formulário público nunca pode cair por migration pendente.

type Linha = {
  credenciamento_ativo: boolean;
  enterprise_id: string;
  recepcao_cad?: boolean | null;
  recepcao_imobiliaria?: boolean | null;
};

// Client fake no mesmo espírito dos outros testes do Apolo: builder encadeável e "thenable".
// `colunasNovasExistem: false` simula o banco SEM a migration 0110 — o select que pede uma das
// colunas novas devolve o erro 42703 do Postgres.
// `erroGenerico: true` simula um erro que NÃO é de coluna ausente (ex.: policy negando a leitura)
// atingindo só o select que pede a coluna nova — o portão deve falhar FECHADO, não cair no master.
function clienteFake(
  linhas: Linha[],
  opts?: { colunasNovasExistem?: boolean; erroGenerico?: boolean },
) {
  const colunasNovasExistem = opts?.colunasNovasExistem ?? true;
  const erroGenerico = opts?.erroGenerico ?? false;

  return {
    from() {
      let colunas = "";
      const filtros: Array<[string, unknown]> = [];
      const builder = {
        eq(col: string, val: unknown) {
          filtros.push([col, val]);
          return builder;
        },
        limit() {
          return builder;
        },
        select(cols: string) {
          colunas = cols;
          return builder;
        },
        then(resolver: (valor: unknown) => unknown) {
          if (erroGenerico && /recepcao_/.test(colunas)) {
            return Promise.resolve(
              resolver({
                data: null,
                error: { code: "42501", message: "permission denied for table apolo_enterprise_settings" },
              }),
            );
          }
          if (!colunasNovasExistem && /recepcao_/.test(colunas)) {
            return Promise.resolve(
              resolver({
                data: null,
                error: { code: "42703", message: 'column "recepcao_cad" does not exist' },
              }),
            );
          }
          const data = linhas
            .filter((l) =>
              filtros.every(([col, val]) => (l as Record<string, unknown>)[col] === val),
            )
            .map((l) => ({ ...l }));
          return Promise.resolve(resolver({ data, error: null }));
        },
      };
      return builder;
    },
  } as unknown as Parameters<typeof listEnterprisesRecebendo>[0];
}

const RECANTO: Linha = {
  // O caso real: master ligado (habilitando imobiliária), CAD ainda fechada até a convenção.
  credenciamento_ativo: true,
  enterprise_id: "50",
  recepcao_cad: false,
  recepcao_imobiliaria: true,
};

const VALE: Linha = {
  // Empreendimento "normal": tudo aberto.
  credenciamento_ativo: true,
  enterprise_id: "10",
  recepcao_cad: true,
  recepcao_imobiliaria: true,
};

const ENCERRADO: Linha = {
  // Master desligado: não entra em portão nenhum, mesmo com as recepções ligadas.
  credenciamento_ativo: false,
  enterprise_id: "99",
  recepcao_cad: true,
  recepcao_imobiliaria: true,
};

describe("portões públicos de recepção (CAD × imobiliária)", () => {
  it("master ligado + CAD desligada: fora do portão CAD, dentro do portão imobiliária", async () => {
    const client = clienteFake([VALE, RECANTO, ENCERRADO]);
    expect(await listEnterprisesRecebendo(client, "cad")).toEqual(["10"]);
    expect(await listEnterprisesRecebendo(client, "imobiliaria")).toEqual(["10", "50"]);
  });

  it("o inverso também vale: imobiliária fechada não some do portão de CAD", async () => {
    const soCad: Linha = {
      credenciamento_ativo: true,
      enterprise_id: "70",
      recepcao_cad: true,
      recepcao_imobiliaria: false,
    };
    const client = clienteFake([soCad]);
    expect(await listEnterprisesRecebendo(client, "cad")).toEqual(["70"]);
    expect(await listEnterprisesRecebendo(client, "imobiliaria")).toEqual([]);
  });

  it("master desligado não entra em portão nenhum", async () => {
    const client = clienteFake([ENCERRADO]);
    expect(await listEnterprisesRecebendo(client, "cad")).toEqual([]);
    expect(await listEnterprisesRecebendo(client, "imobiliaria")).toEqual([]);
  });

  it("linha antiga com o flag null conta como LIGADO (default true da migration)", async () => {
    const antiga: Linha = {
      credenciamento_ativo: true,
      enterprise_id: "33",
      recepcao_cad: null,
      recepcao_imobiliaria: null,
    };
    const client = clienteFake([antiga]);
    expect(await listEnterprisesRecebendo(client, "cad")).toEqual(["33"]);
    expect(await listEnterprisesRecebendo(client, "imobiliaria")).toEqual(["33"]);
  });

  it("erro que NÃO é coluna ausente falha FECHADO ([]), sem reabrir o portão pelo master", async () => {
    const client = clienteFake([VALE, RECANTO], { erroGenerico: true });
    expect(await listEnterprisesRecebendo(client, "cad")).toEqual([]);
    expect(await listEnterprisesRecebendo(client, "imobiliaria")).toEqual([]);
  });

  it("migration 0110 pendente (coluna ausente): cai no master, sem quebrar o formulário", async () => {
    const client = clienteFake([VALE, RECANTO, ENCERRADO], { colunasNovasExistem: false });
    // Sem a coluna não há como distinguir: os DOIS portões devolvem todos os master ligado —
    // exatamente o comportamento de antes da feature.
    expect(await listEnterprisesRecebendo(client, "cad")).toEqual(["10", "50"]);
    expect(await listEnterprisesRecebendo(client, "imobiliaria")).toEqual(["10", "50"]);
  });
});
