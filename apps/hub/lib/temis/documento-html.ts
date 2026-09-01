// O DOCUMENTO DO EDITOR VIRA HTML — e é este HTML que gera o contrato.
//
// POR QUE UM SERIALIZADOR PRÓPRIO, e não o `serializeHtml` do Plate. O do Plate renderiza os
// componentes React do editor (via `PlateStatic`), o que amarra o HTML do contrato ao editor: trocar
// um componente de tela mudaria o documento que as pessoas assinam, e reproduzir um contrato de
// 2026 em 2034 exigiria ter o editor daquela época. Aqui a conversão é código puro, determinístico,
// com teste — roda igual no navegador e no servidor, e continua funcionando se um dia trocarmos o
// editor. O `conteudo` (jsonb) é a fonte de edição; este arquivo produz o `conteudo_html`, que é o
// que a geração usa.
//
// ⚠️ AS VARIÁVEIS ATRAVESSAM INTACTAS. `[nome_cliente]` é texto comum para o editor, e colchete não
// é caractere especial de HTML — mas o escape aqui é feito à mão justamente para garantir que
// continue assim. Uma minuta cujo `[cpf_cliente]` virasse `&#91;cpf_cliente&#93;` passaria em toda
// conferência de tela e sairia impressa literalmente no contrato.
//
// ⚠️ O QUE NÃO ESTÁ AQUI NÃO EXISTE NO CONTRATO. Um tipo de bloco desconhecido cai em `<p>` em vez
// de sumir: perder um parágrafo em silêncio é pior do que perdê-lo de estilo.

export type NoDeTexto = {
  bold?: boolean;
  code?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  subscript?: boolean;
  superscript?: boolean;
  text: string;
  underline?: boolean;
};

export type NoDoDocumento = {
  align?: string;
  children?: (NoDeTexto | NoDoDocumento)[];
  indent?: number;
  listStyleType?: string;
  text?: string;
  textAlign?: string;
  type?: string;
};

/** Escapa o que é especial em HTML. Colchete NÃO é — ver a nota do topo. */
export function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ehTexto(no: NoDeTexto | NoDoDocumento): no is NoDeTexto {
  return typeof (no as NoDeTexto).text === "string" && !(no as NoDoDocumento).type;
}

/** As marcas, da mais interna para a mais externa. A ordem é fixa para o HTML ser reproduzível. */
const MARCAS: { chave: keyof NoDeTexto; tag: string }[] = [
  { chave: "code", tag: "code" },
  { chave: "subscript", tag: "sub" },
  { chave: "superscript", tag: "sup" },
  { chave: "strikethrough", tag: "s" },
  { chave: "underline", tag: "u" },
  { chave: "italic", tag: "em" },
  { chave: "bold", tag: "strong" },
];

function textoParaHtml(no: NoDeTexto): string {
  // Texto vazio não vira `<strong></strong>`: tag vazia só suja o documento.
  if (!no.text) return "";

  let html = escaparHtml(no.text);
  for (const marca of MARCAS) {
    if (no[marca.chave]) html = `<${marca.tag}>${html}</${marca.tag}>`;
  }
  return html;
}

function filhosParaHtml(no: NoDoDocumento): string {
  return (no.children ?? [])
    .map((filho) => (ehTexto(filho) ? textoParaHtml(filho) : blocoParaHtml(filho)))
    .join("");
}

/** O `style` do bloco: alinhamento e recuo. Vazio quando não há nenhum. */
function estiloDoBloco(no: NoDoDocumento, dentroDeLista: boolean): string {
  const partes: string[] = [];
  const alinhamento = no.textAlign ?? no.align;
  if (alinhamento && alinhamento !== "left") partes.push(`text-align:${alinhamento}`);

  // ⚠️ O RECUO DE LISTA JÁ É DADO PELO `<ul>`/`<ol>`. Repeti-lo aqui somaria os dois e cada nível
  // apareceria duas vezes mais à direita do que devia.
  if (!dentroDeLista && no.indent && no.indent > 0) {
    partes.push(`margin-left:${no.indent * 24}px`);
  }

  return partes.length ? ` style="${partes.join(";")}"` : "";
}

const TAG_DO_BLOCO: Record<string, string> = {
  blockquote: "blockquote",
  h1: "h1",
  h2: "h2",
  h3: "h3",
  h4: "h4",
  h5: "h5",
  h6: "h6",
  p: "p",
};

function blocoParaHtml(no: NoDoDocumento, dentroDeLista = false): string {
  const tipo = no.type ?? "p";

  if (tipo === "hr") return "<hr />";

  if (tipo === "table") {
    return `<table>${filhosParaHtml(no)}</table>`;
  }
  if (tipo === "tr") return `<tr>${filhosParaHtml(no)}</tr>`;
  if (tipo === "td" || tipo === "th") {
    return `<${tipo}${estiloDoBloco(no, false)}>${filhosParaHtml(no)}</${tipo}>`;
  }

  // ⚠️ TIPO DESCONHECIDO VIRA PARÁGRAFO. Ver a nota do topo: perder o estilo é aceitável; perder o
  // parágrafo do contrato não é.
  const tag = TAG_DO_BLOCO[tipo] ?? "p";
  const conteudo = filhosParaHtml(no);

  // Parágrafo vazio existe no contrato — é o espaço entre cláusulas. Vira `<p><br /></p>` para não
  // colapsar na renderização.
  const corpo = conteudo === "" ? "<br />" : conteudo;

  // ⚠️ O `<li>` SAI ABERTO DE PROPÓSITO. Quem fecha é `documentoParaHtml`, porque um item que tem
  // sublista só fecha DEPOIS dela — é o que mantém o HTML válido.
  if (dentroDeLista) return `<li${estiloDoBloco(no, true)}>${corpo}`;
  return `<${tag}${estiloDoBloco(no, false)}>${corpo}</${tag}>`;
}

/** "disc"/"circle"/"square" saem em `<ul>`; o resto ("decimal", "lower-alpha"…) em `<ol>`. */
function tagDaLista(estilo: string): "ol" | "ul" {
  return ["circle", "disc", "square"].includes(estilo) ? "ul" : "ol";
}

/**
 * Converte o documento do editor em HTML.
 *
 * ⚠️ AS LISTAS DO PLATE NÃO SÃO `<ul><li>` NO DOCUMENTO. Desde a versão 49 cada item é um parágrafo
 * comum com `listStyleType` e `indent` — a mesma ideia do Word. Quem precisa reconstruir a árvore
 * `<ul>/<ol>` é este serializador: sem isso, uma lista de dez itens sairia como dez parágrafos
 * soltos no contrato, e a numeração das cláusulas se perderia.
 *
 * ⚠️ A SUBLISTA VAI DENTRO DO `<li>` DO ITEM PAI, e não solta dentro do `<ul>`. É a única forma
 * válida em HTML. O navegador perdoa a forma errada; conversores de HTML para PDF nem sempre — e o
 * contrato termina em PDF. Por isso o `</li>` do item que tem filhos só fecha depois da sublista.
 */
export function documentoParaHtml(nos: NoDoDocumento[]): string {
  const saida: string[] = [];

  // Pilha das listas abertas. `itemAberto` diz se há um `<li>` esperando fechamento no nível.
  const abertas: { indent: number; itemAberto: boolean; tag: "ol" | "ul" }[] = [];

  const fecharItemDoTopo = () => {
    const topo = abertas[abertas.length - 1];
    if (topo?.itemAberto) {
      saida.push("</li>");
      topo.itemAberto = false;
    }
  };

  /** Fecha todos os níveis cujo recuo é maior ou igual a `indent`. */
  const fecharAte = (indent: number) => {
    while (abertas.length > 0 && abertas[abertas.length - 1]!.indent >= indent) {
      fecharItemDoTopo();
      saida.push(`</${abertas.pop()!.tag}>`);
      // O nível de cima tem um `<li>` aberto — é ele que continha esta sublista. Ele só fecha
      // quando o próximo item chegar ou quando o próprio nível fechar.
    }
  };

  for (const no of nos) {
    const estilo = no.listStyleType;

    if (!estilo) {
      fecharAte(0);
      saida.push(blocoParaHtml(no));
      continue;
    }

    const indent = no.indent ?? 1;
    const tag = tagDaLista(estilo);
    const topo = abertas[abertas.length - 1];

    if (!topo || indent > topo.indent) {
      // Nível mais fundo: a sublista entra DENTRO do `<li>` que está aberto.
      abertas.push({ indent, itemAberto: false, tag });
      saida.push(`<${tag}>`);
    } else if (indent < topo.indent) {
      fecharAte(indent + 1);
      const pai = abertas[abertas.length - 1];
      if (pai && pai.indent === indent) fecharItemDoTopo();
      else {
        abertas.push({ indent, itemAberto: false, tag });
        saida.push(`<${tag}>`);
      }
    } else if (topo.tag !== tag) {
      // Mesmo nível, marcador diferente (de bolinha para número): é outra lista.
      fecharItemDoTopo();
      saida.push(`</${abertas.pop()!.tag}>`);
      abertas.push({ indent, itemAberto: false, tag });
      saida.push(`<${tag}>`);
    } else {
      fecharItemDoTopo();
    }

    saida.push(blocoParaHtml(no, true));
    abertas[abertas.length - 1]!.itemAberto = true;
  }

  fecharAte(0);
  return saida.join("");
}

/**
 * O texto puro do documento, para contar caracteres e procurar variáveis sem passar pelo HTML.
 *
 * ⚠️ SEPARA OS BLOCOS COM QUEBRA DE LINHA. Sem isso, o fim de um parágrafo grudaria no começo do
 * seguinte e criaria palavras que não existem no contrato — inclusive variáveis falsas.
 */
export function documentoParaTexto(nos: NoDoDocumento[]): string {
  const linhas: string[] = [];

  const percorrer = (no: NoDeTexto | NoDoDocumento): string => {
    if (ehTexto(no)) return no.text;
    return (no.children ?? []).map(percorrer).join("");
  };

  for (const no of nos) linhas.push(percorrer(no));
  return linhas.join("\n");
}

/** Um documento vazio válido para o editor abrir. */
export function documentoVazio(): NoDoDocumento[] {
  return [{ children: [{ text: "" }], type: "p" }];
}
