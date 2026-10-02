import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O CARD DE CONTRATO DO C2X ABRE COM O QUADRO DA D4SIGN (`abrirCardDoTrabalho`).
//
// Lucas, 02/10/2026: *"os card que estao pelo c2x nao tem nada na tela de assinatura"*. Sem diário da
// Clicksign, o card recebe o quadro que o espelho grava; no portal ele sai sem e-mail, sem a chave do C2X
// e sem o uuid do documento. O card da Clicksign continua como estava, nos dois lados. O banco é o dublê em
// memória (confere nome de coluna); o diário da Clicksign é trocado, porque o teste dele mora ao lado.

const estado = vi.hoisted(() => ({
  cliente: null as unknown,
  diarioDaClicksign: null as unknown,
}));

vi.mock("@/lib/apolo/server", () => ({ createApoloAdminClient: () => estado.cliente }));

vi.mock("@/lib/temis/trabalhos-db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/temis/trabalhos-db")>()),
  donoDoTrabalho: vi.fn(async () => ({ enterprise_id: "37", operado_por: CECILIO })),
}));

vi.mock("@/lib/temis/analise-do-trabalho", () => ({ analiseDoTrabalho: async () => null }));

vi.mock("@/lib/temis/contrato-guardado-db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/temis/contrato-guardado-db")>()),
  contratosDaProposta: async () => [],
}));

vi.mock("@/lib/assinatura/diario-do-envelope-db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/assinatura/diario-do-envelope-db")>()),
  diarioDaProposta: vi.fn(async () => estado.diarioDaClicksign),
}));

const CECILIO = "0f6d2c1e-3b4a-4c5d-8e9f-a1b2c3d4e5f6";

import { type Banco, criarBanco, type Linha } from "@/lib/hercules/banco-em-memoria.para-teste";

import type { AtorDoHub, AtorDoPortal } from "./ator";
import { abrirCardDoTrabalho } from "./trabalho-servico";

const HUB: AtorDoHub = { nome: "Jurídico", papel: "leitura", tipo: "hub", userId: "user-hub" };
const PORTAL: AtorDoPortal = {
  enterpriseIds: ["37"],
  incorporadorId: CECILIO,
  nome: "Maria do Jurídico",
  slug: "cecilio-rocha",
  tipo: "portal",
  usuarioId: "usuario-portal-1",
};

const UUID_DO_DOCUMENTO = "01a0da04-6480-7f22-ad9e-dec7634042b2";

const card: Linha = {
  arrependimento_inicio: null,
  cliente_cpf: null,
  cliente_nome: "Cliente Fictício",
  enterprise_codigo: "VAL",
  enterprise_id: "37",
  enterprise_nome: "Vale",
  estagio: "assinatura",
  estagio_desde: "2026-09-23T18:00:00Z",
  id: "card-1",
  indeferido_em: null,
  indeferido_motivo: null,
  indeferido_observacao: null,
  indeferido_por_nome: null,
  observacao: null,
  operado_por: CECILIO,
  proposta_id: "p-1",
  tipo: "contrato",
  unidade: "VALC09",
  workspace_id: "careli",
};

const envelopeD4Sign: Linha = {
  atualizado_em: "2026-10-02T20:08:05Z",
  c2x_contract_signature_id: 3804,
  conferido_em: "2026-10-02T20:08:05Z",
  criado_em: "2026-09-23T17:50:21Z",
  documento_id: null,
  enviado_em: "2026-09-23T17:50:21Z",
  envelope_id: UUID_DO_DOCUMENTO,
  estado: "parcial",
  estado_cru: "d4sign:3",
  falha: null,
  finalidade: "contrato",
  id: "env-d4",
  ordenada: false,
  origem: "c2x",
  proposta_id: "p-1",
  provedor: "d4sign",
  provedor_documento_id: UUID_DO_DOCUMENTO,
  signatarios: [
    { assinado_em: "2026-09-24T10:00:00-03:00", chave: "c2x:45544", email: "compra@exemplo.test", nome: "Bia Compradora", ordem: 0, papel: null, perfil: "Comprador", testemunha: false },
    { chave: "c2x:45543", email: "rh@careli.adm.br", nome: "Ana Testemunha", ordem: 0, papel: null, perfil: "Backoffice", testemunha: true },
  ],
  workspace_id: "careli",
};

let banco: Banco;

function montar(envelopes: Linha[]) {
  banco = criarBanco({ temis_envelopes: envelopes, temis_trabalhos: [card] });
  estado.cliente = banco.cliente;
}

async function abrir(ator: AtorDoHub | AtorDoPortal): Promise<{ assinatura: Record<string, unknown> | null }> {
  const r = await abrirCardDoTrabalho(ator, new Request("https://c2x.app.br/api/temis/trabalho?id=card-1"), {
    podeEmitir: async () => false,
  });
  expect(r.status).toBe(200);
  return ((await r.json()) as { data: { assinatura: Record<string, unknown> | null } }).data;
}

beforeEach(() => {
  estado.diarioDaClicksign = null;
});

afterEach(() => {
  expect(banco.problemas).toEqual([]);
});

describe("abrirCardDoTrabalho: o card de contrato do C2X", () => {
  it("no hub, sem diário da Clicksign, o card recebe o quadro da D4Sign (com e-mail, chave e testemunha)", async () => {
    montar([envelopeD4Sign]);
    const { assinatura } = await abrir(HUB);
    const envelope = assinatura?.envelope as Record<string, unknown>;
    expect(assinatura).toMatchObject({ assinaram: 1, diario: [], total: 2 });
    expect(envelope).toMatchObject({ conferidoEm: "2026-10-02T20:08:05Z", envelopeId: null, provedor: "d4sign" });
    const pessoas = envelope.signatarios as Array<Record<string, unknown>>;
    expect(pessoas.map((p) => [p.nome, p.email, p.chave, p.papel, p.perfil])).toEqual([
      ["Ana Testemunha", "rh@careli.adm.br", "c2x:45543", "testemunha", "Backoffice"],
      ["Bia Compradora", "compra@exemplo.test", "c2x:45544", null, "Comprador"],
    ]);
  });

  it("no portal, o mesmo quadro sai sem e-mail, sem a chave c2x: e sem o uuid do documento", async () => {
    montar([envelopeD4Sign]);
    const { assinatura } = await abrir(PORTAL);
    const texto = JSON.stringify(assinatura);
    expect(texto).not.toMatch(/@/);
    expect(texto).not.toMatch(/c2x:/);
    expect(texto).not.toContain(UUID_DO_DOCUMENTO);
    const pessoas = (assinatura?.envelope as { signatarios: Array<Record<string, unknown>> }).signatarios;
    expect(pessoas.map((p) => [p.nome, p.email, p.papel, p.perfil])).toEqual([
      ["Ana Testemunha", null, "testemunha", "Backoffice"],
      ["Bia Compradora", null, null, "Comprador"],
    ]);
    expect(assinatura).toMatchObject({ assinaram: 1, total: 2 });
  });

  it("o card da Clicksign continua como estava: o diário dela vence, e o portal o recebe igual", async () => {
    montar([envelopeD4Sign]);
    const diario = {
      assinaram: 1,
      diario: [{ detalhe: null, fato: "Ana assinou", gravidade: "marco", quem: "Ana", quando: "2026-09-24T13:00:00Z" }],
      envelope: { envelopeId: "env-clicksign", estado: "parcial", id: "env-cs", provedor: "clicksign", signatarios: [{ chave: "k1", email: "a@exemplo.test" }] },
      total: 2,
    };
    estado.diarioDaClicksign = diario;
    expect((await abrir(HUB)).assinatura).toEqual(diario);
    expect((await abrir(PORTAL)).assinatura).toEqual(diario);
  });

  it("sem envelope nenhum, o painel continua nulo", async () => {
    montar([]);
    expect((await abrir(HUB)).assinatura).toBeNull();
  });
});
