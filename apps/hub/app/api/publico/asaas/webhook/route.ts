import { NextResponse } from "next/server";

import { avisarImobPixPago, statusEnvioAoCliente } from "@/lib/apolo/disparo-imobiliaria";
import { aoConfirmarPagamentoPrevenda } from "@/lib/apolo/prevenda-fluxo";
import { dispararReciboPrevenda } from "@/lib/apolo/recibo-prevenda";
import { createApoloAdminClient } from "@/lib/apolo/server";

// Webhook do Asaas (pré-venda / bancada). O Asaas faz POST a cada mudança de status da cobrança.
// Aqui REGISTRAMOS tudo em apolo_asaas_eventos, com um carimbo NOSSO (recebido_em) — o desempate da
// ordem da fila, já que o paymentDate do Asaas vem sem hora.
//
// SEGURANÇA: o Asaas envia um token fixo no header `asaas-access-token` (o que você define ao criar
// o webhook). Se ASAAS_WEBHOOK_TOKEN estiver configurado, exigimos que bata (rejeita falso). Sem a
// env (modo DESCOBERTA da bancada), aceitamos e guardamos os headers crus pra ver como o Asaas
// autentica — mas o evento fica marcado como não verificado.
//
// Público por desenho (é máquina-a-máquina, sem sessão) — precisa do prefixo em proxy.ts.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Folga pro disparo do recibo (consulta o cliente no Asaas + WhatsApp + e-mail).
export const maxDuration = 30;

function comoRegistro(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export async function POST(request: Request) {
  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ ok: false }, { status: 503 });

  const headers = Object.fromEntries(request.headers.entries());
  const payload = comoRegistro(await request.json().catch(() => ({})));
  const pagamento = comoRegistro(payload.payment);

  // Verificação do token (quando configurado). Nunca derruba o registro — só marca.
  const esperado = process.env.ASAAS_WEBHOOK_TOKEN?.trim();
  const recebido = (headers["asaas-access-token"] ?? "").trim();
  const verificado = esperado ? recebido === esperado : null;

  // Não guardar o próprio token nos headers registrados.
  const headersLimpos = { ...headers };
  delete headersLimpos["asaas-access-token"];

  // PIX confirmado? (o Asaas usa RECEIVED pra dinheiro em conta e CONFIRMED pra confirmação)
  const pagamentoConfirmado =
    payload.event === "PAYMENT_RECEIVED" || payload.event === "PAYMENT_CONFIRMED";

  // Reentrega: o Asaas reenvia o mesmo evento quando não recebe 200. Só mandamos o recibo se este
  // for o PRIMEIRO evento de confirmação deste pagamento — checado ANTES do insert de agora.
  let jaConfirmadoAntes = false;
  if (pagamentoConfirmado && typeof pagamento.id === "string") {
    const { data: anteriores } = await client
      .from("apolo_asaas_eventos")
      .select("id")
      .eq("asaas_payment_id", pagamento.id)
      .in("evento", ["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"])
      .limit(1);
    jaConfirmadoAntes = (anteriores?.length ?? 0) > 0;
  }

  await client.from("apolo_asaas_eventos").insert({
    asaas_customer_id: pagamento.customer ?? null,
    asaas_payment_id: pagamento.id ?? null,
    billing_type: pagamento.billingType ?? null,
    date_created_raiz: payload.dateCreated ?? null,
    evento: payload.event ?? null,
    external_reference: pagamento.externalReference ?? null,
    headers: { ...headersLimpos, _verificado: verificado },
    payload,
    payment_date: pagamento.paymentDate ?? pagamento.confirmedDate ?? pagamento.clientPaymentDate ?? null,
    status: pagamento.status ?? null,
    value: typeof pagamento.value === "number" ? pagamento.value : null,
  });

  // Se o token está configurado e não bateu, respondemos 401 (o Asaas reentrega; e não
  // processamos como legítimo). Em modo descoberta (sem env), 200 pra não acumular retry.
  if (esperado && !verificado) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // Fecha o ciclo: PIX confirmado -> recibo pro cliente, UMA vez só. O disparo nunca lança, então
  // a resposta ao Asaas continua 200 mesmo se um dos canais falhar.
  if (pagamentoConfirmado && !jaConfirmadoAntes) {
    // O `externalReference` da cobrança É o id da ficha (gravado na emissão do PIX): o pagamento se
    // identifica sozinho, sem precisar perguntar o CPF ao Asaas.
    const ref =
      typeof pagamento.externalReference === "string" ? pagamento.externalReference.trim() : "";
    const entityId = /^[0-9a-f-]{36}$/i.test(ref) ? ref : null;

    if (!entityId) {
      // Cobrança antiga (criada antes de gravarmos a ficha na referência). Fica registrada, mas
      // não há a quem mandar o recibo.
      return NextResponse.json({
        ok: true,
        recibo: "cobrança sem ficha no externalReference — recibo não enviado",
      });
    }

    // ⚠️ O `externalReference` é a PESSOA, e desde a 0080 ela pode ter CAD (e cobrança) em mais
    // de um empreendimento. Quem identifica a CAD sem ambiguidade é o `paymentId`: ele foi
    // gravado em `pagamento_ref` na emissão, naquela CAD. Por isso ele viaja para as duas pontas.
    const paymentId = typeof pagamento.id === "string" ? pagamento.id : null;

    const recibo = await dispararReciboPrevenda({
      client,
      entityId,
      paymentId,
      valor: typeof pagamento.value === "number" ? pagamento.value : null,
    });

    // Carimba o pagamento no Board e reordena a fila do Prometeu. A hora é a NOSSA (agora, no
    // recebimento) — o paymentDate do Asaas vem sem hora e empataria todo mundo.
    const fluxo = await aoConfirmarPagamentoPrevenda({
      client,
      entityId,
      pagoEm: new Date().toISOString(),
      paymentId,
    });

    // Avisa a IMOBILIÁRIA que o PIX foi pago, com o status do comprovante ao cliente. Best-effort.
    try {
      const agora = new Date().toISOString();
      const status = statusEnvioAoCliente(
        { erro: recibo.whatsapp.startsWith("erro") ? recibo.whatsapp : null, hora: agora, ok: recibo.whatsapp.startsWith("enviado") },
        { erro: recibo.email.startsWith("erro") ? recibo.email : null, hora: agora, ok: recibo.email.startsWith("enviado") },
      );
      await avisarImobPixPago(client, entityId, status);
    } catch {
      /* segue */
    }

    return NextResponse.json({ fluxo, ok: true, recibo });
  }

  return NextResponse.json({ ok: true });
}
