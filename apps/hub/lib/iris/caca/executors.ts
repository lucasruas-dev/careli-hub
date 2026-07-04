import type { SupabaseClient } from "@supabase/supabase-js";

import type { ClaudeAgentTool } from "@/lib/ai/claude-agent";
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
  loadC2xMovimentacaoDetalhe,
  loadC2xMovimentacaoResumo,
  loadC2xVendasPorEmpreendimento,
} from "@/lib/guardian/c2x-analytics";
import { lookupApoloByDocument } from "@/lib/iris/caca-agent";
import { loadHermesResumo } from "@/lib/iris/hermes-analytics";
import { loadInfraSaude } from "@/lib/iris/infra-analytics";
import { loadIrisAtendimentosResumo } from "@/lib/iris/iris-analytics";

import { appendClientNote } from "./client-memory";
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
        definition: requireDefinition("consultar_movimentacao_c2x"),
        run: async (input) => consultarMovimentacaoC2x(input),
      },
      {
        definition: requireDefinition("consultar_vendas_por_empreendimento"),
        run: async () => consultarVendasPorEmpreendimento(),
      },
      {
        definition: requireDefinition("consultar_atendimentos_iris"),
        run: async () => consultarAtendimentosIris(context),
      },
      {
        definition: requireDefinition("consultar_hermes"),
        run: async () => consultarHermes(context),
      },
      {
        definition: requireDefinition("consultar_saude_sistema"),
        run: async () => consultarSaudeSistema(),
      },
    );
  }

  return tools;
}

async function consultarAtendimentosIris(
  context: CacaToolContext,
): Promise<string> {
  const resumo = await loadIrisAtendimentosResumo(context.client);

  if (!resumo) {
    return "Não consegui consultar os atendimentos da Iris agora.";
  }

  if (resumo.abertosTotal === 0) {
    return "Iris: nenhum atendimento aberto no momento. Fila zerada.";
  }

  const linhas = [
    `Atendimentos da Iris (agora): ${resumo.abertosTotal} abertos — ${resumo.aguardandoOperador} aguardando a nossa resposta, ${resumo.aguardandoCliente} aguardando o cliente.`,
    `Por fila: ${resumo.porFila.map((f) => `${f.fila} (${f.abertos})`).join(", ")}`,
    `Por colaborador: ${resumo.porColaborador.map((c) => `${c.colaborador} (${c.abertos})`).join(", ")}`,
  ];

  if (resumo.esperandoMais.length > 0) {
    linhas.push("Esperando a nossa resposta há mais tempo:");
    for (const espera of resumo.esperandoMais) {
      linhas.push(
        `- ${espera.fila} · ${espera.assunto} · ${espera.minutosEspera} min (operador: ${espera.operador})`,
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

  const items = (await loadInstallments(context.c2xClientId)).filter(
    (item) => item.status === "Vencida" || item.status === "A vencer",
  );

  if (!items.length) {
    return "Não há parcelas vencidas ou a vencer registradas para este cliente.";
  }

  const linhas = items.slice(0, 10).map((item) => {
    const link = hasBoletoLink(item) ? "link disponível" : "sem link disponível";

    return `- Parcela ${readString(item.number) || "?"} (${describeInstallment(item)}) | ${link}`;
  });

  return [
    "PARCELAS ELEGÍVEIS (informe ao cliente; o link só sai com gerar_link_boleto):",
    ...linhas,
  ].join("\n");
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

function describeInstallment(item: CacaInstallment): string {
  const record = item as Record<string, unknown>;
  const numero = readString(record.number);
  const referencia = readString(record.reference);
  const valor = readString(record.value);
  const vencimento = readString(record.dueDate);
  const partes = [
    numero ? `parcela ${numero}` : null,
    referencia || null,
    vencimento ? `vence/venceu ${vencimento}` : null,
    valor ? valor : null,
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
