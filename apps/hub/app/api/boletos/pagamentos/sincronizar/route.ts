import { NextResponse, type NextRequest } from "next/server";

import { type ContaAsaas, chaveDaConta, rotuloDaConta } from "@/lib/apolo/asaas-contas";
import { authorizeApoloRead } from "@/lib/apolo/auth";
import { listarCobrancas } from "@/lib/apolo/boletos/emissao";
import { EMPREENDIMENTOS_DE_BOLETO } from "@/lib/apolo/boletos/empreendimentos";
import { pagamentoDoAsaas } from "@/lib/apolo/boletos/pagamento-do-asaas";
import { createApoloAdminClient } from "@/lib/apolo/server";

// A REDE DE SEGURANÇA DO WEBHOOK: nós perguntamos ao Asaas o que ele deixou de nos contar.
//
// Lucas (22/09/2026): *"esses status tem que ser registrados via webhook"* e, sobre a frequência,
// *"automático, a cada hora"*.
//
// ⚠️ O WEBHOOK É A FONTE; ISTO AQUI É A REDE. Evento se perde: o Asaas desiste depois de algumas
// reentregas, um deploy no segundo errado devolve 500, alguém configura a conta nova e esquece o
// webhook. Sem uma varredura periódica, a tabela envelhece em SILÊNCIO — e o silêncio é exatamente
// o que não se percebe numa conciliação. Rodando de hora em hora, o pior atraso é de uma hora.
//
// ⚠️ UMA CHAMADA POR CONTA, e não por empreendimento: os quatro edifícios da CER dividem a mesma
// conta do Asaas. A referência de cada cobrança (`boleto:ed-rubi:401:2026-09`) é o que devolve cada
// uma ao seu prédio, e é `pagamentoDoAsaas` quem lê isso — a MESMA régua do webhook, de propósito.
//
// ⚠️ SÓ A COMPETÊNCIA PEDIDA (ou a do mês corrente). Varrer o histórico inteiro a cada hora seriam
// sete varreduras de carteira por hora para reescrever linhas que não mudam; o que muda é o mês
// aberto. Competência antiga se atualiza pedindo `?competencia=2026-08` à mão.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function autorizadoPorSecret(request: NextRequest): boolean {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret && token === secret);
}

/** 'YYYY-MM' do mês corrente, em Brasília — o mês que está aberto para pagamento. */
function competenciaDeHoje(): string {
  const agora = new Date();
  const emBrasilia = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
  return `${emBrasilia.getUTCFullYear()}-${String(emBrasilia.getUTCMonth() + 1).padStart(2, "0")}`;
}

function intervaloDaCompetencia(competencia: string): { fim: string; inicio: string } {
  const [ano, mes] = competencia.split("-").map(Number) as [number, number];
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return { fim: `${competencia}-${ultimo}`, inicio: `${competencia}-01` };
}

/** As contas que emitem boleto, uma vez cada (a CER aparece em quatro empreendimentos). */
function contasDeBoleto(): ContaAsaas[] {
  const vistas = new Set<ContaAsaas>();
  for (const emp of EMPREENDIMENTOS_DE_BOLETO) {
    if (emp.conta) vistas.add(emp.conta);
  }
  return [...vistas];
}

export async function POST(request: NextRequest) {
  if (!autorizadoPorSecret(request)) {
    const auth = await authorizeApoloRead(request);
    if (!auth.ok) return auth.response;
  }

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Sem acesso ao banco." }, { status: 503 });

  const pedida = new URL(request.url).searchParams.get("competencia")?.trim();
  const competencia = /^\d{4}-\d{2}$/.test(pedida ?? "") ? (pedida as string) : competenciaDeHoje();
  const intervalo = intervaloDaCompetencia(competencia);

  const porConta: Array<{ conta: string; erro?: string; gravadas: number; lidas: number }> = [];
  let gravadasNoTotal = 0;

  for (const conta of contasDeBoleto()) {
    // Conta sem chave configurada não é erro de execução: é carteira que ainda não emite. Entra no
    // relatório para não virar silêncio.
    if (!chaveDaConta(conta)) {
      porConta.push({ conta, erro: "sem chave configurada", gravadas: 0, lidas: 0 });
      continue;
    }

    const lista = await listarCobrancas(conta, intervalo);
    if (!lista.ok) {
      porConta.push({ conta, erro: lista.erro, gravadas: 0, lidas: 0 });
      continue;
    }

    const linhas = lista.data
      .map((cobranca) => pagamentoDoAsaas(cobranca, { conta }))
      .filter((linha): linha is NonNullable<typeof linha> => linha !== null)
      // A varredura traz o mês inteiro por VENCIMENTO; a competência da referência é que manda,
      // porque uma cobrança de agosto pode ter sido reemitida com vencimento em setembro.
      .filter((linha) => linha.competencia === competencia);

    if (linhas.length > 0) {
      const agora = new Date().toISOString();
      const { error } = await client
        .from("boletos_pagamentos")
        .upsert(
          linhas.map((linha) => ({ ...linha, sincronizado_em: agora })),
          { onConflict: "cobranca_id" },
        );
      if (error) {
        console.error("[boletos][sincronizar] upsert falhou", conta, error.message);
        porConta.push({
          conta,
          erro: "falha ao gravar",
          gravadas: 0,
          lidas: lista.data.length,
        });
        continue;
      }
    }

    gravadasNoTotal += linhas.length;
    porConta.push({ conta, gravadas: linhas.length, lidas: lista.data.length });
  }

  return NextResponse.json({
    competencia,
    contas: porConta.map((c) => ({ ...c, rotulo: rotuloDaConta(c.conta as ContaAsaas) })),
    gravadas: gravadasNoTotal,
    ok: true,
  });
}

/** O cron da Vercel chama por GET; o corpo é o mesmo. */
export async function GET(request: NextRequest) {
  return POST(request);
}
