import type Anthropic from "@anthropic-ai/sdk";

// Contrato das ferramentas da Cacá (super-agente). As descrições são PRESCRITIVAS sobre QUANDO
// usar cada uma — isso dá mais precisão de acionamento no Claude. Os executores (que batem em
// Hades/C2X/Asaas/Apolo) ficam em ./executors e são injetados via ClaudeAgentTool.run.

export const CACA_TOOL_DEFINITIONS: Anthropic.Tool[] = [
  {
    name: "validar_identidade",
    description:
      "Confirma que a pessoa do WhatsApp é o titular do cadastro antes de expor dado financeiro ou enviar boleto. Chame quando precisar liberar consulta/boleto e a identidade ainda NÃO estiver confirmada. Recebe o CPF/CNPJ (e o nome do titular, se o cliente informar) e confere no nosso cadastro.",
    input_schema: {
      type: "object",
      properties: {
        documento: {
          type: "string",
          description: "CPF ou CNPJ informado pelo cliente (só os números).",
        },
        nome_titular: {
          type: "string",
          description: "Nome completo do titular, se o cliente tiver informado.",
        },
      },
      required: ["documento"],
    },
  },
  {
    name: "consultar_financeiro",
    description:
      "Retorna o resumo financeiro do cliente já validado: total em aberto, parcelas vencidas (com valor e data), próximo vencimento e quanto já foi pago. Chame sempre que o cliente perguntar sobre a situação dele (o que deve, o que pagou, quando vence, se está em dia). NÃO afirme nenhum número sem chamar esta ferramenta.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "listar_boletos",
    description:
      "Lista as parcelas elegíveis (vencidas e a vencer) do cliente validado, indicando para cada uma se há link de boleto disponível. Chame quando o cliente pedir boleto / segunda via, para então decidir qual enviar. Separa a INFORMAÇÃO da parcela da disponibilidade do LINK.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "gerar_link_boleto",
    description:
      "Gera/recupera o LINK do boleto (Asaas, modo link gratuito) de uma parcela específica do cliente validado, para entregar ao cliente. Use depois de listar_boletos, com o número/identificador da parcela. Se a parcela não tiver link disponível, a ferramenta avisa — nesse caso informe o cliente e transfira para o time emitir.",
    input_schema: {
      type: "object",
      properties: {
        parcela: {
          type: "string",
          description:
            "Número ou identificador da parcela escolhida (conforme a lista de listar_boletos).",
        },
      },
      required: ["parcela"],
    },
  },
  {
    name: "transferir_para_humano",
    description:
      "Encaminha o atendimento para um atendente humano e ENCERRA a atuação da Cacá neste ticket. Chame sempre que você decidir que não consegue resolver com segurança: negociação/acordo de dívida, validação de identidade que falhou, link de boleto indisponível, pedido fora do seu alcance, ou cliente irritado pedindo uma pessoa. Dizer que vai transferir NÃO basta — só esta ferramenta faz a transferência acontecer.",
    input_schema: {
      type: "object",
      properties: {
        motivo: {
          type: "string",
          description:
            "Motivo curto e objetivo da transferência (para o time interno saber o contexto).",
        },
      },
      required: ["motivo"],
    },
  },
];
