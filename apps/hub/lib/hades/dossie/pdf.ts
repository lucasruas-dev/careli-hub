import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";

import { CARELI_LOGO_PNG_BASE64 } from "./careli-logo";
import type { DossieDados } from "./dados";

// DOSSIÊ JURÍDICO em PDF — o relatório executivo que instrui o processo.
//
// Segue o modelo da Careli (13 seções). Regras que valem em documento que vai para autos:
//   • número sem origem não entra: cada encargo cita a cláusula do contrato do cliente;
//   • o que não foi apurado aparece como "não apurado", nunca como zero;
//   • DÍVIDA VENCIDA e SALDO TOTAL DO CONTRATO ficam em linhas separadas — confundir os dois
//     muda o pedido (cobrança das vencidas x vencimento antecipado).
//
// Mesma cozinha do comprovante Serasa: pdf-lib + StandardFonts (WinAnsi), logo em base64.

const A4 = { h: 841.89, w: 595.28 };
const M = 42;
const INK = rgb(0.09, 0.09, 0.11);
const TEXT = rgb(0.2, 0.2, 0.24);
const MUTE = rgb(0.48, 0.48, 0.53);
const LINE = rgb(0.85, 0.85, 0.88);
const ZEBRA = rgb(0.97, 0.97, 0.975);
const OURO = rgb(0.66, 0.53, 0.29);
const VERMELHO = rgb(0.7, 0.15, 0.12);
const AMBAR = rgb(0.72, 0.53, 0.04);
const VERDE = rgb(0.24, 0.45, 0.2);

export type DossieEscolhas = {
  motivoEncaminhamento: string;
  recomendacao: string;
  responsavel: string;
  processo: string;
  // Tratativas do Hades (data, responsável, canal, texto) — vêm da camada de cima.
  tratativas: { canal: string; data: string; historico: string; responsavel: string }[];
  documentosAnexos: string[];
  // CORREÇÃO MONETÁRIA MANUAL (decisão do Lucas, 03/08). O C2X tem os índices cadastrados mas a
  // tabela de valores está vazia, então quem gera o dossiê digita o percentual acumulado do
  // período e a referência (índice + intervalo). Vazio = o documento declara a correção como
  // devida e pendente de apuração, sem inventar número.
  correcaoPercent?: number | null;
  correcaoReferencia?: string | null;
};

const brl = (v: number | null | undefined) =>
  v === null || v === undefined
    ? "não apurado"
    : v.toLocaleString("pt-BR", { currency: "BRL", style: "currency" });

// StandardFonts é WinAnsi: caractere fora da tabela quebra a geração inteira.
const clean = (v: unknown): string =>
  String(v ?? "")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "");

export async function gerarDossiePdf(
  d: DossieDados,
  escolhas: DossieEscolhas,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(Buffer.from(CARELI_LOGO_PNG_BASE64, "base64"));

  const paginas: PDFPage[] = [];
  let p!: PDFPage;
  let y = 0;

  const corta = (t: string, larg: number, size: number, f: PDFFont) => {
    let s = clean(t);
    if (f.widthOfTextAtSize(s, size) <= larg) return s;
    while (s.length > 1 && f.widthOfTextAtSize(`${s}...`, size) > larg) s = s.slice(0, -1);
    return `${s}...`;
  };
  const txt = (
    s: string,
    x: number,
    size = 9,
    f: PDFFont = font,
    color = TEXT,
    larg = A4.w - M * 2,
  ) => p.drawText(corta(s, larg, size, f), { color, font: f, size, x, y });

  // Quebra em linhas que cabem na largura. Texto de tratativa é frase inteira: cortar com "..."
  // esconde justamente o desfecho da negociação, que é o que o jurídico precisa ler.
  const quebrar = (s: string, larg: number, size: number, f: PDFFont): string[] => {
    const linhas: string[] = [];
    let atual = "";
    for (const w of clean(s).split(/\s+/).filter(Boolean)) {
      const tentativa = atual ? `${atual} ${w}` : w;
      if (atual && f.widthOfTextAtSize(tentativa, size) > larg) {
        linhas.push(atual);
        atual = w;
      } else atual = tentativa;
    }
    if (atual) linhas.push(atual);
    return linhas;
  };

  const novaPagina = () => {
    p = pdf.addPage([A4.w, A4.h]);
    paginas.push(p);
    const escala = 26 / logo.height;
    p.drawImage(logo, { height: 26, width: logo.width * escala, x: A4.w - M - logo.width * escala, y: A4.h - 52 });
    p.drawText("RELATÓRIO EXECUTIVO PARA ENCAMINHAMENTO AO JURÍDICO", {
      color: INK, font: bold, size: 10, x: M, y: A4.h - 40,
    });
    p.drawText("CARELI ASSESSORIA FINANCEIRA LTDA.", {
      color: MUTE, font, size: 8.5, x: M, y: A4.h - 52,
    });
    p.drawLine({ color: OURO, end: { x: A4.w - M, y: A4.h - 62 }, start: { x: M, y: A4.h - 62 }, thickness: 1.2 });
    y = A4.h - 82;
  };
  const espaco = (n: number) => {
    if (y - n < M + 28) novaPagina();
  };
  const secao = (titulo: string) => {
    espaco(46);
    y -= 6;
    p.drawText(clean(titulo), { color: INK, font: bold, size: 10, x: M, y });
    y -= 6;
    p.drawLine({ color: LINE, end: { x: A4.w - M, y }, start: { x: M, y }, thickness: 0.7 });
    y -= 15;
  };
  // Tabela de duas colunas (Campo | Informação) — o formato do modelo.
  const linha = (rotulo: string, valor: string, i: number, destaque = false, cor = TEXT) => {
    espaco(16);
    if (i % 2 === 1) {
      p.drawRectangle({ color: ZEBRA, height: 14, width: A4.w - M * 2, x: M, y: y - 4 });
    }
    txt(rotulo, M + 4, 8.5, destaque ? bold : font, MUTE, 200);
    txt(valor, M + 215, 8.5, destaque ? bold : font, cor, A4.w - M - 215 - M);
    y -= 14.5;
  };
  // Bloco de linhas de uma vez. A tupla precisa ser TIPADA: array literal solto faz o
  // destructuring [k, v] virar `string | undefined` e o typecheck barra.
  const tabela = (pares: [string, string][], destaques: number[] = []) => {
    pares.forEach(([k, v], i) => linha(k, v, i, destaques.includes(i)));
  };

  novaPagina();

  // ── Cabeçalho ───────────────────────────────────────────────────────────
  const cab: [string, string][] = [
    ["Processo n.", escolhas.processo],
    ["Data de Emissão", d.geradoEm],
    ["Responsável pela Elaboração", escolhas.responsavel],
    ["Responsável pelo Encaminhamento", escolhas.responsavel],
  ];
  tabela(cab);
  y -= 8;

  // ── 1. Identificação ────────────────────────────────────────────────────
  secao("1. IDENTIFICAÇÃO DA NEGOCIAÇÃO");
  tabela([
    ["Cliente", d.cliente],
    ["CPF/CNPJ", d.documento],
    ["Empreendimento", d.empreendimento],
    ["Quadra", d.quadra],
    ["Lote", d.lote],
    ["Unidade", d.unidade],
    ["Código da Venda (PV)", d.codigoVenda],
    ["Data da Venda", d.dataVenda ?? "não informada"],
    ["Situação Atual", d.situacaoAtual],
    ["Responsável Comercial", d.responsavelComercial ?? "não informado"],
  ]);
  y -= 8;

  // ── 2. Dashboard ────────────────────────────────────────────────────────
  secao("2. DASHBOARD EXECUTIVO");
  txt("Resumo Financeiro", M, 9, bold, INK);
  y -= 14;
  tabela(
    [
      ["Valor Total do Lote", brl(d.valorTotalLote)],
      ["Valor Total da Corretagem", d.valorCorretagem > 0 ? brl(d.valorCorretagem) : "não apurado"],
      ["Valor Global da Negociação", brl(d.valorGlobal)],
      ["Total Pago pelo Cliente", brl(d.totalPago)],
      ["Saldo Total do Contrato (inclui parcelas a vencer)", brl(d.saldoDevedor)],
    ],
    [2, 3], // valor global e total pago em negrito
  );
  y -= 6;

  // A DÍVIDA QUE SE COBRA HOJE — separada do saldo total de propósito.
  const temCorrecao = d.correcaoAplicada > 0;
  espaco(temCorrecao ? 72 : 58);
  p.drawRectangle({
    borderColor: VERMELHO, borderWidth: 0.8, color: rgb(0.99, 0.96, 0.95),
    height: temCorrecao ? 60 : 46, width: A4.w - M * 2, x: M, y: y - (temCorrecao ? 48 : 34),
  });
  txt("DÍVIDA VENCIDA (objeto da cobrança)", M + 8, 8.5, bold, VERMELHO, 300);
  y -= 14;
  txt(`Valor original: ${brl(d.valorInadimplenciaOriginal)}`, M + 8, 8.5, font, TEXT, 200);
  txt(`Encargos apurados: ${brl(d.encargosApurados)}`, M + 200, 8.5, font, TEXT, 200);
  y -= 13;
  if (temCorrecao) {
    txt(
      `Correção monetária (${d.correcaoPercent}%): ${brl(d.correcaoAplicada)}`
      + (escolhas.correcaoReferencia ? ` - ${escolhas.correcaoReferencia}` : ""),
      M + 8, 8.5, font, TEXT, A4.w - M * 2 - 16,
    );
    y -= 14;
  }
  txt(`VALOR ATUALIZADO PARA COBRANÇA: ${brl(d.valorInadimplenciaAtualizado)}`, M + 8, 10, bold, VERMELHO, 380);
  y -= 26;

  txt("Indicadores da Inadimplência", M, 9, bold, INK);
  y -= 14;
  tabela([
    ["Quantidade Total de Parcelas", String(d.parcelasTotal)],
    ["Quantidade de Parcelas Pagas", String(d.parcelasPagas)],
    ["Quantidade de Parcelas em Aberto", String(d.parcelasEmAberto)],
    ["Quantidade de Parcelas Inadimplentes (vencidas)", String(d.parcelasInadimplentes)],
    ["Primeiro Vencimento em Aberto", d.primeiroVencimentoAberto ?? "-"],
    ["Último Vencimento em Aberto", d.ultimoVencimentoAberto ?? "-"],
    ["Dias em Atraso (parcela mais antiga)", `${d.diasEmAtraso} dias`],
  ]);
  y -= 6;

  txt("Indicadores da Negociação", M, 9, bold, INK);
  y -= 14;
  const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : "-");
  tabela([
    ["Percentual Pago da Negociação", pct(d.totalPago, d.valorGlobal)],
    ["Percentual Inadimplente", pct(d.valorInadimplenciaOriginal, d.valorGlobal)],
    ["Recuperabilidade do Crédito", d.recuperabilidade],
    ["Classificação do Risco", d.prioridade === "ALTA" ? "Alto" : d.prioridade === "MÉDIA" ? "Médio" : "Baixo"],
  ]);
  y -= 8;

  // ── 3. Semáforo e score ─────────────────────────────────────────────────
  secao("3. CLASSIFICAÇÃO DE RISCO JURÍDICO");
  const corPrio = d.prioridade === "ALTA" ? VERMELHO : d.prioridade === "MÉDIA" ? AMBAR : VERDE;
  espaco(24);
  p.drawCircle({ color: corPrio, size: 5, x: M + 6, y: y + 3 });
  txt(`${d.prioridade} PRIORIDADE`, M + 18, 10, bold, corPrio, 200);
  txt(`Score Jurídico Careli: ${d.score} pontos`, M + 220, 10, bold, INK, 250);
  y -= 20;
  d.scoreDetalhe.forEach((s, i) => linha(s.criterio, `${s.pontos} pontos`, i));
  if (!d.scoreDetalhe.length) linha("Sem critérios pontuados", "0 pontos", 0);
  y -= 8;

  // ── 4. Contrato e encargos ──────────────────────────────────────────────
  secao("4. CONTRATO DE COMPRA E VENDA");
  tabela([
    ["Instrumento", "Contrato Particular de Compra e Venda"],
    ["Plano Comercial", d.planoNome ?? "não informado"],
    ["Quantidade de Parcelas", d.qtdParcelasContrato ? String(d.qtdParcelasContrato) : "-"],
    ["Valor do Sinal / Entrada", d.valorSinal ? brl(d.valorSinal) : "não apurado"],
    ["Primeiro Pagamento do Sinal", d.dataPrimeiroSinal ?? "-"],
    ["Valor da Parcela", d.valorParcela ? brl(d.valorParcela) : "-"],
    ["Multa contratual", `${d.encargos.multaPercent}%`],
    ["Juros de mora", `${d.encargos.jurosMesPercent}% ao mês (pro rata die)`],
    ["Índice de correção", d.encargos.indiceCorrecao ?? "não identificado"],
  ]);
  y -= 6;

  // A ORIGEM DO NÚMERO. É isto que sustenta o cálculo no processo.
  espaco(46);
  const fonteTexto = d.encargos.origem === "contrato"
    ? "Encargos extraídos do contrato do cliente. Cláusula:"
    : "ATENÇÃO: o contrato não declara os encargos. Aplicados os percentuais de praxe (2% e 1% a.m.).";
  txt(fonteTexto, M, 8, bold, d.encargos.origem === "contrato" ? VERDE : AMBAR);
  y -= 12;
  if (d.encargos.clausula) {
    const palavras = clean(d.encargos.clausula).split(" ");
    let atual = "";
    for (const w of palavras) {
      if (font.widthOfTextAtSize(`${atual} ${w}`, 7.5) > A4.w - M * 2 - 16) {
        txt(`"${atual}"`, M + 8, 7.5, font, MUTE);
        y -= 10;
        espaco(14);
        atual = w;
      } else atual = atual ? `${atual} ${w}` : w;
    }
    if (atual) { txt(`"${atual}"`, M + 8, 7.5, font, MUTE); y -= 10; }
  }
  y -= 4;
  // A correção é digitada por quem gera. O documento diz de onde veio o percentual — ou avisa,
  // em amarelo, que ela não entrou na conta.
  espaco(16);
  txt(
    temCorrecao
      ? `Correção monetária aplicada: ${d.correcaoPercent}% sobre o valor original de cada parcela vencida.`
        + (escolhas.correcaoReferencia ? ` Referência informada: ${escolhas.correcaoReferencia}.` : "")
      : "Correção monetária: devida conforme contrato, pendente de apuração do índice no período (não somada neste demonstrativo).",
    M, 7.5, font, temCorrecao ? VERDE : AMBAR,
  );
  y -= 16;

  // ── 5. Memória de cálculo ───────────────────────────────────────────────
  secao("5. MEMÓRIA DE CÁLCULO DA DÍVIDA VENCIDA");
  // A coluna CORRECAO só aparece quando há percentual informado — coluna de zeros num documento
  // que vai ao processo só levanta pergunta.
  const cols = temCorrecao
    ? [
        { t: "PARCELA", x: M + 4, w: 44 },
        { t: "VENCIMENTO", x: M + 50, w: 58 },
        { t: "VALOR", x: M + 112, w: 62 },
        { t: "DIAS", x: M + 178, w: 32 },
        { t: "MULTA", x: M + 214, w: 56 },
        { t: "JUROS", x: M + 274, w: 60 },
        { t: "CORREÇÃO", x: M + 338, w: 60 },
        { t: "ATUALIZADO", x: M + 402, w: 100 },
      ]
    : [
        { t: "PARCELA", x: M + 4, w: 60 },
        { t: "VENCIMENTO", x: M + 70, w: 70 },
        { t: "VALOR", x: M + 145, w: 70 },
        { t: "DIAS", x: M + 220, w: 40 },
        { t: "MULTA", x: M + 265, w: 65 },
        { t: "JUROS", x: M + 335, w: 70 },
        { t: "ATUALIZADO", x: M + 410, w: 90 },
      ];
  const iAtualizado = cols.length - 1;
  const cabecalhoTabela = () => {
    espaco(24);
    cols.forEach((c) => p.drawText(c.t, { color: MUTE, font: bold, size: 7, x: c.x, y }));
    y -= 5;
    p.drawLine({ color: LINE, end: { x: A4.w - M, y }, start: { x: M, y }, thickness: 0.6 });
    y -= 11;
  };
  cabecalhoTabela();
  d.memoriaCalculo.forEach((m, i) => {
    // A última linha reserva o espaço do TOTAL: senão a tabela fecha no fim da folha e o total
    // aparece sozinho no topo da página seguinte, solto de tudo.
    const folga = i === d.memoriaCalculo.length - 1 ? 58 : 30;
    if (y < M + folga) { novaPagina(); cabecalhoTabela(); }
    if (i % 2 === 1) p.drawRectangle({ color: ZEBRA, height: 12, width: A4.w - M * 2, x: M, y: y - 3 });
    const vals = [
      m.numero, m.vencimento, brl(m.valorOriginal), String(m.diasAtraso), brl(m.multa), brl(m.juros),
      ...(temCorrecao ? [brl(m.correcao)] : []),
      brl(m.atualizado),
    ];
    cols.forEach((c, j) => p.drawText(corta(vals[j] ?? "", c.w, 7.5, font), {
      color: j === iAtualizado ? INK : TEXT, font: j === iAtualizado ? bold : font, size: 7.5, x: c.x, y,
    }));
    y -= 12.5;
  });
  espaco(20);
  p.drawLine({ color: INK, end: { x: A4.w - M, y: y + 8 }, start: { x: M, y: y + 8 }, thickness: 0.8 });
  // O TOTAL segue as MESMAS colunas da tabela — com correção elas mudam de largura, e número
  // fora da coluna certa num demonstrativo é leitura errada garantida.
  const colValor = cols[2]!;
  const colAtual = cols[iAtualizado]!;
  txt("TOTAL", M + 4, 8.5, bold, INK, 80);
  txt(brl(d.valorInadimplenciaOriginal), colValor.x, 8.5, bold, INK, colValor.w);
  if (temCorrecao) {
    const colCorr = cols[6]!;
    txt(brl(d.correcaoAplicada), colCorr.x, 8.5, bold, INK, colCorr.w);
  }
  txt(brl(d.valorInadimplenciaAtualizado), colAtual.x, 8.5, bold, VERMELHO, colAtual.w);
  y -= 22;

  // ── 6. Histórico das tratativas ─────────────────────────────────────────
  secao("6. HISTÓRICO DAS TRATATIVAS");
  if (!escolhas.tratativas.length) {
    txt("Nenhuma tratativa registrada no sistema para esta negociação.", M, 8.5, font, MUTE);
    y -= 14;
  } else {
    escolhas.tratativas.forEach((t, i) => {
      const linhas = quebrar(t.historico, A4.w - M * 2 - 8, 8, font);
      const alturaBloco = 12 + linhas.length * 9.5;
      // O bloco inteiro (cabeçalho + todas as linhas) cabe na página ou vai inteiro para a
      // próxima — tratativa partida no meio da frase é ilegível no processo.
      espaco(alturaBloco + 8);
      if (i % 2 === 1) {
        p.drawRectangle({
          color: ZEBRA, height: alturaBloco, width: A4.w - M * 2, x: M, y: y - alturaBloco + 10,
        });
      }
      txt(t.data, M + 4, 8, bold, INK, 70);
      txt(t.canal, M + 80, 8, font, MUTE, 90);
      txt(t.responsavel, M + 175, 8, font, MUTE, 200);
      y -= 10;
      for (const linha of linhas) {
        txt(linha, M + 4, 8, font, TEXT, A4.w - M * 2 - 8);
        y -= 9.5;
      }
      y -= 5;
    });
  }
  y -= 6;

  // ── 7. Documentos ───────────────────────────────────────────────────────
  secao("7. DOCUMENTOS QUE INSTRUEM O PROCESSO");
  const todos = [
    "Contrato de Compra e Venda", "Contrato de Corretagem", "Demonstrativo Financeiro",
    "Extrato Financeiro", "Boletos", "Notificações", "CRM", "Conversas WhatsApp", "E-mails", "Áudios",
  ];
  // Comparação por nome INTEIRO normalizado. Casar por prefixo curto marcava "Contrato de
  // Corretagem" como anexado só porque existia "Contrato de Compra e Venda" — num documento que
  // vai para o processo, dizer que uma peça está nos autos sem estar é o pior erro possível.
  const chave = (s: string) =>
    s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const anexadas = escolhas.documentosAnexos.map(chave);
  todos.forEach((doc, i) => {
    const alvo = chave(doc);
    // O anexo tem que conter o nome INTEIRO da peça. Um anexo genérico ("Contrato") não marca
    // nenhuma das duas linhas de contrato — de propósito.
    const tem = anexadas.some((a) => a === alvo || a.includes(alvo));
    linha(doc, tem ? "ANEXADO" : "não anexado", i, tem, tem ? VERDE : MUTE);
  });
  y -= 8;

  // ── 8. Análise operacional ──────────────────────────────────────────────
  secao("8. ANÁLISE OPERACIONAL");
  txt("Motivo do Encaminhamento", M, 9, bold, INK);
  y -= 13;
  txt(escolhas.motivoEncaminhamento, M + 4, 9, font, TEXT);
  y -= 18;
  txt("Recomendação Operacional", M, 9, bold, INK);
  y -= 13;
  txt(escolhas.recomendacao, M + 4, 9, font, TEXT);
  y -= 20;

  // ── 9. Conclusão ────────────────────────────────────────────────────────
  secao("9. CONCLUSÃO EXECUTIVA");
  // Texto corrido quebrado pela largura — não em linhas fixas, senão qualquer ajuste de redação
  // desalinha o parágrafo.
  const conclusao =
    "Após análise da documentação, dos contratos firmados, do histórico financeiro e das tratativas "
    + "realizadas, verifica-se a permanência da inadimplência contratual, conforme demonstrado neste "
    + "relatório. As informações consolidam os valores efetivamente pagos, o saldo devedor atualizado, "
    + "a evolução da inadimplência e os documentos que instruem o processo. Diante desse cenário, "
    + "encaminha-se o presente relatório ao Departamento Jurídico para adoção das medidas cabíveis.";
  quebrar(conclusao, A4.w - M * 2, 8.5, font).forEach((l) => {
    espaco(14);
    txt(l, M, 8.5);
    y -= 11;
  });
  y -= 14;

  // ── 10. Aprovações ──────────────────────────────────────────────────────
  secao("10. APROVAÇÕES");
  ["Analista Responsável", "Líder de Operação", "Diretoria Executiva", "Departamento Jurídico"].forEach((r) => {
    espaco(30);
    txt(r, M, 8.5, font, MUTE, 160);
    p.drawLine({ color: LINE, end: { x: M + 400, y: y - 2 }, start: { x: M + 170, y: y - 2 }, thickness: 0.6 });
    p.drawLine({ color: LINE, end: { x: A4.w - M, y: y - 2 }, start: { x: M + 420, y: y - 2 }, thickness: 0.6 });
    txt("assinatura", M + 250, 6.5, font, MUTE, 80);
    txt("data", M + 470, 6.5, font, MUTE, 60);
    y -= 26;
  });

  // Rodapé em todas as páginas.
  paginas.forEach((pg, i) => {
    pg.drawLine({ color: LINE, end: { x: A4.w - M, y: M + 14 }, start: { x: M, y: M + 14 }, thickness: 0.5 });
    pg.drawText(clean(`${d.cliente} - ${d.codigoVenda} - ${escolhas.processo}`), {
      color: MUTE, font, size: 7, x: M, y: M + 4,
    });
    pg.drawText(`Página ${i + 1} de ${paginas.length}`, {
      color: MUTE, font, size: 7, x: A4.w - M - 60, y: M + 4,
    });
  });

  return pdf.save();
}
