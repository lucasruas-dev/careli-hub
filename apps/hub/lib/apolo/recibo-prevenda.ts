// Fecha o ciclo da pré-venda: PIX confirmado -> RECIBO pro cliente nos dois canais.
//
// O caminho é o MESMO da cobrança: quem paga é identificado pelo `externalReference` da cobrança
// (que é o id da ficha) e os contatos saem de `apolo_contacts`. Antes o recibo ia buscar telefone e
// e-mail no cadastro do Asaas — que nasce só com nome e CPF — e por isso nunca saía.
//
// NUNCA lança: um canal que falha não pode derrubar a resposta do webhook (senão o Asaas entra em
// reentrega). Cada canal devolve o próprio status e fica registrado em `apolo_disparos`.
// Ver [[project_asaas_prevenda]].

import type { SupabaseClient } from "@supabase/supabase-js";

import { montarEmailRecibo } from "@/lib/apolo/emails-prevenda";
import { lerCadDaEsteira } from "@/lib/apolo/esteira-cad";
import { contatosDaFicha, registrarDisparoPrevenda } from "@/lib/apolo/prevenda-fluxo";
import { remetentePrevenda } from "@/lib/apolo/cobranca-prevenda";
import { isGmailConfigured, sendGmailMessage } from "@/lib/iris/gmail";
import {
  getMetaWhatsAppOutboundConfig,
  sendMetaWhatsAppTemplateMessage,
} from "@/lib/iris/meta-whatsapp";

// Número 4143 (Iris/atendimento) e o template do recibo — os mesmos da bancada. Se trocar o nome
// do template aqui, troque também em bancada/route.ts (é o mesmo texto aprovado na Meta).
const PHONE_4143 = "1167201739813897";
const TPL_RECIBO_NOME = "cad_pix_recibo_v2";

function moedaBR(n: number): string {
  const [inteiro = "0", decimal = "00"] = n.toFixed(2).split(".");
  return `${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${decimal}`;
}

// A CAD que gerou este recibo. Preferência: a que carrega o `pagamento_ref` do pagamento; senão,
// a mais recente. Nunca lança — o recibo não pode derrubar a resposta do webhook.
async function lerCadDoRecibo(
  client: SupabaseClient,
  entityId: string,
  paymentId: null | string | undefined,
): Promise<null | { empreendimento: string | null }> {
  if (paymentId) {
    const { data } = await client
      .from("apolo_esteira")
      .select("empreendimento")
      .eq("entity_id", entityId)
      .eq("pagamento_ref", paymentId)
      .limit(1)
      .maybeSingle<{ empreendimento: string | null }>();
    if (data) return data;
  }
  return await lerCadDaEsteira<{ empreendimento: string | null }>(
    client,
    entityId,
    "empreendimento",
  );
}

function normalizarTelefone(valor?: string | null): string | null {
  const digitos = (valor ?? "").replace(/\D/g, "");
  if (digitos.length < 10) return null;
  return digitos.startsWith("55") ? digitos : `55${digitos}`;
}

export type ResultadoRecibo = {
  cliente: string | null;
  email: string;
  whatsapp: string;
};

export async function dispararReciboPrevenda(input: {
  client: SupabaseClient;
  entityId: string;
  // Cobrança paga. É a âncora exata da CAD (o `pagamento_ref` foi gravado nela na emissão) —
  // sem ela, o recibo cai na CAD mais recente da pessoa.
  paymentId?: string | null;
  valor: number | null;
}): Promise<ResultadoRecibo> {
  const { client, entityId } = input;
  const resultado: ResultadoRecibo = {
    cliente: null,
    email: "não enviado",
    whatsapp: "não enviado",
  };

  // 1) Quem é (nome oficial) e de qual empreendimento — tudo da ficha.
  const { data: entidade } = await client
    .from("apolo_entities")
    .select("display_name, legal_name")
    .eq("id", entityId)
    .maybeSingle<{ display_name: string | null; legal_name: string | null }>();

  // De qual CAD é o recibo. O webhook do Asaas sabe o `paymentId`, que é a âncora exata — quando
  // ele vier, a CAD é a que carrega esse `pagamento_ref`; senão, a mais recente. Sem isto o
  // recibo podia sair com o nome do empreendimento errado.
  const esteira = await lerCadDoRecibo(client, entityId, input.paymentId);

  const nome = (entidade?.legal_name || entidade?.display_name || "").trim() || "Cliente";
  const empreendimento = esteira?.empreendimento?.trim() || "seu empreendimento";
  const valorFmt = moedaBR(input.valor && input.valor > 0 ? input.valor : 1000);
  resultado.cliente = nome;

  // 2) Contatos: a MESMA fonte que a cobrança usou.
  const contatos = await contatosDaFicha(client, entityId);

  // 3) WhatsApp.
  const telefone = normalizarTelefone(contatos.telefone);
  let waMessageId: string | null = null;
  if (!telefone) {
    // Sem telefone a pessoa NÃO recebe: é falha, e precisa ficar registrada como tal.
    resultado.whatsapp = "erro: sem telefone na ficha";
  } else {
    try {
      const r = await sendMetaWhatsAppTemplateMessage({
        bodyParameters: [nome, valorFmt, empreendimento],
        config: { ...getMetaWhatsAppOutboundConfig(), phoneNumberId: PHONE_4143 },
        language: "pt_BR",
        name: TPL_RECIBO_NOME,
        to: telefone,
      });
      waMessageId = r.messageId;
      resultado.whatsapp = `enviado (${r.messageId ?? "sem id"})`;
    } catch (e) {
      resultado.whatsapp = `erro: ${(e as Error).message}`;
    }
  }
  // Registra SEMPRE — inclusive quando não havia para onde enviar.
  await registrarDisparoPrevenda(client, {
    canal: "whatsapp",
    destinatario: telefone,
    entityId,
    erro: resultado.whatsapp.startsWith("erro") ? resultado.whatsapp : null,
    template: TPL_RECIBO_NOME,
    tipo: "prevenda_recibo",
    waMessageId,
  });

  // 4) E-mail.
  const email = contatos.email;
  if (!email) {
    resultado.email = "erro: sem e-mail na ficha";
    await registrarDisparoPrevenda(client, {
      canal: "email",
      destinatario: null,
      entityId,
      erro: resultado.email,
      template: "email_prevenda_recibo",
      tipo: "prevenda_recibo",
    });
  } else if (!isGmailConfigured()) {
    resultado.email = "erro: Gmail não configurado";
  } else {
    const montado = montarEmailRecibo({ empreendimento, nome, valor: valorFmt });
    const base = {
      bodyHtml: montado.bodyHtml,
      bodyText: montado.bodyText,
      subjectLine: montado.subjectLine,
      to: email,
    };
    const remetente = remetentePrevenda(empreendimento);
    try {
      await sendGmailMessage({ ...base, from: remetente });
      resultado.email = `enviado (de ${remetente})`;
    } catch (e) {
      const msg = (e as Error).message;
      // Remetente não liberado na conta: reenvia pela caixa padrão em vez de perder o recibo.
      if (/from|sender|address|alias|not allow|permission/i.test(msg)) {
        try {
          await sendGmailMessage(base);
          resultado.email = "enviado pela caixa padrão";
        } catch (e2) {
          resultado.email = `erro: ${(e2 as Error).message}`;
        }
      } else {
        resultado.email = `erro: ${msg}`;
      }
    }
    await registrarDisparoPrevenda(client, {
      canal: "email",
      destinatario: email,
      entityId,
      erro: resultado.email.startsWith("erro") ? resultado.email : null,
      template: "email_prevenda_recibo",
      tipo: "prevenda_recibo",
    });
  }

  return resultado;
}
