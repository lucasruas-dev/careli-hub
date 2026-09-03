"use client";

import { Check, ChevronRight, X } from "lucide-react";
import type { Value } from "platejs";
import {
  Plate,
  type PlateEditor,
  useEditorRef,
  usePlateEditor,
  usePluginOption,
} from "platejs/react";
import { useEffect, useMemo, useState } from "react";
import { Toaster } from "sonner";

import { discussionPlugin } from "@/components/editor/plugins/discussion-kit";
import { Editor, EditorContainer } from "@/components/ui/editor";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { NoDoDocumento } from "@/lib/temis/documento-html";
import { migrarAlinhamentoAntigo } from "@/lib/temis/migrar-documento";
import { setMinutaAtualParaUpload } from "@/lib/temis/upload-midia";
import { useAuth } from "@/providers/auth-provider";

import { EditorKitTemis } from "./editor-kit-temis";
import { TemisToolbarPlugin } from "./plugins/temis-toolbar-kit";
import { inserirVariavel } from "./plugins/variavel-input-kit";
import {
  origemPendente,
  promoverVariaveisNoValor,
  VARIAVEIS_POR_GRUPO,
  variaveisNoValor,
} from "./plugins/variavel-kit-base";

// O EDITOR DA MINUTA — o "Word" do jurídico, agora com o Plate UI completo.
//
// Pedido do Lucas (01/09/2026): *"não quero o mesmo editor do C2x, é muito ruimmmmmmmmm, quero algo
// mais proximo de um word"*, e *"lembrando que temos que inserir as variaveis que vão se alimentadas
// pelo sistema"*. E em 02/09/2026, ao comparar com o demo "An AI editor" do Plate: *"não temos todas
// essas ferramentas, revise as documentações pois quero isso completo, estamos muito simples"*.
//
// ⚠️ NADA DO C2X. Lucas (02/09/2026): *"não quero nada do c2x, todas as variáveis tem que nascer do
// panteon, esquece c2x como consulta"*. O botão "Do C2X" saiu; a prop `enterpriseId` saiu com ele
// (só existia para listar minutas do legado). O que entra aqui vem do .docx do loteador ou é escrito.
//
// O QUE ESTE ARQUIVO FAZ, e o que delega:
// - monta o editor com `EditorKitTemis` (o EditorKit do Plate + variável + busca + barra da Têmis);
// - converte o documento na fronteira (Value do Plate ↔ NoDoDocumento[] do Temis) UMA vez, aqui;
// - mostra o painel de variáveis ao lado da folha;
// - liga o upload de mídia à minuta aberta e o usuário logado às discussões.
// A barra de ferramentas é o plugin `temis-toolbar-kit.tsx`; o chip e o combobox da variável são
// `variavel-kit.tsx`/`variavel-input-kit.tsx`; o HTML do contrato continua em
// `lib/temis/documento-html.ts` (serializador próprio — ver a decisão no topo dele).
//
// ⚠️ A PÁGINA TEM LARGURA DE PAPEL, e não é estética: o jurídico revisa quebra de linha e quebra de
// cláusula. Um editor que ocupa 1.900 px de tela mostra um texto que não se parece com o contrato
// impresso, e o revisor perde a única referência que tem.
//
// ⚠️ A VARIÁVEL É INSERIDA PELO MENU OU PELO `[`, e nunca digitada solta. `[nome_cliente]` digitado
// à mão erra por um caractere e o contrato sai com "[nome_clientes]" impresso — foi assim que
// `[Nome]` e `[CPF]` entraram nas minutas antigas. O catálogo só oferece o que o Panteon preenche.

// ⚠️ O DOCUMENTO ATRAVESSA A FRONTEIRA UMA VEZ SÓ, E É AQUI. Do lado do editor ele é o `Value` do
// Plate; do lado do Temis é `NoDoDocumento[]`, que é o que `documento-html.ts` sabe serializar. São
// a mesma coisa em memória — a diferença é só de tipo. Concentrar a conversão neste ponto evita
// espalhar `as` pelo módulo inteiro e deixa claro onde a garantia começa. Não há migração de shape:
// os kits do Plate usam as MESMAS chaves e props dos plugins que já gravávamos (p, h1, td, bold,
// fontFamily, align, indent, listStyleType…); o JSON salvo abre sem conversão.
export type ValorDoDocumento = NoDoDocumento[];

function paraOEditor(valor: ValorDoDocumento): Value {
  return valor as unknown as Value;
}

function paraOTemis(valor: Value): ValorDoDocumento {
  return valor as unknown as ValorDoDocumento;
}

type Props = {
  aoAvisar?: (aviso: string) => void;
  aoMudar: (valor: ValorDoDocumento) => void;
  /** A minuta aberta: é o prefixo onde a mídia enviada pelo editor fica no bucket. */
  minutaId: string;
  somenteLeitura?: boolean;
  valorInicial: ValorDoDocumento;
};

/**
 * A FOLHA CONTINUA CLARA NO DARK — e os tokens do Plate UI acompanham.
 *
 * ⚠️ Os componentes do registro (placeholder, código, callout, toggle…) pintam com os tokens do
 * shadcn (`--muted`, `--foreground`…), que no dark viram cinza-escuro. Como o papel fica branco de
 * propósito (decisão de 01/09/2026: o jurídico compara com o contrato impresso), os tokens são
 * refeitos AQUI, só dentro da folha, para não sair texto escuro em fundo escuro em cima do papel
 * claro. Os popovers abrem em portal, fora da folha, e seguem o tema do app.
 */
const ESTILO_DA_FOLHA = {
  "--accent": "oklch(0.97 0 0)",
  "--accent-foreground": "oklch(0.205 0 0)",
  "--background": "#ffffff",
  "--border": "oklch(0.922 0 0)",
  "--card": "#ffffff",
  "--card-foreground": "oklch(0.145 0 0)",
  "--foreground": "oklch(0.145 0 0)",
  "--input": "oklch(0.922 0 0)",
  "--muted": "oklch(0.97 0 0)",
  "--muted-foreground": "oklch(0.556 0 0)",
  "--primary": "oklch(0.205 0 0)",
  "--primary-foreground": "oklch(0.985 0 0)",
  "--secondary": "oklch(0.97 0 0)",
  "--secondary-foreground": "oklch(0.205 0 0)",
  fontFamily: "Georgia, 'Times New Roman', serif",
} as React.CSSProperties;

export default function EditorDeMinuta({
  aoAvisar,
  aoMudar,
  minutaId,
  somenteLeitura,
  valorInicial,
}: Props) {
  const editor = usePlateEditor({
    plugins: EditorKitTemis,
    // Minutas salvas antes do chip trazem `[nome]` como texto: viram nós na abertura. `aoMudar` só
    // dispara quando o usuário mexe, então isso não marca a minuta como "não salva" sozinho.
    //
    // ⚠️ E as salvas pelo editor ANTIGO trazem o alinhamento em `textAlign` (a chave do plugin de
    // então); o AlignKit atual só lê `align`. Sem a migração o título centralizado abre à esquerda
    // e, pior, realinhar aqui não mudava o HTML do contrato. Ver `lib/temis/migrar-documento.ts`.
    value: promoverVariaveisNoValor(paraOEditor(migrarAlinhamentoAntigo(valorInicial))),
  });
  const { hubUser } = useAuth();
  const [valorAtual, setValorAtual] = useState<ValorDoDocumento>(valorInicial);

  // A mídia enviada pelo editor (imagem, vídeo, arquivo) vai para `temis-minutas/<minutaId>/` no
  // bucket — o hook de upload lê daqui qual é a minuta aberta.
  useEffect(() => {
    setMinutaAtualParaUpload(minutaId);
    return () => setMinutaAtualParaUpload(null);
  }, [minutaId]);

  // A barra é renderizada pelo Plate, fora desta árvore de props: o `aoAvisar` da tela vai por
  // opção do plugin (a importação do .docx avisa por ele).
  useEffect(() => {
    editor.setOption(TemisToolbarPlugin, "aoAvisar", aoAvisar ?? null);
  }, [aoAvisar, editor]);

  // Comentários e sugestões assinados por quem está logado — o kit do registro vinha com "alice".
  useEffect(() => {
    if (!hubUser) return;
    editor.setOption(discussionPlugin, "users", {
      [hubUser.id]: { avatarUrl: hubUser.avatarUrl ?? "", id: hubUser.id, name: hubUser.name },
    });
    editor.setOption(discussionPlugin, "currentUserId", hubUser.id);
  }, [editor, hubUser]);

  // Quais variáveis JÁ estão no texto. O painel marca cada uma, e é isso que responde de relance a
  // pergunta que se faz o tempo todo numa minuta longa: "já coloquei o CPF do cônjuge?".
  const jaUsadas = useMemo(() => new Set(variaveisNoValor(valorAtual)), [valorAtual]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-subtle/30">
      {/* ⚠️ O PROVIDER DO TOOLTIP É OBRIGATÓRIO. Todo botão da barra com `tooltip` (withTooltip em
          components/ui/toolbar.tsx) monta o <Tooltip> do Radix depois do primeiro efeito, e o Radix
          lança "`Tooltip` must be used within `TooltipProvider`" — a árvore inteira do editor caía
          ao abrir a minuta. O hub não tem esse provider no layout (o editor é a única tela que usa
          o Tooltip do Radix), então ele vive aqui. */}
      <TooltipProvider delayDuration={300}>
        <Plate
          editor={editor}
          // ⚠️ `onValueChange`, e não `onChange`: o `onChange` dispara em TODA operação do Slate,
          // inclusive mover o cursor — um clique na folha marcava a minuta como "não salva",
          // travava o Publicar ("salve o rascunho antes") e reserializava o documento inteiro a
          // cada tecla de seta. `onValueChange` só dispara quando `editor.children` muda.
          onValueChange={({ value }) => {
            const convertido = paraOTemis(value);
            setValorAtual(convertido);
            aoMudar(convertido);
          }}
          readOnly={somenteLeitura}
        >
          <Miolo jaUsadas={jaUsadas} somenteLeitura={somenteLeitura} />
        </Plate>
      </TooltipProvider>

      {/* Um só por tela: os toasts do upload de mídia e do menu de IA (sonner) saem por aqui. */}
      <Toaster position="bottom-right" richColors />
    </div>
  );
}

/** A folha e o painel — dentro do `<Plate>`, para os hooks do editor funcionarem. */
function Miolo({ jaUsadas, somenteLeitura }: { jaUsadas: Set<string>; somenteLeitura?: boolean }) {
  const editor = useEditorRef();
  const painelAberto = usePluginOption(TemisToolbarPlugin, "painelAberto");

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* A FOLHA. O contêiner rola sozinho e ocupa toda a altura que sobrar; a barra fixa da Têmis
          entra pelo plugin (`render.beforeEditable`) e fica grudada no topo dele. */}
      <EditorContainer className="min-h-0 flex-1 bg-subtle/30 px-4 pb-5">
        <Editor
          className="mx-auto my-5 min-h-[65vh] max-w-[820px] rounded-lg bg-white px-14 py-12 text-[15px] leading-relaxed text-slate-900 shadow-sm outline-none dark:bg-slate-100 [&_table]:w-full [&_table]:table-fixed"
          placeholder="Cole aqui a minuta, importe o .docx do loteador, ou digite `[` para inserir uma variável."
          spellCheck={false}
          style={ESTILO_DA_FOLHA}
          variant="none"
        />
      </EditorContainer>

      {painelAberto && !somenteLeitura ? (
        <PainelDeVariaveis
          aoFechar={() => editor.setOption(TemisToolbarPlugin, "painelAberto", false)}
          editor={editor}
          jaUsadas={jaUsadas}
        />
      ) : null}
    </div>
  );
}

/**
 * A lista de variáveis, ao lado da folha.
 *
 * ⚠️ O PAINEL FICA AO LADO, ABERTO. Pedido do Lucas (01/09/2026): "a ideia das variveis, é abrir ao
 * lado e trazer elas separadas por grupos, seria mais facil de visualizar". Num menu suspenso,
 * escolher uma variável fecha a lista e apaga o contexto — e quem marca uma minuta de 27 páginas
 * insere dezenas seguidas. Ao lado, a lista fica de pé o tempo todo.
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
  editor: PlateEditor;
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
        <p className="m-0 mt-1.5 px-1 text-[10px] leading-tight text-ink-muted">
          Na folha, digite <kbd className="rounded border border-line px-1 font-mono">[</kbd> para
          escolher sem sair do teclado.
        </p>
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
                ? achadas.map((v) => {
                    const pendente = origemPendente(v);
                    return (
                      <button
                        className="group flex w-full flex-col items-start gap-0.5 rounded-lg py-1.5 pl-6 pr-2 text-left transition-colors hover:bg-subtle"
                        key={v.nome}
                        onClick={() => {
                          // Nó de variável, não texto: é o que impede a marca de partir o nome.
                          inserirVariavel(editor, v.nome);
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
                          {/* "pendente": está no catálogo, mas o Panteon ainda não tem a coluna.
                              Sai vazio no contrato até existir — e NUNCA se busca no C2X. */}
                          {pendente ? (
                            <span className="rounded bg-amber-100 px-1 text-[9px] font-semibold uppercase text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                              pendente
                            </span>
                          ) : null}
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
                    );
                  })
                : null}
            </section>
          );
        })}
      </div>
    </aside>
  );
}
