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
    name: "consultar_cadastro",
    description:
      "Retorna os dados CADASTRAIS do cliente PESSOA FÍSICA já validado: nome, estado civil e regime de bens, nascimento, naturalidade/nacionalidade, profissão, RG, e-mail e telefone do cadastro, endereço completo, nome da mãe e (se casado) os dados do cônjuge. Chame quando o cliente quiser conferir/atualizar os próprios dados de cadastro (endereço, estado civil, profissão, cônjuge etc.). Exige identidade confirmada (validar_identidade ou telefone que bate). NÃO afirme nenhum dado cadastral sem chamar esta ferramenta.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "consultar_cadastro_imobiliaria",
    description:
      "Confirma se uma IMOBILIÁRIA / pessoa jurídica (parceira, corretora) tem cadastro na Careli e retorna os dados dela, a partir do CNPJ. Use quando quem fala é uma empresa/imobiliária e quer saber se está cadastrada ou conferir o cadastro. Pessoa jurídica NÃO precisa de validação de identidade: basta o CNPJ (14 dígitos). Se vier um CPF (pessoa física), NÃO use esta ferramenta — peça a validação de identidade do titular.",
    input_schema: {
      type: "object",
      properties: {
        cnpj: {
          type: "string",
          description: "CNPJ da imobiliária/empresa (só os números, 14 dígitos).",
        },
      },
      required: ["cnpj"],
    },
  },
  {
    name: "resumo_carteira_imobiliaria",
    description:
      "Só para quando quem fala é uma IMOBILIÁRIA/CORRETORA já identificada (pelo número ou pelo CNPJ confirmado). Retorna o panorama financeiro da carteira de clientes DELA: quantos clientes com contrato, quantos com parcela vencida, quantos em dia, o total vencido e um destaque dos clientes mais atrasados. Use quando a imobiliária pedir uma visão geral / 'saúde financeira dos boletos dos meus clientes'. Só traz os clientes vinculados àquela imobiliária.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "consultar_cliente_da_imobiliaria",
    description:
      "Só para IMOBILIÁRIA/CORRETORA já identificada. Consulta o cadastro e o financeiro de UM cliente DELA (informe o nome OU o CPF/CNPJ do cliente). Retorna dados cadastrais + resumo financeiro (parcelas vencidas, próxima, liquidadas) e se cada parcela tem link de boleto. A ferramenta só encontra o cliente se ele estiver vinculado a ESTA imobiliária — se não achar, avise que o cliente não aparece na carteira dela. Não exige validar_identidade (a autorização vem do vínculo imobiliária↔cliente).",
    input_schema: {
      type: "object",
      properties: {
        cliente: {
          type: "string",
          description:
            "Nome completo OU CPF/CNPJ (só números) do cliente da imobiliária.",
        },
      },
      required: ["cliente"],
    },
  },
  {
    name: "gerar_boleto_cliente_imobiliaria",
    description:
      "Só para IMOBILIÁRIA/CORRETORA já identificada. Gera/recupera o LINK do boleto (Asaas, modo link gratuito) de uma parcela de um cliente DELA, para a imobiliária repassar. Informe o cliente (nome ou CPF/CNPJ) e a parcela (conforme consultar_cliente_da_imobiliaria). A ferramenta reconfirma o vínculo do cliente com a imobiliária antes de gerar. Se a parcela não tiver link, avise e oriente a transferir para o time emitir.",
    input_schema: {
      type: "object",
      properties: {
        cliente: {
          type: "string",
          description:
            "Nome completo OU CPF/CNPJ (só números) do cliente da imobiliária.",
        },
        parcela: {
          type: "string",
          description:
            "Número/identificador da parcela (conforme consultar_cliente_da_imobiliaria).",
        },
      },
      required: ["cliente", "parcela"],
    },
  },
  {
    name: "anotar_sobre_cliente",
    description:
      "Registra uma anotação curta e DURADOURA sobre o cliente, pra você lembrar nos próximos atendimentos (ex.: 'prefere boleto por e-mail', 'costuma pagar com atraso', 'já reclamou de demora', 'fala de forma mais formal', 'tem 2 lotes'). Use quando aprender algo útil e estável sobre a pessoa. NÃO registre dado sensível (CPF, valores, links) nem coisas efêmeras do momento.",
    input_schema: {
      type: "object",
      properties: {
        nota: {
          type: "string",
          description: "A anotação curta e objetiva sobre o cliente.",
        },
      },
      required: ["nota"],
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
  {
    name: "consultar_movimentacao_c2x",
    description:
      "SÓ no modo assistente/gestão (direção). Movimentação de vendas do C2X num período: quantas PROPOSTAS foram geradas, quantas VENDAS (contrato gerado + em assinatura + faturado), quantas FATURADAS (venda fechada) e quantos CANCELAMENTOS/distratos. Use quando a direção perguntar 'quantas propostas/vendas/cancelamentos tivemos [essa semana / hoje / esse mês]'. Se informar 'tipo_detalhe', também traz a LISTA dos casos com unidade (quadra/lote), empreendimento, valor do lote, metragem, cliente e corretor/imobiliária. Números conferidos contra o C2X (exclui empreendimentos de teste; consolida etapas do mesmo produto).",
    input_schema: {
      type: "object",
      properties: {
        periodo: {
          type: "string",
          enum: [
            "hoje",
            "ontem",
            "esta_semana",
            "este_mes",
            "ultimos_7_dias",
            "ultimos_30_dias",
          ],
          description: "Janela de tempo da consulta.",
        },
        tipo_detalhe: {
          type: "string",
          enum: ["propostas", "vendas", "faturado", "cancelamentos"],
          description:
            "Opcional. Se informado, traz a lista detalhada desse tipo de movimentação no período (unidade, valor, metragem, cliente, corretor/imobiliária).",
        },
      },
      required: ["periodo"],
    },
  },
  {
    name: "consultar_vendas_por_empreendimento",
    description:
      "SÓ no modo assistente/gestão (direção). Estado atual da carteira por empreendimento: total de unidades, vendidas e disponíveis, com as regras da Careli (soma etapas do mesmo produto — Lavra do Ouro, Rio de Pedras, Portal dos Vales; Lagoa Bonita consolidada; exclui teste/masterplan/aditivo). Use quando a direção pedir 'vendas por empreendimento' / panorama da carteira. 'Vendido' = unidade com status vendido no C2X.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "consultar_atendimentos_iris",
    description:
      "SÓ no modo assistente/gestão (direção). Panorama dos ATENDIMENTOS da Iris agora: quantas chamadas abertas, quantas aguardando a NOSSA resposta versus aguardando o cliente, por fila e por colaborador, e quem está esperando resposta há mais tempo (com os minutos). Use quando a direção perguntar 'como está a Iris', 'quantas chamadas temos', 'tem gente esperando muito', 'quem está com mais atendimentos'.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "consultar_hermes",
    description:
      "SÓ no modo assistente/gestão (direção). Verifica se a PESSOA que está falando tem MENSAGENS NÃO LIDAS no Hermes (chat interno da equipe): quantas e em quais canais. Use quando ela perguntar 'tem mensagem pra mim no Hermes', 'o que tem de novo no chat interno'. Só funciona para quem tem conta no hub.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "consultar_saude_sistema",
    description:
      "SÓ no modo assistente/gestão (direção). Verifica a SAÚDE do sistema (infra): estado do último deploy na Vercel e alertas dos advisors do Supabase (segurança/performance). Use quando a direção perguntar 'como está o sistema', 'teve algum problema', 'como está o Supabase/a Vercel'. É um resumo executivo, não log cru.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "consultar_unidade_c2x",
    description:
      "SÓ no modo assistente/gestão (direção). Consulta PONTUAL de uma unidade/lote específico: informe o empreendimento e a quadra e o lote. Retorna o status de venda (disponível, reservado, em negociação, vendido), a metragem, o valor e — se houver — o comprador atual e em que estágio está (faturado, em assinatura, etc.). Use quando a direção perguntar sobre um lote específico (ex.: 'como está a quadra 3 lote 14 do Veredas do Ouro').",
    input_schema: {
      type: "object",
      properties: {
        empreendimento: {
          type: "string",
          description: "Nome ou sigla do empreendimento (ex.: 'Veredas do Ouro').",
        },
        quadra: { type: "string", description: "Quadra/bloco (ex.: '3' ou 'C3')." },
        lote: { type: "string", description: "Lote (ex.: '14')." },
      },
      required: ["empreendimento", "lote"],
    },
  },
  {
    name: "consultar_cliente_c2x",
    description:
      "SÓ no modo assistente/gestão (direção). Consulta PONTUAL de um cliente por NOME ou CPF/CNPJ, sem restrição de vínculo. Retorna o nome, o documento e as UNIDADES vivas dele (empreendimento, quadra/lote, estágio e valor). Use quando a direção perguntar sobre um cliente específico ('o que o fulano tem', 'quantos lotes o cliente X comprou').",
    input_schema: {
      type: "object",
      properties: {
        cliente: {
          type: "string",
          description: "Nome completo OU CPF/CNPJ (só números) do cliente.",
        },
      },
      required: ["cliente"],
    },
  },
];
