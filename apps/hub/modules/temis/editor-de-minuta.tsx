"use client";

import { BasicBlocksPlugin, BasicMarksPlugin } from "@platejs/basic-nodes/react";
import { importDocx } from "@platejs/docx-io";
import {
  FontBackgroundColorPlugin,
  FontColorPlugin,
  FontFamilyPlugin,
  FontSizePlugin,
  LineHeightPlugin,
  TextAlignPlugin,
  TextIndentPlugin,
} from "@platejs/basic-styles/react";
import { IndentPlugin } from "@platejs/indent/react";
import { ListPlugin } from "@platejs/list/react";
import {
  TableCellHeaderPlugin,
  TableCellPlugin,
  TablePlugin,
  TableRowPlugin,
} from "@platejs/table/react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Braces,
  Check,
  ChevronRight,
  Italic,
  List,
  Loader2,
  ListOrdered,
  Minus,
  Quote,
  PanelRight,
  Strikethrough,
  Table as TableIcon,
  Underline,
  DatabaseZap,
  Upload,
  X,
} from "lucide-react";
import { KEYS, type Value } from "platejs";
import {
  Plate,
  PlateContent,
  PlateElement,
  type PlateElementProps,
  PlateLeaf,
  type PlateLeafProps,
  usePlateEditor,
} from "platejs/react";
import { useMemo, useState } from "react";

import { documentoParaTexto, type NoDoDocumento } from "@/lib/temis/documento-html";
import {
  ORDEM_DOS_GRUPOS,
  rotuloDoGrupo,
  VARIAVEIS_DO_CONTRATO,
  type VariavelDoContrato,
  variaveisDoTexto,
} from "@/lib/temis/variaveis";
import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";

// O EDITOR DA MINUTA — o "Word" do jurídico.
//
// Pedido do Lucas (01/09/2026): *"não quero o mesmo editor do C2x, é muito ruimmmmmmmmm, quero algo
// mais proximo de um word"*, e *"lembrando que temos que inserir as variaveis que vão se alimentadas
// pelo sistema"*.
//
// ⚠️ A PÁGINA TEM LARGURA DE PAPEL, e não é estética: o jurídico revisa quebra de linha e quebra de
// cláusula. Um editor que ocupa 1.900 px de tela mostra um texto que não se parece com o contrato
// impresso, e o revisor perde a única referência que tem.
//
// ⚠️ A VARIÁVEL É INSERIDA PELO MENU, e nunca digitada. `[nome_cliente]` digitado à mão erra por um
// caractere e o contrato sai com "[nome_clientes]" impresso no papel — foi assim que `[Nome]` e
// `[CPF]` entraram nas minutas antigas do C2X. O menu só oferece o que o sistema sabe preencher.

// ⚠️ O DOCUMENTO ATRAVESSA A FRONTEIRA UMA VEZ SÓ, E É AQUI. Do lado do editor ele é o `Value` do
// Plate; do lado do Temis é `NoDoDocumento[]`, que é o que `documento-html.ts` sabe serializar. São
// a mesma coisa em memória — a diferença é só de tipo. Concentrar a conversão neste ponto evita
// espalhar `as` pelo módulo inteiro e deixa claro onde a garantia começa.
export type ValorDoDocumento = NoDoDocumento[];

function paraOEditor(valor: ValorDoDocumento): Value {
  return valor as unknown as Value;
}

function paraOTemis(valor: Value): ValorDoDocumento {
  return valor as unknown as ValorDoDocumento;
}

// ⚠️ O `as` DO PLATE É GENÉRICO NA TAG, e o genérico amarra o tipo de `attributes` à tag escolhida.
// Como aqui a tag é decidida em tempo de execução (uma fábrica para p, h1, td…), o TypeScript não
// consegue casar os dois. O cast é do COMPONENTE, uma vez, e não das props em cada uso — assim o
// `props` continua tipado de verdade em quem escreve o componente.
const Elemento = PlateElement as unknown as (
  props: { as: string; className?: string } & PlateElementProps,
) => React.ReactElement;

const Marca = PlateLeaf as unknown as (
  props: { as: string } & PlateLeafProps,
) => React.ReactElement;

/** Fábrica dos componentes de bloco. */
function elementoComo(as: string, className?: string) {
  return function Bloco(props: PlateElementProps) {
    return <Elemento {...props} as={as} className={className} />;
  };
}

/** Fábrica dos componentes de marca (negrito, itálico…). */
function marcaComo(as: string) {
  return function Formatacao(props: PlateLeafProps) {
    return <Marca {...props} as={as} />;
  };
}

function LinhaHorizontal(props: PlateElementProps) {
  return (
    <Elemento {...props} as="div" className="my-4">
      <hr className="border-line" />
    </Elemento>
  );
}

type Props = {
  aoAvisar?: (aviso: string) => void;
  aoMudar: (valor: ValorDoDocumento) => void;
  /** Necessário para listar as minutas que o empreendimento já tem no C2X. */
  enterpriseId: string;
  somenteLeitura?: boolean;
  valorInicial: ValorDoDocumento;
};

/** As variáveis agrupadas para o menu, na ordem em que o contrato as usa. */
const VARIAVEIS_POR_GRUPO = ORDEM_DOS_GRUPOS.map((grupo) => ({
  grupo,
  rotulo: rotuloDoGrupo(grupo),
  variaveis: VARIAVEIS_DO_CONTRATO.filter((v) => v.grupo === grupo),
}));

export default function EditorDeMinuta({
  aoAvisar,
  aoMudar,
  enterpriseId,
  somenteLeitura,
  valorInicial,
}: Props) {
  const editor = usePlateEditor({
    components: {
      [KEYS.blockquote]: elementoComo("blockquote", "my-2 border-l-4 border-line pl-4 italic"),
      [KEYS.bold]: marcaComo("strong"),
      [KEYS.h1]: elementoComo("h1", "mb-2 mt-4 text-xl font-bold"),
      [KEYS.h2]: elementoComo("h2", "mb-2 mt-4 text-lg font-bold"),
      [KEYS.h3]: elementoComo("h3", "mb-1 mt-3 text-base font-bold"),
      [KEYS.hr]: LinhaHorizontal,
      [KEYS.italic]: marcaComo("em"),
      [KEYS.p]: elementoComo("p", "my-1.5"),
      [KEYS.strikethrough]: marcaComo("s"),
      [KEYS.table]: elementoComo("table", "my-3 w-full border-collapse"),
      [KEYS.td]: elementoComo("td", "border border-line px-2 py-1 align-top"),
      [KEYS.th]: elementoComo(
        "th",
        "border border-line bg-subtle px-2 py-1 text-left align-top font-semibold",
      ),
      [KEYS.tr]: elementoComo("tr"),
      [KEYS.underline]: marcaComo("u"),
    },
    // ⚠️ OS PLUGINS DE FONTE E COR NÃO SÃO ENFEITE: SEM ELES O TEXTO CHEGA PELADO. Medido em
    // 01/09/2026 com a minuta do JDG que está no ar — ao ler o HTML sem eles, o Plate devolve os
    // trechos com `text`, `bold` e `italic` e joga fora `font-family` (450 dos 485 trechos), `color`
    // e o fundo da célula. Registrá-los é o que faz a minuta importada continuar parecida com o
    // documento que o loteador entregou.
    plugins: [
      BasicBlocksPlugin,
      BasicMarksPlugin,
      TextAlignPlugin,
      FontFamilyPlugin,
      FontSizePlugin,
      FontColorPlugin,
      FontBackgroundColorPlugin,
      LineHeightPlugin,
      TextIndentPlugin,
      IndentPlugin,
      ListPlugin,
      TablePlugin,
      TableRowPlugin,
      TableCellPlugin,
      TableCellHeaderPlugin,
    ],
    value: paraOEditor(valorInicial),
  });

  // ⚠️ O PAINEL DE VARIÁVEIS FICA AO LADO, ABERTO. Pedido do Lucas (01/09/2026): "a ideia das
  // variveis, é abrir ao lado e trazer elas separadas por grupos, seria mais facil de visualizar".
  // Num menu suspenso, escolher uma variável fecha a lista e apaga o contexto — e quem marca uma
  // minuta de 27 páginas insere dezenas seguidas. Ao lado, a lista fica de pé o tempo todo.
  const [painelAberto, setPainelAberto] = useState(true);
  const [valorAtual, setValorAtual] = useState<ValorDoDocumento>(valorInicial);

  // Quais variáveis JÁ estão no texto. O painel marca cada uma, e é isso que responde de relance a
  // pergunta que se faz o tempo todo numa minuta longa: "já coloquei o CPF do cônjuge?".
  const jaUsadas = useMemo(
    () => new Set(variaveisDoTexto(documentoParaTexto(valorAtual))),
    [valorAtual],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-subtle/30">
      <Plate
        editor={editor}
        onChange={({ value }) => {
          const convertido = paraOTemis(value);
          setValorAtual(convertido);
          aoMudar(convertido);
        }}
        readOnly={somenteLeitura}
      >
        {somenteLeitura ? null : (
          <Barra
            aoAlternarPainel={() => setPainelAberto((a) => !a)}
            aoAvisar={aoAvisar}
            editor={editor}
            enterpriseId={enterpriseId}
            painelAberto={painelAberto}
          />
        )}

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* A FOLHA. Rola sozinha e ocupa toda a altura que sobrar. */}
          <div className="min-h-0 flex-1 overflow-auto px-4 py-5">
            <div className="mx-auto max-w-[820px] rounded-lg bg-white px-14 py-12 text-[15px] leading-relaxed text-slate-900 shadow-sm dark:bg-slate-100">
              <PlateContent
                className="min-h-[65vh] outline-none [&_table]:w-full [&_table]:table-fixed"
                placeholder="Cole aqui a minuta, ou importe o arquivo do loteador."
                spellCheck={false}
                style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
              />
            </div>
          </div>

          {painelAberto && !somenteLeitura ? (
            <PainelDeVariaveis
              aoFechar={() => setPainelAberto(false)}
              editor={editor}
              jaUsadas={jaUsadas}
            />
          ) : null}
        </div>
      </Plate>
    </div>
  );
}

/**
 * A lista de variáveis, ao lado da folha.
 *
 * ⚠️ CADA GRUPO DIZ QUANTAS JÁ ESTÃO NO TEXTO. Numa minuta com cinco compradores, a pergunta que o
 * jurídico faz o tempo todo é "já marquei o cônjuge do segundo?" — e a resposta precisa estar à
 * vista, não a três cliques de distância.
 */
function PainelDeVariaveis({
  aoFechar,
  editor,
  jaUsadas,
}: {
  aoFechar: () => void;
  editor: EditorDoPlate;
  jaUsadas: Set<string>;
}) {
  const [busca, setBusca] = useState("");
  // Os três primeiros grupos abertos: são os que toda minuta usa. O resto abre sob demanda —
  // 223 variáveis de uma vez viram uma parede que ninguém lê.
  const [abertos, setAbertos] = useState<Set<string>>(
    () => new Set(["comprador", "conjuge", "unidade"]),
  );

  const filtro = busca.trim().toLowerCase();

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
        <h5 className="m-0 text-xs font-semibold uppercase tracking-wide text-ink-soft">
          Variáveis
          <span className="ml-1.5 font-normal normal-case text-ink-muted">
            {jaUsadas.size} no texto
          </span>
        </h5>
        <button
          aria-label="Fechar o painel de variáveis"
          className="flex size-7 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-subtle hover:text-ink"
          onClick={aoFechar}
          type="button"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>

      <div className="border-b border-line p-2">
        <input
          className="h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-line-strong"
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Procurar (nome, CPF, quadra…)"
          value={busca}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-1.5">
        {VARIAVEIS_POR_GRUPO.map((g) => {
          const achadas = g.variaveis.filter(
            (v) => !filtro || v.nome.includes(filtro) || v.rotulo.toLowerCase().includes(filtro),
          );
          if (achadas.length === 0) return null;

          // Durante a busca todo grupo com resultado abre — senão a busca acharia e esconderia.
          const aberto = filtro !== "" || abertos.has(g.grupo);
          const usadas = achadas.filter((v) => jaUsadas.has(v.nome)).length;

          return (
            <section className="mb-1" key={g.grupo}>
              <button
                className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-subtle"
                onClick={() =>
                  setAbertos((atual) => {
                    const novo = new Set(atual);
                    if (novo.has(g.grupo)) novo.delete(g.grupo);
                    else novo.add(g.grupo);
                    return novo;
                  })
                }
                type="button"
              >
                <ChevronRight
                  aria-hidden="true"
                  className={`size-3.5 shrink-0 text-ink-muted transition-transform ${
                    aberto ? "rotate-90" : ""
                  }`}
                />
                <span className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                  {g.rotulo}
                </span>
                <span className="text-[10px] tabular-nums text-ink-muted">
                  {usadas > 0 ? `${usadas}/${achadas.length}` : achadas.length}
                </span>
              </button>

              {aberto
                ? achadas.map((v) => (
                    <button
                      className="group flex w-full flex-col items-start gap-0.5 rounded-lg py-1.5 pl-6 pr-2 text-left transition-colors hover:bg-subtle"
                      key={v.nome}
                      onClick={() => {
                        editor.tf.insertText(`[${v.nome}]`);
                        editor.tf.focus();
                      }}
                      // ⚠️ `onMouseDown` com preventDefault: sem isso o clique tira o foco do
                      // editor, o cursor se perde e a variável entra no lugar errado — ou em
                      // lugar nenhum.
                      onMouseDown={(e) => e.preventDefault()}
                      title={`Inserir [${v.nome}]`}
                      type="button"
                    >
                      <span className="flex w-full items-center gap-1.5">
                        {jaUsadas.has(v.nome) ? (
                          <Check
                            aria-hidden="true"
                            className="size-3 shrink-0 text-emerald-600 dark:text-emerald-400"
                          />
                        ) : (
                          <span aria-hidden="true" className="size-3 shrink-0" />
                        )}
                        <span className="flex-1 truncate text-xs font-medium text-ink">
                          {v.rotulo}
                        </span>
                      </span>
                      <span className="pl-[1.125rem] font-mono text-[10px] text-ink-muted">
                        [{v.nome}]
                      </span>
                      {/* A origem responde à pergunta que o jurídico faz o tempo todo: "de onde vem
                          esse dado?". Sem ela, ele deixa o campo em branco por via das dúvidas. */}
                      <span className="pl-[1.125rem] text-[10px] leading-tight text-ink-soft opacity-0 transition-opacity group-hover:opacity-100">
                        {v.origem}
                      </span>
                    </button>
                  ))
                : null}
            </section>
          );
        })}
      </div>
    </aside>
  );
}

type EditorDoPlate = NonNullable<ReturnType<typeof usePlateEditor>>;

type MinutaDoC2x = {
  atualizadaEm: null | string;
  id: number;
  nome: string;
  tamanho: number;
};

function Barra({
  aoAlternarPainel,
  aoAvisar,
  editor,
  enterpriseId,
  painelAberto,
}: {
  aoAlternarPainel: () => void;
  aoAvisar?: (aviso: string) => void;
  editor: EditorDoPlate;
  enterpriseId: string;
  painelAberto: boolean;
}) {
  const [importando, setImportando] = useState(false);
  const [minutasDoC2x, setMinutasDoC2x] = useState<MinutaDoC2x[] | null>(null);
  const [menuC2xAberto, setMenuC2xAberto] = useState(false);

  const marca = (chave: string) => () => {
    editor.tf.toggleMark(chave);
    editor.tf.focus();
  };

  const bloco = (tipo: string) => () => {
    editor.tf.toggleBlock(tipo);
    editor.tf.focus();
  };

  const alinhar = (valor: string) => () => {
    editor.tf.setNodes({ [KEYS.textAlign]: valor });
    editor.tf.focus();
  };

  /**
   * Liga ou desliga a lista no bloco atual.
   *
   * ⚠️ NO PLATE A LISTA É UMA PROPRIEDADE DO PARÁGRAFO (`listStyleType` + `indent`), como no Word —
   * não existe nó `<ul>` no documento. Quem reconstrói `<ul>/<ol>` é `lib/temis/documento-html.ts`.
   */
  const lista = (estilo: string) => () => {
    const entrada = editor.api.block();
    const atual = (entrada?.[0] as undefined | { listStyleType?: string })?.listStyleType;

    if (atual === estilo) editor.tf.unsetNodes([KEYS.listType, KEYS.indent]);
    else editor.tf.setNodes({ [KEYS.indent]: 1, [KEYS.listType]: estilo });

    editor.tf.focus();
  };

  /**
   * Lista as minutas que este empreendimento já tem no C2X.
   *
   * ⚠️ O TAMANHO VEM JUNTO PORQUE MINUTA VAZIA EXISTE. A `ACP-MINUTA-COMPRA-VENDA` tem zero
   * caracteres no legado, com três planos apontando para ela — mostrar "0 caracteres" na lista
   * evita o clique que não vai a lugar nenhum.
   */
  const listarDoC2x = async () => {
    setMenuC2xAberto(true);
    if (minutasDoC2x) return;

    try {
      const token = await getApoloAccessToken();
      const r = await fetch(
        `/api/temis/minutas/c2x?enterpriseId=${encodeURIComponent(enterpriseId)}`,
        { cache: "no-store", headers: { Authorization: `Bearer ${token}` } },
      );
      const corpo = (await r.json().catch(() => ({}))) as {
        data?: { minutas: MinutaDoC2x[] };
        error?: string;
      };
      if (!r.ok || !corpo.data) {
        aoAvisar?.(corpo.error ?? "Não consegui listar as minutas do C2X.");
        setMenuC2xAberto(false);
        return;
      }
      setMinutasDoC2x(corpo.data.minutas);
    } catch {
      aoAvisar?.("Falha ao consultar o C2X.");
      setMenuC2xAberto(false);
    }
  };

  /**
   * Traz o texto de uma minuta do C2X para o editor.
   *
   * ⚠️ É AQUI QUE A FORMATAÇÃO SOBREVIVE OU MORRE. `editor.api.html.deserialize` usa os plugins
   * registrados: com FontFamily, FontColor e Table ligados, a fonte, a cor e o fundo da célula
   * atravessam. Medido na minuta do JDG: 450 dos 485 trechos mantêm a fonte, e as 244 variáveis
   * chegam inteiras. O que NÃO atravessa é a borda da tabela — o serializador a devolve na saída.
   */
  const importarDoC2x = async (minuta: MinutaDoC2x) => {
    if (
      !window.confirm(
        `Importar "${minuta.nome}" do C2X substitui TODO o texto deste documento. Continuar?`,
      )
    ) {
      return;
    }

    setImportando(true);
    setMenuC2xAberto(false);

    try {
      const token = await getApoloAccessToken();
      const r = await fetch(`/api/temis/minutas/c2x?draftId=${minuta.id}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const corpo = (await r.json().catch(() => ({}))) as {
        data?: { minuta: { html: string; nome: string } };
        error?: string;
      };

      if (!r.ok || !corpo.data) {
        aoAvisar?.(corpo.error ?? "Não consegui trazer esta minuta do C2X.");
        return;
      }

      const nos = editor.api.html.deserialize({ element: corpo.data.minuta.html });
      if (!Array.isArray(nos) || nos.length === 0) {
        aoAvisar?.("O texto veio do C2X, mas não consegui interpretá-lo. Nada foi alterado.");
        return;
      }

      editor.tf.setValue(nos as Value);
      aoAvisar?.(
        `"${corpo.data.minuta.nome}" importada do C2X. Confira a conferência acima antes de publicar: a minuta do legado pode trazer bloco condicional mal fechado.`,
      );
    } catch {
      aoAvisar?.("Falha ao importar do C2X.");
    } finally {
      setImportando(false);
    }
  };

  /**
   * Substitui o documento pelo conteúdo de um .docx.
   *
   * ⚠️ SUBSTITUI, não acrescenta — e o aviso na tela diz isso antes. É o fluxo que o Lucas
   * descreveu: *"o fluxo é subir a minuta que chega do loteador, vou importar"*. Importar por cima
   * de um texto já revisado apagaria o trabalho, então o botão só aparece com a confirmação.
   *
   * ⚠️ O QUE O WORD PERDE NA CONVERSÃO É REAL: cabeçalho, rodapé, numeração automática de cláusula e
   * caixas de texto não atravessam. Por isso o aviso conta quantos avisos o conversor deu, em vez de
   * dizer "importado com sucesso" — o jurídico precisa reler antes de publicar.
   */
  const importar = async (arquivo: File) => {
    setImportando(true);
    try {
      const buffer = await arquivo.arrayBuffer();
      const { nodes, warnings } = await importDocx(editor, buffer);

      if (!nodes.length) {
        aoAvisar?.("O arquivo foi lido, mas veio vazio. Confira se é mesmo um .docx.");
        return;
      }

      editor.tf.setValue(nodes as Value);
      aoAvisar?.(
        warnings.length > 0
          ? `Minuta importada com ${warnings.length} aviso(s) de conversão. Releia antes de publicar: cabeçalho, rodapé e numeração automática do Word não atravessam.`
          : "Minuta importada. Releia antes de publicar: cabeçalho, rodapé e numeração automática do Word não atravessam.",
      );
    } catch {
      aoAvisar?.("Não consegui ler este arquivo. Ele precisa ser .docx (Word), não .doc nem PDF.");
    } finally {
      setImportando(false);
    }
  };

  return (
    <div className="relative flex shrink-0 flex-wrap items-center gap-1 border-b border-line bg-surface px-3 py-2">
      <Grupo>
        <Botao aoClicar={marca(KEYS.bold)} titulo="Negrito">
          <Bold aria-hidden="true" className="size-4" />
        </Botao>
        <Botao aoClicar={marca(KEYS.italic)} titulo="Itálico">
          <Italic aria-hidden="true" className="size-4" />
        </Botao>
        <Botao aoClicar={marca(KEYS.underline)} titulo="Sublinhado">
          <Underline aria-hidden="true" className="size-4" />
        </Botao>
        <Botao aoClicar={marca(KEYS.strikethrough)} titulo="Tachado">
          <Strikethrough aria-hidden="true" className="size-4" />
        </Botao>
      </Grupo>

      <Separador />

      <Grupo>
        <Botao aoClicar={bloco(KEYS.h1)} titulo="Título 1">
          <span className="text-xs font-bold">H1</span>
        </Botao>
        <Botao aoClicar={bloco(KEYS.h2)} titulo="Título 2">
          <span className="text-xs font-bold">H2</span>
        </Botao>
        <Botao aoClicar={bloco(KEYS.h3)} titulo="Título 3">
          <span className="text-xs font-bold">H3</span>
        </Botao>
        <Botao aoClicar={bloco(KEYS.blockquote)} titulo="Citação">
          <Quote aria-hidden="true" className="size-4" />
        </Botao>
      </Grupo>

      <Separador />

      <Grupo>
        <Botao aoClicar={alinhar("left")} titulo="Alinhar à esquerda">
          <AlignLeft aria-hidden="true" className="size-4" />
        </Botao>
        <Botao aoClicar={alinhar("center")} titulo="Centralizar">
          <AlignCenter aria-hidden="true" className="size-4" />
        </Botao>
        <Botao aoClicar={alinhar("right")} titulo="Alinhar à direita">
          <AlignRight aria-hidden="true" className="size-4" />
        </Botao>
        <Botao aoClicar={alinhar("justify")} titulo="Justificar">
          <AlignJustify aria-hidden="true" className="size-4" />
        </Botao>
      </Grupo>

      <Separador />

      <Grupo>
        <Botao aoClicar={lista("disc")} titulo="Lista com marcadores">
          <List aria-hidden="true" className="size-4" />
        </Botao>
        <Botao aoClicar={lista("decimal")} titulo="Lista numerada">
          <ListOrdered aria-hidden="true" className="size-4" />
        </Botao>
        <Botao
          aoClicar={() => {
            editor.tf.insert.table();
            editor.tf.focus();
          }}
          titulo="Inserir tabela"
        >
          <TableIcon aria-hidden="true" className="size-4" />
        </Botao>
        <Botao aoClicar={bloco(KEYS.hr)} titulo="Linha horizontal">
          <Minus aria-hidden="true" className="size-4" />
        </Botao>
      </Grupo>

      <Separador />

      {/* ⚠️ A PORTA PARA AS 85 MINUTAS DO LEGADO. Sem ela, "rodar o JDG hoje" significaria alguém
          redigitar 41 mil caracteres — o editor só sabia ler .docx, e as minutas do C2X são HTML
          dentro do MySQL. */}
      <button
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-xs font-semibold text-ink transition-colors hover:bg-subtle disabled:opacity-40"
        disabled={importando}
        onClick={() => void listarDoC2x()}
        title="Trazer uma minuta que já existe no C2X"
        type="button"
      >
        <DatabaseZap aria-hidden="true" className="size-3.5" />
        Do C2X
      </button>

      {menuC2xAberto ? (
        <>
          <button
            aria-label="Fechar"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setMenuC2xAberto(false)}
            type="button"
          />
          <div className="absolute left-3 top-12 z-20 max-h-80 w-96 overflow-auto rounded-xl border border-line bg-surface p-1 shadow-lg">
            {!minutasDoC2x ? (
              <p className="m-0 flex items-center gap-2 px-3 py-3 text-xs text-ink-muted">
                <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                Consultando o C2X…
              </p>
            ) : minutasDoC2x.length === 0 ? (
              <p className="m-0 px-3 py-3 text-xs text-ink-muted">
                Este empreendimento não tem minuta no C2X.
              </p>
            ) : (
              minutasDoC2x.map((m) => (
                <button
                  className="flex w-full flex-col items-start gap-0.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-subtle disabled:opacity-40"
                  disabled={m.tamanho === 0}
                  key={m.id}
                  onClick={() => void importarDoC2x(m)}
                  title={m.tamanho === 0 ? "Esta minuta está vazia no C2X" : `Importar ${m.nome}`}
                  type="button"
                >
                  <span className="text-xs font-semibold text-ink">{m.nome}</span>
                  <span className="text-[10px] text-ink-muted">
                    {m.tamanho === 0
                      ? "VAZIA no C2X — não há o que importar"
                      : `${m.tamanho.toLocaleString("pt-BR")} caracteres`}
                  </span>
                </button>
              ))
            )}
          </div>
        </>
      ) : null}

      <label
        className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-xs font-semibold text-ink transition-colors hover:bg-subtle"
        title="Importar um .docx por cima deste documento"
      >
        <Upload aria-hidden="true" className="size-3.5" />
        {importando ? "Importando…" : "Importar .docx"}
        <input
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="hidden"
          onChange={(e) => {
            const arquivo = e.target.files?.[0];
            e.target.value = "";
            if (!arquivo) return;
            if (
              !window.confirm(
                "Importar substitui TODO o texto deste documento pelo conteúdo do arquivo. Continuar?",
              )
            ) {
              return;
            }
            void importar(arquivo);
          }}
          type="file"
        />
      </label>

      <Separador />

      {/* O painel de variáveis vive AO LADO da folha, não aqui — ver a nota em PainelDeVariaveis.
          Este botão só o esconde quando o jurídico quer a folha inteira para reler. */}
      <button
        className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors ${
          painelAberto
            ? "bg-[#A07C3B] text-white hover:bg-[#8A6A32]"
            : "border border-line bg-surface text-ink hover:bg-subtle"
        }`}
        onClick={aoAlternarPainel}
        title={painelAberto ? "Esconder as variáveis" : "Mostrar as variáveis"}
        type="button"
      >
        {painelAberto ? (
          <PanelRight aria-hidden="true" className="size-3.5" />
        ) : (
          <Braces aria-hidden="true" className="size-3.5" />
        )}
        Variáveis
      </button>
    </div>
  );
}

function Grupo({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-0.5">{children}</div>;
}

function Separador() {
  return <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />;
}

function Botao({
  aoClicar,
  children,
  titulo,
}: {
  aoClicar: () => void;
  children: React.ReactNode;
  titulo: string;
}) {
  return (
    <button
      aria-label={titulo}
      className="flex size-8 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-subtle hover:text-ink"
      // ⚠️ `onMouseDown` com preventDefault, e NÃO `onClick`: sem isso o clique tira o foco do
      // editor antes do comando rodar, a seleção se perde e o negrito não aplica em nada.
      onMouseDown={(e) => {
        e.preventDefault();
        aoClicar();
      }}
      title={titulo}
      type="button"
    >
      {children}
    </button>
  );
}
