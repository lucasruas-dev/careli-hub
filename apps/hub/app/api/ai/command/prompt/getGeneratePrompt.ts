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
} from "../utils";
import { commonGenerateRules } from "./common";

// GERAÇÃO. Sem seleção: pedido livre (o modelo escreve cláusula/parágrafo do zero). Com seleção:
// o trecho vai como <context> e é a única fonte (resumir, explicar, tabela, etc.).
function buildGenerateFreeformPrompt(messages: ChatMessage[]) {
  return buildStructuredPrompt({
    examples: [
      dedent`
        <instruction>
        Escreva uma cláusula de foro de eleição
        </instruction>

        <output>
        As partes elegem o foro da comarca de [empreendimento_cidade], Estado de [empreendimento_uf], com renúncia expressa a qualquer outro, por mais privilegiado que seja, para dirimir quaisquer dúvidas ou controvérsias oriundas deste contrato.
        </output>
      `,
      dedent`
        <instruction>
        Escreva três obrigações do comprador em lista
        </instruction>

        <output>
        1. Pagar pontualmente as parcelas do preço, nas datas e valores ajustados neste instrumento.
        2. Arcar com o IPTU e as demais taxas incidentes sobre o lote a partir da imissão na posse.
        3. Observar as restrições urbanísticas e o regulamento do loteamento.
        </output>
      `,
      dedent`
        <instruction>
        Qual a diferença entre sinal e entrada?
        </instruction>

        <output>
        O sinal (arras) é a quantia paga na assinatura como garantia e princípio de pagamento; a entrada é a parcela inicial do preço, que pode ser maior que o sinal e ser dividida. No contrato, o sinal costuma aparecer como [valor_sinal] e a entrada como [valor_entrada].
        </output>
      `,
    ],
    history: formatTextFromMessages(messages),
    instruction: getLastUserInstruction(messages),
    rules: commonGenerateRules,
    task: dedent`
      Você é um assistente avançado de redação jurídica para minutas de contrato de compra e venda de lote.
      Gere o conteúdo pedido pelo usuário.
      Produza o resultado final diretamente, sem pedir informações adicionais.
    `,
  });
}

function buildGenerateContextPrompt(editor: SlateEditor, messages: ChatMessage[]) {
  if (!isMultiBlocks(editor)) {
    addSelection(editor);
  }

  const selectingMarkdown = getMarkdownWithSelection(editor);

  return buildStructuredPrompt({
    context: selectingMarkdown,
    examples: [
      dedent`
        <instruction>
        Resuma o texto a seguir.
        </instruction>

        <context>
        O COMPRADOR obriga-se a pagar o preço de [valor_total] em [contrato_quantidade_parcelas] parcelas mensais e consecutivas, reajustadas anualmente pelo [contrato_indice_reajuste], vencendo a primeira em [contrato_primeiro_vencimento].
        </context>

        <output>
        Preço de [valor_total] em [contrato_quantidade_parcelas] parcelas mensais, reajuste anual pelo [contrato_indice_reajuste], primeira em [contrato_primeiro_vencimento].
        </output>
      `,
      dedent`
        <instruction>
        Liste os três pontos principais deste texto.
        </instruction>

        <context>
        O atraso superior a 30 dias autoriza a rescisão, com retenção de 10% dos valores pagos e devolução do saldo em até 12 parcelas.
        </context>

        <output>
        - Rescisão após 30 dias de atraso.
        - Retenção de 10% do que foi pago.
        - Devolução do saldo em até 12 parcelas.
        </output>
      `,
      dedent`
        <instruction>
        Gere uma tabela comparando os planos mencionados.
        </instruction>

        <context>
        Plano normal: [plano_normal_quantidade_parcelas] parcelas de [plano_normal_valor_parcelas]
        Plano curto: [plano_curto_quantidade_parcelas] parcelas de [plano_curto_valor_parcelas]
        </context>

        <output>
        | Plano | Parcelas | Valor da parcela |
        |-------|----------|------------------|
        | Normal | [plano_normal_quantidade_parcelas] | [plano_normal_valor_parcelas] |
        | Curto | [plano_curto_quantidade_parcelas] | [plano_curto_valor_parcelas] |
        </output>
      `,
      dedent`
        <instruction>
        Explique o significado do trecho selecionado.
        </instruction>

        <context>
        O VENDEDOR responde pela <Selection>evicção</Selection> do imóvel.
        </context>

        <output>
        "Evicção" é a perda do bem pelo comprador em razão de decisão judicial que reconhece direito anterior de terceiro; o vendedor responde por essa perda.
        </output>
      `,
    ],
    history: formatTextFromMessages(messages),
    instruction: getLastUserInstruction(messages),
    rules: dedent`
      ${commonGenerateRules}
      - NÃO remova nem altere tags MDX personalizadas como <u>, <callout>, <kbd>, <toc>, <sub>, <sup>, <mark>, <del>, <date>, <span>, <column>, <column_group>, <file>, <audio>, <video>, salvo pedido explícito.
      - Preserve a indentação e as quebras de linha ao editar dentro de colunas ou layouts estruturados.
      - As tags <Selection> são marcadores de ENTRADA. NÃO podem aparecer na resposta.
    `,
    task: dedent`
      Você é um assistente avançado de redação jurídica para minutas de contrato de compra e venda de lote.
      Gere o conteúdo pedido usando o <context> como ÚNICA fonte.
      Se a instrução pedir criação ou transformação (resumir, reescrever, criar tabela), produza o resultado final diretamente.
      Não peça conteúdo adicional ao usuário.
    `,
  });
}

export function getGeneratePrompt(
  editor: SlateEditor,
  { isSelecting, messages }: { isSelecting: boolean; messages: ChatMessage[] },
) {
  // Geração livre: criação aberta, sem contexto
  if (!isSelecting) {
    return buildGenerateFreeformPrompt(messages);
  }
  // Geração com contexto: o texto selecionado é a fonte
  return buildGenerateContextPrompt(editor, messages);
}
