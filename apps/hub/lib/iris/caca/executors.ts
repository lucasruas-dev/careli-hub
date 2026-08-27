import type { SupabaseClient } from "@supabase/supabase-js";

import type { ClaudeAgentTool } from "@/lib/ai/claude-agent";
import { type CadAgruparPor, queryCad } from "@/lib/analytics/cad-source";
import {
  formatPanteonResultado,
  queryPanteon,
} from "@/lib/analytics/query-panteon";
import { consultarCobranca, obterQrCodePix } from "@/lib/apolo/asaas-prevenda";
import { carregarResumoApolo } from "@/lib/apolo/cads-publico-resumo";
import { montarFichaCad } from "@/lib/apolo/cobranca-prevenda";
import { lerCadDaEsteira, lerCadsDaEsteira } from "@/lib/apolo/esteira-cad";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { prepareBoletoResendAction } from "@/lib/guardian/asaas";
import {
  type C2xImobiliariaClientMatch,
  findC2xImobiliariaClients,
  loadC2xImobiliariaCarteiraSummary,
  loadC2xUserCadastro,
  loadHadesAttendanceClient,
} from "@/lib/guardian/attendance";
import {
  type C2xMovimentacaoTipo,
  type C2xPeriodo,
  loadC2xClienteResumo,
  loadC2xMovimentacaoDetalhe,
  loadC2xMovimentacaoResumo,
  loadC2xUnidade,
  loadC2xVendasPorEmpreendimento,
  loadC2xVendasPorImobiliaria,
} from "@/lib/guardian/c2x-analytics";
import { lookupApoloByDocument } from "@/lib/iris/caca-agent";
import { loadHermesResumo } from "@/lib/iris/hermes-analytics";
import { loadInfraSaude } from "@/lib/iris/infra-analytics";
import {
  getMetaWhatsAppOutboundConfig,
  sendMetaWhatsAppMediaMessage,
} from "@/lib/iris/meta-whatsapp";
import {
  loadIrisAtendimentosResumo,
  loadIrisConversa,
  loadIrisMovimentacaoPeriodo,
} from "@/lib/iris/iris-analytics";

import { appendClientNote } from "./client-memory";
import { gravarIdentidadeLembrada } from "./identidade-lembrada";
import { sortInstallmentsByDueDate } from "./installment-order";
import { CACA_TOOL_DEFINITIONS } from "./tools";

// Estado mutável do turno: as ferramentas leem e escrevem aqui. Depois do loop, o caller lê
// `handoff` (pra executar a transferência de verdade) e `identityVerified`/`c2xClientId`
// (pra persistir no metadata do ticket entre turnos).
export type CacaToolContext = {
  businessHoursOpen: boolean;
  c2xClientId: string | null;
  client: SupabaseClient;
  contactId: string | null;
  customerName: string | null;
  // entity_id do Apolo do contato, casado pelo TELEFONE (não expõe dado — só serve pra tools que
  // GRAVAM na ficha do prospect, ex.: registrar_chave_pix). null = telefone não casou entidade.
  entityId: string | null;
  // Perfil do contato no Apolo (comprador, colaborador, imobiliaria, prospect...) para a
  // Caca entender COM QUEM fala e nao tratar ausencia de carteira como erro. null = desconhecido.
  customerProfileLabel: string | null;
  handoff: { reason: string | null; requested: boolean };
  identityVerified: boolean;
  // Quando quem fala é uma IMOBILIARIA/corretora já identificada (por telefone ou CNPJ),
  // guarda o id C2X DELA para escopar consultas aos clientes vinculados (vinculed_by_id).
  // null = não é imobiliária identificada; as tools de carteira/cliente ficam bloqueadas.
  imobiliariaC2xClientId: string | null;
  imobiliariaName: string | null;
  nextContactLabel: string;
  validationSource: "cpf" | "phone" | null;
  // Modo assistente/gestão (número admin verificado: proprietários). Libera as ferramentas
  // de ANALISTA (C2X, Iris, Hermes, infra). Ver [[project-caca-admin-assistant-mode]].
  assistantMode?: boolean;
  // hub_user_id do admin (mapa número→usuário) — pra consultar o Hermes DELE. null = sem conta.
  assistantHubUserId?: string | null;
  // Destino (wa_id) e phone_number_id do atendimento — pra a tool ENVIAR imagem (relatório).
  destination?: string | null;
  outboundPhoneNumberId?: string | null;
};

// Traduz os perfis crus do Apolo (usuario/colaborador/imobiliaria/...) num rotulo curto e
// humano — e sinaliza quem NAO tem carteira, pra Caca contextualizar em vez de dizer que o
// sistema falhou. Exportado porque o agent.ts tambem usa na verificacao por telefone.
export function describeApoloProfile(
  profiles: readonly string[] | null | undefined,
): string | null {
  const set = new Set((profiles ?? []).map((profile) => profile.toLowerCase()));

  if (set.has("usuario")) {
    return "comprador (tem carteira/parcelas)";
  }
  if (set.has("imobiliaria") || set.has("corretor")) {
    return "imobiliária/parceiro (sem carteira própria)";
  }
  if (set.has("colaborador") || set.has("funcionario")) {
    return "colaborador da Careli (sem carteira)";
  }
  if (set.has("fornecedor")) {
    return "fornecedor (sem carteira)";
  }
  if (set.has("prospect") || set.has("lead")) {
    return "prospect — ainda não comprou (sem carteira)";
  }

  return null;
}

const DEFINITION_BY_NAME = new Map(
  CACA_TOOL_DEFINITIONS.map((definition) => [definition.name, definition]),
);

export function buildCacaTools(context: CacaToolContext): ClaudeAgentTool[] {
  const tools: ClaudeAgentTool[] = [
    {
      definition: requireDefinition("validar_identidade"),
      run: async (input) => validarIdentidade(context, input),
    },
    {
      definition: requireDefinition("consultar_financeiro"),
      run: async () => consultarFinanceiro(context),
    },
    {
      definition: requireDefinition("listar_boletos"),
      run: async () => listarBoletos(context),
    },
    {
      definition: requireDefinition("gerar_link_boleto"),
      run: async (input) => gerarLinkBoleto(context, input),
    },
    {
      definition: requireDefinition("consultar_cadastro"),
      run: async () => consultarCadastro(context),
    },
    {
      definition: requireDefinition("consultar_status_cad"),
      run: async (input) => consultarStatusCad(context, input),
    },
    {
      definition: requireDefinition("enviar_pix_credenciamento"),
      run: async (input) => enviarPixCredenciamento(context, input),
    },
    {
      definition: requireDefinition("registrar_chave_pix"),
      run: async (input) => registrarChavePix(context, input),
    },
    {
      definition: requireDefinition("consultar_ficha_credenciamento"),
      run: async (input) => consultarFichaCredenciamento(context, input),
    },
    {
      definition: requireDefinition("enviar_ficha_cad"),
      run: async (input) => enviarFichaCad(context, input),
    },
    {
      definition: requireDefinition("consultar_cadastro_imobiliaria"),
      run: async (input) => consultarCadastroImobiliaria(context, input),
    },
    {
      definition: requireDefinition("resumo_carteira_imobiliaria"),
      run: async () => resumoCarteiraImobiliaria(context),
    },
    {
      definition: requireDefinition("consultar_cliente_da_imobiliaria"),
      run: async (input) => consultarClienteDaImobiliaria(context, input),
    },
    {
      definition: requireDefinition("gerar_boleto_cliente_imobiliaria"),
      run: async (input) => gerarBoletoClienteImobiliaria(context, input),
    },
    {
      definition: requireDefinition("anotar_sobre_cliente"),
      run: async (input) => anotarSobreCliente(context, input),
    },
    {
      definition: requireDefinition("transferir_para_humano"),
      run: async (input) => transferirParaHumano(context, input),
    },
  ];

  // Ferramentas de ANALISTA: só no modo assistente/gestão (proprietários).
  if (context.assistantMode) {
    tools.push(
      {
        // Consolidado das CADs = número de GESTÃO. Fica aqui, no modo assistente, para o cliente,
        // corretor ou imobiliária comum NÃO conseguir o total somado do empreendimento — só a
        // direção. Cada um continua vendo a própria ficha pelo CPF (fora deste bloco).
        definition: requireDefinition("consultar_consolidado_cads"),
        run: async (input) => consultarConsolidadoCads(context, input),
      },
      {
        definition: requireDefinition("consultar_panteon"),
        run: async (input) => consultarPanteon(context, input),
      },
      {
        definition: requireDefinition("cenario_comercial"),
        run: async (input) => cenarioComercial(input),
      },
      {
        definition: requireDefinition("consultar_cad"),
        run: async (input) => consultarCad(input),
      },
      {
        definition: requireDefinition("consultar_movimentacao_c2x"),
        run: async (input) => consultarMovimentacaoC2x(input),
      },
      {
        definition: requireDefinition("consultar_vendas_por_empreendimento"),
        run: async () => consultarVendasPorEmpreendimento(),
      },
      {
        definition: requireDefinition("consultar_atendimentos_iris"),
        run: async (input) => consultarAtendimentosIris(context, input),
      },
      {
        definition: requireDefinition("consultar_hermes"),
        run: async () => consultarHermes(context),
      },
      {
        definition: requireDefinition("consultar_saude_sistema"),
        run: async () => consultarSaudeSistema(),
      },
      {
        definition: requireDefinition("consultar_unidade_c2x"),
        run: async (input) => consultarUnidadeC2x(input),
      },
      {
        definition: requireDefinition("consultar_cliente_c2x"),
        run: async (input) => consultarClienteC2x(input),
      },
      {
        definition: requireDefinition("gerar_relatorio_visual"),
        run: async () => gerarRelatorioVisual(context),
      },
      {
        definition: requireDefinition("consultar_vendas_por_imobiliaria"),
        run: async () => consultarVendasPorImobiliaria(),
      },
      {
        definition: requireDefinition("ler_conversa_iris"),
        run: async (input) => lerConversaIris(context, input),
      },
    );
  }

  return tools;
}

async function consultarVendasPorImobiliaria(): Promise<string> {
  const rows = await loadC2xVendasPorImobiliaria();

  if (rows.length === 0) {
    return "Não consegui puxar o ranking de imobiliárias agora.";
  }

  return [
    "Imobiliárias que mais venderam (unidades faturadas):",
    ...rows.map((row, index) => `${index + 1}. ${row.imobiliaria}: ${row.unidades}`),
  ].join("\n");
}

async function lerConversaIris(
  context: CacaToolContext,
  input: unknown,
): Promise<string> {
  const record =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const termo = typeof record.cliente === "string" ? record.cliente : "";

  const conversa = await loadIrisConversa(context.client, termo);

  if (!conversa) {
    return "Não encontrei um atendimento na Iris pra esse cliente (confira o nome).";
  }

  const espera =
    conversa.quemFalouPorUltimo === "cliente" &&
    conversa.minutosDesdeUltimaMensagem != null
      ? `O CLIENTE falou por último há ${conversa.minutosDesdeUltimaMensagem} min (aguardando a nossa resposta).`
      : conversa.quemFalouPorUltimo === "nós"
        ? "NÓS falamos por último (a bola está com o cliente)."
        : "";

  const rajada =
    conversa.mensagensDoClienteSeguidas >= 2
      ? `O cliente mandou ${conversa.mensagensDoClienteSeguidas} mensagens seguidas sem resposta nossa (possível impaciência).`
      : "";

  const linhas = [
    `Atendimento de ${conversa.cliente} — ${conversa.perfil} · status ${conversa.statusTicket}.`,
    espera,
    rajada,
    "",
    "Conversa (ordem cronológica):",
    ...conversa.mensagens.map((m) => `- ${m.de}: ${m.texto}`),
    "",
    "AVALIE E RESPONDA À DIREÇÃO: (1) o ESTADO EMOCIONAL do cliente pelas mensagens (calmo, impaciente, irritado/agressivo, ansioso, satisfeito ou neutro) com uma evidência curta do texto; (2) a URGÊNCIA e o que ele quer; (3) uma recomendação objetiva de abordagem. Baseie-se SÓ no que está escrito — não invente. Se o tom for ambíguo, diga que está neutro.",
  ].filter((linha) => linha !== "");

  return linhas.join("\n");
}

// Gera o relatório em IMAGEM (chama a rota edge de render) e ENVIA como foto no WhatsApp.
async function gerarRelatorioVisual(context: CacaToolContext): Promise<string> {
  if (!context.destination) {
    return "Não consegui identificar o destino pra enviar o relatório.";
  }

  const rows = await loadC2xVendasPorEmpreendimento();

  if (rows.length === 0) {
    return "Não há dados de vendas pra montar o relatório agora.";
  }

  const secret = process.env.IRIS_TTS_DEMO_KEY?.trim() ?? "";
  const base = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "https://c2x.app.br";

  try {
    const render = await fetch(`${base}/api/iris/report-render`, {
      body: JSON.stringify({
        rows: rows.map((row) => ({
          disponiveis: row.disponiveis,
          empreendimento: row.empreendimento,
          vendidas: row.vendidas,
        })),
        titulo: "Vendas por empreendimento",
      }),
      cache: "no-store",
      headers: { "content-type": "application/json", "x-report-secret": secret },
      method: "POST",
    });

    if (!render.ok) {
      return "Não consegui gerar a imagem do relatório agora.";
    }

    const png = Buffer.from(await render.arrayBuffer());

    await sendMetaWhatsAppMediaMessage({
      caption: "Vendas por empreendimento · Careli",
      config: context.outboundPhoneNumberId
        ? {
            ...getMetaWhatsAppOutboundConfig(),
            phoneNumberId: context.outboundPhoneNumberId,
          }
        : undefined,
      fileName: "vendas-por-empreendimento.png",
      kind: "image",
      mediaBase64: png.toString("base64"),
      mimeType: "image/png",
      to: context.destination,
    });

    return "Pronto, te enviei o relatório de vendas por empreendimento em imagem. 📊";
  } catch {
    return "Tive um problema pra gerar/enviar o relatório em imagem agora.";
  }
}

async function consultarUnidadeC2x(input: unknown): Promise<string> {
  const record =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};

  const unidades = await loadC2xUnidade({
    empreendimento: typeof record.empreendimento === "string" ? record.empreendimento : null,
    lote: typeof record.lote === "string" ? record.lote : null,
    quadra: typeof record.quadra === "string" ? record.quadra : null,
  });

  if (unidades.length === 0) {
    return "Não encontrei essa unidade no C2X (confira o empreendimento, a quadra e o lote).";
  }

  return unidades
    .map((u) => {
      const partes = [
        `${u.empreendimento} ${u.quadraLote}`,
        `status: ${u.statusVenda}`,
        u.area != null ? `${u.area} m²` : null,
        `valor ${formatBrl(u.valor)}`,
        u.comprador ? `comprador ${u.comprador}` : "sem comprador",
        u.estagioAtual ? `(${u.estagioAtual})` : null,
        u.corretor ? `corretor ${u.corretor}` : null,
      ].filter(Boolean);

      return partes.join(" · ");
    })
    .join("\n");
}

async function consultarClienteC2x(input: unknown): Promise<string> {
  const record =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const termo = typeof record.cliente === "string" ? record.cliente : "";

  const resumo = await loadC2xClienteResumo(termo);

  if (!resumo) {
    return "Não encontrei esse cliente no C2X (confira o nome ou o CPF/CNPJ).";
  }

  const linhas = [`Cliente: ${resumo.nome}${resumo.documento ? ` (${resumo.documento})` : ""}`];

  // Imobiliária vem do vínculo do cadastro (vinculed_by_id) — todo cliente/prospect tem,
  // NÃO depende de venda. É o campo que a Cacá errou com a Nívea (prospect sem venda).
  linhas.push(
    `Imobiliária vinculada: ${resumo.imobiliaria ?? "não consta no cadastro"}`,
  );

  const p = resumo.perfil;
  const perfilPartes = [
    p.idade != null ? `${p.idade} anos` : null,
    p.sexo,
    p.estadoCivil,
    p.escolaridade ? `escolaridade ${p.escolaridade}` : null,
    p.renda ? `renda ${p.renda}` : null,
    p.profissao ? `profissão ${p.profissao}` : null,
    p.cidadeUf,
  ].filter(Boolean);

  if (perfilPartes.length) {
    linhas.push(`Cadastro: ${perfilPartes.join(" · ")}`);
  }

  const contato = [
    p.telefone ? `tel ${p.telefone}` : null,
    p.email ? `e-mail ${p.email}` : null,
  ].filter(Boolean);

  if (contato.length) {
    linhas.push(`Contato: ${contato.join(" · ")}`);
  }

  if (resumo.unidades.length === 0) {
    linhas.push(
      "Unidades: nenhuma unidade viva no C2X (provável prospect / ainda sem compra — a imobiliária e o cadastro acima seguem válidos).",
    );
  } else {
    linhas.push(`Unidades (${resumo.unidades.length}):`);
    for (const u of resumo.unidades) {
      linhas.push(
        `- ${u.empreendimento} ${u.quadraLote} · ${u.estagio ?? "-"} · ${formatBrl(u.valor)}`,
      );
    }
  }

  return linhas.join("\n");
}

async function consultarAtendimentosIris(
  context: CacaToolContext,
  input: unknown,
): Promise<string> {
  const resumo = await loadIrisAtendimentosResumo(context.client);

  if (!resumo) {
    return "Não consegui consultar os atendimentos da Iris agora.";
  }

  const linhas: string[] = [];

  if (resumo.abertosTotal === 0) {
    linhas.push("Iris (agora): nenhum atendimento aberto. Fila zerada.");
  } else {
    linhas.push(
      `Atendimentos da Iris (agora): ${resumo.abertosTotal} abertos — ${resumo.aguardandoOperador} aguardando a nossa resposta, ${resumo.aguardandoCliente} aguardando o cliente.`,
      `Por fila: ${resumo.porFila.map((f) => `${f.fila} (${f.abertos})`).join(", ")}`,
      `Por colaborador: ${resumo.porColaborador.map((c) => `${c.colaborador} (${c.abertos})`).join(", ")}`,
    );

    if (resumo.esperandoMais.length > 0) {
      linhas.push("Esperando a nossa resposta há mais tempo:");
      for (const espera of resumo.esperandoMais) {
        linhas.push(
          `- ${espera.cliente} · ${espera.fila} · ${espera.assunto} · ${espera.minutosEspera} min (operador: ${espera.operador})`,
        );
      }
    }
  }

  const record =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  if (typeof record.periodo === "string") {
    const mov = await loadIrisMovimentacaoPeriodo(
      context.client,
      record.periodo as C2xPeriodo,
    );

    if (mov) {
      linhas.push(
        "",
        `Histórico (${mov.periodoLabel}): ${mov.finalizados} atendimento(s) finalizado(s) e ${mov.criados} criado(s).`,
      );
    }
  }

  return linhas.join("\n");
}

async function consultarHermes(context: CacaToolContext): Promise<string> {
  if (!context.assistantHubUserId) {
    return "Essa pessoa não tem conta no Hermes (chat interno), então não há mensagens pra verificar.";
  }

  const resumo = await loadHermesResumo(context.client, context.assistantHubUserId);

  if (!resumo) {
    return "Não consegui consultar o Hermes agora.";
  }

  if (resumo.totalNaoLidas === 0) {
    return "Hermes: você está em dia, nenhuma mensagem não lida.";
  }

  return [
    `Hermes: você tem ${resumo.totalNaoLidas} mensagem(ns) não lida(s).`,
    ...resumo.canais.map((c) => `- ${c.canal}: ${c.naoLidas}`),
  ].join("\n");
}

async function consultarSaudeSistema(): Promise<string> {
  const saude = await loadInfraSaude();

  return [`Saúde do sistema:`, `- ${saude.vercel}`, `- ${saude.supabase}`].join(
    "\n",
  );
}

// ---- Ferramentas de analista (modo assistente) ----

// SUPER MOTOR: consulta parametrizada (cubo métrica × agrupamento × filtros × período).
// A validação/whitelist mora em lib/analytics; erro de combinação volta como texto pra
// CACÁ se corrigir sozinha no próximo turno. O módulo iris usa o Supabase do contexto.
async function consultarPanteon(
  context: CacaToolContext,
  input: unknown,
): Promise<string> {
  const record =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};

  const outcome = await queryPanteon(record, { supabase: context.client });

  if (!outcome.ok) {
    return `Não consegui montar essa consulta: ${outcome.erro}`;
  }

  return formatPanteonResultado(outcome.resultado);
}

// CENÁRIO COMERCIAL consolidado de UM empreendimento / imobiliária / cliente num período:
// junta propostas + vendas + faturados + valor + cancelamentos (e, pra empreendimento, o
// estado atual da carteira) numa resposta só. Reusa o motor (queryPanteon), então herda as
// regras validadas. Responde direto — a CACÁ NÃO deve "prometer levantar depois".
async function cenarioComercial(input: unknown): Promise<string> {
  const record =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const foco = typeof record.foco === "string" ? record.foco : "";
  const valor = typeof record.valor === "string" ? record.valor.trim() : "";

  if (!["empreendimento", "imobiliaria", "cliente"].includes(foco) || !valor) {
    return "Pra montar o cenário comercial, me diga o foco (empreendimento, imobiliaria ou cliente) e o nome. Ex.: foco='empreendimento', valor='Veredas do Ouro'.";
  }

  const base = {
    data_fim: typeof record.data_fim === "string" ? record.data_fim : undefined,
    data_inicio:
      typeof record.data_inicio === "string" ? record.data_inicio : undefined,
    filtros: { [foco]: valor } as Record<string, string>,
    modulo: "c2x",
    periodo: typeof record.periodo === "string" ? record.periodo : undefined,
  };

  const num = async (metrica: string) => {
    const outcome = await queryPanteon({ ...base, metrica });

    return outcome.ok ? outcome.resultado : null;
  };

  const [propostas, vendas, faturados, cancelamentos, valorFat] =
    await Promise.all([
      num("propostas"),
      num("vendas"),
      num("faturamentos"),
      num("cancelamentos"),
      num("valor_faturado"),
    ]);

  if (!propostas) {
    return `Não consegui montar o cenário do ${foco} "${valor}" agora (confira o nome ou tente de novo).`;
  }

  const focoLabel =
    foco === "empreendimento"
      ? "empreendimento"
      : foco === "imobiliaria"
        ? "imobiliária"
        : "cliente";

  const linhas = [
    `Cenário comercial — ${focoLabel} "${valor}" (${propostas.periodoLabel ?? "período"}):`,
    `- Propostas geradas: ${propostas.total}`,
    `- Vendas em andamento (contrato gerado + em assinatura + faturado): ${vendas?.total ?? 0}`,
    `- Vendas fechadas (faturado): ${faturados?.total ?? 0}`,
    `- Valor faturado: ${formatBrl(valorFat?.total ?? 0)}`,
    `- Cancelamentos/distratos: ${cancelamentos?.total ?? 0}`,
  ];

  // Fotografia atual da carteira só faz sentido por empreendimento (estado das unidades):
  // breakdown por TODOS os status (Disponível/Reservado/Em negociação/Vendido/Bloqueado).
  if (foco === "empreendimento") {
    const carteira = await queryPanteon({
      agrupar_por: "status_venda",
      filtros: { empreendimento: valor },
      metrica: "unidades_total",
      modulo: "c2x",
    });

    if (carteira.ok && carteira.resultado.total > 0) {
      const porStatus = (carteira.resultado.grupos ?? [])
        .map((g) => `${g.grupo} ${g.valor}`)
        .join(" · ");

      linhas.push(
        `Estado atual da carteira (${carteira.resultado.total} unidades): ${porStatus}.`,
      );
    }
  }

  linhas.push(
    "Se quiser, eu detalho por imobiliária, por perfil de cliente, ou lote a lote.",
  );

  return linhas.join("\n");
}

// Central de CAD (Asana): cadastros de prospects enviados pelos corretores. Cada CAD tem
// cliente (nome da task), empreendimento, imobiliária credenciada e etapa (seção).
// AÇÃO DE LANÇAMENTO — status da CAD de uma pessoa pelo CPF, lido da esteira do Board (não do
// Asana). A ETAPA da esteira já é o veredito: 'prevenda' = crédito aprovado (entra no PIX),
// 'revisao' = reprovado, 'validacao'/sem linha = ainda em validação. Ver o bloco da ação na persona.
async function consultarStatusCad(
  context: CacaToolContext,
  input: unknown,
): Promise<string> {
  const record =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const cpf = (typeof record.cpf === "string" ? record.cpf : "").replace(/\D/g, "");
  if (cpf.length !== 11) {
    return "Pra localizar a CAD eu preciso do CPF completo, com os 11 números. Confirme o CPF da pessoa e me manda de novo.";
  }

  // Admin client: ignora RLS, garante a leitura da esteira independentemente da policy.
  const admin = createApoloAdminClient();
  if (!admin) {
    return "Não consegui acessar a base de CADs agora. Se precisar, eu te encaminho pro nosso time.";
  }

  const match = await lookupApoloByDocument(admin, cpf);
  if (!match?.entityId) {
    return "Não localizei nenhuma CAD com esse CPF. Pode ser que o cadastro ainda não tenha sido enviado, ou que o número esteja diferente. Confere o CPF comigo; se continuar não achando, o time consegue verificar.";
  }

  // ⚠️ A CACÁ SÓ TEM O CPF — ou seja, a PESSOA, nunca o empreendimento. Desde a 0080 a pessoa
  // pode ter uma CAD por loteamento, então a resposta certa é LISTAR: se houver mais de uma, ela
  // diz o status de cada uma, com o nome do empreendimento. Escolher uma às escondidas seria
  // informar ao cliente o status da CAD errada.
  const cads = await lerCadsDaEsteira<{ empreendimento: string | null; etapa: string | null }>(
    admin,
    match.entityId,
    "etapa, empreendimento",
  );
  const esteira = cads[0] ?? null;

  const nome = match.displayName?.trim() || "o cliente";

  // Sem linha na esteira: SÓ é uma CAD desta ação se a entidade NASCEU como cadastro do portal
  // (status 'review' + origem 'apolo'). Um comprador antigo do C2X que por acaso tem o mesmo CPF
  // NÃO é uma CAD — não podemos dizer que "está em validação".
  if (!esteira) {
    const { data: ent } = await admin
      .from("apolo_entities")
      .select("status, metadata")
      .eq("id", match.entityId)
      .maybeSingle<{ metadata: { source?: string } | null; status: string | null }>();
    const ehCadNova = ent?.status === "review" && ent?.metadata?.source === "apolo";
    if (!ehCadNova) {
      return "Não localizei uma CAD desta ação com esse CPF. Pode ser que o cadastro ainda não tenha sido enviado. Confere o CPF comigo; se precisar, o time verifica.";
    }
    return `A CAD de ${nome} está em processo de validação. Depois da validação vem a análise de crédito; se for aprovada, ele entra no lote de PIX de amanhã. Pode me consultar de novo mais tarde, que já pode ter retorno.`;
  }

  // Mais de uma CAD: a pessoa está em dois lançamentos. Responder sobre uma só esconderia a
  // outra, e a pergunta ("como está minha CAD?") é sobre as duas.
  if (cads.length > 1) {
    const linhas = cads
      .map(
        (c) =>
          `• ${c.empreendimento?.trim() || "empreendimento não informado"}: ${rotuloEtapaCad(c.etapa)}`,
      )
      .join("\n");
    return (
      `${nome} tem ${cads.length} CADs abertas, uma por empreendimento:\n${linhas}\n\n` +
      "Me diz de qual empreendimento você quer falar que eu detalho."
    );
  }

  const empreendimento = esteira.empreendimento?.trim() || null;
  const ondeEmp = empreendimento ? ` (${empreendimento})` : "";
  const etapa = esteira.etapa ?? "validacao";

  if (etapa === "prevenda" || etapa === "credenciado") {
    // NÃO afirme envio aqui. Esta ferramenta lê a ETAPA da esteira, e etapa 'prevenda' quer
    // dizer "crédito aprovado, entrou na fila do PIX" — não que o PIX saiu: o disparo em
    // lote busca justamente quem está em 'prevenda' sem pagamento_ref, e o envio pode ter
    // falhado (número sem WhatsApp, e-mail errado). Quem sabe se saiu, para onde e se deu
    // erro é a consultar_ficha_credenciamento. Dizer "já foi enviado" aqui fazia o corretor
    // sair da conversa achando que o cliente recebeu, com a CAD parada.
    return `A CAD de ${nome}${ondeEmp} teve o crédito APROVADO e está na etapa do PIX do credenciamento. Se a pergunta for se o PIX já saiu, para qual número ou e-mail foi, se foi entregue ou se deu erro, chame consultar_ficha_credenciamento com esse mesmo CPF antes de responder. Se ele quiser o link agora, use enviar_pix_credenciamento — é a mesma cobrança, não cobra duas vezes.`;
  }
  if (etapa === "revisao") {
    return `A CAD de ${nome}${ondeEmp} passou pela análise e não foi aprovada no crédito nesta etapa, ficou em revisão com o nosso time. Se quiser, eu te encaminho pra um analista da Careli olhar o caso.`;
  }
  return `A CAD de ${nome}${ondeEmp} está em processo de validação. Depois da validação vem a análise de crédito; se for aprovada, ele recebe o PIX do credenciamento no WhatsApp e no e-mail. Se quiser, pode me consultar de novo mais tarde, que a validação e a análise já podem ter retorno.`;
}

// Rótulo curto da etapa, para listar várias CADs numa resposta só (a pessoa com CAD em mais de
// um empreendimento). Fala a língua do cliente, não a do banco.
function rotuloEtapaCad(etapa: string | null): string {
  switch (etapa) {
    case "credenciado":
      return "crédito aprovado, na etapa do PIX do credenciamento";
    case "credito":
      return "em análise de crédito";
    case "indeferido":
      return "não aprovada nesta etapa";
    case "prevenda":
      return "crédito aprovado, na etapa do PIX do credenciamento";
    case "revisao":
      return "em revisão com o nosso time";
    default:
      return "em processo de validação";
  }
}

// Mostra o suficiente pra pessoa CONFERIR se o contato está certo, sem despejar o dado inteiro
// numa conversa que pode não ser do titular.
function contatoParcial(valor: string | null, tipo: "email" | "telefone"): string {
  const v = (valor ?? "").trim();
  if (!v) return "não cadastrado";

  if (tipo === "telefone") {
    const d = v.replace(/\D/g, "");
    if (d.length < 6) return "número incompleto no cadastro";
    const nacional = d.startsWith("55") && d.length >= 12 ? d.slice(2) : d;
    const ddd = nacional.slice(0, 2);
    const fim = nacional.slice(-4);
    return `(${ddd}) ${"*".repeat(Math.max(0, nacional.length - 6))}-${fim}`;
  }

  const [usuario = "", dominio = ""] = v.split("@");
  if (!dominio) return `${v.slice(0, 3)}*** (não parece um e-mail válido)`;
  const visivel = usuario.slice(0, 3);
  return `${visivel}${"*".repeat(Math.max(1, usuario.length - 3))}@${dominio}`;
}

// RAIO-X DA FICHA para o atendimento: onde a CAD está, o que já foi enviado, para onde, se
// entregou, se deu erro e se pagou. É o que o atendente veria abrindo o Board do Apolo — a CACÁ
// passa a ver o mesmo, para responder sem transferir.
async function consultarFichaCredenciamento(
  context: CacaToolContext,
  input: unknown,
): Promise<string> {
  const record =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const cpf = (typeof record.cpf === "string" ? record.cpf : "").replace(/\D/g, "");
  if (cpf.length !== 11) {
    return "Pra abrir a ficha eu preciso do CPF completo, com os 11 números. Me confirma o CPF do cliente.";
  }

  const admin = createApoloAdminClient();
  if (!admin) {
    return "Não consegui acessar a base agora. Se precisar, eu te encaminho pro nosso time.";
  }

  const match = await lookupApoloByDocument(admin, cpf);
  if (!match?.entityId) {
    return "Não localizei nenhuma ficha com esse CPF. Confere o CPF comigo; se continuar não achando, o time verifica.";
  }
  const entityId = match.entityId;
  const nome = match.displayName?.trim() || "o cliente";

  // Sem empreendimento no escopo (a CACÁ atende por CPF): a CAD MAIS RECENTE, com ordem
  // explícita. É a que o cliente acabou de mandar, e é sobre ela que ele está perguntando.
  const esteira = await lerCadDaEsteira<{
    chegou_em: string | null;
    corretor: string | null;
    empreendimento: string | null;
    etapa: string | null;
    imobiliaria: string | null;
    pagamento_ref: string | null;
    pago_em: string | null;
  }>(
    admin,
    entityId,
    "etapa, empreendimento, imobiliaria, corretor, chegou_em, pago_em, pagamento_ref",
  );

  if (!esteira) {
    return `Não encontrei ${nome} na esteira de CADs desta ação. Pode ser que a ficha ainda não tenha sido enviada pelo time. Confere o CPF comigo ou me pede pra transferir.`;
  }

  const { data: disparos } = await admin
    .from("apolo_disparos")
    .select("tipo, origem, destinatario, status, erro, created_at, delivered_at, read_at")
    .eq("entity_id", entityId)
    .in("tipo", ["prevenda_cobranca", "prevenda_recibo"])
    .order("created_at", { ascending: true });

  const linhas = (disparos ?? []) as {
    created_at: string;
    delivered_at: string | null;
    destinatario: string | null;
    erro: string | null;
    origem: string | null;
    read_at: string | null;
    status: string | null;
    tipo: string | null;
  }[];

  const quando = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString("pt-BR", {
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          month: "2-digit",
          timeZone: "America/Sao_Paulo",
        })
      : "—";

  const ETAPAS: Record<string, string> = {
    credenciado: "CREDENCIADO (última etapa: o PIX já foi emitido e enviado)",
    credito: "ANÁLISE DE CRÉDITO",
    prevenda: "PRÉ-VENDA (crédito aprovado, é a etapa do PIX)",
    revisao: "EM REVISÃO (o crédito não foi aprovado nesta etapa)",
    validacao: "VALIDAÇÃO (o time está conferindo os dados da ficha)",
  };

  const partes: string[] = [
    `FICHA DE ${nome.toUpperCase()}`,
    `- Empreendimento: ${esteira.empreendimento?.trim() || "não informado"}`,
    `- Imobiliária: ${esteira.imobiliaria?.trim() || "não informada"} · Corretor: ${esteira.corretor?.trim() || "não informado"}`,
    `- CAD chegou em: ${quando(esteira.chegou_em)}`,
    `- Etapa atual: ${ETAPAS[esteira.etapa ?? ""] ?? esteira.etapa ?? "desconhecida"}`,
  ];

  // PAGAMENTO
  if (esteira.pago_em) {
    partes.push(
      `- PAGAMENTO: PAGO em ${quando(esteira.pago_em)}. O cadastro dele está CONCLUÍDO. A posição dele na fila do evento é definida por esta hora do pagamento.`,
    );
  } else if (esteira.pagamento_ref && !esteira.pagamento_ref.startsWith("reservado:")) {
    partes.push("- PAGAMENTO: cobrança emitida, mas AINDA NÃO PAGA.");
  } else {
    partes.push("- PAGAMENTO: ainda não há cobrança emitida para esta ficha.");
  }

  // ENVIOS: o que saiu, pra onde, e o que aconteceu depois.
  const cobrancas = linhas.filter((l) => l.tipo === "prevenda_cobranca");
  const recibos = linhas.filter((l) => l.tipo === "prevenda_recibo");

  const descreverEnvio = (l: (typeof linhas)[number]) => {
    const canal = l.origem?.includes("email") ? "email" : "telefone";
    const destino = contatoParcial(l.destinatario, canal === "email" ? "email" : "telefone");
    const rotulo = canal === "email" ? "E-mail" : "WhatsApp";

    if (l.erro) {
      const motivo = /undeliverable|131026|133010/i.test(l.erro)
        ? "o número não tem WhatsApp"
        : /fora do padrão/i.test(l.erro)
          ? "o telefone cadastrado não é um celular brasileiro válido, então não enviamos por segurança"
          : /sem telefone/i.test(l.erro)
            ? "não havia telefone no cadastro"
            : /sem e-mail/i.test(l.erro)
              ? "não havia e-mail no cadastro"
              : /invalid|400|mailbox|550/i.test(l.erro)
                ? "o e-mail cadastrado está inválido (erro de digitação)"
                : "falha técnica no envio";
      return `  · ${rotulo} para ${destino}: NÃO FOI ENTREGUE — ${motivo}. (tentativa em ${quando(l.created_at)})`;
    }

    const estado = l.read_at
      ? `LIDO em ${quando(l.read_at)}`
      : l.delivered_at
        ? `ENTREGUE em ${quando(l.delivered_at)}`
        : "enviado (ainda sem confirmação de entrega)";
    return `  · ${rotulo} para ${destino}: ${estado}. (enviado em ${quando(l.created_at)})`;
  };

  if (cobrancas.length) {
    partes.push("- PIX DO CREDENCIAMENTO — envios:");
    partes.push(...cobrancas.map(descreverEnvio));
  } else {
    partes.push("- PIX DO CREDENCIAMENTO: nenhum envio registrado para esta ficha ainda.");
  }

  if (recibos.length) {
    partes.push("- RECIBO do pagamento — envios:");
    partes.push(...recibos.map(descreverEnvio));
  }

  // PRÓXIMO PASSO — o que dizer a quem perguntou.
  const falhouTudo =
    cobrancas.length > 0 && cobrancas.every((l) => Boolean(l.erro));
  if (esteira.pago_em) {
    partes.push(
      "PRÓXIMO PASSO: nada a fazer, está concluído. NÃO mande link de pagamento pra ele.",
    );
  } else if (falhouTudo) {
    partes.push(
      "PRÓXIMO PASSO: ele NÃO recebeu a mensagem em nenhum canal. Confirme o telefone/e-mail corretos com quem está falando, use enviar_pix_credenciamento pra mandar o link na conversa, e avise o time pra corrigir o cadastro.",
    );
  } else if (esteira.pagamento_ref) {
    partes.push(
      "PRÓXIMO PASSO: a cobrança está em aberto. Se ele pedir o link de novo, use enviar_pix_credenciamento.",
    );
  } else if (esteira.etapa === "revisao") {
    partes.push(
      "PRÓXIMO PASSO: o caso está em revisão com o time. Ofereça encaminhar pra um analista, sem expor motivo ou score.",
    );
  } else {
    partes.push(
      "PRÓXIMO PASSO: a ficha ainda está andando na esteira. Explique a etapa e convide a consultar de novo mais tarde, sem prometer data.",
    );
  }

  return partes.join("\n");
}

// CONSOLIDADO das CADs de um empreendimento — o número somado que o atendente não conseguia
// montar abrindo ficha a ficha: quantas em cada etapa, quantas pagaram, quanto entrou.
async function consultarConsolidadoCads(
  context: CacaToolContext,
  input: unknown,
): Promise<string> {
  const record =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const empreendimento =
    (typeof record.empreendimento === "string" ? record.empreendimento : "").trim() ||
    "Vale do Ouro";

  const resumo = await carregarResumoApolo(empreendimento);
  if (!resumo) {
    return `Não consegui montar o consolidado de ${empreendimento} agora. Se precisar, o time verifica no Board.`;
  }

  const moeda = (v: number) =>
    v.toLocaleString("pt-BR", { currency: "BRL", minimumFractionDigits: 2, style: "currency" });

  // Total recebido = tudo que está na esteira (o funil inteiro). Não somo as etapas porque
  // "correcao" e outras podem se sobrepor; o total real vem de uma contagem à parte na lib? Não —
  // a lib já separa por etapa exclusiva. A soma das etapas é o total de fichas na esteira.
  const total =
    resumo.validacao +
    resumo.analiseCredito +
    resumo.creditoRevisao +
    resumo.correcao +
    resumo.prevenda +
    resumo.credenciados;

  return [
    `CONSOLIDADO DAS CADs — ${empreendimento}`,
    `Total na esteira: ${total} fichas.`,
    `- Validação: ${resumo.validacao}`,
    `- Análise de crédito: ${resumo.analiseCredito}`,
    `- Crédito em revisão (reprovados): ${resumo.creditoRevisao}`,
    resumo.correcao > 0 ? `- Em correção: ${resumo.correcao}` : "",
    `- Pré-venda (crédito aprovado, aguardando/recebendo o PIX): ${resumo.prevenda}`,
    `- Credenciado (PIX já emitido): ${resumo.credenciados}`,
    ``,
    `PAGAMENTOS: ${resumo.pagos} cliente(s) já pagaram o PIX, somando ${moeda(resumo.valorPago)}.`,
    ``,
    `Se quiser o detalhe de uma pessoa (se pagou, para qual telefone/e-mail foi o PIX, se deu erro), me passe o CPF que eu abro a ficha.`,
  ]
    .filter(Boolean)
    .join("\n");
}

// A FICHA (CAD) em PDF para a CACÁ encaminhar no atendimento — "me manda a ficha", "quero
// conferir os dados", "não recebi o anexo".
//
// Devolve um LINK ASSINADO de 1 hora, gerado na hora a partir do cadastro atual (então já sai com
// as correções que o time fez). O documento tem CPF, RG, filiação e renda: a persona manda entregar
// só ao próprio titular ou ao corretor/imobiliária daquela CAD, nunca a terceiro.
async function enviarFichaCad(context: CacaToolContext, input: unknown): Promise<string> {
  const record =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const cpf = (typeof record.cpf === "string" ? record.cpf : "").replace(/\D/g, "");
  if (cpf.length !== 11) {
    return "Pra gerar a ficha eu preciso do CPF completo, com os 11 números.";
  }

  const admin = createApoloAdminClient();
  if (!admin) {
    return "Não consegui acessar a base agora. Se precisar, eu te encaminho pro nosso time.";
  }

  const match = await lookupApoloByDocument(admin, cpf);
  if (!match?.entityId) {
    return "Não localizei nenhuma ficha com esse CPF. Confere o CPF comigo.";
  }
  const nome = match.displayName?.trim() || "o cliente";

  const ficha = await montarFichaCad(admin, match.entityId, nome);
  if (!ficha?.link) {
    return `Não consegui gerar a ficha de ${nome} agora. Avisa que vou acionar o time pra enviar.`;
  }

  return [
    `Ficha de cadastro (CAD) de ${nome}, em PDF:`,
    ficha.link,
    "",
    "O link vale por 1 hora — se expirar, é só me pedir de novo.",
    "Ao encaminhar, peça pra conferir os dados e avisar se algo estiver errado, que o time corrige.",
  ].join("\n");
}

// O PIX DO CREDENCIAMENTO na mão da CACÁ: quando o cliente, o corretor ou a imobiliária pede o
// link no atendimento, ela devolve na hora em vez de transferir pro time.
//
// É sempre a MESMA cobrança já emitida (lida de `apolo_esteira.pagamento_ref` e consultada no
// Asaas): reenviar não cria cobrança nova e ninguém paga duas vezes. Quem já pagou NÃO recebe
// link de novo — recebe a confirmação de que está pago.
async function enviarPixCredenciamento(
  context: CacaToolContext,
  input: unknown,
): Promise<string> {
  const record =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const cpf = (typeof record.cpf === "string" ? record.cpf : "").replace(/\D/g, "");
  if (cpf.length !== 11) {
    return "Pra achar o PIX do credenciamento eu preciso do CPF completo, com os 11 números. Me confirma o CPF do cliente.";
  }

  const admin = createApoloAdminClient();
  if (!admin) {
    return "Não consegui acessar a base agora. Se precisar, eu te encaminho pro nosso time.";
  }

  const match = await lookupApoloByDocument(admin, cpf);
  if (!match?.entityId) {
    return "Não localizei nenhuma CAD com esse CPF. Confere o CPF comigo; se continuar não achando, o time verifica.";
  }

  const nome = match.displayName?.trim() || "o cliente";

  // ⚠️ AQUI VAI UM LINK DE PAGAMENTO PARA O CLIENTE. Com CAD em dois loteamentos, mandar o PIX da
  // CAD errada é cobrar o valor de outro empreendimento. Como a CACÁ só tem o CPF, a regra é:
  // uma CAD -> manda; mais de uma -> PERGUNTA de qual é, em vez de escolher por conta.
  const cadsPix = await lerCadsDaEsteira<{
    empreendimento: string | null;
    etapa: string | null;
    pagamento_ref: string | null;
    pago_em: string | null;
  }>(admin, match.entityId, "etapa, pagamento_ref, pago_em, empreendimento");

  if (cadsPix.length > 1) {
    const nomes = cadsPix
      .map((c) => c.empreendimento?.trim() || "empreendimento não informado")
      .join(", ");
    return `${nome} tem CAD em mais de um empreendimento (${nomes}), e cada uma tem o seu PIX. Me diz de qual empreendimento é o credenciamento que eu mando o link certo — ou eu te encaminho pro time.`;
  }

  const esteira = cadsPix[0] ?? null;

  if (!esteira) {
    return `Não encontrei a CAD de ${nome} na esteira desta ação, então ainda não há PIX de credenciamento pra ele. Confere o CPF comigo ou fala com o time.`;
  }

  if (esteira.pago_em) {
    return `O PIX do credenciamento de ${nome} JÁ FOI PAGO — o cadastro dele está concluído. Não mande link de pagamento de novo: se ele pagar outra vez, vira devolução. Se ele quiser o comprovante, o time consegue reenviar o recibo.`;
  }

  if (!esteira.pagamento_ref || esteira.pagamento_ref.startsWith("reservado:")) {
    const etapa = esteira.etapa ?? "validacao";
    if (etapa === "revisao") {
      return `A CAD de ${nome} está em revisão de crédito, então ainda não existe PIX de credenciamento pra ela. Posso te encaminhar pra um analista olhar o caso.`;
    }
    return `A CAD de ${nome} ainda não chegou na etapa do PIX (está em ${etapa === "credito" ? "análise de crédito" : "validação"}), então ainda não existe cobrança emitida. Assim que o crédito for aprovado, o PIX é enviado no WhatsApp e no e-mail dele.`;
  }

  const [cobranca, qr] = await Promise.all([
    consultarCobranca(esteira.pagamento_ref),
    obterQrCodePix(esteira.pagamento_ref),
  ]);

  const link = cobranca.ok ? cobranca.data.invoiceUrl : null;
  const copiaECola = qr.ok ? qr.data.payload : null;

  if (!link && !copiaECola) {
    return `${nome} tem o PIX do credenciamento emitido, mas não consegui recuperar o link agora. Avisa que vou acionar o time pra reenviar.`;
  }

  const valor = cobranca.ok ? cobranca.data.value : 1000;
  const empreendimento = esteira.empreendimento?.trim() || "o empreendimento";

  const partes = [
    `PIX do credenciamento de ${nome} (${empreendimento}), no valor de R$ ${valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}:`,
    link ? `Link de pagamento: ${link}` : "",
    copiaECola ? `PIX copia e cola: ${copiaECola}` : "",
    "",
    "É a MESMA cobrança que já foi enviada pra ele, então pode mandar sem medo: não cobra duas vezes.",
    "Lembre ao encaminhar: esse valor é ETAPA DA FICHA DE CADASTRO — é abatido se ele adquirir uma ou mais unidades no evento, é restituído em até 10 dias úteis se não adquirir nenhuma, e NÃO garante reserva de unidade.",
  ];

  return partes.filter(Boolean).join("\n");
}

// Registra a CHAVE PIX que o prospect informa pra EVENTUAL DEVOLUÇÃO dos R$1.000 do credenciamento.
// Identidade pelo TELEFONE (context.entityId, casado por telefone) — a ficha nasce da esteira, então
// o telefone dela é assertivo. SÓ grava se o pagamento já CONSTA (pago_em): a devolução só existe
// depois de pago. Guarda server-side — não confia só no que a IA "acha".
async function registrarChavePix(
  context: CacaToolContext,
  input: unknown,
): Promise<string> {
  const record =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const chave = (typeof record.chave_pix === "string" ? record.chave_pix : "").trim();
  const tipo =
    typeof record.tipo_chave === "string" ? record.tipo_chave.trim().slice(0, 20) : null;

  if (!chave) {
    return "Me confirma qual é a sua chave PIX pra devolução, por favor.";
  }

  const entityId = context.entityId;
  if (!entityId) {
    return "Não consegui localizar seu cadastro pelo seu número aqui. Vou encaminhar pro nosso time registrar sua chave PIX.";
  }

  const admin = createApoloAdminClient();
  if (!admin) {
    return "Não consegui acessar a base agora. Já encaminho pro time registrar sua chave.";
  }

  // Sem empreendimento no escopo (a identidade aqui vem do TELEFONE do atendimento): a CAD mais
  // recente. Ver o comentário do update logo abaixo — a chave PIX é da pessoa, não da CAD.
  const esteira = await lerCadDaEsteira<{ pago_em: string | null }>(
    admin,
    entityId,
    "pago_em",
  );

  if (!esteira) {
    return "Não encontrei sua ficha na esteira desta ação. Vou encaminhar pro time.";
  }

  if (!esteira.pago_em) {
    return "Ainda não consta o pagamento do PIX confirmado na sua ficha. Assim que o pagamento cair, a gente registra sua chave PIX pra uma eventual devolução.";
  }

  // ⚠️ GRAVA EM TODAS AS CADs DA PESSOA, DE PROPÓSITO. A chave PIX de devolução é da PESSOA (é a
  // conta dela), não de uma CAD: se ela tiver direito a devolução em dois empreendimentos, é a
  // mesma conta que recebe. Registrar só numa deixaria a outra devolução sem para onde ir.
  const agora = new Date().toISOString();
  const { error } = await admin
    .from("apolo_esteira")
    .update({
      atualizado_em: agora,
      chave_pix_devolucao: chave,
      chave_pix_registrada_em: agora,
      chave_pix_registrada_via: "caca",
    })
    .eq("entity_id", entityId);

  if (error) {
    return "Tive um probleminha pra salvar sua chave PIX. Vou acionar o time pra registrar.";
  }

  return `Prontinho! Anotei sua chave PIX${tipo ? ` (${tipo})` : ""} pra uma eventual devolução. Lembrando: o valor é abatido se você adquirir uma ou mais unidades no evento; é restituído em até 10 dias úteis depois do evento se você não adquirir nenhuma; e não reserva unidade.`;
}

async function consultarCad(input: unknown): Promise<string> {
  const record =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const str = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim() : undefined;

  const agruparPorRaw = str(record.agrupar_por);
  const agruparPor: CadAgruparPor | null =
    agruparPorRaw === "empreendimento" ||
    agruparPorRaw === "imobiliaria" ||
    agruparPorRaw === "etapa"
      ? agruparPorRaw
      : null;

  const resultado = await queryCad({
    agruparPor,
    filtros: {
      cliente: str(record.cliente),
      empreendimento: str(record.empreendimento),
      etapa: str(record.etapa),
      imobiliaria: str(record.imobiliaria),
    },
    periodo: (str(record.periodo) as C2xPeriodo | undefined) ?? null,
  });

  if (!resultado) {
    return "Não consegui ler a Central de CAD agora (Apolo indisponível ou sem acesso).";
  }

  const cab = [
    "Central de CAD",
    resultado.periodoLabel ? `(${resultado.periodoLabel})` : null,
    resultado.filtrosLabel ? `[${resultado.filtrosLabel}]` : null,
  ]
    .filter(Boolean)
    .join(" ");

  // Consulta de um cliente específico (ex.: "qual imobiliária está o cliente X").
  if (str(record.cliente) && !agruparPor) {
    if (resultado.registros.length === 0) {
      return `${cab}: não encontrei nenhuma CAD com esse nome (confira a grafia).`;
    }

    const linhas = [`${cab}: ${resultado.total} CAD(s) encontrada(s).`];
    for (const r of resultado.registros.slice(0, 10)) {
      const partes = [
        r.cliente,
        r.empreendimento ? `empreendimento ${r.empreendimento}` : null,
        r.imobiliaria ? `imobiliária ${r.imobiliaria}` : "sem imobiliária no cadastro",
        r.etapa ? `etapa ${r.etapa}` : null,
      ].filter(Boolean);
      linhas.push(`- ${partes.join(" · ")}`);
    }

    return linhas.join("\n");
  }

  if (agruparPor && resultado.grupos) {
    const linhas = [`${cab}: ${resultado.total} CAD(s) no total, por ${agruparPor}:`];
    for (const grupo of resultado.grupos.slice(0, 30)) {
      linhas.push(`- ${grupo.grupo}: ${grupo.valor}`);
    }

    return linhas.join("\n");
  }

  // Contagem simples + amostra de nomes.
  const linhas = [`${cab}: ${resultado.total} CAD(s).`];
  const nomes = resultado.registros.map((r) => r.cliente);
  if (nomes.length) {
    linhas.push(
      `Clientes: ${nomes.slice(0, 25).join(", ")}${nomes.length > 25 ? `, e mais ${nomes.length - 25}…` : ""}.`,
    );
  }

  return linhas.join("\n");
}

function formatBrl(value: number | null): string {
  if (value == null) {
    return "-";
  }

  return value.toLocaleString("pt-BR", {
    currency: "BRL",
    style: "currency",
  });
}

async function consultarMovimentacaoC2x(input: unknown): Promise<string> {
  const record =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const periodo = (String(record.periodo ?? "esta_semana") as C2xPeriodo);

  const resumo = await loadC2xMovimentacaoResumo(periodo);

  if (!resumo) {
    return "Não consegui consultar a movimentação do C2X agora (banco indisponível).";
  }

  const linhas = [
    `Movimentação do C2X (${resumo.periodoLabel}):`,
    `- Propostas geradas: ${resumo.propostas}`,
    `- Vendas (contrato gerado + em assinatura + faturado): ${resumo.vendas}`,
    `  · Contrato gerado: ${resumo.contratoGerado} · Em assinatura: ${resumo.emAssinatura} · Faturado (venda fechada): ${resumo.faturado}`,
    `- Cancelamentos: ${resumo.cancelados} · Distratos: ${resumo.distratos}`,
    `- Reservas: ${resumo.reservas}`,
  ];

  const tipoDetalhe = record.tipo_detalhe;
  if (typeof tipoDetalhe === "string") {
    const itens = await loadC2xMovimentacaoDetalhe(
      periodo,
      tipoDetalhe as C2xMovimentacaoTipo,
    );

    linhas.push("", `Detalhe (${tipoDetalhe}):`);
    if (itens.length === 0) {
      linhas.push("- Nenhum caso no período.");
    } else {
      for (const item of itens) {
        const partes = [
          item.empreendimento,
          item.quadraLote,
          item.area != null ? `${item.area} m²` : null,
          `lote ${formatBrl(item.valorLote)}`,
          item.cliente ? `cliente ${item.cliente}` : null,
          item.corretor ? `corretor ${item.corretor}` : null,
          item.imobiliaria ? `imob. ${item.imobiliaria}` : null,
          `(${item.estagio})`,
        ].filter(Boolean);
        linhas.push(`- ${partes.join(" · ")}`);
      }
    }
  }

  return linhas.join("\n");
}

async function consultarVendasPorEmpreendimento(): Promise<string> {
  const rows = await loadC2xVendasPorEmpreendimento();

  if (rows.length === 0) {
    return "Não consegui consultar as vendas por empreendimento agora (banco indisponível).";
  }

  const totalVendidas = rows.reduce((sum, row) => sum + row.vendidas, 0);
  const linhas = [
    `Vendas por empreendimento (estado atual da carteira) — total vendidas: ${totalVendidas}:`,
    ...rows.map(
      (row) =>
        `- ${row.empreendimento}: ${row.vendidas} vendidas · ${row.disponiveis} disponíveis · ${row.total} no total`,
    ),
  ];

  return linhas.join("\n");
}

async function anotarSobreCliente(
  context: CacaToolContext,
  input: Record<string, unknown>,
) {
  const nota = readString(input.nota);

  if (!nota) {
    return "Anotação vazia — nada registrado.";
  }

  if (!context.contactId) {
    return "Não consegui registrar a anotação agora.";
  }

  const ok = await appendClientNote(context.client, context.contactId, nota);

  return ok
    ? "Anotação registrada sobre o cliente para os próximos atendimentos."
    : "Não consegui registrar a anotação agora.";
}

async function validarIdentidade(
  context: CacaToolContext,
  input: Record<string, unknown>,
) {
  const documento = onlyDigits(readString(input.documento));

  if (documento.length !== 11 && documento.length !== 14) {
    return "Documento inválido. Peça o CPF ou CNPJ completo (só os números) do titular.";
  }

  const match = await lookupApoloByDocument(context.client, documento);

  if (!match) {
    return "Documento não encontrado no nosso cadastro. Não dá pra liberar dado por aqui — transfira para um atendente validar o contrato com segurança.";
  }

  // Antes recusava quem nao fosse comprador-com-unidade. Agora atende TODO perfil
  // (comprador, imobiliaria, colaborador, prospect) — a identidade segue travada por
  // CPF/CNPJ + nome. Nao-comprador simplesmente nao tem carteira/parcelas (as tools de
  // cobranca respondem "sem carteira"), mas o cadastro e o contexto ficam acessiveis.
  const providedName = normalizeName(readString(input.nome_titular));
  const storedName = normalizeName(match.displayName);

  if (!providedName) {
    return "Documento localizado. Para concluir a validação com segurança, peça ao cliente o NOME COMPLETO do titular do contrato.";
  }

  if (!nameMatches(providedName, storedName)) {
    return "O nome informado não confere com o cadastro. Peça novamente o nome completo do titular, exatamente como está no contrato.";
  }

  context.c2xClientId = match.c2xClientId;
  context.customerName = match.displayName;
  context.identityVerified = true;
  context.validationSource = "cpf";
  context.customerProfileLabel =
    describeApoloProfile(match.profiles) ?? context.customerProfileLabel;

  // Lembra que ESTE número validou ESTE cadastro, pra o cliente não digitar CPF de novo no
  // próximo atendimento (a validação morria no fechamento do ticket, e 64,5% dos atendimentos
  // são de reincidentes). Vale 30 dias e pede reconfirmação do nome. Ver [[identidade-lembrada]].
  // Best-effort: falhar aqui não pode invalidar uma identidade que já foi confirmada.
  if (context.contactId && match.c2xClientId) {
    try {
      await gravarIdentidadeLembrada({
        c2xClientId: match.c2xClientId,
        client: context.client,
        contactId: context.contactId,
        displayName: match.displayName ?? null,
        documento,
      });
    } catch {
      // segue o atendimento: a memória é conveniência, não requisito.
    }
  }

  // Se quem validou é uma imobiliária/corretora, abre também a carteira DELA (clientes
  // vinculados) — assim ela pode consultar os clientes mesmo tendo se identificado por aqui.
  const isRealtorProfile = match.profiles.some((profile) =>
    ["imobiliaria", "corretor"].includes(profile.toLowerCase()),
  );

  if (isRealtorProfile && match.c2xClientId) {
    context.imobiliariaC2xClientId = match.c2xClientId;
    context.imobiliariaName = match.displayName ?? context.imobiliariaName;
  }

  const perfilNota = context.customerProfileLabel
    ? ` Perfil deste contato: ${context.customerProfileLabel}. Se o perfil não tem carteira, é normal não haver parcelas/boleto — não trate como erro nem ofereça cobrança.`
    : "";

  return `Identidade confirmada (${match.displayName}). Agora você pode consultar o cadastro e o financeiro deste cliente.${perfilNota}`;
}

// Cadastro do cliente PESSOA FÍSICA: só depois de identidade confirmada (mesma trava do
// financeiro). Lê o dados360 já carregado pelo Hades — não expõe id interno nem inventa campo.
async function consultarCadastro(context: CacaToolContext) {
  const guard = ensureVerified(context);

  if (guard) {
    return guard;
  }

  const record = await loadClientRecord(context.c2xClientId);
  let dados = record?.dados360;

  // Nao-comprador (colaborador, imobiliaria, prospect) nao entra na fila do Hades
  // (ela parte de contratos/parcelas) — le o cadastro DIRETO do users do C2X.
  if (!dados && context.c2xClientId) {
    const cadastroOnly = await loadC2xUserCadastro(context.c2xClientId);

    dados = cadastroOnly?.dados360;
  }

  if (!dados) {
    const perfil = context.customerProfileLabel;

    return [
      "Não há ficha de cadastro detalhada vinculada a este contato no módulo de carteira/cobrança.",
      perfil ? `Perfil deste contato: ${perfil}.` : "",
      "Isso é ESPERADO quando a pessoa NÃO é um comprador com carteira ativa (ex.: colaborador, imobiliária/parceiro, prospect) — NÃO é erro nem instabilidade do sistema, e você NÃO deve dizer que o sistema falhou.",
      "Explique com naturalidade pelo perfil da pessoa. Se ela precisar mesmo de algo de cadastro/comercial, confirme o que é e encaminhe para o time certo.",
    ]
      .filter(Boolean)
      .join(" ");
  }

  const nome = context.customerName || readString(dados.razaoSocial) || "cliente";
  const linhas: string[] = [
    "CADASTRO DO CLIENTE (informe só o que ele perguntar; se um campo estiver vazio, diga que NÃO consta — nunca invente):",
    `Nome: ${nome}`,
  ];

  const estadoCivil = readString(dados.estadoCivil);

  if (estadoCivil) {
    const regime = readString(dados.regimeBens);

    linhas.push(
      `Estado civil: ${estadoCivil}${regime ? ` (regime de bens: ${regime})` : ""}`,
    );
  }

  const nascimento = readString(dados.nascimento);

  if (nascimento) {
    const idade = readString(dados.idade);

    linhas.push(`Nascimento: ${nascimento}${idade ? ` (${idade})` : ""}`);
  }

  const naturalidade = readString(dados.naturalidade);
  const nacionalidade = readString(dados.nacionalidade);

  if (naturalidade || nacionalidade) {
    linhas.push(
      `Naturalidade/Nacionalidade: ${[naturalidade, nacionalidade].filter(Boolean).join(" / ")}`,
    );
  }

  const profissao = readString(dados.profissao);

  if (profissao) {
    linhas.push(`Profissão: ${profissao}`);
  }

  const rg = readString(dados.rg) || readString(dados.documentoIdentidade);

  if (rg) {
    linhas.push(`RG: ${rg}`);
  }

  const email = readString(dados.email);

  if (email) {
    linhas.push(`E-mail no cadastro: ${email}`);
  }

  const telefone = readString(dados.telefone);

  if (telefone) {
    linhas.push(`Telefone no cadastro: ${telefone}`);
  }

  const endereco = formatCadastroEndereco(dados);

  if (endereco) {
    linhas.push(`Endereço: ${endereco}`);
  }

  const nomeMae = readString(dados.nomeMae);

  if (nomeMae) {
    linhas.push(`Nome da mãe: ${nomeMae}`);
  }

  const conjuge = readString(dados.conjuge);

  if (conjuge) {
    const conjugeDados = dados.conjugeDados;
    const extras = conjugeDados
      ? [
          readString(conjugeDados.profissao)
            ? `profissão ${readString(conjugeDados.profissao)}`
            : null,
          readString(conjugeDados.nascimento)
            ? `nascimento ${readString(conjugeDados.nascimento)}`
            : null,
        ]
          .filter(Boolean)
          .join(", ")
      : "";

    linhas.push(`Cônjuge: ${conjuge}${extras ? ` (${extras})` : ""}`);
  }

  return linhas.join("\n");
}

// Cadastro de IMOBILIÁRIA / pessoa jurídica: regra do Lucas — PJ NÃO precisa validar
// identidade, basta o CNPJ. Confirma se existe cadastro e devolve os dados da empresa.
async function consultarCadastroImobiliaria(
  context: CacaToolContext,
  input: Record<string, unknown>,
) {
  const cnpj = onlyDigits(readString(input.cnpj));

  if (cnpj.length !== 14) {
    return cnpj.length === 11
      ? "Isso é um CPF (pessoa física). Dado de pessoa física só depois de confirmar a identidade do titular (validar_identidade) — não use esta ferramenta."
      : "CNPJ inválido. Peça o CNPJ completo da imobiliária (só os números, 14 dígitos).";
  }

  const match = await lookupApoloByDocument(context.client, cnpj);

  if (!match) {
    return "Não localizei nenhum cadastro com esse CNPJ. Confirme o número com a imobiliária; se estiver certo, pode ser que ainda não haja cadastro — nesse caso transfira para o time cadastrar.";
  }

  // Abre o escopo de carteira: a partir daqui a imobiliária pode consultar os clientes DELA
  // (consultar_cliente_da_imobiliaria / resumo_carteira_imobiliaria), sempre limitado ao
  // vínculo vinculed_by_id = este id C2X. Só abrimos se o perfil for de fato imobiliária/corretor.
  const isRealtorProfile = match.profiles.some((profile) =>
    ["imobiliaria", "corretor"].includes(profile.toLowerCase()),
  );

  if (isRealtorProfile && match.c2xClientId) {
    context.imobiliariaC2xClientId = match.c2xClientId;
    context.imobiliariaName = match.displayName ?? context.imobiliariaName;
  }

  const linhas: string[] = [
    "CADASTRO ENCONTRADO para o CNPJ informado — pode confirmar que a imobiliária TEM cadastro na Careli.",
    `Razão/Nome: ${match.displayName ?? "não consta"}`,
  ];

  if (match.profiles.length) {
    linhas.push(`Perfil no sistema: ${match.profiles.join(", ")}`);
  }

  if (isRealtorProfile && match.c2xClientId) {
    linhas.push(
      "Esta imobiliária está identificada — você já pode consultar os CLIENTES DELA (cadastro, financeiro e boleto) com consultar_cliente_da_imobiliaria e resumo_carteira_imobiliaria. Só aparecem os clientes vinculados a ela.",
    );
  }

  // Enriquecimento: se a PJ tiver vínculo C2X, traz razão social/fantasia/contato/endereço.
  if (match.c2xClientId) {
    const record = await loadClientRecord(match.c2xClientId);
    const dados = record?.dados360;

    if (dados) {
      const razao = readString(dados.razaoSocial);
      const fantasia = readString(dados.nomeFantasia);
      const email = readString(dados.email);
      const telefone = readString(dados.telefone);
      const endereco = formatCadastroEndereco(dados);

      if (razao) {
        linhas.push(`Razão social: ${razao}`);
      }

      if (fantasia) {
        linhas.push(`Nome fantasia: ${fantasia}`);
      }

      if (email) {
        linhas.push(`E-mail no cadastro: ${email}`);
      }

      if (telefone) {
        linhas.push(`Telefone no cadastro: ${telefone}`);
      }

      if (endereco) {
        linhas.push(`Endereço: ${endereco}`);
      }
    }
  }

  linhas.push(
    "Informe só o que a imobiliária perguntar. Se pedirem algo que não está aqui, transfira para o time.",
  );

  return linhas.join("\n");
}

// Mensagem-guarda: as tools de carteira/cliente só operam com uma imobiliária identificada.
function imobiliariaScopeMessage(): string {
  return "Esta consulta é só para uma IMOBILIÁRIA/corretora identificada ver os clientes DELA. Se quem fala é uma imobiliária, confirme o CNPJ (consultar_cadastro_imobiliaria) que eu abro a carteira. Se for um cliente pessoa física falando do próprio cadastro, use validar_identidade.";
}

// Panorama da carteira da imobiliária (saúde financeira dos boletos dos clientes dela).
async function resumoCarteiraImobiliaria(context: CacaToolContext) {
  const imobId = context.imobiliariaC2xClientId;

  if (!imobId) {
    return imobiliariaScopeMessage();
  }

  const summary = await loadC2xImobiliariaCarteiraSummary(imobId);

  if (!summary || summary.clientesComContrato === 0) {
    return "Não localizei clientes com contrato vinculados a esta imobiliária. Confirme com ela ou transfira para o time conferir a carteira.";
  }

  const linhas: string[] = [
    `PANORAMA DA CARTEIRA${context.imobiliariaName ? ` de ${context.imobiliariaName}` : ""} (informe de forma executiva; são os clientes vinculados a esta imobiliária):`,
    `Clientes com contrato: ${summary.clientesComContrato}`,
    `Em dia (sem parcela vencida): ${summary.clientesEmDia}`,
    `Com parcela vencida: ${summary.clientesComVencida}`,
    `Total vencido na carteira: ${summary.totalVencido}`,
  ];

  if (summary.destaques.length) {
    linhas.push("Clientes mais atrasados (para priorizar):");
    for (const item of summary.destaques) {
      const doc =
        item.documentMasked && item.documentMasked !== "-"
          ? ` (${item.documentMasked})`
          : "";

      linhas.push(
        `- ${item.name}${doc}: ${item.vencidas} vencida(s), ${item.valorVencido}, até ${item.diasAtraso} dia(s) de atraso`,
      );
    }

    linhas.push(
      "Para o boleto de um cliente específico, use consultar_cliente_da_imobiliaria e depois gerar_boleto_cliente_imobiliaria.",
    );
  }

  return linhas.join("\n");
}

// Consulta cadastro + financeiro de UM cliente da imobiliária (escopo pelo vínculo).
async function consultarClienteDaImobiliaria(
  context: CacaToolContext,
  input: Record<string, unknown>,
) {
  const imobId = context.imobiliariaC2xClientId;

  if (!imobId) {
    return imobiliariaScopeMessage();
  }

  const termo = readString(input.cliente).trim();

  if (termo.length < 3) {
    return "Me diga o nome completo OU o CPF/CNPJ do cliente que você quer consultar.";
  }

  const matches = await findC2xImobiliariaClients(imobId, termo);

  if (!matches.length) {
    return "Não encontrei esse cliente vinculado à SUA imobiliária. Confira o nome/CPF; se estiver certo, pode ser que ele não esteja na sua carteira — nesse caso transfira para o time verificar.";
  }

  if (matches.length > 1) {
    return [
      "Encontrei mais de um cliente com esse nome na sua carteira. Pergunte qual é (peça o CPF ou o nome completo):",
      ...matches.map((match) => `- ${describeClientMatch(match)}`),
    ].join("\n");
  }

  const [match] = matches;

  if (!match) {
    return "Não consegui carregar o cliente agora. Tente de novo em instantes.";
  }

  return buildImobiliariaClienteReport(match);
}

async function buildImobiliariaClienteReport(match: C2xImobiliariaClientMatch) {
  const linhas: string[] = [
    `CLIENTE DA IMOBILIÁRIA: ${describeClientMatch(match)}`,
    "(Informe só o que a imobiliária perguntar; se um campo não constar, diga que não consta — nunca invente.)",
  ];

  const record = await loadClientRecord(match.clientId);
  let dados = record?.dados360;

  if (!dados) {
    const cadastroOnly = await loadC2xUserCadastro(match.clientId);

    dados = cadastroOnly?.dados360;
  }

  if (dados) {
    const estadoCivil = readString(dados.estadoCivil);

    if (estadoCivil) {
      linhas.push(`Estado civil: ${estadoCivil}`);
    }

    const email = readString(dados.email);

    if (email) {
      linhas.push(`E-mail no cadastro: ${email}`);
    }

    const telefone = readString(dados.telefone);

    if (telefone) {
      linhas.push(`Telefone no cadastro: ${telefone}`);
    }

    const endereco = formatCadastroEndereco(dados);

    if (endereco) {
      linhas.push(`Endereço: ${endereco}`);
    }
  }

  const items = await loadInstallments(match.clientId);
  const vencidas = items.filter((item) => item.status === "Vencida");
  const aVencer = items.filter((item) => item.status === "A vencer");
  const liquidadas = items.filter((item) => item.status === "Liquidada");
  const proxima = sortInstallmentsByDueDate(aVencer)[0];

  linhas.push("FINANCEIRO DO CLIENTE:");

  if (vencidas.length) {
    linhas.push(`Parcelas vencidas (${vencidas.length}):`);
    for (const item of vencidas.slice(0, 8)) {
      const link = hasBoletoLink(item) ? "link disponível" : "sem link";

      linhas.push(
        `- ${describeInstallment(item)} | ${overdueLabel(item)} | ${link}`,
      );
    }
  } else {
    linhas.push("Nenhuma parcela vencida no momento.");
  }

  linhas.push(
    proxima
      ? `Próximo vencimento: ${describeInstallment(proxima)}`
      : "Sem próxima parcela a vencer registrada.",
  );
  linhas.push(`Parcelas já liquidadas: ${liquidadas.length}.`);

  if (!items.length) {
    linhas.push(
      "OBSERVAÇÃO: este cliente não tem parcelas registradas — pode não ter carteira ativa. NÃO trate como erro.",
    );
  }

  linhas.push(
    "Para enviar o boleto de uma parcela, use gerar_boleto_cliente_imobiliaria (informe o cliente + a parcela).",
  );

  return linhas.join("\n");
}

// Gera o link do boleto de um cliente da imobiliária. Reconfirma o vínculo antes de gerar.
async function gerarBoletoClienteImobiliaria(
  context: CacaToolContext,
  input: Record<string, unknown>,
) {
  const imobId = context.imobiliariaC2xClientId;

  if (!imobId) {
    return imobiliariaScopeMessage();
  }

  const termo = readString(input.cliente).trim();
  const parcela = readString(input.parcela);

  if (termo.length < 3) {
    return "Me diga o nome completo OU o CPF/CNPJ do cliente cujo boleto você quer.";
  }

  const matches = await findC2xImobiliariaClients(imobId, termo);

  if (!matches.length) {
    return "Não encontrei esse cliente vinculado à SUA imobiliária. Confira o nome/CPF do cliente.";
  }

  if (matches.length > 1) {
    return "Há mais de um cliente com esse nome na sua carteira. Peça o CPF do cliente para eu escolher o certo.";
  }

  const [match] = matches;

  if (!match) {
    return "Não consegui carregar o cliente agora. Tente de novo em instantes.";
  }

  const items = await loadInstallments(match.clientId);
  const target = items.find(
    (item) =>
      normalizeKey(readString(item.number)) === normalizeKey(parcela) ||
      readString(item.id) === parcela.trim(),
  );

  if (!target) {
    return "Não localizei essa parcela na lista do cliente. Consulte o cliente de novo (consultar_cliente_da_imobiliaria) e confira o número da parcela.";
  }

  if (!hasBoletoLink(target)) {
    return "Essa parcela NÃO tem link de boleto disponível no sistema. Informe a imobiliária que a parcela existe, mas o link precisa ser emitido pelo time — e transfira.";
  }

  try {
    const boleto = await prepareBoletoResendAction(readString(target.id), "link");

    if (!boleto.boletoUrl) {
      return "Não consegui preparar o link com segurança agora. Informe a imobiliária e transfira para o time.";
    }

    return `Link do boleto da parcela ${readString(target.number) || ""} do cliente ${match.name}: ${boleto.boletoUrl}\nPeça para conferir os dados antes de pagar.`;
  } catch {
    return "Falha ao preparar o link do boleto. Informe a imobiliária e transfira para o time.";
  }
}

async function consultarFinanceiro(context: CacaToolContext) {
  const guard = ensureVerified(context);

  if (guard) {
    return guard;
  }

  const items = await loadInstallments(context.c2xClientId);
  const vencidas = items.filter((item) => item.status === "Vencida");
  const aVencer = items.filter((item) => item.status === "A vencer");
  const liquidadas = items.filter((item) => item.status === "Liquidada");
  // Ordena por dueDateInput ISO — regra e teste de regressão vivem em
  // installment-order.ts (bug 30/jun: sort por data BR apontava parcela errada).
  const proxima = sortInstallmentsByDueDate(aVencer)[0];

  const linhas: string[] = ["RESUMO FINANCEIRO (não exponha ids internos):"];

  if (vencidas.length) {
    linhas.push(`Parcelas vencidas (${vencidas.length}):`);
    for (const item of vencidas.slice(0, 8)) {
      linhas.push(`- ${describeInstallment(item)} | ${overdueLabel(item)}`);
    }
  } else {
    linhas.push("Nenhuma parcela vencida no momento.");
  }

  linhas.push(
    proxima
      ? `Próximo vencimento: ${describeInstallment(proxima)}`
      : "Sem próxima parcela a vencer registrada.",
  );
  linhas.push(`Parcelas já liquidadas: ${liquidadas.length}.`);

  if (!vencidas.length && !aVencer.length && !liquidadas.length) {
    linhas.push(
      context.customerProfileLabel
        ? `OBSERVAÇÃO: nada consta porque este contato (${context.customerProfileLabel}) provavelmente não tem carteira de financiamento — é ESPERADO, NÃO é erro nem instabilidade. Não diga que o sistema falhou; contextualize pelo perfil.`
        : "OBSERVAÇÃO: se nada consta, pode ser que este contato não tenha carteira (ex.: não é comprador) — é ESPERADO, NÃO é erro/instabilidade. Contextualize pelo perfil, não diga que o sistema falhou.",
    );
  }

  return linhas.join("\n");
}

async function listarBoletos(context: CacaToolContext) {
  const guard = ensureVerified(context);

  if (guard) {
    return guard;
  }

  // Um cliente pode ter VÁRIOS lotes (cada acquisition_request é um contrato/lote).
  // O registro já traz as parcelas de TODOS os lotes juntas (c2xInstallments), e cada
  // parcela carrega unitId/unitLabel. Aqui a gente AGRUPA por lote pra Caca conseguir
  // abordar todos e não achar que existe um boleto só quando há mais de um lote.
  const items = (await loadInstallments(context.c2xClientId)).filter(
    (item) => item.status === "Vencida" || item.status === "A vencer",
  );

  if (!items.length) {
    return "Não há parcelas vencidas ou a vencer registradas para este cliente.";
  }

  // Agrupa as parcelas elegíveis por lote (unitId), preservando a ordem de chegada.
  const groups = new Map<string, { items: CacaInstallment[]; label: string }>();

  for (const item of items) {
    const record = item as Record<string, unknown>;
    const key =
      readString(record.unitId) ||
      readString(record.acquisitionRequestId) ||
      "lote";
    const label =
      readString(record.unitLabel) ||
      readString(record.unitCode) ||
      "Lote não identificado";
    const group = groups.get(key) ?? { items: [], label };
    group.items.push(item);
    groups.set(key, group);
  }

  const multi = groups.size > 1;
  const linhas: string[] = [];

  linhas.push(
    multi
      ? `Este cliente tem ${groups.size} lotes/unidades com parcela em aberto. Aborde TODOS. Parcelas elegíveis AGRUPADAS POR LOTE (o link só sai com gerar_link_boleto):`
      : "PARCELAS ELEGÍVEIS (informe ao cliente; o link só sai com gerar_link_boleto):",
  );

  for (const group of groups.values()) {
    if (multi) {
      linhas.push("", `LOTE ${group.label}:`);
    }

    for (const item of group.items.slice(0, 6)) {
      const link = hasBoletoLink(item)
        ? "link disponível"
        : "sem link disponível";

      linhas.push(
        `- Parcela ${readString(item.number) || "?"} (${describeInstallment(item)}) | ${link}`,
      );
    }
  }

  if (multi) {
    linhas.push(
      "",
      "IMPORTANTE: o cliente tem mais de um lote. Responda cobrindo CADA lote — diga a próxima parcela em aberto de cada um. NUNCA afirme que existe só um boleto se houver parcela em aberto em outro lote.",
    );
  }

  return linhas.join("\n");
}

async function gerarLinkBoleto(
  context: CacaToolContext,
  input: Record<string, unknown>,
) {
  const guard = ensureVerified(context);

  if (guard) {
    return guard;
  }

  const parcela = readString(input.parcela);
  const items = await loadInstallments(context.c2xClientId);
  const target = items.find(
    (item) =>
      normalizeKey(readString(item.number)) === normalizeKey(parcela) ||
      readString(item.id) === parcela.trim(),
  );

  if (!target) {
    return "Não localizei essa parcela na lista. Liste os boletos novamente e confira o número.";
  }

  if (!hasBoletoLink(target)) {
    return "Esta parcela NÃO tem link de boleto disponível no sistema. Informe ao cliente que a parcela existe, mas o link precisa ser emitido pelo time interno — e transfira.";
  }

  try {
    const boleto = await prepareBoletoResendAction(readString(target.id), "link");

    if (!boleto.boletoUrl) {
      return "Não consegui preparar o link com segurança agora. Informe o cliente e transfira para o time interno.";
    }

    return `Link do boleto da parcela ${readString(target.number) || ""}: ${boleto.boletoUrl}\nPeça ao cliente para conferir os dados antes de pagar.`;
  } catch {
    return "Falha ao preparar o link do boleto. Informe o cliente e transfira para o time interno.";
  }
}

function transferirParaHumano(
  context: CacaToolContext,
  input: Record<string, unknown>,
) {
  const motivo =
    readString(input.motivo) || "Atendimento humano solicitado pela Cacá.";

  context.handoff = { reason: motivo, requested: true };

  const hoursGuidance = context.businessHoursOpen
    ? "O time humano está ATENDENDO agora — pode dizer que um analista da Careli dá continuidade em seguida (sem prometer prazo exato)."
    : `O time humano NÃO está atendendo agora. NÃO prometa resposta imediata nem diga "em instantes": avise com naturalidade que um analista da Careli retoma ${context.nextContactLabel} e segue a partir daí.`;

  return [
    "Transferência registrada para um ANALISTA da Careli. Antes de encerrar a sua parte, escreva ao cliente UMA mensagem que DEMONSTRE o atendimento (não genérica):",
    "1) Diga de forma ESPECÍFICA o que você já identificou sobre o caso (parcela / valor / vencimento / situação real) — use só os dados que você já tem em mãos, NÃO invente.",
    "2) Explique POR QUE isso foge do que você consegue executar (ex.: o boleto não está emitido ou o link não está disponível pra você).",
    "3) Deixe claro que vai encaminhar para um ANALISTA da Careli dar continuidade.",
    hoursGuidance,
    "Seja calorosa e específica. NUNCA mande algo genérico do tipo 'já encaminhei pro nosso time'. Siga o tom e as regras da sua persona.",
  ].join("\n");
}

// ---- helpers ----

type CacaInstallment = Awaited<
  ReturnType<typeof loadHadesAttendanceClient>
> extends { c2xInstallments?: infer T }
  ? T extends Array<infer Item>
    ? Item
    : Record<string, unknown>
  : Record<string, unknown>;

async function loadInstallments(
  c2xClientId: string | null,
): Promise<CacaInstallment[]> {
  if (!c2xClientId) {
    return [];
  }

  const queue = await loadHadesAttendanceClient(c2xClientId);

  return (queue?.c2xInstallments ?? []) as CacaInstallment[];
}

type CacaClientRecord = NonNullable<
  Awaited<ReturnType<typeof loadHadesAttendanceClient>>
>;

async function loadClientRecord(
  c2xClientId: string | null,
): Promise<CacaClientRecord | null> {
  if (!c2xClientId) {
    return null;
  }

  return (await loadHadesAttendanceClient(c2xClientId)) ?? null;
}

function formatCadastroEndereco(dados: CacaClientRecord["dados360"]): string {
  return [
    readString(dados.endereco),
    readString(dados.numeroEndereco)
      ? `nº ${readString(dados.numeroEndereco)}`
      : "",
    readString(dados.complementoEndereco),
    readString(dados.bairro),
    readString(dados.cidade),
    readString(dados.cep) ? `CEP ${readString(dados.cep)}` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

function ensureVerified(context: CacaToolContext): string | null {
  if (!context.identityVerified) {
    return "A identidade do cliente ainda não foi confirmada. Use validar_identidade antes de consultar ou enviar qualquer dado financeiro.";
  }

  if (!context.c2xClientId) {
    return "Cadastro confirmado, mas sem vínculo financeiro para consultar por aqui. Transfira para um atendente conferir no sistema.";
  }

  return null;
}

// PODE DIZER O VALOR DESTA PARCELA?
//
// Regra do Lucas (21/08/2026): *"as parcelas que tem boleto emitido, ela pode mencionar valor, e
// tambem das parcelas pagas. As parcelas futuras sem boleto emitido, ela pode somente fazer
// mencao sem informar os valores, assim evitamos transmitir informacoes erradas."*
//
// ⚠️ O MOTIVO E QUE O REAJUSTE E MANUAL. Nao existe campo de reajuste no C2X: a correcao e
// aplicada a mao, sobrescrevendo `initial_value`, no momento em que a parcela recebe boleto. Quem
// ainda nao tem boleto carrega o valor CONTRATUAL CRU, defasado.
//
// Medido em 21/08 no contrato 455: a parcela 34 (com boleto, mai/2027) vale R$ 535,72 e a 35
// (sem boleto, jun/2027) vale R$ 426,81 — 20,4% a menos, e era esse numero que a CACA informava.
// Na carteira inteira, das 96.682 parcelas em aberto apenas 990 (1%) tem boleto; 1.201 estao
// VENCIDAS sem boleto, que e o caso em que ela falava valor com mais convicção.
//
// O boleto e um PROXY do reajuste, nao a prova dele — se alguem emitir boleto sem reajustar, o
// valor errado passa. Mas e o unico sinal que existe no dado, e erra para o lado seguro.
//
// ⚠️ LIBERADO EM 27/08/2026 (decisao do Lucas). O que mudou no mundo: em 26/08 o reajuste foi
// aplicado em 768 parcelas do Lavra do Ouro (LOU/LOS) ate a competencia 12/2026 — os dois
// empreendimentos que respondem por 467 dos 526 contratos vivos. Os demais (REP, VAL, MDS, LBF)
// o Lucas atualiza em seguida; ele decidiu liberar tudo agora sabendo disso, porque "o grande
// volume e do Lavra do Ouro".
//
// ⚠️ O QUE FAZ ISSO VOLTAR A SER MENTIRA: a carteira anda. Quando a competencia de hoje passar
// da ultima que foi reajustada (hoje 12/2026), as parcelas seguintes voltam a carregar valor
// contratual cru e a CACA volta a informar numero defasado. A medicao que denuncia, por
// empreendimento: media do `initial_value` das parcelas em aberto de set-dez/2026 contra as do
// inicio de 2027 — no Lavra deu +23%; em REP/VAL/MDS/LBF deu 0%, que e o sinal de "nao
// reajustado". Se isso reaparecer, o caminho de volta e uma linha: trocar o `true` por
// `hasBoletoLink(item)` aqui e reverter a secao VALOR da persona.
export function podeInformarValor(item: CacaInstallment): boolean {
  // Paga: o valor e o que REALMENTE foi pago (`paid_value`), entao e verdade histórica.
  if (readString((item as Record<string, unknown>).status) === "Liquidada") return true;

  // Em aberto: com o reajuste aplicado ate 12/2026, o valor gravado e o valor que vai sair no
  // boleto. `hasBoletoLink` continua existindo porque decide o ENVIO DO LINK — que e outra
  // coisa e nao foi liberado.
  return true;
}

// ⚠️ NAO OMITE EM SILENCIO. Sem nada no lugar do valor, o modelo tende a preencher a lacuna — ou
// o cliente pergunta "quanto e?" e ele inventa. A marca explicita diz que o numero existe, que
// ainda nao esta fechado, e quando fica.
const VALOR_SOB_ATUALIZACAO = "valor sob atualização (confirmado na emissão do boleto)";

export function describeInstallment(item: CacaInstallment): string {
  const record = item as Record<string, unknown>;
  const numero = readString(record.number);
  const referencia = readString(record.reference);
  const valor = readString(record.value);
  const vencimento = readString(record.dueDate);
  const partes = [
    numero ? `parcela ${numero}` : null,
    referencia || null,
    vencimento ? `vence/venceu ${vencimento}` : null,
    podeInformarValor(item) ? valor || null : VALOR_SOB_ATUALIZACAO,
  ].filter(Boolean);

  return partes.join(" | ") || "parcela";
}

function overdueLabel(item: CacaInstallment): string {
  const days = Number((item as Record<string, unknown>).overdueDays);

  return Number.isFinite(days) && days > 0
    ? `${days} dia(s) em atraso`
    : "em atraso";
}

function hasBoletoLink(item: CacaInstallment): boolean {
  const record = item as Record<string, unknown>;

  return Boolean(readString(record.paymentUrl) || readString(record.invoiceUrl));
}

function describeClientMatch(match: C2xImobiliariaClientMatch): string {
  const doc =
    match.documentMasked && match.documentMasked !== "-"
      ? ` (${match.documentMasked})`
      : "";

  return `${match.name}${doc}`;
}

function requireDefinition(name: string) {
  const definition = DEFINITION_BY_NAME.get(name);

  if (!definition) {
    throw new Error(`Definição da ferramenta ausente: ${name}`);
  }

  return definition;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

function normalizeKey(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Match tolerante: confere se o primeiro e o último nome batem (cobre nome do meio omitido).
function nameMatches(provided: string, stored: string): boolean {
  if (!provided || !stored) {
    return false;
  }

  if (provided === stored) {
    return true;
  }

  const providedTokens = provided.split(" ").filter(Boolean);
  const storedTokens = stored.split(" ").filter(Boolean);

  if (providedTokens.length < 2 || storedTokens.length < 2) {
    return stored.includes(provided) || provided.includes(stored);
  }

  return (
    providedTokens[0] === storedTokens[0] &&
    providedTokens[providedTokens.length - 1] ===
      storedTokens[storedTokens.length - 1]
  );
}
