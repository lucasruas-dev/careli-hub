import { beforeEach, describe, expect, it, vi } from "vitest";

// A ROTA DA ABA ASSINATURA NA LEITURA ÚNICA (F4 da fonte única) — o caminho do que ATRAVESSA.
//
// A leitura é mockada com contratos que CARREGAM tudo o que não pode sair (e-mail no quadro, provedor,
// id do documento, avisos internos, a linha de venda desfeita): o teste trava que o JSON do portal
// não contém nada disso, nem as palavras dos sistemas (Lucas, 18/08/2026), e que o C2X e a D4Sign
// não são chamados.

const estado = vi.hoisted(() => ({ catalogoFora: false, leituraFora: false }));

vi.mock("@/lib/guardian/db", () => ({
  getHadesDbPool: vi.fn(() => ({ missing: ["C2X_DB"], ok: false })),
}));

vi.mock("@/lib/guardian/d4sign-consulta", () => ({
  aquecerD4SignEmSegundoPlano: vi.fn(),
}));

vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () => ({}),
  deterministicUuid: (semente: string) => `uuid:${semente}`,
  fetchC2xCadastroByEntity: vi.fn(),
}));

vi.mock("@/lib/apolo/catalogo-empreendimentos", () => ({
  // `catalogoFora`: o C2X não respondeu (o catálogo volta vazio, como `catalogoDeEmpreendimentos` faz).
  catalogoDeEmpreendimentos: async () =>
    estado.catalogoFora
      ? []
      : [
          { codes: ["VOC"], id: "37", name: "VALE DO OURO", stageIds: ["37"] },
          { codes: ["GDN"], id: "39", name: "GARDEN", stageIds: ["39"] },
          // Sem linha no cadastro: o id sai do catálogo, de reserva.
          { codes: ["ACT"], id: "41", name: "ACT", stageIds: ["41"] },
        ],
}));

vi.mock("@/lib/hercules/cadastro", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/hercules/cadastro")>();
  const linha = (c2x: string, codigo: string) => ({
    c2xEnterpriseId: c2x,
    cidade: null,
    codigo,
    id: codigo.toLowerCase(),
    nome: codigo,
    operadoPor: null,
    ordem: 0,
    paiId: null,
    uf: null,
    vendendo: true,
  });
  return {
    ...original,
    carregarCadastroDeEmpreendimentos: async () => [linha("37", "VOC"), linha("39", "GDN")],
  };
});

vi.mock("@/lib/assinatura/contratos-do-panteon", () => ({
  lerContratosDoPanteon: vi.fn(),
}));

import { getHadesDbPool } from "@/lib/guardian/db";
import { aquecerD4SignEmSegundoPlano } from "@/lib/guardian/d4sign-consulta";
import { criarSessaoIncorporador, INCORPORADOR_COOKIE } from "@/lib/apolo/incorporador/sessao";
import { lerContratosDoPanteon } from "@/lib/assinatura/contratos-do-panteon";
import { type LinhaDaViewDeEnvelopes, montarContratosDoPanteon } from "@/lib/assinatura/contratos-do-panteon-montagem";

import { GET as getContratos } from "../contratos/route";
import { GET } from "./route";

const AGORA = new Date("2026-09-28T15:00:00-03:00");
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function envelope(n: number, p: Partial<LinhaDaViewDeEnvelopes>): LinhaDaViewDeEnvelopes {
  return {
    c2x_contract_signature_id: null,
    conferido_em: "2026-09-28T14:30:00-03:00",
    criado_em: "2026-09-25T12:00:00+00:00",
    envelope_id: `env-${n}`,
    enviado_em: "2026-09-25T12:05:00+00:00",
    estado: "parcial",
    estado_cru: "clicksign:sign",
    falha: null,
    fechado_em: null,
    id: uuid(2000 + n),
    ordenada: true,
    origem: "panteon",
    proposta_id: null,
    provedor: "clicksign",
    provedor_documento_id: `doc-secreto-${n}`,
    signatarios: [
      { assinado_em: "2026-09-26T10:00:00.000-03:00", chave: "k1", email: "coord@careli.adm.br", nome: "Coord", ordem: 1, papel: "coordenadora" },
      { chave: "k2", email: "comprador@exemplo.com", nome: "Comprador", ordem: 2, papel: "comprador" },
    ],
    unidade_id: null,
    ...p,
  };
}

/** Os contratos com TUDO o que não pode atravessar: clicksign, D4Sign, sem venda, desfeita, dois vivos. */
function contratosCheios() {
  return montarContratosDoPanteon(
    {
      contratoGeradoEm: new Map(),
      contratos: [
        {
          ar_c2x_id: null, cancelamento_pedido_em: null, cliente_nome: "Cliente Nativo", criado_em: "2026-09-20T10:00:00+00:00",
          data_assinatura: null, data_ato: null, data_faturamento: null, empreendimento_codigo: "VOC", enterprise_id: "37",
          espelho_de: null, etapa: "assinatura", etapa_desde: null, gerado_em: "2026-09-24T10:00:00+00:00", imobiliaria_nome: null,
          lote: "06", origem: "panteon", preco_tabela: 100000, proposta_id: uuid(1), quadra: "11", unidade_c2x_id: 5001,
          unidade_codigo: "VOL1106", unidade_id: uuid(100), unidade_preco_tabela: 100000, valor: 100000,
        },
      ],
      empreendimentoPorEnterprise: new Map([["37", "VOC"]]),
      envelopes: [
        envelope(1, { proposta_id: uuid(1) }),
        envelope(2, { c2x_contract_signature_id: 3806, criado_em: "2026-09-26T12:00:00+00:00", origem: "c2x", proposta_id: uuid(1), provedor: "d4sign" }),
        envelope(3, { c2x_contract_signature_id: 3807, origem: "c2x", proposta_id: null, provedor: "d4sign", unidade_id: uuid(300) }),
        envelope(4, { c2x_contract_signature_id: 3808, origem: "c2x", proposta_id: uuid(9), provedor: "d4sign", unidade_id: uuid(301) }),
      ],
      propostasForaDaLeitura: [{ cancelada_em: "2026-09-01T00:00:00+00:00", etapa: "cancelado", id: uuid(9), origem: "c2x", unidade_id: uuid(301) }],
      // A campainha atrasada: o aviso da fonte acende (e no portal vira o texto genérico).
      ultimaRodadaOkEm: "2026-09-28T09:00:00-03:00",
      unidades: [
        { codigo: "VOC0201", enterprise_id: "37", espelho_de: null, id: uuid(300), lote: "01", origem_c2x_id: 6001, preco_tabela: 1, quadra: "02" },
        { codigo: "VOC0909", enterprise_id: "37", espelho_de: null, id: uuid(301), lote: "09", origem_c2x_id: 6002, preco_tabela: 1, quadra: "09" },
      ],
    },
    AGORA,
  );
}

function requisicao(caminho: string, emp: null | string = "37"): Request {
  vi.stubEnv("SESSAO_INCORPORADOR_SECRET", "segredo-de-teste");
  const token = criarSessaoIncorporador(
    {
      enterpriseIds: ["37", "41"],
      enterpriseIdsComCarteira: ["37"],
      incorporadorId: "inc-1",
      incorporadorNome: "Incorporadora",
      slug: "inc",
      usuarioId: "user-1",
      usuarioNome: "Time",
    },
    Date.now(),
  );
  const headers = new Headers({ cookie: `${INCORPORADOR_COOKIE}=${token}` });
  const busca = emp === null ? "" : `?emp=${encodeURIComponent(emp)}`;
  return new Request(`https://c2x.app.br/api/incorporador/vendas/${caminho}${busca}`, { headers });
}

beforeEach(() => {
  estado.catalogoFora = false;
  estado.leituraFora = false;
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(lerContratosDoPanteon).mockImplementation(async () =>
    estado.leituraFora
      ? { erro: "Não foi possível ler as assinaturas agora.", ok: false as const }
      : { contratos: contratosCheios(), lidoEm: AGORA.toISOString(), ok: true as const, ultimaRodadaOkEm: null },
  );
});

describe("GET /api/incorporador/vendas/assinaturas (leitura única)", () => {
  it("⚠️ o JSON do portal não leva e-mail, provedor, fonte, aviso de linha, documento nem os nomes dos sistemas", async () => {
    const resposta = await GET(requisicao("assinaturas"));
    expect(resposta.status).toBe(200);
    const texto = await resposta.text();
    for (const proibido of [
      "@", "\"email\"", "\"provedor\"", "\"fonte\"", "\"avisos\"", "outrosVivos", "documentoId", "provedorDocumentoId",
      "doc-secreto", "estadoCru", "conferidoEm", "C2X", "D4Sign", "Clicksign", "espelho", "Panteon",
    ]) {
      expect(texto).not.toContain(proibido);
    }
    const corpo = JSON.parse(texto) as { data: { avisoDaFonte: null | string; conciliando: boolean; unidades: Array<Record<string, unknown>> } };
    for (const linha of corpo.data.unidades) expect(Object.keys(linha)).not.toContain("aviso");
    // O contratoId só DENTRO de `contrato`.
    for (const linha of corpo.data.unidades) expect(Object.keys(linha)).not.toContain("contratoId");
    // A venda desfeita não chega; a venda nativa e o envelope sem venda chegam.
    expect(corpo.data.unidades.map((u) => u.unidade).sort()).toEqual(["VOC0201", "VOL1106"]);
    expect(corpo.data.avisoDaFonte).toMatch(/Estamos confirmando/);
    expect(corpo.data.conciliando).toBe(false);
  });

  it("⚠️ não fala com o C2X nem com a D4Sign, e lê pelo ID do cadastro (catálogo só de reserva)", async () => {
    await GET(requisicao("assinaturas", null));
    expect(vi.mocked(getHadesDbPool)).not.toHaveBeenCalled();
    expect(vi.mocked(aquecerD4SignEmSegundoPlano)).not.toHaveBeenCalled();
    const escopo = vi.mocked(lerContratosDoPanteon).mock.calls.at(-1)?.[0].escopo as { enterpriseIds: string[] };
    expect([...escopo.enterpriseIds].sort()).toEqual(["37", "41"]);
  });

  it("⚠️ catálogo do C2X fora do ar não derruba a tela: segue pelo cadastro (e o código só do catálogo fica de fora)", async () => {
    estado.catalogoFora = true;
    const resposta = await GET(requisicao("assinaturas", null));
    expect(resposta.status).toBe(200);
    const escopo = vi.mocked(lerContratosDoPanteon).mock.calls.at(-1)?.[0].escopo as { enterpriseIds: string[] };
    expect(escopo.enterpriseIds).toEqual(["37"]);
  });

  it("leitura fora do ar = 503, nunca lista vazia", async () => {
    estado.leituraFora = true;
    const resposta = await GET(requisicao("assinaturas"));
    expect(resposta.status).toBe(503);
  });

  it("fora do escopo continua 404", async () => {
    const resposta = await GET(requisicao("assinaturas", "39"));
    expect(resposta.status).toBe(404);
    expect(vi.mocked(lerContratosDoPanteon)).not.toHaveBeenCalled();
  });
});

describe("GET /api/incorporador/vendas/contratos (leitura única)", () => {
  it("⚠️ os contratos gerados saem da mesma leitura, sem e-mail nem vocabulário interno", async () => {
    const resposta = await getContratos(requisicao("contratos"));
    expect(resposta.status).toBe(200);
    const texto = await resposta.text();
    for (const proibido of ["@", "\"provedor\"", "doc-secreto", "C2X", "D4Sign", "Clicksign"]) {
      expect(texto).not.toContain(proibido);
    }
    const corpo = JSON.parse(texto) as { data: { contratos: Array<{ unidade: string }>; total: number } };
    expect(corpo.data.total).toBe(2);
    expect(vi.mocked(getHadesDbPool)).not.toHaveBeenCalled();
  });
});
