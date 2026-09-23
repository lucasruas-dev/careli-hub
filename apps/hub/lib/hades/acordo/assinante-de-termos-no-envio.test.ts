import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GuardianCompromissoDetail } from "@/lib/guardian/compromissos";

// A PRECEDÊNCIA DE QUEM ASSINA PELO INCORPORADOR NO TERMO DE ACORDO.
//
// Lucas (20/09/2026): *"essa tela determina os assinantes (...) nessa tela vc pode abrir mais um
// campo para assinatura de termos vendedora, ae eu posso apontar quem vai assinar os termos, não
// precisa necessariamente ser os representantes legais, pode ser o juridico, analista, enfim"*.
//
//     apontado para TERMOS  →  vendedora do quadro  →  representante legal da PJ
//
// ⚠️ OS DOIS ÚLTIMOS DEGRAUS JÁ EXISTIAM, e é isso que estes testes cobram: o campo novo ACRESCENTA
// um degrau na frente e não tira nenhum. Quem nunca apontar ninguém tem de continuar caindo
// exatamente onde caía — um empreendimento que hoje manda acordo não pode parar de mandar porque
// nasceu um campo que ninguém preencheu.
//
// ⚠️ E NADA AQUI TOCA A CLICKSIGN. `prepararEnvioDoAcordo` é a leitura que a tela faz antes de
// alguém clicar; a conta é de PRODUÇÃO e envelope ativado não se apaga.

const leituraDaVenda = vi.fn();
const quadroDoEmpreendimento = vi.fn();
const apontadoParaTermos = vi.fn();

vi.mock("@/lib/temis/dados-do-contrato", () => ({
  dadosDaProposta: (...args: unknown[]) => leituraDaVenda(...args),
}));

vi.mock("@/lib/assinatura/quadro-db", () => ({
  assinanteDeTermosDaVendedora: (...args: unknown[]) => apontadoParaTermos(...args),
  assinantesDoQuadro: (...args: unknown[]) => quadroDoEmpreendimento(...args),
  empresasDoEmpreendimento: async () => ({ coordenador: null, vendedora: "ent-vendedora" }),
}));

const { prepararEnvioDoAcordo } = await import("./envio-db");

// ── O CASO ──────────────────────────────────────────────────────────────────

const acordo = (): GuardianCompromissoDetail =>
  ({
    acquisitionRequestC2xId: 9001,
    approvalStatus: "aprovado",
    clientC2xId: 2508,
    id: "11111111-2222-3333-4444-555555555555",
    kind: "acordo",
    metadata: {},
    parcelas: [{ amount: 591.08, dueDate: "2026-07-15", id: "p1", sequence: 1 }],
    protocol: "AC-000042",
    status: "ativo",
  }) as unknown as GuardianCompromissoDetail;

function vendaDoPanteon(gerais: Record<string, string> = {}) {
  return {
    avisos: [],
    carteira: null,
    dados: {
      compradores: [
        {
          temConjuge: false,
          valores: {
            cpf_cliente: "444.555.666-17",
            email_cliente: "comprador@exemplo.test",
            nome_cliente: "Beltrano Exemplo Ferreira",
            telefone_cliente: "31999990000",
          },
        },
      ],
      gerais: {
        __empreendimento_id: "19",
        codigo_unidade: "VDO1301",
        empreendimento_codigo: "VDO",
        ...gerais,
      },
    },
  };
}

const representanteLegal = {
  cpf: "111.222.333-44",
  email: "representante@incorporadora.test",
  nome: "Fulana Representante Legal",
  papel: "vendedora" as const,
  telefone: null,
};

const analistaDosTermos = {
  cpf: null,
  email: "juridico@incorporadora.test",
  nome: "Analista Do Juridico",
  papel: "vendedora" as const,
  telefone: null,
};

/** O duplo do Supabase: uma proposta, e nenhum envelope deste acordo ainda. */
function bancoSemEnvelope(): SupabaseClient {
  const from = (tabela: string) => {
    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      eq: () => builder,
      limit: () =>
        tabela === "temis_envelopes" ? Promise.resolve({ data: [], error: null }) : builder,
      maybeSingle: () =>
        Promise.resolve({ data: { id: "prop-1", unidade_id: "uni-1" }, error: null }),
      order: () => builder,
      select: () => builder,
    });
    return builder;
  };
  return { from } as unknown as SupabaseClient;
}

beforeEach(() => {
  vi.clearAllMocks();
  leituraDaVenda.mockResolvedValue(vendaDoPanteon());
  quadroDoEmpreendimento.mockResolvedValue([]);
  apontadoParaTermos.mockResolvedValue(null);
});

describe("quem assina pelo incorporador, na ordem em que o Panteon procura", () => {
  // ⚠️ O PRIMEIRO DEGRAU É O PEDIDO DO LUCAS. Quem assina a compra e venda pela empresa costuma NÃO
  // ser quem despacha um termo de acordo: pôr o apontado atrás da vendedora do quadro faria o campo
  // novo nunca valer em empreendimento que já tem o contrato configurado — ou seja, justamente nos
  // que mandam acordo.
  it("o apontado para os TERMOS vence a vendedora do quadro", async () => {
    quadroDoEmpreendimento.mockResolvedValue([representanteLegal]);
    apontadoParaTermos.mockResolvedValue(analistaDosTermos);

    const preparo = await prepararEnvioDoAcordo(bancoSemEnvelope(), acordo());
    if (!preparo.ok) throw new Error("o preparo devia ter dado certo");

    expect(preparo.impedimento).toBeNull();
    expect(preparo.signatarios.map((s) => [s.papel, s.nome, s.ordem])).toEqual([
      ["comprador", "BELTRANO EXEMPLO FERREIRA", 1],
      ["vendedora", "ANALISTA DO JURIDICO", 2],
      ["careli", "NIVEA CARELI", 3],
    ]);
  });

  // ⚠️ NADA DO QUE FUNCIONA HOJE PODE PARAR DE FUNCIONAR. O representante legal chega ao envio
  // DENTRO da lista do quadro (é `assinantesDoQuadro` quem o acrescenta quando ninguém ocupou a
  // vendedora), e esse caminho continua inteiro.
  it("sem ninguém apontado, cai na vendedora do quadro, como antes", async () => {
    quadroDoEmpreendimento.mockResolvedValue([representanteLegal]);

    const preparo = await prepararEnvioDoAcordo(bancoSemEnvelope(), acordo());
    if (!preparo.ok) throw new Error("o preparo devia ter dado certo");

    expect(preparo.impedimento).toBeNull();
    expect(preparo.signatarios.map((s) => s.nome)).toEqual([
      "BELTRANO EXEMPLO FERREIRA",
      "FULANA REPRESENTANTE LEGAL",
      "NIVEA CARELI",
    ]);
  });

  // ⚠️ ESTE É O ESTADO DE HOJE, MEDIDO EM 20/09/2026: `temis_assinantes` está VAZIA e ZERO das 23
  // incorporadoras tem representante legal em `apolo_relationships`. É esta frase que todo operador
  // lê, e ela tem de dizer o caminho BARATO primeiro (apontar alguém no quadro), não o caro (mexer
  // no cadastro da PJ, que muda também o contrato de venda).
  it("sem nenhum dos dois, a frase manda apontar quem assina os termos, e diz onde", async () => {
    const preparo = await prepararEnvioDoAcordo(bancoSemEnvelope(), acordo());
    if (!preparo.ok) throw new Error("o preparo devia ter dado certo");

    expect(preparo.impedimento).toContain("TERMOS");
    expect(preparo.impedimento).toContain("Assinatura de termos (vendedora)");
    expect(preparo.impedimento).toContain("Quadro de assinatura do empreendimento");
    expect(preparo.impedimento).toContain("não precisa ser o representante legal");
  });
});

describe("o recorte é o EMPREENDIMENTO, e é o mesmo do resto do quadro", () => {
  // ⚠️ SEM REGRA NOVA DE HERANÇA. O quadro (`temis_assinantes`) só tem `enterprise_id`: não há
  // nível de unidade, de categoria nem de pai, e inventá-los aqui criaria uma precedência que a
  // tela do quadro não saberia explicar. O empreendimento lido é o MESMO das outras duas leituras
  // deste caminho.
  it("procura o apontado no empreendimento da proposta", async () => {
    const sb = bancoSemEnvelope();
    await prepararEnvioDoAcordo(sb, acordo());

    expect(apontadoParaTermos).toHaveBeenCalledWith(sb, "19");
  });

  // ⚠️ E CAI PARA O DA UNIDADE, como `assinantesDoQuadro`. Três empreendimentos (LOX, PDX, RDX) têm
  // `c2x_enterprise_id` nulo, e a Lavra do Ouro — que responde pela maioria dos acordos — está
  // nesse caso: sem esta queda, o campo novo nunca seria encontrado justamente onde mais importa.
  it("cai para o id que vive na unidade quando o empreendimento não tem o dele", async () => {
    leituraDaVenda.mockResolvedValue(
      vendaDoPanteon({ __empreendimento_id: "", __unidade_enterprise_id: "4" }),
    );

    const sb = bancoSemEnvelope();
    await prepararEnvioDoAcordo(sb, acordo());

    expect(apontadoParaTermos).toHaveBeenCalledWith(sb, "4");
  });
});
