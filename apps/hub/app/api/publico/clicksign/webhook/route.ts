import { after, NextResponse } from "next/server";

import { createApoloAdminClient } from "@/lib/apolo/server";
import { lerConfiguracao } from "@/lib/assinatura/clicksign/cliente";
import {
  conferirAssinaturaDoWebhook,
  lerEventoDoWebhook,
} from "@/lib/assinatura/clicksign/webhook";
import {
  aplicarEventoDaClicksign,
  registrarEventoDeAssinatura,
} from "@/lib/assinatura/estado-db";
import { ehFalhaDeAutenticacao } from "@/lib/assinatura/traduzir";

// WEBHOOK DA CLICKSIGN — quem confere quem está falando, e o que move o contrato.
//
// Lucas, 07/09/2026, com o painel da Clicksign aberto: *"está pedindo a url do webhook"*, e antes
// disso *"o sandbox está com problemas, vamos de prod mesmo"*.
//
// ⚠️ ATÉ 08/09/2026 ESTA ROTA NÃO PROCESSAVA NADA — era o modo DESCOBERTA, e isso era correto
// enquanto não havia envio: a URL precisava existir para o painel aceitar o cadastro, e o formato
// real dos eventos era desconhecido. Agora que o contrato SAI daqui, um endpoint público sem
// conferência é outra coisa: qualquer um que saiba a URL manda um POST dizendo que o contrato foi
// assinado, o card vai para "finalizado" e o documento segue sem ninguém ter assinado nada.
//
// ⚠️ A REGRA É UMA SÓ: O QUE NÃO CONFERE NÃO MOVE NADA. Fica registrado (é assim que se descobre um
// forjado, e é assim que se descobre que o cabeçalho do HMAC não é o que supomos — ver
// `lib/assinatura/clicksign/webhook.ts`), e não vira estado.
//
// ⚠️ RESPONDER RÁPIDO CONTINUA SENDO A FUNÇÃO PRINCIPAL. Provedor reenvia o evento quando não recebe
// 200, e retentativa em cima de rota lenta vira tempestade. Por isso o trabalho de banco roda em
// `after()`: a resposta sai antes de qualquer consulta.
//
// ⚠️ E O CORPO NÃO VAI PARA O `console`. O payload de um `sign` traz nome, e-mail, CPF, IP e
// geolocalização de quem assinou; log da Vercel é legível por qualquer pessoa com acesso ao projeto,
// sai em drain e tem retenção curta. O conteúdo agora tem lugar próprio — `temis_assinatura_eventos`
// (migration 0147), no molde de `apolo_asaas_eventos` —, que é onde privacidade e retenção se
// resolvem de uma vez. No console fica só o ESQUELETO.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// O trabalho roda em `after()`; o teto baixo continua sendo a garantia de que a rota nunca segura a
// conexão do provedor.
export const maxDuration = 15;

/** Cabeçalhos que NÃO podem ser guardados — carregam credencial. */
const SEGREDOS = new Set([
  "authorization",
  "cookie",
  "x-api-key",
  "asaas-access-token",
  "clicksign-access-token",
]);

function headersSeguros(request: Request): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const [chave, valor] of request.headers.entries()) {
    const nome = chave.toLowerCase();
    // ⚠️ A ASSINATURA DO CALLBACK FICA, e é o motivo de registrar headers: é assim que se descobre
    // em QUE cabeçalho a Clicksign manda o HMAC — a doc da v3 não diz. O valor de um HMAC não é
    // segredo reutilizável (ele vale para um corpo só), então guardá-lo não abre porta nenhuma.
    saida[nome] = SEGREDOS.has(nome) ? "(omitido)" : valor;
  }
  return saida;
}

/** As chaves de primeiro nível — a FORMA do evento, sem o conteúdo. É o que vai para o console. */
function chavesDePrimeiroNivel(cru: string): string[] {
  if (!cru) return [];
  try {
    const corpo: unknown = JSON.parse(cru);
    if (corpo && typeof corpo === "object" && !Array.isArray(corpo)) {
      return Object.keys(corpo as Record<string, unknown>).slice(0, 40);
    }
    return [Array.isArray(corpo) ? "(array)" : `(${typeof corpo})`];
  } catch {
    // Não é JSON: provavelmente form-data (o formato em que o webhook do D4Sign chega, apesar de a
    // doc mostrar JSON). Os NOMES dos campos são seguros; os valores não.
    try {
      return [...new URLSearchParams(cru).keys()].slice(0, 40);
    } catch {
      return ["(corpo ilegível)"];
    }
  }
}

export async function POST(request: Request) {
  // ⚠️ LÊ COMO TEXTO, E ISSO NÃO É SÓ PELA DESCOBERTA: o HMAC é calculado sobre o corpo CRU. Um
  // `request.json()` seguido de `JSON.stringify` mudaria espaços e ordem de chaves, e a conferência
  // falharia em todo evento legítimo.
  const cru = await request.text().catch(() => "");
  const headers = headersSeguros(request);

  const verificacao = conferirAssinaturaDoWebhook({
    corpoCru: cru,
    headers: request.headers,
    segredo: lerConfiguracao()?.webhookSecret ?? null,
  });

  const evento = lerEventoDoWebhook(cru);

  console.info("[clicksign][webhook] evento recebido", {
    assinatura: verificacao.ok ? `ok (${verificacao.cabecalho})` : verificacao.porQue,
    chavesDoCorpo: chavesDePrimeiroNivel(cru),
    // Só os NOMES dos cabeçalhos no console: é o que responde "em qual deles vem o HMAC?".
    cabecalhos: Object.keys(headers),
    evento: evento.evento || "(não identificado)",
    falhaDeAutenticacaoDoSignatario: ehFalhaDeAutenticacao(evento.evento),
    // O carimbo é NOSSO: o horário do provedor pode vir sem fuso, ou não vir.
    recebidoEm: new Date().toISOString(),
    tamanhoDoCorpo: cru.length,
  });

  const payload = payloadParaGuardar(cru);

  if (!verificacao.ok) {
    // ⚠️ O EVENTO QUE NÃO PASSA AINDA É REGISTRADO. Ver `registrarEventoDeAssinatura`: é a única
    // pista de um POST forjado, e é como se descobre que o cabeçalho do HMAC não é o que supomos.
    after(async () => {
      const sb = createApoloAdminClient();
      if (!sb) return;
      await registrarEventoDeAssinatura(sb, {
        aplicado: false,
        assinaturaCabecalho: null,
        assinaturaConferida: false,
        evento,
        headers,
        payload,
      });
    });

    // ⚠️ AS DUAS RESPOSTAS SÃO DIFERENTES DE PROPÓSITO. `sem-segredo` é problema NOSSO de
    // configuração (a chave não chegou, ou chegou vazia por estar "Sensitive" na Vercel): devolver
    // 401 faria a Clicksign reenviar por horas um evento que nunca vai passar — 200 encerra a
    // entrega e o log grita. `nao-bate` / `sem-assinatura` é alguém batendo na porta, e aí 401 é a
    // resposta certa.
    if (verificacao.porQue === "sem-segredo") {
      console.error("[clicksign][webhook] EVENTO IGNORADO:", verificacao.motivo);
      return NextResponse.json({ ok: true, aplicado: false, motivo: "sem-segredo" });
    }

    console.warn("[clicksign][webhook] EVENTO RECUSADO:", verificacao.motivo);
    return NextResponse.json({ ok: false, erro: "assinatura inválida" }, { status: 401 });
  }

  const cabecalho = verificacao.cabecalho;

  after(async () => {
    const sb = createApoloAdminClient();
    if (!sb) {
      console.error("[clicksign][webhook] Supabase indisponível: o evento conferido não foi aplicado.");
      return;
    }

    const aplicacao = await aplicarEventoDaClicksign(sb, evento);
    console.info("[clicksign][webhook] evento aplicado?", {
      aplicado: aplicacao.aplicado,
      estado: aplicacao.estado,
      evento: evento.evento,
      motivo: aplicacao.motivo,
    });

    await registrarEventoDeAssinatura(sb, {
      aplicado: aplicacao.aplicado,
      assinaturaCabecalho: cabecalho,
      assinaturaConferida: true,
      evento,
      headers,
      payload,
    });
  });

  return NextResponse.json({ ok: true });
}

/**
 * O corpo, pronto para a coluna `jsonb`.
 *
 * ⚠️ CORPO QUE NÃO É JSON NÃO PODE SER DESCARTADO. O webhook do D4Sign chega em form-data apesar de
 * a doc mostrar JSON, e o da Clicksign não tem exemplo documentado nenhum. Guardar o texto cru
 * embrulhado é o que permite escrever o parser a partir do que chegou de verdade.
 */
function payloadParaGuardar(cru: string): unknown {
  if (!cru) return null;
  try {
    return JSON.parse(cru);
  } catch {
    return { __cru: cru.slice(0, 20_000) };
  }
}

// A Clicksign (como vários provedores) pode fazer um GET de verificação ao cadastrar a URL.
// Responder 200 aqui é o que faz o painel aceitar o cadastro.
export function GET() {
  return NextResponse.json({ ok: true, servico: "clicksign-webhook" });
}
