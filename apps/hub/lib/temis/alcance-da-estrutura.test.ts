import { beforeEach, describe, expect, it, vi } from "vitest";

import type { createApoloAdminClient } from "@/lib/apolo/server";

import {
  alcanceDaCategoria,
  alcanceDaMinuta,
  alcanceDaUnidade,
  alcanceDoAlvo,
  alcanceDoAnexo,
  alcanceDoAssinante,
  alcanceDoEmpreendimento,
  alcanceParaEscrever,
  alcanceParaEscreverNosEmpreendimentos,
  paiNoAlcance,
  respostaDoAlcance,
  somenteLeituraNoPortal,
} from "./alcance-da-estrutura";
import type { AtorDoHub, AtorDoPortal } from "./ator";
import {
  INCORPORADOR_DA_CECILIO,
  PRODUTOS_DE_16_DE_SETEMBRO,
  type ProdutoDoTeste,
  TUDO_DA_CECILIO,
} from "./fixtures/produtos-operados";
import { clienteEmMemoria, type EstadoDoBanco, novoEstado } from "./fixtures/supabase-em-memoria";

// O ALCANCE DAS PEÇAS DO MODELO — o caminho de SEGURANÇA de minuta, anexo, assinante e categoria.
//
// O que está travado aqui:
//   · o hub responde "dentro" SEM CONSULTA nenhuma (a Têmis da Careli faz as mesmas idas ao banco);
//   · a divisão da sessão é "dentro" direto; a divisão de outro dono é "fora";
//   · o PAI (VLO, 35) só é "dentro" com TODOS os filhos (VOC, VOL, VOR); com um filho, só na leitura
//     parcial (a categoria);
//   · o grupo (`group:`) sem o grupo na sessão é "fora", sem consulta;
//   · uuid torto é "fora" (22P02), e falha de leitura é "falha" (503), nunca "fora" nem "dentro";
//   · o anexo pedido em vários níveis só passa se TODOS forem do ator.
//
// Cadastro medido em 16/09/2026: VLO = 35 (pai), VOC = 37, VOL = 36, VOR = 41; Garden = 39. A
// Cecílio tem 37 e 39.

vi.mock("@/lib/guardian/db", () => ({ getHadesDbPool: () => ({ ok: false }) }));

// ⚠️ SÓ A LEITURA DO CADASTRO É TROCADA. A régua de quem opera o produto (`escritaNoProduto`) é a de
// verdade: o teste prova a regra que roda em produção. Padrão: tudo da Cecílio (o cenário dos testes
// de escopo, escritos antes da régua); os testes da escrita trocam para o cadastro de 16/09/2026.
const cadastro = vi.hoisted(() => ({
  com0170: true,
  falha: false,
  leituras: 0,
  produtos: [] as ProdutoDoTeste[],
}));

vi.mock("@/lib/hercules/cadastro", async (importOriginal) => {
  const { cadastroDosProdutos } = await import("./fixtures/produtos-operados");
  return {
    ...(await importOriginal<typeof import("@/lib/hercules/cadastro")>()),
    lerCadastroDeEmpreendimentos: async () => {
      cadastro.leituras += 1;
      if (cadastro.falha) throw new Error("cadastro fora do ar");
      return { com0170: cadastro.com0170, linhas: cadastroDosProdutos(cadastro.produtos) };
    },
  };
});

type Admin = NonNullable<ReturnType<typeof createApoloAdminClient>>;

const HUB: AtorDoHub = { nome: "Jurídico", papel: "escrita", tipo: "hub", userId: "user-1" };
const CECILIO: AtorDoPortal = {
  enterpriseIds: ["37", "39"],
  incorporadorId: "0f6d2c1e-3b4a-4c5d-8e9f-a1b2c3d4e5f6",
  nome: "Maria",
  slug: "cecilio-rocha",
  tipo: "portal",
  usuarioId: "usuario-portal-1",
};
const DONO_DO_CONJUNTO: AtorDoPortal = {
  ...CECILIO,
  enterpriseIds: ["group:Vale do Ouro", "37", "36", "41"],
};

const MINUTA_VOC = "11111111-1111-4111-8111-111111111111";
const MINUTA_VOL = "22222222-2222-4222-8222-222222222222";
const MINUTA_VLO = "33333333-3333-4333-8333-333333333333";
const CATEGORIA_VLO = "44444444-4444-4444-8444-444444444444";
const UNIDADE_VOC = "55555555-5555-4555-8555-555555555555";
const UNIDADE_VOL = "66666666-6666-4666-8666-666666666666";
const ANEXO_VOC = "77777777-7777-4777-8777-777777777777";
const ANEXO_CATEGORIA = "88888888-8888-4888-8888-888888888888";
const ASSINANTE_VOL = "99999999-9999-4999-8999-999999999999";

let estado: EstadoDoBanco;
let admin: Admin;

beforeEach(() => {
  cadastro.com0170 = true;
  cadastro.falha = false;
  cadastro.leituras = 0;
  cadastro.produtos = [...TUDO_DA_CECILIO];
  estado = novoEstado();
  estado.tabelas = {
    hercules_empreendimentos: [
      { c2x_enterprise_id: "35", codigo: "VLO", id: "h-vlo", pai_id: null, workspace_id: "careli" },
      { c2x_enterprise_id: "37", codigo: "VOC", id: "h-voc", pai_id: "h-vlo", workspace_id: "careli" },
      { c2x_enterprise_id: "36", codigo: "VOL", id: "h-vol", pai_id: "h-vlo", workspace_id: "careli" },
      { c2x_enterprise_id: "41", codigo: "VOR", id: "h-vor", pai_id: "h-vlo", workspace_id: "careli" },
      { c2x_enterprise_id: "39", codigo: "GDN", id: "h-gdn", pai_id: null, workspace_id: "careli" },
    ],
    hercules_unidades: [
      { enterprise_id: "37", id: UNIDADE_VOC, workspace_id: "careli" },
      { enterprise_id: "36", id: UNIDADE_VOL, workspace_id: "careli" },
    ],
    temis_anexos: [
      { categoria_id: null, enterprise_id: "37", id: ANEXO_VOC, unidade_id: null, workspace_id: "careli" },
      {
        categoria_id: CATEGORIA_VLO,
        enterprise_id: null,
        id: ANEXO_CATEGORIA,
        unidade_id: null,
        workspace_id: "careli",
      },
    ],
    temis_assinantes: [{ enterprise_id: "36", id: ASSINANTE_VOL, workspace_id: "careli" }],
    temis_categorias: [{ enterprise_id: "35", id: CATEGORIA_VLO, workspace_id: "careli" }],
    temis_minutas: [
      { enterprise_id: "37", id: MINUTA_VOC, workspace_id: "careli" },
      { enterprise_id: "36", id: MINUTA_VOL, workspace_id: "careli" },
      { enterprise_id: "35", id: MINUTA_VLO, workspace_id: "careli" },
    ],
  };
  admin = clienteEmMemoria(estado) as unknown as Admin;
});

describe("paiNoAlcance (a regra pura do consolidado)", () => {
  it("inteiro exige todos os filhos; parcial aceita um", () => {
    expect(paiNoAlcance(CECILIO, ["37", "36", "41"], "inteiro")).toBe(false);
    expect(paiNoAlcance(CECILIO, ["37", "36", "41"], "parcial")).toBe(true);
    expect(paiNoAlcance(DONO_DO_CONJUNTO, ["37", "36", "41"], "inteiro")).toBe(true);
  });

  it("sem filhos, ou com filho sem id, não é 'todos'", () => {
    expect(paiNoAlcance(DONO_DO_CONJUNTO, [], "inteiro")).toBe(false);
    expect(paiNoAlcance(DONO_DO_CONJUNTO, ["37", "36", "41", null], "inteiro")).toBe(false);
    expect(paiNoAlcance(CECILIO, [null, ""], "parcial")).toBe(false);
  });

  it("hub: sempre", () => {
    expect(paiNoAlcance(HUB, [], "inteiro")).toBe(true);
  });
});

describe("alcanceDoEmpreendimento", () => {
  it("hub: dentro, sem consulta nenhuma", async () => {
    expect(await alcanceDoEmpreendimento(admin, HUB, "36")).toBe("dentro");
    expect(await alcanceDoEmpreendimento(admin, HUB, "")).toBe("dentro");
    expect(estado.consultas).toHaveLength(0);
  });

  it("a divisão da sessão é dentro sem consulta; número vira texto", async () => {
    expect(await alcanceDoEmpreendimento(admin, CECILIO, "37")).toBe("dentro");
    expect(await alcanceDoEmpreendimento(admin, CECILIO, 39)).toBe("dentro");
    expect(estado.consultas).toHaveLength(0);
  });

  it("a divisão de outro dono é fora", async () => {
    expect(await alcanceDoEmpreendimento(admin, CECILIO, "36")).toBe("fora");
  });

  it("o PAI com um filho só: fora para gravar e ler minuta, dentro para a leitura parcial", async () => {
    expect(await alcanceDoEmpreendimento(admin, CECILIO, "35")).toBe("fora");
    expect(await alcanceDoEmpreendimento(admin, CECILIO, "35", "parcial")).toBe("dentro");
  });

  it("o PAI com todos os filhos: dentro", async () => {
    expect(await alcanceDoEmpreendimento(admin, DONO_DO_CONJUNTO, "35")).toBe("dentro");
  });

  it("grupo fora da sessão é fora SEM consulta; vazio também", async () => {
    expect(await alcanceDoEmpreendimento(admin, CECILIO, "group:Vale do Ouro", "parcial")).toBe("fora");
    expect(await alcanceDoEmpreendimento(admin, CECILIO, "  ")).toBe("fora");
    expect(estado.consultas).toHaveLength(0);
    expect(await alcanceDoEmpreendimento(admin, DONO_DO_CONJUNTO, "group:Vale do Ouro")).toBe("dentro");
  });

  it("produto sem filhos (Garden visto de fora) e id desconhecido: fora", async () => {
    expect(await alcanceDoEmpreendimento(admin, { ...CECILIO, enterpriseIds: ["37"] }, "39")).toBe("fora");
    expect(await alcanceDoEmpreendimento(admin, CECILIO, "9999")).toBe("fora");
  });

  it("falha ao ler o cadastro do pai não abre nada", async () => {
    estado.erros.hercules_empreendimentos = { code: "57014", message: "timeout" };
    expect(await alcanceDoEmpreendimento(admin, DONO_DO_CONJUNTO, "35")).toBe("fora");
  });
});

describe("alcance por id (minuta, categoria, unidade, anexo, assinante)", () => {
  it("hub: dentro sem consulta, até para id torto", async () => {
    expect(await alcanceDaMinuta(admin, HUB, MINUTA_VOL)).toBe("dentro");
    expect(await alcanceDoAnexo(admin, HUB, "torto")).toBe("dentro");
    expect(await alcanceDoAssinante(admin, HUB, ASSINANTE_VOL)).toBe("dentro");
    expect(estado.consultas).toHaveLength(0);
  });

  it("minuta: a do VOC é dentro; a do VOL e a do consolidado são fora", async () => {
    expect(await alcanceDaMinuta(admin, CECILIO, MINUTA_VOC)).toBe("dentro");
    expect(await alcanceDaMinuta(admin, CECILIO, MINUTA_VOL)).toBe("fora");
    expect(await alcanceDaMinuta(admin, CECILIO, MINUTA_VLO)).toBe("fora");
    expect(await alcanceDaMinuta(admin, DONO_DO_CONJUNTO, MINUTA_VLO)).toBe("dentro");
  });

  it("minuta inexistente, id torto e vazio: fora (igual à de outro dono)", async () => {
    expect(await alcanceDaMinuta(admin, CECILIO, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toBe("fora");
    expect(await alcanceDaMinuta(admin, CECILIO, "../../outra")).toBe("fora");
    expect(await alcanceDaMinuta(admin, CECILIO, "")).toBe("fora");
  });

  it("falha de leitura da minuta é falha, não fora", async () => {
    estado.erros.temis_minutas = { code: "57014", message: "timeout" };
    expect(await alcanceDaMinuta(admin, CECILIO, MINUTA_VOC)).toBe("falha");
  });

  it("categoria do pai: parcial lê, inteiro não grava (com um filho só)", async () => {
    expect(await alcanceDaCategoria(admin, CECILIO, CATEGORIA_VLO, "parcial")).toBe("dentro");
    expect(await alcanceDaCategoria(admin, CECILIO, CATEGORIA_VLO, "inteiro")).toBe("fora");
    expect(await alcanceDaCategoria(admin, DONO_DO_CONJUNTO, CATEGORIA_VLO, "inteiro")).toBe("dentro");
  });

  it("unidade: pela divisão dela", async () => {
    expect(await alcanceDaUnidade(admin, CECILIO, UNIDADE_VOC)).toBe("dentro");
    expect(await alcanceDaUnidade(admin, CECILIO, UNIDADE_VOL)).toBe("fora");
  });

  it("anexo gravado: pelo alcance que a linha guarda (desativar é escrita)", async () => {
    expect(await alcanceDoAnexo(admin, CECILIO, ANEXO_VOC)).toBe("dentro");
    expect(await alcanceDoAnexo(admin, CECILIO, ANEXO_CATEGORIA)).toBe("fora");
    expect(await alcanceDoAnexo(admin, DONO_DO_CONJUNTO, ANEXO_CATEGORIA)).toBe("dentro");
  });

  it("assinante de outro dono: fora", async () => {
    expect(await alcanceDoAssinante(admin, CECILIO, ASSINANTE_VOL)).toBe("fora");
  });
});

describe("alcanceDoAlvo (o anexo pedido em vários níveis)", () => {
  it("todos os níveis do ator: dentro", async () => {
    expect(
      await alcanceDoAlvo(
        admin,
        CECILIO,
        { categoriaId: CATEGORIA_VLO, enterpriseId: "37", unidadeId: UNIDADE_VOC },
        "parcial",
      ),
    ).toBe("dentro");
  });

  it("um nível de outro dono derruba o pedido inteiro", async () => {
    expect(
      await alcanceDoAlvo(admin, CECILIO, { enterpriseId: "37", unidadeId: UNIDADE_VOL }, "parcial"),
    ).toBe("fora");
  });

  it("o empreendimento do anexo nunca lê pelo filho: o pai com um filho só é fora", async () => {
    expect(await alcanceDoAlvo(admin, CECILIO, { enterpriseId: "35" }, "parcial")).toBe("fora");
  });

  it("um filtro forjado para o `.or()` não casa com id nenhum", async () => {
    expect(
      await alcanceDoAlvo(admin, CECILIO, { enterpriseId: "37,categoria_id.not.is.null" }, "parcial"),
    ).toBe("fora");
  });

  it("sem nível nenhum: fora", async () => {
    expect(await alcanceDoAlvo(admin, CECILIO, {}, "parcial")).toBe("fora");
  });
});

// ── A ESCRITA: SÓ NO QUE O PORTAL OPERA (decisão do Lucas, 16/09/2026) ─────────────────────
//
// O VOC (37) está no escopo da Cecílio e é da Careli: ela lê e não escreve. O Garden (39) é dela.

describe("alcanceParaEscrever (a régua de quem opera o produto)", () => {
  beforeEach(() => {
    cadastro.produtos = [...PRODUTOS_DE_16_DE_SETEMBRO];
    estado.tabelas.temis_minutas?.push({
      enterprise_id: "39",
      id: "12121212-1212-4212-8212-121212121212",
      workspace_id: "careli",
    });
  });

  it("hub: dentro sem consulta nenhuma, nem ao cadastro", async () => {
    expect(await alcanceParaEscrever(admin, HUB, "37")).toBe("dentro");
    expect(await alcanceDaMinuta(admin, HUB, MINUTA_VOC, "escrever")).toBe("dentro");
    expect(estado.consultas).toHaveLength(0);
    expect(cadastro.leituras).toBe(0);
  });

  it("VOC no escopo e operado pela Careli: só consulta; Garden da Cecílio: dentro", async () => {
    expect(await alcanceParaEscrever(admin, CECILIO, "37")).toBe("so-consulta");
    expect(await alcanceParaEscrever(admin, CECILIO, 39)).toBe("dentro");
  });

  it("ler continua pelo escopo: a minuta do VOC abre, e só a escrita é recusada", async () => {
    expect(await alcanceDaMinuta(admin, CECILIO, MINUTA_VOC)).toBe("dentro");
    expect(await alcanceDaMinuta(admin, CECILIO, MINUTA_VOC, "escrever")).toBe("so-consulta");
    expect(
      await alcanceDaMinuta(admin, CECILIO, "12121212-1212-4212-8212-121212121212", "escrever"),
    ).toBe("dentro");
  });

  it("fora do escopo continua 404 e nem pergunta ao cadastro quem opera", async () => {
    expect(await alcanceParaEscrever(admin, CECILIO, "36")).toBe("fora");
    expect(await alcanceDaMinuta(admin, CECILIO, MINUTA_VOL, "escrever")).toBe("fora");
    expect(cadastro.leituras).toBe(0);
  });

  it("o PAI decide pelos FILHOS: um filho só consulta basta para recusar", async () => {
    // O dono do conjunto tem as três divisões no escopo; todas da Careli.
    expect(await alcanceParaEscrever(admin, DONO_DO_CONJUNTO, "35")).toBe("so-consulta");

    // Duas da Cecílio e uma da Careli: ainda só consulta.
    cadastro.produtos = PRODUTOS_DE_16_DE_SETEMBRO.map((p) =>
      p.c2x === "37" || p.c2x === "36" ? { ...p, operadoPor: INCORPORADOR_DA_CECILIO } : p,
    );
    expect(await alcanceParaEscrever(admin, DONO_DO_CONJUNTO, "35")).toBe("so-consulta");

    // As três da Cecílio: dentro, mesmo com o pai sem dono gravado (quem decide são os filhos).
    cadastro.produtos = PRODUTOS_DE_16_DE_SETEMBRO.map((p) =>
      p.pai === "35" ? { ...p, operadoPor: INCORPORADOR_DA_CECILIO } : p,
    );
    expect(await alcanceParaEscrever(admin, DONO_DO_CONJUNTO, "35")).toBe("dentro");
  });

  it("fail-closed: sem a 0170 ou com o cadastro fora do ar é falha (503), nunca dentro", async () => {
    cadastro.com0170 = false;
    expect(await alcanceParaEscrever(admin, CECILIO, "39")).toBe("falha");

    cadastro.com0170 = true;
    cadastro.falha = true;
    const silencio = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await alcanceParaEscrever(admin, CECILIO, "39")).toBe("falha");
    silencio.mockRestore();
  });

  it("produto sem dono no cadastro, ou fora dele: só consulta", async () => {
    cadastro.produtos = PRODUTOS_DE_16_DE_SETEMBRO.filter((p) => p.c2x !== "39");
    expect(await alcanceParaEscrever(admin, CECILIO, "39")).toBe("so-consulta");
  });

  it("vários empreendimentos: um só consulta recusa todos; lista vazia é fora", async () => {
    expect(await alcanceParaEscreverNosEmpreendimentos(admin, CECILIO, ["39", "37"])).toBe(
      "so-consulta",
    );
    expect(await alcanceParaEscreverNosEmpreendimentos(admin, CECILIO, ["39", " 39 "])).toBe(
      "dentro",
    );
    expect(await alcanceParaEscreverNosEmpreendimentos(admin, CECILIO, ["", null])).toBe("fora");
  });

  it("anexo e assinante são escrita: o do VOC é só consulta", async () => {
    expect(await alcanceDoAnexo(admin, CECILIO, ANEXO_VOC)).toBe("so-consulta");
    estado.tabelas.temis_assinantes?.push({
      enterprise_id: "37",
      id: "13131313-1313-4313-8313-131313131313",
      workspace_id: "careli",
    });
    expect(await alcanceDoAssinante(admin, CECILIO, "13131313-1313-4313-8313-131313131313")).toBe(
      "so-consulta",
    );
  });

  it("alcanceDoAlvo para escrever: o nível de outro dono (404) vence o só consulta", async () => {
    expect(
      await alcanceDoAlvo(
        admin,
        CECILIO,
        { enterpriseId: "37" },
        "inteiro",
        "escrever",
      ),
    ).toBe("so-consulta");
    expect(
      await alcanceDoAlvo(admin, CECILIO, { enterpriseId: "37", unidadeId: UNIDADE_VOL }, "inteiro", "escrever"),
    ).toBe("fora");
  });
});

describe("as respostas", () => {
  it("dentro segue; fora é 404 sem dizer por quê; falha é 503", async () => {
    expect(respostaDoAlcance("dentro")).toBe(null);

    const fora = respostaDoAlcance("fora");
    expect(fora?.status).toBe(404);
    expect(await fora?.json()).toEqual({ error: "Nao encontrado." });

    expect(respostaDoAlcance("falha")?.status).toBe(503);
  });

  it("só consulta é 403 com a frase da régua e `soConsulta: true`", async () => {
    const resposta = respostaDoAlcance("so-consulta");
    expect(resposta?.status).toBe(403);
    expect(await resposta?.json()).toEqual({
      error: "Este produto está disponível só para consulta no seu portal.",
      soConsulta: true,
    });
  });

  it("somente leitura: 404 para o portal, nada para o hub", () => {
    expect(somenteLeituraNoPortal(CECILIO)?.status).toBe(404);
    expect(somenteLeituraNoPortal(HUB)).toBe(null);
  });
});
