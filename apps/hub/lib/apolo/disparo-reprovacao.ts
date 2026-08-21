// ⚠️ DESCONTINUADO EM 21/08/2026 — NÃO TEM MAIS CHAMADOR. Substituído por `esteira-avisos.ts`.
//
// Regra do Lucas: *"reforço que os disparos têm que ser feitos pelo número do relacionamento"*.
// Este arquivo manda pela META (4143) com template, e os dois caminhos que o usavam migraram:
// o automático (`serasa/consultar`) e o reenvio manual (`serasa/reenviar-reprovacao`).
//
// Dois motivos além da regra do número:
//   • o ramo do CORRETOR aqui era estruturalmente morto — lia `apolo_relationships.metadata.phone`
//     do vínculo do CLIENTE, campo vazio em 718 de 718 CADs, e por isso `apolo_disparos` tinha
//     2.249 linhas com ZERO do tipo `corretor`, falhando em silêncio como "pulado";
//   • template da Meta exige janela de 24h e aprovação, que corretor e coordenador não sustentam.
//
// Mantido no repositório de propósito: é a referência de como o anexo da CAD era montado e de
// como a devolutiva de entrega da Meta (`wa_message_id`) casa com o webhook. Apagar antes de a
// substituição rodar em produção por algumas semanas seria perder o caminho de volta.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// DISPARO da reprovação de crédito: avisa o COORDENADOR do empreendimento (sempre) e o CORRETOR
// (só quando tem telefone cadastrado), com a CAD do cliente anexa, pela Iris (WhatsApp, número
// 4143). Reusado pelos DOIS caminhos: automático (ao reprovar no /serasa/consultar) e manual (os
// botões de reenvio, só admin, na etapa de crédito).
//
// Regras do Lucas (21/jul):
//  - Coordenador SEMPRE (telefone vem do C2X, manager_id do empreendimento).
//  - Corretor SÓ SE tiver telefone cadastrado no Apolo (os importados do Asana têm só nome/e-mail;
//    o telefone é cadastrado à mão por empreendimento). Sem telefone: corretor é pulado.
//  - TUDO registrado no histórico da ficha (apolo_audit_events), com quem, quando e o status.
//  - A devolutiva de entrega (enviado/entregue/lido) chega depois pelo webhook da Meta, que o
//    meta-inbound-processor já casa por wa_message_id.

import { loadApoloEnterpriseCadastro, loadApoloEnterprises } from "@/lib/apolo/empreendimentos";
import { montarCadDeEntidade } from "@/lib/apolo/cad-de-entidade";
import { lerCadDaEsteira } from "@/lib/apolo/esteira-cad";
import { createApoloAdminClient } from "@/lib/apolo/server";
import {
  MetaWhatsAppSendError,
  getMetaWhatsAppOutboundConfig,
  sendMetaWhatsAppTemplateMessage,
} from "@/lib/iris/meta-whatsapp";
import { montarCadPdf } from "@/modules/apolo/blocks/cadastro/cad-pdf";
import { APOLO_DOCS_BUCKET } from "@/lib/apolo/documentos";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

// Número 4143 (Careli / Atendimento) — o mesmo dos templates aprovados.
const PHONE_NUMBER_ID_4143 = "1167201739813897";
const TEMPLATE_COORDENADOR = "reprovacao_de_credito";
const TEMPLATE_CORRETOR = "reprovacao_de_credito_corretor";
const SIGNED_URL_TTL = 60 * 60; // 1h: folga pra Meta baixar o PDF no disparo.

export type EnvioReprovacao = {
  destinatario: string | null;
  error?: string;
  messageId?: string | null;
  ok: boolean;
  // Pulado quando o destinatário não tem telefone (ex.: corretor sem número cadastrado).
  pulado?: boolean;
  telefone?: string | null;
};

export type ResultadoDisparo = {
  coordenador: EnvioReprovacao;
  corretor: EnvioReprovacao;
};

// E.164 sem "+": só dígitos, com DDI 55. "31983013616" -> "5531983013616".
function normalizarTelefoneBr(value: string | null | undefined): string | null {
  const d = String(value ?? "").replace(/\D/g, "");
  if (d.length < 10) return null;
  if (d.startsWith("55") && d.length >= 12) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

function normalizarNome(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

// Resolve o CODE do empreendimento do cliente (ex.: "VLO") a partir da esteira: usa enterprise_id
// (id do C2X) quando existe, senão mapeia o nome ("Vale do Ouro") pelo catálogo do C2X.
async function resolverCodeEmpreendimento(
  esteira: { empreendimento: string | null; enterprise_id: string | null } | null,
): Promise<string | null> {
  const c2x = await loadApoloEnterprises();
  if (!c2x.ok) return null;

  const idAlvo = (esteira?.enterprise_id ?? "").trim();
  const nomeAlvo = esteira?.empreendimento ? normalizarNome(esteira.empreendimento) : "";

  for (const row of c2x.data.rows) {
    const candidatos = row.stages.length ? row.stages : [row];
    const match = candidatos.find(
      (c) =>
        (idAlvo && String(c.id) === idAlvo) ||
        (nomeAlvo && normalizarNome(c.name) === nomeAlvo),
    );
    if (match) return match.code;
  }
  return null;
}

type RegistroEnvio = {
  ator: string | null;
  destinatario: string | null;
  entityId: string;
  erro?: string | null;
  origem: "automatico" | "reenvio";
  telefone: string | null;
  template: string;
  tipo: "coordenador" | "corretor";
  waMessageId?: string | null;
};

// Registra o envio nos DOIS lugares, best-effort (falha aqui não derruba o disparo):
//  - apolo_disparos: o estado MUTÁVEL da entrega (o webhook da Meta atualiza por wa_message_id).
//  - apolo_audit_events: o histórico "humano" append-only da ficha (o mesmo que o board/[id] lê).
async function registrarEnvio(client: AdminClient, r: RegistroEnvio): Promise<void> {
  const ator = r.ator && /^[0-9a-f-]{36}$/i.test(r.ator) ? r.ator : null;
  const ok = !r.erro;

  // Best-effort: o registro nunca pode derrubar o disparo (a mensagem já saiu). Um ambiente sem a
  // tabela ainda, ou uma falha de auditoria, não invalida o envio.
  try {
    await client.from("apolo_disparos").insert({
      actor_user_id: ator,
      destinatario: r.destinatario,
      entity_id: r.entityId,
      erro: r.erro ?? null,
      origem: r.origem,
      status: ok ? "enviado" : "falhou",
      telefone: r.telefone,
      template: r.template,
      tipo: r.tipo,
      wa_message_id: r.waMessageId ?? null,
    });
  } catch {
    /* segue */
  }

  try {
    await client.from("apolo_audit_events").insert({
      action: `credito_reprovado_${r.tipo}`,
      actor_user_id: ator,
      entity_id: r.entityId,
      field_name: "credito_reprovado",
      metadata: {
        destinatario: r.destinatario,
        erro: r.erro ?? null,
        messageId: r.waMessageId ?? null,
        origem: r.origem,
        telefone: r.telefone,
      },
      status: "mapped",
    });
  } catch {
    /* segue */
  }
}

// Sobe a CAD no bucket privado e devolve a signed URL (a Meta baixa o PDF por ela no disparo).
async function subirCadAssinada(
  client: AdminClient,
  entityId: string,
  bytes: Uint8Array,
): Promise<string | null> {
  const bucket = process.env.APOLO_DOCS_BUCKET ?? APOLO_DOCS_BUCKET;
  const path = `disparo-reprovacao/${entityId}.pdf`;
  const up = await client.storage.from(bucket).upload(path, bytes, {
    contentType: "application/pdf",
    upsert: true,
  });
  if (up.error) return null;
  const signed = await client.storage.from(bucket).createSignedUrl(path, SIGNED_URL_TTL);
  return signed.data?.signedUrl ?? null;
}

// Dispara a reprovação. `apenas` limita a quem enviar (útil nos botões de reenvio individual).
export async function dispararReprovacao(input: {
  adminClient: AdminClient;
  apenas?: "coordenador" | "corretor";
  atorUserId?: string | null;
  // De qual CAD é a reprovação. Sem ele, a CAD mais recente: o coordenador avisado é o do
  // empreendimento dessa CAD, e mandar o aviso para o coordenador do loteamento errado é o tipo
  // de erro que só aparece quando alguém reclama.
  enterpriseId?: null | number | string;
  entityId: string;
}): Promise<ResultadoDisparo> {
  const { adminClient, entityId } = input;
  const ator = input.atorUserId ?? null;
  // Botão do admin traz atorUserId; o gatilho automático não. É o que separa "reenvio" de "automatico".
  const origem: "automatico" | "reenvio" = input.atorUserId ? "reenvio" : "automatico";

  const puladoCoordenador: EnvioReprovacao = { destinatario: null, ok: false, pulado: true };
  const puladoCorretor: EnvioReprovacao = { destinatario: null, ok: false, pulado: true };
  const resultado: ResultadoDisparo = { coordenador: puladoCoordenador, corretor: puladoCorretor };

  // 1) Cliente + vínculos (nome, imobiliária, corretor, empreendimento).
  const { data: entity } = await adminClient
    .from("apolo_entities")
    .select("display_name, legal_name")
    .eq("id", entityId)
    .maybeSingle<{ display_name: string; legal_name: string | null }>();
  const esteira = await lerCadDaEsteira<{
    corretor: string | null;
    empreendimento: string | null;
    enterprise_id: string | null;
    imobiliaria: string | null;
  }>(adminClient, entityId, "imobiliaria, corretor, empreendimento, enterprise_id", {
    enterpriseId: input.enterpriseId,
  });

  const cliente = (entity?.legal_name || entity?.display_name || "").trim() || "Cliente";
  const imobiliaria = (esteira?.imobiliaria ?? "").trim() || "—";
  const corretorNome = (esteira?.corretor ?? "").trim() || "—";

  const config = { ...getMetaWhatsAppOutboundConfig(), phoneNumberId: PHONE_NUMBER_ID_4143 };

  // 2) CAD real (mesma do modelo aprovado) + signed URL para o anexo.
  let signedUrl: string | null = null;
  try {
    const cad = await montarCadDeEntidade(adminClient, entityId, {
      enterpriseId: esteira?.enterprise_id ?? input.enterpriseId,
    });
    if (cad) {
      const bytes = await montarCadPdf(cad);
      signedUrl = await subirCadAssinada(adminClient, entityId, bytes);
    }
  } catch {
    signedUrl = null;
  }

  const anexo = signedUrl
    ? { fileName: `CAD-${cliente}.pdf`, link: signedUrl, type: "document" as const }
    : null;

  // 3) Coordenador do empreendimento (manager_id do C2X) — SEMPRE tenta.
  if (input.apenas !== "corretor") {
    const temEmpreendimento = Boolean(
      (esteira?.empreendimento ?? "").trim() || (esteira?.enterprise_id ?? "").trim(),
    );
    const code = await resolverCodeEmpreendimento(esteira ?? null);
    const cadastro = code ? await loadApoloEnterpriseCadastro([code]) : null;
    const coordenador = cadastro?.ok
      ? cadastro.cadastros[0]?.players.find((p) => p.relation === "coordenador_vendas")
      : undefined;
    const telCoord = normalizarTelefoneBr(coordenador?.phone);

    if (!telCoord) {
      // O coordenador DEVE sempre ser avisado — não avisar é uma FALHA, não um "pulo". Registra
      // pra aparecer no histórico. A mensagem é HONESTA sobre o que faltou: a causa mais comum não
      // é o telefone, é a FICHA SEM EMPREENDIMENTO (aí nem dá pra achar o coordenador). Culpar o
      // telefone nesse caso mandava o operador cadastrar telefone quando o buraco era outro.
      const msg = !temEmpreendimento
        ? "Ficha sem empreendimento — não dá para identificar o coordenador."
        : !code
          ? "Empreendimento da ficha não foi encontrado no C2X."
          : !coordenador
            ? "Empreendimento sem coordenador de vendas cadastrado no C2X."
            : "Coordenador do empreendimento sem telefone no C2X.";
      resultado.coordenador = {
        destinatario: coordenador?.name ?? null,
        error: msg,
        ok: false,
      };
      await registrarEnvio(adminClient, {
        ator,
        destinatario: coordenador?.name ?? null,
        entityId,
        erro: msg,
        origem,
        telefone: null,
        template: TEMPLATE_COORDENADOR,
        tipo: "coordenador",
      });
    } else {
      try {
        const r = await sendMetaWhatsAppTemplateMessage({
          bodyParameters: [cliente, imobiliaria, corretorNome],
          config,
          headerMedia: anexo,
          language: "pt_BR",
          name: TEMPLATE_COORDENADOR,
          to: telCoord,
        });
        resultado.coordenador = {
          destinatario: coordenador?.name ?? null,
          messageId: r.messageId,
          ok: true,
          telefone: telCoord,
        };
        await registrarEnvio(adminClient, {
          ator,
          destinatario: coordenador?.name ?? null,
          entityId,
          origem,
          telefone: telCoord,
          template: TEMPLATE_COORDENADOR,
          tipo: "coordenador",
          waMessageId: r.messageId,
        });
      } catch (e) {
        const msg = e instanceof MetaWhatsAppSendError ? e.message : (e as Error).message;
        resultado.coordenador = {
          destinatario: coordenador?.name ?? null,
          error: msg,
          ok: false,
          telefone: telCoord,
        };
        await registrarEnvio(adminClient, {
          ator,
          destinatario: coordenador?.name ?? null,
          entityId,
          erro: msg,
          origem,
          telefone: telCoord,
          template: TEMPLATE_COORDENADOR,
          tipo: "coordenador",
        });
      }
    }
  }

  // 4) Corretor — SÓ quando tem telefone cadastrado. Hoje os importados não têm; a busca fica
  // pronta pra quando o telefone for cadastrado à mão (relationship de corretor com metadata.phone).
  if (input.apenas !== "coordenador") {
    const { data: relCorretor } = await adminClient
      .from("apolo_relationships")
      .select("label, metadata")
      .eq("entity_id", entityId)
      .ilike("relationship_type", "%corretor%")
      .limit(1)
      .maybeSingle<{ label: string | null; metadata: Record<string, unknown> | null }>();
    const telCorretor = normalizarTelefoneBr(
      (relCorretor?.metadata?.phone as string | undefined) ??
        (relCorretor?.metadata?.telefone as string | undefined),
    );

    if (!telCorretor) {
      resultado.corretor = { destinatario: corretorNome, ok: false, pulado: true };
    } else {
      try {
        const r = await sendMetaWhatsAppTemplateMessage({
          bodyParameters: [cliente],
          config,
          headerMedia: anexo,
          language: "pt_BR",
          name: TEMPLATE_CORRETOR,
          to: telCorretor,
        });
        resultado.corretor = {
          destinatario: corretorNome,
          messageId: r.messageId,
          ok: true,
          telefone: telCorretor,
        };
        await registrarEnvio(adminClient, {
          ator,
          destinatario: corretorNome,
          entityId,
          origem,
          telefone: telCorretor,
          template: TEMPLATE_CORRETOR,
          tipo: "corretor",
          waMessageId: r.messageId,
        });
      } catch (e) {
        const msg = e instanceof MetaWhatsAppSendError ? e.message : (e as Error).message;
        resultado.corretor = {
          destinatario: corretorNome,
          error: msg,
          ok: false,
          telefone: telCorretor,
        };
        await registrarEnvio(adminClient, {
          ator,
          destinatario: corretorNome,
          entityId,
          erro: msg,
          origem,
          telefone: telCorretor,
          template: TEMPLATE_CORRETOR,
          tipo: "corretor",
        });
      }
    }
  }

  return resultado;
}
