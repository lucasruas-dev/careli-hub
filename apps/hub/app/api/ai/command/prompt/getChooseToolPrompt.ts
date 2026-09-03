import type { ChatMessage } from "@/components/editor/use-chat";

import dedent from "dedent";

import { buildStructuredPrompt, formatTextFromMessages, getLastUserInstruction } from "../utils";

// Classifica o pedido do usuário em "generate" | "edit" | "comment" (uma palavra, via
// `Output.choice`). Roda com effort baixo: é triagem, não redação.
export function getChooseToolPrompt({
  isSelecting,
  messages,
}: {
  isSelecting: boolean;
  messages: ChatMessage[];
}) {
  const generateExamples = [
    dedent`
      <instruction>
      Escreva uma cláusula de foro de eleição
      </instruction>

      <output>
      generate
      </output>
    `,
    dedent`
      <instruction>
      Crie um parágrafo sobre a multa por atraso
      </instruction>

      <output>
      generate
      </output>
    `,
    dedent`
      <instruction>
      Resuma esta cláusula
      </instruction>

      <output>
      generate
      </output>
    `,
    dedent`
      <instruction>
      Liste as obrigações do comprador neste trecho
      </instruction>

      <output>
      generate
      </output>
    `,
  ];

  const editExamples = [
    dedent`
      <instruction>
      Corrija a gramática.
      </instruction>

      <output>
      edit
      </output>
    `,
    dedent`
      <instruction>
      Deixe mais formal.
      </instruction>

      <output>
      edit
      </output>
    `,
    dedent`
      <instruction>
      Deixe mais conciso.
      </instruction>

      <output>
      edit
      </output>
    `,
    dedent`
      <instruction>
      Reescreva em primeira pessoa do plural
      </instruction>

      <output>
      edit
      </output>
    `,
  ];

  const commentExamples = [
    dedent`
      <instruction>
      Revise esta cláusula e me dê um parecer
      </instruction>

      <output>
      comment
      </output>
    `,
    dedent`
      <instruction>
      Aponte os riscos jurídicos deste trecho em comentários
      </instruction>

      <output>
      comment
      </output>
    `,
  ];

  const examples = isSelecting
    ? [...generateExamples, ...editExamples, ...commentExamples]
    : [...generateExamples, ...commentExamples];

  const editRule = `
- Devolva "edit" só para pedidos que exigem REESCREVER o texto selecionado no lugar (corrigir gramática, melhorar redação, encurtar/alongar, traduzir, simplificar, formalizar).
- Pedidos como resumir/explicar/extrair/listar/tabela/perguntas são "generate", mesmo com texto selecionado.`;

  const rules =
    dedent`
    - O padrão é "generate". Qualquer pergunta aberta, pedido de ideia, criação, resumo ou explicação → "generate".
    - Só devolva "comment" quando o usuário pedir explicitamente comentários, parecer, anotações, revisão ou apontamento de riscos. Não infira "comment".
    - Devolva UM único valor do enum, sem explicação.
    - CRÍTICO: os exemplos servem só como referência de formato. NUNCA reproduza o conteúdo dos exemplos.
  `.trim() + (isSelecting ? editRule : "");

  const task = `Você é um classificador estrito. Classifique o último pedido do usuário como ${isSelecting ? '"generate", "edit" ou "comment"' : '"generate" ou "comment"'}.`;

  return buildStructuredPrompt({
    examples,
    history: formatTextFromMessages(messages),
    instruction: getLastUserInstruction(messages),
    rules,
    task,
  });
}
