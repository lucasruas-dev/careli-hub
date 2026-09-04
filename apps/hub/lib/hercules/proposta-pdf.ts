// A PROPOSTA DE AQUISIÇÃO em PDF — a peça que chega no WhatsApp do cliente.
//
// Lucas (04/09/2026): *"vamos criar uma proposta bem top, logotipo do empreendimento, trazendo o
// plano, fluxo de pagamento"*, e depois, vendo o mockup: *"não precisa trazer o nome do plano"*,
// *"coloca uma referência ao C2X"*, *"se tem anuais, tem que ter também o fluxo delas"*.
//
// ⚠️ GRAFITE COM PRETO, SEM COR DE ENFEITE. A primeira versão do mockup usava o azul da Gurgel em
// bloco cheio e ele reprovou na hora ("ficou ruim, muito chamativo"). O azul da marca foi aprovado
// para os BOTÕES do portal; documento que vai para a mão do comprador segue a paleta do extrato do
// cliente (`lib/apolo/extrato-cliente-pdf.ts`), que é a outra peça da casa com esse destino.
//
// ⚠️ pdf-lib E HELVETICA, como todo PDF da casa. Sem fontkit no repositório, as fontes disponíveis
// são as Standard 14 — por isso o mockup foi desenhado em Helvetica desde o início: aprovar numa
// fonte e imprimir noutra faria o papel sair diferente do que foi aprovado.
//
// ⚠️ O QUE ESTE ARQUIVO NÃO FAZ: conta. Todos os números chegam prontos em `PropostaParaPdf` —
// quem os calcula é o simulador (`lib/hercules/simulacao.ts`), a régua de amortização
// (`lib/apolo/planos-comerciais.ts`) e o motor de reajuste. Um gerador que também calculasse seria
// a segunda versão da mesma conta de dinheiro.

import { PDFDocument, type PDFFont, type PDFImage, type PDFPage, StandardFonts, rgb } from "pdf-lib";

const A4 = { h: 841.89, w: 595.28 };
/** 46px do mockup × 0,75 (794px = 595,28pt) — a mesma margem, na escala do papel. */
const M = 34.5;
const LARGURA = A4.w - M * 2;
/** Abaixo disto é rodapé: o conteúdo quebra para a próxima página antes de invadir. */
const PISO = 92;
/** Onde o conteúdo começa nas páginas de continuação. */
const TOPO_CONTINUACAO = A4.h - 62;
/** Quantas linhas de um fluxo longo vão ao papel antes da linha de continuação. */
const MAX_LINHAS_DO_FLUXO = 4;

const INK = rgb(0.051, 0.078, 0.11); // #0d141c
const TEXT = rgb(0.118, 0.161, 0.231); // #1e293b
const SOFT = rgb(0.353, 0.404, 0.471); // #5a6778
const MUTE = rgb(0.58, 0.639, 0.722); // #94a3b8
const LINE = rgb(0.886, 0.91, 0.941); // #e2e8f0
const HAIR = rgb(0.945, 0.961, 0.976); // #f1f5f9

export type ParcelaDaProposta = {
  /** "1 de 2" */
  ordem: string;
  /** "10 de outubro de 2026" */
  vencimento: string;
  valor: string;
};

export type FaixaDeReajuste = {
  ate: string;
  de: string;
  /** "1 a 12" */
  parcelas: string;
  /** "1º ano" */
  periodo: string;
  /** ⚠️ `true` a partir do primeiro reajuste: é o que imprime "+ IPCA" ao lado do valor. */
  temIpca: boolean;
  valor: string;
};

export type CompradorDaProposta = {
  documento: string;
  nome: string;
  /** "60%" — só sai quando há mais de um comprador. */
  participacao: string;
};

export type PropostaParaPdf = {
  /**
   * As parcelas anuais (reforço/balão), quando o plano tem.
   *
   * ⚠️ VAZIO = A SEÇÃO NÃO EXISTE, e é assim que o Lucas pediu ("quando tiver vai ter que vir").
   * Uma seção "Parcelas anuais: não há" gastaria seis linhas do papel para dizer que não há nada
   * a dizer.
   */
  anuais: ParcelaDaProposta[];
  anuaisTotal: string;
  atendimento: {
    coordenador: null | string;
    corretor: null | string;
    imobiliaria: null | string;
    telefone: null | string;
  };
  /** `000123` — o COD da venda, o mesmo desde a reserva. */
  codigo: string;
  compradores: CompradorDaProposta[];
  condicoes: Array<{ rotulo: string; valor: string }>;
  destaques: Array<{ detalhe: string; rotulo: string; valor: string }>;
  emitidaEm: string;
  empreendimento: string;
  entrada: ParcelaDaProposta[];
  entradaTotal: string;
  /** A marca do C2X, no rodapé. */
  logoC2x: null | Uint8Array;
  /** PNG ou JPG da logo do empreendimento. Ausente = o espaço fica vazio, e o papel sai assim mesmo. */
  logoEmpreendimento: null | Uint8Array;
  observacoes: Array<{ texto: string; titulo: string }>;
  reajustes: FaixaDeReajuste[];
  /** "Garden · 250,00 m² · Goiânia, GO" */
  subtitulo: string;
  /** "Quadra 03 · Lote 07" */
  unidade: string;
};

/**
 * O texto que a Helvetica consegue escrever.
 *
 * ⚠️ pdf-lib LANÇA ao encontrar caractere fora do WinAnsi, e o erro sai na hora de gravar — ou
 * seja, depois de a proposta já ter sido gravada no banco. Um nome com caractere exótico não pode
 * derrubar o envio: aqui ele é aproximado, e o pior caso é uma letra sem acento no papel.
 */
function seguro(valor: string): string {
  return String(valor ?? "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[—–]/g, "-")
    .replace(/…/g, "...")
    // A Helvetica escreve o Latin-1 imprimível; o que estiver fora vira nada.
    .replace(/[^ -ÿ]/g, "");
}

type Ctx = {
  bold: PDFFont;
  doc: PDFDocument;
  font: PDFFont;
  page: PDFPage;
  /** Toda página criada, para o rodapé numerado ser escrito no fim. */
  paginas: PDFPage[];
  /** O cabeçalho curto das páginas de continuação. */
  topo: string;
  y: number;
};

/**
 * Garante espaço para o próximo bloco, abrindo página nova quando falta.
 *
 * ⚠️ SEM ISTO O DOCUMENTO SE ATROPELA, e foi o que aconteceu na primeira versão: com dez parcelas
 * anuais no fluxo, as observações caíram por cima do rodapé. Apertar entrelinha até caber é
 * remendo — o número de linhas é do contrato, não do layout: um plano com 20 reforços chega.
 */
function garantirEspaco(ctx: Ctx, altura: number): void {
  if (ctx.y - altura >= PISO) return;

  const nova = ctx.doc.addPage([A4.w, A4.h]);
  ctx.paginas.push(nova);
  ctx.page = nova;
  ctx.y = TOPO_CONTINUACAO;

  texto(ctx, ctx.topo, M, 7, { cor: MUTE });
  ctx.y -= 6;
  regua(ctx, ctx.y, LINE);
  ctx.y -= 20;
}

function texto(
  ctx: Ctx,
  valor: string,
  x: number,
  size: number,
  opts: { bold?: boolean; cor?: ReturnType<typeof rgb>; y?: number } = {},
): void {
  ctx.page.drawText(seguro(valor), {
    color: opts.cor ?? TEXT,
    font: opts.bold ? ctx.bold : ctx.font,
    size,
    x,
    y: opts.y ?? ctx.y,
  });
}

function textoDireita(
  ctx: Ctx,
  valor: string,
  direita: number,
  size: number,
  opts: { bold?: boolean; cor?: ReturnType<typeof rgb>; y?: number } = {},
): void {
  const f = opts.bold ? ctx.bold : ctx.font;
  texto(ctx, valor, direita - f.widthOfTextAtSize(seguro(valor), size), size, opts);
}

/** Maiúsculas espaçadas — o rótulo de seção do documento. pdf-lib não tem letter-spacing. */
function espacado(valor: string): string {
  return seguro(valor.toUpperCase()).split("").join(" ");
}

function regua(ctx: Ctx, y: number, cor = LINE, espessura = 0.5, de = M, ate = A4.w - M): void {
  ctx.page.drawLine({ color: cor, end: { x: ate, y }, start: { x: de, y }, thickness: espessura });
}

/** O título de seção: rótulo espaçado à esquerda e uma régua fina ocupando o resto da linha. */
function tituloDaSecao(ctx: Ctx, titulo: string): void {
  const escrito = espacado(titulo);
  texto(ctx, escrito, M, 6.6, { bold: true, cor: SOFT });
  regua(ctx, ctx.y + 2, LINE, 0.5, M + ctx.bold.widthOfTextAtSize(escrito, 6.6) + 7);
  ctx.y -= 12;
}

/** Quebra o parágrafo na largura disponível, palavra a palavra. */
function quebrar(valor: string, font: PDFFont, size: number, largura: number): string[] {
  const palavras = seguro(valor).split(/\s+/).filter(Boolean);
  const linhas: string[] = [];
  let atual = "";
  for (const palavra of palavras) {
    const teste = atual ? `${atual} ${palavra}` : palavra;
    if (font.widthOfTextAtSize(teste, size) > largura && atual) {
      linhas.push(atual);
      atual = palavra;
    } else {
      atual = teste;
    }
  }
  if (atual) linhas.push(atual);
  return linhas;
}

type Coluna = { alinhamento?: "direita" | "esquerda"; largura: number; titulo: string };

function cabecalhoDaTabela(ctx: Ctx, colunas: Coluna[], xs: number[]): void {
  colunas.forEach((c, i) => {
    const escrito = espacado(c.titulo);
    if (!c.titulo) return;
    if (c.alinhamento === "direita") {
      textoDireita(ctx, escrito, xs[i]! + c.largura, 6.2, { bold: true, cor: MUTE });
    } else {
      texto(ctx, escrito, xs[i]!, 6.2, { bold: true, cor: MUTE });
    }
  });
  ctx.y -= 5;
  regua(ctx, ctx.y, LINE);
  ctx.y -= 11;
}

/**
 * Uma tabela do documento: cabeçalho espaçado, régua, linhas com fio fino embaixo.
 *
 * `sufixos` existe para o "+ IPCA" que o Lucas pediu ao lado do valor reajustado — ele vai em
 * corpo menor e cinza, colado no número, e não numa coluna própria: numa coluna, a tabela ganharia
 * uma divisão a mais para dizer uma palavra que só aparece em algumas linhas.
 *
 * ⚠️ A TABELA QUEBRA DE PÁGINA e repete o cabeçalho: uma coluna de datas sem o "VENCIMENTO" em
 * cima, na segunda página, vira uma lista de números sem nome.
 */
function tabela(
  ctx: Ctx,
  colunas: Coluna[],
  linhas: string[][],
  opts: { continuacao?: string; soma?: string[]; sufixos?: Array<null | string> } = {},
): void {
  const xs: number[] = [];
  let x = M;
  for (const c of colunas) {
    xs.push(x);
    x += c.largura;
  }

  garantirEspaco(ctx, 46);
  cabecalhoDaTabela(ctx, colunas, xs);

  linhas.forEach((linha, indice) => {
    if (ctx.y - 18 < PISO) {
      garantirEspaco(ctx, 18);
      cabecalhoDaTabela(ctx, colunas, xs);
    }
    colunas.forEach((c, i) => {
      const valor = linha[i] ?? "";
      if (!valor) return;
      if (c.alinhamento === "direita") {
        const sufixo = opts.sufixos?.[indice] ?? null;
        const direita = xs[i]! + c.largura;
        if (sufixo) {
          const larguraSufixo = ctx.font.widthOfTextAtSize(seguro(` ${sufixo}`), 7);
          texto(ctx, ` ${sufixo}`, direita - larguraSufixo, 7, { cor: SOFT });
          textoDireita(ctx, valor, direita - larguraSufixo, 8.6);
        } else {
          textoDireita(ctx, valor, direita, 8.6);
        }
      } else {
        texto(ctx, valor, xs[i]!, 8.6);
      }
    });
    ctx.y -= 6;
    regua(ctx, ctx.y, HAIR);
    ctx.y -= 12;
  });

  if (opts.continuacao) {
    garantirEspaco(ctx, 16);
    const size = 7.6;
    const largura = ctx.font.widthOfTextAtSize(seguro(opts.continuacao), size);
    texto(ctx, opts.continuacao, (A4.w - largura) / 2, size, { cor: MUTE });
    ctx.y -= 14;
  }

  if (opts.soma) {
    garantirEspaco(ctx, 20);
    ctx.y += 2;
    regua(ctx, ctx.y + 8, INK, 0.7);
    colunas.forEach((c, i) => {
      const valor = opts.soma?.[i] ?? "";
      if (!valor) return;
      if (c.alinhamento === "direita") {
        textoDireita(ctx, valor, xs[i]! + c.largura, 9, { bold: true, cor: INK });
      } else {
        texto(ctx, valor, xs[i]!, 9, { bold: true, cor: INK });
      }
    });
    ctx.y -= 14;
  }
}

/** PNG ou JPG, descobrindo pela assinatura do arquivo — o operador sobe os dois. */
async function embutir(doc: PDFDocument, bytes: Uint8Array): Promise<null | PDFImage> {
  try {
    const png = bytes[0] === 0x89 && bytes[1] === 0x50;
    return png ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  } catch {
    // ⚠️ BEST-EFFORT, como no extrato: imagem quebrada não impede a proposta de sair.
    return null;
  }
}

/** A proposta em PDF. Uma página quando cabe; quantas precisar quando o plano é comprido. */
export async function montarPropostaPdf(dados: PropostaParaPdf): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([A4.w, A4.h]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const ctx: Ctx = {
    bold,
    doc,
    font,
    page,
    paginas: [page],
    topo: `Proposta ${dados.codigo} · ${dados.empreendimento} · ${dados.unidade}`,
    y: A4.h - 40,
  };

  doc.setTitle(`Proposta ${seguro(dados.codigo)} - ${seguro(dados.unidade)}`);
  doc.setProducer("Panteon");
  doc.setCreator("C2X");

  // ── CABEÇALHO ────────────────────────────────────────────────────────────
  const topo = ctx.y;
  if (dados.logoEmpreendimento) {
    const img = await embutir(doc, dados.logoEmpreendimento);
    if (img) {
      const altura = 34;
      page.drawImage(img, {
        height: altura,
        width: img.width * (altura / img.height),
        x: M,
        y: topo - altura + 6,
      });
    }
  }

  textoDireita(ctx, espacado("Proposta de aquisição"), A4.w - M, 6.6, { cor: SOFT, y: topo + 2 });
  textoDireita(ctx, dados.codigo, A4.w - M, 16.5, { bold: true, cor: INK, y: topo - 18 });
  textoDireita(ctx, espacado(`Emitida em ${dados.emitidaEm}`), A4.w - M, 6.2, {
    cor: MUTE,
    y: topo - 28,
  });

  ctx.y = topo - 40;
  regua(ctx, ctx.y, INK, 1.4);

  ctx.y -= 22;
  texto(ctx, dados.unidade, M, 15, { bold: true, cor: INK });
  ctx.y -= 12;
  texto(ctx, dados.subtitulo, M, 8.6, { cor: SOFT });

  // ── OS QUATRO NÚMEROS ────────────────────────────────────────────────────
  ctx.y -= 16;
  regua(ctx, ctx.y, LINE);
  const alturaCards = 40;
  const larguraCard = LARGURA / Math.max(1, dados.destaques.length);
  const baseCards = ctx.y;

  dados.destaques.forEach((d, i) => {
    const x = M + larguraCard * i;
    if (i > 0) {
      page.drawLine({
        color: LINE,
        end: { x, y: baseCards - alturaCards },
        start: { x, y: baseCards },
        thickness: 0.5,
      });
    }
    const xTexto = i === 0 ? x : x + 10;
    texto(ctx, espacado(d.rotulo), xTexto, 6, { bold: true, cor: MUTE, y: baseCards - 12 });
    const ultimo = i === dados.destaques.length - 1;
    texto(ctx, d.valor, xTexto, ultimo ? 14 : 12, { bold: true, cor: INK, y: baseCards - 27 });
    texto(ctx, d.detalhe, xTexto, 7, { cor: SOFT, y: baseCards - 36 });
  });

  ctx.y = baseCards - alturaCards;
  regua(ctx, ctx.y, LINE);

  // ── COMPRADORES ──────────────────────────────────────────────────────────
  ctx.y -= 22;
  tituloDaSecao(ctx, "Compradores");
  // ⚠️ COM UM COMPRADOR SÓ A COLUNA NÃO EXISTE: "100%" ao lado de um nome sozinho é uma coluna
  // gasta para dizer o óbvio.
  const mostraParticipacao = dados.compradores.length > 1;
  tabela(
    ctx,
    [
      { largura: LARGURA * 0.5, titulo: "Nome" },
      { largura: LARGURA * 0.28, titulo: "CPF" },
      {
        alinhamento: "direita",
        largura: LARGURA * 0.22,
        titulo: mostraParticipacao ? "Participação" : "",
      },
    ],
    dados.compradores.map((c) => [c.nome, c.documento, mostraParticipacao ? c.participacao : ""]),
  );

  // ── CONDIÇÕES ────────────────────────────────────────────────────────────
  ctx.y -= 10;
  const metade = Math.ceil(dados.condicoes.length / 2);
  garantirEspaco(ctx, metade * 14 + 24);
  tituloDaSecao(ctx, "Condições do financiamento");
  const colunaLargura = (LARGURA - 26) / 2;
  const baseCondicoes = ctx.y;
  dados.condicoes.forEach((c, i) => {
    const coluna = i < metade ? 0 : 1;
    const linha = coluna === 0 ? i : i - metade;
    const x = M + coluna * (colunaLargura + 26);
    const y = baseCondicoes - linha * 14;
    texto(ctx, c.rotulo, x, 8.6, { cor: SOFT, y });
    textoDireita(ctx, c.valor, x + colunaLargura, 8.6, { bold: true, cor: INK, y });
    regua(ctx, y - 4, HAIR, 0.5, x, x + colunaLargura);
  });
  ctx.y = baseCondicoes - metade * 14 - 6;

  // ── ENTRADA ──────────────────────────────────────────────────────────────
  ctx.y -= 12;
  tituloDaSecao(ctx, "Pagamento da entrada");
  tabela(
    ctx,
    [
      { largura: LARGURA * 0.22, titulo: "Parcela" },
      { largura: LARGURA * 0.5, titulo: "Vencimento" },
      { alinhamento: "direita", largura: LARGURA * 0.28, titulo: "Valor" },
    ],
    dados.entrada.map((p) => [p.ordem, p.vencimento, p.valor]),
    { soma: ["Total da entrada", "", dados.entradaTotal] },
  );

  // ── PARCELAS ANUAIS ──────────────────────────────────────────────────────
  //
  // ⚠️ O FLUXO DELAS SAI JUNTO (Lucas, 04/09/2026: *"se tem anuais, tem que ter também o fluxo
  // delas no descritivo"*). A parcela anual é a que pega o comprador de surpresa: não cai no
  // boleto do mês e chega uma vez por ano, num valor várias vezes maior que a mensal. Dizer só
  // "10 de R$ 2.000,00" nas condições deixa a data — que é o que ele precisa para se programar —
  // fora do papel.
  //
  // ⚠️ NO MÁXIMO QUATRO LINHAS (Lucas, vendo as dez do exemplo: *"coloca 3 ou 4 somente"*). Um
  // plano de 200 parcelas pode ter 16 anuais, e listá-las uma a uma empurra a proposta para a
  // terceira página sem acrescentar nada: elas são todas iguais, no mesmo dia, e o que muda é só
  // o ano. As quatro primeiras mostram o padrão; a linha de continuação diz até quando vai.
  if (dados.anuais.length > 0) {
    ctx.y -= 12;
    tituloDaSecao(ctx, "Pagamento das parcelas anuais");
    const mostradas = dados.anuais.slice(0, MAX_LINHAS_DO_FLUXO);
    const ultima = dados.anuais[dados.anuais.length - 1];
    tabela(
      ctx,
      [
        { largura: LARGURA * 0.22, titulo: "Parcela" },
        { largura: LARGURA * 0.5, titulo: "Vencimento" },
        { alinhamento: "direita", largura: LARGURA * 0.28, titulo: "Valor" },
      ],
      mostradas.map((p) => [p.ordem, p.vencimento, p.valor]),
      {
        continuacao:
          dados.anuais.length > MAX_LINHAS_DO_FLUXO && ultima
            ? `as demais seguem uma por ano, na mesma data, até ${ultima.vencimento}`
            : undefined,
        soma: ["Total das anuais", "", dados.anuaisTotal],
      },
    );
  }

  // ── REAJUSTE ─────────────────────────────────────────────────────────────
  if (dados.reajustes.length > 0) {
    ctx.y -= 12;
    tituloDaSecao(ctx, "Reajuste da parcela");
    tabela(
      ctx,
      [
        { largura: LARGURA * 0.14, titulo: "Período" },
        { largura: LARGURA * 0.16, titulo: "Parcelas" },
        { largura: LARGURA * 0.2, titulo: "De" },
        { largura: LARGURA * 0.2, titulo: "Até" },
        { alinhamento: "direita", largura: LARGURA * 0.3, titulo: "Valor da parcela" },
      ],
      dados.reajustes.map((r) => [r.periodo, r.parcelas, r.de, r.ate, r.valor]),
      {
        continuacao: "os reajustes seguintes seguem a mesma regra, sempre no aniversário",
        sufixos: dados.reajustes.map((r) => (r.temIpca ? "+ IPCA" : null)),
      },
    );
  }

  // ── OBSERVAÇÕES ──────────────────────────────────────────────────────────
  if (dados.observacoes.length > 0) {
    ctx.y -= 10;
    garantirEspaco(ctx, 40);
    tituloDaSecao(ctx, "Observações");
    for (const obs of dados.observacoes) {
      const larguraTitulo = bold.widthOfTextAtSize(seguro(obs.titulo), 7.6);
      const primeira = quebrar(obs.texto, font, 7.6, LARGURA - larguraTitulo - 4)[0] ?? "";
      const resto = quebrar(
        obs.texto.slice(primeira.length).trim(),
        font,
        7.6,
        LARGURA,
      );

      garantirEspaco(ctx, (resto.length + 1) * 10 + 6);
      texto(ctx, obs.titulo, M, 7.6, { bold: true, cor: TEXT });
      texto(ctx, primeira, M + larguraTitulo + 4, 7.6, { cor: SOFT });
      ctx.y -= 10;
      // ⚠️ A PRIMEIRA LINHA É MAIS CURTA porque divide espaço com o título em negrito; da segunda
      // em diante o parágrafo ocupa a largura inteira, e por isso a quebra é refeita.
      for (const linha of resto) {
        texto(ctx, linha, M, 7.6, { cor: SOFT });
        ctx.y -= 10;
      }
      ctx.y -= 4;
    }
  }

  // ── RODAPÉ, EM TODA PÁGINA ───────────────────────────────────────────────
  const marca = dados.logoC2x ? await embutir(doc, dados.logoC2x) : null;
  const atendimento = [
    dados.atendimento.corretor ? `Atendimento: ${dados.atendimento.corretor}` : null,
    dados.atendimento.imobiliaria,
    dados.atendimento.telefone,
  ]
    .filter(Boolean)
    .join(" · ");
  const coordenacao = dados.atendimento.coordenador
    ? `Coordenação de vendas: ${dados.atendimento.coordenador}`
    : "";
  const linhaDoAtendimento = [atendimento, coordenacao].filter(Boolean).join("  |  ");

  ctx.paginas.forEach((pagina, i) => {
    const centro = (valor: string, size: number, y: number, cor = MUTE) => {
      pagina.drawText(seguro(valor), {
        color: cor,
        font,
        size,
        x: (A4.w - font.widthOfTextAtSize(seguro(valor), size)) / 2,
        y,
      });
    };

    pagina.drawLine({
      color: LINE,
      end: { x: A4.w - M, y: 88 },
      start: { x: M, y: 88 },
      thickness: 0.5,
    });

    if (linhaDoAtendimento) centro(linhaDoAtendimento, 6.6, 78);
    centro(`${ctx.topo} · Página ${i + 1} de ${ctx.paginas.length}`, 6.6, 68);

    if (marca) {
      const altura = 14;
      const largura = marca.width * (altura / marca.height);
      const rotulo = "Emitido pelo ";
      const larguraRotulo = font.widthOfTextAtSize(rotulo, 6.6);
      const inicio = (A4.w - (larguraRotulo + 4 + largura)) / 2;
      pagina.drawText(rotulo, { color: MUTE, font, size: 6.6, x: inicio, y: 52 });
      pagina.drawImage(marca, {
        height: altura,
        width: largura,
        x: inicio + larguraRotulo + 4,
        y: 48,
      });
    }
  });

  return doc.save();
}
