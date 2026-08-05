// RASTRO do override da coordenação (PROBLEMA 3, Lucas 04/08): quem aprovou o crédito reprovado,
// quando, por quê e apontando para a evidência anexada. Chamado DEPOIS de destravar a esteira — o
// registro nunca segura a decisão que já foi tomada, por isso é best-effort e nunca lança.
//
// DOIS destinos, de propósito:
//   • `apolo_audit_events` (tabela que JÁ existe) — o registro sempre acontece, mesmo antes da
//     migration 0082 rodar. É o piso de auditoria.
//   • `apolo_credito_overrides` (migration 0082, ainda NÃO aplicada) — o registro ESTRUTURADO, que
//     casa com a chave (entity_id, enterprise_id) da CAD. Enquanto a tabela não existe, o insert
//     falha com 42P01 e é engolido em silêncio: o piso de auditoria acima cobre o intervalo.
import type { EtapaEsteira } from "@/lib/apolo/esteira";
import type { createApoloAdminClient } from "@/lib/apolo/server";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

const ehUuid = (v: string | null): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export async function registrarOverrideCredito(input: {
  adminClient: AdminClient;
  aprovadoPor: string | null;
  aprovadoPorNome: string | null;
  destino: EtapaEsteira;
  enterpriseId: string;
  entityId: string;
  evidenciaDocId: string | null;
  motivo: string | null;
}): Promise<void> {
  const actor = ehUuid(input.aprovadoPor) ? input.aprovadoPor : null;

  // Piso de auditoria: sempre grava, tabela existente. `status='mapped'` é o único aceito pelo
  // CHECK de apolo_audit_events (0026). O metadata carrega o essencial da decisão.
  try {
    await input.adminClient.from("apolo_audit_events").insert({
      action: "credito_override_aprovado",
      actor_user_id: actor,
      entity_id: input.entityId,
      field_name: "etapa",
      metadata: {
        aprovadoPorNome: input.aprovadoPorNome,
        destino: input.destino,
        enterpriseId: input.enterpriseId,
        evidenciaDocId: input.evidenciaDocId,
        motivo: input.motivo,
        origem: "override-coordenacao",
      },
      status: "mapped",
    });
  } catch (erro) {
    console.warn("[apolo][credito-override] auditoria falhou", erro);
  }

  // Registro estruturado. Best-effort: se a 0082 ainda não rodou, `.from` de tabela inexistente
  // devolve error (não lança), e a gente só avisa no log — o piso de auditoria já cobriu.
  try {
    const { error } = await input.adminClient.from("apolo_credito_overrides").insert({
      aprovado_por: actor,
      aprovado_por_nome: input.aprovadoPorNome,
      destino: input.destino,
      enterprise_id: input.enterpriseId,
      entity_id: input.entityId,
      evidencia_doc_id: input.evidenciaDocId,
      motivo: input.motivo,
    });
    if (error && error.code !== "42P01") {
      console.warn("[apolo][credito-override] registro estruturado falhou", error.message);
    }
  } catch (erro) {
    console.warn("[apolo][credito-override] registro estruturado lançou", erro);
  }
}
