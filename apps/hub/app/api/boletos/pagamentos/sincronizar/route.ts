import { NextResponse, type NextRequest } from "next/server";

import { type ContaAsaas, chaveDaConta, rotuloDaConta } from "@/lib/apolo/asaas-contas";
import { authorizeApoloRead } from "@/lib/apolo/auth";
import { listarCobrancas } from "@/lib/apolo/boletos/emissao";
import { EMPREENDIMENTOS_DE_BOLETO } from "@/lib/apolo/boletos/empreendimentos";
import { pagamentoDoAsaas } from "@/lib/apolo/boletos/pagamento-do-asaas";
import { createApoloAdminClient } from "@/lib/apolo/server";
import {
  competenciasAtrasadas,
  type RodadaDaBaixa,
  rodarBaixaDoHub,
  SLUG_DO_GARDEN_NO_BOLETO,
} from "@/lib/lsoft/baixa-do-hub";

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
//
// ⚠️ A EXCEÇÃO É O GARDEN, e só enquanto houver boleto em aberto (achado da revisão de 29/09/2026).
// Com a baixa do hub, o boleto de setembro pago em outubro PRECISA chegar a `boletos_pagamentos`, e
// o webhook ainda não está configurado nas contas. Sem esta exceção, a partir de 01/10 ele ficaria
// OVERDUE para sempre e a parcela, vencida na ficha, com o dinheiro em conta. Então, na chamada sem
// `?competencia` (a do cron), a conta do Garden também pergunta ao Asaas as até duas competências
// anteriores (desde 2026-09) que ainda têm boleto em aberto na tabela: no máximo duas listagens a
// mais por hora, numa conta só, e nenhuma quando tudo está pago (`competenciasAtrasadas`).
//
// ⚠️ DEPOIS DO RETRATO, A BAIXA DO HUB (Lucas, 29/09/2026: *"a partir de setembro, quem alimenta a
// carteira é o hub"*). Com a tabela atualizada, os boletos pagos do Garden a partir da competência
// 2026-09 dão baixa na parcela do espelho do LSoft dos clientes que já estão no Financeiro
// (lib/lsoft/baixa-do-hub.ts). Ela lê TODAS as competências desde setembro, e não só a que esta
// chamada trouxe: o pagamento que entrou por outra porta também vira baixa, e a parcela já paga
// não custa escrita. Falha nela vai para o log e para a resposta, e NUNCA derruba a sincronização:
// o retrato do Asaas já está gravado e vale por si.
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

/** A conta do Asaas que emite o boleto do Garden (a única em que a baixa do hub vale). */
const CONTA_DO_GARDEN: ContaAsaas | null =
  EMPREENDIMENTOS_DE_BOLETO.find((emp) => emp.slug === SLUG_DO_GARDEN_NO_BOLETO)?.conta ?? null;

/**
 * Os status de cobrança que ainda podem virar pagamento. É o que mantém uma competência antiga do
 * Garden na varredura; paga, devolvida ou cancelada, ela sai.
 */
const SITUACOES_EM_ABERTO = ["AWAITING_RISK_ANALYSIS", "OVERDUE", "PENDING"];

/**
 * Das competências anteriores candidatas, as que ainda têm boleto do Garden em aberto na tabela.
 * Falha de leitura aqui não derruba nada: a competência fica de fora desta hora e vai para o log.
 */
async function competenciasDoGardenEmAberto(
  client: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  candidatas: readonly string[],
): Promise<string[]> {
  const abertas: string[] = [];
  for (const competencia of candidatas) {
    const { count, error } = await client
      .from("boletos_pagamentos")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", "careli")
      .eq("empreendimento", SLUG_DO_GARDEN_NO_BOLETO)
      .eq("competencia", competencia)
      .in("situacao", SITUACOES_EM_ABERTO);
    if (error) {
      console.error("[boletos][sincronizar] leitura dos boletos em aberto falhou", competencia, error.message);
      continue;
    }
    if ((count ?? 0) > 0) abertas.push(competencia);
  }
  return abertas;
}

/** O que a rota ainda pode gastar com a baixa: o resto dos 300 s, com folga para responder. */
const PRAZO_DA_BAIXA_MS = 240_000;
/** Parcelas baixadas por rodada, no máximo; o resto fica para a próxima hora. */
const LIMITE_DA_BAIXA = 100;

export async function POST(request: NextRequest) {
  const comecou = Date.now();
  if (!autorizadoPorSecret(request)) {
    const auth = await authorizeApoloRead(request);
    if (!auth.ok) return auth.response;
  }

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Sem acesso ao banco." }, { status: 503 });

  const pedida = new URL(request.url).searchParams.get("competencia")?.trim();
  const foiPedida = /^\d{4}-\d{2}$/.test(pedida ?? "");
  const competencia = foiPedida ? (pedida as string) : competenciaDeHoje();
  const intervalo = intervaloDaCompetencia(competencia);

  // O atraso do Garden: só na chamada sem `?competencia` (a do cron). Quem pede um mês à mão quer
  // aquele mês, e só ele.
  const atrasadas = foiPedida ? [] : await competenciasDoGardenEmAberto(client, competenciasAtrasadas(competencia));

  const porConta: Array<{ atrasadas?: string[]; conta: string; erro?: string; gravadas: number; lidas: number }> = [];
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

    const cobrancas = [...lista.data];
    const atrasadasDaConta = conta === CONTA_DO_GARDEN ? atrasadas : [];
    const atrasadasLidas: string[] = [];
    for (const atrasada of atrasadasDaConta) {
      const antiga = await listarCobrancas(conta, intervaloDaCompetencia(atrasada));
      // A listagem do mês atrasado que falha não joga fora a do mês corrente: fica para a próxima hora.
      if (!antiga.ok) {
        console.error("[boletos][sincronizar] listagem da competência atrasada falhou", conta, atrasada, antiga.erro);
        continue;
      }
      cobrancas.push(...antiga.data);
      atrasadasLidas.push(atrasada);
    }
    const aceitas = new Set([competencia, ...atrasadasLidas]);

    // ⚠️ UMA LINHA POR COBRANÇA: o mesmo id duas vezes no mesmo upsert faz o Postgres recusar o lote
    // inteiro ("cannot affect row a second time"). As listagens são por intervalos de vencimento que
    // não se cruzam, mas a garantia fica aqui e não na sorte.
    const porCobranca = new Map<string, NonNullable<ReturnType<typeof pagamentoDoAsaas>>>();
    for (const cobranca of cobrancas) {
      const linha = pagamentoDoAsaas(cobranca, { conta });
      // A varredura traz o mês inteiro por VENCIMENTO; a competência da referência é que manda,
      // porque uma cobrança de agosto pode ter sido reemitida com vencimento em setembro.
      if (linha && aceitas.has(linha.competencia)) porCobranca.set(linha.cobranca_id, linha);
    }
    const linhas = [...porCobranca.values()];

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
          lidas: cobrancas.length,
        });
        continue;
      }
    }

    gravadasNoTotal += linhas.length;
    porConta.push({
      ...(atrasadasLidas.length > 0 ? { atrasadas: atrasadasLidas } : {}),
      conta,
      gravadas: linhas.length,
      lidas: cobrancas.length,
    });
  }

  // A baixa do hub, depois do retrato gravado. Só contagens na resposta: nada pessoal.
  let baixaDoHub: RodadaDaBaixa | { erro: string };
  try {
    baixaDoHub = await rodarBaixaDoHub({ limite: LIMITE_DA_BAIXA, prazo: comecou + PRAZO_DA_BAIXA_MS });
  } catch (falha) {
    console.error(
      "[boletos][sincronizar] baixa do hub falhou",
      falha instanceof Error ? falha.message : String(falha),
    );
    baixaDoHub = { erro: "falha na baixa do hub" };
  }

  return NextResponse.json({
    atrasadas,
    baixaDoHub,
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
