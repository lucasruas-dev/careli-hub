import { describe, expect, it, vi } from "vitest";

import type { NoDoDocumento } from "./documento-html";
import {
  type BuscaNaTemis,
  reassinarMidiasDoDocumento,
  ROTA_DE_MIDIA,
  SUBCAMINHO_DE_MIDIA,
} from "./reassinar-midias";

// RE-ASSINAR AS MÍDIAS PELA PORTA DA TELA.
//
// ⚠️ O QUE SE PROVA: que a chamada sai pelo `temisFetch` recebido, com o SUBCAMINHO (quem põe a
// base e a credencial é a porta — hub ou portal), que a mesma mídia repetida é pedida uma vez, e que
// falha de rede, de sessão ou de rota deixa a URL antiga em vez de derrubar a abertura da minuta.

const urlAssinada = (arquivo: string) =>
  `https://projeto.supabase.co/storage/v1/object/sign/apolo-documents/temis-minutas/m1/${arquivo}?token=velho`;

const documento = (): NoDoDocumento[] => [
  { children: [{ text: "Cláusula primeira" }], type: "p" },
  { children: [{ text: "" }], type: "img", url: urlAssinada("planta.png") },
  { children: [{ text: "" }], type: "img", url: urlAssinada("planta.png") },
  { children: [{ text: "" }], type: "file", url: urlAssinada("anexo.pdf") },
  // Fora do bucket: não é re-assinada nem pedida.
  { children: [{ text: "" }], type: "img", url: "https://outro.site/logo.png" },
];

const resposta = (corpo: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(corpo), { status }));

describe("reassinarMidiasDoDocumento", () => {
  it("a rota do hub continua sendo /api/temis + o subcaminho", () => {
    expect(ROTA_DE_MIDIA).toBe("/api/temis/minutas/upload");
    expect(SUBCAMINHO_DE_MIDIA).toBe("/minutas/upload");
  });

  it("pede cada mídia do bucket UMA vez, pelo subcaminho, e troca as URLs", async () => {
    const temisFetch = vi.fn<BuscaNaTemis>((subcaminho) =>
      resposta({ url: `https://nova/${subcaminho.includes("planta") ? "planta" : "anexo"}` }),
    );

    const novo = await reassinarMidiasDoDocumento(documento(), temisFetch);

    expect(temisFetch).toHaveBeenCalledTimes(2);
    expect(temisFetch.mock.calls.map((c) => c[0]).sort()).toEqual([
      "/minutas/upload?path=temis-minutas%2Fm1%2Fanexo.pdf&json=1",
      "/minutas/upload?path=temis-minutas%2Fm1%2Fplanta.png&json=1",
    ]);
    expect(temisFetch.mock.calls[0]?.[1]).toEqual({ cache: "no-store" });
    expect(novo.map((n) => n.url)).toEqual([
      undefined,
      "https://nova/planta",
      "https://nova/planta",
      "https://nova/anexo",
      "https://outro.site/logo.png",
    ]);
  });

  it("sem mídia do bucket, não chama nada e devolve o mesmo documento", async () => {
    const temisFetch = vi.fn(() => resposta({}));
    const nos: NoDoDocumento[] = [{ children: [{ text: "Só texto" }], type: "p" }];

    await expect(reassinarMidiasDoDocumento(nos, temisFetch)).resolves.toBe(nos);
    expect(temisFetch).not.toHaveBeenCalled();
  });

  it("sessão caída, rota recusando ou corpo torto: fica a URL antiga, e a minuta abre", async () => {
    const temisFetch = vi.fn((subcaminho: string) =>
      subcaminho.includes("planta")
        ? Promise.reject(new Error("Sessao administrativa ausente."))
        : resposta({ error: "Nao encontrado." }, 404),
    );

    const novo = await reassinarMidiasDoDocumento(documento(), temisFetch);

    expect(novo.map((n) => n.url)).toEqual(documento().map((n) => n.url));
  });
});
