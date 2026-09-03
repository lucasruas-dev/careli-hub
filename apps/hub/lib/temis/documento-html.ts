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
// Reforçado em 02/09/2026, quando o editor ganhou o conjunto completo do Plate UI (pedido do Lucas:
// *"não temos todas essas ferramentas, revise as documentações pois quero isso completo, estamos
// muito simples"*): o `serializeHtml` do Plate emite só classes Tailwind e exige o CSS do editor no
// destino — um contrato não carrega CSS. Tudo aqui sai com estilo INLINE e sem classe.
//
// ⚠️ AS VARIÁVEIS ATRAVESSAM INTACTAS. Desde 02/09/2026 a variável é um NÓ do editor
// (`{ type: "variavel", nome }`, inline e void — ver `modules/temis/plugins/variavel-kit-base.ts`),
// não mais texto solto: atômica, a marca não entra no meio dela e a IA não a renomeia por dentro.
// Aqui ela volta a ser o texto `[nome]`, que é o que o motor de contrato procura e o que toda a
// auditoria (`variaveisDoTexto`, `conferirBlocos`, `codigosPartidos`) lê. Colchete não é caractere
// especial de HTML — mas o escape é feito à mão justamente para garantir que continue assim. Uma
// minuta cujo `[cpf_cliente]` virasse `&#91;cpf_cliente&#93;` passaria em toda conferência de tela
// e sairia impressa literalmente no contrato.
//
// ⚠️ O QUE NÃO ESTÁ AQUI NÃO EXISTE NO CONTRATO. Um tipo de bloco desconhecido cai em `<p>` em vez
// de sumir: perder um parágrafo em silêncio é pior do que perdê-lo de estilo.
//
// ⚠️ COMENTÁRIOS E SUGESTÕES NÃO VÃO PARA O CONTRATO. As marcas `comment*`/`suggestion*` do editor
// são revisão, não conteúdo. O contrato sai com o texto ORIGINAL, e isso tem uma consequência
// concreta: o trecho (ou bloco) que uma sugestão ainda não aceita propõe INSERIR é pulado, e o que
// ela propõe REMOVER sai normalmente — é o original. Sem essa regra, "30 (trinta) dias" trocado por
// "45 (quarenta e cinco) dias" no modo Sugerir saía no contrato como os dois textos emendados
// ("30 (trinta) dias45 (quarenta e cinco) dias"). Quem precisa saber se há sugestão aberta antes de
// publicar usa `temSugestoesPendentes` — e a tela trava o Publicar enquanto houver.
//
// ⚠️ TRECHOS VIZINHOS COM O MESMO ESTILO SAEM NUM `<span>` SÓ. A variável é um nó separado do texto
// ao redor, então "COMPRADOR(ES):[nome]" são três trechos no documento. Emitir um span por trecho
// partia cada `<span style="font-family:…">` em três e o `conteudo_html` da minuta do JDG crescia
// 33% (65 → 87 KB) só de abrir e salvar sem mexer — e qualquer diff entre versões acusava o
// documento inteiro. Aqui o span (e a marca, quando também é igual) envolve o grupo, e o HTML de
// uma minuta antiga sai IGUAL ao que estava gravado. `round-trip.test.ts` garante isso.

export type NoDeTexto = {
  backgroundColor?: string;
  bold?: boolean;
  code?: boolean;
  /** Cor do texto. Medida na minuta real: 18 ocorrencias, todas preto. */
  color?: string;
  /** Marca de comentário do editor (`comment: true` + `comment_<id>`). Ignorada no contrato. */
  comment?: unknown;
  /** ⚠️ 450 dos 485 trechos da minuta do JDG tem fonte propria. Ver a nota do topo. */
  fontFamily?: string;
  fontSize?: string;
  highlight?: boolean;
  italic?: boolean;
  /** Tecla (`<kbd>`). Vem do basic-nodes-kit; raro em minuta, mas existe. */
  kbd?: boolean;
  strikethrough?: boolean;
  subscript?: boolean;
  /** Marca de sugestão do editor (`suggestion: true` + `suggestion_<id>`). Ignorada no contrato. */
  suggestion?: unknown;
  superscript?: boolean;
  text: string;
  underline?: boolean;
};

export type NoDoDocumento = {
  align?: string;
  /** Fundo da celula. Na minuta do JDG e o cinza do box de CIENCIA PREVIA. */
  background?: string;
  /** Fundo do callout (o Plate grava `backgroundColor` no elemento, não `background`). */
  backgroundColor?: string;
  /** Legenda da imagem. ⚠️ No Plate é uma LISTA DE NÓS (`caption[0].children[].text`), não string. */
  caption?: unknown;
  /** Celula mesclada — perder isso desmonta o quadro-resumo. */
  colSpan?: number;
  children?: (NoDeTexto | NoDoDocumento)[];
  /** Diagrama por código (`code_drawing`): `data.code` é o fonte, `data.drawingType` o motor. */
  data?: { code?: string; drawingType?: string };
  /** Data do nó `date`, em ISO `AAAA-MM-DD`. */
  date?: string;
  /** Ícone do callout (emoji). */
  icon?: string;
  /** Id que o `nodeId` do Plate grava em todo bloco. Ignorado: é do editor, não do contrato. */
  id?: string;
  /** Identificador da nota de rodapé (`footnoteReference` e `footnoteDefinition`). */
  identifier?: string;
  indent?: number;
  isUpload?: boolean;
  /** Linguagem do `code_block`. */
  lang?: string;
  lineHeight?: number | string;
  listStyleType?: string;
  /** Nome do arquivo (`file`, `video`, `audio`). */
  name?: string;
  /** Nome da variável do sistema (nó `variavel`), sem colchetes. */
  nome?: string;
  rowSpan?: number;
  /** Sugestão de bloco inteiro (inserido/removido). Ignorada no contrato. */
  suggestion?: unknown;
  text?: string;
  textAlign?: string;
  textIndent?: number;
  /** Fórmula do `equation`/`inline_equation`. ⚠️ O Plate grava `texExpression`; `texMath` é aceito por tolerância. */
  texExpression?: string;
  texMath?: string;
  type?: string;
  /** Endereco do link (elemento tipo "a") ou da mídia (`img`, `video`, `audio`, `file`, `media_embed`). */
  url?: string;
  /** Valor da menção (`mention`). */
  value?: string;
  /** Largura da coluna (`"50%"`) ou da imagem (número em px ou string). */
  width?: number | string;
};

/** Opções da conversão. Tudo opcional: o padrão é a identidade. */
export type OpcoesDeHtml = {
  /**
   * Troca a URL da mídia na hora de gerar. O nó guarda a URL assinada de leitura do bucket; o
   * gerador de contrato pode preferir re-assinar ou embutir. Padrão: a própria URL.
   */
  resolverMidia?: (url: string) => string;
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

/** O nome da variável só vale se for o que a regex canônica de `variaveis.ts` reconhece. */
const NOME_DE_VARIAVEL = /^[A-Za-z0-9_]{2,80}$/;

/** As marcas, da mais interna para a mais externa. A ordem é fixa para o HTML ser reproduzível. */
const MARCAS: { chave: keyof NoDeTexto; tag: string }[] = [
  { chave: "code", tag: "code" },
  { chave: "kbd", tag: "kbd" },
  { chave: "subscript", tag: "sub" },
  { chave: "superscript", tag: "sup" },
  { chave: "strikethrough", tag: "s" },
  { chave: "underline", tag: "u" },
  { chave: "italic", tag: "em" },
  { chave: "bold", tag: "strong" },
];

/**
 * O `style` de um trecho de texto: fonte, tamanho e cor.
 *
 * ⚠️ A FONTE NAO E ENFEITE. Medido na minuta do JDG que esta no ar: 450 dos 485 trechos trazem
 * `font-family`, sempre a mesma ("Lucida Sans Unicode"). Normalizar para a fonte do editor mudaria
 * a cara de TODAS as linhas do contrato impresso — o juridico compara com a versao do loteador e
 * ve um documento diferente.
 */
function estiloDoTexto(no: NoDeTexto): string {
  const partes: string[] = [];
  if (no.fontFamily) partes.push(`font-family:${no.fontFamily}`);
  if (no.fontSize) partes.push(`font-size:${no.fontSize}`);
  if (no.color) partes.push(`color:${no.color}`);
  if (no.backgroundColor) partes.push(`background-color:${no.backgroundColor}`);
  return partes.join(";");
}

/** Veste `html` (já escapado) com as marcas do trecho `no` — sem o span de estilo. */
function vestirMarcas(no: NoDeTexto, html: string): string {
  for (const marca of MARCAS) {
    if (no[marca.chave]) html = `<${marca.tag}>${html}</${marca.tag}>`;
  }
  if (no.highlight) html = `<mark>${html}</mark>`;
  return html;
}

/** A assinatura das marcas de um trecho: dois trechos com a mesma assinatura vestem a mesma tag. */
function chaveDasMarcas(no: NoDeTexto): string {
  const tags = MARCAS.filter((marca) => no[marca.chave]).map((marca) => marca.tag);
  if (no.highlight) tags.push("mark");
  return tags.join(",");
}

/** O span vem POR FORA das marcas, para a fonte valer no trecho inteiro. */
function comEstilo(estilo: string, html: string): string {
  if (!html) return "";
  return estilo ? `<span style="${estilo}">${html}</span>` : html;
}

/**
 * A sugestão de INSERÇÃO ainda não aceita — o trecho ou bloco que o revisor propôs acrescentar.
 *
 * O editor grava a marca de duas formas: no TEXTO, `suggestion: true` + `suggestion_<id>: { type }`;
 * no BLOCO, `suggestion: { type, … }`. Só o `insert` é pulado no contrato: o `remove` é o texto
 * original (sai), e o `update` é mudança de marca (o texto continua o mesmo).
 */
function ehSugestaoDeInsercao(no: NoDeTexto | NoDoDocumento): boolean {
  const tipoDe = (valor: unknown): unknown =>
    typeof valor === "object" && valor !== null ? (valor as { type?: unknown }).type : undefined;
  if (tipoDe(no.suggestion) === "insert") return true;
  return Object.entries(no).some(
    ([chave, valor]) => chave.startsWith("suggestion_") && tipoDe(valor) === "insert",
  );
}

/** O primeiro filho de texto de um nó inline void — é nele que o Plate guarda as marcas. */
function primeiroTexto(no: NoDoDocumento): NoDeTexto {
  const filho = (no.children ?? []).find(ehTexto);
  return filho ?? { text: "" };
}

/**
 * Um PEDAÇO inline pronto para ser agrupado: o HTML do miolo (já escapado, SEM marca e SEM estilo),
 * as marcas que o vestem e o estilo do span. `null` quando o pedaço não existe no contrato (texto
 * vazio ou sugestão de inserção).
 */
type PedacoInline = {
  chaveDasMarcas: string;
  estilo: string;
  marcas: NoDeTexto;
  miolo: string;
};

function pedacoDeTexto(no: NoDeTexto): null | PedacoInline {
  // Texto vazio não vira `<strong></strong>`: tag vazia só suja o documento.
  if (!no.text || ehSugestaoDeInsercao(no)) return null;
  return {
    chaveDasMarcas: chaveDasMarcas(no),
    estilo: estiloDoTexto(no),
    marcas: no,
    miolo: escaparHtml(no.text),
  };
}

/**
 * A variável do sistema volta a ser `[nome]`.
 *
 * ⚠️ AS MARCAS VÊM DO FILHO. O nó é void (`children: [{ text: "" }]`), e quando o usuário aplica
 * negrito na variável o Plate grava a marca nesse filho. Vestir o `[nome]` com ela é o que faz o
 * `<strong>[numero_quadra]</strong>` sair INTEIRO — e não `<strong>[numero_qu</strong>adra]`, o
 * defeito que imprimiu `[nome_cliente]` no primeiro contrato do JDG.
 */
function pedacoDeVariavel(no: NoDoDocumento): null | PedacoInline {
  if (ehSugestaoDeInsercao(no)) return null;
  const nome = no.nome ?? "";
  const filho = primeiroTexto(no);
  // Nome fora do padrão não vira variável: sai como texto escapado, entre colchetes, para o
  // jurídico VER que há algo errado em vez de o motor engolir.
  const miolo = NOME_DE_VARIAVEL.test(nome) ? `[${nome}]` : `[${escaparHtml(nome)}]`;
  return {
    chaveDasMarcas: chaveDasMarcas(filho),
    estilo: estiloDoTexto(filho),
    marcas: filho,
    miolo,
  };
}

/** Texto ou variável: os dois únicos nós que saem como trecho inline vestido. */
function ehInline(no: NoDeTexto | NoDoDocumento): boolean {
  return ehTexto(no) || no.type === "variavel";
}

function pedacoInline(no: NoDeTexto | NoDoDocumento): null | PedacoInline {
  return ehTexto(no) ? pedacoDeTexto(no) : pedacoDeVariavel(no);
}

/**
 * Uma sequência de trechos inline vizinhos vira HTML — agrupando o que tem o mesmo estilo (um span
 * só) e, dentro dele, o que tem as mesmas marcas (uma tag só). Ver a nota do topo: é o que faz o
 * HTML de uma minuta antiga sair igual ao gravado, mesmo com a variável virando nó.
 */
function pedacosParaHtml(pedacos: PedacoInline[]): string {
  const saida: string[] = [];
  let i = 0;
  while (i < pedacos.length) {
    const estilo = pedacos[i]!.estilo;
    const dentroDoSpan: string[] = [];
    while (i < pedacos.length && pedacos[i]!.estilo === estilo) {
      const chave = pedacos[i]!.chaveDasMarcas;
      const marcas = pedacos[i]!.marcas;
      const miolos: string[] = [];
      while (i < pedacos.length && pedacos[i]!.estilo === estilo && pedacos[i]!.chaveDasMarcas === chave) {
        miolos.push(pedacos[i]!.miolo);
        i += 1;
      }
      dentroDoSpan.push(vestirMarcas(marcas, miolos.join("")));
    }
    saida.push(comEstilo(estilo, dentroDoSpan.join("")));
  }
  return saida.join("");
}

/** Uma variável sozinha (fora de uma sequência): o mesmo HTML que ela teria no grupo. */
function variavelParaHtml(no: NoDoDocumento): string {
  const pedaco = pedacoDeVariavel(no);
  return pedaco ? pedacosParaHtml([pedaco]) : "";
}

/** Texto de uma variável no texto puro. */
function variavelParaTexto(no: NoDoDocumento): string {
  return `[${no.nome ?? ""}]`;
}

/** `AAAA-MM-DD` vira `DD/MM/AAAA`. ⚠️ Fatiando a string: `new Date("2026-09-02")` é UTC e vira 01/09 no Brasil. */
function dataParaTexto(iso: string | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** O texto puro de uma lista de nós (sem quebras): serve para a legenda da imagem. */
function textoDosNos(nos: unknown): string {
  if (!Array.isArray(nos)) return "";
  return (nos as (NoDeTexto | NoDoDocumento)[]).map(textoDoNo).join("");
}

function textoDoNo(no: NoDeTexto | NoDoDocumento): string {
  // A mesma regra do HTML: o que uma sugestão pendente propõe inserir não existe no contrato.
  if (ehSugestaoDeInsercao(no)) return "";
  if (ehTexto(no)) return no.text;
  const tipo = no.type ?? "";
  if (tipo === "variavel") return variavelParaTexto(no);
  if (tipo === "toc") return "";
  if (tipo === "img") return textoDosNos(no.caption);
  if (tipo === "date") return dataParaTexto(no.date);
  if (tipo === "mention") return `@${no.value ?? ""}`;
  if (tipo === "equation" || tipo === "inline_equation") return no.texExpression ?? no.texMath ?? "";
  if (tipo === "code_drawing") return no.data?.code ?? "";
  // Referência de nota de rodapé no texto puro seria "[1]" — e "[10]" casaria a regex de variável.
  if (tipo === "footnoteReference") return "";
  return (no.children ?? []).map(textoDoNo).join("");
}

/**
 * Contexto de uma conversão: as opções e o que precisa ser sabido ANTES de percorrer (as notas de
 * rodapé são numeradas pela ordem das definições no documento, e a referência pode vir antes).
 */
type Contexto = {
  notas: Map<string, number>;
  resolverMidia: (url: string) => string;
};

function numerarNotas(nos: NoDoDocumento[]): Map<string, number> {
  const notas = new Map<string, number>();
  const percorrer = (no: NoDeTexto | NoDoDocumento) => {
    if (ehTexto(no)) return;
    if (no.type === "footnoteDefinition" && no.identifier && !notas.has(no.identifier)) {
      notas.set(no.identifier, notas.size + 1);
    }
    for (const filho of no.children ?? []) percorrer(filho);
  };
  for (const no of nos) percorrer(no);
  return notas;
}

function numeroDaNota(ctx: Contexto, identifier: string | undefined): string {
  if (!identifier) return "";
  const n = ctx.notas.get(identifier);
  return n ? String(n) : escaparHtml(identifier);
}

/**
 * O `style` do bloco: alinhamento, recuo, entrelinha e fundo.
 *
 * ⚠️ O ALINHAMENTO VEM DE DOIS CAMPOS, e os dois são reais: `align` é o que o editor atual grava
 * (AlignKit, `nodeKey: "align"`, e também o que o Plate grava ao ler HTML); `textAlign` é o que o
 * editor ANTIGO gravava quando o usuário clicava na barra (a chave do plugin de então). Ler só um
 * deles perderia o alinhamento de 75 dos 75 parágrafos da minuta do JDG — que são todos
 * justificados ou centralizados, nenhum no padrão.
 *
 * ⚠️ `align` MANDA quando os dois existem. É o que o editor de hoje lê e grava: se a precedência
 * fosse a do `textAlign`, realinhar no editor uma minuta antiga mudaria a TELA e não o contrato.
 * (A abertura já migra `textAlign` → `align`; a precedência aqui é a segunda trava.)
 */
function estiloDoBloco(no: NoDoDocumento, dentroDeLista: boolean): string {
  const partes: string[] = [];
  const alinhamento = no.align ?? no.textAlign;
  if (alinhamento && alinhamento !== "left") partes.push(`text-align:${alinhamento}`);

  // ⚠️ O RECUO DE LISTA JÁ É DADO PELO `<ul>`/`<ol>`. Repeti-lo aqui somaria os dois e cada nível
  // apareceria duas vezes mais à direita do que devia.
  if (!dentroDeLista && no.indent && no.indent > 0) {
    partes.push(`margin-left:${no.indent * 24}px`);
  }

  if (no.textIndent) partes.push(`text-indent:${no.textIndent * 24}px`);
  if (no.lineHeight) partes.push(`line-height:${no.lineHeight}`);
  // O fundo da célula: na minuta do JDG é o cinza do box de "CIÊNCIA PRÉVIA E ESPECÍFICA".
  if (no.background) partes.push(`background-color:${no.background}`);

  return partes.length ? ` style="${partes.join(";")}"` : "";
}

// ⚠️ TABELA DE CONTRATO TEM BORDA, E ELA NÃO SOBREVIVE À IMPORTAÇÃO. Medido em 01/09/2026: ao ler o
// HTML da minuta do JDG, o Plate devolve a célula com `type`, `children` e `background` — a borda
// que estava no `style` do `<td>` some no caminho, e não há plugin que a traga.
//
// A escolha aqui é EMITIR a borda por padrão, e não guardá-la como dado. O motivo é o documento: o
// quadro-resumo do art. 26-A da Lei 6.766/1979 é uma tabela de 17 linhas que contém o contrato
// inteiro depois do título. Sem borda ele deixa de ser um quadro e vira texto corrido — e ninguém
// percebe até o cartório devolver.
//
// Erra-se para o lado visível: uma borda a mais alguém enxerga e pede para tirar; uma borda a menos
// descaracteriza o documento em silêncio. Quando a célula trouxer `borders` do editor, ela manda.
const BORDA_PADRAO = "1px solid #000000";

function bordaDaCelula(no: NoDoDocumento): string {
  const borders = (no as { borders?: { bottom?: unknown; left?: unknown } }).borders;
  // O editor guardou bordas próprias: respeita o que ele disse, inclusive "sem borda".
  if (borders) return "";
  return `border:${BORDA_PADRAO}`;
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
  // O toggle é um título de trecho recolhível NA TELA. No papel não há o que recolher: sai como
  // parágrafo, e os blocos "dentro" dele já vêm como blocos seguintes com `indent`.
  toggle: "p",
};

/** Largura da imagem: número é px; string vai como está ("50%"). */
function larguraDaMidia(width: number | string | undefined): string {
  if (typeof width === "number" && width > 0) return `;width:${width}px`;
  if (typeof width === "string" && width) return `;width:${width}`;
  return "";
}

/** A linha de código de um `code_block`: só texto, escapado, sem quebrar em `<p>`. */
function linhaDeCodigo(no: NoDeTexto | NoDoDocumento): string {
  if (ehTexto(no)) return escaparHtml(no.text);
  return (no.children ?? []).map(linhaDeCodigo).join("");
}

function blocoParaHtml(ctx: Contexto, no: NoDoDocumento, dentroDeLista = false): string {
  const tipo = no.type ?? "p";

  if (tipo === "hr") return "<hr />";

  // ── Inline: variável, link, menção, data, fórmula, nota ───────────────────
  if (tipo === "variavel") return variavelParaHtml(no);
  if (tipo === "a") {
    const href = no.url ? escaparHtml(no.url) : "";
    return `<a href="${href}">${filhosParaHtml(ctx, no)}</a>`;
  }
  if (tipo === "mention") return escaparHtml(`@${no.value ?? ""}`);
  if (tipo === "date") return `<span>${escaparHtml(dataParaTexto(no.date))}</span>`;
  // Sem KaTeX: renderizar a fórmula exigiria CSS e fontes no destino do contrato. Sai o TeX.
  if (tipo === "inline_equation") return `<code>${escaparHtml(no.texExpression ?? no.texMath ?? "")}</code>`;
  if (tipo === "footnoteReference") return `<sup>${numeroDaNota(ctx, no.identifier)}</sup>`;

  // ── Tabela ────────────────────────────────────────────────────────────────
  if (tipo === "table") {
    // `border-collapse` para as bordas das células não saírem duplicadas na impressão.
    return `<table style="border-collapse:collapse;${bordaDaCelula(no)}">${filhosParaHtml(ctx, no)}</table>`;
  }
  if (tipo === "tr") return `<tr>${filhosParaHtml(ctx, no)}</tr>`;
  if (tipo === "td" || tipo === "th") {
    const estilo = estiloDoBloco(no, false).replace(/^ style="|"$/g, "");
    const borda = bordaDaCelula(no);
    const juntos = [borda, estilo].filter(Boolean).join(";");
    // ⚠️ colSpan e rowSpan viajam: célula mesclada perdida desmonta a tabela inteira, e o
    // quadro-resumo do contrato é feito delas.
    const span =
      (no.colSpan && no.colSpan > 1 ? ` colspan="${no.colSpan}"` : "") +
      (no.rowSpan && no.rowSpan > 1 ? ` rowspan="${no.rowSpan}"` : "");
    return `<${tipo}${span}${juntos ? ` style="${juntos}"` : ""}>${filhosParaHtml(ctx, no)}</${tipo}>`;
  }

  // ── Colunas: tabela SEM borda ─────────────────────────────────────────────
  // ⚠️ NÃO PASSA PELA REGRA DE `td`, que injeta a borda padrão: coluna é diagramação, não quadro.
  if (tipo === "column_group") {
    const colunas = (no.children ?? [])
      .filter((filho): filho is NoDoDocumento => !ehTexto(filho))
      .map((coluna) => {
        const largura = typeof coluna.width === "number" ? `${coluna.width}px` : coluna.width;
        const estiloLargura = largura ? `;width:${largura}` : "";
        return `<td style="vertical-align:top;border:none;padding:0 8px${estiloLargura}">${filhosParaHtml(ctx, coluna)}</td>`;
      })
      .join("");
    return `<table style="width:100%;border-collapse:collapse;border:none"><tr>${colunas}</tr></table>`;
  }
  // Uma `column` fora do grupo (não deveria acontecer): os filhos saem soltos, nada some.
  if (tipo === "column") return filhosParaHtml(ctx, no);

  // ── Callout ───────────────────────────────────────────────────────────────
  if (tipo === "callout") {
    const fundo = no.backgroundColor || "#f5f5f5";
    const icone = no.icon ? `${escaparHtml(no.icon)} ` : "";
    return `<div style="margin:8px 0;padding:8px 12px;border-left:4px solid #999;background:${fundo}">${icone}${filhosParaHtml(ctx, no)}</div>`;
  }

  // ── Sumário: é da tela, não do contrato ───────────────────────────────────
  if (tipo === "toc") return "";
  // Upload em andamento que ficou gravado: não tem conteúdo, não vira nada.
  if (tipo === "placeholder") return "";

  // ── Código e diagrama por código ──────────────────────────────────────────
  if (tipo === "code_block") {
    const linhas = (no.children ?? []).map(linhaDeCodigo).join("\n");
    const lang = no.lang ? ` data-lang="${escaparHtml(no.lang)}"` : "";
    return `<pre style="font-family:monospace;white-space:pre-wrap;font-size:0.9em"${lang}>${linhas}</pre>`;
  }
  if (tipo === "code_line") return linhaDeCodigo(no);
  if (tipo === "code_drawing") {
    const motor = no.data?.drawingType ? ` data-drawing="${escaparHtml(no.data.drawingType)}"` : "";
    return `<pre style="font-family:monospace;white-space:pre-wrap;font-size:0.9em"${motor}>${escaparHtml(no.data?.code ?? "")}</pre>`;
  }

  // ── Fórmula em bloco ──────────────────────────────────────────────────────
  if (tipo === "equation") {
    return `<p style="text-align:center"><code>${escaparHtml(no.texExpression ?? no.texMath ?? "")}</code></p>`;
  }

  // ── Mídia ─────────────────────────────────────────────────────────────────
  if (tipo === "img") {
    const src = escaparHtml(ctx.resolverMidia(no.url ?? ""));
    const legenda = textoDosNos(no.caption);
    const alinhamento = no.align ?? "center";
    const figcaption = legenda
      ? `<figcaption style="font-size:0.9em;color:#555">${escaparHtml(legenda)}</figcaption>`
      : "";
    return `<figure style="margin:8px 0;text-align:${alinhamento}"><img src="${src}" alt="${escaparHtml(legenda)}" style="max-width:100%${larguraDaMidia(no.width)}" />${figcaption}</figure>`;
  }
  if (tipo === "video" || tipo === "audio" || tipo === "file" || tipo === "media_embed") {
    // Contrato é papel: o que se imprime é o link, com o nome do arquivo quando houver.
    const url = ctx.resolverMidia(no.url ?? "");
    const rotulo = tipo !== "media_embed" && no.name ? no.name : url;
    return `<p><a href="${escaparHtml(url)}">${escaparHtml(rotulo)}</a></p>`;
  }

  // ── Nota de rodapé (definição) ────────────────────────────────────────────
  if (tipo === "footnoteDefinition") {
    return `<p style="font-size:0.85em"><sup>${numeroDaNota(ctx, no.identifier)}</sup> ${filhosParaHtml(ctx, no)}</p>`;
  }

  // ⚠️ TIPO DESCONHECIDO VIRA PARÁGRAFO. Ver a nota do topo: perder o estilo é aceitável; perder o
  // parágrafo do contrato não é.
  const tag = TAG_DO_BLOCO[tipo] ?? "p";
  const conteudo = filhosParaHtml(ctx, no);

  // Parágrafo vazio existe no contrato — é o espaço entre cláusulas. Vira `<p><br /></p>` para não
  // colapsar na renderização.
  const corpo = conteudo === "" ? "<br />" : conteudo;

  // ⚠️ O `<li>` SAI ABERTO DE PROPÓSITO. Quem fecha é `sequenciaParaHtml`, porque um item que tem
  // sublista só fecha DEPOIS dela — é o que mantém o HTML válido.
  if (dentroDeLista) return `<li${estiloDoBloco(no, true)}>${corpo}`;
  return `<${tag}${estiloDoBloco(no, false)}>${corpo}</${tag}>`;
}

/**
 * Os filhos de um nó. Texto vira texto; bloco vira bloco — e uma sequência de blocos passa pela
 * reconstrução de listas, para uma lista dentro de célula, coluna ou callout sair como `<ul>`
 * também, e não como parágrafos soltos.
 */
function filhosParaHtml(ctx: Contexto, no: NoDoDocumento): string {
  return sequenciaParaHtml(ctx, no.children ?? []);
}

/** "disc"/"circle"/"square" saem em `<ul>`; o resto ("decimal", "lower-alpha"…) em `<ol>`. */
function tagDaLista(estilo: string): "ol" | "ul" {
  return ["circle", "disc", "square"].includes(estilo) ? "ul" : "ol";
}

/**
 * Converte uma sequência de nós (a raiz do documento ou os filhos de um bloco) em HTML.
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
function sequenciaParaHtml(ctx: Contexto, nos: (NoDeTexto | NoDoDocumento)[]): string {
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

  for (let i = 0; i < nos.length; i++) {
    const no = nos[i]!;

    if (ehTexto(no) || no.type === "variavel") {
      // Texto e variável vizinhos formam UM grupo: o span de estilo (e a marca igual) envolve o
      // grupo inteiro — ver a nota do topo. O grupo termina no primeiro nó que não é inline.
      let fim = i;
      while (fim + 1 < nos.length && ehInline(nos[fim + 1]!)) fim += 1;
      const pedacos = nos
        .slice(i, fim + 1)
        .map(pedacoInline)
        .filter((pedaco): pedaco is PedacoInline => pedaco !== null);
      fecharAte(0);
      saida.push(pedacosParaHtml(pedacos));
      i = fim;
      continue;
    }

    // Bloco proposto por sugestão ainda não aceita: não existe no contrato (nota do topo). Pulado
    // AQUI, antes da lógica de lista, para um item sugerido não abrir um `<ul>` vazio.
    if (ehSugestaoDeInsercao(no)) continue;

    const estilo = no.listStyleType;

    if (!estilo) {
      fecharAte(0);
      saida.push(blocoParaHtml(ctx, no));
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

    saida.push(blocoParaHtml(ctx, no, true));
    abertas[abertas.length - 1]!.itemAberto = true;
  }

  fecharAte(0);
  return saida.join("");
}

/**
 * Converte o documento do editor em HTML — o `conteudo_html` da minuta.
 *
 * `opcoes.resolverMidia` troca a URL de cada mídia na hora de gerar (padrão: identidade). É a
 * porta para o gerador de contrato re-assinar a URL do bucket sem mexer no documento gravado.
 */
export function documentoParaHtml(nos: NoDoDocumento[], opcoes: OpcoesDeHtml = {}): string {
  const ctx: Contexto = {
    notas: numerarNotas(nos),
    resolverMidia: opcoes.resolverMidia ?? ((url) => url),
  };
  return sequenciaParaHtml(ctx, nos);
}

/**
 * O texto puro do documento, para contar caracteres e procurar variáveis sem passar pelo HTML.
 *
 * ⚠️ SEPARA OS BLOCOS COM QUEBRA DE LINHA. Sem isso, o fim de um parágrafo grudaria no começo do
 * seguinte e criaria palavras que não existem no contrato — inclusive variáveis falsas.
 *
 * A variável sai como `[nome]`, igual ao HTML: é o que `variaveisDoTexto` lê.
 */
export function documentoParaTexto(nos: NoDoDocumento[]): string {
  return nos.map(textoDoNo).join("\n");
}

/**
 * Há sugestão de revisão aberta no documento?
 *
 * O editor em modo "sugerir" grava a mudança como marca (`suggestion` no texto ou no bloco) em vez
 * de aplicá-la. O contrato sai com o texto ORIGINAL — a sugestão não é conteúdo (o `insert` é
 * pulado, o `remove` sai). Esta função existe para a tela avisar E travar o Publicar enquanto
 * houver sugestão em aberto: um contrato não pode nascer de um texto que ainda está em revisão.
 */
export function temSugestoesPendentes(nos: NoDoDocumento[]): boolean {
  const temMarca = (no: NoDeTexto | NoDoDocumento): boolean => {
    if (no.suggestion) return true;
    // `suggestion_<id>` é a marca com os dados (autor, tipo, data). Uma minuta salva no meio de
    // uma revisão pode ter só ela.
    return Object.keys(no).some((chave) => chave.startsWith("suggestion_"));
  };

  const percorrer = (no: NoDeTexto | NoDoDocumento): boolean => {
    if (temMarca(no)) return true;
    if (ehTexto(no)) return false;
    return (no.children ?? []).some(percorrer);
  };

  return nos.some(percorrer);
}

export type MidiaDoDocumento = {
  /** O nome do arquivo, quando o nó trouxer. */
  nome?: string;
  tipo: "audio" | "file" | "img" | "media_embed" | "video";
  url: string;
};

const TIPOS_DE_MIDIA: MidiaDoDocumento["tipo"][] = ["audio", "file", "img", "media_embed", "video"];

/**
 * As mídias do documento, na ordem em que aparecem — para a tela listar e re-assinar as URLs.
 *
 * Só entra o que tem `url`: um upload que ficou pela metade (`placeholder`) não é mídia.
 */
export function midiasDoDocumento(nos: NoDoDocumento[]): MidiaDoDocumento[] {
  const midias: MidiaDoDocumento[] = [];

  const percorrer = (no: NoDeTexto | NoDoDocumento) => {
    if (ehTexto(no)) return;
    const tipo = no.type as MidiaDoDocumento["tipo"] | undefined;
    if (tipo && TIPOS_DE_MIDIA.includes(tipo) && no.url) {
      midias.push(no.name ? { nome: no.name, tipo, url: no.url } : { tipo, url: no.url });
    }
    for (const filho of no.children ?? []) percorrer(filho);
  };

  for (const no of nos) percorrer(no);
  return midias;
}

/**
 * O documento com a `url` de cada mídia trocada por `trocar(url)` — sem mexer no original.
 *
 * ⚠️ A URL GRAVADA NO NÓ É VOLÁTIL: é uma signed URL do bucket privado, com prazo (7 dias). A chave
 * duradoura é o `path` do objeto, recuperável da própria URL (`caminhoDaUrlAssinada` em
 * `upload-midia.ts`). A tela usa isto ao abrir a minuta, trocando cada URL por uma re-assinada
 * pela rota autenticada; `trocar` devolve `null` para deixar a URL como está (falhou re-assinar,
 * ou a URL não é do bucket).
 */
export function trocarUrlsDeMidia(
  nos: NoDoDocumento[],
  trocar: (url: string) => null | string | undefined,
): NoDoDocumento[] {
  const percorrer = (no: NoDeTexto | NoDoDocumento): NoDeTexto | NoDoDocumento => {
    if (ehTexto(no)) return no;
    // Quem não mudou volta como o MESMO objeto: o React (e o `key` do editor) não veem troca.
    const filhos = no.children?.map(percorrer);
    const mudouFilho = !!filhos && filhos.some((filho, i) => filho !== no.children![i]);
    let copia: NoDoDocumento = mudouFilho ? { ...no, children: filhos } : no;
    const tipo = no.type as MidiaDoDocumento["tipo"] | undefined;
    if (tipo && TIPOS_DE_MIDIA.includes(tipo) && no.url) {
      const nova = trocar(no.url);
      if (nova && nova !== no.url) copia = { ...copia, url: nova };
    }
    return copia;
  };

  return nos.map((no) => percorrer(no) as NoDoDocumento);
}

/** Um documento vazio válido para o editor abrir. */
export function documentoVazio(): NoDoDocumento[] {
  return [{ children: [{ text: "" }], type: "p" }];
}
