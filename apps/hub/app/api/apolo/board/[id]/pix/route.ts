import { NextResponse } from "next/server";

import { consultarCobranca, obterQrCodePix } from "@/lib/apolo/asaas-prevenda";
import { authorizeApoloRead } from "@/lib/apolo/auth";
import { lerCadDaEsteira } from "@/lib/apolo/esteira-cad";
import { createApoloAdminClient } from "@/lib/apolo/server";

// STATUS DO PIX da pré-venda de UMA ficha: gerou -> enviou -> recebeu.
//
// A tela da etapa Pré-venda mostrava só o texto da regra; quem quisesse saber se a cobrança saiu,
// pra onde foi e se o cliente pagou tinha que ir no Asaas ou no banco. Aqui juntamos as três
// fontes: a esteira (referência da cobrança e carimbo do pagamento), `apolo_disparos` (cada envio,
// com canal e entrega devolvida pela Meta) e `apolo_asaas_eventos` (o que o Asaas notificou).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type DisparoRow = {
  created_at: string;
  delivered_at: string | null;
  destinatario: string | null;
  erro: string | null;
  origem: string | null;
  read_at: string | null;
  status: string | null;
  template: string | null;
  tipo: string | null;
};

type EventoRow = {
  evento: string | null;
  recebido_em: string;
  status: string | null;
  value: number | string | null;
};

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Sem acesso à base." }, { status: 503 });
  }

  const { id } = await context.params;

  // `[id]` é a PESSOA; o PIX é de UMA CAD. `?enterpriseId=` diz qual; sem ele, a mais recente
  // (mesmo default do resto do Board enquanto o card for por pessoa).
  const esteira = await lerCadDaEsteira<{
    etapa: string | null;
    pagamento_ref: string | null;
    pago_em: string | null;
  }>(adminClient, id, "pagamento_ref, pago_em, etapa", {
    enterpriseId: new URL(request.url).searchParams.get("enterpriseId"),
  });

  // Envios da pré-venda desta ficha (cobrança e recibo, nos dois canais).
  const { data: disparos } = await adminClient
    .from("apolo_disparos")
    .select("tipo, origem, template, destinatario, status, erro, created_at, delivered_at, read_at")
    .eq("entity_id", id)
    .in("tipo", ["prevenda_cobranca", "prevenda_recibo"])
    .order("created_at", { ascending: true });

  // O que o Asaas notificou sobre a cobrança desta ficha.
  let eventos: EventoRow[] = [];
  if (esteira?.pagamento_ref) {
    const { data } = await adminClient
      .from("apolo_asaas_eventos")
      .select("evento, status, value, recebido_em")
      .eq("asaas_payment_id", esteira.pagamento_ref)
      .order("recebido_em", { ascending: true });
    eventos = (data ?? []) as EventoRow[];
  }

  const lista = (disparos ?? []) as DisparoRow[];
  const criado = eventos.find((e) => e.evento === "PAYMENT_CREATED");
  const pago = eventos.find(
    (e) => e.evento === "PAYMENT_RECEIVED" || e.evento === "PAYMENT_CONFIRMED",
  );

  // O PIX PARA A MÃO DO TIME: link da fatura, copia-e-cola e QR. Vem do Asaas na hora (não
  // guardamos), e só para quem ainda não pagou — depois de pago, mandar o PIX de novo é convite a
  // pagar duas vezes. Falha aqui não derruba a tela: o resto do status continua aparecendo.
  let pagamentoPix: {
    copiaECola: string | null;
    link: string | null;
    qrBase64: string | null;
    vencimento: string | null;
  } | null = null;

  if (esteira?.pagamento_ref && !esteira.pago_em && !esteira.pagamento_ref.startsWith("reservado:")) {
    const [cobranca, qr] = await Promise.all([
      consultarCobranca(esteira.pagamento_ref),
      obterQrCodePix(esteira.pagamento_ref),
    ]);
    if (cobranca.ok || qr.ok) {
      pagamentoPix = {
        copiaECola: qr.ok ? qr.data.payload : null,
        link: cobranca.ok ? (cobranca.data.invoiceUrl ?? null) : null,
        qrBase64: qr.ok ? qr.data.encodedImage : null,
        vencimento: cobranca.ok ? cobranca.data.dueDate : null,
      };
    }
  }

  const numero = (v: number | string | null) => {
    const n = typeof v === "number" ? v : Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
  };

  return NextResponse.json({
    data: {
      cobranca: esteira?.pagamento_ref
        ? {
            criadoEm: criado?.recebido_em ?? null,
            paymentId: esteira.pagamento_ref,
            valor: numero(criado?.value ?? pago?.value ?? null),
          }
        : null,
      envios: lista.map((d) => ({
        canal: d.origem?.includes("email") ? "email" : "whatsapp",
        destinatario: d.destinatario,
        entregueEm: d.delivered_at,
        erro: d.erro,
        lidoEm: d.read_at,
        quando: d.created_at,
        status: d.status,
        template: d.template,
        tipo: d.tipo,
      })),
      pagamento: esteira?.pago_em
        ? { quando: esteira.pago_em, valor: numero(pago?.value ?? null) }
        : null,
      pix: pagamentoPix,
    },
  });
}
