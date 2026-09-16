import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A ROTA DO TERMO DE RESCISÃO — metade lida como TEXTO, metade exercitada com a leitura simulada.
//
// ⚠️ A PARTE LIDA COMO TEXTO COBRA O QUE NENHUM TESTE DE COMPORTAMENTO ALCANÇA. `maxDuration = 30`
// não muda uma resposta num teste: ele só existe na Vercel, e a falta dele aparece na tela como
// "Unexpected token" no lugar da frase ([[reference_vercel_timeout_vira_erro_de_json]]). O portão
// trocado de `Read` para outro também passa despercebido com o `auth` simulado.
//
// ⚠️ E A ROTA NÃO PODE CALCULAR. Ela é o molde do extrato — autoriza, confere, devolve bytes — e uma
// conta escrita aqui seria a segunda versão do número que o cliente assina.
const ROTA = readFileSync(join(__dirname, "route.ts"), "utf8");
const CODIGO = ROTA.split("\n")
  .filter((linha) => !/^\s*(\/\/|\/\*|\*)/.test(linha))
  .join("\n");

const estado = vi.hoisted(() => ({
  autorizado: true,
  chamadas: [] as Array<{ c2xId: number; contratoId: number }>,
  falhaNoPdf: false,
  resultado: { ok: true } as Record<string, unknown>,
}));

vi.mock("@/lib/apolo/auth", () => ({
  authorizeApoloRead: async () =>
    estado.autorizado
      ? { nome: "Operadora", ok: true, userId: "3f7a2c18-9d4b-4f2a-8a11-0c5e6b7d8e90" }
      : {
          ok: false,
          response: Response.json({ error: "Usuario sem acesso ao Apolo." }, { status: 403 }),
        },
}));

vi.mock("@/lib/apolo/termo-de-rescisao-server", () => ({
  carregarTermoDeRescisao: async (escopo: { c2xId: number; contratoId: number }) => {
    estado.chamadas.push(escopo);
    return estado.resultado;
  },
}));

vi.mock("@/lib/apolo/rescisao-pdf", () => ({
  montarTermoDeRescisaoPdf: async () => {
    if (estado.falhaNoPdf) throw new Error("WinAnsi cannot encode");
    return new Uint8Array([0x25, 0x50, 0x44, 0x46]);
  },
  nomeDoArquivoRescisao: () => "Relatório de Rescisão - Cliente Teste - TST0101 - 16-09-2026.pdf",
}));

import { GET } from "./route";

function pedido(query: string): Request {
  return new Request(`http://localhost/api/apolo/rescisao/pdf${query}`, {
    headers: { Authorization: "Bearer token-de-teste" },
  });
}

beforeEach(() => {
  estado.autorizado = true;
  estado.chamadas = [];
  estado.falhaNoPdf = false;
  estado.resultado = { dados: { cliente: { nome: "Cliente Teste" } }, ok: true };
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("a rota do termo, lida como texto", () => {
  it("declara maxDuration = 30 (sem ele o timeout vira erro de JSON na tela)", () => {
    expect(CODIGO).toMatch(/export const maxDuration = 30;/);
  });

  it("é dinâmica e roda em Node, como o extrato", () => {
    expect(CODIGO).toContain('export const dynamic = "force-dynamic";');
    expect(CODIGO).toContain('export const runtime = "nodejs";');
  });

  it("o portão é o de leitura do Apolo, o mesmo do extrato", () => {
    expect(CODIGO).toContain("await authorizeApoloRead(request)");
  });

  it("não calcula: a conta e o papel moram nas libs", () => {
    expect(CODIGO).not.toContain("calcularRescisao");
    expect(CODIGO).toContain("carregarTermoDeRescisao(");
    expect(CODIGO).toContain("montarTermoDeRescisaoPdf(");
  });

  it("só exporta o que um arquivo de rota do Next aceita", () => {
    const exportados = [...CODIGO.matchAll(/^export (?:async )?(?:const|function) (\w+)/gm)].map(
      (achado) => achado[1],
    );
    expect(exportados.sort()).toEqual(["GET", "dynamic", "maxDuration", "runtime"]);
  });
});

describe("o pedido", () => {
  it("sem autorização, devolve a resposta do portão", async () => {
    estado.autorizado = false;

    const resposta = await GET(pedido("?c2xId=77&contrato=1050"));
    expect(resposta.status).toBe(403);
    expect(estado.chamadas).toHaveLength(0);
  });

  it("c2xId inválido: 400", async () => {
    const resposta = await GET(pedido("?c2xId=abc&contrato=1050"));
    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({ error: "Informe um c2xId valido." });
  });

  // ⚠️ O EXTRATO ACEITA "TODOS"; O TERMO, NÃO. Escolher o primeiro contrato em silêncio emitiria um
  // termo de rescisão sobre a venda que o operador não escolheu.
  it("sem contrato: 400 com a frase, e a leitura nem começa", async () => {
    const resposta = await GET(pedido("?c2xId=77"));

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({
      error: "Informe o contrato: o termo de rescisão é de um contrato só, não do cliente inteiro.",
    });
    expect(estado.chamadas).toHaveLength(0);
  });

  it.each(["abc", "0", "-3", "1.5"])("contrato %s: 400", async (contrato) => {
    const resposta = await GET(pedido(`?c2xId=77&contrato=${contrato}`));
    expect(resposta.status).toBe(400);
    expect(estado.chamadas).toHaveLength(0);
  });

  it("passa o cliente e o contrato para a leitura", async () => {
    await GET(pedido("?c2xId=77&contrato=1050"));
    expect(estado.chamadas).toEqual([{ c2xId: 77, contratoId: 1050 }]);
  });
});

describe("a resposta", () => {
  it("o PDF sai com no-store e o nome nas duas formas", async () => {
    const resposta = await GET(pedido("?c2xId=77&contrato=1050"));

    expect(resposta.status).toBe(200);
    expect(resposta.headers.get("Content-Type")).toBe("application/pdf");
    expect(resposta.headers.get("Cache-Control")).toBe("no-store");

    const disposicao = resposta.headers.get("Content-Disposition") ?? "";
    // A forma simples, em ASCII (sem o "ó" de Relatório e sem o "ã" de Rescisão)...
    expect(disposicao).toContain(
      'filename="Relatorio de Rescisao - Cliente Teste - TST0101 - 16-09-2026.pdf"',
    );
    // ...e a forma UTF-8, que os navegadores atuais leem.
    expect(disposicao).toContain(
      `filename*=UTF-8''${encodeURIComponent("Relatório de Rescisão - Cliente Teste - TST0101 - 16-09-2026.pdf")}`,
    );

    const bytes = new Uint8Array(await resposta.arrayBuffer());
    expect(String.fromCharCode(...bytes)).toBe("%PDF");
  });

  // ⚠️ A FRASE DA RECUSA É O QUE EXPLICA O BOTÃO. O painel lê `error` e só ele — então o status e a
  // frase da leitura atravessam a rota sem tradução.
  it.each([
    [404, "Este contrato não está entre os contratos com carteira deste cliente no C2X."],
    [422, "O termo de rescisão só sai para contrato em curso, e este está cancelado."],
    [503, "Não foi possível ler a posse deste contrato, e sem ela o termo não sabe se há fruição a deduzir."],
  ])("a recusa %i atravessa com a frase", async (status, frase) => {
    estado.resultado = { error: frase, ok: false, status };

    const resposta = await GET(pedido("?c2xId=77&contrato=1050"));
    expect(resposta.status).toBe(status);
    expect(resposta.headers.get("Cache-Control")).toBe("no-store");
    expect(await resposta.json()).toEqual({ error: frase });
  });

  it("falha ao desenhar o PDF: 500 com frase, e não uma página de erro", async () => {
    estado.falhaNoPdf = true;

    const resposta = await GET(pedido("?c2xId=77&contrato=1050"));
    expect(resposta.status).toBe(500);
    expect(await resposta.json()).toEqual({
      error: "Nao foi possivel gerar o PDF do termo de rescisao.",
    });
  });
});
