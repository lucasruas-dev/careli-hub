// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ArquivoDoProduto } from "@/lib/apolo/arquivos-do-produto-servidor";

// A ABA ARQUIVOS, TRAVADA NO QUE A PESSOA VÊ E NO QUE VAI PARA A REDE.
//
// ⚠️ O QUE SE PROVA AQUI E NÃO NA LIB: que o envio é em três passos com o arquivo indo DIRETO ao
// Storage (nunca no corpo da rota), que a remoção pede confirmação antes do DELETE, e que quem não
// opera a venda não vê botão de escrita. A régua de formato e o recorte têm os próprios testes.
//
// Mesma montagem manual dos outros testes de componente (ModalDeProposta.comportamento).

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/supabase/client", () => ({
  getHubSupabaseClient: () => null,
  hubSupabaseConfig: { anonKey: "chave-publica", url: "https://projeto.supabase.co" },
}));

vi.mock("@/modules/apolo/data/apolo-operations", () => ({
  getApoloAccessToken: () => Promise.resolve("token-do-hub"),
}));

const { ArquivosDoProduto } = await import("./ArquivosDoProduto");

const UUID = "0b9f3c1e-7d2a-4c55-9a61-3f0e8b7c2d14";

const arquivo = (p: Partial<ArquivoDoProduto> & { id: string }): ArquivoDoProduto => ({
  altura: 3024,
  criadoEm: "2026-09-16T10:00:00Z",
  duracaoSegundos: null,
  enviadoPor: null,
  largura: 4032,
  legenda: null,
  mime: "image/jpeg",
  miniaturaUrl: `https://x/${p.id}.thumb.jpg`,
  nome: `${p.id}.jpg`,
  ordem: null,
  tamanhoBytes: 1000,
  tipo: "imagem",
  url: `https://x/${p.id}.jpg`,
  ...p,
});

type Chamada = { body?: unknown; method: string; url: string };

let raiz: Root;
let hospedeiro: HTMLDivElement;
let chamadas: Chamada[];

/** Um fetch de mentira que responde pela rota e pelo método. */
function instalarFetch(
  responder: (chamada: Chamada) => { corpo: unknown; status?: number },
) {
  chamadas = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const chamada: Chamada = {
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
        method: init?.method ?? "GET",
        url,
      };
      chamadas.push(chamada);
      const { corpo, status = 200 } = responder(chamada);
      return Promise.resolve(
        new Response(JSON.stringify(corpo), {
          headers: { "content-type": "application/json" },
          status,
        }),
      );
    }),
  );
}

async function esperarPromessas() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function montar(elemento: React.ReactElement) {
  act(() => {
    raiz.render(elemento);
  });
  await esperarPromessas();
}

const texto = () => hospedeiro.textContent ?? "";
const botao = (rotulo: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent?.trim() === rotulo || b.getAttribute("aria-label") === rotulo,
  );

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ArquivosDoProduto", () => {
  it("vazio, para quem opera a venda: convite e botão de envio", async () => {
    instalarFetch(() => ({
      corpo: { data: { arquivos: [], destinos: [{ id: "37", rotulo: "VOC" }], podeEnviar: true } },
    }));
    await montar(<ArquivosDoProduto emp="pai:vlo" podeEditar />);

    expect(chamadas[0]?.url).toBe("/api/incorporador/produto/arquivos?emp=pai%3Avlo");
    expect(texto()).toContain("Nenhuma foto ou vídeo ainda");
    expect(botao("Enviar fotos e vídeos")).toBeTruthy();
  });

  it("quem não opera a venda vê a grade, mas nem envio nem remoção", async () => {
    instalarFetch(() => ({
      corpo: { data: { arquivos: [arquivo({ id: "a" })], destinos: [], podeEnviar: false } },
    }));
    await montar(<ArquivosDoProduto emp="37" podeEditar />);

    expect(hospedeiro.querySelectorAll(".arq-miniatura")).toHaveLength(1);
    expect(botao("Enviar fotos e vídeos")).toBeUndefined();
    expect(hospedeiro.querySelector(".arq-remover")).toBeNull();
    expect(hospedeiro.querySelector('input[type="file"]')).toBeNull();
  });

  it("grade com selo de vídeo e duração; a miniatura abre o popup no item certo", async () => {
    instalarFetch(() => ({
      corpo: {
        data: {
          arquivos: [
            arquivo({ id: "a" }),
            arquivo({ duracaoSegundos: 95, id: "b", mime: "video/mp4", nome: "tour.mp4", tipo: "video" }),
          ],
          destinos: [{ id: "37", rotulo: "VOC" }],
          podeEnviar: true,
        },
      },
    }));
    await montar(<ArquivosDoProduto emp="37" podeEditar />);

    expect(texto()).toContain("1 foto · 1 vídeo");
    expect(hospedeiro.querySelector(".arq-duracao")?.textContent).toBe("1:35");

    await act(async () => {
      botao("Abrir vídeo tour.mp4")?.click();
    });
    await esperarPromessas();

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector(".vdm-contador")?.textContent).toBe("2 de 2");
    expect(document.querySelector("video")?.getAttribute("src")).toBe("https://x/b.jpg");
  });

  it("remover pede confirmação e só então chama o DELETE", async () => {
    instalarFetch((c) =>
      c.method === "DELETE"
        ? { corpo: { data: { id: "a" } } }
        : {
            corpo: {
              data: {
                arquivos: [arquivo({ id: "a" }), arquivo({ id: "b" })],
                destinos: [{ id: "37", rotulo: "VOC" }],
                podeEnviar: true,
              },
            },
          },
    );
    await montar(<ArquivosDoProduto emp="37" podeEditar />);

    act(() => {
      botao("Remover foto a.jpg")?.click();
    });
    expect(hospedeiro.querySelector('[role="alertdialog"]')?.textContent).toContain("a.jpg");
    expect(chamadas.some((c) => c.method === "DELETE")).toBe(false);

    await act(async () => {
      botao("Remover")?.click();
    });
    await esperarPromessas();

    const apagar = chamadas.find((c) => c.method === "DELETE");
    expect(apagar?.url).toBe("/api/incorporador/produto/arquivos?emp=37&id=a");
    expect(hospedeiro.querySelector('[role="alertdialog"]')).toBeNull();
    expect(hospedeiro.querySelectorAll(".arq-miniatura")).toHaveLength(1);
  });

  it("formato recusado não chega a pedir assinatura", async () => {
    instalarFetch(() => ({
      corpo: { data: { arquivos: [], destinos: [{ id: "37", rotulo: "VOC" }], podeEnviar: true } },
    }));
    await montar(<ArquivosDoProduto emp="37" podeEditar />);

    const campo = hospedeiro.querySelector<HTMLInputElement>('input[type="file"]');
    // ⚠️ NÃO USE PDF AQUI: ele passou a ser ACEITO em 22/09/2026 (tipo `documento`).
    const pdf = new File(["x"], "tabela.zip", { type: "application/zip" });
    await act(async () => {
      Object.defineProperty(campo, "files", { configurable: true, value: [pdf] });
      campo?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await esperarPromessas();

    expect(texto()).toContain("Formato não aceito");
    expect(chamadas.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("envio em três passos: assina, grava DIRETO no Storage com progresso, registra e relê", async () => {
    let lista: ArquivoDoProduto[] = [];
    instalarFetch((c) => {
      if (c.method === "GET") {
        return {
          corpo: {
            data: {
              arquivos: lista,
              destinos: [
                { id: "33", rotulo: "LBF" },
                { id: "27", rotulo: "LBR" },
              ],
              podeEnviar: true,
            },
          },
        };
      }
      const corpo = c.body as { acao: string };
      if (corpo.acao === "preparar") {
        return {
          corpo: {
            data: {
              bucket: "produto-arquivos",
              id: UUID,
              mime: "image/jpeg",
              miniatura: null,
              original: {
                caminho: `27/${UUID}.jpg`,
                signedUrl: "https://projeto.supabase.co/storage/v1/object/upload/sign/produto-arquivos/x?token=t",
                token: "t",
              },
            },
          },
        };
      }
      lista = [arquivo({ id: UUID })];
      return { corpo: { data: { id: UUID } } };
    });

    const envios: Array<{ cabecalhos: Record<string, string>; corpo: unknown; url: string }> = [];
    class XhrFalso {
      status = 0;
      responseText = "";
      upload: { onprogress: null | ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) } =
        { onprogress: null };
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      private url = "";
      private cabecalhos: Record<string, string> = {};
      open(_metodo: string, url: string) {
        this.url = url;
      }
      setRequestHeader(nome: string, valor: string) {
        this.cabecalhos[nome] = valor;
      }
      send(corpo: unknown) {
        envios.push({ cabecalhos: this.cabecalhos, corpo, url: this.url });
        setTimeout(() => {
          this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
          this.status = 200;
          this.onload?.();
        }, 0);
      }
    }
    vi.stubGlobal("XMLHttpRequest", XhrFalso);

    await montar(<ArquivosDoProduto emp="pai:lab" podeEditar />);

    // Produto com duas divisões: o seletor aparece, e a escolha vai nos dois passos.
    const seletor = hospedeiro.querySelector<HTMLSelectElement>(".arq-destino select");
    expect(seletor).not.toBeNull();
    await act(async () => {
      if (seletor) {
        seletor.value = "27";
        seletor.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    const campo = hospedeiro.querySelector<HTMLInputElement>('input[type="file"]');
    expect(campo?.getAttribute("accept")).toBe("image/*,video/*,application/pdf");
    // Sem `type`: o tipo tem de ir no blob pelo MIME que a rota devolveu.
    const foto = new File(["conteudo"], "Portaria.JPG", { type: "" });
    await act(async () => {
      Object.defineProperty(campo, "files", { configurable: true, value: [foto] });
      campo?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    for (let i = 0; i < 5; i += 1) await esperarPromessas();

    const posts = chamadas.filter((c) => c.method === "POST").map((c) => c.body as Record<string, unknown>);
    expect(posts[0]).toMatchObject({
      acao: "preparar",
      comMiniatura: false,
      destino: "27",
      emp: "pai:lab",
      mime: "image/jpeg",
      nome: "Portaria.JPG",
      tamanho: foto.size,
    });
    // ⚠️ O ARQUIVO NÃO VAI NO CORPO DA ROTA.
    expect(JSON.stringify(posts)).not.toContain("conteudo");

    expect(envios).toHaveLength(1);
    expect(envios[0]?.url).toContain("/object/upload/sign/");
    expect(envios[0]?.cabecalhos).toMatchObject({ apikey: "chave-publica", "x-upsert": "false" });
    const formulario = envios[0]?.corpo as FormData;
    const parte = formulario.get("") as Blob;
    expect(parte.type).toBe("image/jpeg");
    expect(parte.size).toBe(foto.size);

    expect(posts[1]).toMatchObject({
      acao: "registrar",
      caminho: `27/${UUID}.jpg`,
      destino: "27",
      emp: "pai:lab",
      miniatura: null,
    });

    // Releu a lista, a foto apareceu e o aviso de envio concluído saiu.
    expect(chamadas.filter((c) => c.method === "GET").length).toBeGreaterThanOrEqual(2);
    expect(hospedeiro.querySelectorAll(".arq-miniatura")).toHaveLength(1);
    expect(hospedeiro.querySelector(".arq-envios")).toBeNull();
  });

  it("pela porta do Apolo, manda o Bearer do hub", async () => {
    let cabecalhos: HeadersInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        cabecalhos = init?.headers;
        return Promise.resolve(
          new Response(JSON.stringify({ data: { arquivos: [], destinos: [], podeEnviar: true } })),
        );
      }),
    );
    await montar(
      <ArquivosDoProduto
        api={{ rota: "/api/apolo/empreendimentos/arquivos", semToken: false }}
        emp="group:Lagoa Bonita"
        podeEditar={false}
      />,
    );
    expect(cabecalhos).toEqual({ Authorization: "Bearer token-do-hub" });
  });
});
