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

//
// ⚠️ E NA TABELA TAMBÉM NÃO VAI TUDO (F1 da fonte única, 28/09/2026). Medido: 201 de 226 eventos
// guardados traziam CPF e nascimento, e 39 traziam geolocalização. Desde então o conferido é
// guardado REDUZIDO (`payloadReduzidoDaClicksign`, uma allowlist) e o não conferido só como
// ESQUELETO. O que um POST forjado ainda deixa na tabela é pouco e tem teto: o esqueleto (~2 KB),
// o nome do evento cortado em 80, os ids só se tiverem forma de id da Clicksign e os cabeçalhos da
// lista de `cabecalhosParaGuardar` (com o `x-real-ip`, a pista de quem forjou). Quem recorta é
// `registrarEventoDeAssinatura`.
//
// ⚠️ E OS CABEÇALHOS SÃO UMA LISTA DO QUE GUARDAR (revisão da F1). A lista do que omitir deixava
// passar `x-vercel-oidc-token`, `x-vercel-sc-headers` (com Bearer) e `x-vercel-proxy-signature`,
// gravados em 230 de 230 linhas até 28/09/2026.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// ⚠️ 60 E NÃO 15 (plano, seção 7). O trabalho roda em `after()`, depois da resposta, e agora ele
// chama a função da 0195 e, no fechamento, move o card e a venda. Com 15 s a Vercel matava o
// `after()` no meio e o card ficava parado com o contrato assinado; a resposta ao provedor continua
// saindo antes de qualquer consulta.
export const maxDuration = 60;

/**
 * O teto do corpo: 128 KB. O maior payload legítimo medido tem 29 KB (28/09/2026).
 *
 * ⚠️ ACIMA DISTO É 413 E NADA É GRAVADO. A rota é pública; sem teto, qualquer um enchia
 * `temis_assinatura_eventos` com o que quisesse, um POST de cada vez.
 */
const TETO_DO_CORPO_EM_BYTES = 128 * 1024;

/**
 * Os cabeçalhos da chamada, CRUS: quem recorta o que vai para a tabela é `registrarEventoDeAssinatura`
 * (`cabecalhosParaGuardar`, uma lista do que guardar). Aqui só se lê.
 *
 * ⚠️ A ASSINATURA DO CALLBACK FICA, e é o motivo de registrar headers: é assim que se descobre em
 * QUE cabeçalho a Clicksign manda o HMAC. O valor de um HMAC não é segredo reutilizável (ele vale
 * para um corpo só), então guardá-lo não abre porta nenhuma.
 */
function cabecalhosDaChamada(request: Request): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const [chave, valor] of request.headers.entries()) saida[chave.toLowerCase()] = valor;
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
  // ⚠️ O TAMANHO DECLARADO É CONFERIDO ANTES DE LER, e o lido de novo depois: o cabeçalho pode
  // faltar ou mentir, e só o segundo teste mede o que chegou.
  const declarado = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declarado) && declarado > TETO_DO_CORPO_EM_BYTES) {
    console.warn("[clicksign][webhook] corpo acima do teto, recusado sem gravar", { declarado });
    return NextResponse.json({ ok: false, erro: "corpo grande demais" }, { status: 413 });
  }

  // ⚠️ LÊ COMO TEXTO, E ISSO NÃO É SÓ PELA DESCOBERTA: o HMAC é calculado sobre o corpo CRU. Um
  // `request.json()` seguido de `JSON.stringify` mudaria espaços e ordem de chaves, e a conferência
  // falharia em todo evento legítimo.
  const cru = await request.text().catch(() => "");
  const tamanho = Buffer.byteLength(cru, "utf8");
  if (tamanho > TETO_DO_CORPO_EM_BYTES) {
    console.warn("[clicksign][webhook] corpo acima do teto, recusado sem gravar", { tamanho });
    return NextResponse.json({ ok: false, erro: "corpo grande demais" }, { status: 413 });
  }
  const headers = cabecalhosDaChamada(request);

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
    // O nome vem do corpo, conferido ou não: cortado, como na tabela.
    evento: evento.evento.slice(0, 80) || "(não identificado)",
    falhaDeAutenticacaoDoSignatario: ehFalhaDeAutenticacao(evento.evento),
    // O carimbo é NOSSO: o horário do provedor pode vir sem fuso, ou não vir.
    recebidoEm: new Date().toISOString(),
    tamanhoDoCorpo: tamanho,
  });

  // ⚠️ O CORPO LIDO, E NÃO O QUE SE GUARDA: quem decide o recorte (reduzido ou esqueleto) é
  // `registrarEventoDeAssinatura`, para nenhum caminho gravar o corpo cheio por esquecimento.
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
        tamanho,
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
  // O carimbo é NOSSO: é a hora da conferência (`conferido_em` do envelope).
  const recebidoEm = new Date().toISOString();

  after(async () => {
    const sb = createApoloAdminClient();
    if (!sb) {
      console.error("[clicksign][webhook] Supabase indisponível: o evento conferido não foi aplicado.");
      return;
    }

    const aplicacao = await aplicarEventoDaClicksign(sb, evento, payload, recebidoEm);
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
      envelopeIdDoRegistro: aplicacao.envelopeIdDoRegistro,
      evento,
      headers,
      payload,
      tamanho,
    });
  });

  return NextResponse.json({ ok: true });
}

/**
 * O corpo lido, para as marcas e para o recorte que `registrarEventoDeAssinatura` guarda.
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
