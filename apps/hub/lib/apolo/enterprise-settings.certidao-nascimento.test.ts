import { describe, expect, it } from "vitest";

import {
  exigeCertidaoNascimento,
  listEnterpriseSettings,
  setEnterpriseCertidaoNascimento,
} from "./enterprise-settings";

// A CHAVE "CERTIDÃO DE NASCIMENTO" DO EMPREENDIMENTO (migration 0208, 02/10/2026).
//
// O que está travado aqui:
//   • a chave nasce DESLIGADA: nula, ausente ou sem linha é "não exige";
//   • a leitura das três portas (`exigeCertidaoNascimento`) falha para "não exige", como a do
//     comprovante de renda: um soluço do banco não pode derrubar a CAD de todo solteiro;
//   • ⚠️ ANTES DA MIGRATION, A TELA NÃO PERDE O RESTO: sem a coluna nova, `listEnterpriseSettings`
//     refaz a leitura só sem ela, e o comprovante de renda e a ordem de assinatura gravados
//     continuam aparecendo;
//   • o Salvar antes da migration devolve a frase que diz qual migration falta.

const LINHA = {
  analise_credito_habilitada: true,
  assinatura_ordem: null,
  assinatura_ordenada: true,
  code: "VOC",
  comprovante_renda_habilitado: true,
  credenciamento_ativo: true,
  enterprise_id: "37",
  limite_credito: null,
  prevenda_habilitada: true,
  recepcao_cad: true,
  recepcao_imobiliaria: true,
  valor_pix: null,
};

/** `from().select(colunas).limit()`, recusando a leitura que pede a coluna da 0208 quando ela falta. */
function clienteDaLista(linhas: Array<Record<string, unknown>>, semColuna0208 = false) {
  const selects: string[] = [];
  const client = {
    from: () => ({
      select: (colunas: string) => {
        selects.push(colunas);
        return {
          limit: async () =>
            semColuna0208 && colunas.includes("certidao_nascimento_habilitada")
              ? {
                  data: null,
                  error: { message: "column apolo_enterprise_settings.certidao_nascimento_habilitada does not exist" },
                }
              : { data: linhas, error: null },
        };
      },
    }),
  };
  return { client: client as never, selects };
}

/** `from().select().eq().maybeSingle()`, o caminho de uma linha só. */
function clienteDaChave(resposta: { data: unknown; error: unknown }) {
  const chamadas: unknown[][] = [];
  const builder = {
    eq: (...args: unknown[]) => {
      chamadas.push(["eq", ...args]);
      return builder;
    },
    maybeSingle: async () => resposta,
    select: (...args: unknown[]) => {
      chamadas.push(["select", ...args]);
      return builder;
    },
  };
  return { chamadas, client: { from: () => builder } as never };
}

describe("listEnterpriseSettings: certidaoNascimentoHabilitada", () => {
  it("ligada no banco: volta ligada", async () => {
    const { client } = clienteDaLista([{ ...LINHA, certidao_nascimento_habilitada: true }]);
    expect((await listEnterpriseSettings(client))["37"]?.certidaoNascimentoHabilitada).toBe(true);
  });

  it("nula ou falsa: volta desligada (o default da coluna)", async () => {
    for (const valor of [null, false]) {
      const { client } = clienteDaLista([{ ...LINHA, certidao_nascimento_habilitada: valor }]);
      expect((await listEnterpriseSettings(client))["37"]?.certidaoNascimentoHabilitada).toBe(false);
    }
  });

  it("⚠️ coluna da 0208 ausente: desligada, e o comprovante de renda e a ordem continuam lidos", async () => {
    const { client, selects } = clienteDaLista([LINHA], true);
    const setting = (await listEnterpriseSettings(client))["37"];
    expect(setting).toMatchObject({
      assinaturaOrdenada: true,
      certidaoNascimentoHabilitada: false,
      comprovanteRendaHabilitado: true,
      credenciamentoAtivo: true,
    });
    // Duas leituras: a completa e a sem a coluna nova; nunca o núcleo reduzido.
    expect(selects).toHaveLength(2);
    expect(selects[1]).toContain("comprovante_renda_habilitado");
    expect(selects[1]).not.toContain("certidao_nascimento_habilitada");
  });
});

describe("exigeCertidaoNascimento: a leitura das três portas", () => {
  it("ligada: exige, lendo o empreendimento pedido", async () => {
    const { chamadas, client } = clienteDaChave({
      data: { certidao_nascimento_habilitada: true },
      error: null,
    });
    expect(await exigeCertidaoNascimento(client, " 37 ")).toBe(true);
    expect(chamadas).toContainEqual(["eq", "enterprise_id", "37"]);
  });

  it("desligada, nula, sem linha ou erro de leitura: não exige", async () => {
    const respostas = [
      { data: { certidao_nascimento_habilitada: false }, error: null },
      { data: { certidao_nascimento_habilitada: null }, error: null },
      { data: null, error: null },
      { data: null, error: { message: "column does not exist" } },
    ];
    for (const resposta of respostas) {
      expect(await exigeCertidaoNascimento(clienteDaChave(resposta).client, "37")).toBe(false);
    }
  });

  it("sem empreendimento: não exige, e nem consulta o banco", async () => {
    const { chamadas, client } = clienteDaChave({
      data: { certidao_nascimento_habilitada: true },
      error: null,
    });
    expect(await exigeCertidaoNascimento(client, undefined)).toBe(false);
    expect(await exigeCertidaoNascimento(client, "  ")).toBe(false);
    expect(chamadas).toHaveLength(0);
  });
});

describe("setEnterpriseCertidaoNascimento antes da migration", () => {
  it("coluna ausente: a frase diz que falta a migration 0208", async () => {
    const builder = {
      eq: () => builder,
      maybeSingle: async () => ({ data: { enterprise_id: "37" }, error: null }),
      select: () => builder,
      update: () => ({
        eq: async () => ({
          error: { message: "column \"certidao_nascimento_habilitada\" of relation does not exist" },
        }),
      }),
    };
    const client = { from: () => builder } as never;
    const r = await setEnterpriseCertidaoNascimento({
      adminClient: client,
      enterpriseId: "37",
      habilitada: true,
    });
    expect(r).toEqual({
      error: "Coluna desta etapa ainda nao existe (migration 0208 pendente).",
      ok: false,
    });
  });
});
