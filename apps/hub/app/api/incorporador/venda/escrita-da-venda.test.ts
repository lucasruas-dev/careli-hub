import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A RÉGUA DE ESCRITA NAS ROTAS DE DOCUMENTOS E CONVERSA DA VENDA, LIDAS COMO TEXTO.
//
// Decisão do Lucas (16/09/2026): no portal que confecciona (o Cecílio) toda escrita só vale no
// produto operado por ele; no VOC e no VOR ele consulta. Guardar documento e registrar mensagem na
// venda são escrita, e a leitura (GET) continua aberta. O comportamento da régua está provado nos
// testes das rotas de reserva, proposta, contrato e cancelamento, que a chamam de verdade; aqui se
// trava a rota esquecida: o POST que grava sem perguntar, ou que pergunta DEPOIS de gravar.
//
// Lido como texto pelo mesmo motivo de bloqueio/route.test.ts: importar exigiria Supabase, Storage e
// cookie, e o que se protege (a chamada e a ordem dela) é visível no texto.

const ler = (rota: string) => readFileSync(join(__dirname, rota, "route.ts"), "utf8");

describe.each([
  { escrita: '.from("hercules_documentos")\n      .insert(', rota: "documentos" },
  { escrita: '.from("hercules_conversas")\n      .insert(', rota: "conversa" },
])("venda/$rota", ({ escrita, rota }) => {
  const texto = ler(rota).replace(/\r\n/g, "\n");
  const [antesDoPost, post = ""] = texto.split("export async function POST");

  it("o GET não passa pela régua de escrita: consultar continua aberto", () => {
    expect(antesDoPost).not.toContain("autorizarEscritaNoProduto(");
  });

  it("⚠️ o POST passa pela régua com o enterprise da unidade, antes de qualquer gravação", () => {
    const regua = post.indexOf("autorizarEscritaNoProduto(request, auth.sessao, [unidade.enterprise_id])");
    expect(regua).toBeGreaterThan(-1);
    expect(post.indexOf(escrita)).toBeGreaterThan(regua);
  });

  it("quem grava é a sessão revalidada pela régua", () => {
    expect(post).toContain("const sessao = escrita.sessao;");
    expect(post).not.toMatch(/auth\.sessao\.usuario(Id|Nome)/);
  });
});

describe("venda/documentos", () => {
  it("assinar o envio também espera a régua: a URL assinada já cria objeto no bucket", () => {
    const post = ler("documentos").split("export async function POST")[1] ?? "";
    const regua = post.indexOf("autorizarEscritaNoProduto(");
    expect(post.indexOf("createSignedUploadUrl(")).toBeGreaterThan(regua);
  });
});
