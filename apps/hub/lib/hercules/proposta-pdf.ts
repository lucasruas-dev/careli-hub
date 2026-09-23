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

import {
  PDFDocument,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  StandardFonts,
  rgb,
} from "pdf-lib";

import type { TipoProduto } from "./produto-novo";

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
// A tarja da prévia. Âmbar, e não vermelho: vermelho no rodapé de uma proposta lê-se como recusa
// ou erro, e o que a tarja diz é "ainda não" — o mesmo tom que a tela usa para atenção.
const AVISO_FUNDO = rgb(0.996, 0.949, 0.78); // #fef2c7
const AVISO_TINTA = rgb(0.475, 0.333, 0.024); // #795506

export type ParcelaDaProposta = {
  /** "1 de 2" */
  ordem: string;
  /** "10 de outubro de 2026" */
  vencimento: string;
  valor: string;
};

/**
 * Um bem ou uma permuta recebido na aquisição, já escrito como o papel imprime.
 *
 * ⚠️ TUDO CHEGA EM TEXTO, inclusive o "Bem"/"Permuta" e o "Entrada"/"Abatimento": quem traduz o
 * dado em palavra é `montarFolhaDaProposta`, como em toda linha desta folha. Um gerador que
 * também decidisse a palavra seria um gerador que decide o que o documento diz.
 */
export type BemDaFolha = {
  /**
   * "Entrada" ou "Abatimento" — o papel que aquele bem cumpriu na negociação.
   *
   * ⚠️ OS DOIS ABATEM; SÓ UM CUMPRE A ENTRADA MÍNIMA de 10% (Lucas, 22/09/2026: *"pode ser um ou
   * outro, pode apontar na entrada ou somente no valor negociado"*). Sem esta coluna, quem confere
   * a entrada no papel ou soma o mesmo dinheiro duas vezes, ou não acha os 10% que a folha anuncia.
   */
  comoEntra: string;
  /** "Ford Ka 2019 placa ABC1D23" — texto livre do operador, cortado se não couber na coluna. */
  descricao: string;
  /** "Bem" ou "Permuta". */
  tipo: string;
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
  /**
   * Os bens e as permutas recebidos na aquisição — carro, lote, imóvel dado no negócio.
   *
   * ⚠️ VAZIO OU AUSENTE = A SEÇÃO NÃO EXISTE, como nas anuais. A maioria das propostas não tem
   * permuta, e uma seção com um "R$ 0,00" mudaria o papel de todo mundo por causa de um recurso
   * de poucos. Há teste comparando o desenho inteiro, linha por linha e coordenada por
   * coordenada, contra a impressão digital tirada antes desta seção existir.
   *
   * ⚠️ E QUANDO EXISTE, ELA NÃO PODE FALTAR: Lucas (22/09/2026) sobre a permuta, *"Abate, como
   * uma entrada"*. Um bem de R$ 80.000 que some do papel faz o comprador ler o saldo e achar que
   * está devendo R$ 80.000 a mais do que combinou.
   */
  bensEPermutas?: BemDaFolha[];
  /** A soma dos bens e permutas, já escrita. Vazio quando não há nenhum. */
  bensEPermutasTotal?: string;
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
  /**
   * A folha é uma PRÉVIA: as condições existem, a proposta não.
   *
   * Lucas (05/09/2026): *"podia ter um botão para ter uma prévia da proposta"* — ver o papel antes
   * de clicar num botão que cadastra a venda, muda a etapa da unidade e manda três WhatsApps.
   *
   * ⚠️ E A PRÉVIA PRECISA SE DENUNCIAR NO PAPEL. Um PDF idêntico ao definitivo sai da tela e vira
   * anexo de WhatsApp em dois toques; do outro lado, o cliente guarda como proposta um documento
   * que não existe no sistema, com preço que ninguém reservou. A tarja é o que impede que a prévia
   * seja usada como proposta — por isso ela vai no papel, e não só na tela que o gerou.
   */
  previa?: boolean;
  /**
   * A folha é uma SIMULAÇÃO, e não uma proposta.
   *
   * ⚠️ MUDA QUATRO COISAS NO PAPEL, e cada uma porque a simulação não tem o que a proposta tem:
   * o título deixa de dizer "Proposta de aquisição"; o CÓDIGO some do topo (não há venda, então
   * não há COD — imprimir o código do lote ali faria o cliente guardar um número que não existe
   * no sistema); a seção COMPRADORES some (ninguém foi qualificado, e o cabeçalho vazio "Nome |
   * CPF" era um convite a preencher à mão); e a tarja passa a dizer o que a folha é.
   *
   * Lucas (10/09/2026), vendo o primeiro PDF: *"isso é uma simulação, ou seja, não precisa nome,
   * reajuste sem codigo, é uma simulação, também destacar isso"*.
   */
  /**
   * A tabela de reajuste da parcela entra no papel? Nasce desmarcada (ver `DadosDaFolha`).
   *
   * ⚠️ ELA NUNCA SAI NA SIMULACAO, independente desta bandeira: as duas travas sao diferentes e a
   * da simulacao e mais antiga (Lucas, 10/09/2026: *"tirar o reajuste das parcelas"*).
   */
  incluirReajuste?: boolean;
  simulacao?: boolean;
  reajustes: FaixaDeReajuste[];
  /**
   * Se a parcela deste plano REALMENTE muda ao longo do contrato (degrau de juros ou índice).
   *
   * ⚠️ NEM TODO PLANO REAJUSTA. O PLANO INVESTIDOR, que está cadastrado e ativo, tem 36 parcelas,
   * juros nulos e índice SEM_CORRECAO: a parcela é a mesma do começo ao fim. Sem esta distinção a
   * folha saía com a seção "Reajuste da parcela" e a frase "os reajustes seguintes seguem a mesma
   * regra, sempre no aniversário" impressas num contrato que não tem reajuste nenhum — prometendo
   * ao comprador um aumento que ele não vai ter, no papel que circula por WhatsApp. A observação
   * já sabia se calar (`temDegrau || temCorrecao` em `proposta-para-pdf.ts`); a tabela não sabia.
   */
  temReajuste: boolean;
  /** "Garden · 250,00 m² · Goiânia, GO" */
  subtitulo: string;
  /**
   * O tipo do produto. Ausente = loteamento, que é o que toda folha foi até a migration 0170.
   *
   * ⚠️ SÓ MUDA PALAVRA, NUNCA CONTA. No prédio a tarja da simulação diz "a unidade", e não "o lote":
   * a folha vai no WhatsApp de quem está comprando apartamento.
   */
  tipoProduto?: TipoProduto;
  /**
   * "Quadra 03 · Lote 07" no loteamento; "Torre A · Apto 304" ou "Apto 304" no prédio.
   *
   * ⚠️ CHEGA PRONTO, e quem escreve é `nomeDaUnidade` (`nome-da-unidade.ts`): a mesma frase do
   * WhatsApp da reserva e da proposta. Este arquivo não decompõe código nem monta quadra e lote.
   */
  unidade: string;
};

/**
 * A tarja do rodapé: o que a folha é, quando ela NÃO é a proposta definitiva. `null` = sem tarja.
 *
 * ⚠️ "NÃO RESERVA O LOTE" SÓ NO LOTEAMENTO. Num apartamento a mesma frase diria ao comprador que
 * existe um lote na conversa; no prédio ela diz "a unidade".
 */
export function avisoDaFolha(
  dados: Pick<PropostaParaPdf, "previa" | "simulacao" | "tipoProduto">,
): null | string {
  if (dados.simulacao) {
    return dados.tipoProduto === "vertical"
      ? "SIMULAÇÃO DE PAGAMENTO - não é proposta e não reserva a unidade"
      : "SIMULAÇÃO DE PAGAMENTO - não é proposta e não reserva o lote";
  }
  if (dados.previa) return "PRÉVIA - documento sem validade: a proposta ainda não foi gerada";
  return null;
}

/**
 * O texto que a Helvetica consegue escrever.
 *
 * ⚠️ pdf-lib LANÇA ao encontrar caractere fora do WinAnsi, e o erro sai na hora de gravar — ou
 * seja, depois de a proposta já ter sido gravada no banco. Um nome com caractere exótico não pode
 * derrubar o envio: aqui ele é aproximado, e o pior caso é uma letra sem acento no papel.
 */
function seguro(valor: string): string {
  return (
    String(valor ?? "")
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/[—–]/g, "-")
      .replace(/…/g, "...")
      // A Helvetica escreve o Latin-1 imprimível; o que estiver fora vira nada.
      .replace(/[^ -ÿ]/g, "")
  );
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
  texto(
    ctx,
    valor,
    direita - f.widthOfTextAtSize(seguro(valor), size),
    size,
    opts,
  );
}

/** Maiúsculas espaçadas — o rótulo de seção do documento. pdf-lib não tem letter-spacing. */
function espacado(valor: string): string {
  return seguro(valor.toUpperCase()).split("").join(" ");
}

function regua(
  ctx: Ctx,
  y: number,
  cor = LINE,
  espessura = 0.5,
  de = M,
  ate = A4.w - M,
): void {
  ctx.page.drawLine({
    color: cor,
    end: { x: ate, y },
    start: { x: de, y },
    thickness: espessura,
  });
}

/** O título de seção: rótulo espaçado à esquerda e uma régua fina ocupando o resto da linha. */
/**
 * O título de uma seção da folha.
 *
 * ⚠️ ELE PRECISA SE SEPARAR DO CABEÇALHO DE COLUNA (Lucas, 05/09/2026: *"coloca em negrito o nome
 * do cliente e os títulos — condições do financiamento, pagamento da entrada, reajuste da parcela
 * — tá misturando"*). Os dois eram versaletes cinzas quase iguais: 6,6pt em #5a6778 contra 6,2pt
 * em #94a3b8 — quatro décimos de ponto e um tom de diferença. Lado a lado ("PAGAMENTO DA ENTRADA"
 * logo acima de "PARCELA · VENCIMENTO · VALOR"), o leitor não sabia onde uma seção começava e a
 * tabela dela terminava. Agora o título é maior e ESCURO; o cabeçalho segue miúdo e claro, que é o
 * papel dele.
 */
function tituloDaSecao(ctx: Ctx, titulo: string): void {
  const escrito = espacado(titulo);
  const size = 7.6;
  texto(ctx, escrito, M, size, { bold: true, cor: INK });
  regua(
    ctx,
    ctx.y + 2,
    LINE,
    0.5,
    M + ctx.bold.widthOfTextAtSize(escrito, size) + 7,
  );
  ctx.y -= 13;
}

/** Quebra o parágrafo na largura disponível, palavra a palavra. */
function quebrar(
  valor: string,
  font: PDFFont,
  size: number,
  largura: number,
): string[] {
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

type Coluna = {
  alinhamento?: "direita" | "esquerda";
  /**
   * Corta o valor que não couber na largura da coluna, com reticências.
   *
   * ⚠️ SÓ PARA TEXTO LIVRE, e por isso não é o padrão: as colunas do documento são todas de dado
   * formatado por nós (data por extenso, "1 de 2", "R$ 583,33"), e encurtar um valor desses
   * esconderia dinheiro. A descrição do bem é digitada pelo operador, sem limite de tamanho, e
   * `tabela` desenha cada célula num x FIXO: sem o corte, "Fazenda Santa Luzia, 42 alqueires com
   * sede, curral..." atravessa a coluna do valor e o comprador lê o preço do bem por cima das
   * letras.
   */
  encurta?: boolean;
  largura: number;
  /** Destaca o VALOR da coluna (não o cabeçalho). Serve ao nome de quem compra. */
  negrito?: boolean;
  titulo: string;
};

/** O texto que cabe em `largura`, com reticências de três pontos quando sobra. */
function encurtar(
  font: PDFFont,
  valor: string,
  size: number,
  largura: number,
): string {
  let escrito = seguro(valor);
  if (font.widthOfTextAtSize(escrito, size) <= largura) return escrito;
  // ⚠️ RETICÊNCIAS DE TRÊS PONTOS, e não "…": o caractere único não existe no WinAnsi e faria o
  // encode lançar na hora de gravar — o mesmo cuidado do rodapé.
  while (
    escrito.length > 1 &&
    font.widthOfTextAtSize(`${escrito.trimEnd()}...`, size) > largura
  ) {
    escrito = escrito.slice(0, -1);
  }
  return `${escrito.trimEnd()}...`;
}

function cabecalhoDaTabela(ctx: Ctx, colunas: Coluna[], xs: number[]): void {
  colunas.forEach((c, i) => {
    const escrito = espacado(c.titulo);
    if (!c.titulo) return;
    if (c.alinhamento === "direita") {
      textoDireita(ctx, escrito, xs[i]! + c.largura, 6.2, {
        bold: true,
        cor: MUTE,
      });
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
  opts: {
    continuacao?: string;
    soma?: string[];
    sufixos?: Array<null | string>;
  } = {},
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
          const larguraSufixo = ctx.font.widthOfTextAtSize(
            seguro(` ${sufixo}`),
            7,
          );
          texto(ctx, ` ${sufixo}`, direita - larguraSufixo, 7, { cor: SOFT });
          textoDireita(ctx, valor, direita - larguraSufixo, 8.6);
        } else {
          textoDireita(ctx, valor, direita, 8.6);
        }
      } else {
        const fonte = c.negrito ? ctx.bold : ctx.font;
        texto(
          ctx,
          // A folga de 8pt é o respiro até a coluna vizinha: encostar uma na outra já se lê como
          // texto invadido.
          c.encurta ? encurtar(fonte, valor, 8.6, c.largura - 8) : valor,
          xs[i]!,
          8.6,
          c.negrito ? { bold: true, cor: INK } : undefined,
        );
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
        textoDireita(ctx, valor, xs[i]! + c.largura, 9, {
          bold: true,
          cor: INK,
        });
      } else {
        texto(ctx, valor, xs[i]!, 9, { bold: true, cor: INK });
      }
    });
    ctx.y -= 14;
  }
}

/** PNG ou JPG, descobrindo pela assinatura do arquivo — o operador sobe os dois. */
async function embutir(
  doc: PDFDocument,
  bytes: Uint8Array,
): Promise<null | PDFImage> {
  try {
    const png = bytes[0] === 0x89 && bytes[1] === 0x50;
    return png ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  } catch {
    // ⚠️ BEST-EFFORT, como no extrato: imagem quebrada não impede a proposta de sair.
    return null;
  }
}

/** A proposta em PDF. Uma página quando cabe; quantas precisar quando o plano é comprido. */
export async function montarPropostaPdf(
  dados: PropostaParaPdf,
): Promise<Uint8Array> {
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
    // ⚠️ O RODAPÉ TAMBÉM É PAPEL DO CLIENTE. Sem esta distinção a folha da simulação saía com
    // "Proposta VDO0923" no pé — o número do lote apresentado como número de proposta, na única
    // linha que se repete em toda página.
    topo: dados.simulacao
      ? `Simulação · ${dados.empreendimento} · ${dados.unidade}`
      : `Proposta ${dados.codigo} · ${dados.empreendimento} · ${dados.unidade}`,
    y: A4.h - 40,
  };

  // ⚠️ O TÍTULO DO ARQUIVO TAMBÉM DIZ QUE É PRÉVIA. Ele é o que aparece na aba do navegador e no
  // gerenciador de arquivos de quem baixa: um PDF chamado "Proposta 000006" desmente a tarja
  // impressa dentro dele, e é pelo nome que alguém decide reenviar o arquivo.
  doc.setTitle(
    dados.simulacao
      ? `Simulacao - ${seguro(dados.empreendimento)} - ${seguro(dados.unidade)}`
      : `${dados.previa ? "PREVIA - " : ""}Proposta ${seguro(dados.codigo)} - ${seguro(dados.unidade)}`,
  );
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

  textoDireita(
    ctx,
    espacado(
      dados.simulacao ? "Simulação de pagamento" : "Proposta de aquisição",
    ),
    A4.w - M,
    6.6,
    { cor: SOFT, y: topo + 2 },
  );
  // ⚠️ SEM CÓDIGO NA SIMULAÇÃO. Não há venda, logo não há COD; o código do lote no lugar em que o
  // coordenador procura o número da proposta faria o cliente guardar um identificador que o
  // sistema não reconhece. No lugar dele, a folha diz o que é.
  textoDireita(
    ctx,
    dados.simulacao ? "SIMULAÇÃO" : dados.codigo,
    A4.w - M,
    dados.simulacao ? 13 : 16.5,
    { bold: true, cor: dados.simulacao ? AVISO_TINTA : INK, y: topo - 18 },
  );
  textoDireita(
    ctx,
    espacado(
      dados.simulacao
        ? `Gerada em ${dados.emitidaEm}`
        : `Emitida em ${dados.emitidaEm}`,
    ),
    A4.w - M,
    6.2,
    { cor: MUTE, y: topo - 28 },
  );

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
    texto(ctx, espacado(d.rotulo), xTexto, 6, {
      bold: true,
      cor: MUTE,
      y: baseCards - 12,
    });
    const ultimo = i === dados.destaques.length - 1;
    texto(ctx, d.valor, xTexto, ultimo ? 14 : 12, {
      bold: true,
      cor: INK,
      y: baseCards - 27,
    });
    texto(ctx, d.detalhe, xTexto, 7, { cor: SOFT, y: baseCards - 36 });
  });

  ctx.y = baseCards - alturaCards;
  regua(ctx, ctx.y, LINE);

  // ── COMPRADORES ──────────────────────────────────────────────────────────
  //
  // ⚠️ NA SIMULAÇÃO A SEÇÃO NÃO EXISTE. Sem comprador qualificado, ela saía como um cabeçalho
  // "Nome | CPF" sobre uma linha em branco — que além de gastar papel para dizer que não há
  // ninguém, parece um campo esperando ser preenchido à mão.
  if (!dados.simulacao) {
    ctx.y -= 22;
    tituloDaSecao(ctx, "Compradores");
    // ⚠️ COM UM COMPRADOR SÓ A COLUNA NÃO EXISTE: "100%" ao lado de um nome sozinho é uma coluna
    // gasta para dizer o óbvio.
    const mostraParticipacao = dados.compradores.length > 1;
    tabela(
      ctx,
      [
        // O nome de quem compra é o dado mais consultado da folha: ele fica em negrito.
        { largura: LARGURA * 0.5, negrito: true, titulo: "Nome" },
        { largura: LARGURA * 0.28, titulo: "CPF" },
        {
          alinhamento: "direita",
          largura: LARGURA * 0.22,
          titulo: mostraParticipacao ? "Participação" : "",
        },
      ],
      dados.compradores.map((c) => [
        c.nome,
        c.documento,
        mostraParticipacao ? c.participacao : "",
      ]),
    );
  }

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
    textoDireita(ctx, c.valor, x + colunaLargura, 8.6, {
      bold: true,
      cor: INK,
      y,
    });
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

  // ── BENS E PERMUTAS ──────────────────────────────────────────────────────
  //
  // Lucas (22/09/2026), perguntado se a permuta abate o valor a financiar ou é só registro:
  // *"Abate, como uma entrada"*. Quantos cabem numa proposta: *"Vários"*.
  //
  // ⚠️ LOGO DEPOIS DA ENTRADA, E ANTES DAS ANUAIS. É aqui que o comprador acabou de ler quanto
  // entregou de dinheiro; o bem é a outra metade da mesma resposta ("o que eu já dei"). Jogado
  // para o fim da folha, depois do fluxo das anuais, ele viraria mais uma coisa a pagar.
  //
  // ⚠️ TODAS AS LINHAS, SEM TETO. O corte de quatro linhas das anuais existe porque elas são
  // todas iguais e só muda o ano; bem e permuta são cada um uma coisa diferente no mundo, e
  // esconder o terceiro item some com um bem que o comprador entregou.
  const bens = dados.bensEPermutas ?? [];
  if (bens.length > 0) {
    ctx.y -= 12;
    tituloDaSecao(ctx, "Bens e permutas recebidos");
    tabela(
      ctx,
      [
        { largura: LARGURA * 0.14, titulo: "Tipo" },
        { encurta: true, largura: LARGURA * 0.44, titulo: "Descrição" },
        { largura: LARGURA * 0.18, titulo: "Entra como" },
        { alinhamento: "direita", largura: LARGURA * 0.24, titulo: "Valor" },
      ],
      bens.map((b) => [b.tipo, b.descricao, b.comoEntra, b.valor]),
      {
        // ⚠️ O TOTAL PRECISA DIZER QUE ISSO JÁ SAIU DA DÍVIDA. Sozinho, um "Total em bens e
        // permutas R$ 80.000,00" logo abaixo do fluxo da entrada se lê como mais uma coisa a
        // pagar — e é exatamente o contrário: esse dinheiro já foi entregue e já abateu o saldo.
        //
        // ⚠️ A FRASE VAI NA COLUNA DO "ENTRA COMO", E NÃO NA DA DESCRIÇÃO, porque `tabela` NÃO
        // encurta a linha de soma: "Total em bens e permutas" em Helvetica-Bold 9 mede 110pt e
        // termina em x=144,6, enquanto a coluna da descrição começa em x=108,2 — a frase saía
        // impressa POR CIMA do rótulo do total. Na coluna seguinte (x=339,7) ela termina em
        // x=468,7, com 38pt de folga até o valor. Há teste medindo essas duas larguras.
        soma: [
          "Total em bens e permutas",
          "",
          "já abatido do saldo a financiar",
          dados.bensEPermutasTotal ?? "",
        ],
      },
    );
  }

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
  //
  // ⚠️ NA SIMULAÇÃO A TABELA NÃO VAI. Lucas (10/09/2026): *"tirar o reajuste das parcelas"*, e
  // antes, sobre a tela: *"tem corretor que não gosta que o cliente ver o fluxo de reajuste de
  // parcelas"*. Na tela ela existe atrás de um botão, que o corretor abre se quiser; no papel que
  // ele ENCAMINHA, não — o documento sai da mão dele e ele não controla mais quem lê.
  //
  // ⚠️ E DESDE 13/09/2026 ELA TAMBÉM DEPENDE DA ESCOLHA DE QUEM GEROU. A caixa nasce desmarcada,
  // então o padrão passou a ser NÃO imprimir — a seção que saía em toda PA agora só sai quando o
  // coordenador pede. A escolha fica gravada na proposta, e por isso reimprimir o mesmo documento
  // meses depois devolve o mesmo papel.
  if (!dados.simulacao && dados.incluirReajuste && dados.reajustes.length > 0) {
    ctx.y -= 12;
    // ⚠️ O TÍTULO SEGUE O CONTRATO, NÃO A TABELA. Num plano sem degrau e sem índice a mesma tabela
    // continua útil (ela diz quanto é a parcela e de quando até quando), mas chamá-la de
    // "Reajuste da parcela" anuncia um reajuste que não existe.
    tituloDaSecao(
      ctx,
      dados.temReajuste ? "Reajuste da parcela" : "Parcelas mensais",
    );
    tabela(
      ctx,
      [
        { largura: LARGURA * 0.14, titulo: "Período" },
        { largura: LARGURA * 0.16, titulo: "Parcelas" },
        { largura: LARGURA * 0.2, titulo: "De" },
        { largura: LARGURA * 0.2, titulo: "Até" },
        {
          alinhamento: "direita",
          largura: LARGURA * 0.3,
          titulo: "Valor da parcela",
        },
      ],
      dados.reajustes.map((r) => [r.periodo, r.parcelas, r.de, r.ate, r.valor]),
      {
        // A frase da continuação só faz sentido quando há reajustes seguintes de que falar.
        continuacao: dados.temReajuste
          ? "os reajustes seguintes seguem a mesma regra, sempre no aniversário"
          : undefined,
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
      const primeira =
        quebrar(obs.texto, font, 7.6, LARGURA - larguraTitulo - 4)[0] ?? "";
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
    dados.atendimento.corretor
      ? `Atendimento: ${dados.atendimento.corretor}`
      : null,
    dados.atendimento.imobiliaria,
    dados.atendimento.telefone,
  ]
    .filter(Boolean)
    .join(" · ");
  const coordenacao = dados.atendimento.coordenador
    ? `Coordenação de vendas: ${dados.atendimento.coordenador}`
    : "";
  const linhaDoAtendimento = [atendimento, coordenacao]
    .filter(Boolean)
    .join("  |  ");

  ctx.paginas.forEach((pagina, i) => {
    const centro = (valor: string, size: number, y: number, cor = MUTE) => {
      // ⚠️ CENTRALIZAR SEM MEDIR EMPURRA O TEXTO PARA FORA DA PÁGINA. `x` é `(largura − texto)/2`,
      // e quando o texto é mais largo que a folha esse número fica NEGATIVO: a linha começa antes
      // da margem esquerda e termina depois da direita, cortada pela borda do papel. O rodapé é
      // justamente onde entram nomes reais de três pessoas ("Atendimento: Raiane Imobiliária ·
      // Nívea Ferreira | Coordenação de vendas: ..."), que é o caso mais longo do documento.
      let texto = seguro(valor);
      const util = A4.w - 2 * M;
      if (font.widthOfTextAtSize(texto, size) > util) {
        // Corta pelo fim até caber, com reticências de três pontos — o caractere "…" não existe no
        // WinAnsi e faria o encode lançar na hora de gravar.
        while (
          texto.length > 4 &&
          font.widthOfTextAtSize(`${texto}...`, size) > util
        ) {
          texto = texto.slice(0, -1);
        }
        texto = `${texto.trimEnd()}...`;
      }
      pagina.drawText(texto, {
        color: cor,
        font,
        size,
        x: (A4.w - font.widthOfTextAtSize(texto, size)) / 2,
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

    // A TARJA DA PRÉVIA — em TODAS as páginas, e não só na primeira.
    //
    // ⚠️ QUEM RECEBE UM PDF POR WHATSAPP ABRE NUMA PÁGINA QUALQUER. Carimbar só a folha de rosto
    // deixaria as outras indistinguíveis da proposta de verdade, que é justamente o que a tarja
    // existe para evitar. Fica no pé, sobre o rodapé: no topo ela brigaria com a logo do
    // empreendimento e com o COD, que é o que o coordenador procura primeiro.
    const aviso = avisoDaFolha(dados);
    if (aviso) {
      const tamanho = 7.4;
      const largura = bold.widthOfTextAtSize(seguro(aviso), tamanho);
      pagina.drawRectangle({
        color: AVISO_FUNDO,
        height: 15,
        width: largura + 16,
        x: (A4.w - (largura + 16)) / 2,
        y: 26,
      });
      pagina.drawText(seguro(aviso), {
        color: AVISO_TINTA,
        font: bold,
        size: tamanho,
        x: (A4.w - largura) / 2,
        y: 30.5,
      });
    }

    if (marca) {
      const altura = 14;
      const largura = marca.width * (altura / marca.height);
      const rotulo = "Emitido pelo ";
      const larguraRotulo = font.widthOfTextAtSize(rotulo, 6.6);
      const inicio = (A4.w - (larguraRotulo + 4 + largura)) / 2;
      pagina.drawText(rotulo, {
        color: MUTE,
        font,
        size: 6.6,
        x: inicio,
        y: 52,
      });
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
