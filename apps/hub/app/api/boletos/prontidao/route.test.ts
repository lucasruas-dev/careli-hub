import { describe, expect, it, vi } from "vitest";

// A PRONTIDÃO CONTA OS CPFs DE QUEM RECEBE BOLETO, e isso inclui quem já está no Financeiro.
//
// Revisão de 29/09/2026: `lerCarteiraDoLsoft` passou a tirar da lista a carteira que subiu para o
// Financeiro do portal (migration 0199), que é o que a tela LSoft Integração quer. A prontidão lia
// pela mesma função, e depois da subida o Garden cairia de 141 para 35 clientes, sem os 106
// validados, os que de fato recebem boleto. Aqui roda a leitura DE VERDADE contra um banco de
// mentira com um cliente marcado; só a borda (auth, Asaas, catálogo) é dublê.
//
// Dados sintéticos: nenhum nome, CPF ou código real.

const duble = vi.hoisted(() => ({ banco: null as unknown }));

vi.mock("@/lib/apolo/server", () => ({ createApoloAdminClient: () => duble.banco }));
vi.mock("@/lib/apolo/auth", () => ({ authorizeApoloRead: async () => ({ ok: true }) }));
vi.mock("@/lib/apolo/asaas-contas", () => ({ estadoDaConta: () => ({}), TODAS_AS_CONTAS: [] }));
vi.mock("@/lib/apolo/boletos/emissao", () => ({ conferirConta: vi.fn(), situacaoCadastral: vi.fn() }));
vi.mock("@/lib/apolo/boletos/empreendimentos", () => ({
  EMPREENDIMENTOS_DE_BOLETO: [
    { aba: "BOLETOS GARDEN", chaveLsoft: "Garden", conta: null, nome: "Garden", origem: "lsoft", slug: "garden", tipoDeUnidade: "lote" },
  ],
}));

import { GET } from "@/app/api/boletos/prontidao/route";

type Linha = Record<string, unknown>;

/**
 * O mínimo de PostgREST que a leitura da carteira usa: eq, in, neq de lista vazia, o `or` da
 * categoria (`is.null` e `neq`), ordem e página. Completo o bastante para a leitura SEM a opção
 * também rodar até o fim, e a diferença aparecer na contagem, e não num erro do dublê.
 */
function bancoFalso(tabelas: Record<string, Linha[]>) {
  return {
    from(tabela: string) {
      const filtros: Array<(linha: Linha) => boolean> = [];
      let contar = false;
      let faixa: [number, number] = [0, 999];
      const resolver = () => {
        const todas = (tabelas[tabela] ?? []).filter((linha) => filtros.every((f) => f(linha)));
        return { count: contar ? todas.length : null, data: todas.slice(faixa[0], faixa[1] + 1), error: null };
      };
      const consulta = {
        eq(coluna: string, valor: unknown) {
          filtros.push((linha) => linha[coluna] === valor);
          return consulta;
        },
        in(coluna: string, valores: readonly unknown[]) {
          filtros.push((linha) => valores.includes(linha[coluna]));
          return consulta;
        },
        limit: () => consulta,
        maybeSingle: () => Promise.resolve({ data: resolver().data[0] ?? null, error: null }),
        or(expressao: string) {
          filtros.push((linha) =>
            expressao.split(",").some((termo) => {
              const [campo = "", operador, alvo] = termo.split(".");
              const atual = linha[campo];
              if (operador === "is") return atual === null || atual === undefined;
              if (operador === "neq") return atual !== null && atual !== undefined && String(atual) !== alvo;
              return true;
            }),
          );
          return consulta;
        },
        neq(coluna: string) {
          // Só o `neq.{}` da coluna text[] aparece aqui: a lista não vazia.
          filtros.push((linha) => Array.isArray(linha[coluna]) && (linha[coluna] as unknown[]).length > 0);
          return consulta;
        },
        order: () => consulta,
        range(de: number, ate: number) {
          faixa = [de, ate];
          return consulta;
        },
        select(_colunas: string, opcoes?: { count?: string }) {
          contar = opcoes?.count === "exact";
          return consulta;
        },
        then(ok: (valor: unknown) => unknown, falha?: (erro: unknown) => unknown) {
          return Promise.resolve(resolver()).then(ok, falha);
        },
      };
      return consulta;
    },
  };
}

const linhaDoGarden = (codigo: string, cpf: null | string): Linha => ({
  codigo,
  cpf,
  empreendimento: "Garden",
  nome: `Cliente ${codigo}`,
  parcelas: 3,
  parcelas_abertas: 3,
  saldo_aberto: "300.00",
});

describe("GET /api/boletos/prontidao", () => {
  it("conta o CPF de quem já está no Financeiro: o Garden validado continua recebendo boleto", async () => {
    duble.banco = bancoFalso({
      lsoft_carteira_por_cliente_empreendimento: [linhaDoGarden("G1", "00000000191"), linhaDoGarden("G2", null)],
      // G1 subiu para o Financeiro; na tela LSoft Integração ele não aparece mais no Garden.
      lsoft_clientes: [
        { codigo: "G1", empreendimentos_na_carteira: ["Garden"] },
        { codigo: "G2", empreendimentos_na_carteira: [] },
      ],
      lsoft_parcelas: [],
      lsoft_sincronizacoes: [],
    });

    const resposta = await GET(new Request("http://localhost/api/boletos/prontidao"));
    const corpo = (await resposta.json()) as { data: { empreendimentos: Array<{ cpf: unknown; slug: string }> } };

    expect(corpo.data.empreendimentos.find((e) => e.slug === "garden")?.cpf).toEqual({
      clientes: 2,
      comCpf: 1,
      semCpf: 1,
    });
  });
});
