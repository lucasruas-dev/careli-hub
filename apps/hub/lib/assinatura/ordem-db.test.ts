import { describe, expect, it } from "vitest";

import { regraDeOrdemDaVenda } from "./ordem-db";

// ⚠️ O QUE ESTE TESTE PROTEGE. A cadeia `unidade → categoria → empreendimento` decide a ordem de
// assinatura de TODO contrato daquele produto. Errar aqui não trava nada — o contrato sai, o cliente
// assina antes da vendedora, e só se descobre quando o jurídico confere.

type Linhas = Record<string, unknown>;

/** O duplo do Supabase, no molde de `lib/temis/dados-do-contrato.test.ts`. */
function clienteFalso(porTabela: Linhas, tabelasLidas?: string[]) {
  const construir = (tabela: string) => {
    const resposta = () => ({ data: porTabela[tabela] ?? null, error: null });
    const encadeia: Record<string, unknown> = new Proxy(
      {},
      {
        get(_alvo, prop: string) {
          if (prop === "maybeSingle") return () => Promise.resolve(resposta());
          if (prop === "then") {
            return (resolver: (r: unknown) => unknown) => Promise.resolve(resolver(resposta()));
          }
          return () => encadeia;
        },
      },
    );
    return encadeia;
  };
  return {
    from: (tabela: string) => {
      tabelasLidas?.push(tabela);
      return construir(tabela);
    },
  } as never;
}

const UNIDADE = "11111111-0000-0000-0000-000000000001";
const CATEGORIA = "22222222-0000-0000-0000-000000000002";

describe("de onde a ordem vem", () => {
  it("cai no padrão da casa quando nada está cadastrado", async () => {
    const lido = await regraDeOrdemDaVenda(
      clienteFalso({
        apolo_enterprise_settings: { assinatura_ordem: null, assinatura_ordenada: false },
        hercules_unidades: { categoria_id: null, enterprise_id: "9001" },
      }),
      { enterpriseId: "9001", unidadeId: UNIDADE },
    );

    expect(lido.origem).toBe("padrao");
    // ⚠️ O PADRÃO NASCE DESLIGADO. Ligar a ordem na carteira inteira mudaria o comportamento de
    // contratos que hoje saem em paralelo, sem ninguém ter pedido — e o sintoma seria contrato
    // "parado" esperando alguém que antes assinava a qualquer hora.
    expect(lido.regra.ordenada).toBe(false);
  });

  it("usa a regra do empreendimento quando ela existe", async () => {
    const lido = await regraDeOrdemDaVenda(
      clienteFalso({
        apolo_enterprise_settings: {
          assinatura_ordem: ["vendedora", "comprador", "conjuge"],
          assinatura_ordenada: true,
        },
        hercules_unidades: { categoria_id: null, enterprise_id: "9001" },
      }),
      { enterpriseId: "9001", unidadeId: UNIDADE },
    );

    expect(lido.origem).toBe("empreendimento");
    expect(lido.regra.ordenada).toBe(true);
    expect(lido.regra.papeis.slice(0, 3)).toEqual(["vendedora", "comprador", "conjuge"]);
  });

  it("a categoria da unidade ganha do empreendimento", async () => {
    const lido = await regraDeOrdemDaVenda(
      clienteFalso({
        apolo_enterprise_settings: {
          assinatura_ordem: ["vendedora", "comprador"],
          assinatura_ordenada: true,
        },
        hercules_unidades: { categoria_id: CATEGORIA, enterprise_id: "9001" },
        temis_categorias: {
          assinatura_ordem: ["comprador", "conjuge", "vendedora"],
          assinatura_ordenada: true,
        },
      }),
      { enterpriseId: "9001", unidadeId: UNIDADE },
    );

    expect(lido.origem).toBe("categoria");
    expect(lido.regra.papeis.slice(0, 3)).toEqual(["comprador", "conjuge", "vendedora"]);
  });

  // ⚠️ A ARMADILHA DESTA LEITURA. As duas colunas nascem com o default (`false` e `null`), e uma
  // categoria recém-criada é indistinguível de uma onde alguém decidiu "todos ao mesmo tempo". Se a
  // categoria vencesse por existir, CRIAR uma categoria apagaria em silêncio a ordem configurada no
  // empreendimento — e o sintoma seria a vendedora recebendo o convite junto com o comprador.
  it("categoria sem NADA cadastrado não apaga a ordem do empreendimento", async () => {
    const lido = await regraDeOrdemDaVenda(
      clienteFalso({
        apolo_enterprise_settings: {
          assinatura_ordem: ["comprador", "vendedora"],
          assinatura_ordenada: true,
        },
        hercules_unidades: { categoria_id: CATEGORIA, enterprise_id: "9001" },
        temis_categorias: { assinatura_ordem: null, assinatura_ordenada: false },
      }),
      { enterpriseId: "9001", unidadeId: UNIDADE },
    );

    expect(lido.origem).toBe("empreendimento");
    expect(lido.regra.ordenada).toBe(true);
  });

  // ⚠️ `ordenada = false` COM LISTA GRAVADA É UMA DECISÃO ("todos ao mesmo tempo neste recorte"), e
  // não a ausência de uma. A lista existir é o que distingue as duas coisas.
  it("categoria com lista gravada e ordem desligada é uma decisão, e vence", async () => {
    const lido = await regraDeOrdemDaVenda(
      clienteFalso({
        apolo_enterprise_settings: {
          assinatura_ordem: ["comprador", "vendedora"],
          assinatura_ordenada: true,
        },
        hercules_unidades: { categoria_id: CATEGORIA, enterprise_id: "9001" },
        temis_categorias: { assinatura_ordem: ["comprador"], assinatura_ordenada: false },
      }),
      { enterpriseId: "9001", unidadeId: UNIDADE },
    );

    expect(lido.origem).toBe("categoria");
    expect(lido.regra.ordenada).toBe(false);
  });

  // ⚠️ O `enterprise_id` DA UNIDADE É O SEGUNDO CAMINHO, e ele salva LOX, PDX e RDX — os três
  // empreendimentos cujo `c2x_enterprise_id` é nulo, os mesmos que fariam a busca da minuta ir com
  // string vazia.
  it("usa o enterprise_id da unidade quando quem chamou não soube dizer", async () => {
    const tabelas: string[] = [];
    const lido = await regraDeOrdemDaVenda(
      clienteFalso(
        {
          apolo_enterprise_settings: {
            assinatura_ordem: ["comprador", "vendedora"],
            assinatura_ordenada: true,
          },
          hercules_unidades: { categoria_id: null, enterprise_id: "9001" },
        },
        tabelas,
      ),
      { enterpriseId: null, unidadeId: UNIDADE },
    );

    expect(tabelas).toContain("apolo_enterprise_settings");
    expect(lido.origem).toBe("empreendimento");
  });

  // ⚠️ TOLERA O JSONB SUJO: papel que saiu do código continua gravado lá. Descartar o desconhecido e
  // completar o que falta é melhor do que recusar a regra inteira — uma regra recusada faria o
  // contrato voltar, calado, ao paralelo.
  it("descarta papel que o código não conhece e completa o que falta", async () => {
    const lido = await regraDeOrdemDaVenda(
      clienteFalso({
        apolo_enterprise_settings: {
          assinatura_ordem: ["vendedora", "sindico_do_predio", "comprador"],
          assinatura_ordenada: true,
        },
        hercules_unidades: { categoria_id: null, enterprise_id: "9001" },
      }),
      { enterpriseId: "9001", unidadeId: UNIDADE },
    );

    expect(lido.regra.papeis).not.toContain("sindico_do_predio");
    expect(lido.regra.papeis.slice(0, 2)).toEqual(["vendedora", "comprador"]);
    // Os que faltaram entram depois, na ordem canônica — ninguém fica de fora da regra.
    expect(lido.regra.papeis).toContain("testemunha");
  });
});
