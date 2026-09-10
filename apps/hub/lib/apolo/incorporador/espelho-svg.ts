// SEPARAR O MASTERPLAN EM DUAS PEÇAS: a arte e a geometria.
//
// ⚠️ ISTO EXISTE POR CAUSA DO PESO, e o número é brutal. Medido nos oito masterplans publicados em
// `hercules_masterplans` (02/09/2026): o Veredas do Ouro tem 24,9 MB, o Vale do Ouro 24,1 MB, o
// Jardim das Gerais 19,8 MB. Mandar isso para o navegador de um corretor no celular, a cada
// abertura do link, é impraticável.
//
// ⚠️ MAS QUASE TUDO É A FOTO. No Garden, o menor deles: 2,77 MB no total, dos quais 2,70 MB são UM
// `<image>` com a arte em base64. Os 405 contornos de lote pesam **80 KB**. Separadas, as duas
// peças viajam bem:
//
//     a arte        imagem binária, `immutable` na CDN — o navegador baixa UMA vez
//     a geometria   JSON de ~80 KB, com a situação de cada lote por cima
//
// É a mesma divisão que o telão do Prometeu já usa (`lib/prometeu/desenho-do-masterplan.ts`:
// `base` + `contornos`), com uma diferença: lá alguém preparou os dois arquivos à mão, para dois
// lançamentos. Aqui os oito saem do próprio SVG, sem trabalho manual.
//
// ⚠️ O NOME DO LOTE VEM DE `inkscape:label`, E NÃO DE `id`. É a mesma regra do masterplan do C2X
// ([[reference_c2x_masterplan_inkscape_label]]): o `id` do Inkscape é gerado e muda ao duplicar, o
// `label` é o que o projetista escreveu. Medido no Garden: 407 labels, no formato `GDN0101`, que é
// exatamente o `codigo` de `hercules_unidades`.

/** Um lote recortado do SVG: o nome que casa com a unidade e o contorno. */
export type ContornoDoLote = {
  /** `GDN0101` — o mesmo `codigo` de `hercules_unidades`. */
  codigo: string;
  /** O `d` do path, nas coordenadas do viewBox original. */
  d: string;
};

export type EspelhoSeparado = {
  /** A arte de fundo, já decodificada. `null` quando o SVG não traz imagem embutida. */
  arte: null | { bytes: Uint8Array; mime: string };
  /** Um contorno por lote, na ordem em que aparecem no arquivo. */
  contornos: ContornoDoLote[];
  /** O viewBox do arquivo — os contornos estão nessas coordenadas. */
  viewBox: string;
};

/** `<path … inkscape:label="GDN0101" … d="M …" />`, em qualquer ordem de atributos. */
const PATH = /<path\b[^>]*>/g;
const ATRIBUTO = (nome: string) => new RegExp(`\\b${nome}\\s*=\\s*"([^"]*)"`);
const LABEL = ATRIBUTO("inkscape:label");
const ID = ATRIBUTO("id");
const D = ATRIBUTO("d");

/**
 * A foto embutida, extraída por varredura linear.
 *
 * ⚠️ NADA DE REGEX AQUI. `data:image\/([a-z+]+);base64,([A-Za-z0-9+/=\s]+)` sobre um SVG de 23 MB
 * estoura a pilha do Node por backtracking ("Maximum call stack size exceeded") — medido nos oito
 * masterplans. `indexOf` é linear e não guarda estado.
 *
 * ⚠️ E O BASE64 VEM SUJO DE ENTIDADE XML. Em cinco dos oito arquivos as quebras de linha do base64
 * foram gravadas como `&#10;` / `&#13;` em vez do caractere: no Vale do Ouro são 296.655
 * ocorrências. Filtrar só "o que não é espaço" mantém os DÍGITOS da entidade e injeta um "10" a
 * cada quebra — o PNG chega deslocado e o decodificador morre com "unknown critical chunk". As
 * entidades têm de ser resolvidas ANTES.
 */
function extrairFoto(svg: string): null | { base64: string } {
  const marca = svg.indexOf("base64,");
  if (marca < 0) return null;

  const inicio = marca + 7;
  let fim = inicio;
  while (fim < svg.length && svg[fim] !== '"' && svg[fim] !== "'" && svg[fim] !== "<") fim += 1;

  // `&#10;` → o caractere; depois sobra só espaço, que sai no filtro do alfabeto.
  const semEntidade = svg
    .slice(inicio, fim)
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n: string) => String.fromCharCode(parseInt(n, 16)));

  let base64 = "";
  for (const ch of semEntidade) if (ALFABETO_B64.test(ch)) base64 += ch;
  return base64 ? { base64 } : null;
}

const ALFABETO_B64 = /[A-Za-z0-9+/=]/;

/**
 * O tipo REAL da foto, pela assinatura dos primeiros bytes.
 *
 * ⚠️ O `data:image/...` DO ARQUIVO MENTE. Medido: o Garden declara `image/png` e é JPEG; o Veredas
 * do Ouro declara `image/png` e é WebP. Servir com o MIME errado faz o navegador recusar a imagem,
 * e o mapa abre sem fundo — com os contornos flutuando no vazio.
 */
function mimeReal(bytes: Uint8Array): string {
  const b = bytes;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return "image/webp";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  return "application/octet-stream";
}

/**
 * Separa o SVG do masterplan na arte e nos contornos.
 *
 * `codigosValidos` é o conjunto de `hercules_unidades.codigo` daquele empreendimento.
 *
 * ⚠️ QUEM DECIDE O QUE É LOTE É O CADASTRO, E NÃO UMA REGEX DE FORMATO. A primeira versão daqui
 * adivinhava por `/^[A-Za-z]{2,4}\d{3,6}$/` e devolveu ZERO contornos no Villa Paris, no Vista
 * Alegre e metade no Recanto do Pará: os códigos deles têm LETRA no meio — `RVPA01`, `VALA01`,
 * `REPA01` — e não os quatro dígitos do `GDN0101`. É a mesma armadilha do masterplan do C2X
 * ([[reference_c2x_unidade_name_casa_masterplan]]: "RVP usa letra").
 *
 * ⚠️ E O FILTRO PRECISA EXISTIR, porque nem todo `<path>` é lote: o arquivo do projetista traz
 * ruas, praças, a moldura e a legenda. Pintar uma praça de verde faria ela virar lote disponível
 * no mapa do corretor. Comparar com o cadastro resolve os dois lados de uma vez — o que é lote
 * entra, o que não é fica de fora, sem palpite sobre formato.
 *
 * ⚠️ SEM PARSER DE XML, DE PROPÓSITO. Um DOM sobre 25 MB custa memória e tempo numa função
 * serverless, e o que se quer daqui são dois atributos por `<path>` e um `data:` do `<image>`.
 * A varredura por regex é linear e não guarda o documento inteiro em árvore.
 */
export function separarEspelho(svg: string, codigosValidos: Set<string>): EspelhoSeparado {
  const contornos: ContornoDoLote[] = [];
  const vistos = new Set<string>();

  for (const [tag] of svg.matchAll(PATH)) {
    const d = tag.match(D)?.[1];
    if (!d) continue;

    // ⚠️ O LABEL MANDA, e o `id` só desempata. No Vista Alegre os paths têm `id="path1"` e o
    // código vive só no `inkscape:label` — lendo o id, nenhum lote seria encontrado.
    const bruto = (tag.match(LABEL)?.[1] ?? tag.match(ID)?.[1] ?? "").trim().toUpperCase();
    if (!bruto || !codigosValidos.has(bruto)) continue;

    const codigo = bruto;
    // ⚠️ O PRIMEIRO GANHA. Duplicar um lote no Inkscape COPIA o label do vizinho
    // ([[reference_masterplan_jdg_absorver_svg]]), e nesse caso o segundo path é o intruso.
    if (vistos.has(codigo)) continue;
    vistos.add(codigo);
    contornos.push({ codigo, d });
  }

  const foto = extrairFoto(svg);
  let arte: EspelhoSeparado["arte"] = null;
  if (foto) {
    const bytes = Uint8Array.from(Buffer.from(foto.base64, "base64"));
    arte = { bytes, mime: mimeReal(bytes) };
  }

  return {
    arte,
    contornos,
    // Sem viewBox o desenho não tem escala; o fallback é o tamanho que o Inkscape costuma gravar.
    viewBox: svg.match(/viewBox\s*=\s*"([^"]*)"/)?.[1]?.trim() || "0 0 2396 2160",
  };
}

/**
 * Só a geometria, para a resposta que o navegador recebe.
 *
 * ⚠️ A ARTE NÃO VIAJA JUNTO. É o ponto do arquivo: o JSON tem ~80 KB e muda quando a situação dos
 * lotes muda; a imagem tem megabytes e não muda nunca. Juntá-los faria o navegador rebaixar a foto
 * inteira toda vez que um lote fosse vendido.
 */
export function mapaDoEspelho(separado: EspelhoSeparado): {
  contornos: ContornoDoLote[];
  viewBox: string;
} {
  return { contornos: separado.contornos, viewBox: separado.viewBox };
}
