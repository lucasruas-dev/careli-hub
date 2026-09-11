// O CONTRATO ALTERADO À MÃO — as regras, sem banco e sem tela, para caber em teste.
//
// Lucas (10/09/2026): *"quando eu clicar no abrir contrato, esse contrato tem que me permitir fazer
// alteração manual, salvar, fechar contrato"*.
//
// ── POR QUE ISTO EXISTE, SE A MINUTA JÁ MONTA O CONTRATO ────────────────────
//
// Porque contrato de caso concreto tem exceção: a cláusula que este comprador negociou, o parágrafo
// que o jurídico reescreve para uma venda com dois titulares, o dado que o cadastro não tem e que
// alguém confirmou por telefone. A minuta é o texto de TODAS as vendas; a exceção é desta. Sem um
// lugar para a exceção, ela acontece de qualquer jeito — no Word, fora do sistema, e o papel que vai
// para assinatura deixa de ser o papel que o sistema conhece.
//
// ⚠️ ISTO INVERTE UMA DECISÃO ESCRITA, E DE PROPÓSITO. `gerar/route.ts` dizia que aceitar HTML de
// quem chama seria "deixar o navegador ditar o conteúdo do papel que vai a cartório". A frase
// continua verdadeira para um HTML anônimo vindo de qualquer chamador — e é por isso que o texto
// editado NÃO viaja no pedido de gerar. Ele é gravado antes, numa linha com dono, hora e a
// impressão do texto que serviu de base, e a geração vai buscá-lo lá. O que muda não é a confiança
// no navegador: é que passa a existir um registro de quem alterou o quê.
//
// ── AS TRÊS REGRAS DAQUI ────────────────────────────────────────────────────
//
// 1. O que volta do navegador é FAXINADO antes de ser gravado (`sanitizarHtmlDoContrato`).
// 2. A base é IMPRESSA (`impressaoDaBase`) para a tela saber quando o cadastro mudou depois da
//    edição — senão a alteração manual envelhece calada, e o papel sai com o dado velho.
// 3. A trava de variável em branco passa a medir o TEXTO FINAL, e não a montagem
//    (`variaveisAindaEmBranco`) — quem preencheu à mão preencheu.

import { createHash } from "node:crypto";

// ── 1. FAXINA ───────────────────────────────────────────────────────────────

/**
 * As tags que um contrato tem. Sai desta lista, sai do documento.
 *
 * ⚠️ A LISTA É A DO NOSSO SERIALIZADOR (`documento-html.ts`), e não uma lista genérica de HTML
 * "seguro": o que o motor não sabe imprimir não deveria aparecer num contrato nem quando é
 * inofensivo. `input`, `button` e `form` não estão aqui porque contrato não tem campo de
 * formulário — e um `<input>` sobrevivente vira uma caixa vazia no PDF.
 */
const TAGS_PERMITIDAS = new Set([
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "div",
  "em",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "s",
  "span",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
]);

/**
 * Tags cujo CONTEÚDO também some, e não só a marcação.
 *
 * ⚠️ A DIFERENÇA IMPORTA. Numa tag desconhecida qualquer o texto de dentro é texto do contrato e
 * precisa sobreviver — some a marcação, fica a frase. Já o miolo de um `<script>` é código, e
 * "desembrulhar" um script escreveria o código como parágrafo no meio do contrato.
 */
const TAGS_COM_MIOLO = ["script", "style", "iframe", "object", "embed", "noscript", "template"];

/** O que cada tag pode carregar. Tudo o mais é descartado, `on*` incluído. */
const ATRIBUTOS_PERMITIDOS = new Set([
  "align",
  "alt",
  "colspan",
  "dir",
  "height",
  "href",
  "rowspan",
  "span",
  "src",
  "start",
  "style",
  "title",
  "type",
  "valign",
  "width",
]);

/** Tag que não fecha — sai sempre como `<br />`, nunca como `<br></br>`. */
const TAGS_VAZIAS = new Set(["br", "hr", "img"]);

/**
 * ⚠️ A REGEX DA TAG RESPEITA ASPAS, e isso não é preciosismo: `style="width:>50%"` tem um `>` no
 * meio do atributo, e um `/<[^>]*>/` cortaria a tag ali, deixando `50%">` como texto visível no
 * corpo do contrato.
 */
const TAG = /<\/?([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)\/?>/g;
const ATRIBUTO = /([a-zA-Z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

export type FaxinaDoContrato = {
  html: string;
  /** O que foi retirado, em português, para a tela poder dizer. Vazio = nada mexeu. */
  removeu: string[];
};

/**
 * O HTML que voltou do editor, pronto para virar papel.
 *
 * ⚠️ ISTO NÃO É UM PARSER DE HTML, e não precisa ser. O texto vem do `contenteditable` do próprio
 * navegador de quem está logado com direito de emitir contrato — a faxina é a segunda camada, não a
 * primeira. Ela existe para o caso de alguém colar um trecho de página da internet dentro do
 * contrato (que é o gesto comum, não o ataque): junto com o parágrafo vêm scripts, rastreadores e
 * um `onerror=` numa imagem quebrada, e nada disso pode ir para o Chromium que gera o PDF.
 */
export function sanitizarHtmlDoContrato(entrada: string): FaxinaDoContrato {
  const removeu: string[] = [];
  let html = String(entrada ?? "");

  // Comentário some inteiro: é onde se esconde marcação colada de fora.
  if (html.includes("<!--")) {
    html = html.replace(/<!--[\s\S]*?-->/g, "");
    removeu.push("comentários de HTML");
  }

  for (const tag of TAGS_COM_MIOLO) {
    const comMiolo = new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}\\s*>`, "gi");
    const soltas = new RegExp(`</?${tag}\\b[^>]*>`, "gi");
    if (comMiolo.test(html) || soltas.test(html)) {
      html = html.replace(comMiolo, "").replace(soltas, "");
      removeu.push(`trechos <${tag}>`);
    }
  }

  const desconhecidas = new Set<string>();
  let tirouAtributo = false;

  html = html.replace(TAG, (inteira, nomeCru: string, atributosCrus: string) => {
    const nome = nomeCru.toLowerCase();
    if (!TAGS_PERMITIDAS.has(nome)) {
      desconhecidas.add(nome);
      // Desembrulha: a marcação sai, o texto de dentro fica. Ver a nota de TAGS_COM_MIOLO.
      return "";
    }

    if (inteira.startsWith("</")) return `</${nome}>`;

    const limpos: string[] = [];
    for (const achado of String(atributosCrus ?? "").matchAll(ATRIBUTO)) {
      const chave = (achado[1] ?? "").toLowerCase();
      const valor = achado[3] ?? achado[4] ?? achado[5] ?? "";
      if (!ATRIBUTOS_PERMITIDOS.has(chave)) {
        tirouAtributo = true;
        continue;
      }
      if ((chave === "href" || chave === "src") && !enderecoAceito(valor)) {
        tirouAtributo = true;
        continue;
      }
      // ⚠️ `expression()` e `url(javascript:…)` são CSS que EXECUTA em motores antigos. O Chromium
      // do PDF ignora, mas a mesma folha é mostrada na tela do operador.
      if (chave === "style" && /expression\s*\(|javascript:/i.test(valor)) {
        tirouAtributo = true;
        continue;
      }
      limpos.push(`${chave}="${valor.replace(/"/g, "&quot;")}"`);
    }

    const corpo = limpos.length > 0 ? ` ${limpos.join(" ")}` : "";
    return TAGS_VAZIAS.has(nome) ? `<${nome}${corpo} />` : `<${nome}${corpo}>`;
  });

  if (desconhecidas.size > 0) {
    removeu.push(`marcação fora do documento (${[...desconhecidas].sort().join(", ")})`);
  }
  if (tirouAtributo) removeu.push("atributos que não pertencem a um contrato");

  return { html, removeu };
}

/**
 * Endereço que pode ficar num `href`/`src`.
 *
 * ⚠️ `data:` SÓ PARA IMAGEM. As figuras da minuta chegam embutidas; `data:text/html` é uma página
 * inteira disfarçada de endereço.
 */
function enderecoAceito(valor: string): boolean {
  const limpo = valor.trim().toLowerCase();
  if (limpo === "") return false;
  if (limpo.startsWith("data:")) return limpo.startsWith("data:image/");
  if (/^[a-z][\w+.-]*:/.test(limpo)) return limpo.startsWith("http://") || limpo.startsWith("https://");
  // Sem esquema: caminho relativo ou âncora — não sai do nosso domínio.
  return !limpo.startsWith("//");
}

// ── 2. A IMPRESSÃO DA BASE ──────────────────────────────────────────────────

/**
 * A impressão digital do contrato montado pela minuta, no instante em que a edição começou.
 *
 * ⚠️ É O QUE IMPEDE A ALTERAÇÃO MANUAL DE ENVELHECER CALADA. O texto editado é uma FOTO: se depois
 * dela alguém corrigir o CPF no cadastro do Apolo, trocar a minuta ou mudar o valor da proposta, o
 * rascunho continua com o dado antigo — e o contrato sai errado sem ninguém ter feito nada errado.
 * Guardando a impressão da base, a tela compara e avisa: "o cadastro mudou depois da sua edição".
 *
 * ⚠️ SHA-256 DO TEXTO, e não uma comparação do texto inteiro: o contrato tem 27 páginas, e guardar
 * duas cópias de cada versão para poder comparar dobra a linha à toa.
 */
export function impressaoDaBase(html: string): string {
  return createHash("sha256").update(String(html ?? ""), "utf8").digest("hex");
}

/** A base de hoje é a mesma sobre a qual a pessoa editou? */
export function baseMudou(edicao: { baseImpressao: null | string }, htmlDeHoje: string): boolean {
  if (!edicao.baseImpressao) return false;
  return edicao.baseImpressao !== impressaoDaBase(htmlDeHoje);
}

// ── 3. A TRAVA, MEDIDA NO TEXTO FINAL ───────────────────────────────────────

/**
 * Das variáveis que o motor não soube preencher, quais AINDA aparecem em branco no papel.
 *
 * ⚠️ A TRAVA MUDA DE LUGAR, E NÃO DE RÉGUA. `podeGerarContrato` recusa o contrato com variável sem
 * valor porque o arquivo cai numa gaveta com selo de "gerado pelo sistema" (ver `contrato-guardado
 * .ts`) — isso continua valendo. O que muda é ONDE se mede: antes, na montagem; agora, no texto que
 * vai virar PDF. Quem digitou o CPF por cima do `[cpf_cliente]` preencheu o contrato, e recusar
 * mesmo assim obrigaria a pessoa a ir consertar o cadastro para poder imprimir um papel que já está
 * correto.
 *
 * ⚠️ E A LISTA VEM DO MOTOR, NÃO DE UMA REGEX SOLTA. Procurar `\[algo\]` no corpo acusaria "[sic]",
 * "[assinatura]" e qualquer colchete que o jurídico escreveu de propósito. Aqui só se pergunta,
 * de cada variável que o motor JÁ declarou vazia, se o buraco continua lá.
 */
export function variaveisAindaEmBranco(html: string, semValor: readonly string[]): string[] {
  const texto = String(html ?? "");
  return semValor.filter((nome) => texto.includes(`[${nome}]`));
}
