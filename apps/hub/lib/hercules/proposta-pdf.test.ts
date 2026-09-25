import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";

import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { avisoDaFolha, montarPropostaPdf, type PropostaParaPdf } from "./proposta-pdf";

// ⚠️ CAMINHOS POR `import.meta.url`, NUNCA `process.cwd()`: a suíte roda tanto de `apps/hub`
// quanto da raiz do monorepo, e um teste que depende do diretório de trabalho passa num lugar e
// quebra no outro (já aconteceu com `masterplan-estado.test.ts`).
const arquivo = (caminho: string) => new URL(caminho, import.meta.url);

const bytes = (caminho: string): Uint8Array =>
  new Uint8Array(readFileSync(arquivo(caminho)));

/** As dez anuais do exemplo: uma por ano, no mesmo dia de vencimento das mensais. */
const ANUAIS = Array.from({ length: 10 }, (_, i) => ({
  ordem: `${i + 1} de 10`,
  valor: "R$ 2.000,00",
  vencimento: `10 de dezembro de ${2027 + i}`,
}));

const EXEMPLO: PropostaParaPdf = {
  anuais: ANUAIS,
  anuaisTotal: "R$ 20.000,00",
  atendimento: {
    coordenador: "Lucas Ruas",
    corretor: "Nívea Ferreira",
    imobiliaria: "Raiane Imobiliária",
    telefone: "(62) 98877-1234",
  },
  codigo: "000003",
  compradores: [
    { documento: "529.982.247-25", nome: "Maria Aparecida da Silva", participacao: "60%" },
    { documento: "145.114.775-08", nome: "João Carlos da Silva", participacao: "40%" },
  ],
  condicoes: [
    { rotulo: "Parcelas mensais", valor: "120" },
    { rotulo: "Parcelas anuais", valor: "10 de R$ 2.000,00" },
    { rotulo: "Primeira parcela", valor: "10/12/2026" },
    { rotulo: "Última parcela", valor: "10/11/2036" },
    { rotulo: "Vencimento", valor: "todo dia 10" },
    { rotulo: "Juros", valor: "8% ao ano" },
    { rotulo: "Correção", valor: "IPCA anual" },
    { rotulo: "Sistema", valor: "SACOC" },
  ],
  destaques: [
    { detalhe: "R$ 400,00 por m²", rotulo: "Valor da unidade", valor: "R$ 100.000,00" },
    { detalhe: "10% · 2× de R$ 5.000,00", rotulo: "Entrada", valor: "R$ 10.000,00" },
    { detalhe: "120 mensais + 10 anuais", rotulo: "Financiado", valor: "R$ 90.000,00" },
    { detalhe: "1ª em 10/12/2026", rotulo: "Parcela mensal", valor: "R$ 583,33" },
  ],
  emitidaEm: "04/09/2026",
  empreendimento: "Garden",
  entrada: [
    { ordem: "1 de 2", valor: "R$ 5.000,00", vencimento: "10 de outubro de 2026" },
    { ordem: "2 de 2", valor: "R$ 5.000,00", vencimento: "10 de novembro de 2026" },
  ],
  entradaTotal: "R$ 10.000,00",
  logoC2x: bytes("../../public/c2x-logo.png"),
  logoEmpreendimento: bytes("../../public/garden/logo-garden.png"),
  observacoes: [
    {
      texto:
        "A parcela é reajustada uma vez por ano, no aniversário do contrato. Entre um aniversário e outro o valor não muda. Os valores da tabela acima consideram apenas os juros de 8% ao ano previstos em contrato; a correção pelo IPCA do período é somada na mesma data e não está projetada, por depender de índice futuro.",
      titulo: "Sobre o reajuste.",
    },
    {
      texto:
        "Os valores acima valem até 11/09/2026 e estão sujeitos à confirmação de disponibilidade da unidade e à aprovação de crédito.",
      titulo: "Sobre esta proposta.",
    },
  ],
  reajustes: [
    { ate: "10/11/2027", de: "10/12/2026", parcelas: "1 a 12", periodo: "1º ano", correcao: null, valor: "R$ 583,33" },
    { ate: "10/11/2028", de: "10/12/2027", parcelas: "13 a 24", periodo: "2º ano", correcao: "IPCA anual", valor: "R$ 612,66" },
    { ate: "10/11/2029", de: "10/12/2028", parcelas: "25 a 36", periodo: "3º ano", correcao: "IPCA anual", valor: "R$ 668,20" },
  ],
  subtitulo: "Garden · 250,00 m² · Goiânia, GO",
  temReajuste: true,
  unidade: "Quadra 03 · Lote 07",
};

describe("montarPropostaPdf", () => {
  it("monta o PDF e grava o exemplo para conferência visual", async () => {
    const pdf = await montarPropostaPdf(EXEMPLO);

    // %PDF na assinatura: se o pdf-lib tivesse falhado, viria vazio ou lixo.
    expect(pdf.length).toBeGreaterThan(4000);
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");

    writeFileSync(arquivo("../../../../.tmpr/proposta-exemplo.pdf"), pdf);
  });

  it("⚠️ caractere fora do WinAnsi não derruba a proposta", async () => {
    const pdf = await montarPropostaPdf({
      ...EXEMPLO,
      compradores: [{ documento: "529.982.247-25", nome: "Mariana Ćurić — 東京", participacao: "100%" }],
      logoC2x: null,
      logoEmpreendimento: null,
    });
    expect(pdf.length).toBeGreaterThan(3000);
  });

  it("com um comprador só, a coluna de participação não é impressa", async () => {
    const pdf = await montarPropostaPdf({
      ...EXEMPLO,
      compradores: [{ documento: "529.982.247-25", nome: "Maria Aparecida da Silva", participacao: "100%" }],
    });
    expect(pdf.length).toBeGreaterThan(4000);
  });

  it("⚠️ sem parcelas anuais, a seção some — não sai um 'não há'", async () => {
    const semAnuais = await montarPropostaPdf({ ...EXEMPLO, anuais: [], anuaisTotal: "" });
    const comAnuais = await montarPropostaPdf(EXEMPLO);
    expect(semAnuais.length).toBeLessThan(comAnuais.length);
  });
});

// ── O PRÉDIO NO PAPEL ───────────────────────────────────────────────────────
// Lucas (16/09/2026): apartamento nunca é quadra/lote. O nome da unidade chega pronto
// (`nomeDaUnidade`); o que este arquivo decide é a tarja, e o título do arquivo repete o nome.

describe("a folha do prédio", () => {
  it("o título do arquivo leva Torre e Apto, com e sem torre", async () => {
    for (const unidade of ["Torre A · Apto 304", "Apto 1203"]) {
      const pdf = await montarPropostaPdf({
        ...EXEMPLO,
        logoC2x: null,
        logoEmpreendimento: null,
        tipoProduto: "vertical",
        unidade,
      });
      const lido = await PDFDocument.load(pdf);
      expect(lido.getTitle()).toBe(`Proposta ${EXEMPLO.codigo} - ${unidade}`);
    }
  });

  it("a tarja da simulação diz 'a unidade' no prédio e 'o lote' no loteamento", () => {
    expect(avisoDaFolha({ simulacao: true, tipoProduto: "vertical" })).toBe(
      "SIMULAÇÃO DE PAGAMENTO - não é proposta e não reserva a unidade",
    );
    // O loteamento não muda, com ou sem o tipo informado.
    expect(avisoDaFolha({ simulacao: true })).toBe(
      "SIMULAÇÃO DE PAGAMENTO - não é proposta e não reserva o lote",
    );
    expect(avisoDaFolha({ simulacao: true, tipoProduto: "loteamento" })).toBe(
      "SIMULAÇÃO DE PAGAMENTO - não é proposta e não reserva o lote",
    );
    expect(avisoDaFolha({ previa: true, tipoProduto: "vertical" })).toBe(
      "PRÉVIA - documento sem validade: a proposta ainda não foi gerada",
    );
    expect(avisoDaFolha({})).toBeNull();
  });

  it("a simulação de um apartamento monta o PDF", async () => {
    const pdf = await montarPropostaPdf({
      ...EXEMPLO,
      compradores: [],
      simulacao: true,
      tipoProduto: "vertical",
      unidade: "Torre A · Apto 304",
    });
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");
  });
});

// ── A FOLHA NÃO PODE MUDAR SOZINHA ──────────────────────────────────────────

/**
 * Cada linha que o PDF desenha, com a folha e a coordenada em que ela saiu.
 *
 * ⚠️ `pdf.length` NÃO PROVA LAYOUT. Ele cresce e encolhe com compressão, e duas folhas com o
 * mesmo tamanho em bytes podem ter o parágrafo em alturas diferentes. Quem responde "mudou um
 * pixel?" é a COORDENADA, e ela está no fluxo de conteúdo: o pdf-lib escreve
 * `1 0 0 1 <x> <y> Tm` antes de cada `<hex> Tj`. Mesmo desenho do `termo-de-acordo-pdf.test.ts`.
 */
function linhasDoPdf(bytes: Uint8Array): string[] {
  const arquivo = Buffer.from(bytes);
  const linhas: string[] = [];
  let folha = 0;
  let inicio = arquivo.indexOf("stream");

  while (inicio !== -1) {
    const comeco = arquivo.indexOf("\n", inicio) + 1;
    const fim = arquivo.indexOf("endstream", comeco);
    if (fim === -1) break;
    try {
      const conteudo = inflateSync(arquivo.subarray(comeco, fim)).toString("latin1");
      const achados = [
        ...conteudo.matchAll(/1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm\s*<([0-9A-Fa-f]*)>\s*Tj/g),
      ];
      if (achados.length > 0) {
        folha += 1;
        for (const [, x, y, hexadecimal] of achados) {
          const texto = Buffer.from(hexadecimal ?? "", "hex").toString("latin1");
          linhas.push(`${folha} ${x} ${y} ${texto}`);
        }
      }
    } catch {
      // fluxo que não é conteúdo de página comprimido (fonte, imagem): não tem texto a ler
    }
    inicio = arquivo.indexOf("stream", fim + "endstream".length);
  }

  return linhas;
}

describe("o sufixo da tabela de reajuste", () => {
  // ⚠️ AFIRMAÇÃO EM CAIXA ALTA: ATÉ 24/09/2026 O SUFIXO ERA A PALAVRA "IPCA", CRAVADA NO CÓDIGO.
  // A linha era `dados.reajustes.map((r) => (r.temIpca ? "+ IPCA" : null))` — um booleano decidia
  // SE havia correção e o papel escrevia SEMPRE "IPCA", qualquer que fosse o índice do plano.
  it("sai do índice do plano, e não da palavra IPCA", async () => {
    const texto = textoDoPdf(
      linhasDoPdf(
        await montarPropostaPdf({
          ...EXEMPLO,
          // ⚠️ A TABELA DO REAJUSTE SÓ É DESENHADA A PEDIDO (`proposta-pdf.ts:834`), e o EXEMPLO
          // do arquivo não a pede — por isso a impressão digital das 85 linhas não a inclui.
          incluirReajuste: true,
          reajustes: EXEMPLO.reajustes.map((r) =>
            r.correcao ? { ...r, correcao: "poupança anual" } : r,
          ),
        }),
      ),
    );
    expect(texto).toContain("+ poupança anual");
    expect(texto).not.toContain("+ IPCA");
  });

  it("faixa sem correção não ganha sufixo nenhum", async () => {
    const texto = textoDoPdf(
      linhasDoPdf(
        await montarPropostaPdf({
          ...EXEMPLO,
          incluirReajuste: true,
          reajustes: EXEMPLO.reajustes.map((r) => ({ ...r, correcao: null })),
        }),
      ),
    );
    expect(texto).not.toContain("+ IPCA");
    expect(texto).not.toContain("+ poupança");
  });
});

describe("⚠️ a proposta SEM bens nem permutas sai exatamente como saía", () => {
  it("o desenho inteiro bate com a impressão digital tirada antes da permuta existir", async () => {
    const linhas = linhasDoPdf(await montarPropostaPdf(EXEMPLO));
    const digital = createHash("sha256").update(linhas.join("\n")).digest("hex");

    // ⚠️ IMPRESSÃO DIGITAL TIRADA EM 22/09/2026, ANTES DE A PERMUTA EXISTIR — é ela que prova
    // que a folha da maioria (proposta sem bem nem permuta) não mudou nada: mesmo texto, mesmo x,
    // mesmo y, mesma folha, nas 85 linhas do exemplo. Se este número mudar junto com uma feature
    // que era para ser invisível aqui, a feature vazou para o papel de quem não tem permuta.
    // Mudou de propósito (um texto novo, um espaçamento aprovado)? Rode, leia o valor recebido e
    // troque o de baixo — mas só depois de olhar o PDF em `.tmpr/proposta-exemplo.pdf`.
    expect({ digital, linhas: linhas.length }).toEqual({
      digital: "e3426d98f06caaea91abe6752d0c8a984ed03ffa62ade6d8d9755e43fd8e9bce",
      linhas: 85,
    });
  });
});

// ── BENS E PERMUTAS NO PAPEL (22/09/2026) ───────────────────────────────────
//
// Lucas, perguntado se a permuta abate o valor a financiar ou é só registro: *"Abate, como uma
// entrada"*. Quantos cabem numa proposta: *"Vários"*. E a folha tem que mostrar, porque um bem de
// R$ 80.000 que some do papel faz o comprador achar que está devendo R$ 80.000 a mais.

/** Só o texto desenhado, sem as coordenadas — para procurar uma frase no papel. */
const textoDoPdf = (linhas: string[]): string =>
  linhas.map((l) => l.replace(/^\d+ \S+ \S+ /, "")).join("\n");

/** Como o documento escreve um título de seção: maiúsculas com espaço entre as letras. */
const comoTitulo = (valor: string): string =>
  valor.toUpperCase().split("").join(" ");

/** A altura em que uma frase foi desenhada, para conferir a ORDEM das seções na folha. */
const alturaDe = (linhas: string[], frase: string): null | number => {
  const achada = linhas.find((l) => l.endsWith(` ${frase}`));
  return achada ? Number(achada.split(" ")[2]) : null;
};

describe("bens e permutas no papel", () => {
  const BENS = [
    {
      comoEntra: "Entrada",
      descricao: "Ford Ka 2019 placa ABC1D23",
      tipo: "Bem",
      valor: "R$ 30.000,00",
    },
    {
      comoEntra: "Abatimento",
      descricao: "lote 12 da quadra 4 em Anápolis",
      tipo: "Permuta",
      valor: "R$ 50.000,00",
    },
  ];

  const comPermuta = (extra: Partial<PropostaParaPdf> = {}) =>
    montarPropostaPdf({
      ...EXEMPLO,
      bensEPermutas: BENS,
      bensEPermutasTotal: "R$ 80.000,00",
      ...extra,
    });

  it("cada item sai com o tipo, o valor e a descrição", async () => {
    const pdf = await comPermuta();
    const texto = textoDoPdf(linhasDoPdf(pdf));

    // O Lucas confere papel olhando o papel: fica gravado ao lado do exemplo sem permuta.
    writeFileSync(arquivo("../../../../.tmpr/proposta-exemplo-permuta.pdf"), pdf);

    expect(texto).toContain("Ford Ka 2019 placa ABC1D23");
    expect(texto).toContain("lote 12 da quadra 4 em Anápolis");
    expect(texto).toContain("R$ 30.000,00");
    expect(texto).toContain("R$ 50.000,00");
    expect(texto).toContain("Bem");
    expect(texto).toContain("Permuta");
  });

  it("⚠️ o total diz que aquele dinheiro ABATEU o saldo, e não que ainda será pago", async () => {
    const texto = textoDoPdf(linhasDoPdf(await comPermuta()));

    expect(texto).toContain("Total em bens e permutas");
    expect(texto).toContain("R$ 80.000,00");
    // Sem esta frase, os R$ 80.000 ao lado do fluxo de entrada e das anuais parecem mais uma
    // coisa a pagar — que é o oposto do que eles são.
    expect(texto).toContain("abatido do saldo a financiar");
  });

  it("⚠️ cada item diz SE cumpriu a entrada ou só abateu o saldo", async () => {
    // Lucas: *"pode ser um ou outro, pode apontar na entrada ou somente no valor negociado"*. Os
    // dois abatem; só um conta para a entrada mínima de 10%. Sem essa coluna, quem confere a
    // entrada no papel some com a diferença ou soma o mesmo dinheiro duas vezes.
    const texto = textoDoPdf(linhasDoPdf(await comPermuta()));

    expect(texto).toContain("Entrada");
    expect(texto).toContain("Abatimento");
  });

  it("a seção fica entre o fluxo da entrada e o das anuais", async () => {
    const linhas = linhasDoPdf(await comPermuta());
    const entrada = alturaDe(linhas, comoTitulo("Pagamento da entrada"));
    const bens = alturaDe(linhas, comoTitulo("Bens e permutas recebidos"));
    const anuais = alturaDe(linhas, comoTitulo("Pagamento das parcelas anuais"));

    // Na mesma página e descendo: o y do PDF cresce para cima.
    expect(entrada).not.toBeNull();
    expect(bens).not.toBeNull();
    expect(anuais).not.toBeNull();
    expect(bens!).toBeLessThan(entrada!);
    expect(anuais!).toBeLessThan(bens!);
  });

  it("⚠️ descrição comprida é cortada, e não escrita por cima do valor", async () => {
    // O operador digita texto livre. `tabela` desenha cada célula num x fixo: uma descrição mais
    // larga que a coluna atravessa a do valor e o comprador lê o preço do bem por cima das letras.
    const longa =
      "Fazenda Santa Luzia, 42 alqueires com sede, curral, dois poços artesianos e pastagem formada, em Jussara GO";
    const linhas = linhasDoPdf(
      await comPermuta({
        bensEPermutas: [{ ...BENS[0]!, descricao: longa }],
      }),
    );
    const texto = textoDoPdf(linhas);

    expect(texto).not.toContain(longa);
    expect(texto).toContain("Fazenda Santa Luzia,");
    expect(linhas.some((l) => l.includes("Fazenda Santa Luzia,") && l.endsWith("..."))).toBe(true);
  });

  it("⚠️ a linha do total não escreve um pedaço por cima do outro", async () => {
    // Foi o que aconteceu ao escrever esta seção: "Total em bens e permutas" em Helvetica-Bold 9
    // termina em x=144,6, e a frase do lado começava em x=108,2 — 36pt de texto sobre texto, que
    // nenhum teste de conteúdo pega (as duas frases existem no PDF, só que ilegíveis uma na
    // outra). O que pega é medir a largura do que foi desenhado.
    const linhas = linhasDoPdf(await comPermuta());
    const doTotal = linhas
      .filter((l) => l.includes("Total em bens e permutas") || l.includes("abatido do saldo"))
      .map((l) => {
        const [, , y, ...resto] = l.split(" ");
        return { texto: resto.join(" "), y: Number(y), x: Number(l.split(" ")[1]) };
      });

    // O `tabela` escreve a linha de soma em Helvetica-Bold 9.
    const doc = await PDFDocument.create();
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const naMesmaAltura = doTotal.filter((c) => c.y === doTotal[0]?.y).sort((a, b) => a.x - b.x);

    expect(naMesmaAltura).toHaveLength(2);
    const [esquerda, direita] = naMesmaAltura;
    expect(esquerda!.x + bold.widthOfTextAtSize(esquerda!.texto, 9)).toBeLessThan(direita!.x);
  });

  it("⚠️ lista vazia desenha EXATAMENTE o que o campo ausente desenha", async () => {
    // A maioria das propostas não tem permuta. Se a seção deixasse um espaço, uma régua ou um
    // "R$ 0,00" para trás, o papel de todo mundo mudaria por causa de um recurso de poucos.
    const vazia = linhasDoPdf(
      await montarPropostaPdf({ ...EXEMPLO, bensEPermutas: [], bensEPermutasTotal: "" }),
    );
    const ausente = linhasDoPdf(await montarPropostaPdf(EXEMPLO));

    expect(vazia).toEqual(ausente);
  });
});
