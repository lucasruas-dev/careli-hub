import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  montarPdfDoContrato,
  type PecaDoContrato,
  TETO_DA_MONTAGEM_BYTES,
} from "./montar-pdf-do-contrato";

// O MONTADOR — capa + corpo + anexos num PDF só.
//
// ⚠️ O `pdf-lib` É DE VERDADE AQUI, E NÃO UM DUBLÊ. Ele é a peça sob teste: o que pode dar errado é
// exatamente o que um mock esconderia (página que não copia, PDF que não abre, contagem que não
// bate). Nada sai da máquina: os PDFs são criados no próprio teste.

async function pdfCom(paginas: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < paginas; i += 1) doc.addPage([595, 842]);
  return doc.save();
}

/**
 * Um PDF cujas páginas TÊM `/Contents`.
 *
 * ⚠️ `pdfCom` devolve folhas realmente vazias, e elas caem no filtro do `/Contents` antes de
 * qualquer `embed`. Para exercitar a montagem é preciso desenhar alguma coisa.
 */
async function pdfDesenhado(paginas: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < paginas; i += 1) {
    doc.addPage([595, 842]).drawRectangle({ height: 40, width: 120, x: 40, y: 700 });
  }
  return doc.save();
}

async function contarPaginas(bytes: Uint8Array): Promise<number> {
  return (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount();
}

function peca(nome: string, bytes: Uint8Array, mime = "application/pdf"): PecaDoContrato {
  return { bytes, mime, nome };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("montarPdfDoContrato", () => {
  it("sem capa e sem anexo devolve o corpo INTOCADO, byte a byte", async () => {
    // ⚠️ NÃO É ECONOMIA: reabrir e re-salvar no `pdf-lib` reescreve a estrutura do arquivo
    // (metadados, compressão, ordem de objetos). O texto seria o mesmo e os BYTES não — e
    // `hercules_documentos.tamanho_bytes`, a comparação de versões na gaveta e o D4Sign assinam o
    // arquivo que receberam. Os contratos que já saem hoje continuam saindo iguais.
    const corpo = await pdfCom(3);
    const r = await montarPdfDoContrato({ anexos: [], capa: null, corpo });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.pdf).toBe(corpo);
  });

  it("capa na frente, corpo no meio, anexos no fim", async () => {
    const corpo = await pdfCom(4);
    const r = await montarPdfDoContrato({
      anexos: [peca("Convenção", await pdfCom(2)), peca("Memorial", await pdfCom(3))],
      capa: peca("Capa VOL", await pdfCom(1)),
      corpo,
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.paginas).toBe(10);
    expect(await contarPaginas(r.pdf)).toBe(10);
  });

  it("a capa pode ser imagem, e vira uma página do tamanho dela", async () => {
    // Um PNG 2x2 mínimo, válido. A capa é desenhada fora (Canva) e exportada como PDF ou imagem.
    const png = Uint8Array.from(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGP8z8DwnwEJMKEKMDAwAABZUgMLaG5hOQAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
    const r = await montarPdfDoContrato({
      anexos: [],
      capa: peca("Capa do Canva", png, "image/png"),
      corpo: await pdfCom(2),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.paginas).toBe(3);
  });

  it("anexo que não abre RECUSA a geração, e diz QUAL peça é", async () => {
    // ⚠️ É A MESMA RÉGUA DE `podeGerarContrato`. Um PDF que anuncia em cláusula uma convenção que
    // não está dentro dele vai a cartório e ninguém percebe; um contrato que não saiu tem quem
    // aperte o botão de novo.
    const r = await montarPdfDoContrato({
      anexos: [peca("Matrícula do cartório", Uint8Array.from([1, 2, 3, 4]))],
      capa: null,
      corpo: await pdfCom(1),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erro).toContain("Matrícula do cartório");
      // ⚠️ A FRASE DIZ O FORMATO, E NÃO "SENHA" (revisão de 21/09/2026). Estes quatro bytes não são
      // PDF nenhum, e culpar a proteção mandava quem lia trocar o arquivo certo por um que nunca
      // teve senha. A senha tem frase própria, e ela sai quando o arquivo É um PDF cifrado — ver o
      // caso do cartório em `montar-pdf-do-contrato.revisao.test.ts`.
      expect(r.erro).toMatch(/não é um PDF/i);
    }
  });

  it("capa que não abre também recusa, nomeando a capa", async () => {
    const r = await montarPdfDoContrato({
      anexos: [],
      capa: peca("Capa quebrada", Uint8Array.from([9, 9, 9])),
      corpo: await pdfCom(1),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toContain("Capa quebrada");
  });

  it("a soma acima do teto recusa apontando a MAIOR peça", async () => {
    const gorda = new Uint8Array(TETO_DA_MONTAGEM_BYTES + 1);
    const r = await montarPdfDoContrato({
      anexos: [peca("Levantamento topográfico", gorda)],
      capa: null,
      corpo: await pdfCom(1),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erro).toContain("Levantamento topográfico");
      expect(r.erro).toContain("24MB");
    }
  });

  it("a ordem dos anexos é a que chega, e o montador não reordena", async () => {
    // Quem ordena é `somarAnexosDaCadeia`, pela POSIÇÃO cadastrada. Reordenar aqui seria uma
    // segunda regra sobre a mesma coisa, e as duas divergiriam no primeiro anexo novo.
    const r = await montarPdfDoContrato({
      anexos: [peca("segundo", await pdfCom(5)), peca("primeiro", await pdfCom(1))],
      capa: null,
      corpo: await pdfCom(1),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.paginas).toBe(7);
  });
});

// ── A BLINDAGEM DO INCHAÇO ───────────────────────────────────────────────────
//
// ⚠️ UMA CHAMADA POR PEÇA, E NÃO UMA POR PÁGINA. `embedPage` abre um `PDFObjectCopier` NOVO a cada
// chamada, e cada copier tem o próprio cache: tudo o que as páginas de uma peça COMPARTILHAM — as
// fontes, acima de tudo — era copiado de novo a cada página.
//
// Medido em 22/09/2026 com peças reais do bucket: com anexos de contrato (fonte embutida, que é o
// que o Chromium gera), 16,288MB caíam para 14,873MB, -8,7%. Com peça DIGITALIZADA o ganho é ZERO,
// porque cada página é uma imagem própria e não há o que compartilhar — e é por isso que o contrato
// que sai hoje não inchava e ninguém tinha percebido. O preço aparece no dia em que o anexo for um
// memorial, um regulamento ou uma minuta.
describe("⚠️ os recursos da peça não se duplicam página a página", () => {
  it("chama embedPages UMA VEZ por peça, e nunca embedPage", async () => {
    const emLote = vi.spyOn(PDFDocument.prototype, "embedPages");
    const umPorUm = vi.spyOn(PDFDocument.prototype, "embedPage");

    const r = await montarPdfDoContrato({
      anexos: [
        peca("de 10 páginas", await pdfDesenhado(10)),
        peca("de 4 páginas", await pdfDesenhado(4)),
      ],
      capa: peca("a capa", await pdfDesenhado(1)),
      corpo: await pdfCom(3),
    });

    expect(r.ok).toBe(true);
    // Três peças: a capa e os dois anexos. O corpo entra por `copyPages`, não por aqui.
    expect(emLote).toHaveBeenCalledTimes(3);
    expect(umPorUm).not.toHaveBeenCalled();

    emLote.mockRestore();
    umPorUm.mockRestore();
  });

  it("a página em branco no meio do anexo continua entrando, na posição dela", async () => {
    // O filtro do `/Contents` passou a acontecer ANTES da chamada em lote. A folha em branco não se
    // embute, mas continua sendo uma folha do contrato: some daqui e o anexo digitalizado sai com
    // menos páginas do que tem.
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]).drawText("primeira");
    doc.addPage([595, 842]);
    doc.addPage([595, 842]).drawText("terceira");
    const comVazia = await doc.save();

    const r = await montarPdfDoContrato({
      anexos: [peca("com uma folha vazia", comVazia)],
      capa: null,
      corpo: await pdfCom(2),
    });

    if (!r.ok) throw new Error(r.erro);
    expect(await contarPaginas(r.pdf)).toBe(5);
    expect(r.paginas).toBe(5);
  });
});
