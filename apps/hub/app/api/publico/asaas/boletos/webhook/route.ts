import { NextResponse } from "next/server";

import { createApoloAdminClient } from "@/lib/apolo/server";
import {
  estaPago,
  mudouDeEstado,
  pagamentoDoAsaas,
  type CobrancaDoAsaas,
} from "@/lib/apolo/boletos/pagamento-do-asaas";

// O ASAAS AVISANDO QUE UM BOLETO MUDOU DE ESTADO.
//
// Lucas (22/09/2026): *"esses status tem que ser registrados via webhook, temos que começar ter uma
// inteligência de gestão de notificação e atualização"*.
//
// ⚠️ É UM ENDPOINT NOVO, E NÃO O DA PRÉ-VENDA. O `/api/publico/asaas/webhook` existente é da conta
// GURGEL e dispara recibo, fila do Prometeu e aviso à imobiliária a cada PIX confirmado; pendurar
// os boletos das outras sete contas ali misturaria dois fluxos que não têm nada em comum, e o
// primeiro defeito de um derrubaria o outro. O que os dois compartilham é o formato do payload,
// que é do Asaas.
//
// ⚠️ SEMPRE 200 DEPOIS DE GRAVAR, MESMO NO QUE IGNORAMOS. O Asaas REENTREGA o evento enquanto não
// receber 200, com recuo crescente: responder 4xx a uma cobrança que não é nossa faria a conta
// acumular fila de reentrega para sempre. O único 401 é o token errado — aí a reentrega é o que se
// quer, porque alguém configurou o webhook errado e precisa aparecer.
//
// ⚠️ IDEMPOTENTE POR `cobranca_id`: o upsert atualiza a linha existente. O mesmo evento chegando
// duas vezes (reentrega, clique no painel) não duplica nem avisa duas vezes — ver `mudouDeEstado`.
//
// Público por desenho (máquina a máquina, sem sessão) — precisa do prefixo em `proxy.ts`.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

function registro(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export async function POST(request: Request) {
  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ ok: false }, { status: 503 });

  // ⚠️ O TOKEN É POR CONTA, E A CONTA VEM NA URL. Cada conta do Asaas configura o webhook com o
  // seu próprio token; sem saber de qual conta o evento veio, a cobrança não tem dono — e é a
  // conta que diz onde o dinheiro caiu. `?conta=garden` é obrigatório.
  const conta = new URL(request.url).searchParams.get("conta")?.trim().toLowerCase() ?? "";
  const esperado = process.env.ASAAS_BOLETOS_WEBHOOK_TOKEN?.trim();
  const recebido = (request.headers.get("asaas-access-token") ?? "").trim();

  // ⚠️ SEM O SEGREDO CONFIGURADO, A PORTA FICA FECHADA. Esta rota é PÚBLICA (o Asaas não tem
  // como logar no hub) e GRAVA no banco: aceitar qualquer POST enquanto a env não existe daria
  // a qualquer um na internet o direito de escrever pagamento na nossa conciliação. O webhook
  // da pré-venda nasceu em "modo descoberta" aceitando sem token, e aquilo era para APRENDER
  // como o Asaas autentica -- hoje já sabemos, então aqui é fail-closed desde o primeiro dia.
  if (!esperado) {
    console.error("[boletos][webhook] ASAAS_BOLETOS_WEBHOOK_TOKEN não configurado");
    return NextResponse.json({ erro: "webhook não configurado", ok: false }, { status: 503 });
  }
  if (recebido !== esperado) {
    // 401 faz o Asaas reentregar: é o que se quer quando o token está errado, porque o erro é de
    // configuração e precisa aparecer em vez de sumir.
    return NextResponse.json({ erro: "token", ok: false }, { status: 401 });
  }
  if (!conta) {
    return NextResponse.json({ erro: "conta ausente na URL", ok: false }, { status: 400 });
  }

  const payload = registro(await request.json().catch(() => ({})));
  const cobranca = registro(payload.payment) as CobrancaDoAsaas;
  const linha = pagamentoDoAsaas(cobranca, { conta });

  // Cobrança que não saiu da aba Boletos (carnê antigo, avulsa do painel): registrada como
  // ignorada e respondida com 200, para não virar fila de reentrega.
  if (!linha) {
    return NextResponse.json({ ignorado: "cobrança sem referência `boleto:`", ok: true });
  }

  const { data: antes } = await client
    .from("boletos_pagamentos")
    .select("situacao")
    .eq("cobranca_id", linha.cobranca_id)
    .maybeSingle();

  const { error } = await client
    .from("boletos_pagamentos")
    .upsert({ ...linha, sincronizado_em: new Date().toISOString() }, { onConflict: "cobranca_id" });

  if (error) {
    // 500 para o Asaas reentregar: perder um pagamento é pior do que uma reentrega a mais.
    console.error("[boletos][webhook] upsert falhou", error.message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  const novidade = mudouDeEstado(antes, linha);

  // ⚠️ A NOTIFICAÇÃO AINDA NÃO SAI DAQUI, e isto está escrito de propósito. A tabela e o registro
  // vêm primeiro; quem é avisado e por qual canal (o time, o cliente, a carteira do LSoft) é
  // decisão de produto que o Lucas ainda vai tomar. Enquanto isso, o log diz o que teria saído, e
  // `mudouDeEstado` já separa o evento novo da reentrega.
  if (novidade && estaPago(linha.situacao)) {
    console.info("[boletos][webhook] pagamento confirmado", {
      cobranca: linha.cobranca_id,
      competencia: linha.competencia,
      empreendimento: linha.empreendimento,
      unidade: linha.unidade,
      valor: linha.valor_pago,
    });
  }

  return NextResponse.json({ novidade, ok: true, situacao: linha.situacao });
}
