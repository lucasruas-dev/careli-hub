"use client";

import { BasicBlocksPlugin, BasicMarksPlugin } from "@platejs/basic-nodes/react";
import { importDocx } from "@platejs/docx-io";
import { TextAlignPlugin } from "@platejs/basic-styles/react";
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
  Italic,
  List,
  ListOrdered,
  Minus,
  Quote,
  Strikethrough,
  Table as TableIcon,
  Underline,
  Upload,
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
import { useState } from "react";

import type { NoDoDocumento } from "@/lib/temis/documento-html";
import {
  ORDEM_DOS_GRUPOS,
  rotuloDoGrupo,
  VARIAVEIS_DO_CONTRATO,
  type VariavelDoContrato,
} from "@/lib/temis/variaveis";

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
  somenteLeitura?: boolean;
  valorInicial: ValorDoDocumento;
};

/** As variáveis agrupadas para o menu, na ordem em que o contrato as usa. */
const VARIAVEIS_POR_GRUPO = ORDEM_DOS_GRUPOS.map((grupo) => ({
  grupo,
  rotulo: rotuloDoGrupo(grupo),
  variaveis: VARIAVEIS_DO_CONTRATO.filter((v) => v.grupo === grupo),
}));

export default function EditorDeMinuta({ aoAvisar, aoMudar, somenteLeitura, valorInicial }: Props) {
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
    plugins: [
      BasicBlocksPlugin,
      BasicMarksPlugin,
      TextAlignPlugin,
      IndentPlugin,
      ListPlugin,
      TablePlugin,
      TableRowPlugin,
      TableCellPlugin,
      TableCellHeaderPlugin,
    ],
    value: paraOEditor(valorInicial),
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-subtle/30">
      <Plate
        editor={editor}
        onChange={({ value }) => aoMudar(paraOTemis(value))}
        readOnly={somenteLeitura}
      >
        {somenteLeitura ? null : <Barra aoAvisar={aoAvisar} editor={editor} />}

        <div className="min-h-0 flex-1 overflow-auto px-4 py-5">
          {/* A "folha": largura de papel, fundo branco, texto serifado. */}
          <div className="mx-auto max-w-[820px] rounded-lg bg-white px-14 py-12 text-[15px] leading-relaxed text-slate-900 shadow-sm dark:bg-slate-100">
            <PlateContent
              className="min-h-[400px] outline-none [&_table]:table-fixed"
              placeholder="Cole aqui a minuta, ou importe o arquivo do loteador."
              spellCheck={false}
              style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
            />
          </div>
        </div>
      </Plate>
    </div>
  );
}

type EditorDoPlate = NonNullable<ReturnType<typeof usePlateEditor>>;

function Barra({
  aoAvisar,
  editor,
}: {
  aoAvisar?: (aviso: string) => void;
  editor: EditorDoPlate;
}) {
  const [menuAberto, setMenuAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [importando, setImportando] = useState(false);

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

  const inserirVariavel = (variavel: VariavelDoContrato) => {
    editor.tf.insertText(`[${variavel.nome}]`);
    editor.tf.focus();
    setMenuAberto(false);
    setBusca("");
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

  const filtro = busca.trim().toLowerCase();

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

      {/* ── O MENU DE VARIÁVEIS ──────────────────────────────────────────── */}
      <button
        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#A07C3B] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#8A6A32]"
        onClick={() => setMenuAberto((a) => !a)}
        type="button"
      >
        <Braces aria-hidden="true" className="size-3.5" />
        Inserir variável
      </button>

      {menuAberto ? (
        <>
          {/* Fecha ao clicar fora, sem prender o foco. */}
          <button
            aria-label="Fechar menu de variáveis"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setMenuAberto(false)}
            type="button"
          />
          <div className="absolute right-3 top-12 z-20 flex max-h-96 w-96 flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
            <div className="border-b border-line p-2">
              <input
                autoFocus
                className="h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-line-strong"
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Procurar (nome, CPF, quadra, lote…)"
                value={busca}
              />
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-1">
              {VARIAVEIS_POR_GRUPO.map((g) => {
                const achadas = g.variaveis.filter(
                  (v) =>
                    !filtro ||
                    v.nome.includes(filtro) ||
                    v.rotulo.toLowerCase().includes(filtro),
                );
                if (achadas.length === 0) return null;

                return (
                  <div key={g.grupo}>
                    <p className="m-0 px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                      {g.rotulo}
                    </p>
                    {achadas.map((v) => (
                      <button
                        className="flex w-full flex-col items-start gap-0.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-subtle"
                        key={v.nome}
                        onClick={() => inserirVariavel(v)}
                        type="button"
                      >
                        <span className="text-xs font-semibold text-ink">{v.rotulo}</span>
                        <span className="font-mono text-[10px] text-ink-muted">[{v.nome}]</span>
                        {/* A origem responde a pergunta que o jurídico faz o tempo todo: "de onde
                            vem esse dado?". Sem isso, ele deixa o campo em branco por via das dúvidas. */}
                        <span className="text-[10px] text-ink-soft">{v.origem}</span>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : null}
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
