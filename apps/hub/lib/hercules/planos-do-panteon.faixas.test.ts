import { describe, expect, it, vi } from "vitest";

import { lerFaixasDoPanteon } from "@/lib/hercules/planos-do-panteon";

// "NÃO CONSEGUI LER" NÃO É A MESMA COISA QUE "NÃO EXISTE O QUE LER" (25/09/2026).
//
// ⚠️ AFIRMAÇÃO EM CAIXA ALTA: ESTA LEITURA VIROU PONTO ÚNICO DE FALHA DA MESA DE VENDA. Desde
// 25/09/2026 o POST de `/api/incorporador/venda/proposta` lê `temis_faixas_de_prazo` e devolve 503
// quando a leitura lança — e devolve para TODO empreendimento, inclusive os que não têm faixa
// nenhuma cadastrada, onde a leitura não pode mudar um número. Medido em 25/09/2026 (`select
// coalesce(p.enterprise_id, f.enterprise_id), p.planos, f.faixas from (select enterprise_id,
// count(*) planos from temis_planos where ativo group by 1) p full join (select enterprise_id,
// count(*) faixas from temis_faixas_de_prazo where ativo group by 1) f using (enterprise_id)`):
// dos 12 empreendimentos com uma das duas coisas, o 39 tem 3 planos e ZERO faixa, e VOL (36), VOR
// (41) e ACP (42 tem 2) não aparecem com faixa para todos os prazos. Uma migration em andamento na
// tabela recusaria proposta em todos eles por uma premissa que não existe para aquele produto.
//
// ⚠️ A CASA JÁ FAZ ESTA DISTINÇÃO EM `apolo_enterprise_settings` (`lib/apolo/enterprise-settings.ts`,
// `tabelaAusente`): tabela ou coluna ausente é "sem settings", e não erro. Aqui é a mesma régua.
// O 503 continua existindo para a falha TRANSITÓRIA (timeout, RLS, conexão), que é onde ele é
// honesto: nesse caso ninguém sabe se havia faixa.

type Resultado = { data: unknown; error: null | { code?: string; message: string } };

/** Um cliente que devolve sempre o mesmo desfecho para `temis_faixas_de_prazo`. */
function clienteQue(resultado: Resultado) {
  const encadeado: Record<string, unknown> = {};
  for (const metodo of ["select", "eq", "in"]) {
    encadeado[metodo] = vi.fn(() => encadeado);
  }
  encadeado.order = vi.fn(async () => resultado);
  return { from: vi.fn(() => encadeado) } as never;
}

describe("a leitura das faixas de prazo separa ausência de falha", () => {
  it("⚠️ tabela ausente (migration pendente) vale SEM FAIXA, e não lança", async () => {
    const aviso = vi.spyOn(console, "error").mockImplementation(() => {});
    const faixas = await lerFaixasDoPanteon(
      clienteQue({
        data: null,
        error: {
          code: "42P01",
          message: 'relation "public.temis_faixas_de_prazo" does not exist',
        },
      }),
      ["36"],
    );
    expect(faixas).toEqual({});
    aviso.mockRestore();
  });

  it("⚠️ tabela fora do cache do PostgREST também vale SEM FAIXA", async () => {
    const aviso = vi.spyOn(console, "error").mockImplementation(() => {});
    const faixas = await lerFaixasDoPanteon(
      clienteQue({
        data: null,
        error: {
          code: "PGRST205",
          message:
            "Could not find the table 'public.temis_faixas_de_prazo' in the schema cache",
        },
      }),
      ["36"],
    );
    expect(faixas).toEqual({});
    aviso.mockRestore();
  });

  it("⚠️ coluna ausente vale SEM FAIXA — é a mesma régua da casa", async () => {
    const aviso = vi.spyOn(console, "error").mockImplementation(() => {});
    const faixas = await lerFaixasDoPanteon(
      clienteQue({
        data: null,
        error: {
          code: "42703",
          message: 'column temis_faixas_de_prazo.define_indice does not exist',
        },
      }),
      ["37"],
    );
    expect(faixas).toEqual({});
    aviso.mockRestore();
  });

  it("falha TRANSITÓRIA continua lançando: aí ninguém sabe se havia faixa", async () => {
    await expect(
      lerFaixasDoPanteon(
        clienteQue({
          data: null,
          error: { code: "57014", message: "canceling statement due to statement timeout" },
        }),
        ["37"],
      ),
    ).rejects.toThrow(/timeout/i);
  });

  it("RLS que nega a leitura continua lançando", async () => {
    await expect(
      lerFaixasDoPanteon(
        clienteQue({
          data: null,
          error: { code: "42501", message: "permission denied for table temis_faixas_de_prazo" },
        }),
        ["37"],
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("a leitura boa continua devolvendo a faixa, por empreendimento", async () => {
    const faixas = await lerFaixasDoPanteon(
      clienteQue({
        data: [
          {
            define_entrada: true,
            define_indice: true,
            define_juros: true,
            enterprise_id: "37",
            entrada_percentual: "20.000",
            indice_correcao: "SEM_CORRECAO",
            juros_convencao: "equivalente",
            juros_periodicidade: "mensal",
            juros_taxa: "0.0000",
            parcela_maxima: 24,
            parcela_minima: 1,
          },
        ],
        error: null,
      }),
      ["37"],
    );
    expect(faixas["37"]).toHaveLength(1);
    expect(faixas["37"]?.[0]?.indiceCorrecao).toBe("SEM_CORRECAO");
  });
});
