import type { SupabaseClient } from "@supabase/supabase-js";

import type { ClaudeAgentTool } from "@/lib/ai/claude-agent";
import { prepareBoletoResendAction } from "@/lib/guardian/asaas";
import { loadHadesAttendanceClient } from "@/lib/guardian/attendance";
import { lookupApoloByDocument } from "@/lib/iris/caca-agent";

import { appendClientNote } from "./client-memory";
import { CACA_TOOL_DEFINITIONS } from "./tools";

// Estado mutável do turno: as ferramentas leem e escrevem aqui. Depois do loop, o caller lê
// `handoff` (pra executar a transferência de verdade) e `identityVerified`/`c2xClientId`
// (pra persistir no metadata do ticket entre turnos).
export type CacaToolContext = {
  c2xClientId: string | null;
  client: SupabaseClient;
  contactId: string | null;
  customerName: string | null;
  handoff: { reason: string | null; requested: boolean };
  identityVerified: boolean;
  validationSource: "cpf" | "phone" | null;
};

const DEFINITION_BY_NAME = new Map(
  CACA_TOOL_DEFINITIONS.map((definition) => [definition.name, definition]),
);

export function buildCacaTools(context: CacaToolContext): ClaudeAgentTool[] {
  return [
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
      definition: requireDefinition("anotar_sobre_cliente"),
      run: async (input) => anotarSobreCliente(context, input),
    },
    {
      definition: requireDefinition("transferir_para_humano"),
      run: async (input) => transferirParaHumano(context, input),
    },
  ];
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

  if (!match.hasBuyerProfile || !match.hasUnitPortfolio) {
    return "Cadastro localizado, mas não consta como comprador com unidade ativa. Transfira para um atendente validar o contrato antes de enviar boleto.";
  }

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

  return `Identidade confirmada (${match.displayName}). Agora você pode consultar o financeiro e enviar boleto deste cliente.`;
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
  // ATENÇÃO: ordenar pelo campo ISO `dueDateInput` (AAAA-MM-DD), NUNCA por `dueDate`
  // (formato BR DD/MM/AAAA). O localeCompare em DD/MM/AAAA ordena por dia→mês→ano,
  // então "20/01/2027" vinha ANTES de "20/07/2026" e a Cacá apontava a parcela
  // errada como próxima (bug 30/jun). O ISO ordena cronologicamente como texto.
  const proxima = [...aVencer].sort((first, second) =>
    String(first.dueDateInput ?? first.dueDate ?? "").localeCompare(
      String(second.dueDateInput ?? second.dueDate ?? ""),
    ),
  )[0];

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

  return "Transferência registrada. Avise o cliente, em uma frase, que você está encaminhando para o nosso time e que em instantes alguém responde.";
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
