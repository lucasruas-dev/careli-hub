import { beforeEach, describe, expect, it, vi } from "vitest";

// O COMPRADOR DA CARTEIRA NÃO ATRAVESSA EMPREENDIMENTO (revisão de 26/09/2026).
//
// Lucas, "Só no mesmo": quem comprou no Vale do Ouro compra de novo no Vale do Ouro (pai e filhos);
// para outro empreendimento, abre CAD como hoje. O teste irmão (route.comprador-da-carteira.test.ts)
// troca a régua por um dublê e simplifica a família; este aqui roda a régua DE VERDADE
// (`credenciadoParaVender`), a família de verdade (`familiaDoEmpreendimento`) e o recorte do portal
// de verdade (`escopoDaEsteiraDoPortal`), com uma sessão como a do Cecílio: 37 (VOC, só consulta) e
// 39 (Garden, operado por ele, sem pai).
//
// ⚠️ O BANCO FALSO NÃO FILTRA OS CONTRATOS PELO EMPREENDIMENTO, de propósito: devolve o contrato do
// VOC até para a pergunta do Garden. É a régua pura (`contratoAtivoNoEscopo`) que tem de barrar, e é
// isso que fica provado aqui: um filtro de banco escrito errado no futuro não abre a porta.

const estado = vi.hoisted(() => ({
  contratos: [] as Array<Record<string, unknown>>,
  inserido: [] as Array<{ linha: Record<string, unknown>; tabela: string }>,
  permitidos: ["37", "39"] as string[],
  sessao: {} as Record<string, unknown>,
  unidade: {} as Record<string, unknown>,
  upserts: [] as Array<{ linha: Record<string, unknown>; opcoes: Record<string, unknown>; tabela: string }>,
}));

const ENTIDADE_DO_CONTRATO = "0b6f3c1e-5d7a-4c2b-9f10-3a2b1c0d9e8f";
const IMOBILIARIA = "1c7a4d2f-6e8b-4d3c-8a21-4b3c2d1e0f9a";
const CORRETOR = "2d8b5e3a-7f9c-4e4d-9b32-5c4d3e2f1a0b";
const CPF_DO_TITULAR = "529.982.247-25";

const CECILIO = {
  incorporadorId: "inc-cecilio",
  slug: "cecilio-rocha",
  tipo: "incorporador",
  usuarioId: "u-cecilio",
  usuarioNome: "Maria do Cecílio",
};
const GURGEL = { tipo: "comercial", usuarioId: "u-gurgel", usuarioNome: "Lucas Ruas" };

const UNIDADE_DO_GARDEN = {
  area: "250.00",
  codigo: "GDN0101",
  enterprise_id: "39",
  id: "uni-gdn",
  lote: "01",
  preco_tabela: "178100.00",
  quadra: "01",
  situacao: "reservada",
};

const PLANO = {
  entradaPercentual: 10,
  indiceCorrecao: "SEM_CORRECAO",
  jurosConvencao: "equivalente",
  jurosPeriodicidade: "anual",
  jurosTaxa: null,
  nome: "NORMAL",
  parcelas: 180,
  sistemaAmortizacao: "sacoc",
  slot: "normal",
};

vi.mock("@/lib/apolo/incorporador/escopo", async () => {
  const { NextResponse } = await import("next/server");
  return {
    foraDoEscopo: () => NextResponse.json({ error: "Não encontrado." }, { status: 404 }),
    idsDaSessao: async () => estado.permitidos,
  };
});

vi.mock("@/lib/apolo/incorporador/board-do-portal", () => ({
  autorizarOperacaoDeVenda: () => ({ ok: true, sessao: estado.sessao }),
  autorizarPortalQueOperaSozinho: async (_request: Request, sessao: unknown) => ({ ok: true, sessao }),
}));

vi.mock("@/lib/apolo/catalogo-empreendimentos", () => ({
  catalogoDeEmpreendimentos: async () => [
    { codes: ["VLO"], id: "35", name: "Vale do Ouro", stageIds: ["35"] },
    { codes: ["VOL", "VOC", "VOR"], id: "group:Vale do Ouro", name: "Vale do Ouro", stageIds: ["36", "37", "41"] },
    { codes: ["GDN"], id: "39", name: "Garden", stageIds: ["39"] },
  ],
}));

// O Vale do Ouro: VLO (35) é o pai, VOL (36, do Lino) e VOC (37) os filhos. O Garden (39) não tem
// pai e é operado pelo Cecílio.
const CADASTRO = vi.hoisted(() => [
  { c2xEnterpriseId: "35", cidade: "Goiânia", codigo: "VLO", id: "emp-vlo", nome: "Vale do Ouro", operadoPor: null, ordem: 1, paiId: null, uf: "GO", vendendo: true },
  { c2xEnterpriseId: "36", cidade: "Goiânia", codigo: "VOL", id: "emp-vol", nome: "VOL", operadoPor: null, ordem: 2, paiId: "emp-vlo", uf: "GO", vendendo: true },
  { c2xEnterpriseId: "37", cidade: "Goiânia", codigo: "VOC", id: "emp-voc", nome: "VOC", operadoPor: null, ordem: 3, paiId: "emp-vlo", uf: "GO", vendendo: true },
  { c2xEnterpriseId: "39", cidade: "Goiânia", codigo: "GDN", id: "emp-gdn", nome: "Garden", operadoPor: "inc-cecilio", ordem: 4, paiId: null, uf: "GO", vendendo: true },
]);

vi.mock("@/lib/hercules/cadastro", () => ({
  carregarCadastroDeEmpreendimentos: async () => CADASTRO,
  lerCadastroDeEmpreendimentos: async () => ({ com0170: true, linhas: CADASTRO }),
}));

vi.mock("@/lib/apolo/planos-comerciais-c2x", () => ({
  lerPlanosDoC2x: async () => ({ ok: false }) as const,
  lerPlanosDoC2xPorIds: async () => ({ ok: false }) as const,
}));

vi.mock("@/lib/hercules/planos-do-panteon", () => ({
  lerFaixasDoPanteon: async () => ({}),
  lerPlanosDoPanteon: async () => [],
  planosPreferindoOPanteon: () => [{ planos: [{ ...PLANO, descontoPercentual: 0 }] }],
}));

vi.mock("@/lib/hercules/avisos-da-venda", () => ({
  avisarSobreAVenda: async () => [{ ok: true, para: "imobiliaria" }],
  destinatariosDaVenda: async () => ({
    coordenadores: [{ nome: "Nivea", telefone: "62999990000" }],
    corretor: { nome: "João Souza", telefone: "62988887777" },
    imobiliaria: { nome: "GURGEL", telefone: "6232220000" },
  }),
  registrarAvisoNaoEnviado: async () => [],
  vendaAvisaPeloWhatsapp: () => false,
}));

vi.mock("@/lib/hercules/proposta-pdf", () => ({
  montarPropostaPdf: async () => new Uint8Array([1, 2, 3]),
}));

vi.mock("@/lib/apolo/server", () => {
  type Feito = {
    colunas: string;
    insert: null | Record<string, unknown>;
    soLinhasDoPai: boolean;
    unica: boolean;
    update: boolean;
    upsert: null | Record<string, unknown>;
  };

  const consulta = (tabela: string) => {
    const feito: Feito = { colunas: "", insert: null, soLinhasDoPai: false, unica: false, update: false, upsert: null };
    const alvo: Record<string, unknown> = {
      then: (aceitar: (r: unknown) => unknown, recusar?: (e: unknown) => unknown) =>
        Promise.resolve(responder(tabela, feito)).then(aceitar, recusar),
    };
    for (const metodo of ["eq", "in", "is", "limit", "or", "order", "range", "delete"]) alvo[metodo] = () => alvo;
    for (const metodo of ["maybeSingle", "single"]) {
      alvo[metodo] = () => {
        feito.unica = true;
        return alvo;
      };
    }
    alvo.not = () => {
      feito.soLinhasDoPai = true;
      return alvo;
    };
    alvo.select = (colunas?: string) => {
      feito.colunas = String(colunas ?? "");
      return alvo;
    };
    alvo.insert = (linha: Record<string, unknown>) => {
      feito.insert = linha;
      estado.inserido.push({ linha, tabela });
      return alvo;
    };
    alvo.update = () => {
      feito.update = true;
      return alvo;
    };
    alvo.upsert = (linha: Record<string, unknown>, opcoes: Record<string, unknown>) => {
      feito.upsert = linha;
      estado.upserts.push({ linha, opcoes, tabela });
      return alvo;
    };
    return alvo;
  };

  const responder = (tabela: string, feito: Feito) => {
    if (feito.upsert) return { data: [{ entity_id: feito.upsert.entity_id }], error: null };
    if (feito.insert) return { data: { id: "prop-nova" }, error: null };
    if (feito.update) return { data: [{ id: "linha-1" }], error: null };
    if (tabela === "hercules_unidades") {
      if (feito.unica) return { data: estado.unidade, error: null };
      return {
        data: feito.soLinhasDoPai
          ? []
          : [{ ...estado.unidade, atualizado_em: null, espelho_de: null, origem_c2x_id: null, workspace_id: "careli" }],
        error: null,
      };
    }
    if (tabela === "hercules_reservas") {
      const reserva = {
        corretor_entity_id: CORRETOR,
        criado_em: "2026-09-26T12:00:00.000Z",
        id: "res-1",
        imobiliaria_entity_id: IMOBILIARIA,
        prometeu_reserva_id: null,
        proponentes: [{ cpf: CPF_DO_TITULAR, nome: "PEDRO", telefone: "62991234567" }],
        protocolo_numero: 1011,
        situacao: "ativa",
        unidade_id: estado.unidade.id,
        validade_em: "2026-10-03T02:59:59.000Z",
      };
      return { data: feito.unica ? reserva : [reserva], error: null };
    }
    // Os contratos ativos da carteira (a leitura com a unidade embutida): SEM filtro nenhum.
    if (tabela === "hercules_propostas") {
      return { data: feito.colunas.includes("!inner") ? estado.contratos : [], error: null };
    }
    if (tabela === "prometeu_reservas") return { data: [], error: null };
    if (tabela === "apolo_enterprise_settings") return { data: { entrada_minima_percentual: 10 }, error: null };
    // O CPF do titular: nenhuma entidade nascida no Apolo, uma vinda do sync do C2X.
    if (tabela === "apolo_entity_identifiers") return { data: [{ entity_id: ENTIDADE_DO_CONTRATO }], error: null };
    if (tabela === "apolo_source_links") {
      return { data: [{ entity_id: ENTIDADE_DO_CONTRATO, source_id: "7001" }], error: null };
    }
    // Nenhuma CAD em lugar nenhum: a única porta possível é a carteira.
    if (tabela === "apolo_esteira") return { data: [], error: null };
    if (tabela === "apolo_contacts") return { data: [{ value: "joao@imob.com" }], error: null };
    if (tabela === "apolo_entities") {
      if (feito.colunas.trim() === "id") return { data: [], error: null };
      return {
        data: [
          { display_name: null, id: IMOBILIARIA, legal_name: null, trade_name: "GURGEL" },
          { display_name: null, id: CORRETOR, legal_name: null, trade_name: "João Souza" },
        ],
        error: null,
      };
    }
    return { data: feito.unica ? null : [], error: null };
  };

  return {
    createApoloAdminClient: () => ({
      from: (tabela: string) => consulta(tabela),
      storage: {
        from: () => ({
          createSignedUrl: async () => ({ data: { signedUrl: "https://exemplo/proposta.pdf" }, error: null }),
          download: async () => ({ data: null, error: { message: "sem logo" } }),
          upload: async () => ({ data: { path: "x" }, error: null }),
        }),
      },
    }),
    hashIdentifier: (tipo: string, valor: string) => `hash:${tipo}:${valor}`,
  };
});

import { GET, POST } from "@/app/api/incorporador/venda/proposta/route";

const PRIMEIRA_PARCELA = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

function contratoNo(enterpriseId: string, codigoDaUnidade: string): Record<string, unknown> {
  return {
    cancelada_em: null,
    cancelamento_pedido_em: null,
    cliente_c2x_id: "7001",
    cliente_documento: CPF_DO_TITULAR,
    cliente_entity_id: null,
    cliente_nome: "PEDRO",
    codigo: "000728",
    compradores: [{ c2x_user_id: "7001", documento: CPF_DO_TITULAR, nome: "PEDRO", percentual: 100, titular: true }],
    etapa: "faturado",
    etapa_desde: "2024-03-10T12:00:00.000Z",
    id: "prop-antiga",
    unidade: { codigo: codigoDaUnidade, enterprise_id: enterpriseId, id: `uni-${codigoDaUnidade}` },
  };
}

const pedir = () =>
  POST(
    new Request("https://c2x.app.br/api/incorporador/venda/proposta", {
      body: JSON.stringify({
        compradores: [{ cpf: CPF_DO_TITULAR, nome: "Pedro", participacao: 100, telefone: "62991234567" }],
        diaDeVencimento: 10,
        entradaValor: 17_810,
        entradaVezes: 2,
        parcelasMensais: 120,
        planoNome: "NORMAL",
        primeiraParcelaEm: PRIMEIRA_PARCELA,
        unidadeId: String(estado.unidade.id),
        valorNegociado: 178_100,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
  );

const abrirModal = async () => {
  const r = await GET(
    new Request(`https://c2x.app.br/api/incorporador/venda/proposta?unidade=${String(estado.unidade.id)}`),
  );
  expect(r.status).toBe(200);
  return ((await r.json()) as { data: { credenciamento: Record<string, unknown> } }).data.credenciamento;
};

const cadsGravadas = () => estado.upserts.filter((u) => u.tabela === "apolo_esteira");

beforeEach(() => {
  estado.contratos = [];
  estado.inserido = [];
  estado.permitidos = ["37", "39"];
  estado.sessao = CECILIO;
  estado.unidade = UNIDADE_DO_GARDEN;
  estado.upserts = [];
});

describe("comprador do Vale do Ouro reservando no Garden (39), com a régua de verdade", () => {
  it("⚠️ POST do Cecílio: 403 com a frase de sempre, e nada é gravado (nem proposta, nem CAD)", async () => {
    estado.contratos = [contratoNo("37", "VOC0501")];
    const r = await pedir();

    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: string }).error).toBe("Este cliente não tem CAD neste empreendimento.");
    expect(cadsGravadas()).toHaveLength(0);
    expect(estado.inserido).toHaveLength(0);
  });

  it("⚠️ nem o contrato no espelho do pai (35) serve para o Garden", async () => {
    estado.contratos = [contratoNo("35", "VLO0728")];
    expect((await pedir()).status).toBe(403);
    expect(cadsGravadas()).toHaveLength(0);
  });

  it("⚠️ GET do Cecílio: a modal abre barrada, sem a porta da carteira", async () => {
    estado.contratos = [contratoNo("37", "VOC0501")];
    expect(await abrirModal()).toMatchObject({
      contratoAtivo: false,
      credenciado: false,
      motivo: "Este cliente não tem CAD neste empreendimento.",
      origem: null,
    });
  });

  it("⚠️ nem o comercial (a Gurgel, que alcança tudo) leva o contrato do Vale do Ouro para o Garden", async () => {
    estado.sessao = GURGEL;
    estado.permitidos = ["35", "36", "37", "39", "41", "group:Vale do Ouro"];
    estado.contratos = [contratoNo("37", "VOC0501")];
    expect((await pedir()).status).toBe(403);
    expect(cadsGravadas()).toHaveLength(0);
  });
});

describe("os controles: a mesma régua abre a porta dentro da família", () => {
  it("comprador do próprio Garden: POST do Cecílio grava a proposta e a CAD nasce no 39", async () => {
    estado.contratos = [contratoNo("39", "GDN0050")];
    const r = await pedir();

    expect(r.status).toBe(200);
    expect(((await r.json()) as { data: Record<string, unknown> }).data.cadDoComprador).toEqual({
      estado: "criada",
    });
    expect(cadsGravadas()).toHaveLength(1);
    expect(cadsGravadas()[0]?.linha).toMatchObject({
      enterprise_id: "39",
      entity_id: ENTIDADE_DO_CONTRATO,
      etapa: "credenciado",
      origem: "comprador_da_carteira",
    });
  });

  it("no VOC (37), o contrato no espelho do pai (35) abre a modal pela carteira (o CPF do titular é conhecido)", async () => {
    estado.unidade = { ...UNIDADE_DO_GARDEN, codigo: "VOC0101", enterprise_id: "37", id: "uni-voc" };
    estado.contratos = [contratoNo("35", "VLO0728")];
    expect(await abrirModal()).toMatchObject({
      contratoAtivo: true,
      credenciado: true,
      desde: null,
      origem: "comprador_da_carteira",
    });
  });

  it("⚠️ no VOC (37), o contrato do irmão de outro dono (36, o Lino) NÃO abre", async () => {
    estado.unidade = { ...UNIDADE_DO_GARDEN, codigo: "VOC0101", enterprise_id: "37", id: "uni-voc" };
    estado.contratos = [contratoNo("36", "VOL0101")];
    expect(await abrirModal()).toMatchObject({ credenciado: false, origem: null });
  });
});
