import { PILHA_GEORGIA } from "./fontes-do-contrato";

// COMO O CONTRATO SE PARECE — a tipografia do documento, num lugar só.
//
// Lucas, 08/09/2026, vendo a primeira prévia gerada de verdade: *"ficou desconfigurado"*. E estava:
// título colado no parágrafo seguinte, palavras espalhadas pela justificação, nenhum respiro entre
// as cláusulas.
//
// ⚠️ A CAUSA É O RESET DO TAILWIND. O hub roda com o preflight ligado, que zera a margem de TODOS
// os elementos — inclusive dos `<p>` que chegam de dentro do `dangerouslySetInnerHTML`. Na tela o
// contrato virava um bloco corrido de texto.
//
// ⚠️ E O PDF TINHA O MESMO BURACO PELO MOTIVO OPOSTO: o `CSS_BASE` de `html-para-pdf.ts` resolve
// PAGINAÇÃO (órfãs, viúvas, quebra dentro de tabela) e não diz nada sobre tipografia, então o
// Chromium caía no padrão dele — Times New Roman, margem de 1em. Duas telas, dois resultados
// diferentes para o MESMO contrato, e nenhuma delas escolhida por alguém.
//
// ⚠️ POR ISSO ESTE ARQUIVO EXISTE SEPARADO DOS DOIS. A prévia serve para conferir o que vai virar
// papel: se ela usasse um CSS e o PDF outro, conferir na tela não provaria nada sobre o papel — que
// é exatamente o trabalho que a prévia veio fazer.

/**
 * A tipografia do contrato.
 *
 * ⚠️ O `font-family` AQUI É SÓ O PISO. O documento sai do editor com `font-family` inline em quase
 * todo trecho (450 dos 485 da minuta do JDG), e o inline vence isto — como deve ser: quem escolheu
 * a fonte na minuta escolheu de propósito. Este valor é para o que NÃO declarou nada.
 *
 * ⚠️ E A SERIFA É DELIBERADA. Contrato se lê em serifa no Brasil inteiro; um contrato em Arial
 * levanta a sobrancelha de quem assina antes de a primeira cláusula ser lida.
 *
 * ⚠️ A PILHA VEM DE `fontes-do-contrato.ts`, que é a mesma lista do seletor da barra. Antes o valor
 * estava escrito aqui à mão: "Georgia (padrão)" no seletor e uma pilha diferente no piso seriam duas
 * fontes com o mesmo nome, e a diferença só apareceria na folha impressa.
 */
export const CSS_DO_DOCUMENTO = `
  font-family: ${PILHA_GEORGIA};
  font-size: 12pt;
  line-height: 1.5;
  color: #111;

  /* ⚠️ A GEORGIA USA ALGARISMOS DE ALTURA VARIÁVEL: o 3, 4, 7 e 9 descem abaixo da linha de base,
     como letras com perna. Em texto corrido é bonito; num instrumento cheio de valor, data e tabela
     de parcelas é ruído — "R$ 9.800,00" e "05/09/2026" saem serrilhados, e uma coluna de valores
     deixa de alinhar. Esta linha pede à fonte o conjunto de altura fixa.

     Medido em 08/09/2026 na georgia.ttf do Windows 11 (Version 5.59): a tabela GSUB declara as
     features lnum, onum, pnum e tnum — ou seja, o conjunto alinhado EXISTE na fonte e esta
     declaração tem o que ativar. Numa fonte sem lnum, ela simplesmente não faz nada. */
  font-variant-numeric: lining-nums;
`;

/**
 * As regras que alcançam o conteúdo do contrato.
 *
 * `escopo` é o seletor do container (`.previa-do-contrato`, `body`). Sai como texto para caber tanto
 * num `<style>` da tela quanto no documento que o Chromium recebe.
 */
export function regrasDoDocumento(escopo: string): string {
  return `
  ${escopo} { ${CSS_DO_DOCUMENTO} }

  /* ⚠️ A MARGEM DO PARÁGRAFO É O QUE SEPARA UMA CLÁUSULA DA OUTRA. Sem ela — e o preflight do
     Tailwind a remove — o contrato vira um bloco corrido em que o título encosta no texto. */
  ${escopo} p { margin: 0 0 10px; }
  ${escopo} p:last-child { margin-bottom: 0; }

  /* Títulos respiram mais em cima do que embaixo: eles pertencem ao que vem DEPOIS deles. */
  ${escopo} h1, ${escopo} h2, ${escopo} h3,
  ${escopo} h4, ${escopo} h5, ${escopo} h6 {
    margin: 18px 0 8px;
    line-height: 1.3;
  }
  ${escopo} h1 { font-size: 1.4em; }
  ${escopo} h2 { font-size: 1.25em; }
  ${escopo} h3 { font-size: 1.1em; }

  /* ⚠️ A JUSTIFICAÇÃO PRECISA PODER QUEBRAR PALAVRA. Um contrato ainda não preenchido tem
     [regime_casamento_cliente] no meio da frase — 25 caracteres sem espaço, que o navegador não
     quebra e empurra para a linha seguinte, esticando a anterior até as palavras ficarem
     espalhadas. Foi assim que a primeira prévia apareceu. */
  ${escopo} p, ${escopo} li, ${escopo} td {
    overflow-wrap: break-word;
    hyphens: auto;
  }

  ${escopo} ul, ${escopo} ol { margin: 0 0 10px; padding-left: 24px; }
  ${escopo} li { margin: 0 0 4px; }

  ${escopo} table { border-collapse: collapse; margin: 10px 0; width: 100%; }
  ${escopo} th, ${escopo} td { padding: 5px 7px; vertical-align: top; }

  /* ⚠️ display:block AQUI TAMBÉM, e de propósito repetido: o serializador já o escreve inline em
     cada imagem, mas uma minuta importada de .docx pode trazer um img sem estilo nenhum. Com o
     preflight do Tailwind na tela e sem ele no PDF, deixar isso ao acaso faz a mesma imagem cair em
     lugares diferentes nos dois. Ver a nota do img em documento-html.ts.

     ⚠️ E NADA DE CRASE NESTE ARQUIVO: as regras vivem dentro de um template literal, e uma crase
     de comentário o FECHA no meio — o erro que sai é de sintaxe, trinta linhas abaixo. */
  ${escopo} img { display: block; max-width: 100%; height: auto; }
  ${escopo} figure { margin: 10px 0; }

  ${escopo} blockquote {
    margin: 10px 0;
    padding-left: 14px;
    border-left: 3px solid #ccc;
  }

  ${escopo} hr { border: none; border-top: 1px solid #ccc; margin: 14px 0; }

  /* ⚠️ A QUEBRA DE PÁGINA É A MESMA CLASSE DO PDF (pagina-nova, em html-para-pdf.ts). Na TELA ela
     não pode virar página — vira uma linha tracejada, para quem confere ver ONDE o papel vai
     cortar sem precisar gerar o PDF. */
  ${escopo} .pagina-nova { break-before: page; page-break-before: always; }
`;
}

/** A mesma coisa, com a linha tracejada que só a tela usa no lugar da quebra. */
export function regrasParaATela(escopo: string): string {
  return `${regrasDoDocumento(escopo)}
  ${escopo} .pagina-nova {
    border-top: 1px dashed #bbb;
    margin-top: 22px;
    padding-top: 22px;
  }
`;
}
