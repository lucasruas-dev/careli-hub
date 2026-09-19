// A etapa 1 do card da Têmis: o que a tela mostra, montado pela mesma leitura do contrato.
//
// Lucas (18/09/2026): *"rg não precisa"* · *"a única coisa que vamos utilizar o c2x é a questão
// financeira, mesmo assim ela tem que morar dentro da carteira no apolo"*.

import { describe, expect, it } from "vitest";

import type { CarteiraDaVenda } from "@/lib/apolo/carteira-da-venda";

import { analiseDoTrabalho, financeiroDaCarteira } from "./analise-do-trabalho";
import { semValorNaCarteira } from "./dados-do-contrato";

type Filtros = Record<string, unknown>;

function clienteFalso(porTabela: Record<string, unknown>) {
  return {
    from: (tabela: string) => {
      const filtros: Filtros = {};
      const resposta = () => {
        const bruto = porTabela[tabela];
        const valor = typeof bruto === "function" ? (bruto as (f: Filtros) => unknown)(filtros) : bruto;
        const comErro = valor as { erro?: { code?: string; message: string } } | null | undefined;
        if (comErro && typeof comErro === "object" && "erro" in comErro && comErro.erro) {
          return { data: null, error: comErro.erro };
        }
        return { data: valor ?? null, error: null };
      };
      const encadeia: Record<string, unknown> = new Proxy(
        {},
        {
          get(_alvo, prop: string) {
            if (prop === "maybeSingle") return () => Promise.resolve(resposta());
            if (prop === "then") {
              return (resolver: (r: unknown) => unknown) => Promise.resolve(resolver(resposta()));
            }
            if (prop === "eq") {
              return (coluna: string, valor: unknown) => {
                filtros[coluna] = valor;
                return encadeia;
              };
            }
            return () => encadeia;
          },
        },
      );
      return encadeia;
    },
  } as never;
}

const ENTIDADE = {
  created_at: "2026-01-01T00:00:00Z",
  display_name: "COMPRADOR",
  document_masked: "111.444.777-35",
  entity_kind: "pf",
  id: "a0000000-0000-0000-0000-000000000001",
  legal_name: null,
  metadata: {},
  status: "active",
  trade_name: null,
};

const IMPORTADA = {
  cliente_c2x_id: null,
  cliente_documento: "11144477735",
  cliente_nome: "COMPRADOR",
  compradores: [{ documento: "111.444.777-35", nome: "COMPRADOR", percentual: 100, titular: true }],
  condicoes: null,
  contrato_parcelas: null,
  dia_vencimento: 10,
  empreendimento_id: null,
  origem_c2x_id: 4918,
  plano_nome: "Plano 156x",
  unidade_id: null,
  valor: 150000,
};

describe("o RG na etapa 1", () => {
  it("sem RG, a linha não aparece — nem como pendência", async () => {
    const a = (await analiseDoTrabalho(
      clienteFalso({
        apolo_entities: [ENTIDADE],
        apolo_esteira: [{ enterprise_id: "35", entity_id: ENTIDADE.id, ficha: { nacionalidade: "Brasileira" } }],
        hercules_propostas: IMPORTADA,
      }),
      "p",
    ))!;
    const rotulos = a.proponentes[0]!.campos.map((c) => c.rotulo);
    expect(rotulos).not.toContain("RG");
    expect(a.avisos.join(" | ")).not.toContain("RG");
  });

  it("com RG, ele continua na tela", async () => {
    const a = (await analiseDoTrabalho(
      clienteFalso({
        apolo_entities: [ENTIDADE],
        apolo_esteira: [
          { enterprise_id: "35", entity_id: ENTIDADE.id, ficha: { orgaoEmissor: "SSP/MG", rg: "MG-1" } },
        ],
        hercules_propostas: IMPORTADA,
      }),
      "p",
    ))!;
    const rg = a.proponentes[0]!.campos.find((c) => c.rotulo === "RG");
    expect(rg).toEqual({ faltando: false, rotulo: "RG", valor: "MG-1 SSP/MG" });
  });
});

describe("o bloco 'A proposta' da venda importada", () => {
  it("carteira sem a venda: 'a carteira do Apolo ainda não separa esta venda por parcela', e não 'não informado'", async () => {
    const a = (await analiseDoTrabalho(
      clienteFalso({
        apolo_carteira_vendas: {
          erro: { code: "PGRST205", message: "Could not find the table 'public.apolo_carteira_vendas' in the schema cache" },
        },
        apolo_entities: [ENTIDADE],
        hercules_propostas: IMPORTADA,
      }),
      "p",
    ))!;

    expect(a.comercial).toBeNull();
    expect(a.financeiro).toMatchObject({ fonte: "carteira_do_apolo", situacao: "nunca_sincronizada" });
    expect(a.financeiro?.texto).toContain("a carteira do Apolo ainda não separa esta venda por parcela");
    // A carteira do Apolo tem as parcelas da PESSOA; afirmar "sem lançamentos" seria desmentido por ela.
    expect(a.financeiro?.texto).not.toContain("sem lançamentos");

    const porRotulo = Object.fromEntries(a.proposta.map((c) => [c.rotulo, c]));
    expect(porRotulo.Entrada).toEqual({
      faltando: true,
      rotulo: "Entrada",
      valor: "a carteira do Apolo ainda não separa esta venda por parcela",
    });
    expect(porRotulo["A financiar"]?.valor).toBe("a carteira do Apolo ainda não separa esta venda por parcela");
    expect(porRotulo.Parcelas?.valor).toBe("a carteira do Apolo ainda não separa esta venda por parcela");
    // O que é da proposta continua saindo dela.
    expect(porRotulo["Valor da venda"]?.valor).toBe("R$ 150.000,00");
    expect(a.proposta.some((c) => c.valor === "não informado" && c.rotulo === "Entrada")).toBe(false);
  });

  it("com o prazo gravado na proposta, 'Parcelas' continua vindo dela", async () => {
    const a = (await analiseDoTrabalho(
      clienteFalso({
        apolo_carteira_vendas: null,
        apolo_entities: [ENTIDADE],
        hercules_propostas: { ...IMPORTADA, contrato_parcelas: 180 },
      }),
      "p",
    ))!;
    expect(a.proposta.find((c) => c.rotulo === "Parcelas")?.valor).toBe("180");
  });

  it("com carteira: entrada, mensais, pago e em aberto, e a fonte dita no topo", async () => {
    const parcela = (id: number, tipo: number, valor: number, extra: Record<string, unknown> = {}) => ({
      a_excluir: false,
      c2x_payment_id: id,
      parcela_atual: tipo === 3 ? id - 10 : 0,
      status_id: 6,
      tipo_id: tipo,
      valor_inicial: valor,
      valor_pago: 0,
      vencimento: "2030-01-10",
      ...extra,
    });
    const a = (await analiseDoTrabalho(
      clienteFalso({
        apolo_carteira_parcelas: [
          parcela(1, 1, 0.01, { pagamento: "2026-08-20", status_id: 5, valor_pago: 0.01 }),
          parcela(2, 2, 14999.99, { vencimento: "2026-09-08" }),
          parcela(11, 3, 1250),
          parcela(12, 3, 1250),
        ],
        apolo_carteira_vendas: { estagio_c2x: 4, parcelas: 4, sincronizada_em: "2026-09-18T21:45:19Z" },
        apolo_entities: [ENTIDADE],
        hercules_propostas: IMPORTADA,
      }),
      "p",
    ))!;

    expect(a.financeiro?.situacao).toBe("ok");
    expect(a.financeiro?.texto).toContain("carteira do Apolo, sincronizada em 18/09/2026");
    const porRotulo = Object.fromEntries(a.proposta.map((c) => [c.rotulo, c.valor]));
    expect(porRotulo.Entrada).toMatch(/15\.000,00 · 1 ato \+ 1 sinal$/);
    expect(porRotulo.Mensais).toMatch(/^2 de R\$\s1\.250,00$/);
    expect(porRotulo["A financiar"]).toMatch(/2\.500,00$/);
    expect(porRotulo.Parcelas).toBe("2");
    expect(porRotulo["Pago até hoje"]).toMatch(/0,01 · 1 parcela$/);
    expect(porRotulo["Em aberto"]).toMatch(/17\.499,99 · 3 parcelas, R\$\s14\.999,99 vencidos$/);
  });
});

describe("a frase do topo", () => {
  it("nativa não tem frase: o bloco é o cronograma dela", () => {
    expect(financeiroDaCarteira({ situacao: "nativa" })).toBeNull();
    expect(financeiroDaCarteira(null)).toBeNull();
  });

  it("só a carteira da venda lida pode dizer 'sem lançamentos'", () => {
    expect(semValorNaCarteira({ motivo: "sem_parcela", situacao: "sem_carteira", sincronizadaEm: "2026-09-18T00:00:00Z" })).toBe(
      "sem lançamentos na carteira do Apolo",
    );
    expect(semValorNaCarteira({ motivo: "nunca_sincronizada", situacao: "sem_carteira", sincronizadaEm: null })).toBe(
      "a carteira do Apolo ainda não separa esta venda por parcela",
    );
    expect(semValorNaCarteira({ error: "timeout", situacao: "erro" })).toBe("não consegui ler a carteira do Apolo");
    // A frase do topo da venda nunca sincronizada também não afirma ausência de lançamento.
    expect(
      financeiroDaCarteira({ motivo: "nunca_sincronizada", situacao: "sem_carteira", sincronizadaEm: null })?.texto,
    ).not.toContain("sem lançamentos");
  });

  it("cada situação diz a fonte", () => {
    const casos: CarteiraDaVenda[] = [
      { motivo: "nunca_sincronizada", situacao: "sem_carteira", sincronizadaEm: null },
      { motivo: "sem_parcela", situacao: "sem_carteira", sincronizadaEm: "2026-09-18T00:00:00Z" },
      { error: "timeout", situacao: "erro" },
    ];
    for (const caso of casos) {
      expect(financeiroDaCarteira(caso)?.texto).toContain("carteira do Apolo");
      // Texto visível sem travessão (regra da casa).
      expect(financeiroDaCarteira(caso)?.texto).not.toContain("—");
    }
  });
});
