import { beforeEach, describe, expect, it, vi } from "vitest";

// A ROTA DO PDF DA EVOLUÇÃO — a folha que pode ir para o cliente.
//
// ⚠️ O QUE ESTE ARQUIVO TRAVA: série do índice fora do ar NÃO vira papel. É falha de agora, e o PDF
// sairia sem o quadro, dizendo "não consegui buscar" na mão do cliente. A rota recusa com 503 e o
// atendente tenta de novo. As portas para fora (sessão, C2X, fonte do índice) são trocadas; o
// desenho do PDF roda de verdade.

vi.mock("@/lib/apolo/auth", () => ({
  authorizeApoloRead: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/apolo/extrato-cliente-c2x", () => ({ loadExtratoDoCliente: vi.fn() }));
vi.mock("@/lib/apolo/reajuste/projecao-do-contrato", () => ({ evolucaoDosContratos: vi.fn() }));

const { loadExtratoDoCliente } = await import("@/lib/apolo/extrato-cliente-c2x");
const { evolucaoDosContratos } = await import("@/lib/apolo/reajuste/projecao-do-contrato");
const { GET } = await import("./route");

const CONTRATO = {
  codigo: "LOS0617",
  contratoId: 1398,
  defasagemPct: 0,
  empreendimento: "LAVRA DO OURO",
  encerrado: false,
  eventos: [],
  indice: "IPCA" as const,
  indiceDoContrato: "IPCA ANUAL",
  indiceNoAno: null,
  indicePublicadoAte: null,
  jurosAnualPct: 8,
  linhas: [],
  mensalidadeBase: 452.43,
  mensalidadeVigente: 452.43,
  mesTipicoPct: null,
  sistema: "sacoc" as const,
};

function pedir() {
  return GET(new Request("https://c2x.app.br/api/apolo/evolucao-da-parcela/pdf?c2xId=1398"));
}

beforeEach(() => {
  vi.mocked(loadExtratoDoCliente).mockResolvedValue({
    data: {
      cliente: { c2xId: 1398, documentoMascarado: "***.456.789-**", nome: "CLIENTE DE TESTE" },
      contratos: [],
      posicaoEm: "2026-09-24",
    },
    ok: true,
  });
});

describe("GET /api/apolo/evolucao-da-parcela/pdf", () => {
  it("⚠️ série do índice fora do ar: 503 dizendo para tentar de novo, e nenhum PDF", async () => {
    vi.mocked(evolucaoDosContratos).mockResolvedValue({
      data: [
        {
          ...CONTRATO,
          motivo: "Não consegui buscar a série do IPCA agora. Tente de novo em alguns minutos.",
          serieIndisponivel: true,
        },
      ],
      ok: true,
    });
    const resposta = await pedir();
    expect(resposta.status).toBe(503);
    const corpo = (await resposta.json()) as { error: string };
    expect(corpo.error).toContain("série do IPCA");
    expect(corpo.error).toContain("Tente de novo");
  });

  it("contrato sem quadro por motivo PERMANENTE (encerrado) ainda gera o PDF, com o motivo", async () => {
    vi.mocked(evolucaoDosContratos).mockResolvedValue({
      data: [
        {
          ...CONTRATO,
          encerrado: true,
          motivo: "Contrato encerrado: o quadro da parcela só é montado para contrato em andamento.",
        },
      ],
      ok: true,
    });
    const resposta = await pedir();
    expect(resposta.status).toBe(200);
    expect(resposta.headers.get("content-type")).toBe("application/pdf");
  });
});
