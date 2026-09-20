import type { SupabaseClient } from "@supabase/supabase-js";

import { type EnvelopeDaProposta, seguraOEnvio } from "@/lib/assinatura/envio-db";
import { rotuloDoEstado } from "@/lib/assinatura/traduzir";
import type { EstadoDaAssinatura } from "@/lib/assinatura/tipos";

// OS ENVELOPES DE UM ACORDO, LIDOS DO PANTEON — a consulta, sozinha, sem o motor do envio.
//
// ⚠️ ELE NASCEU SEPARADO DE `envio-db.ts` POR CAUSA DO PESO. `envio-db.ts` puxa a montagem do PDF
// (`pdf-lib`) e a leitura do C2X (`mysql2`) pela cadeia de `termo-em-pdf.ts`; quem só precisa
// perguntar "este acordo tem envelope vivo?" não pode arrastar os dois. Quem pergunta isso hoje é a
// EXCLUSÃO do acordo (`app/api/guardian/compromissos/[id]/route.ts`), que não manda nada para a
// Clicksign e não desenha papel nenhum.
//
// ⚠️ E A CONSULTA CONTINUA SENDO UMA SÓ. Duas leituras da mesma pergunta divergiriam no primeiro
// filtro que alguém acrescentasse de um lado, e a que ficasse frouxa é a que deixa passar o segundo
// envelope.

/** A migration que traz `temis_envelopes.compromisso_id`. A frase da recusa cita este número. */
export const MIGRATION_DO_ELO_DO_ACORDO = "0179";

export const SEM_A_COLUNA =
  `O envio do termo para assinatura ainda não está disponível: a migration ${MIGRATION_DO_ELO_DO_ACORDO} ` +
  "(temis_envelopes.compromisso_id) não foi aplicada, e sem ela o Panteon não tem como ligar o envelope a este acordo. " +
  "Nada foi mandado para a Clicksign.";

/**
 * Este erro é "a coluna `compromisso_id` ainda não existe"?
 *
 * ⚠️ SÃO DOIS CÓDIGOS, E NÃO UM. O Postgres devolve `42703` ("column ... does not exist") quando a
 * coluna entra num `select` ou num `where`; o PostgREST devolve `PGRST204` ("Could not find the
 * 'compromisso_id' column ... in the schema cache") quando ela entra num `insert`. Reconhecer só um
 * deixaria metade dos caminhos caindo como erro genérico — é a mesma dupla que o resto da casa trata
 * (ver `lib/hercules/cadastro.ts` e a memória curta da 0170).
 *
 * ⚠️ E O NOME DA COLUNA ENTRA NA CONTA. Sem ele, qualquer 42703 de qualquer coluna viraria "falta a
 * migration 0179", e alguém iria aplicar a migration certa para o defeito errado.
 */
export function faltaAColunaDoAcordo(
  erro: null | { code?: string; message?: string },
): boolean {
  const texto = `${erro?.code ?? ""} ${erro?.message ?? ""}`;
  if (!/compromisso_id/i.test(texto)) return false;
  return /42703|PGRST204|does not exist|schema cache/i.test(texto);
}

export const COLUNAS_DO_ENVELOPE =
  "id, provedor, envelope_id, provedor_documento_id, estado, estado_cru, falha, enviado_em, enviado_por_nome, criado_em, atualizado_em";

export type LinhaDoEnvelope = {
  atualizado_em: null | string;
  criado_em: string;
  enviado_em: null | string;
  enviado_por_nome: null | string;
  envelope_id: null | string;
  estado: null | string;
  estado_cru: null | string;
  falha: null | string;
  id: string;
  provedor: null | string;
  provedor_documento_id: null | string;
};

export type LeituraDosEnvelopes =
  | { linhas: LinhaDoEnvelope[]; ok: true }
  /** `semColuna` separa "a migration não entrou" de "o banco não respondeu". */
  | { erro: string; ok: false; semColuna: boolean };

/**
 * Os envelopes deste acordo, do mais recente para o mais antigo.
 *
 * ⚠️ MAIS RECENTE PRIMEIRO, E A LISTA INTEIRA. Um acordo pode ter mais de um envelope ao longo da
 * vida (um cancelado e um reenviado): a tela mostra o primeiro, e a guarda contra o segundo envelope
 * precisa ver todos para saber se algum ainda segura.
 */
export async function envelopesDoCompromisso(
  sb: SupabaseClient,
  compromissoId: string,
): Promise<LeituraDosEnvelopes> {
  const { data, error } = await sb
    .from("temis_envelopes")
    .select(COLUNAS_DO_ENVELOPE)
    // ⚠️ SEM FILTRO DE `provedor` NEM DE `workspace_id`, como na guarda do contrato: a pergunta é
    // "existe envelope deste acordo em algum lugar?", e um filtro a mais só teria como fazer a
    // guarda deixar passar.
    .eq("compromisso_id", compromissoId)
    .order("criado_em", { ascending: false })
    .limit(50);

  if (error) {
    if (faltaAColunaDoAcordo(error)) return { erro: SEM_A_COLUNA, ok: false, semColuna: true };
    console.error("[hades][acordo][assinatura] falha ao ler os envelopes do acordo", error);
    return {
      erro: "Não foi possível conferir se este acordo já foi para assinatura.",
      ok: false,
      semColuna: false,
    };
  }

  return { linhas: (data ?? []) as unknown as LinhaDoEnvelope[], ok: true };
}

// ── O ENVELOPE QUE IMPEDE APAGAR O ACORDO ───────────────────────────────────

/** A forma que a régua do contrato (`seguraOEnvio`) lê. É a mesma régua, sem cópia. */
function comoAReguaLe(linha: LinhaDoEnvelope): EnvelopeDaProposta {
  return {
    criado_em: linha.criado_em,
    envelope_id: linha.envelope_id,
    estado: linha.estado ?? "desconhecido",
    falha: linha.falha,
    id: linha.id,
    provedor: linha.provedor ?? "clicksign",
  };
}

function comoSeEscreveOEstado(gravado: string): string {
  const conhecidos: Record<EstadoDaAssinatura, true> = {
    aguardando: true,
    assinado: true,
    cancelado: true,
    desconhecido: true,
    expirado: true,
    parcial: true,
    rascunho: true,
    recusado: true,
  };
  return Object.prototype.hasOwnProperty.call(conhecidos, gravado)
    ? rotuloDoEstado(gravado as EstadoDaAssinatura)
    : gravado;
}

/**
 * A frase que IMPEDE apagar este acordo por causa de um termo em assinatura. `null` quando não há.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠️ A LIXEIRA DO CARD ESTÁ ACESA EM TODO ACORDO, INCLUSIVE NO QUE JÁ FOI PARA A CLICKSIGN.
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * A 0179 liga o envelope ao compromisso com `on delete set null`, e isso é o certo: o envelope
 * existe lá, pago, com gente tendo assinado do outro lado, e apagar a linha seria perder a única
 * prova que temos deste lado. Só que a ÚNICA leitura de envelope por `compromisso_id` é o card do
 * acordo: some o acordo, a linha perde a chave e fica invisível para o Panteon inteiro, enquanto o
 * termo continua vivo na Clicksign cobrando assinatura do cliente. Não é uma hipótese distante, é a
 * consequência direta de um clique que não pergunta nada.
 *
 * ⚠️ NÃO SABER É MOTIVO PARA NÃO APAGAR. Apagar é irreversível (o compromisso e as notas dele somem
 * no cascade) e pode esperar; um blip de leitura não pode virar um envelope órfão. A exceção é a
 * coluna AUSENTE: sem a 0179 nenhum envelope se liga a acordo nenhum, então não há o que órfãozar.
 *
 * ⚠️ E A SAÍDA ESTÁ NA FRASE. Cancelar o envelope é um botão do próprio card, e depois de cancelado
 * o estado libera a exclusão pela mesma régua que libera o reenvio.
 */
export async function impedimentoParaExcluirOAcordo(
  sb: SupabaseClient,
  compromissoId: string,
): Promise<null | string> {
  const envelopes = await envelopesDoCompromisso(sb, compromissoId);

  if (!envelopes.ok) {
    if (envelopes.semColuna) return null;
    return (
      "Não foi possível conferir se este acordo tem termo em assinatura, e por isso ele NÃO foi excluído. "
      + "Tente de novo em instantes."
    );
  }

  const vivo = envelopes.linhas.map(comoAReguaLe).find(seguraOEnvio);
  if (!vivo) return null;

  const onde = vivo.envelope_id
    ? `o envelope ${vivo.envelope_id}, em "${comoSeEscreveOEstado(vivo.estado)}"`
    : `um envio que começou e o Panteon não soube como terminou (registro ${vivo.id})`;

  return (
    `Este acordo tem termo em assinatura na Clicksign: ${onde}. `
    + "Apagar o acordo agora deixaria esse envelope sem dono: ele continuaria vivo lá, cobrando assinatura do cliente, e nenhuma tela do Panteon voltaria a alcançá-lo. "
    + "Cancele o envelope no card do acordo e depois exclua."
  );
}
