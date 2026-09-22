import crypto from "node:crypto";

import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFStream } from "pdf-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { montarPdfDoContrato, type PecaDoContrato } from "./montar-pdf-do-contrato";

// REVISÃO DO MONTADOR — a ORDEM DAS PÁGINAS e as peças que o cartório manda.
//
// ⚠️ ESTE ARQUIVO É DE REVISÃO, NÃO DE ENTREGA. Ele existe ao lado de
// `montar-pdf-do-contrato.test.ts` porque mede coisas diferentes: lá se conta PÁGINA, aqui se
// confere QUAL página ficou em qual lugar, e o que acontece com o PDF que veio de um cartório.
//
// ⚠️ A CONTAGEM NÃO PROVA A ORDEM. O teste "capa na frente, corpo no meio, anexos no fim" do
// arquivo de entrega afirma `paginas === 10` — e 10 é o mesmo número se a capa sair no fim, se o
// corpo vier depois do anexo, ou se o montador embaralhar tudo. Aqui cada página nasce com um
// TAMANHO próprio (a capa 111x111, o corpo 595x842, o anexo 1 com 222x222…) e a conferência é a
// SEQUÊNCIA dos tamanhos lida de volta do PDF montado. É a menor marca que sobrevive ao
// `copyPages` sem depender de extrator de texto.
//
// Nada sai da máquina: todos os PDFs são criados aqui dentro, inclusive o cifrado.

const PAD = Buffer.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

const md5 = (b: Buffer): Buffer => crypto.createHash("md5").update(b).digest();

/** RC4 à mão: o OpenSSL 3 tirou a cifra do provedor padrão do Node. */
function rc4(chave: Buffer, dados: Buffer): Buffer {
  const s = [...Array.from({ length: 256 }, (_, i) => i)];
  let j = 0;
  for (let i = 0; i < 256; i += 1) {
    j = (j + (s[i] as number) + (chave[i % chave.length] as number)) & 0xff;
    [s[i], s[j]] = [s[j] as number, s[i] as number];
  }
  const saida = Buffer.alloc(dados.length);
  let i = 0;
  j = 0;
  for (let k = 0; k < dados.length; k += 1) {
    i = (i + 1) & 0xff;
    j = (j + (s[i] as number)) & 0xff;
    [s[i], s[j]] = [s[j] as number, s[i] as number];
    saida[k] = (dados[k] as number) ^ (s[(((s[i] as number) + (s[j] as number)) & 0xff)] as number);
  }
  return saida;
}

/**
 * Um PDF cifrado pelo handler padrão (R2/V1, RC4 40 bits) com SENHA DE USUÁRIO VAZIA.
 *
 * ⚠️ É EXATAMENTE O ARQUIVO QUE O CARTÓRIO ENTREGA quando marca "não permitir cópia/impressão": ele
 * ABRE em qualquer leitor, sem pedir senha, e mesmo assim os streams estão cifrados. É o caso comum
 * — não o do PDF com senha de abertura, que ninguém conseguiria nem enviar pela tela.
 */
function pdfCifrado(texto: string): { bytes: Uint8Array; cifrado: Buffer; plano: Buffer } {
  const idHex = "0123456789abcdef0123456789abcdef";
  const id = Buffer.from(idHex, "hex");
  const p = Buffer.alloc(4);
  p.writeInt32LE(-1, 0);

  const o = rc4(md5(PAD).subarray(0, 5), PAD);
  const chave = md5(Buffer.concat([PAD, o, p, id])).subarray(0, 5);
  const u = rc4(chave, PAD);

  const plano = Buffer.from(`BT /F1 24 Tf 20 100 Td (${texto}) Tj ET\n`, "latin1");
  const chaveDoObjeto = md5(Buffer.concat([chave, Buffer.from([4, 0, 0, 0, 0])])).subarray(0, 10);
  const cifrado = rc4(chaveDoObjeto, plano);

  const partes: Buffer[] = [];
  const deslocamentos: number[] = [];
  let pos = 0;
  const escrever = (t: Buffer | string): void => {
    const b = Buffer.isBuffer(t) ? t : Buffer.from(t, "latin1");
    partes.push(b);
    pos += b.length;
  };
  const objeto = (n: number, corpo: string): void => {
    deslocamentos[n] = pos;
    escrever(`${n} 0 obj\n${corpo}\nendobj\n`);
  };

  escrever("%PDF-1.4\n");
  objeto(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objeto(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  objeto(
    3,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 444 444] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
  );
  deslocamentos[4] = pos;
  escrever(`4 0 obj\n<< /Length ${cifrado.length} >>\nstream\n`);
  escrever(cifrado);
  escrever("\nendstream\nendobj\n");
  objeto(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objeto(
    6,
    `<< /Filter /Standard /V 1 /R 2 /O <${o.toString("hex")}> /U <${u.toString("hex")}> /P -1 >>`,
  );

  const inicioXref = pos;
  let xref = "xref\n0 7\n0000000000 65535 f \n";
  for (let n = 1; n <= 6; n += 1) {
    xref += `${String(deslocamentos[n]).padStart(10, "0")} 00000 n \n`;
  }
  escrever(xref);
  escrever(
    `trailer\n<< /Size 7 /Root 1 0 R /Encrypt 6 0 R /ID [<${idHex}> <${idHex}>] >>\nstartxref\n${inicioXref}\n%%EOF\n`,
  );

  return { bytes: new Uint8Array(Buffer.concat(partes)), cifrado, plano };
}

/**
 * Um PDF cujas páginas têm tamanhos escolhidos — a marca que identifica cada página depois.
 *
 * ⚠️ CADA PÁGINA NASCE COM UM RISCO DESENHADO, e isso não é enfeite: página sem `/Contents` é folha
 * realmente em branco, e a montagem a trata como tal (não dá para embutir o que não tem conteúdo).
 * Sem o risco, todas as peças do teste chegariam em branco e a prova da ORDEM não teria o que ler.
 */
async function pdfComTamanhos(tamanhos: readonly (readonly [number, number])[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const [largura, altura] of tamanhos) {
    doc.addPage([largura, altura]).drawRectangle({ height: 1, width: 1, x: 0, y: 0 });
  }
  return doc.save();
}

/** A sequência de tamanhos do PDF montado. Desde 22/09/2026 é sempre o papel do corpo. */
async function tamanhosDoPdf(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return doc.getPages().map((p) => `${Math.round(p.getWidth())}x${Math.round(p.getHeight())}`);
}

/**
 * De que PEÇA veio cada página do PDF montado.
 *
 * ⚠️ A MARCA MUDOU DE LUGAR, E FOI DE PROPÓSITO. Até 22/09/2026 a ordem era provada pelo TAMANHO
 * da página (a capa 111x111, o anexo 222x222…), o que só funcionava porque a montagem copiava o
 * papel da origem — justamente o defeito que o Lucas viu no print (*"capa está ficando
 * desproporcional"*). Agora toda página sai no papel do corpo, e o tamanho original da peça
 * sobrevive na BBox do XObject que a `drawPage` embute: é ele que identifica a peça.
 *
 * Página sem XObject é página COPIADA, e no contrato montado isso é o corpo.
 */
async function origensDoPdf(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return doc.getPages().map((pagina) => {
    const xobjects = pagina.node.Resources()?.lookupMaybe(PDFName.of("XObject"), PDFDict);
    const primeiro = xobjects ? [...xobjects.entries()][0] : undefined;
    if (!primeiro) return "corpo";
    const forma = doc.context.lookupMaybe(primeiro[1], PDFStream);
    const bbox = forma?.dict.lookupMaybe(PDFName.of("BBox"), PDFArray);
    if (!bbox) return "imagem";
    const n = (i: number) => (bbox.lookupMaybe(i, PDFNumber)?.asNumber() ?? 0);
    return `${Math.round(n(2) - n(0))}x${Math.round(n(3) - n(1))}`;
  });
}

function peca(nome: string, bytes: Uint8Array, mime = "application/pdf"): PecaDoContrato {
  return { bytes, mime, nome };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("a ordem das páginas no PDF montado", () => {
  it("é capa, corpo e anexos — conferida página a página, e não pela contagem", async () => {
    const montagem = await montarPdfDoContrato({
      anexos: [
        peca("Convenção", await pdfComTamanhos([[222, 222]])),
        peca("Memorial", await pdfComTamanhos([[333, 333], [334, 334]])),
      ],
      capa: peca("Capa VOL", await pdfComTamanhos([[111, 111]])),
      corpo: await pdfComTamanhos([[595, 842], [595, 842]]),
    });

    expect(montagem.ok).toBe(true);
    if (!montagem.ok) return;

    // A ORDEM, pela peça de origem de cada página.
    expect(await origensDoPdf(montagem.pdf)).toEqual([
      "111x111",
      "corpo",
      "corpo",
      "222x222",
      "333x333",
      "334x334",
    ]);

    // ⚠️ E O PAPEL É UM SÓ, do começo ao fim: é o defeito da capa desproporcional, travado.
    expect(await tamanhosDoPdf(montagem.pdf)).toEqual(Array.from({ length: 6 }, () => "595x842"));
  });

  it("sem capa, o corpo continua na frente dos anexos", async () => {
    const montagem = await montarPdfDoContrato({
      anexos: [peca("Planta", await pdfComTamanhos([[222, 222]]))],
      capa: null,
      corpo: await pdfComTamanhos([[595, 842]]),
    });
    expect(montagem.ok).toBe(true);
    if (montagem.ok) expect(await origensDoPdf(montagem.pdf)).toEqual(["corpo", "222x222"]);
  });

  it("vinte anexos entram todos, na ordem que chegaram", async () => {
    // Muitos anexos: o caso do loteamento que cadastra uma peça por quadra.
    const anexos: PecaDoContrato[] = [];
    for (let i = 0; i < 20; i += 1) {
      anexos.push(peca(`Anexo ${i + 1}`, await pdfComTamanhos([[200 + i, 200 + i]])));
    }
    const montagem = await montarPdfDoContrato({
      anexos,
      capa: null,
      corpo: await pdfComTamanhos([[595, 842]]),
    });
    expect(montagem.ok).toBe(true);
    if (!montagem.ok) return;
    const origens = await origensDoPdf(montagem.pdf);
    expect(origens).toHaveLength(21);
    expect(origens.slice(1)).toEqual(
      Array.from({ length: 20 }, (_, i) => `${200 + i}x${200 + i}`),
    );
    // Todas no papel do corpo, inclusive os vinte anexos.
    expect(await tamanhosDoPdf(montagem.pdf)).toEqual(Array.from({ length: 21 }, () => "595x842"));
  });

  it("a capa em imagem fica na PRIMEIRA página, encaixada no papel do corpo", async () => {
    // PNG 2x2 válido, o mesmo do arquivo de entrega — aqui o que se confere é a POSIÇÃO.
    const png = Uint8Array.from(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGP8z8DwnwEJMKEKMDAwAABZUgMLaG5hOQAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
    const montagem = await montarPdfDoContrato({
      anexos: [peca("Convenção", await pdfComTamanhos([[222, 222]]))],
      capa: peca("Capa do Canva", png, "image/png"),
      corpo: await pdfComTamanhos([[595, 842]]),
    });
    expect(montagem.ok).toBe(true);
    if (!montagem.ok) return;
    // ⚠️ PIXEL NÃO VIRA PONTO: a capa de 2x2 px não faz mais uma folha de 2x2 pt. Ela entra
    // desenhada na folha do corpo, na primeira página.
    expect(await tamanhosDoPdf(montagem.pdf)).toEqual(["595x842", "595x842", "595x842"]);
    expect((await origensDoPdf(montagem.pdf))[0]).toBe("imagem");
  });
});

// ⚠️ A CAPA DESPROPORCIONAL DO VALE DO OURO, com a medida real do arquivo cadastrado.
//
// Lucas, 22/09/2026, com o print do contrato: *"capa está ficando desproporcional"*. Medida a capa
// que a minuta VOL v7 aponta no Storage: 1190,3 x 1683,7 pt — exatamente o DOBRO do A4 do corpo.
// A montagem copiava a página como ela era, e o leitor mostrava uma folha gigante na frente de 32
// folhas normais.
describe("a capa que vem em outro papel", () => {
  it("capa do DOBRO do tamanho entra na folha do corpo, sem deformar e sem tarja", async () => {
    const montagem = await montarPdfDoContrato({
      anexos: [],
      capa: peca("VALE-DO-OURO-CAPA-CONTRATO.pdf", await pdfComTamanhos([[1190.3, 1683.7]])),
      corpo: await pdfComTamanhos([[595.28, 841.89]]),
    });

    expect(montagem.ok).toBe(true);
    if (!montagem.ok) return;

    // As duas páginas no mesmo papel.
    expect(await tamanhosDoPdf(montagem.pdf)).toEqual(["595x842", "595x842"]);
    // E a capa continua sendo a capa: a arte original de 1190x1684 está lá, embutida.
    expect((await origensDoPdf(montagem.pdf))[0]).toBe("1190x1684");
  });

  it("capa de proporção diferente cabe inteira, centralizada — e a arte NÃO deforma", async () => {
    // Uma capa quadrada num papel retrato: ela cabe pela largura e sobra tarja em cima e embaixo.
    // O que não pode é esticar, que é o que a nota antiga deste arquivo temia.
    const montagem = await montarPdfDoContrato({
      anexos: [],
      capa: peca("Capa quadrada", await pdfComTamanhos([[1000, 1000]])),
      corpo: await pdfComTamanhos([[595.28, 841.89]]),
    });

    expect(montagem.ok).toBe(true);
    if (!montagem.ok) return;
    expect(await tamanhosDoPdf(montagem.pdf)).toEqual(["595x842", "595x842"]);
    expect((await origensDoPdf(montagem.pdf))[0]).toBe("1000x1000");
  });
});

describe("o PDF que veio do cartório", () => {
  it("PDF cifrado (senha de usuário vazia) RECUSA a montagem, nomeando a peça", async () => {
    // ⚠️ ESTE CASO NASCEU FALHANDO, em 21/09/2026, e o que ele media era o contrário do que o
    // cabeçalho de `montar-pdf-do-contrato.ts` prometia. O `ignoreEncryption` do `pdf-lib` 1.17.1
    // não DECIFRA nada: ele só deixa de lançar. O `copyPages` copiava o stream ainda cifrado e o
    // `save()` gravava o resultado SEM o dicionário `/Encrypt` — o leitor recebia um arquivo que se
    // declara em claro carregando bytes cifrados, e desenhava página em branco ou lixo.
    //
    // Medido naquele dia com o PDF cifrado construído acima (905 bytes, stream de 55 bytes):
    //   • `PDFDocument.load` SEM `ignoreEncryption` → lança "document (…) is encrypted";
    //   • COM `ignoreEncryption` → carregava, copiava e devolvia `ok: true`, 2 páginas;
    //   • a saída NÃO continha o texto em claro e CONTINHA os 55 bytes cifrados;
    //   • a saída não declarava `/Encrypt`.
    //
    // A pergunta custa uma linha — `origem.isEncrypted` — e agora ela é feita. Aceitar a peça
    // exigiria DECIFRAR antes de copiar (qpdf, pdfjs), e isso é outra entrega.
    const { bytes, cifrado, plano } = pdfCifrado("CONVENCAO DE CONDOMINIO");

    // ⚠️ A PERGUNTA CUSTA UMA LINHA. O próprio `pdf-lib` sabe a resposta depois do `load`, e é por
    // isso que este defeito é barato de fechar: `PDFDocument.isEncrypted` é `true` nesta peça e
    // `false` no corpo que sai do Chromium.
    expect((await PDFDocument.load(bytes, { ignoreEncryption: true })).isEncrypted).toBe(true);

    const montagem = await montarPdfDoContrato({
      anexos: [peca("Convenção registrada no 2º Ofício", bytes)],
      capa: null,
      corpo: await pdfComTamanhos([[595, 842]]),
    });

    expect(montagem.ok).toBe(false);
    if (montagem.ok) {
      // O caminho antigo, guardado para o dia em que alguém afrouxar a trava: era ASSIM que a
      // peça saa no papel — sem o texto em claro, com os bytes cifrados copiados como se fossem
      // conteúdo, e sem o PDF final dizer que estão cifrados.
      const saida = Buffer.from(montagem.pdf);
      expect(saida.includes(plano)).toBe(false);
      expect(saida.includes(cifrado)).toBe(true);
      expect(saida.includes(Buffer.from("/Encrypt", "latin1"))).toBe(false);
      return;
    }
    // A recusa NOMEIA a peça e diz o que fazer com ela.
    expect(montagem.erro).toContain("Convenção registrada no 2º Ofício");
    expect(montagem.erro).toMatch(/protegid/i);
  });

  it("peça que não é PDF é recusada pelo FORMATO, e não culpando a senha", async () => {
    // ⚠️ O `mime` DECLARADO DEIXOU DE MANDAR (21/09/2026). `baixarPecasDoContrato` grava
    // `mime: "application/pdf"` em toda peça *"por decisão de `anexos.ts`"*, e `somarAnexosDaCadeia`
    // nem seleciona a coluna `arquivo_mime`. Um anexo que não seja PDF — um .docx registrado pela
    // rota, sem passar pela tela — derrubava a geração de TODO contrato daquele degrau com uma
    // frase mandando "salvar uma cópia sem proteção", e o arquivo nunca teve proteção nenhuma:
    // quem lesse trocaria o arquivo certo. Agora quem responde é `formatoDosBytes`.
    const docx = Uint8Array.from(Buffer.from("PKdocumento do Word", "latin1"));
    const montagem = await montarPdfDoContrato({
      anexos: [peca("Memorial descritivo", docx)],
      capa: null,
      corpo: await pdfComTamanhos([[595, 842]]),
    });

    expect(montagem.ok).toBe(false);
    if (montagem.ok) return;
    expect(montagem.erro).toContain("Memorial descritivo");
    expect(montagem.erro).toMatch(/não é um PDF/i);
    // E NÃO manda mexer em senha: este arquivo nunca teve nenhuma.
    expect(montagem.erro).not.toMatch(/senha/i);
  });
});
