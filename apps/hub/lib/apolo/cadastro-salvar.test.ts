import { beforeEach, describe, expect, it, vi } from "vitest";

// O SALVAR COMPARTILHADO — a regra que o hub e o CRM do portal chamam.
//
// O que está travado aqui é o que a extração (16/09/2026) não podia mudar para o hub e o que a
// porta decide por quem está do outro lado:
//   • papel e persona recusados antes de qualquer consulta;
//   • o caminho do upload direto tem de ser do DONO que a porta informou (o portal não usa o do
//     operador, e vice-versa);
//   • a autoria vem da PORTA (um `autor` forjado no corpo não entra), com `owner_user_id` dela;
//   • a esteira só é gravada com empreendimento E imobiliária, com a origem que a porta mandou;
//   • a MARCA do produto (`metadata.enterpriseId`): a CAD em PDF leva em toda porta; os documentos
//     enviados só na porta do portal (decisão do Lucas, 16/09/2026);
//   • o EMPREENDIMENTO impresso no cabeçalho da CAD sai do ID do vínculo, resolvido no servidor, e
//     nunca do texto que o browser mandou (Lucas, 24/09/2026: "pode ser abaixo de corretor").

const estado = vi.hoisted(() => ({
  criar: vi.fn(),
  // O resolvedor de nome de mercado (lib/apolo/empreendimento-de-mercado.ts) tem teste próprio;
  // aqui ele responde como o banco de produção: 37 (VOC) e 35 (VLO) são "Vale do Ouro".
  mercado: vi.fn(async (_client: unknown, id: unknown) =>
    String(id ?? "").trim() === "37" || String(id ?? "").trim() === "35" ? "Vale do Ouro" : "",
  ),
  // Captura o CadDoc que o servidor manda desenhar: é ELE que prova o que sai impresso.
  pdf: vi.fn(async (_cad: Record<string, unknown>) => new Uint8Array([1, 2, 3])),
  certidao: vi.fn(async () => false),
  renda: vi.fn(async () => false),
  upload: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/apolo/cadastro-persist", () => ({ createApoloEntity: estado.criar }));
vi.mock("@/lib/apolo/enterprise-settings", () => ({
  exigeCertidaoNascimento: estado.certidao,
  exigeComprovanteRenda: estado.renda,
}));
vi.mock("@/lib/apolo/cadastro-obrigatorios", () => ({
  CERTIDAO_NASCIMENTO_CATEGORIA: "certidao_nascimento",
  CERTIDAO_NASCIMENTO_ROTULO: "Certidão de nascimento",
  COMPROVANTE_RENDA_LABELS: {},
  validarCamposMinimos: () => ({ ok: true }),
  validarDocumentosObrigatorios: () => ({ ok: true }),
}));
vi.mock("@/lib/apolo/documentos", async (original) => ({
  ...(await original<typeof import("@/lib/apolo/documentos")>()),
  uploadApoloDocument: estado.upload,
}));
vi.mock("@/modules/apolo/blocks/cadastro/cad-pdf", () => ({ montarCadPdf: estado.pdf }));
vi.mock("@/lib/apolo/empreendimento-de-mercado", () => ({
  nomeDeMercadoDoEmpreendimento: estado.mercado,
}));

import { MENSAGEM_SEM_SEQUENCIA_DO_CODIGO } from "@/lib/apolo/codigo-do-corretor";
import { prefixoUploadDireto } from "@/lib/apolo/documentos";

import { salvarCadastroDoApolo, type SalvarPayload } from "./cadastro-salvar";

const IMOB = "11111111-2222-4333-8444-555555555555";

function clienteFalso(sequencia: { data?: unknown; error?: unknown } = { data: "CA-0007", error: null }) {
  const upserts: Array<{ linha: Record<string, unknown>; tabela: string }> = [];
  const rpc = vi.fn(async (_nome: string) => sequencia);
  const client = {
    rpc,
    from(tabela: string) {
      const builder = {
        eq: () => builder,
        maybeSingle: async () => ({ data: { display_name: "RR Soluções", legal_name: null }, error: null }),
        select: () => builder,
        upsert: async (linha: Record<string, unknown>) => {
          upserts.push({ linha, tabela });
          return { error: null };
        },
      };
      return builder;
    },
  };
  return { client: client as never, rpc, upserts };
}

function autorDoHub() {
  return {
    donoUpload: "u-operador-1",
    nome: vi.fn(async () => "Operador Careli"),
    ownerUserId: "operador-1",
    registro: null,
  };
}

const payload = (extra: Partial<SalvarPayload> = {}): SalvarPayload => ({
  identidade: { cpf: "52998224725", nome: "MARIA" },
  persona: "pf",
  role: "prospect",
  ...extra,
});

beforeEach(() => {
  estado.criar.mockReset();
  estado.criar.mockResolvedValue({
    autenticacao: "CAD-2026-ABCD1234",
    entityId: "ent-1",
    ok: true,
    warnings: [],
  });
  estado.upload.mockClear();
  estado.renda.mockClear();
  estado.certidao.mockClear();
  estado.mercado.mockClear();
  estado.pdf.mockClear();
});

describe("salvarCadastroDoApolo", () => {
  // (27/09/2026) O `corretor` SAIU desta lista: o processo do corretor autônomo existe agora (ver o
  // bloco "corretor autônomo" no fim deste arquivo). Quem ainda não tem processo é fornecedor,
  // parceiro, colaborador e incorporador — e a porta continua recusando antes de qualquer consulta.
  it("papel fora do processo: 400 antes de qualquer consulta, com a frase de sempre", async () => {
    const { client } = clienteFalso();
    const autor = autorDoHub();
    const r = await salvarCadastroDoApolo({
      adminClient: client,
      autor,
      origemDaEsteira: "cadastro-manual",
      origemPadrao: "cadastro-formulario",
      payload: payload({ role: "fornecedor" }),
    });
    expect(r).toEqual({
      error: "Processo de cadastro ainda nao disponivel para este papel.",
      ok: false,
      status: 400,
      tipo: "invalido",
    });
    expect(autor.nome).not.toHaveBeenCalled();
    expect(estado.criar).not.toHaveBeenCalled();
  });

  it("caminho de upload de OUTRO dono: 400 (o portal não reaproveita arquivo do operador)", async () => {
    const { client } = clienteFalso();
    const r = await salvarCadastroDoApolo({
      adminClient: client,
      autor: { ...autorDoHub(), donoUpload: "p-usuario-portal" },
      origemDaEsteira: "portal-incorporador",
      origemPadrao: "portal-incorporador",
      payload: payload({
        documentos: [
          { categoria: "identificacao", storagePath: `${prefixoUploadDireto("u-operador-1")}rg.pdf` },
        ],
      }),
    });
    expect(r).toMatchObject({
      error: "Arquivo enviado nao confere com esta sessao.",
      ok: false,
      status: 400,
    });
  });

  it("a autoria vem da porta, nunca do corpo", async () => {
    const { client } = clienteFalso();
    await salvarCadastroDoApolo({
      adminClient: client,
      autor: autorDoHub(),
      origemDaEsteira: "cadastro-manual",
      origemPadrao: "cadastro-formulario",
      payload: {
        ...payload({ ownerUserId: "forjado" }),
        // Um `autor` e um `fichaExistente` forjados no JSON: não são campo do input, e o persist
        // só lê autoria do TERCEIRO argumento, que a porta monta (revisão da onda 3).
        autor: { nome: "Forjado", origem: "portal", slug: "x", usuarioId: "y" },
        fichaExistente: "anexar",
      } as SalvarPayload,
    });
    expect(estado.criar).toHaveBeenCalledTimes(1);
    expect(estado.criar.mock.calls[0]?.[1]).toMatchObject({
      dedupPorDocumento: true,
      enterpriseId: null,
      origem: "cadastro-formulario",
      ownerUserId: "operador-1",
    });
    // (24/09/2026) A porta do hub liga a habilitação interna: é o operador da Careli que salva.
    expect(estado.criar.mock.calls[0]?.[2]).toEqual({
      autor: null,
      fichaExistente: "anexar",
      habilitacaoInterna: true,
    });
  });

  it("a porta do portal pede para ACRESCENTAR na ficha existente, e manda a autoria à parte", async () => {
    const { client } = clienteFalso();
    const registro = { nome: "Maria", origem: "portal" as const, slug: "cecilio-rocha", usuarioId: "u-1" };
    await salvarCadastroDoApolo({
      adminClient: client,
      autor: { ...autorDoHub(), ownerUserId: null, registro },
      fichaExistente: "acrescentar",
      origemDaEsteira: "portal-incorporador",
      origemPadrao: "portal-incorporador",
      payload: payload(),
    });
    // O portal NUNCA liga a habilitação interna: autor de fora do hub não habilita imobiliária.
    expect(estado.criar.mock.calls[0]?.[2]).toEqual({
      autor: registro,
      fichaExistente: "acrescentar",
      habilitacaoInterna: false,
    });
  });

  it("cliente que já é da Careli, cadastrado no Garden pelo portal: esteira NOVA no 39, na ficha dele", async () => {
    // O persist acrescentou a CAD na ficha existente (o id é o dela). A esteira do produto novo é
    // uma linha própria `(entity_id, enterprise_id)`: não toca na CAD do VOC.
    estado.criar.mockResolvedValue({
      autenticacao: "CAD-2025-AAAA1111",
      entityId: "ent-da-careli",
      ok: true,
      warnings: [],
    });
    const { client, upserts } = clienteFalso();
    const r = await salvarCadastroDoApolo({
      adminClient: client,
      autor: {
        ...autorDoHub(),
        donoUpload: "p-u-1",
        ownerUserId: null,
        registro: { nome: "Maria", origem: "portal", slug: "cecilio-rocha", usuarioId: "u-1" },
      },
      fichaExistente: "acrescentar",
      origemDaEsteira: "portal-incorporador",
      origemPadrao: "portal-incorporador",
      payload: payload({
        perfil: { imobiliariaId: IMOB, imobiliariaLabel: "Cecílio Rocha" },
        vinculo: { empreendimentoNome: "Garden", enterpriseId: "39" },
      }),
    });

    expect(r).toMatchObject({ corpo: { entityId: "ent-da-careli" }, esteira: "gravada", ok: true });
    expect(upserts).toHaveLength(1);
    expect(upserts[0]?.linha).toMatchObject({
      enterprise_id: "39",
      entity_id: "ent-da-careli",
      etapa: "validacao",
      origem: "portal-incorporador",
    });
  });

  it("a marca do produto: CAD em PDF sempre; documento enviado só pela porta do portal", async () => {
    const cad = { arquivo: "CAD - MARIA", secoes: [{ campos: [], titulo: "Dados" }] } as never;
    const documentos = [{ categoria: "identificacao", fileBase64: "aGVsbG8=", fileName: "rg.png" }];
    const marcaDe = (tipo: string) =>
      (estado.upload.mock.calls as unknown as Array<[{ documentType: string; metadataExtra?: unknown }]>)
        .map(([chamada]) => chamada)
        .filter((chamada) => chamada.documentType === tipo)
        .map((chamada) => chamada.metadataExtra);

    await salvarCadastroDoApolo({
      adminClient: clienteFalso().client,
      autor: autorDoHub(),
      origemDaEsteira: "cadastro-manual",
      origemPadrao: "cadastro-formulario",
      payload: payload({ cad, documentos, vinculo: { enterpriseId: " 37 " } }),
    });
    expect(marcaDe("cad")).toEqual([{ enterpriseId: "37" }]);
    expect(marcaDe("identificacao")).toEqual([undefined]);

    estado.upload.mockClear();
    await salvarCadastroDoApolo({
      adminClient: clienteFalso().client,
      autor: {
        ...autorDoHub(),
        ownerUserId: null,
        registro: { nome: "Maria", origem: "portal", slug: "cecilio-rocha", usuarioId: "u-1" },
      },
      origemDaEsteira: "portal-incorporador",
      origemPadrao: "portal-incorporador",
      payload: payload({ cad, documentos, vinculo: { enterpriseId: "39" } }),
    });
    expect(marcaDe("cad")).toEqual([{ enterpriseId: "39" }]);
    expect(marcaDe("identificacao")).toEqual([{ enterpriseId: "39" }]);

    estado.upload.mockClear();
    await salvarCadastroDoApolo({
      adminClient: clienteFalso().client,
      autor: autorDoHub(),
      origemDaEsteira: "cadastro-manual",
      origemPadrao: "cadastro-formulario",
      payload: payload({ cad, documentos }),
    });
    // Sem produto no pedido (o hub permite), não há marca a pôr.
    expect(marcaDe("cad")).toEqual([undefined]);
  });

  it("sem imobiliária não grava esteira; com as duas, grava com a origem da porta", async () => {
    const sem = clienteFalso();
    const semImob = await salvarCadastroDoApolo({
      adminClient: sem.client,
      autor: autorDoHub(),
      origemDaEsteira: "portal-incorporador",
      origemPadrao: "portal-incorporador",
      payload: payload({ vinculo: { enterpriseId: "37" } }),
    });
    expect(semImob).toMatchObject({ esteira: "sem-vinculo", ok: true });
    expect(sem.upserts).toHaveLength(0);

    const com = clienteFalso();
    const comImob = await salvarCadastroDoApolo({
      adminClient: com.client,
      autor: autorDoHub(),
      origemDaEsteira: "portal-incorporador",
      origemPadrao: "portal-incorporador",
      payload: payload({
        perfil: { imobiliariaId: IMOB, imobiliariaLabel: "RR" },
        vinculo: { empreendimentoNome: "Vale do Ouro", enterpriseId: "37" },
      }),
    });
    expect(comImob).toMatchObject({
      corpo: { autenticacao: "CAD-2026-ABCD1234", entityId: "ent-1", ok: true },
      esteira: "gravada",
      ok: true,
    });
    expect(com.upserts).toHaveLength(1);
    expect(com.upserts[0]?.linha).toMatchObject({
      empreendimento: "Vale do Ouro",
      enterprise_id: "37",
      entity_id: "ent-1",
      etapa: "validacao",
      imobiliaria_entity_id: IMOB,
      origem: "portal-incorporador",
    });
  });

  it("o empreendimento da CAD vem do ID do vínculo, mesmo com o texto do browser forjado", async () => {
    // O corpo manda a divisão ("VOC") no `cad.empreendimento` e um nome de vínculo qualquer. O que
    // sai impresso é o nome de MERCADO do id 37, resolvido no servidor.
    const cad = {
      arquivo: "CAD - MARIA",
      empreendimento: "Vale do Ouro · VOC",
      secoes: [{ fields: [{ label: "CPF", value: "1" }], title: "Dados" }],
    } as never;
    await salvarCadastroDoApolo({
      adminClient: clienteFalso().client,
      autor: autorDoHub(),
      origemDaEsteira: "cadastro-manual",
      origemPadrao: "cadastro-formulario",
      payload: payload({
        cad,
        perfil: { imobiliariaId: IMOB, imobiliariaLabel: "RR" },
        vinculo: { empreendimentoNome: "VOC", enterpriseId: "37" },
      }),
    });

    expect(estado.mercado).toHaveBeenCalledTimes(1);
    // Só o ID vai para o resolvedor: nenhum texto do browser entra como reserva.
    expect(estado.mercado.mock.calls[0]?.slice(1)).toEqual(["37"]);
    expect(estado.pdf).toHaveBeenCalledTimes(1);
    expect(estado.pdf.mock.calls[0]?.[0]).toMatchObject({
      autenticacao: "CAD-2026-ABCD1234",
      empreendimento: "Vale do Ouro",
    });
  });

  it("sem empreendimento no vínculo, o texto forjado no corpo não chega ao PDF", async () => {
    const cad = {
      arquivo: "CAD - MARIA",
      empreendimento: "Vale do Ouro · VOC",
      secoes: [{ fields: [{ label: "CPF", value: "1" }], title: "Dados" }],
    } as never;
    await salvarCadastroDoApolo({
      adminClient: clienteFalso().client,
      autor: autorDoHub(),
      origemDaEsteira: "cadastro-manual",
      origemPadrao: "cadastro-formulario",
      payload: payload({ cad }),
    });
    const desenhado = estado.pdf.mock.calls[0]?.[0] as Record<string, unknown>;
    expect("empreendimento" in desenhado).toBe(true);
    expect(desenhado.empreendimento).toBeUndefined();
  });

  it("a ficha da IMOBILIÁRIA sai sem empreendimento, e nem consulta o cadastro", async () => {
    const cad = {
      arquivo: "Imobiliaria - RR",
      empreendimento: "Vale do Ouro",
      secoes: [{ fields: [{ label: "CNPJ", value: "1" }], title: "Empresa" }],
    } as never;
    await salvarCadastroDoApolo({
      adminClient: clienteFalso().client,
      autor: autorDoHub(),
      origemDaEsteira: "cadastro-manual",
      origemPadrao: "cadastro-formulario",
      payload: payload({ cad, persona: "pj", role: "imobiliaria", vinculo: { enterpriseId: "35" } }),
    });
    expect(estado.mercado).not.toHaveBeenCalled();
    expect((estado.pdf.mock.calls[0]?.[0] as Record<string, unknown>).empreendimento).toBeUndefined();
  });

  it("recusa da ficha volta inteira para a porta decidir o que mostrar", async () => {
    const recusa = {
      entityIdExistente: "ent-velha",
      error: "Este CPF já tem CAD cadastrada no empreendimento VALE DO OURO.",
      motivo: "cad-no-empreendimento",
      ok: false,
    };
    estado.criar.mockResolvedValue(recusa);
    const { client } = clienteFalso();
    const r = await salvarCadastroDoApolo({
      adminClient: client,
      autor: autorDoHub(),
      origemDaEsteira: "cadastro-manual",
      origemPadrao: "cadastro-formulario",
      payload: payload({ vinculo: { enterpriseId: "37" } }),
    });
    expect(r).toEqual({ ok: false, recusa, tipo: "recusado" });
  });
});

// O CORRETOR AUTÔNOMO PELA PORTA DO HUB (27/09/2026).
//
// Lucas: *"Preciso cadastrar corretor autonomo... ele nao sera vinculado a uma imobiliaria, ele sera
// uma entidade. Quem fara esse cadastro e time nosso interno."*
//
// O que está travado aqui:
//   • o papel passa (a porta estava fechada: `ENABLED_ROLES` recusava com 400 antes de gravar);
//   • ele salva SEM imobiliária e NÃO entra na esteira (regra do Lucas de 05/08: a esteira valida
//     documento de COMPRADOR, e o corretor não compra nada);
//   • o CÓDIGO vem da sequência do BANCO e é entregue ao persist pela PORTA, nunca pelo corpo;
//   • sem a sequência no banco o cadastro RECUSA com frase clara, e NADA é gravado.
describe("corretor autônomo", () => {
  const corretor = (extra: Partial<SalvarPayload> = {}): SalvarPayload =>
    payload({ perfil: { email: "joao@corretor.com" }, role: "corretor", ...extra });

  it("salva sem imobiliária e não entra na esteira", async () => {
    const { client, upserts } = clienteFalso();
    const r = await salvarCadastroDoApolo({
      adminClient: client,
      autor: autorDoHub(),
      origemDaEsteira: "cadastro-manual",
      origemPadrao: "cadastro-formulario",
      payload: corretor(),
    });

    expect(r).toMatchObject({ esteira: "sem-vinculo", ok: true });
    expect(upserts).toHaveLength(0);
    expect(estado.criar).toHaveBeenCalledTimes(1);
    expect(estado.criar.mock.calls[0]?.[1]).toMatchObject({ role: "corretor" });
  });

  it("o comprovante de renda do empreendimento nem é consultado (a etapa é do comprador)", async () => {
    await salvarCadastroDoApolo({
      adminClient: clienteFalso().client,
      autor: autorDoHub(),
      origemDaEsteira: "cadastro-manual",
      origemPadrao: "cadastro-formulario",
      payload: corretor(),
    });
    expect(estado.renda).not.toHaveBeenCalled();
    // A certidão de nascimento segue a mesma porta: a etapa é do comprador.
    expect(estado.certidao).not.toHaveBeenCalled();
  });

  // ⚠️ O AFROUXAMENTO DAS TRAVAS NASCE NA PORTA, NÃO NO `role` DO JSON (27/09/2026). Se o papel do
  // corpo decidisse, o operador que tomasse "Este CPF já tem CAD cadastrada" trocaria
  // `?tipo=prospect` por `?tipo=corretor` na URL e contornaria a recusa dos "dois Pedro Alexandro".
  it("a porta liga `cadastroDeCorretorAutonomo`, e só para o corretor", async () => {
    const { client } = clienteFalso();
    await salvarCadastroDoApolo({
      adminClient: client,
      autor: autorDoHub(),
      origemDaEsteira: "cadastro-manual",
      origemPadrao: "cadastro-formulario",
      payload: corretor(),
    });
    expect(estado.criar.mock.calls[0]?.[2]).toMatchObject({ cadastroDeCorretorAutonomo: true });

    estado.criar.mockClear();
    await salvarCadastroDoApolo({
      adminClient: client,
      autor: autorDoHub(),
      origemDaEsteira: "cadastro-manual",
      origemPadrao: "cadastro-formulario",
      payload: payload(),
    });
    expect(estado.criar.mock.calls[0]?.[2]).not.toHaveProperty("cadastroDeCorretorAutonomo");
  });

  // ⚠️ A PORTA ENTREGA UMA FUNÇÃO, E NÃO O CÓDIGO PRONTO. `nextval` não volta atrás: pedido no começo
  // da rota, cada recusa (e-mail, núcleo familiar, CAD duplicada) queimava um número e a numeração
  // que o Lucas pediu (*"CA-0001, CA-0002"*) nascia salteada. Quem chama a função é a gravação, já
  // passadas todas as travas (lib/apolo/cadastro-persist.ts, logo antes de montar a linha da ficha).
  it("o código vem da sequência do banco e a porta entrega um GERADOR, não o número", async () => {
    const { client, rpc } = clienteFalso({ data: "CA-0007", error: null });
    await salvarCadastroDoApolo({
      adminClient: client,
      autor: autorDoHub(),
      origemDaEsteira: "cadastro-manual",
      origemPadrao: "cadastro-formulario",
      payload: corretor(),
    });

    // Nada foi pedido ao banco só por salvar: o número é consumido quando a gravação pedir.
    expect(rpc).not.toHaveBeenCalled();
    const gerar = (estado.criar.mock.calls[0]?.[2] as { codigoDoCorretor: () => Promise<unknown> })
      .codigoDoCorretor;
    expect(typeof gerar).toBe("function");
    await expect(gerar()).resolves.toEqual({ codigo: "CA-0007", ok: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    // O corpo espalhado não carrega código nenhum: quem grava é a porta.
    expect(JSON.stringify(estado.criar.mock.calls[0]?.[1])).not.toContain("CA-0007");
  });

  it("sem a sequência no banco: recusa 503 com frase clara e NADA é gravado", async () => {
    const { client } = clienteFalso({
      data: null,
      error: { code: "42883", message: "function does not exist" },
    });
    // O persist de verdade pede o número e devolve `verificacao-indisponivel` sem gravar; aqui o
    // dublê faz o mesmo, porque é a rota que traduz isso em 503 com a frase do operador.
    estado.criar.mockImplementation(
      async (
        _client: unknown,
        _input: unknown,
        opcoes: { codigoDoCorretor: () => Promise<{ mensagem?: string; ok: boolean }> },
      ) => {
        const sequencia = await opcoes.codigoDoCorretor();
        return { error: sequencia.mensagem, motivo: "verificacao-indisponivel", ok: false };
      },
    );

    const r = await salvarCadastroDoApolo({
      adminClient: client,
      autor: autorDoHub(),
      origemDaEsteira: "cadastro-manual",
      origemPadrao: "cadastro-formulario",
      payload: corretor(),
    });

    expect(r).toMatchObject({ ok: false, status: 503, tipo: "invalido" });
    expect((r as { error: string }).error).toBe(MENSAGEM_SEM_SEQUENCIA_DO_CODIGO);
  });

  it("o prospect não pede código nenhum ao banco", async () => {
    const { client, rpc } = clienteFalso();
    await salvarCadastroDoApolo({
      adminClient: client,
      autor: autorDoHub(),
      origemDaEsteira: "cadastro-manual",
      origemPadrao: "cadastro-formulario",
      payload: payload(),
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(estado.criar.mock.calls[0]?.[2]).not.toHaveProperty("codigoDoCorretor");
  });

  // ⚠️ "O AUTÔNOMO NUNCA APARECE COMO IMOBILIÁRIA" É REGRA DE SERVIDOR, NÃO DE TELA (27/09/2026).
  //
  // Lucas: *"NAO QUERO TER A INFORMACAO QUE PODE TER PESSOA FISICA COMO IMOBILIARIA, isso sera bem
  // restrito"*. No persist o relacionamento de imobiliária nasce por PRESENÇA do campo, sem olhar o
  // papel (`if (imobiliariaId || imobiliariaLabel)`), o `imobiliariaLabel` entra no índice de busca e
  // o `imobiliariaId` no metadata da ficha. Um POST com `role: "corretor"` e `perfil.imobiliariaId`
  // preenchido (aba velha reenviada, script interno, a próxima porta que reusar esta função) gravava
  // justamente a informação proibida. É a doutrina deste arquivo: a validação de tela pode ser
  // burlada, então a barra de verdade fica aqui.
  it("imobiliária mandada junto com `role: corretor` é ZERADA pela porta", async () => {
    const { client } = clienteFalso();
    await salvarCadastroDoApolo({
      adminClient: client,
      autor: autorDoHub(),
      origemDaEsteira: "cadastro-manual",
      origemPadrao: "cadastro-formulario",
      payload: corretor({
        perfil: {
          email: "joao@corretor.com",
          imobiliariaId: IMOB,
          imobiliariaLabel: "RR Soluções",
        },
        vinculo: { empreendimentoNome: "VOC", enterpriseId: "37" },
      }),
    });

    const enviado = estado.criar.mock.calls[0]?.[1] as {
      enterpriseId: null | string;
      perfil: { imobiliariaId?: string; imobiliariaLabel?: string };
    };
    expect(enviado.perfil.imobiliariaId).toBe("");
    expect(enviado.perfil.imobiliariaLabel).toBe("");
    // E o vínculo também não vale para ele: nem empreendimento nem esteira.
    expect(enviado.enterpriseId).toBeNull();
    expect(JSON.stringify(enviado)).not.toContain("RR Soluções");
    expect(JSON.stringify(enviado)).not.toContain(IMOB);
  });

  it("o prospect continua levando a imobiliária dele intacta", async () => {
    const { client } = clienteFalso();
    await salvarCadastroDoApolo({
      adminClient: client,
      autor: autorDoHub(),
      origemDaEsteira: "cadastro-manual",
      origemPadrao: "cadastro-formulario",
      payload: payload({
        perfil: { imobiliariaId: IMOB, imobiliariaLabel: "RR Soluções" },
        vinculo: { empreendimentoNome: "VOC", enterpriseId: "37" },
      }),
    });

    const enviado = estado.criar.mock.calls[0]?.[1] as {
      enterpriseId: null | string;
      perfil: { imobiliariaId?: string };
    };
    expect(enviado.perfil.imobiliariaId).toBe(IMOB);
    expect(enviado.enterpriseId).toBe("37");
  });
});
