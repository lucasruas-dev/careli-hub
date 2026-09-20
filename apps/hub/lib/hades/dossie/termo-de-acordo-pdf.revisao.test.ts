// A REVISÃO DO PAPEL (20/09/2026) — o que um segundo par de olhos mediu no PDF, e não no código.
//
// Este arquivo NÃO repete o que `termo-de-acordo-pdf.test.ts` já prova. Ele existe para três coisas
// que só aparecem quando o PDF é gerado de verdade, para as formas que existem em PRODUÇÃO:
//
//   1. o texto legal conferido contra uma SEGUNDA transcrição do print do Lucas, feita por quem
//      revisa e não por quem implementou (uma cópia só prova que o array bate com ela mesma);
//   2. a borda da folha varrida de 1 a 60 parcelas em atraso, e não só nos dois casos de exemplo;
//   3. as 35 formas de acordo que existem hoje no Supabase de produção, com a ficha longa e com a
//      curta.
//
// ⚠️ O ÚLTIMO BLOCO NÃO MEDE DEFEITO, MEDE UMA DECISÃO. Ele nasceu vermelho em 20/09/2026, quando o
// papel passou a ter três signatários e continuava qualificando um; hoje ele trava a escolha que foi
// feita, e o comentário dele carrega o que ficou em aberto para o dono do produto.

import { inflateSync } from "node:zlib";

import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import {
  type DadosDoTermoDeAcordo,
  montarTermoDeAcordoPdf,
  TEXTO_LEGAL_DO_ACORDO,
  TITULO_DO_ACEITE,
} from "./termo-de-acordo-pdf";

// ────────────────────────────────────────────────────────────────────────────────────────────
// A SEGUNDA CÓPIA DO TEXTO DO LUCAS
// ────────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠️ TRANSCRITA DE NOVO, DO PRINT, POR QUEM REVISA. `termo-de-acordo-pdf.test.ts` já guarda uma
// cópia, e ela prova que ninguém edita o array sem editar o teste. O que ela NÃO prova é que a
// primeira transcrição estava certa: se uma vírgula caiu na hora de copiar o print, ela caiu nos
// dois lugares e o teste passa. Duas transcrições independentes que concordam, caractere a
// caractere, é o que responde isso.
const TEXTO_DO_PRINT = [
  "Ao assinar este termo, as partes declaram que estão de acordo com os valores, prazos e condições de pagamento aqui apresentados.",
  "Este acordo refere-se somente às parcelas em atraso indicadas neste documento. As demais parcelas do contrato continuam vencendo normalmente e deverão ser pagas nas datas previstas.",
  "Caso alguma parcela deste acordo não seja paga no vencimento, as condições negociadas poderão ser canceladas e o débito será atualizado conforme as regras do contrato.",
  "Nesse caso, a cobrança poderá seguir por tratativa extrajudicial, inclusive por meio do escritório de advocacia responsável, podendo haver custos, encargos e honorários relacionados à cobrança, quando aplicáveis conforme o contrato e a legislação.",
  "Se não houver regularização, poderão ser adotadas as medidas judiciais cabíveis.",
  "Ao assinar, o COMPRADOR declara que leu, compreendeu e aceita estas condições.",
];

const TITULO_DO_PRINT = "ACEITE E CONDIÇÕES DO ACORDO";

// ────────────────────────────────────────────────────────────────────────────────────────────
// LER O PDF DE VOLTA
// ────────────────────────────────────────────────────────────────────────────────────────────

type LinhaDesenhada = { folha: number; texto: string; x: number; y: number };

/**
 * Cada linha desenhada, com a folha e a coordenada.
 *
 * ⚠️ O MESMO LEITOR DO ARQUIVO DE TESTE DO IMPLEMENTADOR, DE PROPÓSITO REESCRITO AQUI. Importar o
 * dele faria a revisão depender da peça revisada: um leitor que erra a coordenada faria os dois
 * arquivos concordarem num número errado.
 */
function linhasDoPdf(bytes: Uint8Array): LinhaDesenhada[] {
  const arquivo = Buffer.from(bytes);
  const linhas: LinhaDesenhada[] = [];
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
          linhas.push({
            folha,
            texto: Buffer.from(hexadecimal ?? "", "hex").toString("latin1"),
            x: Number(x),
            y: Number(y),
          });
        }
      }
    } catch {
      // fluxo que não é conteúdo de página comprimido (fonte, imagem)
    }
    inicio = arquivo.indexOf("stream", fim + "endstream".length);
  }

  return linhas;
}

const PALAVRAS_DO_TEXTO_LEGAL = new Set(
  TEXTO_LEGAL_DO_ACORDO.flatMap((paragrafo) => paragrafo.split(/\s+/)).map((palavra) =>
    palavra.toLowerCase(),
  ),
);

function linhasDoTextoLegal(desenhadas: LinhaDesenhada[]): LinhaDesenhada[] {
  return desenhadas.filter((linha) => {
    const palavras = linha.texto.split(/\s+/).filter(Boolean);
    return (
      palavras.length > 1
      && palavras.every((palavra) => PALAVRAS_DO_TEXTO_LEGAL.has(palavra.toLowerCase()))
    );
  });
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// AS FICHAS
// ────────────────────────────────────────────────────────────────────────────────────────────

/** A ficha mais comprida que a tela do Hades produz. Dados fictícios: este arquivo vai ao git. */
const FICHA_LONGA = {
  cpf: "987.654.321-00",
  endereco:
    "Rua Exemplo Bernardes de Albuquerque Filho - nº 253, apto 1204, bloco B - Morada Modelo - Itaúna/MG - CEP 35.680-448",
  estadoCivil: "Casado(a) sob o regime de comunhão parcial de bens",
  nacionalidade: "Brasileira",
  nome: "MARIA DA CONCEIÇÃO EXEMPLO DE OLIVEIRA GONÇALVES BITTENCOURT DOS SANTOS FILHA",
  profissao: "Técnica em Edificações e Operadora de Máquina Pesada",
};

/** A ficha curta: nome de uma linha, endereço sem complemento. */
const FICHA_CURTA = {
  cpf: "111.222.333-44",
  endereco: "Rua Exemplo, 10, Centro, Itauna/MG",
  estadoCivil: "Solteiro(a)",
  nacionalidade: "Brasileira",
  nome: "FULANO EXEMPLO",
  profissao: "Autonomo",
};

function termo(
  ficha: typeof FICHA_LONGA,
  emAtraso: number,
  noAcordo: number,
): DadosDoTermoDeAcordo {
  return {
    comprador: ficha,
    debito: {
      apuradoEm: "15/09/2026",
      parcelas: Array.from({ length: emAtraso }, (_, indice) => ({
        numero: `${indice + 1}/144`,
        valor: 1234.56,
        vencimento: "10/03/2026",
      })),
      previsaoDePagamento: "10/09/2027",
      valorAtualizado: 1000 + (noAcordo - 1) * 345.67,
      vencimentoConsiderado: "10/03/2026 a 10/08/2026",
    },
    emitidoEm: new Date(2026, 8, 15),
    empreendimento: "CONDOMINIO RECANTO DO PARAISO DAS AGUAS",
    parcelasDoAcordo: Array.from({ length: noAcordo }, (_, indice) => ({
      valor: indice === 0 ? 1000 : 345.67,
      vencimento: "10/10/2026",
    })),
    pv: "RPA0610",
    unidade: "Quadra 06 - Lote 10",
  };
}

/**
 * As 35 formas de acordo que existem HOJE em produção.
 *
 * ⚠️ MEDIDAS NO SUPABASE EM 20/09/2026, e não inventadas: `select
 * jsonb_array_length(metadata->'c2x_parcelas'), installments_count from guardian_compromissos where
 * kind = 'acordo'`. São 40 acordos em 35 formas distintas (18 aprovados, 22 reprovados). O arquivo
 * do implementador prova duas delas (a maior aprovada e a maior reprovada); a folha única é uma
 * promessa feita a TODAS, então todas são medidas.
 */
const FORMAS_DE_PRODUCAO: [number, number][] = [
  [48, 4], [44, 6], [25, 8], [22, 22], [18, 25],
  [14, 9], [13, 7], [11, 7], [10, 19], [10, 7],
  [9, 6], [7, 16], [7, 9], [7, 7], [7, 2],
  [6, 17], [6, 14], [6, 7], [6, 6], [5, 10],
  [5, 7], [5, 6], [5, 2], [4, 7], [4, 6],
  [4, 5], [3, 7], [3, 6], [3, 5], [2, 7],
  [2, 6], [2, 4], [1, 10], [22, 22], [6, 7],
];

// ────────────────────────────────────────────────────────────────────────────────────────────

describe("REVISÃO: o texto legal contra uma segunda transcrição do print", () => {
  it("título e os seis parágrafos batem PONTO DE CÓDIGO a ponto de código", () => {
    expect([...TITULO_DO_ACEITE].map((letra) => letra.codePointAt(0))).toEqual(
      [...TITULO_DO_PRINT].map((letra) => letra.codePointAt(0)),
    );
    expect(TEXTO_LEGAL_DO_ACORDO).toHaveLength(TEXTO_DO_PRINT.length);
    for (let indice = 0; indice < TEXTO_DO_PRINT.length; indice += 1) {
      expect([...(TEXTO_LEGAL_DO_ACORDO[indice] ?? "")].map((letra) => letra.codePointAt(0))).toEqual(
        [...(TEXTO_DO_PRINT[indice] ?? "")].map((letra) => letra.codePointAt(0)),
      );
    }
  });

  // ⚠️ `limpar` DERRUBA CALADO o que não é WinAnsi. Um "–" ou um espaço fino que entrasse numa
  // futura revisão do texto sumiria do papel sem erro nenhum, e o cliente assinaria a frase com a
  // palavra colada na seguinte.
  it("nenhum caractere do texto cai na faixa que `limpar` derruba", () => {
    const fora = [...[TITULO_DO_PRINT, ...TEXTO_DO_PRINT].join(" ")].filter((letra) => {
      const ponto = letra.codePointAt(0) ?? 0;
      return !(
        ponto === 9 || ponto === 10 || ponto === 13
        || (ponto >= 0x20 && ponto <= 0x7e)
        || (ponto >= 0xa0 && ponto <= 0xff)
      );
    });
    expect(fora).toEqual([]);
  });
});

describe("REVISÃO: a borda da folha, varrida", () => {
  // ⚠️ OS DOIS CASOS DE EXEMPLO NÃO CHEGAM PERTO DO RODAPÉ. No caso leve a última linha do texto
  // legal sai em y=327,8 e no pesado em y=246,1: o `y >= 48` do arquivo do implementador passaria
  // mesmo que a reserva de altura estivesse errada. Quem encosta na borda é a folha cheia, e é ela
  // que este teste varre, de 1 a 60 parcelas em atraso com as 37 do acordo que a tela permite.
  //
  // Medido em 20/09/2026: o menor y do texto legal em folha única é 84,3 (com 22 a 24 em atraso),
  // contra o rodapé desenhado em y=40. A partir de 25 o papel vira duas folhas e o aceite inteiro
  // desce para a última.
  it("de 1 a 60 em atraso, o texto legal nunca parte, nunca some e nunca encosta no rodapé", async () => {
    const problemas: string[] = [];

    for (let emAtraso = 1; emAtraso <= 60; emAtraso += 1) {
      const bytes = await montarTermoDeAcordoPdf(termo(FICHA_LONGA, emAtraso, 37));
      const desenhadas = linhasDoPdf(bytes);
      const doTexto = linhasDoTextoLegal(desenhadas);
      const titulo = desenhadas.find((linha) => linha.texto === TITULO_DO_ACEITE);

      if (doTexto.map((linha) => linha.texto).join(" ") !== TEXTO_LEGAL_DO_ACORDO.join(" ")) {
        problemas.push(`${emAtraso} em atraso: o texto remontado não é o do array`);
      }
      if (new Set(doTexto.map((linha) => linha.folha)).size !== 1) {
        problemas.push(`${emAtraso} em atraso: o texto legal saiu partido entre folhas`);
      }
      if (titulo?.folha !== doTexto[0]?.folha) {
        problemas.push(`${emAtraso} em atraso: o título ficou numa folha e o corpo em outra`);
      }
      for (const linha of doTexto) {
        if (linha.x !== 42) problemas.push(`${emAtraso} em atraso: x=${linha.x}, fora da margem`);
        if (linha.y < 48) problemas.push(`${emAtraso} em atraso: y=${linha.y}, em cima do rodapé`);
      }
    }

    expect(problemas).toEqual([]);
  }, 120000);

  // ⚠️ O CAMINHO DA TABELA LIMPA TAMBÉM TEM DE ENTREGAR O ACEITE. Com centenas de parcelas o termo
  // deixa de usar a tabela do termo e passa a usar `desenharTabelaLimpa`, que pagina sozinha: é o
  // único trecho em que ninguém mediu onde `ctx.y` para antes do fecho.
  it("com 300 parcelas em atraso, o aceite sai inteiro na última folha", async () => {
    const bytes = await montarTermoDeAcordoPdf({
      ...termo(FICHA_LONGA, 300, 36),
      debito: {
        ...termo(FICHA_LONGA, 300, 36).debito,
        valorAtualizado: 30000,
      },
      parcelasDoAcordo: Array.from({ length: 36 }, (_, indice) => ({
        valor: indice === 0 ? 5000 : 714.28,
        vencimento: "10/10/2026",
      })),
    });
    const folhas = (await PDFDocument.load(bytes)).getPageCount();
    const desenhadas = linhasDoPdf(bytes);
    const doTexto = linhasDoTextoLegal(desenhadas);

    expect(folhas).toBeGreaterThan(1);
    expect(doTexto.map((linha) => linha.texto).join(" ")).toBe(TEXTO_LEGAL_DO_ACORDO.join(" "));
    expect(new Set(doTexto.map((linha) => linha.folha))).toEqual(new Set([folhas]));
  }, 60000);
});

describe("REVISÃO: as formas de acordo que existem em produção", () => {
  it.each([
    ["longa", FICHA_LONGA],
    ["curta", FICHA_CURTA],
  ])("com a ficha %s, todas as 35 formas cabem em UMA folha", async (_rotulo, ficha) => {
    const estouros: string[] = [];

    for (const [emAtraso, noAcordo] of FORMAS_DE_PRODUCAO) {
      const bytes = await montarTermoDeAcordoPdf(termo(ficha, emAtraso, noAcordo));
      const folhas = (await PDFDocument.load(bytes)).getPageCount();
      if (folhas !== 1) estouros.push(`${emAtraso} em atraso x ${noAcordo} no acordo: ${folhas} folhas`);
    }

    expect(estouros).toEqual([]);
  }, 120000);

  it("e em todas elas o texto legal sai com as 9 linhas, na mesma folha", async () => {
    const problemas: string[] = [];

    for (const [emAtraso, noAcordo] of FORMAS_DE_PRODUCAO) {
      const doTexto = linhasDoTextoLegal(
        linhasDoPdf(await montarTermoDeAcordoPdf(termo(FICHA_LONGA, emAtraso, noAcordo))),
      );
      if (doTexto.length !== 9) problemas.push(`${emAtraso}x${noAcordo}: ${doTexto.length} linhas`);
      if (new Set(doTexto.map((linha) => linha.folha)).size !== 1) {
        problemas.push(`${emAtraso}x${noAcordo}: partido entre folhas`);
      }
    }

    expect(problemas).toEqual([]);
  }, 120000);
});

describe("REVISÃO: o que o papel diz sobre quem assina", () => {
  // ────────────────────────────────────────────────────────────────────────────────────────────
  // ⚠️ O QUE ERA, E O QUE FICOU DECIDIDO (20/09/2026).
  // ────────────────────────────────────────────────────────────────────────────────────────────
  //
  // Lucas, nesse dia: *"quem vai, o comprador, o incorporador e a nivea careli"*. Três partes
  // assinam. O papel, porém, era o mesmo de 16/09/2026, quando ele era um IMPRESSO e o próprio Lucas
  // disse *"não precisa colocar quem assina"*: ele qualificava UMA parte, o COMPRADOR, e não dizia
  // em lugar nenhum que outras duas assinariam. E a primeira frase do texto do jurídico fala no
  // plural, *"as partes declaram que estão de acordo"*.
  //
  // O QUE FOI FEITO: o papel passou a NOMEAR as três partes, em uma linha (`QUEM_ASSINA_O_TERMO`).
  //
  // O QUE NÃO FOI FEITO, E POR QUÊ: a QUALIFICAÇÃO completa das outras duas (razão social, CNPJ e
  // representante legal da vendedora) continua fora, e isso é medida, não esquecimento. Esse dado
  // não é lido em NENHUM dos dois caminhos do papel: `montarTermoDoAcordoEmPdf` recebe o acordo e a
  // ficha do C2X, e quem lê o quadro do empreendimento é só o ENVIO. Pôr a vendedora no corpo exigiria
  // o download abrir o Panteon também, sob pena de os dois papéis divergirem, que é exatamente o que
  // `termo-em-pdf.ts` existe para impedir. Some-se a folha: o bloco do COMPRADOR ocupa ~44pt, e
  // repeti-lo duas vezes derrubaria a folha única que as 35 formas de produção têm hoje.
  //
  // ⚠️ ISTO ESTÁ NA MESA DO LUCAS. Se ele quiser a qualificação completa no corpo do papel, a
  // decisão precisa acontecer ANTES de `TERMO_DE_ACORDO_LIBERADO` virar `true`, e este teste é o
  // lugar onde ela passa a valer.
  it("o papel nomeia as três partes que assinam", async () => {
    const desenhadas = linhasDoPdf(await montarTermoDeAcordoPdf(termo(FICHA_CURTA, 3, 6)));
    const papel = desenhadas.map((linha) => linha.texto).join("\n");

    // O comprador está lá, com tudo: é o bloco aprovado em 16/09/2026, e ele não mudou.
    expect(papel).toContain("COMPRADOR");
    expect(papel).toContain(FICHA_CURTA.nome);
    expect(papel).toContain(`CPF ${FICHA_CURTA.cpf}`);

    // E as outras duas passaram a ser nomeadas, pelo papel que ocupam no acordo.
    expect(papel).toContain("VENDEDORA");
    expect(papel).toContain("CARELI");
    expect(papel).toContain("administradora da carteira");
  });

  // ⚠️ AS TRÊS PARTES DO PAPEL SÃO AS TRÊS DO ENVELOPE, e é isso que este teste prende. A lista de
  // quem assina mora em `signatarios-do-acordo.ts` e o papel é desenhado aqui: sem um teste ligando
  // os dois, acrescentar um quarto signatário (ou tirar um) passaria sem que o documento soubesse.
  it("as partes nomeadas no papel são as mesmas que vão para a Clicksign", async () => {
    const { signatariosDoAcordo } = await import("@/lib/hades/acordo/signatarios-do-acordo");

    const montagem = signatariosDoAcordo({
      careli: { cpf: null, email: "careli@exemplo.test", nome: "Fulana Careli", papel: "careli", telefone: null },
      comprador: { cpf: null, email: "comprador@exemplo.test", nome: "Fulano Comprador Exemplo", papel: "comprador", telefone: null },
      incorporador: { cpf: null, email: "vendedora@exemplo.test", nome: "Beltrana Representante Legal", papel: "vendedora", telefone: null },
    });

    expect(montagem.signatarios.map((s) => s.papel)).toEqual(["comprador", "vendedora", "careli"]);

    const papel = linhasDoPdf(await montarTermoDeAcordoPdf(termo(FICHA_CURTA, 3, 6)))
      .map((linha) => linha.texto)
      .join("\n");

    for (const rotulo of ["COMPRADOR", "VENDEDORA", "CARELI"]) {
      expect(papel).toContain(rotulo);
    }
  });

  // ⚠️ O FECHO CLÁSSICO (local, data por extenso e linha de assinatura) CONTINUA FORA, e é decisão:
  // o termo não é impresso para assinar à caneta, é assinado na Clicksign, que anexa a própria
  // página de assinaturas com nome, e-mail, data, hora, IP e o hash do documento de cada signatário.
  // Uma linha "____________" num PDF que nunca vai ser impresso é convite a alguém imprimir e
  // assinar fora do fluxo, e aí existiriam duas vias com validade diferente. O rodapé já diz quem
  // emitiu e quando.
  it("o papel não finge ser um documento de assinar à caneta", async () => {
    const papel = linhasDoPdf(await montarTermoDeAcordoPdf(termo(FICHA_CURTA, 3, 6)))
      .map((linha) => linha.texto)
      .join("\n");

    expect(papel).not.toMatch(/_{10,}/);
    // E o rodapé continua dizendo quem emitiu e quando, que é o que dá data ao papel.
    expect(papel).toContain("emitido pela Careli em");
  });
});
