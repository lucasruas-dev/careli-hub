import { beforeEach, describe, expect, it, vi } from "vitest";

// O QUE ESTE TESTE PROTEGE: a PORTA dos arquivos do espelho público — a única maneira de um
// arquivo do bucket privado `produto-arquivos` chegar a quem abriu o link do corretor.
//
// Quatro coisas precisam ser verdade:
//
//   1. o parâmetro é o ID do arquivo, NUNCA um caminho de storage — senão a porta lê o bucket
//      inteiro, que guarda o material de todos os empreendimentos;
//   2. só entrega arquivo do empreendimento DAQUELE link;
//   3. `m=1` entrega a MINIATURA e, quando ela não existe, responde 404 — NUNCA o original. O
//      `Book Garden.pdf` tem 212.799.580 bytes medidos: cair no original aqui derrubaria 202,9 MB
//      no 4G do cliente só para desenhar um quadradinho de 160 px na grade;
//   4. a URL do storage não aparece no CORPO de nada: ela é `Location` de um 302 de uso único.

const { abrirEspelho, acharArquivoDoEspelho } = vi.hoisted(() => ({
  abrirEspelho: vi.fn(),
  acharArquivoDoEspelho: vi.fn(),
}));

vi.mock("@/lib/hercules/espelho/abrir-espelho", () => ({
  abrirEspelho,
  ERRO_GENERICO: "Link inválido ou indisponível.",
}));
vi.mock("@/lib/hercules/espelho/arquivos-publicos", () => ({ acharArquivoDoEspelho }));

import { GET } from "./route";

const ID_DO_VIDEO = "e1b1ed1d-7db7-42cc-b937-b8eec954bf1e";
const ID_DO_BOOK = "84fc9e7e-bd30-4795-936e-21a39c2c2901";
const ASSINADA = "https://xyz.supabase.co/storage/v1/object/sign/produto-arquivos/39/x.mp4?token=eyJ";

let assinados: string[];
let baixados: string[];
let assinarFalha: boolean;

function clienteFalso() {
  return {
    storage: {
      from() {
        return {
          async createSignedUrl(caminho: string) {
            assinados.push(caminho);
            if (assinarFalha) return { data: null, error: { message: "sem rede" } };
            return { data: { signedUrl: ASSINADA }, error: null };
          },
          async download(caminho: string) {
            baixados.push(caminho);
            return { data: new Blob([new Uint8Array([1, 2, 3])]), error: null };
          },
        };
      },
    },
  };
}

const aberto = () => ({
  espelho: {
    client: clienteFalso(),
    codigo: "GDN",
    filhosC2xIds: [],
    masterplan: { versao: 1 },
    nome: "Garden",
    paiC2xId: "39",
  },
  ok: true,
});

const doVideo = {
  id: ID_DO_VIDEO,
  mime: "video/mp4",
  miniaturaPath: `39/${ID_DO_VIDEO}.thumb.jpg`,
  nome: "Video 1.mp4",
  storagePath: `39/${ID_DO_VIDEO}.mp4`,
  tipo: "video" as const,
};

const doBook = {
  id: ID_DO_BOOK,
  mime: "application/pdf",
  // ⚠️ MEDIDO NO BANCO: o Book é o único arquivo do Garden sem miniatura.
  miniaturaPath: null,
  nome: "Book Garden.pdf",
  storagePath: `39/${ID_DO_BOOK}.pdf`,
  tipo: "documento" as const,
};

const pedido = (busca: string) =>
  new Request(`https://c2x.app.br/api/publico/espelho/arquivo?${busca}`);

beforeEach(() => {
  assinados = [];
  baixados = [];
  assinarFalha = false;
  abrirEspelho.mockReset().mockResolvedValue(aberto());
  acharArquivoDoEspelho.mockReset().mockResolvedValue(doVideo);
});

describe("/api/publico/espelho/arquivo", () => {
  it("sem token não abre nada: 401, e nem pergunta pelo arquivo", async () => {
    abrirEspelho.mockResolvedValue({ erro: "sem_token", ok: false });

    const r = await GET(pedido(`a=${ID_DO_VIDEO}`));

    expect(r.status).toBe(401);
    expect(acharArquivoDoEspelho).not.toHaveBeenCalled();
  });

  it("Supabase fora do ar: 503, e nunca um arquivo", async () => {
    abrirEspelho.mockResolvedValue({ erro: "indisponivel", ok: false });

    expect((await GET(pedido(`a=${ID_DO_VIDEO}`))).status).toBe(503);
  });

  it("o original sai por 302 na URL assinada, que NÃO aparece em corpo nenhum", async () => {
    const r = await GET(pedido(`e=tok&a=${ID_DO_VIDEO}`));

    expect(r.status).toBe(302);
    expect(r.headers.get("Location")).toBe(ASSINADA);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    expect(await r.text()).toBe("");
    // O caminho foi resolvido pelo SERVIDOR, a partir do id.
    expect(assinados).toEqual([doVideo.storagePath]);
  });

  it("⚠️ PERGUNTA PELO ID E PELOS ids DAQUELE LINK — nunca por um caminho", async () => {
    await GET(pedido(`e=tok&a=${ID_DO_VIDEO}`));

    expect(acharArquivoDoEspelho).toHaveBeenCalledWith(
      expect.anything(),
      ["39"],
      ID_DO_VIDEO,
    );
  });

  it("⚠️ ARQUIVO DE OUTRO EMPREENDIMENTO: 404, sem assinar nada", async () => {
    acharArquivoDoEspelho.mockResolvedValue(null);

    const r = await GET(pedido("e=tok&a=11111111-2222-4333-8444-555555555555"));

    expect(r.status).toBe(404);
    expect(assinados).toEqual([]);
    expect(baixados).toEqual([]);
  });

  it("⚠️ CAMINHO DE STORAGE NO LUGAR DO ID NÃO ABRE NADA", async () => {
    acharArquivoDoEspelho.mockResolvedValue(null);

    for (const forjado of [
      `39/${ID_DO_BOOK}.pdf`,
      "../apolo-documents/cpf-do-cliente.pdf",
      "12/11111111-2222-4333-8444-555555555555.jpg",
    ]) {
      const r = await GET(pedido(`e=tok&a=${encodeURIComponent(forjado)}`));
      expect(r.status).toBe(404);
    }

    expect(assinados).toEqual([]);
    expect(baixados).toEqual([]);
  });

  it("a miniatura desce pelos nossos bytes, com cache curto e sem credencial na URL", async () => {
    const r = await GET(pedido(`e=tok&a=${ID_DO_VIDEO}&m=1`));

    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe("image/jpeg");
    expect(r.headers.get("Cache-Control")).toContain("max-age=3600");
    expect(baixados).toEqual([doVideo.miniaturaPath]);
    // ⚠️ A miniatura NÃO passa por URL assinada: os bytes vêm por aqui, e nada do storage vaza.
    expect(assinados).toEqual([]);
  });

  it("⚠️ SEM MINIATURA (O BOOK DE 202,9 MB): 404, E NUNCA O ORIGINAL", async () => {
    acharArquivoDoEspelho.mockResolvedValue(doBook);

    const r = await GET(pedido(`e=tok&a=${ID_DO_BOOK}&m=1`));

    expect(r.status).toBe(404);
    expect(baixados).toEqual([]);
    expect(assinados).toEqual([]);
  });

  it("o book inteiro continua saindo quando a pessoa ABRE o arquivo", async () => {
    acharArquivoDoEspelho.mockResolvedValue(doBook);

    const r = await GET(pedido(`e=tok&a=${ID_DO_BOOK}`));

    expect(r.status).toBe(302);
    expect(assinados).toEqual([doBook.storagePath]);
  });

  it("assinatura falhou: 503, e a tela mostra erro em vez de um link quebrado", async () => {
    assinarFalha = true;
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect((await GET(pedido(`e=tok&a=${ID_DO_VIDEO}`))).status).toBe(503);

    erro.mockRestore();
  });

  it("sem o parâmetro do arquivo: 404, sem consultar o banco", async () => {
    const r = await GET(pedido("e=tok"));

    expect(r.status).toBe(404);
    expect(acharArquivoDoEspelho).not.toHaveBeenCalled();
  });
});
