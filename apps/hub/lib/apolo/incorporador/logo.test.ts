import { describe, expect, it } from "vitest";

import {
  chaveDoPortal,
  desfazerMovimentoDeLogo,
  formatoDaLogo,
  interpretarReferenciaDeLogo,
  LOGO_MAX_BYTES,
  migrarLogoDeSlug,
  montarReferenciaDeLogo,
  objetoDaLogoDoPortal,
  objetoDaReferencia,
  prepararArquivoDaLogo,
  referenciaAceitavelParaGravar,
  removerObjetoDaLogo,
  resolverLogoDoPortal,
  sanitizarSvg,
  subirLogoDoIncorporador,
} from "./logo";

const base64 = (texto: string): string => Buffer.from(texto, "utf8").toString("base64");
const pngValido = (): Uint8Array =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

describe("chaveDoPortal", () => {
  it("deixa passar o slug já normalizado", () => {
    expect(chaveDoPortal("cecilio-rocha")).toBe("cecilio-rocha");
    expect(chaveDoPortal("valedoouro")).toBe("valedoouro");
  });

  it("mata travessia de caminho — é o portão da rota pública", () => {
    // Sem isto, um `logo_path` fabricado viraria caminho para OUTRO objeto do bucket, onde moram
    // os documentos de CAD.
    expect(chaveDoPortal("../../apolo_documents")).toBe("apolo-documents");
    expect(chaveDoPortal("a/b")).toBe("a-b");
    expect(chaveDoPortal("..")).toBe("");
    expect(chaveDoPortal("%2e%2e")).toBe("2e-2e");
    expect(chaveDoPortal("logo\\..\\segredo")).toBe("logo-segredo");
  });

  it("normaliza acento, espaço e caixa como o cadastro faz", () => {
    expect(chaveDoPortal("Cecílio Rocha")).toBe("cecilio-rocha");
    expect(chaveDoPortal("  LAGOA  BONITA  ")).toBe("lagoa-bonita");
  });

  it("não deixa a chave crescer sem limite", () => {
    expect(chaveDoPortal("a".repeat(200))).toHaveLength(60);
  });

  it("devolve vazio quando não sobra nada aproveitável", () => {
    expect(chaveDoPortal("///")).toBe("");
    expect(chaveDoPortal("")).toBe("");
  });
});

describe("interpretarReferenciaDeLogo", () => {
  it("reconhece o arquivo do repo — o caso do Cecílio, EM PRODUÇÃO", () => {
    expect(interpretarReferenciaDeLogo("/marcas/cecilio-rocha.svg")).toEqual({
      href: "/marcas/cecilio-rocha.svg",
      tipo: "asset",
    });
  });

  it("recusa asset que sairia do nosso domínio ou subiria de pasta", () => {
    expect(interpretarReferenciaDeLogo("//evil.example/x.svg").tipo).toBe("invalido");
    expect(interpretarReferenciaDeLogo("/../../etc/passwd").tipo).toBe("invalido");
    expect(interpretarReferenciaDeLogo("/marcas\\..\\x.svg").tipo).toBe("invalido");
  });

  it("lê a referência de storage e o carimbo de versão", () => {
    expect(
      interpretarReferenciaDeLogo("storage:incorporador-logos/mmendes/clara.svg?v=1756000000000"),
    ).toEqual({
      chave: "mmendes",
      extensao: "svg",
      objeto: "incorporador-logos/mmendes/clara.svg",
      tipo: "storage",
      variante: "clara",
      versao: "1756000000000",
    });
  });

  it("aceita referência sem carimbo", () => {
    const ref = interpretarReferenciaDeLogo("storage:incorporador-logos/cer/escura.png");
    expect(ref.tipo === "storage" && ref.versao).toBe(null);
  });

  it("recusa tudo que não seja o padrão fechado de logo", () => {
    const lixo = [
      "storage:apolo_documents/entidade/123/rg.pdf",
      "storage:incorporador-logos/mmendes/../../entidade/1/rg.pdf",
      "storage:incorporador-logos/mmendes/clara.pdf",
      "storage:incorporador-logos/mmendes/clara.svg.exe",
      "storage:incorporador-logos/mmendes/qualquer.svg",
      "storage:incorporador-logos/mmendes/sub/pasta/clara.svg",
      "storage:incorporador-logos//clara.svg",
      "storage:incorporador-logos/MMENDES/clara.svg",
      "incorporador-logos/mmendes/clara.svg",
      "http://evil.example/logo.svg",
    ];
    for (const valor of lixo) {
      expect(interpretarReferenciaDeLogo(valor).tipo, valor).toBe("invalido");
    }
  });

  it("trata nulo e vazio como coluna sem logo", () => {
    expect(interpretarReferenciaDeLogo(null).tipo).toBe("vazio");
    expect(interpretarReferenciaDeLogo("   ").tipo).toBe("vazio");
  });

  it("ignora carimbo malformado sem invalidar a referência", () => {
    const ref = interpretarReferenciaDeLogo(
      "storage:incorporador-logos/cer/clara.svg?v=<script>",
    );
    expect(ref.tipo).toBe("storage");
    expect(ref.tipo === "storage" && ref.versao).toBe(null);
  });
});

describe("objetoDaLogoDoPortal — a decisão de segurança da rota pública", () => {
  it("devolve o caminho quando a referência é do próprio portal", () => {
    expect(
      objetoDaLogoDoPortal({
        referencia: "storage:incorporador-logos/mmendes/clara.svg?v=1",
        slug: "mmendes",
        variante: "clara",
      }),
    ).toEqual({ contentType: "image/svg+xml", objeto: "incorporador-logos/mmendes/clara.svg" });
  });

  it("NÃO serve a logo de um portal pela porta de outro", () => {
    // Mesmo com a referência errada gravada direto no banco, a porta de `cer` não entrega a
    // marca do `mmendes`.
    expect(
      objetoDaLogoDoPortal({
        referencia: "storage:incorporador-logos/mmendes/clara.svg",
        slug: "cer",
        variante: "clara",
      }),
    ).toBe(null);
  });

  it("NÃO vira proxy para outro objeto do bucket (documentos de CAD moram lá)", () => {
    const ataques = [
      "storage:apolo_documents/entidade/9/rg.pdf",
      "storage:incorporador-logos/cer/../../entidade/9/rg.pdf",
      "storage:entidade/9/rg.pdf",
      "/etc/passwd",
    ];
    for (const referencia of ataques) {
      expect(objetoDaLogoDoPortal({ referencia, slug: "cer", variante: "clara" }), referencia).toBe(
        null,
      );
    }
  });

  it("não troca a variante pedida pela gravada", () => {
    expect(
      objetoDaLogoDoPortal({
        referencia: "storage:incorporador-logos/cer/clara.svg",
        slug: "cer",
        variante: "escura",
      }),
    ).toBe(null);
  });

  it("recusa asset do repo — esse a página serve direto, a rota não", () => {
    expect(
      objetoDaLogoDoPortal({
        referencia: "/marcas/cecilio-rocha.svg",
        slug: "cecilio-rocha",
        variante: "clara",
      }),
    ).toBe(null);
  });

  it("recusa slug que não sobrevive à sanitização", () => {
    expect(
      objetoDaLogoDoPortal({
        referencia: "storage:incorporador-logos/cer/clara.svg",
        slug: "///",
        variante: "clara",
      }),
    ).toBe(null);
  });

  it("aponta o content-type pela extensão gravada, nunca pelo que o cliente disser", () => {
    expect(
      objetoDaLogoDoPortal({
        referencia: "storage:incorporador-logos/cer/clara.png",
        slug: "cer",
        variante: "clara",
      })?.contentType,
    ).toBe("image/png");
  });
});

describe("resolverLogoDoPortal — repo x storage", () => {
  it("MANTÉM o Cecílio no ar: caminho do repo continua asset estático", () => {
    expect(
      resolverLogoDoPortal({
        referencia: "/marcas/cecilio-rocha.svg",
        slug: "cecilio-rocha",
        variante: "clara",
      }),
    ).toBe("/marcas/cecilio-rocha.svg");
  });

  it("manda a referência de storage para a rota própria, com o carimbo de cache", () => {
    expect(
      resolverLogoDoPortal({
        referencia: "storage:incorporador-logos/mmendes/escura.png?v=1756000000000",
        slug: "mmendes",
        variante: "escura",
      }),
    ).toBe("/api/incorporador/mmendes/logo?variante=escura&v=1756000000000");
  });

  it("sem carimbo, a URL sai sem query de versão", () => {
    expect(
      resolverLogoDoPortal({
        referencia: "storage:incorporador-logos/cer/clara.svg",
        slug: "cer",
        variante: "clara",
      }),
    ).toBe("/api/incorporador/cer/logo?variante=clara");
  });

  it("coluna vazia ou lixo não vira src — o portal cai no nome escrito", () => {
    expect(resolverLogoDoPortal({ referencia: null, slug: "cer", variante: "clara" })).toBe(null);
    expect(
      resolverLogoDoPortal({ referencia: "cecilio.svg", slug: "cer", variante: "clara" }),
    ).toBe(null);
    expect(
      resolverLogoDoPortal({
        referencia: "storage:incorporador-logos/outro/clara.svg",
        slug: "cer",
        variante: "clara",
      }),
    ).toBe(null);
  });
});

describe("montarReferenciaDeLogo", () => {
  it("escreve o formato que o leitor entende (ida e volta)", () => {
    const ref = montarReferenciaDeLogo({
      extensao: "svg",
      slug: "Vista Alegre",
      variante: "clara",
      versao: 1756000000000,
    });
    expect(ref).toBe("storage:incorporador-logos/vista-alegre/clara.svg?v=1756000000000");
    expect(objetoDaLogoDoPortal({ referencia: ref, slug: "vista-alegre", variante: "clara" })).toEqual(
      { contentType: "image/svg+xml", objeto: "incorporador-logos/vista-alegre/clara.svg" },
    );
  });

  it("devolve nulo quando o slug não sobra nada", () => {
    expect(montarReferenciaDeLogo({ extensao: "png", slug: "///", variante: "clara" })).toBe(null);
  });
});

describe("referenciaAceitavelParaGravar", () => {
  it("aceita o asset do repo e a referência do próprio portal", () => {
    expect(referenciaAceitavelParaGravar("/marcas/cecilio-rocha.svg", "cecilio-rocha")).toEqual({
      ok: true,
      valor: "/marcas/cecilio-rocha.svg",
    });
    expect(
      referenciaAceitavelParaGravar("storage:incorporador-logos/cer/clara.svg?v=9", "cer"),
    ).toEqual({ ok: true, valor: "storage:incorporador-logos/cer/clara.svg?v=9" });
  });

  it("nulo grava nulo (é assim que o operador remove a logo)", () => {
    expect(referenciaAceitavelParaGravar(null, "cer")).toEqual({ ok: true, valor: null });
  });

  it("recusa referência de OUTRO portal e string arbitrária", () => {
    expect(referenciaAceitavelParaGravar("storage:incorporador-logos/mmendes/clara.svg", "cer").ok).toBe(
      false,
    );
    expect(referenciaAceitavelParaGravar("storage:entidade/9/rg.pdf", "cer").ok).toBe(false);
    expect(referenciaAceitavelParaGravar("javascript:alert(1)", "cer").ok).toBe(false);
  });
});

describe("formatoDaLogo — o formato sai do CONTEÚDO, não do que o navegador disse", () => {
  it("reconhece PNG pela assinatura", () => {
    expect(formatoDaLogo({ bytes: pngValido(), contentType: "application/octet-stream" })).toEqual({
      extensao: "png",
      ok: true,
    });
  });

  it("reconhece SVG mesmo com content-type vazio", () => {
    const bytes = new Uint8Array(Buffer.from('<?xml version="1.0"?><svg xmlns="x"/>', "utf8"));
    expect(formatoDaLogo({ bytes, contentType: "" })).toEqual({ extensao: "svg", ok: true });
  });

  it("recusa HTML disfarçado de .svg", () => {
    const bytes = new Uint8Array(Buffer.from("<html><body>oi</body></html>", "utf8"));
    const r = formatoDaLogo({ bytes, contentType: "image/svg+xml", nomeArquivo: "marca.svg" });
    expect(r.ok).toBe(false);
  });

  it("recusa JPEG e PDF com recado de conversão", () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]);
    const r = formatoDaLogo({ bytes, contentType: "image/jpeg", nomeArquivo: "marca.jpg" });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.erro).toContain("Converta");
  });

  it("recusa arquivo acima do teto", () => {
    const bytes = new Uint8Array(LOGO_MAX_BYTES + 1);
    bytes.set(pngValido(), 0);
    const r = formatoDaLogo({ bytes });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.erro).toContain("2MB");
  });

  it("recusa arquivo vazio", () => {
    expect(formatoDaLogo({ bytes: new Uint8Array(0) }).ok).toBe(false);
  });
});

describe("sanitizarSvg — SVG é executável", () => {
  it("tira <script> do arquivo", () => {
    const r = sanitizarSvg('<svg xmlns="x"><script>fetch("/api/roubo")</script><rect/></svg>');
    expect(r.ok).toBe(true);
    expect(r.ok && r.svg).not.toContain("script");
    expect(r.ok && r.svg).toContain("<rect/>");
  });

  it("tira handler de evento em qualquer aspa", () => {
    const r = sanitizarSvg(
      `<svg xmlns="x" onload="alert(1)"><a onclick='x()'><rect onmouseover=y() /></a></svg>`,
    );
    expect(r.ok && r.svg).not.toMatch(/onload|onclick|onmouseover/i);
  });

  it("tira href javascript: e <foreignObject>", () => {
    const r = sanitizarSvg(
      '<svg xmlns="x"><a xlink:href="javascript:alert(1)">t</a><foreignObject><iframe src="x"/></foreignObject></svg>',
    );
    expect(r.ok && r.svg).not.toContain("javascript:");
    expect(r.ok && r.svg).not.toMatch(/foreignObject|iframe/i);
  });

  it("RECUSA entidade XML em vez de tentar limpar (XXE / billion laughs)", () => {
    const r = sanitizarSvg('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg/>');
    expect(r.ok).toBe(false);
  });

  it("recusa o que nem parece SVG", () => {
    expect(sanitizarSvg("<html></html>").ok).toBe(false);
  });

  it("não estraga um SVG honesto", () => {
    const arte =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10H0z" fill="#A07C3B"/></svg>';
    const r = sanitizarSvg(arte);
    expect(r.ok && r.svg).toBe(arte);
  });
});

describe("prepararArquivoDaLogo — o funil inteiro", () => {
  it("passa um SVG e devolve a versão limpa", () => {
    const r = prepararArquivoDaLogo({
      fileBase64: base64('<svg xmlns="x"><script>1</script><rect/></svg>'),
    });
    expect(r.ok).toBe(true);
    expect(r.ok && Buffer.from(r.bytes).toString("utf8")).toBe('<svg xmlns="x"><rect/></svg>');
    expect(r.ok && r.extensao).toBe("svg");
  });

  it("aceita o dataURL que o FileReader do navegador produz", () => {
    const r = prepararArquivoDaLogo({
      fileBase64: `data:image/svg+xml;base64,${base64('<svg xmlns="x"/>')}`,
    });
    expect(r.ok).toBe(true);
  });

  it("corta pelo tamanho ANTES de decodificar (a Vercel corta em ~4,5MB sem mensagem)", () => {
    const r = prepararArquivoDaLogo({ fileBase64: "A".repeat(5_000_000) });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.erro).toContain("2MB");
  });

  it("recusa base64 vazio", () => {
    expect(prepararArquivoDaLogo({ fileBase64: "" }).ok).toBe(false);
  });

  it("recusa formato que não é SVG nem PNG", () => {
    expect(prepararArquivoDaLogo({ fileBase64: base64("%PDF-1.4 nada") }).ok).toBe(false);
  });
});

// ── AS CORREÇÕES DA REVISÃO ──────────────────────────────────────────────────────────────────
// O que vem daqui para baixo cobre os furos achados na revisão do lote da logo, e cada bloco
// nomeia o cenário real que o furo produzia.

/**
 * Dublê do cliente admin com a superfície de storage que este arquivo usa. Grava as chamadas para
 * o teste conferir ORDEM e ARGUMENTO — que é onde moravam dois dos problemas.
 */
function storageFalso(opcoes: { falharUpload?: boolean } = {}) {
  const chamadas: { args: string[]; op: string }[] = [];
  const api = {
    download: async () => ({ data: null, error: { message: "x" } }),
    move: async (de: string, para: string) => {
      chamadas.push({ args: [de, para], op: "move" });
      return { error: null };
    },
    remove: async (caminhos: string[]) => {
      chamadas.push({ args: caminhos, op: "remove" });
      return { error: null };
    },
    upload: async (caminho: string) => {
      chamadas.push({ args: [caminho], op: "upload" });
      return opcoes.falharUpload ? { error: { message: "storage fora" } } : { error: null };
    },
  };
  return {
    chamadas,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dublê de teste
    client: { storage: { from: () => api } } as any,
  };
}

describe("subirLogoDoIncorporador — a ordem entre subir e limpar", () => {
  it("SOBE PRIMEIRO e só depois varre a outra extensão", async () => {
    const { chamadas, client } = storageFalso();
    const r = await subirLogoDoIncorporador({
      adminClient: client,
      fileBase64: base64('<svg xmlns="x"/>'),
      slug: "cer",
      variante: "clara",
    });

    expect(r.ok).toBe(true);
    expect(chamadas.map((c) => c.op)).toEqual(["upload", "remove"]);
    expect(chamadas[0]?.args[0]).toBe("incorporador-logos/cer/clara.svg");
    expect(chamadas[1]?.args).toEqual(["incorporador-logos/cer/clara.png"]);
  });

  it("upload que falha NÃO apaga o arquivo que estava no ar", async () => {
    // O cenário: portal com `clara.png` gravado, operador sobe um SVG, o storage cai no meio.
    // Apagando antes, a porta perdia a marca sem ninguém ter salvo nada.
    const { chamadas, client } = storageFalso({ falharUpload: true });
    const r = await subirLogoDoIncorporador({
      adminClient: client,
      fileBase64: base64('<svg xmlns="x"/>'),
      slug: "cer",
      variante: "clara",
    });

    expect(r.ok).toBe(false);
    expect(chamadas.some((c) => c.op === "remove")).toBe(false);
  });
});

describe("migrarLogoDeSlug — o move precisa ser desfazível", () => {
  it("devolve o de-para quando move de verdade", async () => {
    const { client } = storageFalso();
    const r = await migrarLogoDeSlug({
      adminClient: client,
      referencia: "storage:incorporador-logos/antigo/clara.svg?v=7",
      slugDestino: "novo",
    });

    expect(r.ok).toBe(true);
    expect(r.ok && r.movido).toEqual({
      de: "incorporador-logos/antigo/clara.svg",
      para: "incorporador-logos/novo/clara.svg",
    });
    expect(r.ok && r.referencia).toMatch(/^storage:incorporador-logos\/novo\/clara\.svg\?v=\d+$/);
  });

  it("não inventa movimento quando não houve nenhum", async () => {
    const { chamadas, client } = storageFalso();

    // Mesmo slug: nada a mover.
    const igual = await migrarLogoDeSlug({
      adminClient: client,
      referencia: "storage:incorporador-logos/cer/clara.svg",
      slugDestino: "cer",
    });
    expect(igual.ok && igual.movido).toBeUndefined();

    // O Cecílio: asset do repo, o arquivo é do deploy e não do bucket.
    const asset = await migrarLogoDeSlug({
      adminClient: client,
      referencia: "/marcas/cecilio-rocha.svg",
      slugDestino: "outro-nome",
    });
    expect(asset.ok && asset.referencia).toBe("/marcas/cecilio-rocha.svg");
    expect(asset.ok && asset.movido).toBeUndefined();

    expect(chamadas).toEqual([]);
  });

  it("desfazerMovimentoDeLogo devolve o objeto para o caminho de origem", async () => {
    const { chamadas, client } = storageFalso();
    await desfazerMovimentoDeLogo(client, {
      de: "incorporador-logos/antigo/clara.svg",
      para: "incorporador-logos/novo/clara.svg",
    });

    expect(chamadas).toEqual([
      {
        args: ["incorporador-logos/novo/clara.svg", "incorporador-logos/antigo/clara.svg"],
        op: "move",
      },
    ]);
  });

  it("desfazer NÃO toca no bucket com caminho fora do padrão de logo", async () => {
    const { chamadas, client } = storageFalso();
    await desfazerMovimentoDeLogo(client, {
      de: "entidade/9/rg.pdf",
      para: "incorporador-logos/cer/clara.svg",
    });
    expect(chamadas).toEqual([]);
  });
});

describe("removerObjetoDaLogo — o portão antes de apagar", () => {
  it("apaga o objeto de logo", async () => {
    const { chamadas, client } = storageFalso();
    await removerObjetoDaLogo(client, "incorporador-logos/cer/escura.png");
    expect(chamadas).toEqual([
      { args: ["incorporador-logos/cer/escura.png"], op: "remove" },
    ]);
  });

  it("RECUSA qualquer caminho que não seja logo — documento de CAD mora no mesmo bucket", async () => {
    const { chamadas, client } = storageFalso();
    for (const caminho of [
      "entidade/9/rg.pdf",
      "incorporador-logos/cer/clara.pdf",
      "incorporador-logos/cer/../../entidade/9/rg.pdf",
      "enterprise-logos/35/logo.png",
      "",
    ]) {
      await removerObjetoDaLogo(client, caminho);
    }
    expect(chamadas).toEqual([]);
  });
});

describe("objetoDaReferencia — comparar objeto, não a string com carimbo", () => {
  it("tira o carimbo, para o mesmo arquivo não parecer dois", () => {
    expect(objetoDaReferencia("storage:incorporador-logos/cer/clara.svg?v=1")).toBe(
      "incorporador-logos/cer/clara.svg",
    );
    expect(objetoDaReferencia("storage:incorporador-logos/cer/clara.svg?v=999")).toBe(
      "incorporador-logos/cer/clara.svg",
    );
  });

  it("asset do repo e coluna vazia não têm objeto no bucket — o Cecílio nunca é apagado", () => {
    expect(objetoDaReferencia("/marcas/cecilio-rocha.svg")).toBe(null);
    expect(objetoDaReferencia(null)).toBe(null);
    expect(objetoDaReferencia("qualquer coisa")).toBe(null);
  });
});

describe("formatoDaLogo — HTML não passa por trazer um <svg> no meio", () => {
  it("recusa página HTML com ícone SVG embutido", () => {
    const bytes = new Uint8Array(
      Buffer.from('<!DOCTYPE html><html><body><svg xmlns="x"/></body></html>', "utf8"),
    );
    expect(formatoDaLogo({ bytes, nomeArquivo: "marca.svg" }).ok).toBe(false);
  });

  it("recusa tag parecida que não é <svg>", () => {
    const bytes = new Uint8Array(Buffer.from("<svgx>nao</svgx>", "utf8"));
    expect(formatoDaLogo({ bytes }).ok).toBe(false);
  });

  it("continua aceitando SVG honesto com prólogo XML e comentário", () => {
    const bytes = new Uint8Array(
      Buffer.from('<?xml version="1.0"?><!-- arte --><svg xmlns="x"/>', "utf8"),
    );
    expect(formatoDaLogo({ bytes }).ok).toBe(true);
  });
});
