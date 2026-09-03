import {
  createSlatePlugin,
  type Descendant,
  ElementApi,
  PathApi,
  type Path,
  type Point,
  type TElement,
  type TText,
} from "platejs";

import {
  ORDEM_DOS_GRUPOS,
  rotuloDoGrupo,
  VARIAVEIS_DO_CONTRATO,
  type VariavelDoContrato,
} from "@/lib/temis/variaveis";

// A VARIÁVEL É UM NÓ, NÃO TEXTO — a parte SEM React do plugin (a rota de IA e os testes importam daqui).
//
// Pedido do Lucas (02/09/2026): *"não temos todas essas ferramentas, revise as documentações pois
// quero isso completo, estamos muito simples"* — e, sobre a origem dos dados: *"não quero nada do
// c2x, todas as variáveis tem que nascer do panteon, esquece c2x como consulta"*.
//
// POR QUE UM NÓ PRÓPRIO, e não `[nome_cliente]` digitado como texto:
//
// 1. ⚠️ O NEGRITO PARTIA A VARIÁVEL NO MEIO. Em 01/09/2026 o primeiro contrato de teste do JDG saiu
//    com `[nome_cliente]` impresso porque o HTML tinha `[nome_cl</strong>iente]` — a marca aplicada
//    dentro do nome. Como nó void inline, a variável é ATÔMICA: seleciona-se e apaga-se inteira, e
//    nenhuma marca entra no meio dela.
// 2. A IA, o autoformat, o slash e o colar não conseguem reescrever o nome por dentro. O que chega
//    de fora como texto `[nome]` (colar, .docx, markdown da IA) vira nó pelo `normalizeNode` abaixo.
// 3. Na tela ela é um chip com rótulo e origem no hover — o jurídico vê "Nome do comprador · Cadastro
//    (Apolo)" em vez de adivinhar o que `[nome_cliente]` preenche.
// 4. Para tudo que já audita texto (serializador, `variaveisDoTexto`, `conferirBlocos`, rota de
//    salvar/publicar), o nó volta a ser `[nome]`. Nada muda do lado de fora.

export const VARIAVEL_KEY = "variavel" as const;

/** Contrato C0.1 do plano: `{ type: "variavel", nome, children: [{ text: "" }] }` — inline e void. */
export type TVariavelElement = TElement & {
  nome: string;
  type: typeof VARIAVEL_KEY;
};

/**
 * A regex canônica de variável.
 *
 * ⚠️ É A MESMA de `lib/temis/variaveis.ts` (`variaveisDoTexto`). Se uma aceitar o que a outra
 * recusa, a tela conta uma variável que o contrato não preenche. Mínimo de 2 caracteres para `[a]`
 * e `[1]` de um texto jurídico não virarem variável.
 */
export const REGEX_VARIAVEL = /\[([A-Za-z0-9_]{2,80})\]/g;

/** As marcas de um trecho de texto (tudo menos o `text`). */
type Marcas = Omit<TText, "text">;

/**
 * O nó de variável, pronto para `insertNodes`.
 *
 * As marcas vão no filho de texto: é assim que `[nome]` em negrito continua em negrito, e é de lá
 * que o serializador lê `<strong>[nome]</strong>` inteiro (nunca partido).
 */
export function noDeVariavel(nome: string, marcas: Marcas = {}): TVariavelElement {
  return { children: [{ ...marcas, text: "" }], nome, type: VARIAVEL_KEY };
}

export function ehNoDeVariavel(no: unknown): no is TVariavelElement {
  return (
    typeof no === "object" &&
    no !== null &&
    (no as { type?: unknown }).type === VARIAVEL_KEY &&
    typeof (no as { nome?: unknown }).nome === "string"
  );
}

function ehTexto(no: unknown): no is TText {
  return typeof no === "object" && no !== null && typeof (no as { text?: unknown }).text === "string";
}

/**
 * Quebra UM trecho de texto em `texto, variável, texto…`, preservando as marcas.
 *
 * ⚠️ SEMPRE devolve texto antes e depois de cada variável, mesmo vazio: o Slate exige nó de texto ao
 * redor de todo inline void, e o valor inicial do editor não passa por normalização automática.
 */
export function promoverVariaveisNoTexto(no: TText): Descendant[] {
  const { text, ...marcas } = no;
  const regex = new RegExp(REGEX_VARIAVEL.source, "g");
  const saida: Descendant[] = [];
  let cursor = 0;

  for (const m of text.matchAll(regex)) {
    const inicio = m.index ?? 0;
    saida.push({ ...marcas, text: text.slice(cursor, inicio) });
    saida.push(noDeVariavel(m[1] as string, marcas));
    cursor = inicio + m[0].length;
  }

  if (saida.length === 0) return [no];
  saida.push({ ...marcas, text: text.slice(cursor) });
  return saida;
}

function promover(nos: Descendant[]): Descendant[] {
  return nos.flatMap((no) => {
    if (ehTexto(no)) return promoverVariaveisNoTexto(no);
    if (ehNoDeVariavel(no)) return [no];
    const elemento = no as TElement;
    if (!Array.isArray(elemento.children)) return [no];
    return [{ ...elemento, children: promover(elemento.children) }];
  });
}

/**
 * Converte todo `[nome]` em texto para nó de variável, no documento inteiro. Pura.
 *
 * É o que abre uma minuta antiga (salva com as variáveis como texto) já com chips, e o que roda por
 * cima do que `importDocx` devolve. Uma variável partida por marca (`[nome_cl` + `iente]` em dois
 * trechos) NÃO é convertida — continua texto, e `codigosPartidos` continua acusando.
 */
export function promoverVariaveisNoValor<T extends readonly Descendant[]>(valor: T): T {
  return promover(valor as unknown as Descendant[]) as unknown as T;
}

/**
 * Os nomes de variável presentes no documento, na ordem: nós de variável E `[nome]` que ainda
 * esteja em texto. É o que o painel usa para marcar "já está no texto".
 *
 * Aceita `unknown[]` de propósito: o documento chega como `Value` do Plate ou como
 * `NoDoDocumento[]` do Temis, que são a mesma coisa em memória.
 */
export function variaveisNoValor(nos: readonly unknown[]): string[] {
  const saida: string[] = [];
  const andar = (lista: readonly unknown[]) => {
    for (const no of lista) {
      if (ehTexto(no)) {
        for (const m of no.text.matchAll(new RegExp(REGEX_VARIAVEL.source, "g"))) {
          saida.push(m[1] as string);
        }
      } else if (ehNoDeVariavel(no)) {
        saida.push(no.nome);
      } else if (Array.isArray((no as TElement).children)) {
        andar((no as TElement).children);
      }
    }
  };
  andar(nos);
  return saida;
}

/**
 * Onde o cursor fica depois que um trecho de texto foi trocado pelos seus pedaços.
 *
 * `offset` é a posição do cursor no texto ORIGINAL. Cada pedaço consome o tamanho que tinha no
 * original (a variável consome `[nome]`). Cursor dentro de um texto fica nele; cursor dentro do
 * `[nome]` ou logo depois do `]` vai para o início do texto seguinte — logo depois do chip. É o que
 * faz digitar `]` fechar a variável sem o cursor sumir nem entrar no void.
 */
export function pontoDepoisDaPromocao(pedacos: Descendant[], caminho: Path, offset: number): Point {
  const pai = caminho.slice(0, -1);
  const primeiro = caminho[caminho.length - 1] ?? 0;
  let pos = 0;

  for (let i = 0; i < pedacos.length; i++) {
    const pedaco = pedacos[i];
    if (!pedaco) break;
    if (ehTexto(pedaco)) {
      const fim = pos + pedaco.text.length;
      if (offset <= fim) return { offset: offset - pos, path: [...pai, primeiro + i] };
      pos = fim;
    } else if (ehNoDeVariavel(pedaco)) {
      const fim = pos + pedaco.nome.length + 2;
      // Sempre há um texto depois do chip (promoverVariaveisNoTexto garante).
      if (offset <= fim) return { offset: 0, path: [...pai, primeiro + i + 1] };
      pos = fim;
    }
  }

  const ultimo = pedacos[pedacos.length - 1];
  return {
    offset: ultimo && ehTexto(ultimo) ? ultimo.text.length : 0,
    path: [...pai, primeiro + Math.max(pedacos.length - 1, 0)],
  };
}

/**
 * Se a variável ainda não tem de onde nascer no Panteon.
 *
 * ⚠️ LÊ `fonte.tabela` SEM DEPENDER DO TIPO: o campo `fonte` é da Frente C (catálogo). Até ele
 * existir, ninguém é pendente; quando existir, o chip e o painel passam a avisar sozinhos. Nunca se
 * busca no C2X — "pendente" quer dizer "o Panteon ainda não tem a coluna".
 */
export function origemPendente(variavel: undefined | VariavelDoContrato): boolean {
  const fonte = (variavel as undefined | { fonte?: { tabela?: string } })?.fonte;
  return fonte?.tabela === "pendente";
}

/** As variáveis agrupadas para o painel e para o combobox, na ordem em que o contrato as usa. */
export const VARIAVEIS_POR_GRUPO = ORDEM_DOS_GRUPOS.map((grupo) => ({
  grupo,
  rotulo: rotuloDoGrupo(grupo),
  variaveis: VARIAVEIS_DO_CONTRATO.filter((v) => v.grupo === grupo),
}));

/**
 * A regra de markdown da variável — para a IA.
 *
 * O documento vai ao modelo em markdown e volta em markdown. Aqui `variavel` vira `[nome]`, que é
 * o que o prompt manda o modelo reproduzir; na volta, `[nome]` chega como texto e o `normalizeNode`
 * abaixo o transforma em nó de novo.
 *
 * ⚠️ NÓ `html`, E NÃO `text`. Medido em 02/09/2026: como `text` o remark escapa os colchetes e o
 * modelo recebe `\[nome\_cliente]`; como `html` sai `[nome_cliente]` literal. Os dois voltam como
 * texto `[nome_cliente]` na desserialização.
 */
export const REGRAS_MARKDOWN_VARIAVEL = {
  [VARIAVEL_KEY]: {
    serialize: (no: TVariavelElement) => ({ type: "html", value: `[${no.nome}]` }),
  },
};

/**
 * O plugin base (sem React). `BaseEditorKitTemis` e a rota `/api/ai/command` usam este.
 *
 * O `normalizeNode` é a porta de entrada de tudo que chega como texto: ao ver um trecho com `[nome]`
 * completo, apaga o trecho e põe o nó no lugar. ⚠️ SÓ QUANDO O COLCHETE FECHA — `[` sozinho, ou
 * `[nome` ainda sendo digitado, é texto comum. E nunca dentro de um void (o filho vazio da própria
 * variável, o input do combobox).
 */
export const BaseVariavelPlugin = createSlatePlugin({
  key: VARIAVEL_KEY,
  node: {
    isElement: true,
    isInline: true,
    // Markable: o negrito aplicado com a variável selecionada entra no filho de texto, e o chip
    // renderiza em negrito. Sem isso, selecionar "Sr. [nome]" e pôr negrito pularia a variável.
    isMarkableVoid: true,
    isVoid: true,
    type: VARIAVEL_KEY,
  },
}).overrideEditor(({ editor, tf: { normalizeNode } }) => ({
  transforms: {
    normalizeNode(entrada, opcoes) {
      const [no, caminho] = entrada;

      if (ehTexto(no) && new RegExp(REGEX_VARIAVEL.source).test(no.text)) {
        const pai = caminho.length > 0 ? editor.api.parent(caminho)?.[0] : undefined;
        const dentroDeVoid = !!pai && ElementApi.isElement(pai) && editor.api.isVoid(pai);

        if (!dentroDeVoid) {
          // Troca o trecho inteiro pelos seus pedaços (texto, chip, texto…), de uma vez. Inserir
          // um ARRAY num caminho é determinístico — cada pedaço cai em caminho, caminho+1, …; não
          // se depende de como o Slate parte um texto quando o ponto está na borda (medido em
          // 02/09/2026: com `[nome]` no fim do parágrafo o cursor ficava ANTES do chip).
          const pedacos = promoverVariaveisNoTexto(no);
          const selecao = editor.selection;
          const cursor =
            selecao && editor.api.isCollapsed() && PathApi.equals(selecao.anchor.path, caminho)
              ? selecao.anchor.offset
              : null;

          editor.tf.withoutNormalizing(() => {
            editor.tf.removeNodes({ at: caminho });
            editor.tf.insertNodes(pedacos, { at: caminho });
            if (cursor !== null) editor.tf.select(pontoDepoisDaPromocao(pedacos, caminho, cursor));
          });
          // O nó desta entrada não existe mais; o Slate volta a normalizar o que sujou.
          return;
        }
      }

      normalizeNode(entrada, opcoes);
    },
  },
}));
