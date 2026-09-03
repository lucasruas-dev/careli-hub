import type { ChatMessage } from "@/components/editor/use-chat";
import type { SlateEditor } from "platejs";

import { getMarkdown } from "@platejs/ai";
import dedent from "dedent";

import { buildStructuredPrompt, formatTextFromMessages, getLastUserInstruction } from "../utils";
import { REGRA_VARIAVEIS } from "./common";

// Edição de várias células de tabela de uma vez (ex.: a tabela de pagamentos da minuta).
// O modelo devolve um array JSON { id, content } por célula selecionada.
export function buildEditTableMultiCellPrompt(editor: SlateEditor, messages: ChatMessage[]): string {
  const tableCellMarkdown = getMarkdown(editor, {
    type: "tableCellWithId",
  });

  return buildStructuredPrompt({
    context: tableCellMarkdown,
    examples: [
      // 1) Correção simples
      dedent`
        <instruction>
        Corrija a gramática
        </instruction>

        <context>
        | Parcela | Vencimento | Valor |
        | --- | --- | --- |
        | 1 | 10/10/2026 | <CellRef id="c1" /> |

        <Cell id="c1">
        mil real
        </Cell>
        </context>

        <output>
        [
          { "id": "c1", "content": "mil reais" }
        ]
        </output>
      `,

      // 2) Várias células
      dedent`
        <instruction>
        Escreva em maiúsculas
        </instruction>

        <context>
        | Parte | Papel |
        | --- | --- |
        | [nome_cliente] | <CellRef id="c1" /> |
        | [empresa_razao_social] | <CellRef id="c2" /> |

        <Cell id="c1">
        comprador
        </Cell>

        <Cell id="c2">
        vendedor
        </Cell>
        </context>

        <output>
        [
          { "id": "c1", "content": "COMPRADOR" },
          { "id": "c2", "content": "VENDEDOR" }
        ]
        </output>
      `,

      // 3) Conteúdo com vários parágrafos na célula
      dedent`
        <instruction>
        Detalhe mais
        </instruction>

        <context>
        | Etapa | Descrição |
        | --- | --- |
        | Sinal | <CellRef id="c1" /> |

        <Cell id="c1">
        Pago na assinatura
        </Cell>
        </context>

        <output>
        [
          { "id": "c1", "content": "Pago na assinatura deste instrumento.\\n\\n- Valor: [valor_sinal]\\n- Forma: PIX ou boleto" }
        ]
        </output>
      `,
    ],
    history: formatTextFromMessages(messages),
    instruction: getLastUserInstruction(messages),
    rules: dedent`
      - A tabela contém marcadores <CellRef id="..." /> nas células selecionadas.
      - O conteúdo real de cada célula selecionada está nos blocos <Cell id="...">conteúdo</Cell> depois da tabela.
      - Modifique SOMENTE o conteúdo dos blocos <Cell>.
      - Devolva um array JSON em que cada objeto tem "id" (o id da célula) e "content" (o novo conteúdo).
      - O campo "content" pode ter vários parágrafos separados por \\n\\n.
      - NÃO devolva tags <Cell>, <CellRef> nem a tabela em markdown; só o array JSON.
      - Escreva em português do Brasil, linguagem jurídica formal.
      ${REGRA_VARIAVEIS}
      - CRÍTICO: os exemplos servem só como referência de formato. NUNCA reproduza o conteúdo dos exemplos.
    `,
    task: dedent`
      Você é um assistente de edição de células de tabela numa minuta de contrato.
      O <context> contém uma tabela markdown com marcadores <CellRef /> e os blocos <Cell> correspondentes.
      Sua tarefa é modificar o conteúdo das células selecionadas conforme a instrução do usuário.
      Devolva SOMENTE um array JSON válido com os conteúdos modificados.
    `,
  });
}
