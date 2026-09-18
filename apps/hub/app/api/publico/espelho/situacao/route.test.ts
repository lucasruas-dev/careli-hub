import { beforeEach, describe, expect, it, vi } from "vitest";

// O QUE ESTE TESTE PROTEGE: a rota que o link público consulta a cada minuto. Falha de leitura é
// ERRO (503), nunca um mapa: nem vazio (o visitante leria "não tem nada à venda"), nem com cores
// adivinhadas (verde é a afirmação "este lote está à venda"). E a resposta nunca vai para a CDN: o
// telão do Prometeu já mostrou lote verde 40 s depois de reservado por causa de um `s-maxage`.
//
// Que `estadoDoEspelho` LANÇA quando qualquer leitura da régua única falha está provado em
// `lib/hercules/espelho/estado-do-espelho.test.ts`; aqui se prova o que a rota faz com isso.

const { abrirEspelho, estadoDoEspelho, planosPublicos } = vi.hoisted(() => ({
  abrirEspelho: vi.fn(),
  estadoDoEspelho: vi.fn(),
  planosPublicos: vi.fn(),
}));

vi.mock("@/lib/hercules/espelho/abrir-espelho", () => ({
  abrirEspelho,
  ERRO_GENERICO: "Link inválido ou indisponível.",
}));
vi.mock("@/lib/hercules/espelho/estado-do-espelho", () => ({ estadoDoEspelho }));
vi.mock("@/lib/hercules/espelho/planos-publicos", () => ({ planosPublicos }));

import { GET } from "./route";

const pedido = (token = "tok") =>
  new Request(`https://c2x.app.br/api/publico/espelho/situacao?e=${encodeURIComponent(token)}`);

const aberto = {
  espelho: {
    client: {},
    codigo: "VLO",
    filhosC2xIds: ["37", "41"],
    masterplan: { versao: 1 },
    nome: "Vale do Ouro",
    paiC2xId: "35",
  },
  ok: true,
};

const verde = {
  atualizadoEm: "2026-09-18T12:00:00.000Z",
  contagem: { disponivel: 1, indisponivel: 0 },
  lotes: [{ codigo: "VLO0410", situacao: "disponivel" }],
};

beforeEach(() => {
  abrirEspelho.mockReset().mockResolvedValue(aberto);
  estadoDoEspelho.mockReset().mockResolvedValue(verde);
  planosPublicos.mockReset().mockResolvedValue([]);
});

describe("/api/publico/espelho/situacao", () => {
  it("pede a árvore inteira (pai e filhos) à régua, e responde sem cache", async () => {
    const r = await GET(pedido());
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    expect(estadoDoEspelho).toHaveBeenCalledWith(aberto.espelho.client, {
      enterpriseIdDoPai: "35",
      enterpriseIdsDosFilhos: ["37", "41"],
    });
    const corpo = (await r.json()) as { data: { lotes: unknown[]; temMapa: boolean } };
    expect(corpo.data.lotes).toEqual(verde.lotes);
    expect(corpo.data.temMapa).toBe(true);
  });

  // ⚠️ FAIL-CLOSED: nenhuma cor sai de uma leitura que falhou.
  it("falha lendo a situação: 503, sem lote nenhum no corpo, sem cache", async () => {
    estadoDoEspelho.mockRejectedValueOnce(new Error("falha lendo hercules_propostas"));
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const r = await GET(pedido());

    expect(r.status).toBe(503);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    const corpo = (await r.json()) as Record<string, unknown>;
    expect(corpo).toEqual({ error: "Link inválido ou indisponível." });
    expect(JSON.stringify(corpo)).not.toContain("disponivel");
    erro.mockRestore();
  });

  // Os planos vêm na mesma resposta: se eles falharem, a resposta inteira falha. Não sai um mapa
  // "meio lido".
  it("falha lendo os planos também é 503, e não um mapa sem planos", async () => {
    planosPublicos.mockRejectedValueOnce(new Error("falha lendo temis_planos"));
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const r = await GET(pedido());

    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "Link inválido ou indisponível." });
    erro.mockRestore();
  });

  it("token inválido: 401; espelho que não abre: 503. Nos dois, nada da régua é lido", async () => {
    abrirEspelho.mockResolvedValueOnce({ erro: "sem_token", ok: false });
    const semToken = await GET(pedido(""));
    expect(semToken.status).toBe(401);
    expect(semToken.headers.get("Cache-Control")).toBe("no-store");

    abrirEspelho.mockResolvedValueOnce({ erro: "indisponivel", ok: false });
    const fora = await GET(pedido());
    expect(fora.status).toBe(503);

    expect(estadoDoEspelho).not.toHaveBeenCalled();
  });
});
