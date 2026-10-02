import { beforeEach, describe, expect, it, vi } from "vitest";

// A CAD DO CLIENTE DO CORRETOR AUTÔNOMO NASCE — a metade da fatia 2 sem a qual nada mais serve.
//
// ⚠️ O QUE ESTAVA TRAVADO, E POR QUÊ. A condição de lib/apolo/cadastro-salvar.ts era
// `role !== "corretor" && vinculo?.enterpriseId && imobiliariaId`, e a imobiliária estava ali por
// CÓPIA: o bloco foi escrito para gravar *"como o portal público faz"*, e no portal público a
// imobiliária é obrigatória por CHECK de banco (`apolo_esteira_vinculo_publico_check`, migration
// 0061, escopado em `origem = 'publico-cad'`). Aqui ela nunca foi necessária. Medido em produção
// (bxgukywoxgivlrhjkwjx, 28/09/2026): `apolo_esteira.imobiliaria` e `imobiliaria_entity_id` são as
// duas NULLABLE, e 41 das 843 linhas de hoje JÁ ESTÃO sem nenhuma das duas, inclusive em etapa
// `credenciado` e `revisao`, sem nada quebrado. ESTA FATIA NÃO PRECISA DE MIGRATION.
//
// ⚠️ E O PRECEDENTE JÁ ESTAVA NO AR: lib/hercules/cad-do-comprador.ts:112-118 grava, por desenho e
// desde a v1.385.0, uma linha de esteira com `imobiliaria: null` e `imobiliaria_entity_id: null`.
//
// O que está travado aqui:
//   • com o autônomo HABILITADO no empreendimento, a esteira é gravada SEM imobiliária, com ele em
//     `corretor_entity_id` e o nome resolvido NO SERVIDOR;
//   • sem habilitação, a porta RECUSA ANTES de criar a ficha (fail-closed) e nada é gravado;
//   • imobiliária e autônomo no mesmo corpo é recusado: um cadastro tem UM vínculo;
//   • o nome do autônomo NUNCA vai para o campo "Imobiliaria" da CAD em PDF (a regra do Lucas de
//     27/09/2026: *"nao quero ter a informacao que pode ter pessoa fisica como imobiliaria"*);
//   • a CAD de cliente de IMOBILIÁRIA continua exatamente como era.

const estado = vi.hoisted(() => ({
  cadastro: vi.fn(),
  criar: vi.fn(),
  mercado: vi.fn(async () => "Vale do Ouro"),
  pdf: vi.fn(async (_cad: Record<string, unknown>) => new Uint8Array([1, 2, 3])),
  renda: vi.fn(async () => false),
  upload: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/apolo/cadastro-persist", () => ({ createApoloEntity: estado.criar }));
vi.mock("@/lib/apolo/enterprise-settings", () => ({
  exigeCertidaoNascimento: estado.renda,
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
// O expansor do pai/grupo (`expansorDeEmpreendimentos`) lê o cadastro do Panteon; aqui ele volta
// vazio, então cada id cobre só a si mesmo. A expansão tem teste próprio em
// lib/apolo/habilitacao-do-autonomo.test.ts e em lib/apolo/habilitacao-pelo-cadastro.test.ts.
vi.mock("@/lib/hercules/cadastro", async (original) => ({
  ...(await original<typeof import("@/lib/hercules/cadastro")>()),
  carregarCadastroDeEmpreendimentos: estado.cadastro,
}));

import { MENSAGEM_AUTONOMO_SEM_HABILITACAO } from "@/lib/apolo/habilitacao-do-autonomo";

import { salvarCadastroDoApolo, type SalvarPayload } from "./cadastro-salvar";
import { FONTE_DA_HABILITACAO_DO_AUTONOMO } from "./habilitacao-do-autonomo";

const AUTONOMO = "aaaaaaaa-1111-4111-8111-111111111111";
const SEM_HABILITACAO = "eeeeeeee-5555-4555-8555-555555555555";
const IMOB = "11111111-2222-4333-8444-555555555555";

type Linha = Record<string, unknown>;

/** O banco de mentira: filtra de verdade e guarda os upserts, que é o que prova a gravação. */
function clienteFalso(tabelas: Record<string, Linha[]>) {
  const upserts: Array<{ linha: Record<string, unknown>; tabela: string }> = [];
  const client = {
    rpc: async () => ({ data: "CA-0007", error: null }),
    from(tabela: string) {
      let linhas = [...(tabelas[tabela] ?? [])];
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = (coluna: string, valor: unknown) => {
        linhas = linhas.filter((linha) => String(linha[coluna] ?? null) === String(valor));
        return q;
      };
      q.in = (coluna: string, valores: unknown[]) => {
        linhas = linhas.filter((linha) => valores.map(String).includes(String(linha[coluna] ?? null)));
        return q;
      };
      q.not = (coluna: string) => {
        linhas = linhas.filter((linha) => linha[coluna] !== null && linha[coluna] !== undefined);
        return q;
      };
      for (const metodo of ["limit", "order", "range"]) q[metodo] = () => q;
      q.maybeSingle = async () => ({ data: linhas[0] ?? null, error: null });
      q.upsert = async (linha: Record<string, unknown>) => {
        upserts.push({ linha, tabela });
        return { error: null };
      };
      q.then = (resolver: (r: unknown) => unknown) =>
        Promise.resolve({ data: linhas, error: null }).then(resolver);
      return q;
    },
  };
  return { client: client as never, upserts };
}

function banco() {
  return clienteFalso({
    apolo_entities: [
      {
        broker_code: "CA-0001",
        display_name: "JOAO AUTONOMO",
        entity_kind: "pf",
        id: AUTONOMO,
        legal_name: null,
      },
      {
        broker_code: "CA-0002",
        display_name: "CARLOS SEM HABILITACAO",
        entity_kind: "pf",
        id: SEM_HABILITACAO,
        legal_name: null,
      },
      {
        broker_code: null,
        display_name: "RR Soluções",
        entity_kind: "pj",
        id: IMOB,
        legal_name: null,
      },
    ],
    apolo_entity_profiles: [
      { entity_id: AUTONOMO, profile: "corretor", status: "active" },
      { entity_id: SEM_HABILITACAO, profile: "corretor", status: "active" },
      { entity_id: IMOB, profile: "imobiliaria", status: "active" },
    ],
    apolo_relationships: [
      {
        created_at: "2026-09-28T10:00:00+00:00",
        entity_id: AUTONOMO,
        id: "rel-autonomo-37",
        label: "VALE DO OURO",
        metadata: { enterpriseId: "37", source: FONTE_DA_HABILITACAO_DO_AUTONOMO },
        relationship_type: "empreendimento",
        status: "verified",
      },
    ],
  });
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

async function salvar(client: never, corpo: SalvarPayload) {
  return salvarCadastroDoApolo({
    adminClient: client,
    autor: autorDoHub(),
    origemDaEsteira: "cadastro-manual",
    origemPadrao: "cadastro-formulario",
    payload: corpo,
  });
}

beforeEach(() => {
  estado.criar.mockReset();
  estado.criar.mockResolvedValue({
    autenticacao: "CAD-2026-ABCD1234",
    entityId: "ent-1",
    ok: true,
    warnings: [],
  });
  estado.cadastro.mockReset();
  estado.cadastro.mockResolvedValue([]);
  estado.upload.mockClear();
  estado.renda.mockClear();
  estado.mercado.mockClear();
  estado.pdf.mockClear();
});

describe("a CAD do cliente do corretor autônomo", () => {
  it("⚠️ nasce SEM imobiliária, com o autônomo em corretor_entity_id e o nome do servidor", async () => {
    const { client, upserts } = banco();
    const r = await salvar(
      client,
      payload({
        vinculo: {
          // O texto que o browser mandou é ignorado: o nome sai do id conferido no servidor.
          corretorAutonomoEntityId: AUTONOMO,
          corretorNome: "NOME FORJADO NO BROWSER",
          empreendimentoNome: "Vale do Ouro",
          enterpriseId: "37",
        },
      }),
    );

    expect(r).toMatchObject({ esteira: "gravada", ok: true });
    const daEsteira = upserts.filter((u) => u.tabela === "apolo_esteira");
    expect(daEsteira).toHaveLength(1);
    expect(daEsteira[0]?.linha).toMatchObject({
      corretor: "JOAO AUTONOMO",
      corretor_entity_id: AUTONOMO,
      empreendimento: "Vale do Ouro",
      enterprise_id: "37",
      entity_id: "ent-1",
      etapa: "validacao",
      imobiliaria: null,
      imobiliaria_entity_id: null,
      origem: "cadastro-manual",
    });
  });

  it("⚠️ a ficha do cliente não ganha imobiliária nenhuma (nem label, nem id)", async () => {
    const { client } = banco();
    await salvar(
      client,
      payload({
        perfil: { imobiliariaId: "", imobiliariaLabel: "" },
        vinculo: { corretorAutonomoEntityId: AUTONOMO, enterpriseId: "37" },
      }),
    );
    expect(estado.criar).toHaveBeenCalledTimes(1);
    // [0] é o adminClient; [1] é o que a porta monta e entrega ao persist.
    const entrada = estado.criar.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(entrada.perfil).toMatchObject({ imobiliariaId: "", imobiliariaLabel: "" });
  });

  it("⚠️ sem habilitação no empreendimento: 400 com frase clara e NADA é criado", async () => {
    const { client, upserts } = banco();
    const r = await salvar(
      client,
      payload({ vinculo: { corretorAutonomoEntityId: SEM_HABILITACAO, enterpriseId: "37" } }),
    );

    expect(r).toEqual({
      error: MENSAGEM_AUTONOMO_SEM_HABILITACAO,
      ok: false,
      status: 400,
      tipo: "invalido",
    });
    expect(estado.criar).not.toHaveBeenCalled();
    expect(upserts).toHaveLength(0);
  });

  it("⚠️ habilitado no 37 mas a CAD é do 39: recusa (a habilitação é por empreendimento)", async () => {
    const { client } = banco();
    const r = await salvar(
      client,
      payload({ vinculo: { corretorAutonomoEntityId: AUTONOMO, enterpriseId: "39" } }),
    );
    expect(r).toMatchObject({ ok: false, status: 400, tipo: "invalido" });
    expect(estado.criar).not.toHaveBeenCalled();
  });

  it("⚠️ imobiliária E autônomo no mesmo corpo: recusado, um cadastro tem UM vínculo", async () => {
    const { client } = banco();
    const r = await salvar(
      client,
      payload({
        perfil: { imobiliariaId: IMOB, imobiliariaLabel: "RR" },
        vinculo: { corretorAutonomoEntityId: AUTONOMO, enterpriseId: "37" },
      }),
    );
    expect(r).toMatchObject({ ok: false, status: 400, tipo: "invalido" });
    expect(estado.criar).not.toHaveBeenCalled();
  });

  it("⚠️ o nome do autônomo NUNCA sai no campo Imobiliaria da CAD em PDF", async () => {
    const { client } = banco();
    await salvar(
      client,
      payload({
        cad: { arquivo: "CAD - MARIA", secoes: [{ campos: [], titulo: "Dados" }] } as never,
        vinculo: {
          corretorAutonomoEntityId: AUTONOMO,
          empreendimentoNome: "Vale do Ouro",
          enterpriseId: "37",
        },
      }),
    );

    expect(estado.pdf).toHaveBeenCalledTimes(1);
    const desenhado = estado.pdf.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(desenhado.imobiliaria).toBe("");
    // E o `vinculo` legado, que o PDF usa como queda para o mesmo campo, também é apagado.
    expect(desenhado.vinculo ?? "").toBe("");
    // Quem vendeu aparece onde deve: na linha do corretor.
    expect(desenhado.corretor).toBe("JOAO AUTONOMO");
  });

  it("um id que não é de autônomo (só o corretor da imobiliária, sem código) é recusado", async () => {
    const { client } = clienteFalso({
      apolo_entities: [
        {
          broker_code: null,
          display_name: "CORRETOR DA RR",
          entity_kind: "pf",
          id: AUTONOMO,
          legal_name: null,
        },
      ],
      apolo_entity_profiles: [{ entity_id: AUTONOMO, profile: "corretor", status: "active" }],
      apolo_relationships: [],
    });
    const r = await salvar(
      client,
      payload({ vinculo: { corretorAutonomoEntityId: AUTONOMO, enterpriseId: "37" } }),
    );
    expect(r).toMatchObject({ ok: false, status: 400, tipo: "invalido" });
  });
});

describe("a CAD de cliente de imobiliária, intocada", () => {
  it("continua gravando a esteira com imobiliária, como sempre", async () => {
    const { client, upserts } = banco();
    const r = await salvar(
      client,
      payload({
        perfil: { imobiliariaId: IMOB, imobiliariaLabel: "RR" },
        vinculo: {
          corretorEntityId: "99999999-9999-4999-8999-999999999999",
          corretorNome: "PEDRO DA RR",
          empreendimentoNome: "Vale do Ouro",
          enterpriseId: "37",
        },
      }),
    );

    expect(r).toMatchObject({ esteira: "gravada", ok: true });
    const daEsteira = upserts.filter((u) => u.tabela === "apolo_esteira");
    expect(daEsteira[0]?.linha).toMatchObject({
      corretor: "PEDRO DA RR",
      corretor_entity_id: "99999999-9999-4999-8999-999999999999",
      enterprise_id: "37",
      imobiliaria: "RR Soluções",
      imobiliaria_entity_id: IMOB,
    });
  });

  it("⚠️ a imobiliária não passa pela régua da habilitação do autônomo (nada afrouxou nem apertou)", async () => {
    // A imobiliária deste banco NÃO tem vínculo de empreendimento nenhum. Se a porta do autônomo
    // se aplicasse a ela, este cadastro seria recusado — e ele não pode ser.
    const { client } = banco();
    const r = await salvar(
      client,
      payload({
        perfil: { imobiliariaId: IMOB, imobiliariaLabel: "RR" },
        vinculo: { enterpriseId: "37" },
      }),
    );
    expect(r).toMatchObject({ esteira: "gravada", ok: true });
  });

  it("sem imobiliária e sem autônomo continua sem esteira (a regra de sempre)", async () => {
    const { client, upserts } = banco();
    const r = await salvar(client, payload({ vinculo: { enterpriseId: "37" } }));
    expect(r).toMatchObject({ esteira: "sem-vinculo", ok: true });
    expect(upserts).toHaveLength(0);
  });
});
