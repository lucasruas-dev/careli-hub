"use client";

import { FindReplacePlugin } from "@platejs/find-replace";
import { ChevronDown, Replace, ReplaceAll, X } from "lucide-react";
import { type Descendant, type Path, PointApi, type SlateEditor, type TRange } from "platejs";
import {
  PlateLeaf,
  type PlateLeafProps,
  useEditorPlugin,
  useEditorSelector,
  usePluginOption,
} from "platejs/react";
import { useState } from "react";

// BUSCAR E SUBSTITUIR. Não há item no registro do Plate para isto: o pacote `@platejs/find-replace`
// é só o realce (a decoração `search_highlight`); a barra e a substituição são nossas, conforme a
// doc ("Replace actions: app code").
//
// ⚠️ O QUE A BUSCA NÃO VÊ: pela doc, o Plate só decora blocos cujos filhos são TODOS texto. Um
// parágrafo com um chip de variável no meio não ganha realce. A contagem e a substituição abaixo
// varrem os trechos de texto um a um (o chip é void e nunca é tocado), então "Substituir todas"
// alcança esses parágrafos mesmo sem o amarelo — e uma ocorrência partida entre dois trechos
// (metade em negrito, metade não) não é achada por nenhum dos dois.

export function SearchHighlightLeaf(props: PlateLeafProps) {
  return <PlateLeaf {...props} className="bg-yellow-200 text-slate-900" />;
}

export const FindReplaceKit = [
  FindReplacePlugin.configure({ render: { node: SearchHighlightLeaf } }),
];

type Ocorrencia = TRange;

function ehTexto(no: Descendant): no is Descendant & { text: string } {
  return typeof (no as { text?: unknown }).text === "string";
}

/** Todas as ocorrências (sem distinguir maiúsculas), na ordem do documento, trecho a trecho. */
export function ocorrenciasNoValor(nos: readonly Descendant[], busca: string): Ocorrencia[] {
  const alvo = busca.toLowerCase();
  if (!alvo) return [];
  const saida: Ocorrencia[] = [];

  const andar = (lista: readonly Descendant[], caminho: Path) => {
    lista.forEach((no, i) => {
      const path = [...caminho, i];
      if (ehTexto(no)) {
        const texto = no.text.toLowerCase();
        let desde = 0;
        for (;;) {
          const pos = texto.indexOf(alvo, desde);
          if (pos < 0) break;
          saida.push({
            anchor: { offset: pos, path },
            focus: { offset: pos + alvo.length, path },
          });
          desde = pos + alvo.length;
        }
        return;
      }
      const filhos = (no as { children?: Descendant[] }).children;
      if (Array.isArray(filhos)) andar(filhos, path);
    });
  };

  andar(nos, []);
  return saida;
}

/** A próxima ocorrência depois da seleção; volta ao início quando acaba. */
function proximaOcorrencia(editor: SlateEditor, busca: string): null | Ocorrencia {
  const todas = ocorrenciasNoValor(editor.children, busca);
  if (todas.length === 0) return null;

  const selecao = editor.selection;
  if (!selecao) return todas[0] ?? null;

  // Seleção expandida (a ocorrência atual): a próxima é a que começa DEPOIS do início dela.
  // Colapsada: a primeira que começa no cursor ou depois.
  const referencia = editor.api.isCollapsed() ? selecao.focus : selecao.anchor;
  const depois = todas.find((o) =>
    editor.api.isCollapsed()
      ? !PointApi.isBefore(o.anchor, referencia)
      : PointApi.isAfter(o.anchor, referencia),
  );
  return depois ?? todas[0] ?? null;
}

/**
 * Troca todas as ocorrências. De trás para frente, para os offsets já visitados continuarem
 * válidos depois de cada troca.
 */
function substituirTodas(editor: SlateEditor, busca: string, por: string) {
  const todas = ocorrenciasNoValor(editor.children, busca);
  if (todas.length === 0) return 0;
  editor.tf.withoutNormalizing(() => {
    for (const ocorrencia of [...todas].reverse()) {
      editor.tf.insertText(por, { at: ocorrencia });
    }
  });
  return todas.length;
}

export function BarraDeBusca({ aoFechar }: { aoFechar: () => void }) {
  const { editor, setOption } = useEditorPlugin(FindReplacePlugin);
  const busca = usePluginOption(FindReplacePlugin, "search") ?? "";
  const [por, setPor] = useState("");
  const quantas = useEditorSelector((ed) => ocorrenciasNoValor(ed.children, busca).length, [busca]);

  const definirBusca = (valor: string) => {
    setOption("search", valor);
    editor.api.redecorate();
  };

  const proxima = () => {
    const alvo = proximaOcorrencia(editor, busca);
    if (!alvo) return;
    editor.tf.select(alvo);
    editor.tf.focus();
  };

  // "Substituir" troca a ocorrência selecionada (se a seleção for exatamente ela) e pula para a
  // próxima; se a seleção for outra coisa, só seleciona a próxima — nunca troca o que o jurídico
  // não está vendo.
  const substituir = () => {
    if (!busca) return;
    const selecao = editor.selection;
    const selecionadaEhOcorrencia =
      !!selecao &&
      !editor.api.isCollapsed() &&
      editor.api.string(selecao).toLowerCase() === busca.toLowerCase();
    if (selecionadaEhOcorrencia) editor.tf.insertText(por);
    editor.api.redecorate();
    proxima();
  };

  const substituirTudo = () => {
    if (!busca) return;
    substituirTodas(editor, busca, por);
    editor.api.redecorate();
    editor.tf.focus();
  };

  const campo =
    "h-8 min-w-0 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-ring";
  const botao =
    "inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-40";

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-background/95 px-2 py-1.5">
      <input
        aria-label="Buscar no documento"
        autoFocus
        className={`${campo} w-56`}
        onChange={(e) => definirBusca(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            proxima();
          }
          if (e.key === "Escape") aoFechar();
        }}
        placeholder="Buscar…"
        type="search"
        value={busca}
      />
      <span className="w-20 text-xs tabular-nums text-muted-foreground">
        {busca ? `${quantas} ocorrência${quantas === 1 ? "" : "s"}` : ""}
      </span>
      <button className={botao} disabled={quantas === 0} onClick={proxima} title="Próxima ocorrência (Enter)" type="button">
        <ChevronDown aria-hidden="true" className="size-4" />
        Próxima
      </button>

      <input
        aria-label="Substituir por"
        className={`${campo} w-56`}
        onChange={(e) => setPor(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            substituir();
          }
          if (e.key === "Escape") aoFechar();
        }}
        placeholder="Substituir por…"
        type="text"
        value={por}
      />
      <button className={botao} disabled={quantas === 0} onClick={substituir} title="Substituir a selecionada e ir para a próxima" type="button">
        <Replace aria-hidden="true" className="size-4" />
        Substituir
      </button>
      <button className={botao} disabled={quantas === 0} onClick={substituirTudo} title="Substituir todas as ocorrências" type="button">
        <ReplaceAll aria-hidden="true" className="size-4" />
        Todas
      </button>

      <span className="flex-1" />
      <button
        aria-label="Fechar a busca"
        className={botao}
        onClick={() => {
          definirBusca("");
          aoFechar();
        }}
        type="button"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
