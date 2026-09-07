import { interpretarStatusD4Sign, type SituacaoD4Sign } from "@/lib/guardian/d4sign-consulta";

import type { EstadoDaAssinatura } from "./tipos";

// A TRADUÇÃO — onde as duas línguas viram uma só.
//
// Puro de propósito: nada aqui chama rede nem banco. É o coração da camada, e é o que precisa estar
// certo antes de qualquer chamada de API existir, porque um estado mal traduzido não dá erro — ele
// pinta a tela com a situação errada de um contrato que alguém vai assinar.

// ── D4SIGN ───────────────────────────────────────────────────────────────────
//
// O de-para do `statusId` já existe em `guardian/d4sign-consulta.ts`, medido no catálogo inteiro em
// 18/08/2026 (4 Finalizado, 6 Cancelado, 3 Aguardando Assinaturas, 2 Aguardando Signatários).
// Reusamos aquele, em vez de escrever um segundo: dois de-para do mesmo código divergem no dia em
// que a D4Sign criar um status novo, e o que diverge em silêncio é o pior tipo.
//
// ⚠️ O D4SIGN NÃO DISTINGUE "NINGUÉM ASSINOU" DE "ALGUNS ASSINARAM". Os dois são "Aguardando
// Assinaturas" (statusId 3). Por isso a tradução aceita `algumJaAssinou`: quem sabe disso é a lista
// de signatários do `/list`, não o cabeçalho do documento.
//
// ⚠️ E ELE NÃO TEM RECUSA. Nenhum statusId significa "o cliente se negou a assinar" — o estado
// `recusado` simplesmente nunca sai deste lado. Não é lacuna da tradução, é do provedor.
//
// ⚠️ NEM EXPIRAÇÃO SEPARADA: o `sign_limit_date` AUTOCANCELA, então prazo vencido chega como
// statusId 6, indistinguível de um cancelamento humano. Quem quiser saber a diferença tem de olhar
// o `whoCanceled` — e é por isso que o nosso registro guarda quem cancelou.
export function estadoDoD4Sign(
  statusId: unknown,
  { algumJaAssinou = false }: { algumJaAssinou?: boolean } = {},
): { estado: EstadoDaAssinatura; estadoCru: string } {
  const situacao: SituacaoD4Sign = interpretarStatusD4Sign(statusId);
  const cru = `d4sign:${String(statusId ?? "")}`;

  switch (situacao) {
    case "aguardando-assinaturas":
      return { estado: algumJaAssinou ? "parcial" : "aguardando", estadoCru: cru };
    case "aguardando-signatarios":
      return { estado: "aguardando", estadoCru: cru };
    case "cancelado":
      return { estado: "cancelado", estadoCru: cru };
    case "finalizado":
      return { estado: "assinado", estadoCru: cru };
    default:
      return { estado: "desconhecido", estadoCru: cru };
  }
}

// ── CLICKSIGN ────────────────────────────────────────────────────────────────
//
// O envelope tem quatro estados: `draft` → `running` → `closed` | `canceled`.
//
// ⚠️ `closed` NÃO É SINÔNIMO DE ASSINADO, e esta é a armadilha mais séria da Clicksign para nós. O
// `deadline_partial_signature_action` pode fechar o envelope no vencimento COM AS ASSINATURAS QUE
// TIVER: um contrato com o comprador assinado e a vendedora não vira `closed`, com cara de
// concluído, "pronto para download" — e sem valor nenhum. Por isso a tradução exige saber se TODOS
// assinaram; `closed` sem todos é `expirado`, não `assinado`.
//
// A defesa em profundidade é mandar `deadline_partial_signature_action: "canceled"` explícito em
// todo envelope, mas a tradução não pode depender de a configuração estar certa: um envelope criado
// antes dessa regra, ou por outra tela, chegaria aqui igual.
export function estadoDaClicksign(
  status: unknown,
  { todosAssinaram, algumJaAssinou = false }: { algumJaAssinou?: boolean; todosAssinaram?: boolean } = {},
): { estado: EstadoDaAssinatura; estadoCru: string } {
  const bruto = typeof status === "string" ? status.trim().toLowerCase() : "";
  const cru = `clicksign:${bruto || String(status ?? "")}`;

  switch (bruto) {
    case "draft":
      return { estado: "rascunho", estadoCru: cru };
    case "running":
      return { estado: algumJaAssinou ? "parcial" : "aguardando", estadoCru: cru };
    case "closed":
      // ⚠️ Sem saber se todos assinaram, NÃO afirmamos "assinado". `undefined` aqui é ignorância, e
      // dizer "desconhecido" manda alguém conferir — dizer "assinado" mandaria o contrato adiante.
      if (todosAssinaram === true) return { estado: "assinado", estadoCru: cru };
      if (todosAssinaram === false) return { estado: "expirado", estadoCru: cru };
      return { estado: "desconhecido", estadoCru: cru };
    case "canceled":
    case "cancelled":
      return { estado: "cancelado", estadoCru: cru };
    default:
      return { estado: "desconhecido", estadoCru: cru };
  }
}

// ── OS EVENTOS DO WEBHOOK DA CLICKSIGN ───────────────────────────────────────
//
// A lista tem ~30 nomes. A maioria NÃO muda o estado do documento: são falhas de autenticação
// (`facematch_refused`, `ocr_refused`…), o fluxo de "Aceite via WhatsApp", e as operações que nós
// mesmos causamos (`upload`, `add_signer`, `update_deadline`).
//
// ⚠️ SÓ ESTES MUDAM O ESTADO. Os demais são registrados e não movem o card — e essa separação é a
// diferença entre uma tela que reflete a verdade e uma que pisca a cada evento de bastidor.
//
// ⚠️ `deadline` VIRA `expirado`, NÃO `cancelado`, mesmo que a Clicksign cancele por baixo: para a
// operação, "perdemos o prazo" pede uma ação diferente de "alguém desistiu".
//
// ⚠️ E `sign` NÃO VIRA `assinado`: um `sign` é UMA pessoa. O contrato só fecha no `auto_close` /
// `close` / `document_closed`. Tratar `sign` como conclusão daria contrato por concluído no primeiro
// dos quatro compradores.
const ESTADO_POR_EVENTO: Record<string, EstadoDaAssinatura> = {
  auto_close: "assinado",
  cancel: "cancelado",
  close: "assinado",
  deadline: "expirado",
  document_closed: "assinado",
  refusal: "recusado",
  sign: "parcial",
  signature_started: "aguardando",
  upload: "rascunho",
};

/** O evento move o card? Devolve o estado novo, ou null quando é evento de bastidor. */
export function estadoDoEventoClicksign(evento: unknown): EstadoDaAssinatura | null {
  const nome = typeof evento === "string" ? evento.trim().toLowerCase() : "";
  return ESTADO_POR_EVENTO[nome] ?? null;
}

/**
 * O evento é uma FALHA DE AUTENTICAÇÃO do signatário?
 *
 * Não mexe no estado do documento, mas é a informação mais útil que o webhook traz para o
 * atendimento: é a pessoa travada na hora de assinar — a que liga reclamando que "não consegue".
 * Sem isso, o operador só descobre quando o cliente telefona.
 */
export function ehFalhaDeAutenticacao(evento: unknown): boolean {
  const nome = typeof evento === "string" ? evento.trim().toLowerCase() : "";
  return (
    nome.endsWith("_refused") &&
    nome !== "refusal" &&
    nome !== "acceptance_term_refused"
  ) || nome.startsWith("attempts_by_");
}

/** O rótulo do estado, na tela. Fonte única do texto. */
export function rotuloDoEstado(estado: EstadoDaAssinatura): string {
  const mapa: Record<EstadoDaAssinatura, string> = {
    aguardando: "Aguardando assinatura",
    assinado: "Assinado",
    cancelado: "Cancelado",
    desconhecido: "Situação desconhecida",
    expirado: "Prazo vencido",
    parcial: "Parcialmente assinado",
    rascunho: "Rascunho",
    recusado: "Recusado",
  };
  return mapa[estado];
}
