import type { ChatMessage } from "@/components/editor/use-chat";
import type { SlateEditor } from "platejs";

import dedent from "dedent";

import {
  addSelection,
  buildStructuredPrompt,
  formatTextFromMessages,
  getLastUserInstruction,
  getMarkdownWithSelection,
  isMultiBlocks,
  isSelectionInTable,
  isSingleCellSelection,
} from "../utils";

import { commonEditRules } from "./common";
import { buildEditTableMultiCellPrompt } from "./getEditTablePrompt";

// EDIÇÃO in-place. Três formas, decididas em `getEditPrompt`:
//   - várias células de tabela → ferramenta `table` (JSON por célula);
//   - vários blocos → devolve os blocos reescritos em markdown, mesma contagem;
//   - trecho dentro de um bloco → devolve só o substituto do trecho <Selection>.
function buildEditMultiBlockPrompt(editor: SlateEditor, messages: ChatMessage[]) {
  const selectingMarkdown = getMarkdownWithSelection(editor);

  return buildStructuredPrompt({
    context: selectingMarkdown,
    examples: [
      dedent`
        <instruction>
        Corrija a gramática.
        </instruction>

        <context>
        # Do Preço
        O COMPRADOR pagará o preço em 60 parcela mensal.
        </context>

        <output>
        # Do Preço
        O COMPRADOR pagará o preço em 60 parcelas mensais.
        </output>
      `,
      dedent`
        <instruction>
        Deixe o tom mais formal.
        </instruction>

        <context>
        ## Da Posse
        O comprador pode entrar no lote assim que assinar.
        </context>

        <output>
        ## Da Posse
        O COMPRADOR será imitido na posse do lote na data da assinatura deste instrumento.
        </output>
      `,
      dedent`
        <instruction>
        Deixe mais conciso sem perder o sentido.
        </instruction>

        <context>
        O presente instrumento tem por finalidade regular, de forma detalhada, todas as condições que dizem respeito à compra e venda do lote descrito, tal como descrito em [unidade_descricao].
        </context>

        <output>
        Este instrumento regula as condições da compra e venda do lote descrito em [unidade_descricao].
        </output>
      `,
    ],
    history: formatTextFromMessages(messages),
    instruction: getLastUserInstruction(messages),
    outputFormatting: "markdown",
    rules: dedent`
      ${commonEditRules}
      - Preserve a quantidade de blocos, as quebras de linha e toda a sintaxe Markdown existente; altere só o texto dentro de cada bloco.
      - Não mude níveis de título, marcadores de lista, URLs de link nem adicione/remova linhas em branco, salvo instrução explícita.
    `,
    task: dedent`
      O <context> a seguir é conteúdo Markdown da minuta que precisa ser melhorado.
      Sua resposta substitui o conteúdo original no lugar, sem costura.
    `,
  });
}

function buildEditSelectionPrompt(editor: SlateEditor, messages: ChatMessage[]) {
  addSelection(editor);

  const selectingMarkdown = getMarkdownWithSelection(editor);
  const endIndex = selectingMarkdown.indexOf("<Selection>");
  const prefilledResponse = endIndex === -1 ? "" : selectingMarkdown.slice(0, endIndex);

  return buildStructuredPrompt({
    context: selectingMarkdown,
    examples: [
      dedent`
        <instruction>
        Melhore a escolha de palavras.
        </instruction>

        <context>
        O COMPRADOR se compromete a <Selection>pagar direitinho</Selection> as parcelas.
        </context>

        <output>
        adimplir pontualmente
        </output>
      `,
      dedent`
        <instruction>
        Corrija a gramática.
        </instruction>

        <context>
        As partes <Selection>elege</Selection> o foro da comarca de [empreendimento_cidade].
        </context>

        <output>
        elegem
        </output>
      `,
      dedent`
        <instruction>
        Deixe mais formal.
        </instruction>

        <context>
        <Selection>Se o comprador não pagar</Selection>, incide multa de 2%.
        </context>

        <output>
        Em caso de inadimplemento do COMPRADOR
        </output>
      `,
      dedent`
        <instruction>
        Deixe mais assertivo.
        </instruction>

        <context>
        O VENDEDOR <Selection>tentará entregar</Selection> a infraestrutura no prazo.
        </context>

        <output>
        entregará
        </output>
      `,
      dedent`
        <instruction>
        Simplifique a linguagem.
        </instruction>

        <context>
        A obrigação <Selection>reputar-se-á integralmente adimplida</Selection> com a quitação.
        </context>

        <output>
        será considerada cumprida
        </output>
      `,
      dedent`
        <instruction>
        Expanda a descrição.
        </instruction>

        <context>
        O lote possui <Selection>infraestrutura</Selection>.
        </context>

        <output>
        infraestrutura completa de água, energia elétrica, drenagem pluvial e pavimentação asfáltica
        </output>
      `,
      dedent`
        <instruction>
        Deixe mais natural.
        </instruction>

        <context>
        O COMPRADOR <Selection>fez o pagamento de</Selection> o sinal de [valor_sinal].
        </context>

        <output>
        pagou
        </output>
      `,
    ],
    history: formatTextFromMessages(messages),
    instruction: getLastUserInstruction(messages),
    outputFormatting: "markdown",
    prefilledResponse,
    rules: dedent`
      ${commonEditRules}
      - Sua resposta será concatenada diretamente ao prefilledResponse: garanta que o resultado fique fluido e coerente.
      - Use o texto ao redor no <context> para o substituto encaixar com naturalidade.
    `,
    task: dedent`
      O <context> a seguir contém tags <Selection> marcando a parte editável.
      Devolva SOMENTE o substituto do texto selecionado.
    `,
  });
}

export function getEditPrompt(
  editor: SlateEditor,
  { isSelecting, messages }: { isSelecting: boolean; messages: ChatMessage[] },
): [string, "table" | "multi-block" | "selection"] {
  if (!isSelecting) throw new Error("A ferramenta de edição só funciona com texto selecionado.");

  // Seleção dentro de tabela (mais de uma célula)
  if (isSelectionInTable(editor) && !isSingleCellSelection(editor)) {
    return [buildEditTableMultiCellPrompt(editor, messages), "table"];
  }
  // Vários blocos
  if (isMultiBlocks(editor)) {
    return [buildEditMultiBlockPrompt(editor, messages), "multi-block"];
  }

  // Um bloco com seleção
  return [buildEditSelectionPrompt(editor, messages), "selection"];
}
