import { describe, expect, it } from "vitest";

import {
  caminhoDaMiniatura,
  caminhoDoArquivo,
  conferirArquivoDoProduto,
  destinoDoEnvio,
  destinoPedidoNoCorpo,
  dimensoesDaMiniatura,
  duracaoEscrita,
  extensaoDoMime,
  idDeDestinoValido,
  legendaSegura,
  LIMITE_EM_BYTES,
  lerCaminhoDoArquivo,
  metadadosSeguros,
  mimeDoArquivo,
  miniaturaCombina,
  momentoDoQuadro,
  nomeSeguro,
  ordenarArquivos,
  resumoDaGaleria,
  rotulosDosDestinos,
  tamanhoEscrito,
  tipoDoArquivo,
} from "./arquivos-do-produto";

const MIB = 1024 * 1024;
const UUID = "0b9f3c1e-7d2a-4c55-9a61-3f0e8b7c2d14";

describe("formato do arquivo", () => {
  it("reconhece os formatos aceitos pelo MIME declarado", () => {
    expect(tipoDoArquivo("portaria.jpg", "image/jpeg")).toBe("imagem");
    expect(tipoDoArquivo("x.png", "image/png")).toBe("imagem");
    expect(tipoDoArquivo("x.webp", "image/webp")).toBe("imagem");
    expect(tipoDoArquivo("IMG_0001.HEIC", "image/heic")).toBe("imagem");
    expect(tipoDoArquivo("tour.mp4", "video/mp4")).toBe("video");
    expect(tipoDoArquivo("IMG_0002.MOV", "video/quicktime")).toBe("video");
    expect(tipoDoArquivo("x.webm", "video/webm")).toBe("video");
  });

  it("normaliza apelidos e parâmetros do MIME", () => {
    expect(mimeDoArquivo("x.jpg", "image/jpg")).toBe("image/jpeg");
    expect(mimeDoArquivo("x.jpg", "IMAGE/JPEG; charset=binary")).toBe("image/jpeg");
    expect(mimeDoArquivo("x.m4v", "video/x-m4v")).toBe("video/mp4");
  });

  it("cai na extensão quando o navegador não diz o tipo (HEIC arrastado no Windows)", () => {
    expect(mimeDoArquivo("IMG_0001.HEIC", "")).toBe("image/heic");
    expect(mimeDoArquivo("video.mov", "application/octet-stream")).toBe("video/quicktime");
    expect(mimeDoArquivo("sem-extensao", "")).toBeNull();
  });

  it("recusa formato fora da lista mesmo com extensão aceita (o MIME declarado manda)", () => {
    expect(mimeDoArquivo("anima.gif", "image/gif")).toBeNull();
    expect(mimeDoArquivo("foto.jpg", "image/gif")).toBeNull();
    expect(tipoDoArquivo("filme.avi", "video/x-msvideo")).toBeNull();
    expect(tipoDoArquivo("tabela.xlsx", "application/vnd.ms-excel")).toBeNull();
    // ⚠️ O PDF SAIU DESTA LISTA EM 22/09/2026: virou o tipo `documento`, para a apresentação
    // comercial caber na aba. Ver o teste "o PDF entra como documento", abaixo.
  });

  it("a extensão do caminho sai do MIME canônico, nunca do nome", () => {
    expect(extensaoDoMime("image/jpeg")).toBe("jpg");
    expect(extensaoDoMime("video/quicktime")).toBe("mov");
    expect(extensaoDoMime("image/gif")).toBeNull();
  });
});

describe("conferirArquivoDoProduto", () => {
  it("aceita foto até 25 MB e vídeo até 500 MB", () => {
    expect(
      conferirArquivoDoProduto({ mime: "image/jpeg", nome: "a.jpg", tamanho: LIMITE_EM_BYTES.imagem }),
    ).toEqual({ extensao: "jpg", mime: "image/jpeg", ok: true, tipo: "imagem" });
    expect(
      conferirArquivoDoProduto({ mime: "video/mp4", nome: "a.mp4", tamanho: LIMITE_EM_BYTES.video }),
    ).toEqual({ extensao: "mp4", mime: "video/mp4", ok: true, tipo: "video" });
  });

  it("recusa acima do teto de CADA tipo (foto de 30 MB não passa pelo teto do vídeo)", () => {
    const foto = conferirArquivoDoProduto({ mime: "image/png", nome: "a.png", tamanho: 30 * MIB });
    expect(foto).toEqual({ motivo: "Cada foto pode ter até 25 MB.", ok: false });

    const video = conferirArquivoDoProduto({
      mime: "video/mp4",
      nome: "a.mp4",
      tamanho: 500 * MIB + 1,
    });
    expect(video).toEqual({ motivo: "Cada vídeo pode ter até 500 MB.", ok: false });
  });

  it("recusa vazio, tamanho inválido e formato desconhecido", () => {
    expect(conferirArquivoDoProduto({ mime: "image/jpeg", nome: "a.jpg", tamanho: 0 }).ok).toBe(false);
    expect(conferirArquivoDoProduto({ mime: "image/jpeg", nome: "a.jpg", tamanho: Number.NaN }).ok).toBe(
      false,
    );
    const zip = conferirArquivoDoProduto({ mime: "application/zip", nome: "a.zip", tamanho: 10 });
    expect(zip.ok).toBe(false);
  });
});

describe("o PDF entra como documento", () => {
  // Lucas (22/09/2026), com a apresentacao do Garden Resort: *"tem uma apresentacao tambem sobe
  // ela"* e, escolhendo a forma, *"um arquivo so: o PDF"*.
  it("reconhece o tipo pelo MIME e pela extensao", () => {
    expect(tipoDoArquivo("apresentacao.pdf", "application/pdf")).toBe("documento");
    // O navegador que nao diz o tipo (acontece no Windows) cai na extensao.
    expect(tipoDoArquivo("apresentacao.pdf", "")).toBe("documento");
    expect(extensaoDoMime("application/pdf")).toBe("pdf");
  });

  it("aceita ate 200 MB, e recusa acima disso", () => {
    const cabe = conferirArquivoDoProduto({
      mime: "application/pdf",
      nome: "garden.pdf",
      // A apresentacao que motivou o tipo tem 124 MB.
      tamanho: 124 * 1024 * 1024,
    });
    expect(cabe.ok).toBe(true);
    expect(cabe.ok ? cabe.tipo : null).toBe("documento");

    const grande = conferirArquivoDoProduto({
      mime: "application/pdf",
      nome: "enorme.pdf",
      tamanho: 201 * 1024 * 1024,
    });
    expect(grande.ok).toBe(false);
  });
});

describe("nomeSeguro", () => {
  it("tira pasta, controle e espaço repetido", () => {
    expect(nomeSeguro("C:\\fotos\\portaria.jpg")).toBe("portaria.jpg");
    expect(nomeSeguro("/tmp/../area   de\tlazer.png")).toBe("area de lazer.png");
    expect(nomeSeguro("a\u0000b.jpg")).toBe("ab.jpg");
  });

  it("nome vazio ou só pontos vira 'arquivo'", () => {
    expect(nomeSeguro("")).toBe("arquivo");
    expect(nomeSeguro(null)).toBe("arquivo");
    expect(nomeSeguro("..")).toBe("arquivo");
  });

  it("corta nome enorme preservando a extensão", () => {
    const nome = nomeSeguro(`${"a".repeat(300)}.jpeg`);
    expect(nome.length).toBe(120);
    expect(nome.endsWith(".jpeg")).toBe(true);
  });
});

describe("caminho no bucket", () => {
  it("monta <enterprise_id>/<uuid>.<ext> e a miniatura <uuid>.thumb.jpg", () => {
    expect(caminhoDoArquivo("37", UUID, "jpg")).toBe(`37/${UUID}.jpg`);
    expect(caminhoDaMiniatura("39", UUID.toUpperCase())).toBe(`39/${UUID}.thumb.jpg`);
  });

  it("id de grupo, de pai ou com barra não vira pasta", () => {
    expect(idDeDestinoValido("37")).toBe(true);
    expect(idDeDestinoValido("group:Lagoa Bonita")).toBe(false);
    expect(idDeDestinoValido("pai:0b9f3c1e")).toBe(false);
    expect(idDeDestinoValido("../39")).toBe(false);
    expect(idDeDestinoValido("")).toBe(false);
  });

  it("lê de volta o caminho que o preparar produziu", () => {
    expect(lerCaminhoDoArquivo(`37/${UUID}.mov`, "37")).toEqual({
      extensao: "mov",
      mime: "video/quicktime",
      tipo: "video",
      uuid: UUID,
    });
  });

  it("recusa caminho de OUTRO empreendimento (o forjado do registrar)", () => {
    expect(lerCaminhoDoArquivo(`37/${UUID}.jpg`, "39")).toBeNull();
    expect(lerCaminhoDoArquivo(`39/../37/${UUID}.jpg`, "39")).toBeNull();
  });

  it("recusa forma que o preparar não produz", () => {
    expect(lerCaminhoDoArquivo(`37/${UUID}.thumb.jpg`, "37")).toBeNull();
    expect(lerCaminhoDoArquivo(`37/${UUID}.jpeg`, "37")).toBeNull();
    expect(lerCaminhoDoArquivo(`37/${UUID}.gif`, "37")).toBeNull();
    expect(lerCaminhoDoArquivo(`37/nao-e-uuid.jpg`, "37")).toBeNull();
    expect(lerCaminhoDoArquivo(`37/${UUID.toUpperCase()}.jpg`, "37")).toBeNull();
    expect(lerCaminhoDoArquivo(`37/sub/${UUID}.jpg`, "37")).toBeNull();
    expect(lerCaminhoDoArquivo("", "37")).toBeNull();
  });

  it("a miniatura só combina com o arquivo da mesma pasta e do mesmo uuid", () => {
    expect(miniaturaCombina(`37/${UUID}.thumb.jpg`, "37", UUID)).toBe(true);
    expect(miniaturaCombina(`39/${UUID}.thumb.jpg`, "37", UUID)).toBe(false);
    expect(
      miniaturaCombina("37/11111111-2222-4333-8444-555555555555.thumb.jpg", "37", UUID),
    ).toBe(false);
    expect(miniaturaCombina(null, "37", UUID)).toBe(false);
  });
});

describe("destinoDoEnvio", () => {
  it("um id real só: ele (o caso do Cecílio, VOC e Garden)", () => {
    expect(destinoDoEnvio(["37"])).toBe("37");
    expect(destinoDoEnvio(["39", "39"])).toBe("39");
  });

  it("o id de grupo não conta como destino", () => {
    expect(destinoDoEnvio(["33", "group:Lagoa Bonita"])).toBe("33");
  });

  it("vários ids reais: sem escolha, nenhum (não escolhe o primeiro por conta própria)", () => {
    expect(destinoDoEnvio(["33", "27", "32", "group:Lagoa Bonita"])).toBeNull();
    expect(destinoDoEnvio(["33", "27"], "27")).toBe("27");
  });

  it("escolha fora do recorte é recusada, mesmo com um id só", () => {
    expect(destinoDoEnvio(["37"], "39")).toBeNull();
    expect(destinoDoEnvio(["33", "27"], "group:Lagoa Bonita")).toBeNull();
    expect(destinoDoEnvio([], "37")).toBeNull();
  });
});

describe("destinoPedidoNoCorpo", () => {
  it("usa o destino escolhido", () => {
    expect(destinoPedidoNoCorpo({ acao: "preparar", destino: " 37 " })).toBe("37");
  });

  it("no registrar sem escolha, usa a pasta do caminho", () => {
    expect(destinoPedidoNoCorpo({ acao: "registrar", caminho: `39/${UUID}.jpg` })).toBe("39");
  });

  it("no preparar sem escolha, nada", () => {
    expect(destinoPedidoNoCorpo({ acao: "preparar", caminho: `39/${UUID}.jpg` })).toBeNull();
    expect(destinoPedidoNoCorpo({ acao: "registrar", caminho: 42 })).toBeNull();
  });
});

describe("rotulosDosDestinos", () => {
  it("prefere o código do cadastro, depois o do catálogo, depois o id", () => {
    const cadastro = [
      { c2xEnterpriseId: "37", codigo: "VOC", nome: "Vale do Ouro Cecílio" },
      { c2xEnterpriseId: null, codigo: "LOX", nome: "Lavra do Ouro" },
    ];
    const catalogo = [{ codes: ["LBF", "LBR"], stageIds: ["33", "27"] }];

    expect(rotulosDosDestinos(["37", "27", "99", "group:Lagoa Bonita"], cadastro, catalogo)).toEqual([
      { id: "37", rotulo: "VOC · Vale do Ouro Cecílio" },
      { id: "27", rotulo: "LBR" },
      { id: "99", rotulo: "99" },
    ]);
  });
});

describe("ordenarArquivos", () => {
  it("ordem manual primeiro; sem ordem, o mais novo primeiro; empate pelo id", () => {
    const lista = [
      { criadoEm: "2026-09-10T10:00:00Z", id: "a", ordem: null },
      { criadoEm: "2026-09-16T10:00:00Z", id: "b", ordem: null },
      { criadoEm: "2026-09-01T10:00:00Z", id: "c", ordem: 2 },
      { criadoEm: "2026-09-01T10:00:00Z", id: "d", ordem: 1 },
      { criadoEm: "2026-09-16T10:00:00Z", id: "a2", ordem: null },
    ];
    expect(ordenarArquivos(lista).map((x) => x.id)).toEqual(["d", "c", "a2", "b", "a"]);
  });

  it("não muda a lista recebida", () => {
    const lista = [
      { criadoEm: "2026-09-10T10:00:00Z", id: "a", ordem: null },
      { criadoEm: "2026-09-16T10:00:00Z", id: "b", ordem: null },
    ];
    ordenarArquivos(lista);
    expect(lista.map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("metadados e legenda", () => {
  it("aceita só números plausíveis e duração só em vídeo", () => {
    expect(metadadosSeguros({ altura: 1080, duracao: 12.487, largura: "1920", tipo: "video" })).toEqual(
      { altura: 1080, duracaoSegundos: 12.49, largura: 1920 },
    );
    expect(metadadosSeguros({ altura: 3000, duracao: 12, largura: 4000, tipo: "imagem" })).toEqual({
      altura: 3000,
      duracaoSegundos: null,
      largura: 4000,
    });
    expect(metadadosSeguros({ altura: -5, duracao: "abc", largura: 0, tipo: "video" })).toEqual({
      altura: null,
      duracaoSegundos: null,
      largura: null,
    });
    expect(metadadosSeguros({ duracao: Number.POSITIVE_INFINITY, tipo: "video" }).duracaoSegundos).toBeNull();
  });

  it("legenda limpa, cortada em 200 e vazia vira null", () => {
    expect(legendaSegura("  Área\nde   lazer ")).toBe("Área de lazer");
    expect(legendaSegura("   ")).toBeNull();
    expect(legendaSegura(null)).toBeNull();
    expect(legendaSegura("x".repeat(500))?.length).toBe(200);
  });
});

describe("miniatura", () => {
  it("reduz para o lado maior caber em 480, mantendo a proporção", () => {
    expect(dimensoesDaMiniatura(4032, 3024)).toEqual({ altura: 360, largura: 480 });
    expect(dimensoesDaMiniatura(1080, 1920)).toEqual({ altura: 480, largura: 270 });
  });

  it("nunca amplia foto pequena", () => {
    expect(dimensoesDaMiniatura(320, 200)).toEqual({ altura: 200, largura: 320 });
  });

  it("medida inválida devolve zero (quem chama não desenha)", () => {
    expect(dimensoesDaMiniatura(0, 100)).toEqual({ altura: 0, largura: 0 });
    expect(dimensoesDaMiniatura(Number.NaN, 100)).toEqual({ altura: 0, largura: 0 });
  });

  it("o quadro do vídeo sai perto de 1 s, ou do meio quando o vídeo é curto", () => {
    expect(momentoDoQuadro(95)).toBe(1);
    expect(momentoDoQuadro(1.5)).toBe(0.75);
    expect(momentoDoQuadro(0)).toBe(0);
    expect(momentoDoQuadro(Number.NaN)).toBe(0);
  });
});

describe("textos da tela", () => {
  it("duração em m:ss e h:mm:ss", () => {
    expect(duracaoEscrita(7)).toBe("0:07");
    expect(duracaoEscrita(65.4)).toBe("1:05");
    expect(duracaoEscrita(3723)).toBe("1:02:03");
    expect(duracaoEscrita(null)).toBe("0:00");
  });

  it("tamanho com vírgula", () => {
    expect(tamanhoEscrito(830 * 1024)).toBe("830 KB");
    expect(tamanhoEscrito(4.2 * MIB)).toBe("4,2 MB");
    expect(tamanhoEscrito(1.3 * 1024 * MIB)).toBe("1,3 GB");
    expect(tamanhoEscrito(0)).toBe("0 KB");
  });

  it("resumo da galeria no singular e no plural", () => {
    expect(resumoDaGaleria([])).toBe("Nenhum arquivo");
    expect(resumoDaGaleria([{ tipo: "imagem" }])).toBe("1 foto");
    expect(resumoDaGaleria([{ tipo: "imagem" }, { tipo: "imagem" }, { tipo: "video" }])).toBe(
      "2 fotos · 1 vídeo",
    );
    expect(resumoDaGaleria([{ tipo: "video" }, { tipo: "video" }])).toBe("2 vídeos");
  });
});
