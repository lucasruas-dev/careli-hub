"use client";

import { importDocx } from "@platejs/docx-io";
import { Braces, FileUp, Loader2, PanelRight, Search } from "lucide-react";
import type { PluginConfig, Value } from "platejs";
import {
  createTPlatePlugin,
  useEditorPlugin,
  useEditorReadOnly,
  usePluginOption,
} from "platejs/react";
import { useRef } from "react";

import { FixedToolbar } from "@/components/ui/fixed-toolbar";
import { FixedToolbarButtons } from "@/components/ui/fixed-toolbar-buttons";
import { ToolbarButton, ToolbarGroup } from "@/components/ui/toolbar";

import { BarraDeBusca } from "./find-replace-kit";
import { promoverVariaveisNoValor } from "./variavel-kit-base";

// A BARRA FIXA DA TÊMIS — a barra completa do Plate UI mais os três botões que são nossos.
//
// Substitui o `FixedToolbarKit` do registro (mesma chave, `fixed-toolbar`), sem editar o
// `fixed-toolbar-buttons.tsx` gerado: ele é da Frente A e pode ser regenerado pelo CLI.
//
// O que SAIU daqui e por quê — pedido do Lucas (02/09/2026): *"não quero nada do c2x, todas as
// variáveis tem que nascer do panteon, esquece c2x como consulta"*. O botão "Do C2X", que trazia a
// minuta do legado, foi removido. A rota `/api/temis/minutas/c2x` fica no repositório sem ninguém
// chamá-la. O que entra no editor vem do .docx do loteador ou é escrito aqui.
//
// ⚠️ O ESTADO DA BARRA MORA NAS OPÇÕES DO PLUGIN (painel aberto, busca aberta, importando, o
// `aoAvisar` da tela): a barra é renderizada pelo Plate via `render.beforeEditable`, fora da árvore
// de props do componente do editor. Quem precisa ler ou mudar usa `usePluginOption`/`setOption`.

type OpcoesDaBarra = {
  /** Callback da tela para a faixa de aviso (a importação do .docx avisa por aqui). */
  aoAvisar: ((aviso: string) => void) | null;
  buscaAberta: boolean;
  importando: boolean;
  painelAberto: boolean;
};

export const TemisToolbarPlugin = createTPlatePlugin<PluginConfig<"fixed-toolbar", OpcoesDaBarra>>({
  key: "fixed-toolbar",
  options: {
    aoAvisar: null,
    buscaAberta: false,
    importando: false,
    // ⚠️ ABERTO POR PADRÃO. Pedido do Lucas (01/09/2026): "a ideia das variveis, é abrir ao lado e
    // trazer elas separadas por grupos, seria mais facil de visualizar".
    painelAberto: true,
  },
  render: {
    beforeEditable: () => <BarraDaTemis />,
  },
});

export const TemisToolbarKit = [TemisToolbarPlugin];

function BarraDaTemis() {
  const somenteLeitura = useEditorReadOnly();
  const { setOption } = useEditorPlugin(TemisToolbarPlugin);
  const buscaAberta = usePluginOption(TemisToolbarPlugin, "buscaAberta");

  return (
    <>
      <FixedToolbar>
        {/* `min-w-max`: os botões do Plate vêm com `w-full`; sem o invólucro, eles somados aos nossos
            estouram a largura e a barra ganha rolagem horizontal mesmo em tela larga. */}
        <div className="flex min-w-max flex-1">
          <FixedToolbarButtons />
        </div>

        {somenteLeitura ? null : (
          <ToolbarGroup>
            <BotaoImportarDocx />
            <BotaoBuscar />
            <BotaoVariaveis />
          </ToolbarGroup>
        )}
      </FixedToolbar>

      {buscaAberta && !somenteLeitura ? (
        <BarraDeBusca aoFechar={() => setOption("buscaAberta", false)} />
      ) : null}
    </>
  );
}

/**
 * Importar .docx POR CIMA do documento.
 *
 * ⚠️ SUBSTITUI, não acrescenta — e a confirmação diz isso antes. É o fluxo que o Lucas descreveu:
 * *"o fluxo é subir a minuta que chega do loteador, vou importar"*. O botão "Import" do Plate (ao
 * lado) INSERE no ponto do cursor, e serve para .md/.html; este é o da minuta inteira.
 *
 * ⚠️ O QUE O WORD PERDE NA CONVERSÃO É REAL: cabeçalho, rodapé, numeração automática de cláusula e
 * caixas de texto não atravessam. Por isso o aviso conta os avisos do conversor em vez de dizer
 * "importado com sucesso" — o jurídico precisa reler antes de publicar.
 */
function BotaoImportarDocx() {
  const { editor, getOption, setOption } = useEditorPlugin(TemisToolbarPlugin);
  const importando = usePluginOption(TemisToolbarPlugin, "importando");
  const input = useRef<HTMLInputElement>(null);

  const importar = async (arquivo: File) => {
    const aoAvisar = getOption("aoAvisar");
    setOption("importando", true);
    try {
      const buffer = await arquivo.arrayBuffer();
      const { nodes, warnings } = await importDocx(editor, buffer);

      if (!nodes.length) {
        aoAvisar?.("O arquivo foi lido, mas veio vazio. Confira se é mesmo um .docx.");
        return;
      }

      // As variáveis que o loteador escreveu como texto (`[nome_cliente]`) viram chips já na
      // entrada — é o mesmo tratamento de uma minuta antiga ao abrir.
      editor.tf.setValue(promoverVariaveisNoValor(nodes as Value));
      aoAvisar?.(
        warnings.length > 0
          ? `"${arquivo.name}" importada com ${warnings.length} aviso(s) de conversão. Releia antes de publicar: cabeçalho, rodapé e numeração automática do Word não atravessam.`
          : `"${arquivo.name}" importada. Releia antes de publicar: cabeçalho, rodapé e numeração automática do Word não atravessam.`,
      );
    } catch {
      aoAvisar?.("Não consegui ler este arquivo. Ele precisa ser .docx (Word), não .doc nem PDF.");
    } finally {
      setOption("importando", false);
    }
  };

  return (
    <>
      <ToolbarButton
        disabled={importando}
        onClick={() => input.current?.click()}
        tooltip="Importar .docx por cima deste documento"
      >
        {importando ? <Loader2 className="animate-spin" /> : <FileUp />}
        <span className="hidden xl:inline">Importar .docx</span>
      </ToolbarButton>
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
        ref={input}
        type="file"
      />
    </>
  );
}

function BotaoBuscar() {
  const { setOption } = useEditorPlugin(TemisToolbarPlugin);
  const aberta = usePluginOption(TemisToolbarPlugin, "buscaAberta");

  return (
    <ToolbarButton
      onClick={() => setOption("buscaAberta", !aberta)}
      pressed={aberta}
      tooltip="Buscar e substituir"
    >
      <Search />
    </ToolbarButton>
  );
}

/**
 * Mostra/esconde o painel de variáveis. O painel vive AO LADO da folha, não aqui — ver a nota em
 * `PainelDeVariaveis` (editor-de-minuta.tsx). Este botão só o esconde quando o jurídico quer a
 * folha inteira para reler.
 */
function BotaoVariaveis() {
  const { setOption } = useEditorPlugin(TemisToolbarPlugin);
  const aberto = usePluginOption(TemisToolbarPlugin, "painelAberto");

  return (
    <ToolbarButton
      className="data-[state=on]:bg-[#A07C3B] data-[state=on]:text-white data-[state=on]:hover:bg-[#8A6A32]"
      onClick={() => setOption("painelAberto", !aberto)}
      pressed={aberto}
      tooltip={aberto ? "Esconder as variáveis" : "Mostrar as variáveis"}
    >
      {aberto ? <PanelRight /> : <Braces />}
      <span className="hidden xl:inline">Variáveis</span>
    </ToolbarButton>
  );
}
