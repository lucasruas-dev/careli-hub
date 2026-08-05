import type { SupabaseClient } from "@supabase/supabase-js";

import { abrirAtendimentoDaAcao } from "@/lib/apolo/acao-atendimento";
import { renderConvitePreview } from "@/lib/apolo/acao-template";
import { APOLO_DOCS_BUCKET } from "@/lib/apolo/documentos";
import {
  MetaWhatsAppSendError,
  getMetaWhatsAppOutboundConfig,
  sendMetaWhatsAppTemplateMessage,
} from "@/lib/iris/meta-whatsapp";

// Dispara o template do CONVITE para UM alvo pelo 4143 (arte no topo + primeiro nome no corpo) e
// registra o envio na campanha. Marca o canal como 'whatsapp' — o operador cai aqui quando NÃO
// conseguiu falar por telefone. A resposta dos botões volta pela Cacá (Fase 3), casada pelo
// disparo_wa_message_id que gravamos aqui.

const PHONE_4143 = "1167201739813897";
const SIGNED_TTL_SEGUNDOS = 60 * 60; // 1h: tempo de sobra para a Meta baixar a imagem.

function primeiroNome(nome: string | null): string {
  const parte = (nome ?? "").trim().split(/\s+/)[0];
  return parte || "tudo bem";
}

// Só dígitos + prefixo 55 (a Meta espera o número internacional).
function normalizarTelefone(tel: string): string {
  const digitos = tel.replace(/\D/g, "");
  return digitos.startsWith("55") ? digitos : `55${digitos}`;
}

export async function dispararConvite(
  client: SupabaseClient,
  input: { acaoId: string; alvoId: string; por?: string | null },
): Promise<{ error?: string; ok: boolean }> {
  const { data: acao } = await client
    .from("apolo_acoes")
    .select("nome, template_meta_name, imagem_path")
    .eq("id", input.acaoId)
    .maybeSingle<{
      imagem_path: string | null;
      nome: string;
      template_meta_name: string | null;
    }>();
  if (!acao?.template_meta_name) {
    return { error: "O template do convite ainda não foi criado.", ok: false };
  }

  const { data: alvo } = await client
    .from("apolo_acao_alvos")
    .select("nome, telefone, entity_id")
    .eq("id", input.alvoId)
    .maybeSingle<{ entity_id: string | null; nome: string | null; telefone: string | null }>();
  if (!alvo?.telefone) return { error: "Cliente sem telefone na ficha.", ok: false };

  // A arte vai por uma signed URL fresca (a Meta baixa por ela no envio).
  let headerMedia: { link: string; type: "image" } | null = null;
  if (acao.imagem_path) {
    const bucket = process.env.APOLO_DOCS_BUCKET ?? APOLO_DOCS_BUCKET;
    const signed = await client.storage
      .from(bucket)
      .createSignedUrl(acao.imagem_path, SIGNED_TTL_SEGUNDOS);
    if (signed.data?.signedUrl) headerMedia = { link: signed.data.signedUrl, type: "image" };
  }

  const config = { ...getMetaWhatsAppOutboundConfig(), phoneNumberId: PHONE_4143 };
  const agora = new Date().toISOString();

  try {
    const res = await sendMetaWhatsAppTemplateMessage({
      bodyParameters: [primeiroNome(alvo.nome)],
      config,
      headerMedia,
      language: "pt_BR",
      name: acao.template_meta_name,
      to: normalizarTelefone(alvo.telefone),
    });

    await client
      .from("apolo_acao_alvos")
      .update({
        contato_canal: "whatsapp",
        contato_em: agora,
        contato_por: input.por ?? null,
        disparo_em: agora,
        disparo_status: "enviado",
        disparo_wa_message_id: res.messageId ?? null,
        updated_at: agora,
      })
      .eq("id", input.alvoId);

    // Abre o ATENDIMENTO de verdade (ticket + conversa) para este disparo — é o que faz a mensagem
    // morar na aba "Ações" do Board e abrir a conversa ao clicar. Best-effort: se falhar, o disparo
    // já saiu e está registrado no alvo; não derruba o envio.
    await abrirAtendimentoDaAcao(client, {
      acaoId: input.acaoId,
      acaoNome: acao.nome,
      alvoId: input.alvoId,
      entityId: alvo.entity_id,
      metaRaw: res.raw,
      nome: alvo.nome,
      phoneNumberId: PHONE_4143,
      previewTexto: renderConvitePreview(primeiroNome(alvo.nome)),
      telefone: alvo.telefone,
      waMessageId: res.messageId ?? null,
    });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof MetaWhatsAppSendError ? e.message : (e as Error).message;
    await client
      .from("apolo_acao_alvos")
      .update({
        contato_canal: "whatsapp",
        contato_em: agora,
        contato_por: input.por ?? null,
        disparo_em: agora,
        disparo_erro: msg,
        disparo_status: "falhou",
        updated_at: agora,
      })
      .eq("id", input.alvoId);
    return { error: msg, ok: false };
  }
}
