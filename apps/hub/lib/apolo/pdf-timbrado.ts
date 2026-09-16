// O PAPEL TIMBRADO DA CARELI — a base de todo documento que vai para a mão do cliente.
//
// ⚠️ ISTO FOI EXTRAÍDO DO EXTRATO, E NÃO INVENTADO. Cada peça aqui já estava em
// `extrato-cliente-pdf.ts` e foi lida, medida e aprovada em produção: a paleta grafite, a quebra
// que prefere duas linhas a cortar o nome do empreendimento, o `limpar` que impede o WinAnsi de
// estourar no meio da emissão, o rodapé com a numeração de páginas.
//
// Sai daqui porque, a partir de 15/09/2026, são TRÊS documentos com o mesmo papel: o extrato, o
// relatório de rescisão e o termo de acordo. Copiar `escrever`, `quebrar` e `desenharTabela` para
// cada um criaria três versões da mesma régua, e a segunda correção já divergiria — é a regra que
// o Lucas fixou: *"antes de fazer algo, olha no hub se não temos isso já pronto"*.
//
// ⚠️ O QUE NÃO ESTÁ AQUI É DE PROPÓSITO. Fichas e tabelas de parcela são do extrato: elas
// respondem perguntas que só aquele documento faz. O que sobe para cá é o que qualquer documento
// timbrado precisa — folha, margem, fonte, régua, título de seção, parágrafo, tabela e rodapé.
// (Os ícones, os cartões de número e o cabeçalho com a unidade à direita subiram em 16/09/2026,
// quando os dois termos passaram a seguir o papel do extrato; ver a seção no fim do arquivo. No
// mesmo dia subiram a ficha, a tabela sem zebra e o tópico com ponto, para a simulação de
// rescisão; o que continua só no extrato são as tabelas de PARCELA, que as linhas montam.)
//
// ────────────────────────────────────────────────────────────────────────────────────────────
// O QUE O PRIMEIRO PDF DE VERDADE MOSTROU (15/09/2026)
// ────────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠️ ATÉ 15/09/2026 ESTE ARQUIVO NUNCA TINHA GERADO UMA FOLHA. Ele foi extraído do extrato, mas
// sem consumidor, sem teste e sem execução — e três coisas que pareciam certas no código estavam
// erradas no papel. O relatório de rescisão (`rescisao-pdf.ts`) é o primeiro consumidor, e cada
// conserto abaixo saiu de olhar o PDF gerado, não de ler o código:
//
//   1. O TÍTULO SAÍA À ESQUERDA, colado na logo. O extrato — o papel aprovado, em produção —
//      centra o título na folha, e os dois modelos em Word também. Corrigido em
//      `cabecalhoTimbrado`, com a mesma guarda do extrato contra título que encosta na marca.
//   2. A RÉGUA DO CABEÇALHO CRUZAVA O PÉ DA LOGO. `topo - 54` é altura fixa; a marca, a 40pt de
//      largura, tem 51,5pt de altura. Agora a régua fecha abaixo da imagem, com folga.
//   3. `campo` RESERVAVA UMA LINHA e escrevia duas. Endereço completo quebra; no pé da página a
//      segunda linha saía por cima do rodapé.
//
// ⚠️ E DUAS COISAS QUE FALTAVAM PARA O DOCUMENTO SER O DO MODELO: o parágrafo de corpo (que no
// extrato só existe como ressalva, em cinza claro) e o rodapé de contato dos modelos em Word.
// Viraram parâmetro, sem mudar o que o extrato já fazia.
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";

import { CARELI_LOGO_PNG_BASE64 } from "@/lib/apolo/careli-logo";

/** Paleta: grafite com preto, sem cor de enfeite (regra do Lucas). O único dourado é o da marca. */
export const INK = rgb(0.051, 0.078, 0.11); // #0d141c — preto grafite
export const TEXT = rgb(0.118, 0.161, 0.231); // #1e293b
export const SOFT_TEXT = rgb(0.353, 0.404, 0.471); // #5a6778
export const MUTE = rgb(0.58, 0.639, 0.722); // #94a3b8
export const LINE = rgb(0.886, 0.91, 0.941); // #e2e8f0
export const BAND = rgb(0.965, 0.973, 0.98); // #f6f8fa
export const DARK_BAND = rgb(0.208, 0.239, 0.286); // #353d49

export const A4 = { h: 841.89, w: 595.28 };
export const MARGIN = 42;
export const USABLE = A4.w - MARGIN * 2;
export const FOOT = MARGIN + 6;

export type Ctx = {
  bold: PDFFont;
  doc: PDFDocument;
  font: PDFFont;
  page: PDFPage;
  y: number;
};

export type Coluna = {
  /** Alinhamento do conteúdo (números sempre à direita). */
  align?: "left" | "right";
  label: string;
  /** Fração de `USABLE`. A soma das frações deve dar 1. */
  peso: number;
};

/**
 * Sanitiza para o WinAnsi das fontes padrão (acento latino passa; emoji e travessão, não).
 *
 * ⚠️ OS CONTROLES \x09/\x0A/\x0D ESTÃO NA CLASSE NEGADA DE PROPÓSITO: tab, LF e CR são os únicos
 * invisíveis que o pdf-lib aceita; o resto (emoji, setas, espaço fino) estouraria em runtime — no
 * meio da emissão do documento que vai para o cliente.
 */
export function limpar(valor: string): string {
  return (valor ?? "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/·/g, "-")
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "");
}

export function escrever(
  ctx: Ctx,
  texto: string,
  opcoes: {
    color?: ReturnType<typeof rgb>;
    font?: PDFFont;
    size?: number;
    x: number;
    y: number;
  },
): void {
  ctx.page.drawText(limpar(texto), {
    color: opcoes.color ?? TEXT,
    font: opcoes.font ?? ctx.font,
    size: opcoes.size ?? 8.5,
    x: opcoes.x,
    y: opcoes.y,
  });
}

export function escreverDireita(
  ctx: Ctx,
  texto: string,
  opcoes: {
    color?: ReturnType<typeof rgb>;
    direita: number;
    font?: PDFFont;
    size?: number;
    y: number;
  },
): void {
  const font = opcoes.font ?? ctx.font;
  const size = opcoes.size ?? 8.5;
  const largura = font.widthOfTextAtSize(limpar(texto), size);

  escrever(ctx, texto, {
    color: opcoes.color,
    font,
    size,
    x: opcoes.direita - largura,
    y: opcoes.y,
  });
}

export function regua(ctx: Ctx, cor = LINE, espessura = 0.7): void {
  ctx.page.drawLine({
    color: cor,
    end: { x: A4.w - MARGIN, y: ctx.y },
    start: { x: MARGIN, y: ctx.y },
    thickness: espessura,
  });
}

/**
 * Quebra o texto na largura útil, palavra a palavra.
 *
 * ⚠️ "R$" NUNCA FICA SOZINHO NO FIM DA LINHA, e isto saiu do primeiro PDF gerado com esta base
 * (15/09/2026): o relatório de rescisão imprimiu *"o valor total atualizado das parcelas em aberto
 * corresponde a R$"* e só na linha seguinte *"963,88"*. O símbolo e o número são uma unidade de
 * leitura num papel que vai ao cliente e ao advogado dele. A régua de dinheiro da casa troca o
 * espaço não-quebrável do `Intl` por espaço normal — de propósito, porque o U+00A0 atravessa mal
 * comparação de teste e encoding — então a costura tem de ser refeita AQUI, onde a linha é
 * decidida: o par vira um token só e viaja junto.
 */
export function quebrar(
  texto: string,
  font: PDFFont,
  size: number,
  maxW: number,
): string[] {
  const palavras = limpar(texto)
    .split(/\s+/)
    .filter(Boolean)
    .reduce<string[]>((tokens, palavra) => {
      const anterior = tokens[tokens.length - 1];
      if (anterior === "R$") tokens[tokens.length - 1] = `${anterior} ${palavra}`;
      else tokens.push(palavra);
      return tokens;
    }, []);
  if (!palavras.length) return [""];

  const linhas: string[] = [];
  let atual = palavras[0] ?? "";

  for (let i = 1; i < palavras.length; i += 1) {
    const palavra = palavras[i] ?? "";
    const tentativa = `${atual} ${palavra}`;
    if (font.widthOfTextAtSize(tentativa, size) <= maxW) {
      atual = tentativa;
    } else {
      linhas.push(atual);
      atual = palavra;
    }
  }
  linhas.push(atual);
  return linhas;
}

/** Corta um texto que não cabe na coluna, com reticências. Tabela não pode estourar a célula. */
export function encurtar(
  texto: string,
  font: PDFFont,
  size: number,
  maxW: number,
): string {
  const limpo = limpar(texto);
  if (font.widthOfTextAtSize(limpo, size) <= maxW) return limpo;

  let corte = limpo;
  while (corte.length > 1 && font.widthOfTextAtSize(`${corte}...`, size) > maxW) {
    corte = corte.slice(0, -1);
  }
  return `${corte}...`;
}

export function novaPagina(ctx: Ctx): void {
  ctx.page = ctx.doc.addPage([A4.w, A4.h]);
  ctx.y = A4.h - MARGIN;
}

export function garantirEspaco(ctx: Ctx, altura: number): void {
  if (ctx.y - altura < FOOT + 16) novaPagina(ctx);
}

/**
 * O título de seção, em caixa alta, com a régua embaixo.
 *
 * ⚠️ `junto` É A ALTURA DO QUE NÃO PODE FICAR SEM ELE. Sem isso o título cabe no pé da página, o
 * parágrafo dele não cabe, e a seção sai partida: o nome numa folha e o texto na outra. Quem chama
 * passa a altura do primeiro bloco (use `alturaDeParagrafos`) e o título desce junto.
 */
export function tituloDeSecao(ctx: Ctx, titulo: string, junto = 0): void {
  garantirEspaco(ctx, 30 + junto);
  ctx.y -= 10;
  escrever(ctx, titulo.toUpperCase(), {
    color: INK,
    font: ctx.bold,
    size: 8.5,
    x: MARGIN,
    y: ctx.y,
  });
  ctx.y -= 5;
  regua(ctx, INK, 0.9);
  ctx.y -= 12;
}

/**
 * Um parágrafo corrido, quebrado na largura útil.
 *
 * ⚠️ A COR É PARÂMETRO PORQUE O CORPO NÃO É RESSALVA. No extrato, `paragrafo` só escreve nota de
 * rodapé de bloco, e `SOFT_TEXT` (#5a6778) em 7,8pt é o tom certo para isso. No relatório de
 * rescisão o parágrafo É o documento — as oito seções são texto corrido — e cinza claro num papel
 * que vai ao jurídico do cliente lê como rascunho. O padrão continua sendo o do extrato; quem
 * escreve corpo passa `TEXT`.
 */
export function paragrafo(
  ctx: Ctx,
  texto: string,
  { color = SOFT_TEXT, size = 7.8 }: { color?: ReturnType<typeof rgb>; size?: number } = {},
): void {
  const linhas = quebrar(texto, ctx.font, size, USABLE);
  garantirEspaco(ctx, linhas.length * (size + 2.6));

  for (const linha of linhas) {
    escrever(ctx, linha, { color, size, x: MARGIN, y: ctx.y });
    ctx.y -= size + 2.6;
  }
}

/**
 * Quanto estes parágrafos vão ocupar juntos — para decidir a quebra ANTES de começar a escrever.
 *
 * ⚠️ EXISTE PORQUE `paragrafo` SE PROTEGE SOZINHO, E SÓ A SI MESMO. Num texto corrido isso basta;
 * num desfecho de documento, não: no primeiro PDF do relatório de rescisão a frase "Dessa forma,
 * não há saldo passível de restituição..." fechou a página e a frase seguinte — a que carrega o
 * VALOR do saldo, o número que o cliente procura — abriu a página seguinte sozinha, sem o título
 * da seção. Quem escreve um bloco que tem de ficar inteiro mede antes e chama `garantirEspaco`.
 */
export function alturaDeParagrafos(
  textos: string[],
  font: PDFFont,
  size = 7.8,
  espacoEntre = 0,
): number {
  const linhas = textos.reduce(
    (total, texto) => total + quebrar(texto, font, size, USABLE).length,
    0,
  );
  return linhas * (size + 2.6) + Math.max(0, textos.length - 1) * espacoEntre;
}

/**
 * Um item de lista, com marcador.
 *
 * ⚠️ O MARCADOR É UM HÍFEN, e não um bullet tipográfico: `limpar` derruba o "•" junto com o resto
 * do que o WinAnsi não aceita, e o item sairia começando com um espaço solto.
 *
 * ⚠️ O RESPIRO DE 3pt DEPOIS DO ITEM NÃO É ENFEITE. No extrato todo item cabe numa linha e a lista
 * fica legível sem ele; nas observações finais do relatório de rescisão cada item tem duas ou três
 * linhas, e sem o respiro a lista vira um bloco cinza em que não se enxerga onde um item acaba e o
 * outro começa — foi o que o primeiro PDF mostrou.
 */
export function item(
  ctx: Ctx,
  texto: string,
  { color = SOFT_TEXT, size = 7.8 }: { color?: ReturnType<typeof rgb>; size?: number } = {},
): void {
  const recuo = 10;
  const linhas = quebrar(texto, ctx.font, size, USABLE - recuo);
  garantirEspaco(ctx, linhas.length * (size + 2.6) + 3);

  linhas.forEach((linha, indice) => {
    if (indice === 0) {
      escrever(ctx, "-", { color, size, x: MARGIN, y: ctx.y });
    }
    escrever(ctx, linha, { color, size, x: MARGIN + recuo, y: ctx.y });
    ctx.y -= size + 2.6;
  });
  ctx.y -= 3;
}

/**
 * Um par rótulo/valor em linha, como os "DADOS DO CLIENTE" dos modelos em Word.
 *
 * ⚠️ O ESPAÇO É MEDIDO DEPOIS DA QUEBRA, e não antes. A versão extraída do extrato reservava a
 * altura de UMA linha e só então quebrava o valor: um endereço completo ("Rua das Acácias do Exemplo,
 * 253, Bairro Modelo, Itaúna/MG - CEP 35.000-000") ocupa duas, e a segunda saía por cima do rodapé
 * quando o campo caía no pé da página. Aqui a altura real da caixa é conhecida antes de decidir
 * se ela cabe.
 */
export function campo(ctx: Ctx, rotulo: string, valor: string, size = 8): void {
  const larguraRotulo = ctx.bold.widthOfTextAtSize(limpar(`${rotulo}: `), size);
  // Cabe na mesma linha? Escreve ao lado. Não cabe? Quebra nas seguintes, alinhado ao valor.
  const linhas = quebrar(valor || "-", ctx.font, size, USABLE - larguraRotulo);
  garantirEspaco(ctx, linhas.length * (size + 2.6) + 4.5);

  escrever(ctx, `${rotulo}:`, {
    color: INK,
    font: ctx.bold,
    size,
    x: MARGIN,
    y: ctx.y,
  });
  linhas.forEach((linha, indice) => {
    if (indice > 0) ctx.y -= size + 2.6;
    escrever(ctx, linha, {
      color: TEXT,
      size,
      x: MARGIN + larguraRotulo,
      y: ctx.y,
    });
  });
  ctx.y -= size + 4.5;
}

/**
 * A tabela do documento: cabeçalho em maiúsculas, zebra leve e uma linha de total opcional.
 *
 * ⚠️ O CABEÇALHO SE REPETE NA PÁGINA NOVA. Tabela que atravessa a quebra sem repetir o cabeçalho
 * vira uma lista de números sem nome no meio do documento.
 */
export function desenharTabela(
  ctx: Ctx,
  {
    colunas,
    linhas,
    total,
    vazio,
  }: {
    colunas: Coluna[];
    linhas: string[][];
    total?: string[];
    vazio: string;
  },
): void {
  const larguras = colunas.map((coluna) => coluna.peso * USABLE);
  const xs = larguras.reduce<number[]>((acc, largura, indice) => {
    acc.push(indice === 0 ? MARGIN : (acc[indice - 1] ?? MARGIN) + (larguras[indice - 1] ?? 0));
    return acc;
  }, []);

  const cabecalho = () => {
    garantirEspaco(ctx, 20);
    colunas.forEach((coluna, indice) => {
      const x = xs[indice] ?? MARGIN;
      const largura = larguras[indice] ?? 0;
      if (coluna.align === "right") {
        escreverDireita(ctx, coluna.label.toUpperCase(), {
          color: MUTE,
          direita: x + largura,
          font: ctx.bold,
          size: 6.6,
          y: ctx.y,
        });
      } else {
        escrever(ctx, coluna.label.toUpperCase(), {
          color: MUTE,
          font: ctx.bold,
          size: 6.6,
          x,
          y: ctx.y,
        });
      }
    });
    ctx.y -= 4;
    regua(ctx);
    ctx.y -= 10;
  };

  cabecalho();

  if (linhas.length === 0) {
    escrever(ctx, vazio, { color: MUTE, size: 7.6, x: MARGIN, y: ctx.y });
    ctx.y -= 14;
    return;
  }

  linhas.forEach((linha, indiceDaLinha) => {
    if (ctx.y - 14 < FOOT + 16) {
      novaPagina(ctx);
      cabecalho();
    }

    if (indiceDaLinha % 2 === 1) {
      ctx.page.drawRectangle({
        color: BAND,
        height: 12,
        width: USABLE,
        x: MARGIN,
        y: ctx.y - 3.5,
      });
    }

    colunas.forEach((coluna, indice) => {
      const x = xs[indice] ?? MARGIN;
      const largura = larguras[indice] ?? 0;
      const texto = encurtar(linha[indice] ?? "", ctx.font, 7.6, largura - 6);
      if (coluna.align === "right") {
        escreverDireita(ctx, texto, { direita: x + largura - 4, size: 7.6, y: ctx.y });
      } else {
        escrever(ctx, texto, { size: 7.6, x, y: ctx.y });
      }
    });
    ctx.y -= 13;
  });

  if (total) {
    garantirEspaco(ctx, 22);
    ctx.y += 2;
    regua(ctx, INK, 0.9);
    ctx.y -= 12;
    colunas.forEach((coluna, indice) => {
      const x = xs[indice] ?? MARGIN;
      const largura = larguras[indice] ?? 0;
      const texto = total[indice] ?? "";
      if (!texto) return;
      if (coluna.align === "right") {
        escreverDireita(ctx, texto, {
          color: INK,
          direita: x + largura - 4,
          font: ctx.bold,
          size: 8,
          y: ctx.y,
        });
      } else {
        escrever(ctx, texto, { color: INK, font: ctx.bold, size: 8, x, y: ctx.y });
      }
    });
    ctx.y -= 14;
  }
}

/**
 * O cabeçalho timbrado: logo à esquerda, título da peça centrado e uma linha de contexto.
 *
 * ⚠️ BEST-EFFORT NA LOGO. Se o PNG falhar, o documento sai SEM logo em vez de não sair — é a mesma
 * decisão do extrato e do CAD. Um documento sem marca ainda serve; um erro na emissão, não.
 *
 * ⚠️ O TÍTULO É CENTRADO NA FOLHA, e isto foi corrigido em 15/09/2026 contra o papel aprovado. A
 * versão extraída escrevia o título encostado na logo, à esquerda: o extrato que está em produção
 * centra (*"Título CENTRADO NA PÁGINA (pedido do Lucas, 27/08)"*) e os dois modelos em Word que o
 * dono do produto mandou também. Quem gerou o primeiro PDF com esta base viu a diferença na folha.
 * O `Math.max` preserva a garantia do extrato: título longo nunca começa em cima da logo.
 *
 * ⚠️ A RÉGUA FECHA ABAIXO DA LOGO, E NÃO NUMA ALTURA FIXA. `topo - 54` era menos que a altura da
 * marca (a PNG é 480x618, e a 40pt de largura ela tem 51,5pt de altura): a régua passava a 2,5pt
 * do pé da logo, encostada. Agora a altura real da imagem entra na conta, como no extrato.
 */
export async function cabecalhoTimbrado(
  ctx: Ctx,
  { contexto, titulo }: { contexto?: string; titulo: string },
): Promise<void> {
  const topo = ctx.y;
  let colunaTexto = MARGIN;
  let peDaLogo = topo - 40;

  try {
    const logo = await ctx.doc.embedPng(Buffer.from(CARELI_LOGO_PNG_BASE64, "base64"));
    const largura = 40;
    const altura = (logo.height / logo.width) * largura;
    ctx.page.drawImage(logo, { height: altura, width: largura, x: MARGIN, y: topo - altura });
    colunaTexto = MARGIN + largura + 16;
    peDaLogo = topo - altura;
  } catch {
    // sem logo, o título assume a margem
  }

  const larguraDoTitulo = ctx.bold.widthOfTextAtSize(limpar(titulo), 13);
  const inicioDoTitulo = Math.max(colunaTexto, (A4.w - larguraDoTitulo) / 2);

  escrever(ctx, titulo, {
    color: INK,
    font: ctx.bold,
    size: 13,
    x: inicioDoTitulo,
    y: topo - 14,
  });

  if (contexto) {
    // O contexto acompanha o título: centrado no MESMO eixo dele, não na margem da logo.
    const linhas = quebrar(contexto, ctx.font, 8, A4.w - MARGIN - colunaTexto);
    linhas.slice(0, 2).forEach((linha, indice) => {
      const larguraDaLinha = ctx.font.widthOfTextAtSize(limpar(linha), 8);
      escrever(ctx, linha, {
        color: SOFT_TEXT,
        size: 8,
        x: inicioDoTitulo + (larguraDoTitulo - larguraDaLinha) / 2,
        y: topo - 30 - indice * 11,
      });
    });
  }

  ctx.y = Math.min(topo - 54, peDaLogo - 8);
  regua(ctx, INK, 1.4);
  ctx.y -= 16;
}

/**
 * O rodapé de todas as páginas, com a numeração.
 *
 * ⚠️ RODA NO FIM, NUNCA DURANTE. A numeração precisa do total de páginas, e ele só existe depois
 * que a última foi desenhada.
 *
 * ⚠️ O CONTATO É UMA SEGUNDA LINHA, e não um sufixo do aviso. Os dois modelos em Word trazem
 * telefone, e-mail, site e @ da Careli no pé de toda página; enfiar isso na mesma linha do aviso
 * estouraria a largura útil e o `drawText` do pdf-lib não quebra sozinho — sairia por baixo do
 * número da página. Quem não passa `contato` continua com o rodapé de uma linha do extrato.
 */
export function desenharRodapes(
  doc: PDFDocument,
  font: PDFFont,
  aviso: string,
  contato?: string,
): void {
  const paginas = doc.getPages();

  paginas.forEach((pagina, indice) => {
    pagina.drawLine({
      color: LINE,
      end: { x: A4.w - MARGIN, y: FOOT + 4 },
      start: { x: MARGIN, y: FOOT + 4 },
      thickness: 0.7,
    });

    pagina.drawText(limpar(aviso), {
      color: MUTE,
      font,
      size: 6.6,
      x: MARGIN,
      y: FOOT - 8,
    });

    const direita = `${indice + 1}/${paginas.length}`;
    const largura = font.widthOfTextAtSize(direita, 6.6);
    pagina.drawText(direita, {
      color: MUTE,
      font,
      size: 6.6,
      x: A4.w - MARGIN - largura,
      y: FOOT - 8,
    });

    if (contato) {
      pagina.drawText(limpar(contato), {
        color: MUTE,
        font,
        size: 6.6,
        x: MARGIN,
        y: FOOT - 18,
      });
    }
  });
}

/** Abre o documento com as duas fontes padrão e a primeira página. */
export async function abrirDocumento(titulo: string): Promise<Ctx> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  doc.setTitle(limpar(titulo));
  doc.setProducer("Careli");
  doc.setCreator("Careli");

  return { bold, doc, font, page: doc.addPage([A4.w, A4.h]), y: A4.h - MARGIN };
}

/**
 * O bloco de assinatura no fim do documento: cidade e data, e quem assina.
 *
 * ⚠️ A DATA VAI POR EXTENSO, como nos dois modelos em Word ("Belo Horizonte/MG, 25 de junho de
 * 2026"). Documento que vai ao cliente não escreve data em formato de sistema.
 *
 * ⚠️ A SAUDAÇÃO É OPCIONAL PORQUE OS MODELOS DIVERGEM, e não por gosto. O modelo do RELATÓRIO DE
 * RESCISÃO fecha com "Atenciosamente," — é uma carta que a Careli envia. O modelo do INSTRUMENTO
 * PARTICULAR DE ACORDO fecha direto na linha da assinatura: instrumento não cumprimenta ninguém,
 * ele obriga. Enquanto isto era texto fixo aqui dentro, o termo de acordo saía com uma saudação
 * que o papel aprovado não tem. Passe `saudacao: null` para o fecho seco.
 */
export function blocoDeAssinatura(
  ctx: Ctx,
  {
    cargo,
    cidade,
    data,
    nome,
    saudacao = "Atenciosamente,",
  }: {
    cargo: string;
    cidade: string;
    data: Date | string;
    nome: string;
    saudacao?: null | string;
  },
): void {
  garantirEspaco(ctx, 90);
  ctx.y -= 10;
  regua(ctx);
  ctx.y -= 18;

  escrever(ctx, `${cidade}, ${dataPorExtenso(data)}.`, {
    color: INK,
    font: ctx.bold,
    size: 8.5,
    x: MARGIN,
    y: ctx.y,
  });
  if (saudacao) {
    ctx.y -= 16;
    escrever(ctx, saudacao, { color: SOFT_TEXT, size: 8, x: MARGIN, y: ctx.y });
  }

  // A linha da assinatura fica centrada, como no papel de hoje.
  ctx.y -= 46;
  const centro = A4.w / 2;
  ctx.page.drawLine({
    color: LINE,
    end: { x: centro + 90, y: ctx.y + 12 },
    start: { x: centro - 90, y: ctx.y + 12 },
    thickness: 0.7,
  });

  const largura = ctx.bold.widthOfTextAtSize(limpar(nome), 9);
  escrever(ctx, nome, {
    color: INK,
    font: ctx.bold,
    size: 9,
    x: centro - largura / 2,
    y: ctx.y,
  });
  ctx.y -= 12;
  const larguraCargo = ctx.font.widthOfTextAtSize(limpar(cargo), 8);
  escrever(ctx, cargo, {
    color: SOFT_TEXT,
    size: 8,
    x: centro - larguraCargo / 2,
    y: ctx.y,
  });
  ctx.y -= 14;
}

const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/**
 * "R$ 2.364,33" — o dinheiro como o papel timbrado escreve.
 *
 * ⚠️ ESTÁ AQUI PORQUE ERAM TRÊS CÓPIAS. `reais` em `lib/apolo/rescisao.ts` (que é a régua do
 * CÁLCULO e fica lá de propósito: aquele arquivo não pode importar pdf-lib), `dinheiro` em
 * `lib/apolo/extrato-cliente.ts` — que NÃO troca o NBSP — e uma terceira, recém-escrita dentro do
 * termo de acordo. Documento timbrado formata dinheiro de um jeito só, e esse jeito mora na régua.
 *
 * ⚠️ ARREDONDA ANTES DE FORMATAR. Sem o `Math.round(v*100)/100` um valor que veio de uma soma de
 * ponto flutuante imprime o centavo do vizinho, e o papel deixa de fechar com a linha de total.
 *
 * ⚠️ O `Intl` SEPARA "R$" DO NÚMERO COM ESPAÇO NÃO-QUEBRÁVEL (U+00A0), e este texto vai para um PDF
 * em WinAnsi e para comparação de teste. Espaço normal evita as duas surpresas.
 *
 * ⚠️ O ESCAPE `\u00A0` É OBRIGATÓRIO, e não preciosismo: com o caractere literal no lugar dele,
 * qualquer edição que normalize espaços transforma o `replace` num no-op invisível — o código
 * continua parecendo certo e o teste falha dizendo que "R$ 1,00" não é igual a "R$ 1,00".
 */
export function dinheiro(valor: number): string {
  const arredondado = Math.round((Number.isFinite(valor) ? valor : 0) * 100) / 100;
  return new Intl.NumberFormat("pt-BR", {
    currency: "BRL",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  })
    .format(arredondado)
    .replace(/\u00A0/g, " ");
}

/**
 * "25 de junho de 2026".
 *
 * ⚠️ ACEITA 'YYYY-MM-DD' DE PROPÓSITO, e essa é a forma segura de chamar. As datas da casa vêm do
 * C2X como texto ('2026-06-25'), e `new Date("2026-06-25")` é interpretado como MEIA-NOITE EM UTC:
 * no fuso de Brasília (UTC-3) o `getDate()` devolve 24, e o documento sai datado de um dia antes
 * do que está no banco. Aqui o texto é lido campo a campo, sem passar por fuso nenhum.
 */
export function dataPorExtenso(data: Date | string): string {
  if (typeof data === "string") {
    const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(data);
    if (!partes) return "-";
    const mes = Number(partes[2]);
    return `${Number(partes[3])} de ${MESES[mes - 1] ?? ""} de ${partes[1]}`;
  }
  return `${data.getDate()} de ${MESES[data.getMonth()] ?? ""} de ${data.getFullYear()}`;
}

/** "junho de 2026" — a competência como o documento escreve. Aceita 'YYYY-MM' e 'YYYY-MM-DD'. */
export function mesPorExtenso(competencia: null | string): null | string {
  const partes = competencia ? /^(\d{4})-(\d{2})/.exec(competencia) : null;
  if (!partes) return null;
  const mes = MESES[Number(partes[2]) - 1];
  return mes ? `${mes} de ${partes[1]}` : null;
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// CABEÇALHO COM BLOCO À DIREITA, ÍCONES E CARTÕES (extraídos do extrato em 16/09/2026)
// ────────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠️ ATÉ 16/09/2026 ISTO MORAVA SÓ NO EXTRATO, e o cabeçalho deste arquivo dizia que era de
// propósito. Mudou com o pedido do dono do produto: ele achou o termo de acordo *"muito formal"*
// e o de rescisão *"muita escrita"*, e mandou o print do EXTRATO como referência. O que torna o
// extrato legível num olhar é justamente o que tinha ficado de fora: os três cartões com o número
// grande e o cabeçalho com a unidade à direita. Copiar para cada termo criaria três versões dos
// mesmos cartões; a segunda correção já divergiria.
//
// ⚠️ O EXTRATO NÃO MUDOU UM PONTO. O código abaixo é o do extrato, movido, e o extrato passou a
// importá-lo. A prova foi comparar os bytes do PDF (normalizados sem as datas de criação) de um
// extrato de um lote e de um consolidado, gerados antes e depois da extração: idênticos.

export type IconeTipo = "alerta" | "igual" | "menos" | "moeda" | "relogio" | "saldo";

/**
 * Vetores mínimos, sem fonte de ícone. A regra da casa é "ícone acima do rótulo"; o que se ganha
 * é a leitura em varredura dos três números, não decoração.
 */
export function desenharIcone(ctx: Ctx, tipo: IconeTipo, x: number, y: number): void {
  const cor = INK;

  if (tipo === "moeda") {
    // Círculo cheio: o dinheiro que ENTROU.
    ctx.page.drawCircle({ borderWidth: 0, color: cor, size: 4, x: x + 4, y: y + 4 });
    return;
  }

  if (tipo === "saldo") {
    // Anel: o que ainda falta.
    ctx.page.drawCircle({
      borderColor: cor,
      borderWidth: 1.3,
      size: 4,
      x: x + 4,
      y: y + 4,
    });
    return;
  }

  if (tipo === "alerta") {
    // Triângulo (três linhas) + o pingo do "!".
    const pontos: Array<[number, number]> = [
      [x + 4, y + 8.4],
      [x + 8.4, y + 0.6],
      [x - 0.4, y + 0.6],
    ];
    for (let i = 0; i < pontos.length; i += 1) {
      const inicio = pontos[i]!;
      const fim = pontos[(i + 1) % pontos.length]!;
      ctx.page.drawLine({
        color: cor,
        end: { x: fim[0], y: fim[1] },
        start: { x: inicio[0], y: inicio[1] },
        thickness: 1.1,
      });
    }
    ctx.page.drawLine({
      color: cor,
      end: { x: x + 4, y: y + 5.6 },
      start: { x: x + 4, y: y + 2.6 },
      thickness: 1.1,
    });
    return;
  }

  // ⚠️ "MENOS" E "IGUAL" SÃO A CONTA DA SIMULAÇÃO DE RESCISÃO LIDA EM ÍCONES (16/09/2026): total
  // pago, MENOS as deduções, IGUAL ao saldo. Os três cartões daquele papel são uma subtração, e o
  // cliente que só olha os ícones entende a ordem sem ler os rótulos. Mesmo anel do relógio, para
  // a família continuar uma só.
  if (tipo === "menos" || tipo === "igual") {
    ctx.page.drawCircle({ borderColor: cor, borderWidth: 1.1, size: 4.2, x: x + 4, y: y + 4 });
    const barras = tipo === "menos" ? [y + 4] : [y + 3, y + 5];
    for (const altura of barras) {
      ctx.page.drawLine({
        color: cor,
        end: { x: x + 5.9, y: altura },
        start: { x: x + 2.1, y: altura },
        thickness: 0.9,
      });
    }
    return;
  }

  // Relógio: anel + dois ponteiros.
  ctx.page.drawCircle({ borderColor: cor, borderWidth: 1.1, size: 4.2, x: x + 4, y: y + 4 });
  ctx.page.drawLine({
    color: cor,
    end: { x: x + 4, y: y + 6.6 },
    start: { x: x + 4, y: y + 4 },
    thickness: 1,
  });
  ctx.page.drawLine({
    color: cor,
    end: { x: x + 6.4, y: y + 4 },
    start: { x: x + 4, y: y + 4 },
    thickness: 1,
  });
}

/**
 * Cabe numa linha? Devolve uma. Não cabe? Quebra em DUAS, no espaço, preferindo o corte que
 * deixa as duas metades mais parecidas. Se nem assim couber, encolhe a fonte (até 2pt menos) e, no
 * limite, corta com reticências (isso só acontece com uma palavra única gigante).
 *
 * ⚠️ EXISTE PORQUE CORTAR O NOME DO EMPREENDIMENTO no papel do cliente ("CONDOMINIO RECA...") é
 * pior do que usar duas linhas.
 */
export function quebrarEmDuasLinhas(
  texto: string,
  font: PDFFont,
  size: number,
  maxW: number,
): { linhas: string[]; size: number } {
  const limpo = limpar(texto);

  for (const tamanho of [size, size - 1, size - 2]) {
    if (font.widthOfTextAtSize(limpo, tamanho) <= maxW) {
      return { linhas: [limpo], size: tamanho };
    }

    const palavras = limpo.split(/\s+/).filter(Boolean);
    if (palavras.length < 2) continue;

    let melhor: null | string[] = null;
    let melhorDiferenca = Infinity;

    for (let corte = 1; corte < palavras.length; corte++) {
      const a = palavras.slice(0, corte).join(" ");
      const b = palavras.slice(corte).join(" ");
      const larguraA = font.widthOfTextAtSize(a, tamanho);
      const larguraB = font.widthOfTextAtSize(b, tamanho);
      if (larguraA > maxW || larguraB > maxW) continue;

      const diferenca = Math.abs(larguraA - larguraB);
      if (diferenca < melhorDiferenca) {
        melhorDiferenca = diferenca;
        melhor = [a, b];
      }
    }

    if (melhor) return { linhas: melhor, size: tamanho };
  }

  return { linhas: [encurtar(limpo, font, size - 2, maxW)], size: size - 2 };
}

/**
 * O cabeçalho do extrato: logo à esquerda, título grande CENTRADO na folha com uma linha cinza
 * embaixo, e à direita um destaque em negrito com linhas menores (o empreendimento e a unidade).
 *
 * ⚠️ NÃO É O `cabecalhoTimbrado`, e os dois ficam. Aquele centra um contexto embaixo do título; este
 * põe a unidade à direita, que é o papel que o dono do produto aprovou no extrato e pediu para os
 * termos. Trocar um pelo outro mudaria documentos que já saem.
 *
 * ⚠️ O DESTAQUE PRECISA CABER NO QUE SOBRA À DIREITA DO TÍTULO. Com o título no centro sobram
 * ~90pt, e um nome longo encostaria nele: o espaço é medido a partir do fim REAL do título, com
 * folga, e o nome quebra em duas linhas antes de encolher.
 *
 * ⚠️ A PRIMEIRA LINHA ABAIXO DO DESTAQUE SAI NA COR DO TEXTO, AS DEMAIS EM CINZA. É a hierarquia do
 * extrato: "Quadra 06, Lote 17 (LOS0617)" se lê, a área é apoio.
 */
export async function cabecalhoComBlocoADireita(
  ctx: Ctx,
  {
    destaque,
    linhas,
    subtitulo,
    titulo,
  }: { destaque: string; linhas: string[]; subtitulo: string; titulo: string },
): Promise<void> {
  const topo = ctx.y;
  let colunaTexto = MARGIN;

  // Best-effort de propósito: sem a marca o documento ainda é entregável; sem o documento, não.
  try {
    const logo = await ctx.doc.embedPng(Buffer.from(CARELI_LOGO_PNG_BASE64, "base64"));
    const largura = 40;
    const altura = (logo.height / logo.width) * largura;
    ctx.page.drawImage(logo, {
      height: altura,
      width: largura,
      x: MARGIN,
      y: topo - altura,
    });
    colunaTexto = MARGIN + largura + 16;
  } catch {
    // sem logo: o título assume a margem.
  }

  const larguraDoTitulo = ctx.bold.widthOfTextAtSize(limpar(titulo), 14);
  const inicioDoTitulo = Math.max(colunaTexto, (A4.w - larguraDoTitulo) / 2);

  escrever(ctx, titulo, {
    color: INK,
    font: ctx.bold,
    size: 14,
    x: inicioDoTitulo,
    y: topo - 14,
  });

  // A linha cinza acompanha o título: centrada no MESMO eixo dele, não na margem da logo.
  escrever(ctx, subtitulo, {
    color: MUTE,
    size: 8.5,
    x:
      inicioDoTitulo +
      (larguraDoTitulo - ctx.font.widthOfTextAtSize(limpar(subtitulo), 8.5)) / 2,
    y: topo - 27,
  });

  const direita = A4.w - MARGIN;
  const fimDoTitulo = inicioDoTitulo + larguraDoTitulo + 18;
  const espacoDaDireita = Math.max(60, direita - fimDoTitulo);
  const { linhas: linhasDoDestaque, size: sizeDoDestaque } = quebrarEmDuasLinhas(
    destaque,
    ctx.bold,
    9.5,
    espacoDaDireita,
  );

  let yDireita = topo - 13;
  for (const linha of linhasDoDestaque) {
    escreverDireita(ctx, linha, {
      color: INK,
      direita,
      font: ctx.bold,
      size: sizeDoDestaque,
      y: yDireita,
    });
    yDireita -= sizeDoDestaque + 2.5;
  }

  linhas.forEach((linha, indice) => {
    escreverDireita(ctx, linha, {
      color: indice === 0 ? TEXT : MUTE,
      direita,
      size: indice === 0 ? 8.5 : 8,
      y: yDireita - 1,
    });
    yDireita -= 11;
  });

  // O cabeçalho termina embaixo do que for mais alto: a coluna da direita (que cresce com o
  // destaque quebrado) ou o bloco do título.
  ctx.y = Math.min(topo - 58, yDireita - 8);
  regua(ctx, INK, 1.4);
  ctx.y -= 16;
}

/** Um cartão de número: ícone, rótulo em caixa alta, o número grande e uma linha de apoio. */
export type Cartao = { apoio: string; icone: IconeTipo; rotulo: string; valor: string };

/**
 * Os cartões lado a lado, com fundo cinza bem claro: é o que faz o papel responder num olhar.
 *
 * ⚠️ O NÚMERO ENCOLHE ANTES DE ESTOURAR O CARTÃO. No extrato ele sempre coube em 15pt; num termo o
 * valor pode ser uma condição ("12x R$ 12.345,67"), e o `drawText` do pdf-lib não corta nada: o
 * texto passaria por cima da borda e do cartão vizinho. O que cabe continua em 15pt, então o
 * extrato sai igual.
 */
export function desenharCartoes(ctx: Ctx, cartoes: Cartao[]): void {
  const gap = 10;
  const colW = (USABLE - gap * (cartoes.length - 1)) / cartoes.length;
  const altura = 62;

  garantirEspaco(ctx, altura + 8);
  const topo = ctx.y;

  cartoes.forEach((cartao, indice) => {
    const x = MARGIN + indice * (colW + gap);

    ctx.page.drawRectangle({
      borderColor: LINE,
      borderWidth: 0.8,
      color: BAND,
      height: altura,
      width: colW,
      x,
      y: topo - altura,
    });

    desenharIcone(ctx, cartao.icone, x + 12, topo - 22);
    escrever(ctx, cartao.rotulo.toUpperCase(), {
      color: SOFT_TEXT,
      font: ctx.bold,
      size: 5.8,
      x: x + 12,
      y: topo - 32,
    });

    let tamanho = 15;
    while (tamanho > 9 && ctx.bold.widthOfTextAtSize(limpar(cartao.valor), tamanho) > colW - 24) {
      tamanho -= 0.5;
    }
    escrever(ctx, cartao.valor, {
      color: INK,
      font: ctx.bold,
      size: tamanho,
      x: x + 12,
      y: topo - 49,
    });
    escrever(ctx, encurtar(cartao.apoio, ctx.font, 6.6, colW - 24), {
      color: MUTE,
      size: 6.6,
      x: x + 12,
      y: topo - 58,
    });
  });

  ctx.y = topo - altura - 10;
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// FICHA, TABELA LIMPA E TÓPICO (extraídos do extrato em 16/09/2026, para a simulação de rescisão)
// ────────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠️ SÃO AS MEDIDAS DO EXTRATO, e não outras. A ficha (rótulo 5,8pt cinza em caixa alta, valor em
// negrito embaixo), a tabela sem zebra (cabeçalho 5,8pt, linhas de 11,5pt, total em negrito sobre
// uma régua fina) e o tópico com ponto desenhado são o que o dono do produto aprovou no extrato e
// mandou como referência para os termos. `desenharTabela`, acima, continua existindo: ela tem zebra
// e régua grafite no total, e os documentos que já a usam não mudam por causa desta.

/**
 * Um campo em destaque da ficha: rótulo pequeno em caixa alta cinza e o valor em negrito embaixo,
 * na largura toda ("TITULAR").
 *
 * ⚠️ O VALOR QUEBRA, NÃO CORTA. Com dois titulares e os documentos entre parênteses a linha passa da
 * largura útil, e cortar o nome de quem assina o contrato seria pior do que usar duas linhas.
 */
export function campoEmDestaque(ctx: Ctx, rotulo: string, valor: string): void {
  const linhas = quebrar(valor, ctx.bold, 9, USABLE);
  garantirEspaco(ctx, 12 + linhas.length * 11);

  escrever(ctx, rotulo.toUpperCase(), {
    color: MUTE,
    font: ctx.bold,
    size: 5.8,
    x: MARGIN,
    y: ctx.y,
  });
  ctx.y -= 11;

  for (const linha of linhas) {
    escrever(ctx, linha, { color: INK, font: ctx.bold, size: 9, x: MARGIN, y: ctx.y });
    ctx.y -= 11;
  }
  ctx.y -= 5;
}

/** Um par da linha da ficha. `peso` é a fração de `USABLE`; os pesos da linha somam 1. */
export type CampoDaFicha = { peso: number; rotulo: string; valor: string };

/**
 * A linha da ficha: pares rótulo/valor lado a lado ("CONTRATO / UNIDADE", "DATA DO ATO"...).
 *
 * ⚠️ AS COLUNAS TÊM LARGURAS DIFERENTES DE PROPÓSITO. No extrato, com o quarto para cada uma, o plano
 * saía cortado: uma data ocupa dez caracteres e o plano ocupa trinta e cinco. Quem chama decide o
 * peso de cada campo pelo tamanho do que ele escreve.
 */
export function linhaDeCampos(ctx: Ctx, campos: CampoDaFicha[]): void {
  garantirEspaco(ctx, 24);
  const topo = ctx.y;

  let x = MARGIN;
  for (const { peso, rotulo, valor } of campos) {
    const colW = USABLE * peso;
    escrever(ctx, rotulo.toUpperCase(), { color: MUTE, font: ctx.bold, size: 5.8, x, y: topo });
    escrever(ctx, encurtar(valor || "-", ctx.bold, 8.5, colW - 8), {
      color: TEXT,
      font: ctx.bold,
      size: 8.5,
      x,
      y: topo - 11,
    });
    x += colW;
  }

  ctx.y = topo - 22;
}

/**
 * A tabela do extrato: cabeçalho em caixa alta cinza pequeno, régua fina, sem zebra, valor à
 * direita e a linha de total em negrito.
 *
 * ⚠️ `quebrarCelulas` EXISTE PORQUE UMA BASE DE CÁLCULO NÃO PODE SAIR COM RETICÊNCIAS. No extrato
 * toda célula cabe (data, tipo, número), e cortar é a defesa certa contra estouro. Na simulação de
 * rescisão a coluna "como é calculada" da fruição diz percentual, base, valor e meses, e é a frase
 * que o jurídico confere: cortada, ela deixa de ser conferível. Com a opção ligada, as colunas à
 * esquerda quebram em até três linhas e a linha da tabela cresce junto; os números, à direita,
 * nunca quebram. Desligada (o padrão), a tabela é a do extrato, linha a linha.
 *
 * ⚠️ O CABEÇALHO SE REPETE NA PÁGINA NOVA, como no extrato: tabela que atravessa a quebra sem
 * cabeçalho vira uma lista de números sem nome.
 */
export function desenharTabelaLimpa(
  ctx: Ctx,
  {
    colunas,
    linhas,
    quebrarCelulas = false,
    total,
    vazio,
  }: {
    colunas: Coluna[];
    linhas: string[][];
    quebrarCelulas?: boolean;
    total?: string[];
    vazio: string;
  },
): void {
  const tamanho = 7.6;
  const entreLinhas = 9.4;
  const larguras = colunas.map((coluna) => coluna.peso * USABLE);
  const xs = larguras.reduce<number[]>((acc, _largura, indice) => {
    acc.push(indice === 0 ? MARGIN : (acc[indice - 1] ?? MARGIN) + (larguras[indice - 1] ?? 0));
    return acc;
  }, []);

  const desenharCabecalho = () => {
    garantirEspaco(ctx, 20);
    colunas.forEach((coluna, indice) => {
      const x = xs[indice] ?? MARGIN;
      const largura = larguras[indice] ?? 0;
      const opcoes = { color: MUTE, font: ctx.bold, size: 5.8, y: ctx.y };
      if (coluna.align === "right") {
        escreverDireita(ctx, coluna.label.toUpperCase(), { ...opcoes, direita: x + largura });
      } else {
        escrever(ctx, coluna.label.toUpperCase(), { ...opcoes, x });
      }
    });
    ctx.y -= 5;
    regua(ctx, LINE, 0.7);
    ctx.y -= 10;
  };

  desenharCabecalho();

  if (!linhas.length) {
    escrever(ctx, vazio, { color: MUTE, size: 7.8, x: MARGIN, y: ctx.y });
    ctx.y -= 12;
    return;
  }

  for (const linha of linhas) {
    const celulas = colunas.map((coluna, indice) => {
      const conteudo = linha[indice] ?? "";
      if (coluna.align === "right") return [conteudo];
      const largura = (larguras[indice] ?? 0) - 6;
      if (!quebrarCelulas) return [encurtar(conteudo, ctx.font, tamanho, largura)];
      const quebradas = quebrar(conteudo, ctx.font, tamanho, largura);
      return quebradas.length <= 3
        ? quebradas
        : [...quebradas.slice(0, 2), encurtar(quebradas.slice(2).join(" "), ctx.font, tamanho, largura)];
    });
    const alturaExtra = (Math.max(...celulas.map((texto) => texto.length)) - 1) * entreLinhas;

    if (ctx.y - 12 - alturaExtra < FOOT + 16) {
      novaPagina(ctx);
      desenharCabecalho();
    }

    colunas.forEach((coluna, indice) => {
      const x = xs[indice] ?? MARGIN;
      const largura = larguras[indice] ?? 0;
      (celulas[indice] ?? []).forEach((texto, ordem) => {
        const y = ctx.y - ordem * entreLinhas;
        if (coluna.align === "right") {
          escreverDireita(ctx, texto, { color: TEXT, direita: x + largura, size: tamanho, y });
        } else {
          escrever(ctx, texto, { color: TEXT, size: tamanho, x, y });
        }
      });
    });

    ctx.y -= 11.5 + alturaExtra;
  }

  if (total) {
    garantirEspaco(ctx, 22);
    ctx.y += 2;
    regua(ctx, LINE, 0.7);
    ctx.y -= 11;

    colunas.forEach((coluna, indice) => {
      const x = xs[indice] ?? MARGIN;
      const largura = larguras[indice] ?? 0;
      const conteudo = total[indice] ?? "";
      if (!conteudo) return;
      const opcoes = { color: INK, font: ctx.bold, size: 8, y: ctx.y };
      if (coluna.align === "right") {
        escreverDireita(ctx, conteudo, { ...opcoes, direita: x + largura });
      } else {
        escrever(ctx, conteudo, { ...opcoes, x });
      }
    });

    ctx.y -= 12;
  }
}

/**
 * Um tópico com ponto, como a lista de reajustes do extrato.
 *
 * ⚠️ O PONTO É DESENHADO, E NÃO UM CARACTERE. `limpar` derruba o "•" (fora do WinAnsi), e o hífen
 * que `item` usa no lugar, no começo de uma frase curta, se lê como travessão: a regra da casa não
 * tem travessão em texto visível.
 *
 * ⚠️ O EXTRATO AINDA ESCREVE A LISTA DELE À MÃO, E ISSO FOI DECIDIDO. A quebra local de lá não
 * costura o "R$" ao número, e a daqui costura (ver `quebrar`): trocar a lista de reajustes por
 * esta função mudaria a linha de algum reajuste num papel já aprovado, e a extração de 16/09/2026
 * só moveu o que saía com os mesmos bytes.
 */
export function topico(
  ctx: Ctx,
  texto: string,
  { color = TEXT, size = 7.8 }: { color?: ReturnType<typeof rgb>; size?: number } = {},
): void {
  const linhas = quebrar(texto, ctx.font, size, USABLE - 12);
  garantirEspaco(ctx, linhas.length * (size + 2.6) + 4);

  linhas.forEach((linha, indice) => {
    if (indice === 0) {
      ctx.page.drawCircle({ borderWidth: 0, color: INK, size: 1.5, x: MARGIN + 2, y: ctx.y + 2.6 });
    }
    escrever(ctx, linha, { color, size, x: MARGIN + 12, y: ctx.y });
    ctx.y -= size + 2.6;
  });
  ctx.y -= 2;
}

/** Tira o que quebra `Content-Disposition` / nome de arquivo no Windows. */
export function sanitizarNomeDeArquivo(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(new RegExp("[̀-ͯ]", "g"), "")
    .replace(/[\\/:*?"<>|\r\n]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}
