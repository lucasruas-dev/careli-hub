import { beforeEach, describe, expect, it, vi } from "vitest";

// A CERTIDÃO DE NASCIMENTO NAS PORTAS DO SALVAR COMPARTILHADO (02/10/2026).
//
// Lucas: "caso a mesma esteja habilitada terá a sessão de solicitar a certidão de nascimento para
// clientes solteiro". O salvar compartilhado é a trava de duas portas: o Apolo interno e o portal
// do incorporador (que chama esta mesma função com o vínculo já conferido). A terceira, o link
// público, tem teste próprio em app/api/publico/cad/salvar/certidao-nascimento.test.ts.
//
// Aqui a regra de documentos é a DE VERDADE (lib/apolo/cadastro-obrigatorios.ts): o que se prova é
// que a chave lida no servidor chega até ela, e que o corpo não a desliga. O persist é o dublê:
// chegar nele é "passou da trava".

const estado = vi.hoisted(() => ({
  certidao: vi.fn(async (_client: unknown, _id: unknown) => false),
  criar: vi.fn(),
  renda: vi.fn(async () => false),
}));

vi.mock("@/lib/apolo/cadastro-persist", () => ({ createApoloEntity: estado.criar }));
vi.mock("@/lib/apolo/enterprise-settings", () => ({
  exigeCertidaoNascimento: estado.certidao,
  exigeComprovanteRenda: estado.renda,
}));
vi.mock("@/lib/apolo/documentos", () => ({
  APOLO_DOC_MAX_BYTES: 50 * 1024 * 1024,
  MENSAGEM_DOCUMENTO_GRANDE: "Documento grande demais.",
  caminhoUploadDiretoValido: () => true,
  documentoTemArquivo: (doc: { fileBase64?: string; storagePath?: string } | null) =>
    Boolean(doc?.fileBase64?.trim() || doc?.storagePath?.trim()),
  lerDocumentoDoStorage: vi.fn(),
  removerDocumentoDoStorage: vi.fn(),
  uploadApoloDocument: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/modules/apolo/blocks/cadastro/cad-pdf", () => ({
  montarCadPdf: vi.fn(async () => new Uint8Array([1])),
}));
vi.mock("@/lib/apolo/empreendimento-de-mercado", () => ({
  nomeDeMercadoDoEmpreendimento: vi.fn(async () => "Vale do Ouro"),
}));

import { salvarCadastroDoApolo, type SalvarPayload } from "./cadastro-salvar";

const ADMIN = { marca: "admin" } as never;
const arquivo = (categoria: string) => ({
  categoria,
  fileBase64: "QkFTRTY0",
  fileName: `${categoria}.pdf`,
  mimeType: "application/pdf",
});

function solteiro(extra: Record<string, unknown> = {}): SalvarPayload {
  return {
    documentos: [arquivo("identificacao"), arquivo("comprovante_endereco")],
    identidade: { cpf: "52998224725", naturalidade: "Goiânia / GO", nome: "MARIA" },
    perfil: { estadoCivilId: "1" },
    persona: "pf",
    role: "prospect",
    vinculo: { enterpriseId: "37" },
    ...extra,
  } as SalvarPayload;
}

const comCertidao = (extra: Record<string, unknown> = {}) =>
  solteiro({
    documentos: [
      arquivo("identificacao"),
      arquivo("comprovante_endereco"),
      arquivo("certidao_nascimento"),
    ],
    ...extra,
  });

// As duas portas, com o que cada uma passa para a mesma função.
const PORTAS = [
  {
    nome: "Apolo interno",
    input: {
      autor: { donoUpload: "u-1", nome: async () => "Operador", ownerUserId: "op-1", registro: null },
      origemDaEsteira: "cadastro-manual",
      origemPadrao: "cadastro-formulario",
    },
  },
  {
    // O portal entrega aqui o corpo já reescrito por `payloadDoPortal` (papel prospect e o
    // empreendimento do vínculo conferido), que é o que este teste monta.
    nome: "portal do incorporador",
    input: {
      autor: {
        donoUpload: "p-u-1",
        nome: async () => "Maria do Comercial",
        ownerUserId: null,
        registro: { nome: "Maria do Comercial", origem: "portal" as const, slug: "cecilio", usuarioId: "u-1" },
      },
      fichaExistente: "acrescentar" as const,
      origemDaEsteira: "portal-incorporador",
      origemPadrao: "portal-incorporador",
    },
  },
];

const salvar = (porta: (typeof PORTAS)[number], payload: SalvarPayload) =>
  salvarCadastroDoApolo({ adminClient: ADMIN, ...porta.input, payload });

beforeEach(() => {
  estado.certidao.mockReset();
  estado.certidao.mockResolvedValue(false);
  estado.renda.mockClear();
  estado.criar.mockReset();
  // Chegar no persist é "passou da trava"; ele recusa logo em seguida para o teste parar aqui.
  estado.criar.mockResolvedValue({ error: "parou depois da trava", ok: false });
});

describe.each(PORTAS)("certidão de nascimento na porta: $nome", (porta) => {
  it("chave LIGADA e solteiro sem a certidão: recusa antes de criar a ficha", async () => {
    estado.certidao.mockResolvedValue(true);
    const r = await salvar(porta, solteiro());
    expect(r).toEqual({
      error: "Anexe a certidão de nascimento para enviar o cadastro.",
      ok: false,
      status: 400,
      tipo: "invalido",
    });
    expect(estado.criar).not.toHaveBeenCalled();
    // A chave é lida do empreendimento do vínculo, no servidor.
    expect(estado.certidao).toHaveBeenCalledWith(ADMIN, "37");
  });

  it("chave LIGADA e solteiro com a certidão: passa da trava", async () => {
    estado.certidao.mockResolvedValue(true);
    await salvar(porta, comCertidao());
    expect(estado.criar).toHaveBeenCalledTimes(1);
  });

  it("chave DESLIGADA: solteiro sem a certidão passa, como hoje", async () => {
    await salvar(porta, solteiro());
    expect(estado.criar).toHaveBeenCalledTimes(1);
  });

  // O corpo é do cliente: um campo forjado não desliga a exigência, nem a liga.
  it("a chave NÃO vem do corpo", async () => {
    estado.certidao.mockResolvedValue(true);
    const forjado = solteiro({ certidaoNascimentoHabilitada: false, exigeCertidaoNascimento: false });
    const r = await salvar(porta, forjado);
    expect(r).toMatchObject({ ok: false, status: 400, tipo: "invalido" });
    expect(estado.criar).not.toHaveBeenCalled();

    estado.certidao.mockResolvedValue(false);
    await salvar(porta, solteiro({ certidaoNascimentoHabilitada: true, exigeCertidaoNascimento: true }));
    expect(estado.criar).toHaveBeenCalledTimes(1);
  });

  it("chave LIGADA e casado: segue pedindo a certidão de estado civil, não a de nascimento", async () => {
    estado.certidao.mockResolvedValue(true);
    const r = await salvar(
      porta,
      solteiro({
        documentos: [
          arquivo("identificacao"),
          arquivo("comprovante_endereco"),
          arquivo("certidao"),
          arquivo("identificacao_conjuge"),
        ],
        perfil: { estadoCivilId: "2" },
      }),
    );
    expect(r).not.toMatchObject({ tipo: "invalido" });
    expect(estado.criar).toHaveBeenCalledTimes(1);
  });
});

describe("certidão de nascimento: quem fica de fora", () => {
  const interno = PORTAS[0]!;

  it("cadastro de imobiliária nem consulta a chave", async () => {
    estado.certidao.mockResolvedValue(true);
    await salvar(
      interno,
      solteiro({
        documentos: [
          arquivo("identificacao"),
          arquivo("contrato_social"),
          arquivo("identificacao_socio_1"),
          arquivo("comprovante_socio_1"),
        ],
        empresa: { cnpj: "11222333000181", razaoSocial: "RR SOLUÇÕES" },
        persona: "pj",
        role: "imobiliaria",
      }),
    );
    expect(estado.certidao).not.toHaveBeenCalled();
  });

  it("CAD interna sem empreendimento: não há chave a consultar, e solteiro passa", async () => {
    await salvar(interno, solteiro({ vinculo: undefined }));
    expect(estado.certidao).toHaveBeenCalledWith(ADMIN, undefined);
    expect(estado.criar).toHaveBeenCalledTimes(1);
  });
});
