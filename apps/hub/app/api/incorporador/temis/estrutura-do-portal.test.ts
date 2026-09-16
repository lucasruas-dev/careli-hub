import { beforeEach, describe, expect, it, vi } from "vitest";

// A ESTRUTURA DO CONTRATO PELO PORTAL — anexos e capa, quadro de assinatura, faixas, categorias e as
// unidades da categoria. E a prova de que as mesmas funções, chamadas pelo hub, continuam iguais.
//
// Decisão do Lucas (16/09/2026): a equipe da Cecílio confecciona os contratos dos produtos dela e
// edita os modelos; planos e faixas continuam com a Careli. O que está travado aqui:
//   1. ANEXOS e ASSINANTES: CRUD só no alcance. O de outro dono (VOL, do Lino) é 404 e nada é lido,
//      assinado ou gravado; o arquivo registrado tem de estar na pasta do alcance; a capa precisa da
//      minuta E da pasta do ator; a categoria do consolidado só grava com o conjunto inteiro;
//   2. FAIXAS e CATEGORIAS: o portal lê o que é dele e toda escrita é 404, sem gravar nada;
//   3. a CATEGORIA mora no pai (VLO) e é lida pela divisão, RECORTADA: a contagem de lotes e a ordem
//      de assinatura herdada não trazem nada do VOL; o `codigo` da URL não abre outro produto;
//   4. O HUB NÃO MUDA: grava em qualquer empreendimento, conta todos os lotes e vê a herança toda;
//   5. ESCRITA SÓ NO QUE O PORTAL OPERA (decisão do Lucas, 16/09/2026): com o cadastro de verdade, o
//      VOC (Careli) lê e responde 403 só consulta a subir, registrar, trocar capa, desativar, incluir
//      e remover; o Garden (Cecílio) segue;
//   6. A CATEGORIA DO PAI NO PORTAL só aparece com lote no alcance ou sem lote nenhum (revisão da
//      onda 3, achado 5), e os anexos dela seguem a mesma régua; o caminho do arquivo não sai;
//   7. O PRÉDIO NO VÍNCULO (onda 2, achado 28): cada apartamento é uma chave (torre + número), e a
//      trava de "sem quadra e sem lote" vale só para o loteamento.
//
// ⚠️ O CADASTRO DOS PRODUTOS É TROCADO SÓ NA LEITURA (`lerCadastroDeEmpreendimentos`); a régua de
// quem opera é a de verdade. Nos grupos 1 a 4 todos os produtos são da Cecílio (o cenário do escopo,
// anterior à régua); o grupo 5 usa o cadastro de 16/09/2026.
//
// Supabase em memória (`lib/temis/fixtures/supabase-em-memoria.ts`). Cadastro medido em 16/09/2026:
// VLO = 35 (pai), VOC = 37, VOL = 36, VOR = 41; a Cecílio tem 37 e 39.

const CECILIO = "0f6d2c1e-3b4a-4c5d-8e9f-a1b2c3d4e5f6";
const MINUTA_VOC = "11111111-1111-4111-8111-111111111111";
const MINUTA_VOL = "22222222-2222-4222-8222-222222222222";
const CATEGORIA = "44444444-4444-4444-8444-444444444444";
const UNIDADE_VOC = "55555555-5555-4555-8555-555555555555";
const UNIDADE_VOL = "66666666-6666-4666-8666-666666666666";
const UNIDADE_ESPELHO = "67676767-6767-4767-8767-676767676767";
const ANEXO_VOC = "77777777-7777-4777-8777-777777777777";
const ANEXO_VOL = "78787878-7878-4878-8878-787878787878";
const ANEXO_CATEGORIA = "88888888-8888-4888-8888-888888888888";
const ASSINANTE_VOC = "99999999-9999-4999-8999-999999999999";
const ASSINANTE_VOL = "98989898-9898-4898-8898-989898989898";

const estado = vi.hoisted(() => ({
  banco: null as unknown,
  leiturasDoCadastro: 0,
  porta: "cecilio" as "cecilio" | "conjunto" | "fora" | "sem-sessao",
  produtos: [] as Array<{ c2x: string; operadoPor: null | string; pai?: string }>,
}));

vi.mock("@/lib/hercules/cadastro", async (importOriginal) => {
  const { cadastroDosProdutos } = await import("@/lib/temis/fixtures/produtos-operados");
  return {
    ...(await importOriginal<typeof import("@/lib/hercules/cadastro")>()),
    lerCadastroDeEmpreendimentos: async () => {
      estado.leiturasDoCadastro += 1;
      return { com0170: true, linhas: cadastroDosProdutos(estado.produtos) };
    },
  };
});

vi.mock("@/lib/guardian/db", () => ({ getHadesDbPool: () => ({ ok: false }) }));

vi.mock("@/lib/apolo/server", async () => {
  const { clienteEmMemoria } = await import("@/lib/temis/fixtures/supabase-em-memoria");
  return {
    createApoloAdminClient: () =>
      clienteEmMemoria(estado.banco as Parameters<typeof clienteEmMemoria>[0]),
  };
});

vi.mock("@/lib/apolo/auth", () => {
  const autorizar = async () => ({ nome: "Jurídico Careli", ok: true, userId: "user-1" });
  return { authorizeApoloRead: autorizar, authorizeApoloWrite: autorizar };
});

vi.mock("@/lib/temis/portao-do-portal", async () => {
  const { NextResponse } = await import("next/server");
  return {
    autorizarTemisDoPortal: async () => {
      if (estado.porta === "sem-sessao") {
        return { ok: false, response: NextResponse.json({ error: "Sessao expirada." }, { status: 401 }) };
      }
      if (estado.porta === "fora") {
        return { ok: false, response: NextResponse.json({ error: "Nao encontrado." }, { status: 404 }) };
      }
      return {
        ator: {
          enterpriseIds: estado.porta === "conjunto" ? ["group:Vale do Ouro", "37", "36", "41"] : ["37", "39"],
          incorporadorId: CECILIO,
          nome: "Maria do Jurídico",
          slug: "cecilio-rocha",
          tipo: "portal",
          usuarioId: "usuario-portal-1",
        },
        ok: true,
        sessao: {},
      };
    },
  };
});

import * as hubAnexos from "@/app/api/temis/anexos/route";
import * as hubAssinantes from "@/app/api/temis/assinantes/route";
import * as hubCategorias from "@/app/api/temis/categorias/route";
import * as hubUnidades from "@/app/api/temis/categorias/unidades/route";
import * as hubFaixas from "@/app/api/temis/faixas/route";
import {
  PRODUTOS_DE_16_DE_SETEMBRO,
  TUDO_DA_CECILIO,
} from "@/lib/temis/fixtures/produtos-operados";
import {
  type EstadoDoBanco,
  gravacoesEm,
  novoEstado,
} from "@/lib/temis/fixtures/supabase-em-memoria";

import * as portalAnexos from "./anexos/route";
import * as portalAssinantes from "./assinantes/route";
import * as portalCategorias from "./categorias/route";
import * as portalUnidades from "./categorias/unidades/route";
import * as portalFaixas from "./faixas/route";

const banco = () => estado.banco as EstadoDoBanco;
const AUTOR_DO_PORTAL = "Maria do Jurídico (portal do incorporador)";

const unidade = (id: string, enterpriseId: string, quadra: string, extra: Record<string, unknown> = {}) => ({
  categoria_id: CATEGORIA,
  codigo: `Q${quadra}L1`,
  enterprise_id: enterpriseId,
  espelho_de: null,
  id,
  lote: "1",
  quadra,
  situacao: "disponivel",
  workspace_id: "careli",
  ...extra,
});

beforeEach(() => {
  const novo = novoEstado();
  novo.tabelas = {
    apolo_enterprise_settings: [
      // A ordem de assinatura do VOL é do Lino: o hub a vê como herança, o portal da Cecílio não.
      { assinatura_ordem: ["comprador", "vendedora"], assinatura_ordenada: true, enterprise_id: "36" },
    ],
    hercules_empreendimentos: [
      { c2x_enterprise_id: "35", codigo: "VLO", id: "h-vlo", nome: "Vale do Ouro", pai_id: null, workspace_id: "careli" },
      { c2x_enterprise_id: "37", codigo: "VOC", id: "h-voc", nome: "VOC", pai_id: "h-vlo", workspace_id: "careli" },
      { c2x_enterprise_id: "36", codigo: "VOL", id: "h-vol", nome: "VOL", pai_id: "h-vlo", workspace_id: "careli" },
      { c2x_enterprise_id: "41", codigo: "VOR", id: "h-vor", nome: "VOR", pai_id: "h-vlo", workspace_id: "careli" },
      { c2x_enterprise_id: "20", codigo: "JDG", id: "h-jdg", nome: "JDG", pai_id: null, workspace_id: "careli" },
    ],
    hercules_unidades: [
      unidade(UNIDADE_VOC, "37", "1"),
      unidade(UNIDADE_VOL, "36", "2"),
      // O mesmo terreno do VOC, gravado no pai: o espelho.
      unidade(UNIDADE_ESPELHO, "35", "1", { espelho_de: UNIDADE_VOC }),
    ],
    temis_anexos: [
      { ativo: true, categoria_id: null, enterprise_id: "37", id: ANEXO_VOC, nome: "Memorial", posicao: 1, storage_path: "temis-anexos/empreendimento/37/a.pdf", unidade_id: null, workspace_id: "careli" },
      { ativo: true, categoria_id: null, enterprise_id: "36", id: ANEXO_VOL, nome: "Memorial VOL", posicao: 1, storage_path: "temis-anexos/empreendimento/36/b.pdf", unidade_id: null, workspace_id: "careli" },
      { ativo: true, categoria_id: CATEGORIA, enterprise_id: null, id: ANEXO_CATEGORIA, nome: "Regimento", posicao: 2, storage_path: `temis-anexos/categoria/${CATEGORIA}/c.pdf`, unidade_id: null, workspace_id: "careli" },
    ],
    temis_assinantes: [
      { ativo: true, cpf: "529.982.247-25", email: "ana@careli.adm.br", enterprise_id: "37", id: ASSINANTE_VOC, nome: "Ana Testemunha", papel: "testemunha", posicao: 1, workspace_id: "careli" },
      { ativo: true, enterprise_id: "36", id: ASSINANTE_VOL, nome: "Beto Testemunha", papel: "testemunha", posicao: 1, workspace_id: "careli" },
    ],
    temis_categorias: [
      { assinatura_ordem: null, assinatura_ordenada: false, categoria_pai_id: null, enterprise_id: "35", id: CATEGORIA, nome: "Condomínio", ordem: 0, workspace_id: "careli" },
    ],
    temis_faixas_de_prazo: [
      { enterprise_id: "37", id: "f-voc", parcela_minima: 1, workspace_id: "careli" },
      { enterprise_id: "36", id: "f-vol", parcela_minima: 1, workspace_id: "careli" },
    ],
    temis_indices: [{ ativo: true, codigo: "IPCA", workspace_id: "careli" }],
    temis_minutas: [
      { enterprise_id: "37", id: MINUTA_VOC, workspace_id: "careli" },
      { enterprise_id: "36", id: MINUTA_VOL, workspace_id: "careli" },
    ],
    temis_planos: [],
  };
  estado.banco = novo;
  estado.leiturasDoCadastro = 0;
  estado.porta = "cecilio";
  estado.produtos = [...TUDO_DA_CECILIO];
  vi.spyOn(console, "info").mockImplementation(() => {});
});

const pedir = (rota: string, caminho: string, metodo = "GET", corpo?: unknown) =>
  new Request(`https://c2x.app.br/api/incorporador/temis/${rota}${caminho}`, {
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    headers: { "Content-Type": "application/json" },
    method: metodo,
  });

const hub = (rota: string, caminho: string, metodo = "GET", corpo?: unknown) =>
  new Request(`https://c2x.app.br/api/temis/${rota}${caminho}`, {
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
    method: metodo,
  });

const consultouATabela = (tabela: string) => banco().consultas.some((c) => c.tabela === tabela);
const linha = (tabela: string, id: string) => banco().tabelas[tabela]?.find((l) => l.id === id);

describe("a porta do portal decide quem entra", () => {
  it("sem sessão: 401 em qualquer rota, sem consulta", async () => {
    estado.porta = "sem-sessao";
    expect((await portalAnexos.GET(pedir("anexos", "?enterpriseId=37"))).status).toBe(401);
    expect((await portalCategorias.GET(pedir("categorias", "?enterpriseId=37"))).status).toBe(401);
    expect(banco().consultas).toHaveLength(0);
  });
});

describe("ANEXOS pelo portal", () => {
  it("GET de outro empreendimento: 404 sem ler a tabela", async () => {
    const r = await portalAnexos.GET(pedir("anexos", "?enterpriseId=36"));
    expect(r.status).toBe(404);
    expect(consultouATabela("temis_anexos")).toBe(false);
  });

  it("GET do VOC: só os dele", async () => {
    const r = await portalAnexos.GET(pedir("anexos", "?enterpriseId=37"));
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { anexos: Array<{ id: string }> };
    expect(corpo.anexos.map((a) => a.id)).toEqual([ANEXO_VOC]);
  });

  it("GET com a categoria do pai: lê (a categoria rege os lotes do VOC)", async () => {
    const r = await portalAnexos.GET(pedir("anexos", `?enterpriseId=37&categoriaId=${CATEGORIA}`));
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { anexos: Array<{ id: string }> };
    expect(corpo.anexos.map((a) => a.id).sort()).toEqual([ANEXO_VOC, ANEXO_CATEGORIA].sort());
  });

  it("GET com um nível de outro dono no meio: 404 para o pedido inteiro", async () => {
    const r = await portalAnexos.GET(pedir("anexos", `?categoriaId=${CATEGORIA}&unidadeId=${UNIDADE_VOL}`));
    expect(r.status).toBe(404);
    expect(consultouATabela("temis_anexos")).toBe(false);
  });

  it("POST upload em outro empreendimento: 404 e nenhuma URL assinada", async () => {
    const r = await portalAnexos.POST(
      pedir("anexos", "", "POST", { acao: "upload", contentType: "application/pdf", enterpriseId: "36", fileName: "a.pdf", size: 10 }),
    );
    expect(r.status).toBe(404);
    expect(banco().storage.signedUpload).toHaveLength(0);
  });

  it("POST upload no VOC: a URL assinada na pasta dele", async () => {
    const r = await portalAnexos.POST(
      pedir("anexos", "", "POST", { acao: "upload", contentType: "application/pdf", enterpriseId: "37", fileName: "a.pdf", size: 10 }),
    );
    expect(r.status).toBe(200);
    expect(((await r.json()) as { path: string }).path.startsWith("temis-anexos/empreendimento/37/")).toBe(true);
  });

  it("POST upload da capa: pela minuta do ator sim, pela de outro dono não", async () => {
    const corpo = (minutaId: string) => ({
      acao: "upload",
      capa: true,
      contentType: "application/pdf",
      enterpriseId: minutaId,
      fileName: "capa.pdf",
      size: 10,
    });
    expect((await portalAnexos.POST(pedir("anexos", "", "POST", corpo(MINUTA_VOL)))).status).toBe(404);
    expect(banco().storage.signedUpload).toHaveLength(0);

    const r = await portalAnexos.POST(pedir("anexos", "", "POST", corpo(MINUTA_VOC)));
    expect(r.status).toBe(200);
    expect(((await r.json()) as { path: string }).path.startsWith(`temis-capas/empreendimento/${MINUTA_VOC}/`)).toBe(true);
  });

  it("POST confirmar um arquivo da pasta de OUTRO empreendimento: 404, sem ler o Storage nem gravar", async () => {
    const r = await portalAnexos.POST(
      pedir("anexos", "", "POST", {
        acao: "confirmar",
        enterpriseId: "37",
        nome: "Memorial",
        path: "temis-anexos/empreendimento/36/uuid-b.pdf",
        posicao: 3,
      }),
    );
    expect(r.status).toBe(404);
    expect(banco().storage.info).toHaveLength(0);
    expect(gravacoesEm(banco(), "temis_anexos")).toHaveLength(0);
  });

  it("POST confirmar no VOC: registra com o autor do portal", async () => {
    const r = await portalAnexos.POST(
      pedir("anexos", "", "POST", {
        acao: "confirmar",
        enterpriseId: "37",
        nome: "Planta",
        path: "temis-anexos/empreendimento/37/uuid-planta.pdf",
        posicao: 3,
      }),
    );
    expect(r.status).toBe(200);
    const [insert] = gravacoesEm(banco(), "temis_anexos");
    expect(insert?.valores).toMatchObject({
      criado_por: "usuario-portal-1",
      criado_por_nome: AUTOR_DO_PORTAL,
      enterprise_id: "37",
    });
  });

  it("POST confirmar na categoria do consolidado: 404 com uma divisão, grava com o conjunto", async () => {
    const corpo = {
      acao: "confirmar",
      categoriaId: CATEGORIA,
      nome: "Regimento novo",
      path: `temis-anexos/categoria/${CATEGORIA}/uuid-r.pdf`,
      posicao: 5,
    };
    expect((await portalAnexos.POST(pedir("anexos", "", "POST", corpo))).status).toBe(404);
    expect(gravacoesEm(banco(), "temis_anexos")).toHaveLength(0);

    estado.porta = "conjunto";
    expect((await portalAnexos.POST(pedir("anexos", "", "POST", corpo))).status).toBe(200);
  });

  it("POST capa: minuta de outro dono 404; arquivo de outra pasta 404; os dois do ator gravam", async () => {
    expect(
      (await portalAnexos.POST(pedir("anexos", "", "POST", { acao: "capa", minutaId: MINUTA_VOL, path: "" }))).status,
    ).toBe(404);
    expect(
      (
        await portalAnexos.POST(
          pedir("anexos", "", "POST", { acao: "capa", minutaId: MINUTA_VOC, nome: "c.pdf", path: `temis-capas/empreendimento/${MINUTA_VOL}/uuid-c.pdf` }),
        )
      ).status,
    ).toBe(404);
    expect(gravacoesEm(banco(), "temis_minutas")).toHaveLength(0);

    const caminho = `temis-capas/empreendimento/${MINUTA_VOC}/uuid-c.pdf`;
    const r = await portalAnexos.POST(
      pedir("anexos", "", "POST", { acao: "capa", minutaId: MINUTA_VOC, nome: "c.pdf", path: caminho }),
    );
    expect(r.status).toBe(200);
    expect(linha("temis_minutas", MINUTA_VOC)?.capa_path).toBe(caminho);
  });

  it("DELETE de outro dono: 404 e nada gravado; do VOC: desativa com quem desativou", async () => {
    expect((await portalAnexos.DELETE(pedir("anexos", `?id=${ANEXO_VOL}`, "DELETE"))).status).toBe(404);
    expect(gravacoesEm(banco(), "temis_anexos")).toHaveLength(0);

    expect((await portalAnexos.DELETE(pedir("anexos", `?id=${ANEXO_VOC}`, "DELETE"))).status).toBe(200);
    expect(linha("temis_anexos", ANEXO_VOC)).toMatchObject({ ativo: false, desativado_por_nome: AUTOR_DO_PORTAL });
  });

  it("DELETE com a 0173 pendente: desativa mesmo assim", async () => {
    banco().colunasAusentes = ["desativado_por_nome"];
    expect((await portalAnexos.DELETE(pedir("anexos", `?id=${ANEXO_VOC}`, "DELETE"))).status).toBe(200);
    expect(linha("temis_anexos", ANEXO_VOC)?.ativo).toBe(false);
  });
});

describe("QUADRO DE ASSINATURA pelo portal", () => {
  const pessoa = (enterpriseId: string) => ({
    email: "joana@exemplo.com",
    enterpriseId,
    nome: "Joana Testemunha",
    papel: "testemunha",
    posicao: 2,
  });

  it("GET de outro empreendimento: 404 sem ler o quadro nem o representante", async () => {
    const r = await portalAssinantes.GET(pedir("assinantes", "?enterpriseId=36"));
    expect(r.status).toBe(404);
    expect(consultouATabela("temis_assinantes")).toBe(false);
    expect(consultouATabela("apolo_enterprise_settings")).toBe(false);
  });

  it("GET do VOC: só as pessoas dele", async () => {
    const r = await portalAssinantes.GET(pedir("assinantes", "?enterpriseId=37"));
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { assinantes: Array<{ id: string }> };
    expect(corpo.assinantes.map((a) => a.id)).toEqual([ASSINANTE_VOC]);
  });

  it("GET do VOC: o CPF sai mascarado para o portal e inteiro para o hub", async () => {
    const r = await portalAssinantes.GET(pedir("assinantes", "?enterpriseId=37"));
    const corpo = (await r.json()) as { assinantes: Array<{ cpf: null | string }> };
    expect(corpo.assinantes.map((a) => a.cpf)).toEqual(["***.***.***-25"]);

    const doHub = await hubAssinantes.GET(hub("assinantes", "?enterpriseId=37"));
    const corpoDoHub = (await doHub.json()) as { assinantes: Array<{ cpf: null | string }> };
    expect(corpoDoHub.assinantes.map((a) => a.cpf)).toEqual(["529.982.247-25"]);
  });

  it("POST em outro empreendimento: 404 e nada gravado; no VOC: inclui com o autor do portal", async () => {
    expect((await portalAssinantes.POST(pedir("assinantes", "", "POST", pessoa("36")))).status).toBe(404);
    expect(gravacoesEm(banco(), "temis_assinantes")).toHaveLength(0);

    expect((await portalAssinantes.POST(pedir("assinantes", "", "POST", pessoa("37")))).status).toBe(200);
    const [insert] = gravacoesEm(banco(), "temis_assinantes");
    expect(insert?.valores).toMatchObject({ criado_por_nome: AUTOR_DO_PORTAL, enterprise_id: "37" });
  });

  it("DELETE de outro dono: 404; do VOC: remove com quem removeu", async () => {
    expect((await portalAssinantes.DELETE(pedir("assinantes", `?id=${ASSINANTE_VOL}`, "DELETE"))).status).toBe(404);
    expect(gravacoesEm(banco(), "temis_assinantes")).toHaveLength(0);

    expect((await portalAssinantes.DELETE(pedir("assinantes", `?id=${ASSINANTE_VOC}`, "DELETE"))).status).toBe(200);
    expect(linha("temis_assinantes", ASSINANTE_VOC)).toMatchObject({ ativo: false, desativado_por_nome: AUTOR_DO_PORTAL });
  });
});

describe("FAIXAS pelo portal (somente leitura)", () => {
  it("GET de outro empreendimento: 404; do VOC: só as dele", async () => {
    expect((await portalFaixas.GET(pedir("faixas", "?enterpriseId=36"))).status).toBe(404);
    expect(consultouATabela("temis_faixas_de_prazo")).toBe(false);

    const r = await portalFaixas.GET(pedir("faixas", "?enterpriseId=37"));
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { data: { faixas: Array<{ id: string }> } };
    expect(corpo.data.faixas.map((f) => f.id)).toEqual(["f-voc"]);
  });

  it("POST, PATCH e DELETE: 404 até no próprio empreendimento, sem gravar nada", async () => {
    expect((await portalFaixas.POST(pedir("faixas", "?enterpriseId=37", "POST", {}))).status).toBe(404);
    expect((await portalFaixas.PATCH(pedir("faixas", "?id=f-voc", "PATCH", {}))).status).toBe(404);
    expect((await portalFaixas.DELETE(pedir("faixas", "?id=f-voc", "DELETE"))).status).toBe(404);
    expect(banco().consultas).toHaveLength(0);
  });
});

type CorpoDasCategorias = {
  data: {
    categorias: Array<{ id: string; ordemHerdada: null | { origem: string }; unidades: number }>;
    divergenciaDoEmpreendimento: null | string[];
  };
};

describe("CATEGORIAS pelo portal (somente leitura, recortada)", () => {
  it("GET de outro empreendimento: 404 sem ler as categorias", async () => {
    expect((await portalCategorias.GET(pedir("categorias", "?enterpriseId=36"))).status).toBe(404);
    expect(consultouATabela("temis_categorias")).toBe(false);
  });

  it("GET do VOC: a categoria do pai, contando só o lote do VOC e sem a ordem do VOL", async () => {
    const r = await portalCategorias.GET(pedir("categorias", "?enterpriseId=37"));
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as CorpoDasCategorias;
    expect(corpo.data.categorias).toHaveLength(1);
    expect(corpo.data.categorias[0]?.unidades).toBe(1);
    expect(corpo.data.categorias[0]?.ordemHerdada?.origem).toBe("padrao");
    // A leitura dos ajustes nem pediu o VOL.
    const ajustes = banco().consultas.find((c) => c.tabela === "apolo_enterprise_settings");
    expect(ajustes?.filtros).toEqual([["enterprise_id", "in", ["37"]]]);
  });

  it("o grupo com o código de OUTRO produto: 404 (o código não abre o JDG)", async () => {
    estado.porta = "conjunto";
    const r = await portalCategorias.GET(
      pedir("categorias", `?enterpriseId=${encodeURIComponent("group:Vale do Ouro")}&codigo=JDG`),
    );
    expect(r.status).toBe(404);
    expect(consultouATabela("temis_categorias")).toBe(false);
  });

  it("o dono do conjunto pelo grupo: todos os lotes do conjunto (o espelho não conta duas vezes)", async () => {
    estado.porta = "conjunto";
    const r = await portalCategorias.GET(
      pedir("categorias", `?enterpriseId=${encodeURIComponent("group:Vale do Ouro")}&codigo=VOL`),
    );
    expect(r.status).toBe(200);
    expect(((await r.json()) as CorpoDasCategorias).data.categorias[0]?.unidades).toBe(2);
  });

  it("POST, PATCH e DELETE: 404 sem gravar nada", async () => {
    expect((await portalCategorias.POST(pedir("categorias", "?enterpriseId=37", "POST", { nome: "X" }))).status).toBe(404);
    expect((await portalCategorias.PATCH(pedir("categorias", `?enterpriseId=37&id=${CATEGORIA}`, "PATCH", { nome: "X" }))).status).toBe(404);
    expect((await portalCategorias.DELETE(pedir("categorias", `?enterpriseId=37&id=${CATEGORIA}`, "DELETE"))).status).toBe(404);
    expect(banco().consultas).toHaveLength(0);
  });
});

describe("UNIDADES DA CATEGORIA pelo portal (somente leitura, recortada)", () => {
  it("GET de outro empreendimento: 404 sem ler as unidades", async () => {
    expect((await portalUnidades.GET(pedir("categorias/unidades", "?enterpriseId=36"))).status).toBe(404);
    expect(consultouATabela("hercules_unidades")).toBe(false);
  });

  it("GET do VOC: só o lote do VOC (nem o VOL, nem a linha do pai)", async () => {
    const r = await portalUnidades.GET(pedir("categorias/unidades", "?enterpriseId=37"));
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { data: { unidades: Array<{ id: string }> } };
    expect(corpo.data.unidades.map((u) => u.id)).toEqual([UNIDADE_VOC]);
  });

  it("PATCH (vincular): 404 sem gravar nada", async () => {
    const r = await portalUnidades.PATCH(
      pedir("categorias/unidades", "", "PATCH", { categoriaId: CATEGORIA, unidadeIds: [UNIDADE_VOC] }),
    );
    expect(r.status).toBe(404);
    expect(banco().consultas).toHaveLength(0);
  });
});

describe("O HUB NÃO MUDA", () => {
  it("anexos: registra sem conferir a pasta contra o alcance, como antes", async () => {
    const r = await hubAnexos.POST(
      hub("anexos", "", "POST", {
        acao: "confirmar",
        enterpriseId: "37",
        nome: "Memorial",
        path: "temis-anexos/empreendimento/36/uuid-b.pdf",
        posicao: 3,
      }),
    );
    expect(r.status).toBe(200);
  });

  it("assinantes: remove de qualquer empreendimento, sem consulta de alcance", async () => {
    expect((await hubAssinantes.DELETE(hub("assinantes", `?id=${ASSINANTE_VOL}`, "DELETE"))).status).toBe(200);
    expect(banco().consultas.map((c) => `${c.tabela}:${c.tipo}`)).toEqual(["temis_assinantes:update"]);
  });

  it("faixas: grava", async () => {
    const r = await hubFaixas.POST(
      hub("faixas", "?enterpriseId=36", "POST", {
        defineEntrada: false,
        defineIndice: false,
        defineJuros: false,
        entradaPercentual: null,
        indiceCorrecao: null,
        jurosConvencao: "equivalente",
        jurosPeriodicidade: "mensal",
        jurosTaxa: null,
        observacao: null,
        parcelaMaxima: 12,
        parcelaMinima: 1,
      }),
    );
    expect(r.status).toBe(200);
    expect(gravacoesEm(banco(), "temis_faixas_de_prazo")).toHaveLength(1);
  });

  it("categorias: conta os lotes de todas as divisões e vê a herança do VOL", async () => {
    const r = await hubCategorias.GET(hub("categorias", "?enterpriseId=37"));
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as CorpoDasCategorias;
    expect(corpo.data.categorias[0]?.unidades).toBe(2);
    expect(corpo.data.categorias[0]?.ordemHerdada?.origem).toBe("empreendimento");
  });

  it("unidades da categoria: a família inteira, um terreno por linha", async () => {
    const r = await hubUnidades.GET(hub("categorias/unidades", "?enterpriseId=37"));
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { data: { unidades: Array<{ id: string }> } };
    expect(corpo.data.unidades.map((u) => u.id).sort()).toEqual([UNIDADE_VOC, UNIDADE_VOL].sort());
  });
});

// ── 5. ESCRITA SÓ NO QUE O PORTAL OPERA ─────────────────────────────────────────────────────

describe("escrita só no produto que o portal opera (decisão do Lucas, 16/09/2026)", () => {
  const SO_CONSULTA = {
    error: "Este produto está disponível só para consulta no seu portal.",
    soConsulta: true,
  };

  beforeEach(() => {
    estado.produtos = [...PRODUTOS_DE_16_DE_SETEMBRO];
  });

  it("ler o VOC continua: anexos e quadro abrem sem perguntar quem opera", async () => {
    expect((await portalAnexos.GET(pedir("anexos", "?enterpriseId=37"))).status).toBe(200);
    expect((await portalAssinantes.GET(pedir("assinantes", "?enterpriseId=37"))).status).toBe(200);
    expect(estado.leiturasDoCadastro).toBe(0);
  });

  it("anexos no VOC: subir, registrar, trocar a capa e desativar respondem 403 sem tocar em nada", async () => {
    const subir = await portalAnexos.POST(
      pedir("anexos", "", "POST", { acao: "upload", contentType: "application/pdf", enterpriseId: "37", fileName: "a.pdf", size: 10 }),
    );
    expect(subir.status).toBe(403);
    expect(await subir.json()).toEqual(SO_CONSULTA);

    const registrar = await portalAnexos.POST(
      pedir("anexos", "", "POST", {
        acao: "confirmar",
        enterpriseId: "37",
        nome: "Planta",
        path: "temis-anexos/empreendimento/37/uuid-planta.pdf",
        posicao: 3,
      }),
    );
    expect(registrar.status).toBe(403);

    // A capa confere pelo empreendimento DA MINUTA (a do VOC), e não pelo id que vem no corpo.
    const capa = await portalAnexos.POST(
      pedir("anexos", "", "POST", {
        acao: "upload",
        capa: true,
        contentType: "application/pdf",
        enterpriseId: MINUTA_VOC,
        fileName: "capa.pdf",
        size: 10,
      }),
    );
    expect(capa.status).toBe(403);
    const trocarCapa = await portalAnexos.POST(
      pedir("anexos", "", "POST", { acao: "capa", minutaId: MINUTA_VOC, path: "" }),
    );
    expect(trocarCapa.status).toBe(403);

    expect((await portalAnexos.DELETE(pedir("anexos", `?id=${ANEXO_VOC}`, "DELETE"))).status).toBe(403);

    expect(banco().storage.signedUpload).toHaveLength(0);
    expect(banco().storage.info).toHaveLength(0);
    expect(gravacoesEm(banco(), "temis_anexos")).toHaveLength(0);
    expect(gravacoesEm(banco(), "temis_minutas")).toHaveLength(0);
  });

  it("quadro de assinatura do VOC: incluir e remover respondem 403 sem gravar", async () => {
    const incluir = await portalAssinantes.POST(
      pedir("assinantes", "", "POST", {
        email: "joana@exemplo.com",
        enterpriseId: "37",
        nome: "Joana Testemunha",
        papel: "testemunha",
        posicao: 2,
      }),
    );
    expect(incluir.status).toBe(403);
    expect(
      (await portalAssinantes.DELETE(pedir("assinantes", `?id=${ASSINANTE_VOC}`, "DELETE"))).status,
    ).toBe(403);
    expect(gravacoesEm(banco(), "temis_assinantes")).toHaveLength(0);
  });

  it("de outro dono continua 404 (e não 403): a régua de operação não confirma o que não é dele", async () => {
    expect((await portalAnexos.DELETE(pedir("anexos", `?id=${ANEXO_VOL}`, "DELETE"))).status).toBe(404);
  });

  it("no Garden, operado pela Cecílio: sobe anexo e inclui assinante", async () => {
    const subir = await portalAnexos.POST(
      pedir("anexos", "", "POST", { acao: "upload", contentType: "application/pdf", enterpriseId: "39", fileName: "a.pdf", size: 10 }),
    );
    expect(subir.status).toBe(200);

    const incluir = await portalAssinantes.POST(
      pedir("assinantes", "", "POST", {
        email: "joana@exemplo.com",
        enterpriseId: "39",
        nome: "Joana Testemunha",
        papel: "testemunha",
        posicao: 2,
      }),
    );
    expect(incluir.status).toBe(200);
  });

  it("o hub grava no VOC como sempre, sem ler o cadastro", async () => {
    expect((await hubAssinantes.DELETE(hub("assinantes", `?id=${ASSINANTE_VOC}`, "DELETE"))).status).toBe(200);
    expect(estado.leiturasDoCadastro).toBe(0);
  });
});

// ── 6. A CATEGORIA DO PAI NO PORTAL ─────────────────────────────────────────────────────────

describe("categorias do pai no portal: só as que são do alcance (revisão da onda 3, achado 5)", () => {
  const SO_DO_VOL = "45454545-4545-4545-8545-454545454545";
  const NOVA = "46464646-4646-4646-8646-464646464646";
  const ANEXO_SO_DO_VOL = "89898989-8989-4989-8989-898989898989";

  beforeEach(() => {
    const t = banco().tabelas;
    t.temis_categorias?.push(
      // Criada só para os lotes do Lino.
      { assinatura_ordem: null, assinatura_ordenada: false, categoria_pai_id: null, enterprise_id: "35", id: SO_DO_VOL, nome: "VOL Chácaras", ordem: 1, workspace_id: "careli" },
      // Recém-criada, sem lote nenhum ainda.
      { assinatura_ordem: null, assinatura_ordenada: false, categoria_pai_id: null, enterprise_id: "35", id: NOVA, nome: "Nova", ordem: 2, workspace_id: "careli" },
    );
    t.hercules_unidades?.push(
      unidade("68686868-6868-4868-8868-686868686868", "36", "3", { categoria_id: SO_DO_VOL }),
    );
    t.temis_anexos?.push({
      ativo: true,
      categoria_id: SO_DO_VOL,
      enterprise_id: null,
      id: ANEXO_SO_DO_VOL,
      nome: "Memorial VOL",
      posicao: 1,
      storage_path: `temis-anexos/categoria/${SO_DO_VOL}/v.pdf`,
      unidade_id: null,
      workspace_id: "careli",
    });
  });

  it("a lista do VOC não traz a categoria só do VOL, nem o nome dela", async () => {
    const r = await portalCategorias.GET(pedir("categorias", "?enterpriseId=37"));
    expect(r.status).toBe(200);
    const texto = JSON.stringify(await r.json());
    expect(texto).not.toContain("VOL Chácaras");
    const corpo = JSON.parse(texto) as CorpoDasCategorias;
    expect(corpo.data.categorias.map((c) => c.id).sort()).toEqual([CATEGORIA, NOVA].sort());
  });

  it("os anexos da categoria só do VOL: 404 sem ler os anexos; os da categoria do VOC abrem", async () => {
    const fora = await portalAnexos.GET(pedir("anexos", `?categoriaId=${SO_DO_VOL}`));
    expect(fora.status).toBe(404);
    expect(consultouATabela("temis_anexos")).toBe(false);

    expect((await portalAnexos.GET(pedir("anexos", `?categoriaId=${CATEGORIA}`))).status).toBe(200);
    expect((await portalAnexos.GET(pedir("anexos", `?categoriaId=${NOVA}`))).status).toBe(200);
  });

  it("o caminho do arquivo não sai para o portal; o hub continua recebendo", async () => {
    const doPortal = (await (await portalAnexos.GET(pedir("anexos", "?enterpriseId=37"))).json()) as {
      anexos: Array<Record<string, unknown>>;
    };
    expect(doPortal.anexos).toHaveLength(1);
    expect(doPortal.anexos[0]).not.toHaveProperty("storagePath");

    const doHub = (await (await hubAnexos.GET(hub("anexos", "?enterpriseId=37"))).json()) as {
      anexos: Array<Record<string, unknown>>;
    };
    expect(doHub.anexos[0]?.storagePath).toBe("temis-anexos/empreendimento/37/a.pdf");
  });

  it("o hub vê todas as categorias do pai", async () => {
    const corpo = (await (await hubCategorias.GET(hub("categorias", "?enterpriseId=37"))).json()) as CorpoDasCategorias;
    expect(corpo.data.categorias.map((c) => c.id).sort()).toEqual([CATEGORIA, NOVA, SO_DO_VOL].sort());
  });
});

// ── 7. O PRÉDIO NO VÍNCULO ──────────────────────────────────────────────────────────────────

describe("vincular apartamentos a categoria (onda 2, achado 28)", () => {
  const APTO_101 = "a1a1a1a1-0101-4101-8101-a1a1a1a1a1a1";
  const APTO_102 = "a1a1a1a1-0102-4102-8102-a1a1a1a1a1a1";
  const LOTE_SEM_CHAVE = "b2b2b2b2-0000-4000-8000-b2b2b2b2b2b2";

  const apto = (id: string, numero: string) => ({
    apartamento: numero,
    categoria_id: null,
    codigo: `JAD-A-${numero}`,
    enterprise_id: "100001",
    espelho_de: null,
    id,
    lote: null,
    quadra: null,
    situacao: "disponivel",
    torre: "A",
    workspace_id: "careli",
  });

  beforeEach(() => {
    const t = banco().tabelas;
    t.hercules_empreendimentos?.push({ c2x_enterprise_id: "100001", codigo: "JAD", id: "h-jad", nome: "Ed. Jade", pai_id: null, workspace_id: "careli" });
    t.hercules_unidades?.push(apto(APTO_101, "101"), apto(APTO_102, "102"), {
      ...unidade(LOTE_SEM_CHAVE, "20", "0", { categoria_id: null }),
      lote: null,
      quadra: null,
    });
  });

  it("escolher um apartamento carimba só ele, e não o prédio inteiro", async () => {
    const r = await hubUnidades.PATCH(
      hub("categorias/unidades", "", "PATCH", { categoriaId: CATEGORIA, unidadeIds: [APTO_101] }),
    );
    expect(r.status).toBe(200);
    expect(((await r.json()) as { data: { gravadas: number; terrenos: number } }).data).toMatchObject({
      gravadas: 1,
      terrenos: 1,
    });
    expect(linha("hercules_unidades", APTO_101)?.categoria_id).toBe(CATEGORIA);
    expect(linha("hercules_unidades", APTO_102)?.categoria_id).toBeNull();
  });

  it("a trava de 'sem quadra e sem lote' continua valendo para o loteamento", async () => {
    const r = await hubUnidades.PATCH(
      hub("categorias/unidades", "", "PATCH", { categoriaId: CATEGORIA, unidadeIds: [LOTE_SEM_CHAVE] }),
    );
    expect(r.status).toBe(409);
    expect(gravacoesEm(banco(), "hercules_unidades")).toHaveLength(0);
  });

  it("a lista para vincular traz um apartamento por linha, com torre e número", async () => {
    const r = await hubUnidades.GET(hub("categorias/unidades", "?enterpriseId=100001"));
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as {
      data: { unidades: Array<{ apartamento: string; id: string; torre: string }> };
    };
    expect(corpo.data.unidades.map((u) => u.id).sort()).toEqual([APTO_101, APTO_102].sort());
    expect(corpo.data.unidades.find((u) => u.id === APTO_101)).toMatchObject({
      apartamento: "101",
      torre: "A",
    });
  });
});
