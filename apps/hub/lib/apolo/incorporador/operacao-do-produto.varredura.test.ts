import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A VARREDURA DAS ROTAS DE ESCRITA DO PORTAL, LIDAS COMO TEXTO.
//
// Decisão do Lucas (16/09/2026): no portal que confecciona (hoje o `cecilio-rocha`) TODA escrita só
// vale no produto que ele opera (`operado_por`). VOC (37) e VOR (41) ficam só consulta para a
// Cecílio. A régua é uma só (`operacao-do-produto.ts`, e a porta do servidor
// `operacao-do-produto-servidor.ts`); o que este teste trava é a ROTA ESQUECIDA: uma escrita que
// continue gravando no VOC porque ninguém lembrou de chamar a régua nela.
//
// ⚠️ É GROSSEIRO DE PROPÓSITO, como os testes de rota lidos como texto (venda/bloqueio): importar
// cada rota exigiria subir Supabase, cookie e escopo. O que se confere é que a peça está IMPORTADA;
// que ela é chamada antes de gravar, cada rota prova no próprio teste.
//
// ⚠️ ENTRA NA INTEGRAÇÃO FINAL, NÃO NO PORTÃO DE UM GRUPO SÓ: cada arquivo abaixo tem dono, e a
// varredura fica vermelha até todos ligarem a régua.

const RAIZ = join(__dirname, "../../..");

const ESCRITAS_DO_PORTAL = [
  "app/api/incorporador/venda/reserva/route.ts",
  "app/api/incorporador/venda/proposta/route.ts",
  "app/api/incorporador/venda/contrato/route.ts",
  "app/api/incorporador/venda/bloqueio/route.ts",
  "app/api/incorporador/venda/cancelamento-de-contrato/route.ts",
  "app/api/incorporador/venda/documentos/route.ts",
  "app/api/incorporador/venda/conversa/route.ts",
  "app/api/incorporador/board/[id]/route.ts",
  "app/api/incorporador/board/[id]/etapa/route.ts",
  "app/api/incorporador/board/[id]/habilitar/route.ts",
  "app/api/incorporador/board/[id]/identidade/route.ts",
  "app/api/incorporador/board/[id]/serasa/consultar/route.ts",
  "app/api/incorporador/board/[id]/serasa/aprovar-restricao/route.ts",
  "app/api/incorporador/produto/arquivos/route.ts",
  "lib/hercules/cadastrar-unidades-panteon-server.ts",
  "lib/hercules/cadastrar-produto-server.ts",
  "lib/apolo/incorporador/cadastro-do-portal.ts",
  "lib/temis/alcance-da-estrutura.ts",
];

// Import estático ou dinâmico, por alias ou relativo, da régua pura ou da porta do servidor.
const IMPORTA_A_REGUA = /["'`][^"'`]*\/operacao-do-produto(?:-servidor)?["'`]/;

describe("toda escrita do portal passa pela régua de quem opera o produto", () => {
  it.each(ESCRITAS_DO_PORTAL)("%s importa operacao-do-produto", (arquivo) => {
    const caminho = join(RAIZ, arquivo);
    expect(existsSync(caminho), `${arquivo} não existe`).toBe(true);
    expect(readFileSync(caminho, "utf8")).toMatch(IMPORTA_A_REGUA);
  });
});
