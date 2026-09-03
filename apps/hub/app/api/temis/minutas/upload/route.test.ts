import { beforeEach, describe, expect, it, vi } from "vitest";

// A ROTA /api/temis/minutas/upload — o caminho de SEGURANÇA e o contrato com o hook.
//
// O que está travado aqui: o prefixo é escolhido pelo SERVIDOR a partir da minuta que existe no
// banco (`temis-minutas/<minutaId>/`); tipo fora da lista é 415; tamanho acima do teto é 413 (no
// POST pelo declarado, no PATCH pelo tamanho REAL, apagando o objeto); PATCH/GET só aceitam
// caminho dentro do prefixo e sem `..`; sem Bearer é 401 e nada toca o Storage.
//
// Supabase mockado: o teste é da REGRA da rota, não da integração.

const estado = vi.hoisted(() => ({
  chamadas: {
    remove: [] as string[][],
    signedUpload: [] as string[],
    signedUrl: [] as Array<{ path: string; ttl: number }>,
  },
  minutaExiste: true,
  tamanhoReal: 1024,
}));

vi.mock("@/lib/apolo/auth", () => {
  const autorizar = async (request: Request) => {
    const header = request.headers.get("authorization") ?? "";
    if (!/^Bearer\s+\S+/i.test(header)) {
      return {
        ok: false,
        response: Response.json({ error: "Sessao do Apolo ausente." }, { status: 401 }),
      };
    }
    return { ok: true, userId: "user-1" };
  };
  return { authorizeApoloRead: autorizar, authorizeApoloWrite: autorizar };
});

vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: estado.minutaExiste ? { id: MINUTA } : null,
            error: null,
          }),
        }),
      }),
    }),
    storage: {
      from: () => ({
        createSignedUploadUrl: async (path: string) => {
          estado.chamadas.signedUpload.push(path);
          return { data: { path, signedUrl: "https://x/upload", token: "tok-1" }, error: null };
        },
        createSignedUrl: async (path: string, ttl: number) => {
          estado.chamadas.signedUrl.push({ path, ttl });
          return {
            data: {
              signedUrl: `https://x.supabase.co/storage/v1/object/sign/apolo-documents/${path}?token=abc`,
            },
            error: null,
          };
        },
        info: async () => ({
          data: { contentType: "image/png", size: estado.tamanhoReal },
          error: null,
        }),
        remove: async (paths: string[]) => {
          estado.chamadas.remove.push(paths);
          return { data: null, error: null };
        },
      }),
    },
  }),
}));

const MINUTA = "3f0c2b9e-1c7a-4d2e-9b0f-1a2b3c4d5e6f";

import { GET, PATCH, POST, TTL_LEITURA_MIDIA } from "@/app/api/temis/minutas/upload/route";
import { caminhoDaUrlAssinada } from "@/lib/temis/upload-midia";

function post(corpo: unknown, comBearer = true): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (comBearer) headers.set("Authorization", "Bearer token-de-teste");
  return new Request("https://c2x.app.br/api/temis/minutas/upload", {
    body: JSON.stringify(corpo),
    headers,
    method: "POST",
  });
}

function patch(corpo: unknown): Request {
  return new Request("https://c2x.app.br/api/temis/minutas/upload", {
    body: JSON.stringify(corpo),
    headers: { Authorization: "Bearer token-de-teste", "Content-Type": "application/json" },
    method: "PATCH",
  });
}

function get(path: string, emJson = false): Request {
  return new Request(
    `https://c2x.app.br/api/temis/minutas/upload?path=${encodeURIComponent(path)}${emJson ? "&json=1" : ""}`,
    { headers: { Authorization: "Bearer token-de-teste" } },
  );
}

const pedidoOk = {
  contentType: "image/png",
  fileName: "logo do loteador.png",
  minutaId: MINUTA,
  size: 2048,
};

beforeEach(() => {
  estado.minutaExiste = true;
  estado.tamanhoReal = 1024;
  estado.chamadas.remove = [];
  estado.chamadas.signedUpload = [];
  estado.chamadas.signedUrl = [];
});

describe("POST (pedir URL assinada de upload)", () => {
  it("sem Bearer, 401 e o Storage nem é tocado", async () => {
    const r = await POST(post(pedidoOk, false));
    expect(r.status).toBe(401);
    expect(estado.chamadas.signedUpload).toHaveLength(0);
  });

  it("tipo fora da lista → 415", async () => {
    const r = await POST(post({ ...pedidoOk, contentType: "application/x-msdownload" }));
    expect(r.status).toBe(415);
    expect(estado.chamadas.signedUpload).toHaveLength(0);
  });

  it("tamanho declarado acima do teto → 413", async () => {
    const r = await POST(post({ ...pedidoOk, size: 21 * 1024 * 1024 }));
    expect(r.status).toBe(413);
  });

  it("minuta inexistente → 404", async () => {
    estado.minutaExiste = false;
    const r = await POST(post(pedidoOk));
    expect(r.status).toBe(404);
    expect(estado.chamadas.signedUpload).toHaveLength(0);
  });

  it("minutaId fora do formato → 400 (nada de caminho montado com lixo)", async () => {
    const r = await POST(post({ ...pedidoOk, minutaId: "../../outra" }));
    expect(r.status).toBe(400);
  });

  it("feliz: o caminho é temis-minutas/<minutaId>/<uuid>-<nome saneado>", async () => {
    const r = await POST(post(pedidoOk));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const corpo = (await r.json()) as { bucket: string; path: string; token: string };
    expect(corpo.bucket).toBe("apolo-documents");
    expect(corpo.token).toBe("tok-1");
    expect(corpo.path.startsWith(`temis-minutas/${MINUTA}/`)).toBe(true);
    expect(corpo.path).toMatch(/\/[0-9a-f-]{36}-logo_do_loteador\.png$/);
    expect(estado.chamadas.signedUpload).toEqual([corpo.path]);
  });
});

describe("PATCH (confirmar o upload)", () => {
  it("caminho com `..` → 400", async () => {
    const r = await PATCH(patch({ path: `temis-minutas/${MINUTA}/../x.png` }));
    expect(r.status).toBe(400);
  });

  it("caminho fora de temis-minutas/ → 400 (não re-assina documento de CAD)", async () => {
    const r = await PATCH(patch({ path: "entidade/abc/rg.pdf" }));
    expect(r.status).toBe(400);
    expect(estado.chamadas.signedUrl).toHaveLength(0);
  });

  it("tamanho REAL acima do teto → 413 e o objeto é removido", async () => {
    estado.tamanhoReal = 25 * 1024 * 1024;
    const path = `temis-minutas/${MINUTA}/uuid-x.png`;
    const r = await PATCH(patch({ path }));
    expect(r.status).toBe(413);
    expect(estado.chamadas.remove).toEqual([[path]]);
    expect(estado.chamadas.signedUrl).toHaveLength(0);
  });

  it("feliz: assina a leitura com prazo CURTO e devolve a URL de onde o path se recupera", async () => {
    const path = `temis-minutas/${MINUTA}/3f0c2b9e-1c7a-4d2e-9b0f-1a2b3c4d5e6f-planta.png`;
    const r = await PATCH(patch({ path }));
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { name: string; path: string; size: number; type: string; url: string };
    expect(corpo.path).toBe(path);
    expect(corpo.size).toBe(1024);
    expect(corpo.type).toBe("image/png");
    expect(corpo.name).toBe("planta.png");
    expect(estado.chamadas.signedUrl).toEqual([{ path, ttl: TTL_LEITURA_MIDIA }]);
    // ⚠️ A URL vai parar em toda cópia do HTML do contrato. 10 anos a tornava pública para quem
    // tivesse o link (sem sessão, e revogar exigiria apagar o arquivo). 7 dias, e a tela re-assina
    // ao abrir a minuta.
    expect(TTL_LEITURA_MIDIA).toBe(7 * 24 * 60 * 60);
    // A tela (ou o gerador de contrato) recupera o path da própria URL gravada no nó.
    expect(caminhoDaUrlAssinada(corpo.url, "apolo-documents")).toBe(path);
  });
});

describe("GET (re-assinar a leitura)", () => {
  it("caminho fora do prefixo → 400", async () => {
    const r = await GET(get("empreendimento/VAL/masterplan.svg"));
    expect(r.status).toBe(400);
    expect(estado.chamadas.signedUrl).toHaveLength(0);
  });

  it("feliz: 302 para uma signed URL curta", async () => {
    const path = `temis-minutas/${MINUTA}/uuid-planta.png`;
    const r = await GET(get(path));
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toContain(`/object/sign/apolo-documents/${path}`);
    expect(estado.chamadas.signedUrl[0]?.ttl).toBe(600);
  });

  it("com `json=1`: devolve { url, path } com o prazo da mídia — é o que a tela usa ao abrir", async () => {
    // `<img>` não segue um 302 com Bearer; quem re-assina é o `fetch` da tela, que troca a URL no nó.
    const path = `temis-minutas/${MINUTA}/uuid-planta.png`;
    const r = await GET(get(`${path}`, true));
    expect(r.status).toBe(200);
    const corpo = (await r.json()) as { path: string; url: string };
    expect(corpo.path).toBe(path);
    expect(caminhoDaUrlAssinada(corpo.url, "apolo-documents")).toBe(path);
    expect(estado.chamadas.signedUrl[0]?.ttl).toBe(TTL_LEITURA_MIDIA);
  });
});
