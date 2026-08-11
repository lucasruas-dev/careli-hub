// RASTRO do override da coordenação (PROBLEMA 3, Lucas 04/08): quem aprovou o crédito reprovado,
// quando, por quê e apontando para a evidência anexada. Chamado DEPOIS de destravar a esteira — o
// registro nunca segura a decisão que já foi tomada, por isso é best-effort e nunca lança.
//
// DOIS destinos, de propósito:
//   • `apolo_audit_events` (tabela que JÁ existe) — o registro sempre acontece, mesmo antes da
//     migration 0082 rodar. É o piso de auditoria.
//   • `apolo_credito_overrides` (migration 0082, APLICADA em produção em 05/08/2026) — o registro
//     ESTRUTURADO, que casa com a chave (entity_id, enterprise_id) da CAD.
//
// ⚠️ NÃO É MAIS SILENCIOSO. A falha de gravação continua não derrubando a decisão (a esteira já
// destravou), mas volta como resultado para quem chamou, e a rota devolve isso à tela. Um override
// sem rastro é exatamente o que a coordenação está tentando evitar ao anexar a evidência — se o
// registro não gravar, alguém precisa saber no ato, não no dia da auditoria.
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
}): Promise<{ auditoria: boolean; erro: null | string; estruturado: boolean }> {
  const actor = ehUuid(input.aprovadoPor) ? input.aprovadoPor : null;
  const falhas: string[] = [];
  let auditoria = false;
  let estruturado = false;

  // Piso de auditoria: sempre grava, tabela existente. `status='mapped'` é o único aceito pelo
  // CHECK de apolo_audit_events (0026). O metadata carrega o essencial da decisão.
  try {
    const { error } = await input.adminClient.from("apolo_audit_events").insert({
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
    if (error) falhas.push(`auditoria: ${error.message}`);
    else auditoria = true;
  } catch (erro) {
    falhas.push(`auditoria: ${(erro as Error).message}`);
  }

  // Registro estruturado, na tabela da 0082.
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
    if (error) falhas.push(`registro: ${error.message}`);
    else estruturado = true;
  } catch (erro) {
    falhas.push(`registro: ${(erro as Error).message}`);
  }

  if (falhas.length) console.warn("[apolo][credito-override]", falhas.join(" · "));

  return { auditoria, erro: falhas.length ? falhas.join(" · ") : null, estruturado };
}
