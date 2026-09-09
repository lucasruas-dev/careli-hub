"use client";

import { importDocx } from "@platejs/docx-io";
import {
  BaselineIcon,
  BoldIcon,
  Braces,
  Code2Icon,
  FileUp,
  HighlighterIcon,
  ItalicIcon,
  Loader2,
  PaintBucketIcon,
  PanelRight,
  Scissors,
  Search,
  SlidersHorizontal,
  StrikethroughIcon,
  UnderlineIcon,
  Wand2,
} from "lucide-react";
import { KEYS, type PluginConfig, type Value } from "platejs";
import {
  createTPlatePlugin,
  useEditorPlugin,
  useEditorReadOnly,
  usePluginOption,
} from "platejs/react";
import { useRef, useState } from "react";

import { AlignToolbarButton } from "@/components/ui/align-toolbar-button";
import { CommentToolbarButton } from "@/components/ui/comment-toolbar-button";
import { EmojiToolbarButton } from "@/components/ui/emoji-toolbar-button";
import { ExportToolbarButton } from "@/components/ui/export-toolbar-button";
import { FixedToolbar } from "@/components/ui/fixed-toolbar";
import { FontColorToolbarButton } from "@/components/ui/font-color-toolbar-button";
import { FontSizeToolbarButton } from "@/components/ui/font-size-toolbar-button";
import { RedoToolbarButton, UndoToolbarButton } from "@/components/ui/history-toolbar-button";
import { ImportToolbarButton } from "@/components/ui/import-toolbar-button";
import { IndentToolbarButton, OutdentToolbarButton } from "@/components/ui/indent-toolbar-button";
import { InsertToolbarButton } from "@/components/ui/insert-toolbar-button";
import { LineHeightToolbarButton } from "@/components/ui/line-height-toolbar-button";
import { LinkToolbarButton } from "@/components/ui/link-toolbar-button";
import {
  BulletedListToolbarButton,
  NumberedListToolbarButton,
  TodoListToolbarButton,
} from "@/components/ui/list-toolbar-button";
import { MarkToolbarButton } from "@/components/ui/mark-toolbar-button";
import { MediaToolbarButton } from "@/components/ui/media-toolbar-button";
import { ModeToolbarButton } from "@/components/ui/mode-toolbar-button";
import { MoreToolbarButton } from "@/components/ui/more-toolbar-button";
import { TableToolbarButton } from "@/components/ui/table-toolbar-button";
import { ToggleToolbarButton } from "@/components/ui/toggle-toolbar-button";
import { ToolbarButton, ToolbarGroup } from "@/components/ui/toolbar";
import { TurnIntoToolbarButton } from "@/components/ui/turn-into-toolbar-button";

import { BarraDeBusca } from "./find-replace-kit";
import { noDeQuebraDePagina } from "./quebra-de-pagina-base";
import { SeletorDeFonte } from "./seletor-de-fonte";
import { promoverVariaveisNoValor } from "./variavel-kit-base";

// A BARRA FIXA DA TÊMIS — a organização é NOSSA, os botões continuam sendo os do Plate UI.
//
// Substitui o `FixedToolbarKit` do registro (mesma chave, `fixed-toolbar`).
//
// ⚠️ ELA NÃO CHAMA MAIS O `FixedToolbarButtons`. Aquele arquivo é gerado pelo CLI do Plate e monta
// TODOS os botões numa linha só; era ele que estourava a largura. Aqui a composição é nossa e os
// botões vêm um a um de `components/ui/*-toolbar-button.tsx` — arquivos gerados que continuamos
// apenas IMPORTANDO, nunca editando. Uma regeração do CLI não desfaz esta tela.
// (`components/ui/fixed-toolbar-buttons.tsx` fica no repositório servindo o `FixedToolbarKit` do
// registro, que nenhuma tela deste app monta hoje.)
//
// ⚠️ POR QUE A BARRA NÃO CABIA — números MEDIDOS em 08/09/2026, montando a marcação de cada
// controle no navegador contra o CSS compilado deste app (o editor exige sessão, então a medição
// foi da régua de cada peça, não da tela pronta): botão de ícone 32 px · com seta de menu 44 px ·
// partido (listas, mídia) 48 px · separador de grupo 13 px · tamanho da fonte 112 px · estilo do
// bloco 125 px · seletor de fonte antigo 203 px com o rótulo "Lucida Sans Unicode".
//
//   antes  1.976 px numa linha só (2.005 px nas duas minutas que estão no ar, que gravam
//          "Lucida Sans Unicode") — 41 controles em 13 grupos
//   folga  1.286 px  no monitor do Lucas: 1920, barra lateral da Têmis aberta, painel de variáveis
//          aberto (1920 − 240 da lateral − 32 do respiro − 320 do painel − 32 do contêiner − 8
//          do `p-1`)
//   folga    732 px  num notebook de 1366 nas mesmas condições
//
// Ou seja: nem em 1920 maximizado cabia — faltavam 690 px, ~65% de zoom, que é exatamente o que o
// Lucas estava fazendo à mão (08/09/2026: *"estou tendo que reduzir o zoom da página para ver todos
// os botões"*). E ele não via QUANTO faltava porque o `FixedToolbar` do registro vem com
// `overflow-x-auto` MAIS `scrollbar-hide`: a barra rolava para o lado sem nada na tela dizendo que
// continuava.
//
// ⚠️ O QUE FICA VISÍVEL É O QUE O JURÍDICO USA NO CONTRATO, não o que o Plate oferece. Linha de
// cima: desfazer/refazer, estilo do bloco, fonte e tamanho, negrito/itálico/sublinhado, alinhamento,
// listas, recuo, link, tabela, e os cinco que são nossos (variáveis, agente, busca, quebra de
// página, importar .docx). O resto — cor, realce, riscado, código, emoji, mídia, equação, colunas,
// data, comentário, exportar/importar do Plate — vive na segunda linha, que só aparece quando
// alguém pede. Medido do mesmo jeito: linha de cima 1.218 px, segunda linha 747 px.
//
// ⚠️ E A LINHA QUEBRA EM VEZ DE CORTAR (`flex-wrap`, sem `overflow-x-auto`). Os 1.218 px cabem nos
// 1.286 do monitor do Lucas com o painel aberto, e sobra folga com ele fechado (1.606). NÃO cabem
// nos 732 px de um 1366 com o painel aberto — e nenhuma organização caberia: 732 px é o espaço de
// uns onze botões de ícone, menos do que a lista do que o jurídico usa toda hora. Nessa largura a
// barra passa a ocupar duas linhas e continua INTEIRA; antes ela sumia para fora da tela. Quem está
// no 1366 e quer uma linha só fecha o painel de variáveis (devolve 320 px) e recolhe a barra
// lateral da Têmis (mais 168 px): aí são 1.220 px e a linha fecha.
//
// O que SAIU daqui e por quê — pedido do Lucas (02/09/2026): *"não quero nada do c2x, todas as
// variáveis tem que nascer do panteon, esquece c2x como consulta"*. O botão "Do C2X", que trazia a
// minuta do legado, foi removido. A rota `/api/temis/minutas/c2x` fica no repositório sem ninguém
// chamá-la. O que entra no editor vem do .docx do loteador ou é escrito aqui.
//
// ⚠️ O BOTÃO DE IA GENÉRICO DO PLATE (`AIToolbarButton`) NÃO ENTRA em nenhuma das duas linhas. Ele
// reescreve o texto selecionado, e num editor de CONTRATO isso é perigoso: a IA não conhece o
// catálogo e transforma `[nome_cliente]` em `[nome do cliente]`, que sai impresso no papel assinado.
// Foi assim que `[Nome]` e `[CPF]` entraram nas minutas do legado. Quem faz esse trabalho aqui é o
// botão "Agente", que PROPÕE em vez de reescrever. Lucas (07/09/2026): *"tem dois botões de AI"*.
//
// ⚠️ O ESTADO DA BARRA MORA NAS OPÇÕES DO PLUGIN (painel aberto, busca aberta, importando, o
// `aoAvisar` da tela): a barra é renderizada pelo Plate via `render.beforeEditable`, fora da árvore
// de props do componente do editor. Quem precisa ler ou mudar usa `usePluginOption`/`setOption`.

type OpcoesDaBarra = {
  /** Callback da tela para a faixa de aviso (a importação do .docx avisa por aqui). */
  aoAvisar: ((aviso: string) => void) | null;
  buscaAberta: boolean;
  importando: boolean;
  /** O agente está lendo a minuta agora. Trava o botão e mostra que há trabalho em curso. */
  marcando: boolean;
  /** Sobe quando alguém pede a marcação: o painel escuta e dispara a leitura. */
  pedidoDeMarcacao: number;
  painelAberto: boolean;
};

export const TemisToolbarPlugin = createTPlatePlugin<PluginConfig<"fixed-toolbar", OpcoesDaBarra>>({
  key: "fixed-toolbar",
  options: {
    aoAvisar: null,
    buscaAberta: false,
    importando: false,
    marcando: false,
    pedidoDeMarcacao: 0,
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
  const { getOption, setOption } = useEditorPlugin(TemisToolbarPlugin);
  const buscaAberta = usePluginOption(TemisToolbarPlugin, "buscaAberta");

  // ⚠️ ESTADO LOCAL, E NÃO OPÇÃO DO PLUGIN, PORQUE NINGUÉM MAIS PRECISA DELE. `buscaAberta` mora nas
  // opções porque a `BarraDeBusca` é irmã da barra; a segunda linha é filha dela. O `useState`
  // sobrevive aos redesenhos do Plate: `beforeEditable` devolve um elemento novo a cada render, mas
  // do MESMO tipo, então o React preserva o estado do componente.
  const [maisAberto, setMaisAberto] = useState(false);

  return (
    <>
      {/* `flex-col items-stretch` empilha as duas linhas; `overflow-x-visible` desliga a rolagem
          horizontal escondida que o `FixedToolbar` do registro traz — quem não couber quebra para a
          linha de baixo, dentro de cada linha, pelo `flex-wrap`. */}
      <FixedToolbar className="flex-col items-stretch justify-start gap-y-1 overflow-x-visible">
        <div className="flex w-full flex-wrap items-center">
          {somenteLeitura ? (
            // ⚠️ EM LEITURA A BARRA É OUTRA, e é a mesma de antes desta reorganização: só realce e
            // comentário, que é o que faz sentido para quem está conferindo e não pode escrever.
            // Ferramenta de edição na tela de quem não edita é botão que não responde ao clique.
            <ToolbarGroup>
              <MarkToolbarButton nodeType={KEYS.highlight} tooltip="Realce">
                <HighlighterIcon />
              </MarkToolbarButton>
              <CommentToolbarButton />
            </ToolbarGroup>
          ) : (
            <>
              <ToolbarGroup>
                <UndoToolbarButton />
                <RedoToolbarButton />
              </ToolbarGroup>

              <ToolbarGroup>
                <TurnIntoToolbarButton />
              </ToolbarGroup>

              {/* ⚠️ FONTE E TAMANHO NO MESMO GRUPO. Antes a fonte ficava na ponta direita, junto
                  dos botões da Têmis, e o tamanho aqui no meio — não era desenho, era o lugar onde
                  cada arquivo vivia. É o par que todo mundo espera ver junto (Word, Google Docs), e
                  juntar economiza um separador. */}
              <ToolbarGroup>
                <SeletorDeFonte aoAvisar={(aviso) => getOption("aoAvisar")?.(aviso)} />
                <FontSizeToolbarButton />
              </ToolbarGroup>

              <ToolbarGroup>
                <MarkToolbarButton nodeType={KEYS.bold} tooltip="Negrito (⌘+B)">
                  <BoldIcon />
                </MarkToolbarButton>

                <MarkToolbarButton nodeType={KEYS.italic} tooltip="Itálico (⌘+I)">
                  <ItalicIcon />
                </MarkToolbarButton>

                <MarkToolbarButton nodeType={KEYS.underline} tooltip="Sublinhado (⌘+U)">
                  <UnderlineIcon />
                </MarkToolbarButton>
              </ToolbarGroup>

              <ToolbarGroup>
                <AlignToolbarButton />
                <NumberedListToolbarButton />
                <BulletedListToolbarButton />
                <OutdentToolbarButton />
                <IndentToolbarButton />
              </ToolbarGroup>

              <ToolbarGroup>
                <LinkToolbarButton />
                <TableToolbarButton />
                <BotaoQuebraDePagina />
              </ToolbarGroup>

              {/* Os nossos. O painel de variáveis vem primeiro: é o que o jurídico mais usa
                  depois do próprio texto. */}
              <ToolbarGroup>
                <BotaoVariaveis />
                <BotaoSuperAgente />
                <BotaoBuscar />
                <BotaoImportarDocx />
              </ToolbarGroup>

              <ToolbarGroup>
                <BotaoMaisFerramentas
                  aberto={maisAberto}
                  aoAlternar={() => setMaisAberto((v) => !v)}
                />
              </ToolbarGroup>
            </>
          )}

          {/* `ml-auto`: o modo de edição é indicador, não ferramenta — fica na ponta, longe de onde
              a mão trabalha. Sendo o último grupo da linha, o separador dele some sozinho. */}
          <ToolbarGroup className="ml-auto">
            <ModeToolbarButton />
          </ToolbarGroup>
        </div>

        {maisAberto && !somenteLeitura ? (
          <div className="flex w-full flex-wrap items-center border-t border-border pt-1">
            <ToolbarGroup>
              <InsertToolbarButton />
              <TodoListToolbarButton />
              <ToggleToolbarButton />
              <LineHeightToolbarButton />
            </ToolbarGroup>

            <ToolbarGroup>
              <MarkToolbarButton nodeType={KEYS.strikethrough} tooltip="Tachado (⌘+⇧+M)">
                <StrikethroughIcon />
              </MarkToolbarButton>

              <MarkToolbarButton nodeType={KEYS.code} tooltip="Código (⌘+E)">
                <Code2Icon />
              </MarkToolbarButton>

              <FontColorToolbarButton nodeType={KEYS.color} tooltip="Cor do texto">
                <BaselineIcon />
              </FontColorToolbarButton>

              <FontColorToolbarButton nodeType={KEYS.backgroundColor} tooltip="Cor de fundo">
                <PaintBucketIcon />
              </FontColorToolbarButton>

              <MarkToolbarButton nodeType={KEYS.highlight} tooltip="Realce">
                <HighlighterIcon />
              </MarkToolbarButton>

              <MoreToolbarButton />
            </ToolbarGroup>

            <ToolbarGroup>
              <EmojiToolbarButton />
              <MediaToolbarButton nodeType={KEYS.img} />
              <MediaToolbarButton nodeType={KEYS.video} />
              <MediaToolbarButton nodeType={KEYS.audio} />
              <MediaToolbarButton nodeType={KEYS.file} />
            </ToolbarGroup>

            <ToolbarGroup>
              <CommentToolbarButton />
              <ExportToolbarButton />
              <ImportToolbarButton />
            </ToolbarGroup>
          </div>
        ) : null}
      </FixedToolbar>

      {buscaAberta && !somenteLeitura ? (
        <BarraDeBusca aoFechar={() => setOption("buscaAberta", false)} />
      ) : null}
    </>
  );
}

/**
 * Abre e fecha a segunda linha da barra.
 *
 * ⚠️ SEGUNDA LINHA, E NÃO UM MENU SUSPENSO. Cor, realce, mídia e companhia são botões de barra de
 * verdade — cada um abre o próprio menu do Radix. Enfiá-los dentro de outro menu empilharia portal
 * sobre portal e o clique de dentro fecharia o de fora. Numa linha própria eles se comportam
 * exatamente como se comportavam, e a linha só existe enquanto alguém precisa dela: fechada, ela não
 * come um pixel da folha.
 */
function BotaoMaisFerramentas({ aberto, aoAlternar }: { aberto: boolean; aoAlternar: () => void }) {
  return (
    <ToolbarButton
      onClick={aoAlternar}
      pressed={aberto}
      tooltip={
        aberto
          ? "Esconder as ferramentas de formatação"
          : "Mais formatação: cor, realce, mídia, tabela de conteúdo, exportar…"
      }
    >
      <SlidersHorizontal />
    </ToolbarButton>
  );
}

/**
 * Importar .docx POR CIMA do documento.
 *
 * ⚠️ SUBSTITUI, não acrescenta — e a confirmação diz isso antes. É o fluxo que o Lucas descreveu:
 * *"o fluxo é subir a minuta que chega do loteador, vou importar"*. O botão "Import" do Plate (na
 * segunda linha) INSERE no ponto do cursor, e serve para .md/.html; este é o da minuta inteira.
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

/**
 * Inserir uma quebra de página no ponto do cursor.
 *
 * Pergunta do Lucas (08/09/2026): *"queria saber onde é a quebra de página"* — não era. O contrato
 * era texto corrido e o corte da folha era o que o motor de impressão decidisse, o que serve para um
 * documento de leitura e não serve para um instrumento onde a peça anexa começa em folha nova.
 *
 * ⚠️ ELA ENTRA COMO BLOCO PRÓPRIO, ANTES DA LINHA ATUAL. Inserir "depois" pareceria mais natural ao
 * clicar, mas quem pede a quebra está com o cursor no começo do trecho que quer empurrar para a
 * folha seguinte — é o gesto do Word (Ctrl+Enter), e é o que o bloco de corretagem faz sozinho.
 */
function BotaoQuebraDePagina() {
  const { editor } = useEditorPlugin(TemisToolbarPlugin);

  return (
    <ToolbarButton
      onClick={() => {
        editor.tf.focus();
        editor.tf.insertNodes(noDeQuebraDePagina());
      }}
      tooltip="Quebra de página — o texto seguinte começa em uma folha nova"
    >
      <Scissors />
    </ToolbarButton>
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
 * O SUPER AGENTE — lê a minuta e diz onde cada variável entra.
 *
 * Pedido do Lucas (07/09/2026): *"um super agente que consiga inserir as variáveis, olhar o texto e
 * identificar onde as variáveis vão, e conhece todas as variáveis"*. Roda em Opus 5.
 *
 * ⚠️ ELE PROPÕE, NÃO REESCREVE. O botão não muda uma vírgula do contrato: manda o texto, recebe uma
 * lista de "este trecho é esta variável", e cada proposta é aceita por quem está lendo. A razão está
 * inteira em `lib/temis/marcar-variaveis.ts` — a curta é que uma IA reescrevendo instrumento
 * jurídico muda palavra que ninguém pediu, e ninguém confere 60 mil caracteres para achar.
 *
 * O botão só levanta um pedido; quem lê o documento e chama a rota é o painel, que já tem o valor em
 * mãos. Assim a barra não precisa conhecer o conteúdo da folha.
 */
function BotaoSuperAgente() {
  const { setOption } = useEditorPlugin(TemisToolbarPlugin);
  const marcando = usePluginOption(TemisToolbarPlugin, "marcando");
  const pedidos = usePluginOption(TemisToolbarPlugin, "pedidoDeMarcacao");

  return (
    <ToolbarButton
      className="data-[state=on]:bg-[#A07C3B] data-[state=on]:text-white"
      disabled={marcando}
      onClick={() => {
        // Abre o painel junto: é lá que as propostas aparecem, e sem isso o clique não teria
        // resposta visível.
        setOption("painelAberto", true);
        setOption("pedidoDeMarcacao", pedidos + 1);
      }}
      tooltip={
        marcando
          ? "Lendo a minuta…"
          : "Ler a minuta e propor onde entram as variáveis (não altera o texto)"
      }
    >
      {marcando ? <Loader2 className="animate-spin" /> : <Wand2 />}
    </ToolbarButton>
  );
}

/**
 * Mostra/esconde o painel lateral. Ele vive AO LADO da folha, não aqui — ver a nota em
 * `PainelLateral` (editor-de-minuta.tsx). Este botão só o esconde quando o jurídico quer a folha
 * inteira para reler.
 *
 * ⚠️ E É ELE QUE DEVOLVE 320 px PARA A BARRA. O painel é `w-80` e fica ao lado do contêiner do
 * editor: com ele aberto num 1366 sobram 732 px para a barra, fechado sobram 1.052. Quem trabalha
 * em tela pequena e quer a barra numa linha só fecha o painel — e o botão está sempre à mão.
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
    </ToolbarButton>
  );
}
