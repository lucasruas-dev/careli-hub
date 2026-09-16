import { beforeEach, describe, expect, it, vi } from "vitest";

// AS FOTOS E OS VÍDEOS DO PRODUTO PELO PORTAL: quem pode ENVIAR e REMOVER (D1, 16/09/2026).
//
// O que se trava aqui é a PORTA, com o escopo e a régua de verdade:
//   • no portal que opera sozinho (a Cecílio), o botão só acende e o POST/DELETE só gravam no produto
//     que ela opera (`operado_por`): o Garden sim, o VOC (da Careli) não, com 403 "só consulta";
//   • o comercial (a Gurgel) continua como era, sem ida ao banco para a régua;
//   • sem a 0170, ninguém do portal que opera sozinho grava (503), e o botão fica apagado;
//   • portal padrão (cer) não tem a porta de escrita (404).
// As leituras e gravações do Storage têm teste próprio (lib/apolo/arquivos-do-produto-servidor.test.ts)
// e aqui são espiões; a resolução do produto (`resolverProdutoDoPedido`) é a de verdade.

const estado = vi.hoisted(() => ({
  com0170: true,
  revalidacoes: 0,
}));

vi.mock("@/lib/apolo/catalogo-empreendimentos", () => ({
  catalogoDeEmpreendimentos: async () => [
    { codes: ["VOC"], id: "37", name: "VALE DO OURO", stageIds: ["37"] },
    { codes: ["GDN"], id: "39", name: "GARDEN", stageIds: ["39"] },
  ],
}));

vi.mock("@/lib/hercules/cadastro", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/hercules/cadastro")>();
  const linha = (c2x: string, codigo: string, operadoPor: null | string) => ({
    c2xEnterpriseId: c2x,
    cidade: null,
    codigo,
    id: codigo.toLowerCase(),
    nome: codigo,
    operadoPor,
    ordem: 0,
    paiId: null,
    tipoProduto: "loteamento" as const,
    uf: null,
    vendendo: true,
  });
  const linhas = () => [
    // O VOC é da Careli; o Garden é da Cecílio. Sem a 0170 a coluna não vem, e toda linha sai sem dono.
    linha("37", "VOC", null),
    linha("39", "GDN", estado.com0170 ? "inc-cecilio" : null),
  ];
  return {
    ...original,
    carregarCadastroDeEmpreendimentos: async () => linhas(),
    lerCadastroDeEmpreendimentos: async () => ({ com0170: estado.com0170, linhas: linhas() }),
  };
});

vi.mock("@/lib/apolo/server", () => ({ createApoloAdminClient: () => ({}) }));

vi.mock("@/lib/apolo/arquivos-do-produto-servidor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/apolo/arquivos-do-produto-servidor")>()),
  listarArquivosDoProduto: vi.fn(async () => ({ data: [], ok: true })),
  prepararEnvioDoArquivo: vi.fn(async () => ({ data: { assinado: true }, ok: true })),
  registrarArquivoDoProduto: vi.fn(async () => ({ data: { id: "novo" }, ok: true })),
  removerArquivoDoProduto: vi.fn(async () => ({ data: { id: "removido" }, ok: true })),
}));

// A revalidação de verdade (portal, conta e escopo no banco) tem teste próprio: aqui ela devolve a
// sessão do cookie, e conta quantas vezes foi chamada.
vi.mock("@/lib/temis/portao-do-portal", async () => {
  const { sessaoDoRequest } = await import("@/lib/apolo/incorporador/sessao");
  return {
    autorizarTemisDoPortal: async (request: Request) => {
      estado.revalidacoes += 1;
      const sessao = sessaoDoRequest(request);
      if (!sessao) throw new Error("teste sem sessão");
      return { ok: true, sessao };
    },
  };
});

import {
  prepararEnvioDoArquivo,
  removerArquivoDoProduto,
} from "@/lib/apolo/arquivos-do-produto-servidor";
import { MENSAGEM_PRODUTO_SO_CONSULTA } from "@/lib/apolo/incorporador/operacao-do-produto";
import { criarSessaoIncorporador, INCORPORADOR_COOKIE } from "@/lib/apolo/incorporador/sessao";

import { DELETE, GET, POST } from "./route";

type Perfil = { slug: string; tipo: "comercial" | "incorporador" };

const CECILIO: Perfil = { slug: "cecilio-rocha", tipo: "incorporador" };
const GURGEL: Perfil = { slug: "gurgel", tipo: "comercial" };

function cookie(perfil: Perfil): string {
  vi.stubEnv("SESSAO_INCORPORADOR_SECRET", "segredo-de-teste");
  const token = criarSessaoIncorporador(
    {
      enterpriseIds: ["37", "39"],
      enterpriseIdsComCarteira: [],
      incorporadorId: perfil.tipo === "comercial" ? "inc-gurgel" : "inc-cecilio",
      incorporadorNome: "Portal",
      slug: perfil.slug,
      tipo: perfil.tipo,
      usuarioId: "22222222-2222-4222-8222-222222222222",
      usuarioNome: "Time",
    },
    Date.now(),
  );
  return `${INCORPORADOR_COOKIE}=${token}`;
}

const URL_BASE = "https://c2x.app.br/api/incorporador/produto/arquivos";

function ler(emp: string, perfil: Perfil) {
  return GET(new Request(`${URL_BASE}?emp=${emp}`, { headers: { cookie: cookie(perfil) } }));
}

function enviar(emp: string, perfil: Perfil) {
  return POST(
    new Request(URL_BASE, {
      body: JSON.stringify({ acao: "preparar", destino: emp, emp, mime: "image/jpeg", nome: "fachada.jpg", tamanho: 1000 }),
      headers: { cookie: cookie(perfil) },
      method: "POST",
    }),
  );
}

function remover(emp: string, perfil: Perfil) {
  return DELETE(
    new Request(`${URL_BASE}?emp=${emp}&id=0b9f3c1e-7d2a-4c55-9a61-3f0e8b7c2d14`, {
      headers: { cookie: cookie(perfil) },
      method: "DELETE",
    }),
  );
}

async function podeEnviar(resposta: Response): Promise<{ destinos: unknown[]; podeEnviar: boolean }> {
  const corpo = (await resposta.json()) as { data: { destinos: unknown[]; podeEnviar: boolean } };
  return corpo.data;
}

beforeEach(() => {
  vi.clearAllMocks();
  estado.com0170 = true;
  estado.revalidacoes = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("Cecílio (portal que opera sozinho)", () => {
  it("⚠️ no VOC (da Careli) o botão fica apagado, e o POST é 403 só consulta sem assinar nada", async () => {
    const leitura = await ler("37", CECILIO);
    expect(leitura.status).toBe(200);
    expect(await podeEnviar(leitura)).toMatchObject({ destinos: [], podeEnviar: false });

    const envio = await enviar("37", CECILIO);
    expect(envio.status).toBe(403);
    expect(await envio.json()).toEqual({ error: MENSAGEM_PRODUTO_SO_CONSULTA, soConsulta: true });
    expect(prepararEnvioDoArquivo).not.toHaveBeenCalled();
  });

  it("⚠️ no Garden (dela) o botão acende e o POST segue, depois da revalidação", async () => {
    const leitura = await ler("39", CECILIO);
    expect((await podeEnviar(leitura)).podeEnviar).toBe(true);

    const envio = await enviar("39", CECILIO);
    expect(envio.status).toBe(200);
    expect(estado.revalidacoes).toBe(1);
    expect(prepararEnvioDoArquivo).toHaveBeenCalledTimes(1);
  });

  it("⚠️ remover também é escrita: 403 no VOC, segue no Garden", async () => {
    expect((await remover("37", CECILIO)).status).toBe(403);
    expect(removerArquivoDoProduto).not.toHaveBeenCalled();

    expect((await remover("39", CECILIO)).status).toBe(200);
    expect(removerArquivoDoProduto).toHaveBeenCalledTimes(1);
  });

  it("⚠️ sem a 0170 ninguém do portal grava (503) e o botão fica apagado", async () => {
    estado.com0170 = false;
    expect((await podeEnviar(await ler("39", CECILIO))).podeEnviar).toBe(false);
    expect((await enviar("39", CECILIO)).status).toBe(503);
    expect(prepararEnvioDoArquivo).not.toHaveBeenCalled();
  });
});

describe("Gurgel (comercial) e os demais portais", () => {
  it("⚠️ o comercial continua como era: botão aceso e envio sem ida ao banco para a régua", async () => {
    expect((await podeEnviar(await ler("37", GURGEL))).podeEnviar).toBe(true);
    expect((await enviar("37", GURGEL)).status).toBe(200);
    expect(estado.revalidacoes).toBe(0);
  });

  it("portal padrão lê, mas não tem a porta de escrita (404)", async () => {
    const padrao: Perfil = { slug: "cer", tipo: "incorporador" };
    expect((await podeEnviar(await ler("37", padrao))).podeEnviar).toBe(false);
    expect((await enviar("37", padrao)).status).toBe(404);
    expect(prepararEnvioDoArquivo).not.toHaveBeenCalled();
  });
});
