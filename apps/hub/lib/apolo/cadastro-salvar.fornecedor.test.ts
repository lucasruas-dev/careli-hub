import { beforeEach, describe, expect, it, vi } from "vitest";

// O CADASTRO DE FORNECEDOR NA PORTA DO SALVAR — decisões do Lucas (02/10/2026):
//   • CPF (prestador) ou CNPJ (empresa);
//   • dados bancários e PIX, com UMA forma de pagar obrigatória (conta completa OU chave PIX);
//   • "já fica ativo": fora da esteira;
//   • cadastro enxuto: PF só a identidade, PJ só o cartão CNPJ.
//
// O que está travado aqui:
//   • a porta ACEITA o papel (antes: 400 "ainda nao disponivel");
//   • sem forma de pagar, recusa 400 ANTES de criar a ficha;
//   • sem a tabela da 0211, recusa 503 ANTES de criar a ficha (a conta não pode se perder);
//   • a conta vai para `apolo_entity_bank_accounts`, ligada à ficha que nasceu;
//   • a esteira não é gravada, nem com empreendimento no corpo;
//   • o afrouxamento das travas de comprador vem da PORTA (`cadastroDeFornecedor`), e os obrigatórios
//     enxutos vêm do FORMATO do papel (`simples`), nunca de um campo do corpo.

const estado = vi.hoisted(() => ({
  campos: vi.fn((_: unknown) => ({ ok: true })),
  criar: vi.fn(),
  documentos: vi.fn((_: unknown) => ({ ok: true })),
  upload: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/apolo/cadastro-persist", () => ({ createApoloEntity: estado.criar }));
vi.mock("@/lib/apolo/enterprise-settings", () => ({
  exigeCertidaoNascimento: async () => false,
  exigeComprovanteRenda: async () => false,
}));
vi.mock("@/lib/apolo/cadastro-obrigatorios", () => ({
  CERTIDAO_NASCIMENTO_CATEGORIA: "certidao_nascimento",
  CERTIDAO_NASCIMENTO_ROTULO: "Certidão de nascimento",
  COMPROVANTE_RENDA_LABELS: {},
  validarCamposMinimos: estado.campos,
  validarDocumentosObrigatorios: estado.documentos,
}));
vi.mock("@/lib/apolo/documentos", async (original) => ({
  ...(await original<typeof import("@/lib/apolo/documentos")>()),
  uploadApoloDocument: estado.upload,
}));
vi.mock("@/modules/apolo/blocks/cadastro/cad-pdf", () => ({
  montarCadPdf: async () => new Uint8Array([1, 2, 3]),
}));
vi.mock("@/lib/apolo/empreendimento-de-mercado", () => ({
  nomeDeMercadoDoEmpreendimento: async () => "",
}));

import {
  MENSAGEM_SEM_TABELA_DA_CONTA,
  salvarCadastroDoApolo,
  type SalvarPayload,
} from "./cadastro-salvar";

const OPERADOR = "11111111-2222-4333-8444-555555555555";

type Escrita = { linha: unknown; operacao: string; tabela: string };

function clienteFalso(opcoes: { semTabela?: boolean } = {}) {
  const escritas: Escrita[] = [];
  const client = {
    from(tabela: string) {
      const builder: Record<string, unknown> = {};
      const resposta = () =>
        tabela === "apolo_entity_bank_accounts" && opcoes.semTabela
          ? { count: null, data: null, error: { code: "42P01", message: "relation does not exist" } }
          : { count: 0, data: [], error: null };
      for (const metodo of ["eq", "limit", "select"]) builder[metodo] = () => builder;
      builder.insert = (linha: unknown) => {
        escritas.push({ linha, operacao: "insert", tabela });
        return Promise.resolve({ error: null });
      };
      builder.upsert = (linha: unknown) => {
        escritas.push({ linha, operacao: "upsert", tabela });
        return Promise.resolve({ error: null });
      };
      builder.maybeSingle = async () => ({ data: null, error: null });
      builder.then = (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) =>
        Promise.resolve(resposta()).then(ok, falha);
      return builder;
    },
  };
  return { client: client as never, escritas };
}

function autor() {
  return {
    donoUpload: "u-operador-1",
    nome: vi.fn(async () => "Operador Careli"),
    ownerUserId: OPERADOR,
    registro: null,
  };
}

const FORNECEDOR_PF = (extra: Partial<SalvarPayload> = {}): SalvarPayload => ({
  dadosBancarios: { pixChave: "joao@pedreiro.com", pixTipo: "email" },
  identidade: { cpf: "52998224725", nome: "JOAO PEDREIRO" },
  persona: "pf",
  role: "fornecedor",
  ...extra,
});

async function salvar(payload: SalvarPayload, cliente = clienteFalso()) {
  const r = await salvarCadastroDoApolo({
    adminClient: cliente.client,
    autor: autor(),
    origemDaEsteira: "cadastro-manual",
    origemPadrao: "cadastro-formulario",
    payload,
  });
  return { escritas: cliente.escritas, r };
}

beforeEach(() => {
  estado.criar.mockReset();
  estado.criar.mockResolvedValue({
    autenticacao: "CAD-2026-ABCD1234",
    entityId: "ent-fornecedor",
    ok: true,
    warnings: [],
  });
  estado.campos.mockClear();
  estado.documentos.mockClear();
});

describe("o fornecedor na porta do salvar", () => {
  it("a porta aceita o papel e grava a conta na tabela própria, ligada à ficha", async () => {
    const { escritas, r } = await salvar(FORNECEDOR_PF());

    expect(r.ok).toBe(true);
    const conta = escritas.find((e) => e.tabela === "apolo_entity_bank_accounts");
    expect(conta?.operacao).toBe("insert");
    expect(conta?.linha).toMatchObject({
      created_by: OPERADOR,
      entity_id: "ent-fornecedor",
      pix_key: "joao@pedreiro.com",
      pix_key_type: "email",
    });
  });

  it("a PORTA liga o afrouxamento das travas de comprador, sem código de corretor", async () => {
    await salvar(FORNECEDOR_PF());

    const opcoes = estado.criar.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(opcoes.cadastroDeFornecedor).toBe(true);
    expect(opcoes.cadastroDeCorretorAutonomo).toBeUndefined();
    expect(opcoes.codigoDoCorretor).toBeUndefined();
  });

  it("os obrigatórios enxutos vêm do FORMATO do papel", async () => {
    await salvar(FORNECEDOR_PF());

    expect(estado.campos.mock.calls[0]?.[0]).toMatchObject({ simples: true });
    expect(estado.documentos.mock.calls[0]?.[0]).toMatchObject({ simples: true });
  });

  it("o cliente continua com os obrigatórios de sempre", async () => {
    await salvar({ identidade: { cpf: "52998224725", nome: "MARIA" }, persona: "pf", role: "prospect" });

    expect(estado.campos.mock.calls[0]?.[0]).toMatchObject({ simples: false });
  });

  it("sem forma de pagar: 400 antes de criar a ficha", async () => {
    const { escritas, r } = await salvar(FORNECEDOR_PF({ dadosBancarios: null }));

    expect(r).toMatchObject({ ok: false, status: 400, tipo: "invalido" });
    expect(estado.criar).not.toHaveBeenCalled();
    expect(escritas).toEqual([]);
  });

  it("conta pela metade: 400 antes de criar a ficha", async () => {
    const { r } = await salvar(
      FORNECEDOR_PF({ dadosBancarios: { agencia: "1234", banco: "Bradesco" } }),
    );

    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(estado.criar).not.toHaveBeenCalled();
  });

  it("sem a tabela da 0211: 503 com frase clara, e nada é gravado", async () => {
    const { escritas, r } = await salvar(FORNECEDOR_PF(), clienteFalso({ semTabela: true }));

    expect(r).toEqual({
      error: MENSAGEM_SEM_TABELA_DA_CONTA,
      ok: false,
      status: 503,
      tipo: "invalido",
    });
    expect(estado.criar).not.toHaveBeenCalled();
    expect(escritas).toEqual([]);
  });

  it("a tabela ausente NÃO afeta o cadastro de cliente", async () => {
    const { r } = await salvar(
      { identidade: { cpf: "52998224725", nome: "MARIA" }, persona: "pf", role: "prospect" },
      clienteFalso({ semTabela: true }),
    );

    expect(r.ok).toBe(true);
  });

  it("fica fora da esteira, mesmo com empreendimento e imobiliária no corpo", async () => {
    const { escritas, r } = await salvar(
      FORNECEDOR_PF({
        perfil: { imobiliariaId: OPERADOR },
        vinculo: { enterpriseId: "37" },
      }),
    );

    expect(r).toMatchObject({ esteira: "sem-vinculo", ok: true });
    expect(escritas.filter((e) => e.tabela === "apolo_esteira")).toEqual([]);
    // E a imobiliária do corpo não entra na ficha: o fornecedor não tem vínculo.
    const input = estado.criar.mock.calls[0]?.[1] as { perfil?: { imobiliariaId?: string } };
    expect(input.perfil?.imobiliariaId).toBe("");
  });

  it("o cliente com vínculo continua entrando na esteira", async () => {
    const { escritas } = await salvar({
      identidade: { cpf: "52998224725", nome: "MARIA" },
      perfil: { imobiliariaId: OPERADOR },
      persona: "pf",
      role: "prospect",
      vinculo: { enterpriseId: "37" },
    });

    expect(escritas.some((e) => e.tabela === "apolo_esteira")).toBe(true);
  });
});
