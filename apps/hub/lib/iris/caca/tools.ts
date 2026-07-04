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
      "SÓ no modo assistente/gestão (direção). Movimentação de vendas do C2X num período: quantas PROPOSTAS foram geradas, quantas VENDAS (contrato gerado + em assinatura + faturado), quantas FATURADAS (venda fechada) e quantos CANCELAMENTOS/distratos. Use quando a direção perguntar 'quantas propostas/vendas/cancelamentos tivemos [essa semana / hoje / esse mês]'. Se informar 'tipo_detalhe', também traz a LISTA dos casos com unidade (quadra/lote), empreendimento, valor do lote, metragem, cliente e a IMOBILIÁRIA de cada venda (pelo vínculo do comprador). Números conferidos contra o C2X (exclui empreendimentos de teste; consolida etapas do mesmo produto).",
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
      "SÓ no modo assistente/gestão (direção). Panorama dos ATENDIMENTOS da Iris agora: quantas chamadas abertas, quantas aguardando a NOSSA resposta versus aguardando o cliente, por fila e por colaborador, e quem está esperando resposta há mais tempo (com os minutos). Use quando a direção perguntar 'como está a Iris', 'quantas chamadas temos', 'tem gente esperando muito', 'quem está com mais atendimentos'. Se informar 'periodo', também traz o HISTÓRICO daquele intervalo: quantos atendimentos foram FINALIZADOS e quantos foram CRIADOS (ex.: 'quantos tickets fechamos ontem/essa semana').",
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
          description:
            "Opcional. Traz também o histórico (finalizados/criados) desse intervalo.",
        },
      },
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
  {
    name: "gerar_relatorio_visual",
    description:
      "SÓ no modo assistente/gestão (direção). Gera um RELATÓRIO em IMAGEM (gráfico de barras) e ENVIA como foto no WhatsApp. Use quando a direção pedir pra ver algo 'num relatório', 'numa imagem', 'num gráfico', ou 'me manda visual'. Disponível: vendas por empreendimento. Depois de chamar, avise que enviou a imagem.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "consultar_vendas_por_imobiliaria",
    description:
      "SÓ no modo assistente/gestão (direção). Ranking das IMOBILIÁRIAS que mais venderam (unidades faturadas), pela imobiliária vinculada ao cliente comprador. Use quando a direção perguntar 'qual imobiliária mais vendeu', 'ranking das imobiliárias', 'quem vende mais'. Vendas sem imobiliária vinculada aparecem como venda direta.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "consultar_panteon",
    description:
      "SÓ no modo assistente/gestão (direção). O MOTOR DE ANÁLISE do Panteon: responde QUALQUER pergunta QUANTITATIVA combinando modulo + métrica + agrupamento + filtros + período, com as regras oficiais da Careli embutidas. PREFIRA esta ferramenta sempre que a pergunta combinar recortes que as outras não cobrem. DOIS módulos: 'c2x' (VENDAS) e 'iris' (ATENDIMENTO). C2X exemplos: 'quantos clientes a imobiliária X vendeu essa semana' = {modulo: c2x, metrica: clientes_faturados, filtros: {imobiliaria: 'X'}, periodo: esta_semana}; 'faturamento por mês este ano' = {modulo: c2x, metrica: valor_faturado, agrupar_por: mes, periodo: este_ano}; 'propostas do Lavra do Ouro em junho' = {modulo: c2x, metrica: propostas, filtros: {empreendimento: 'Lavra do Ouro'}, data_inicio: '2026-06-01', data_fim: '2026-06-30'}; 'ranking de imobiliárias' = {modulo: c2x, metrica: unidades_faturadas, agrupar_por: imobiliaria}. C2X métricas de EVENTO (usam período): propostas, vendas, faturamentos, cancelamentos, reservas, clientes_faturados, valor_faturado. C2X de ESTADO (ignoram período): unidades_vendidas (nº oficial do painel), unidades_disponiveis, unidades_total, unidades_faturadas, valor_carteira_vendida. IRIS exemplos: 'quantos atendimentos finalizamos essa semana' = {modulo: iris, metrica: tickets_finalizados, periodo: esta_semana}; 'atendimentos abertos por fila' = {modulo: iris, metrica: tickets_abertos, agrupar_por: fila}; 'tickets criados por dia esse mês' = {modulo: iris, metrica: tickets_criados, agrupar_por: dia, periodo: este_mes}. IRIS métricas de EVENTO: tickets_criados, tickets_finalizados. IRIS de ESTADO (agora): tickets_abertos, aguardando_operador (a nossa vez), aguardando_cliente. Se devolver erro de combinação, ajuste os parâmetros conforme a mensagem e chame de novo.",
    input_schema: {
      type: "object",
      properties: {
        modulo: {
          type: "string",
          enum: ["c2x", "iris"],
          description: "Fonte dos dados: c2x (vendas) ou iris (atendimento).",
        },
        metrica: {
          type: "string",
          enum: [
            "propostas",
            "vendas",
            "faturamentos",
            "cancelamentos",
            "reservas",
            "clientes_faturados",
            "valor_faturado",
            "unidades_vendidas",
            "unidades_disponiveis",
            "unidades_total",
            "unidades_faturadas",
            "valor_carteira_vendida",
            "tickets_abertos",
            "aguardando_operador",
            "aguardando_cliente",
            "tickets_criados",
            "tickets_finalizados",
          ],
          description:
            "O QUE contar/somar. As de vendas são do módulo c2x; tickets_* e aguardando_* são do módulo iris (ver exemplos).",
        },
        agrupar_por: {
          type: "string",
          enum: [
            "empreendimento",
            "imobiliaria",
            "cliente",
            "estagio",
            "fila",
            "colaborador",
            "status",
            "dia",
            "semana",
            "mes",
          ],
          description:
            "Opcional. Quebra o resultado por dimensão (ranking ou série temporal). c2x: empreendimento/imobiliaria/cliente/estagio; iris: fila/colaborador/status; dia/semana/mes só para métricas de evento.",
        },
        filtros: {
          type: "object",
          description:
            "Opcional. Restringe o recorte. Combine à vontade (ex.: imobiliária + período; ou fila + período).",
          properties: {
            empreendimento: {
              type: "string",
              description: "c2x: nome ou sigla do empreendimento (ex.: 'Lavra do Ouro').",
            },
            imobiliaria: {
              type: "string",
              description: "c2x: nome (ou parte) da imobiliária parceira.",
            },
            cliente: {
              type: "string",
              description: "c2x: nome (ou parte) OU CPF/CNPJ do cliente.",
            },
            fila: {
              type: "string",
              description:
                "iris: nome da fila (ex.: 'Atendimento', 'Cobrança', 'Jurídico').",
            },
            colaborador: {
              type: "string",
              description: "iris: nome (ou parte) do operador responsável.",
            },
            status: {
              type: "string",
              description:
                "iris: status do ticket (ex.: 'waiting_operator', 'waiting_customer', 'closed').",
            },
          },
        },
        periodo: {
          type: "string",
          enum: [
            "hoje",
            "ontem",
            "esta_semana",
            "este_mes",
            "mes_passado",
            "este_ano",
            "ultimos_7_dias",
            "ultimos_30_dias",
            "desde_o_inicio",
          ],
          description:
            "Janela de tempo (métricas de evento). Sem período = este mês. Pra janelas específicas ('em junho', 'de 1 a 15/05') use data_inicio/data_fim.",
        },
        data_inicio: {
          type: "string",
          description:
            "Opcional, sobrepõe periodo. Início da janela custom, YYYY-MM-DD (dia de São Paulo).",
        },
        data_fim: {
          type: "string",
          description: "Opcional. Fim INCLUSIVO da janela custom, YYYY-MM-DD.",
        },
      },
      required: ["modulo", "metrica"],
    },
  },
  {
    name: "ler_conversa_iris",
    description:
      "SÓ no modo assistente/gestão (direção). Lê a CONVERSA de um atendimento da Iris pelo NOME do cliente e permite AVALIAR O HUMOR/PERFIL dele: traz o perfil básico (pessoa física/jurídica, cidade), as mensagens trocadas em ordem, quem falou por último, há quanto tempo o cliente espera e se ele mandou mensagens seguidas sem resposta. Use quando a direção perguntar 'o que esse cliente falou', 'me mostra a conversa do fulano', 'esse cliente está nervoso/impaciente?', 'como está o humor dele', 'do que se trata esse atendimento'. Depois de chamar, AVALIE o estado emocional (calmo/impaciente/irritado/ansioso/satisfeito/neutro) com evidência do texto, a urgência e uma recomendação de abordagem — só com base no que está escrito. Pro perfil completo (comprador/imobiliária/prospect), cruze com consultar_cliente_c2x. (Áudios do cliente aparecem como marcador, sem transcrição.)",
    input_schema: {
      type: "object",
      properties: {
        cliente: {
          type: "string",
          description: "Nome (ou parte do nome) do cliente do atendimento.",
        },
      },
      required: ["cliente"],
    },
  },
];
