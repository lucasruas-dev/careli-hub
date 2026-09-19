// A carteira de uma venda importada, lida do Panteon — e de lugar nenhum mais.
//
// Lucas (18/09/2026): *"a única coisa que vamos utilizar o c2x é a questão financeira, mesmo assim
// ela tem que morar dentro da carteira no apolo"*.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  carteiraDaVenda,
  carteiraDaVendaImportada,
  type LinhaDaParcelaNaCarteira,
  parcelaDaCarteira,
  resumirCarteira,
} from "./carteira-da-venda";
import type { ExtratoClienteContrato } from "./extrato-cliente";

type Filtros = Record<string, unknown>;

function clienteFalso(porTabela: Record<string, unknown>, lidas?: { filtros: Filtros; tabela: string }[]) {
  return {
    from: (tabela: string) => {
      const filtros: Filtros = {};
      lidas?.push({ filtros, tabela });
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
            if (prop === "range") {
              return (de: number, ate: number) => {
                filtros.range = [de, ate];
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

const HOJE = "2026-09-18";

function linha(id: number, tipo: number, valor: number, extra: Partial<LinhaDaParcelaNaCarteira> = {}): LinhaDaParcelaNaCarteira {
  return {
    a_excluir: false,
    boleto_url: null,
    c2x_payment_id: id,
    competencia: null,
    descricao: null,
    fatura_url: null,
    juros: 0,
    multa: 0,
    pagamento: null,
    parcela_atual: tipo === 3 ? id : 0,
    parcela_total: tipo === 3 ? 156 : 0,
    sinal_atual: tipo === 2 ? 1 : 0,
    sinal_total: tipo === 2 ? 1 : 0,
    status_id: 6,
    tipo_id: tipo,
    tipo_nome: null,
    valor_inicial: valor,
    valor_pago: 0,
    vencimento: "2030-01-10",
    ...extra,
  };
}

const CONTRATO: ExtratoClienteContrato = {
  area: 360,
  codigo: "VOC0911",
  dataAssinatura: null,
  dataAto: null,
  empreendimentoCodigo: "VLO",
  empreendimentoNome: "Vale do Ouro",
  encerrado: false,
  estagio: 4,
  estagioNome: null,
  id: 4918,
  indiceCorrecao: null,
  jurosContratuais: null,
  lote: "11",
  planoPadraoParcelas: 156,
  planoParcelas: 156,
  planoPersonalizado: false,
  precoTabela: 150000,
  quadra: "09",
  titulares: [],
};

describe("a parte pura", () => {
  it("a linha gravada vira a parcela do extrato, com zero virando nulo", () => {
    const p = parcelaDaCarteira(
      linha(7, 1, "0.01" as unknown as number, {
        pagamento: "2026-08-20T00:00:00Z",
        status_id: "5",
        valor_pago: "0.01",
        vencimento: "2026-08-20",
      }),
    );
    expect(p).toMatchObject({
      id: 7,
      pagamento: "2026-08-20",
      parcelaAtual: null,
      sinalAtual: null,
      statusId: 5,
      tipoId: 1,
      valorInicial: 0.01,
      valorPago: 0.01,
    });
  });

  it("o caso VOC Q09 L11 inferido: 1 ato + 1 sinal + 156 mensais = 158, ato de um centavo pago", () => {
    const parcelas = [
      linha(1000, 1, 0.01, { pagamento: "2026-08-20", status_id: 5, valor_pago: 0.01 }),
      linha(1001, 2, 14999.99, { vencimento: "2026-09-08" }),
      ...Array.from({ length: 156 }, (_, k) => linha(k + 1, 3, 1250)),
    ].map(parcelaDaCarteira);

    const r = resumirCarteira(parcelas, CONTRATO, HOJE);

    expect(r.porTipoTotal).toBe(158);
    expect(r.porTipo.ato).toMatchObject({ pago: 0.01, quantidade: 1 });
    // ⚠️ O SINAL VENCIDO DESDE 08/09 APARECE COMO VENCIDO — o retrato por pessoa não o via.
    expect(r.porTipo.sinal).toMatchObject({ aberto: 14999.99, quantidade: 1, vencido: 14999.99 });
    expect(r.parcelasMensais).toBe(156);
    expect(r.mensalidade).toBe(1250);
    expect(r.entrada).toBe(15000);
    expect(r.financiado).toBe(195000);
    expect(r.relatorio.totais.totalPago).toBe(0.01);
  });

  it("anual gravada como mensal (tipo 3) vira reforço, e não mais uma mensalidade", () => {
    const parcelas = [
      ...Array.from({ length: 12 }, (_, k) => linha(k + 1, 3, 1000)),
      linha(13, 3, 12000),
    ].map(parcelaDaCarteira);

    const r = resumirCarteira(parcelas, CONTRATO, HOJE);
    expect(r.parcelasMensais).toBe(12);
    expect(r.porTipo.reforco).toMatchObject({ quantidade: 1, valorContratual: 12000 });
    expect(r.financiado).toBe(24000);
  });

  it("linha marcada para exclusão não conta", () => {
    const r = resumirCarteira(
      [linha(1, 3, 1000, { a_excluir: true })].map(parcelaDaCarteira),
      CONTRATO,
      HOJE,
    );
    expect(r.porTipoTotal).toBe(0);
  });

  it("contrato encerrado: sem saldo em aberto, mas o contratado continua contado", () => {
    const r = resumirCarteira(
      [linha(1, 1, 500, { pagamento: "2026-01-01", status_id: 5, valor_pago: 500 }), linha(2, 3, 1000), linha(3, 3, 1000)].map(
        parcelaDaCarteira,
      ),
      { ...CONTRATO, encerrado: true, estagio: 7 },
      HOJE,
    );
    expect(r.porTipo.mensal).toMatchObject({ aberto: 0, quantidade: 2, valorContratual: 2000 });
    expect(r.porTipo.ato.pago).toBe(500);
  });
});

describe("a leitura", () => {
  const VENDA = { origemC2xId: 4918 };

  it("hoje a tabela não existe: 'nunca sincronizada', e não erro", async () => {
    const r = await carteiraDaVendaImportada(
      clienteFalso({
        apolo_carteira_vendas: {
          erro: {
            code: "PGRST205",
            message: "Could not find the table 'public.apolo_carteira_vendas' in the schema cache",
          },
        },
      }),
      VENDA,
      HOJE,
    );
    expect(r).toEqual({ motivo: "nunca_sincronizada", situacao: "sem_carteira", sincronizadaEm: null });
  });

  it("sem linha no marcador: nunca sincronizada", async () => {
    const r = await carteiraDaVendaImportada(clienteFalso({ apolo_carteira_vendas: null }), VENDA, HOJE);
    expect(r).toMatchObject({ motivo: "nunca_sincronizada", situacao: "sem_carteira" });
  });

  it("sincronizada sem parcela: é fato, com a data", async () => {
    const r = await carteiraDaVendaImportada(
      clienteFalso({
        apolo_carteira_parcelas: [],
        apolo_carteira_vendas: { estagio_c2x: 4, parcelas: 0, sincronizada_em: "2026-09-18T21:45:19Z" },
      }),
      VENDA,
      HOJE,
    );
    expect(r).toEqual({
      motivo: "sem_parcela",
      situacao: "sem_carteira",
      sincronizadaEm: "2026-09-18T21:45:19Z",
    });
  });

  it("falha de leitura é erro, nunca 'sem carteira'", async () => {
    const r = await carteiraDaVendaImportada(
      clienteFalso({ apolo_carteira_vendas: { erro: { code: "57014", message: "timeout" } } }),
      VENDA,
      HOJE,
    );
    expect(r).toEqual({ error: "apolo_carteira_vendas: timeout", situacao: "erro" });
  });

  it("pagina de mil em mil até vir menos de mil", async () => {
    const lidas: { filtros: Filtros; tabela: string }[] = [];
    const mil = Array.from({ length: 1000 }, (_, k) => linha(k + 1, 3, 100));
    const r = await carteiraDaVendaImportada(
      clienteFalso(
        {
          apolo_carteira_parcelas: (f: Filtros) =>
            (f.range as number[])[0] === 0 ? mil : [linha(1001, 3, 100)],
          apolo_carteira_vendas: { estagio_c2x: 4, parcelas: 1001, sincronizada_em: "2026-09-18T00:00:00Z" },
        },
        lidas,
      ),
      VENDA,
      HOJE,
    );
    const paginas = lidas.filter((l) => l.tabela === "apolo_carteira_parcelas");
    expect(paginas.map((p) => p.filtros.range)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(paginas.every((p) => p.filtros.acquisition_request_c2x_id === 4918)).toBe(true);
    expect(r.situacao === "ok" && r.parcelasMensais).toBe(1001);
  });

  it("a venda nativa não tem carteira a ler", async () => {
    const lidas: { filtros: Filtros; tabela: string }[] = [];
    const r = await carteiraDaVenda(
      clienteFalso({ hercules_propostas: { origem_c2x_id: null } }, lidas),
      "p",
      HOJE,
    );
    expect(r).toEqual({ situacao: "nativa" });
    expect(lidas.map((l) => l.tabela)).toEqual(["hercules_propostas"]);
  });
});

// ⚠️ A REGRA DO LUCAS VIRA TRAVA: este arquivo não pode passar a ler o C2X por um import distraído.
describe("não lê o C2X", () => {
  it("nenhum import de mysql2, lib/guardian ou getHadesDbPool", () => {
    const fonte = readFileSync(join(__dirname, "carteira-da-venda.ts"), "utf8");
    const imports = fonte.split("\n").filter((l) => /^\s*import\b|from\s+["']/.test(l));
    expect(imports.join("\n")).not.toMatch(/mysql2|lib\/guardian|getHadesDbPool|extrato-cliente-c2x/);
  });
});
