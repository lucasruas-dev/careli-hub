import { NextResponse, type NextRequest } from "next/server";

import { authorizeApoloAdmin } from "@/lib/apolo/auth";
import { dispararRelatorioImob } from "@/lib/apolo/disparo-imobiliaria";
import { montarRelatorioImobiliaria } from "@/lib/apolo/emails-imobiliaria";
import { montarRelatoriosDoEmpreendimento } from "@/lib/apolo/relatorio-imobiliaria";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { getCacaSender, isGmailConfigured, sendGmailMessage } from "@/lib/iris/gmail";

// RELATÓRIO DIÁRIO das imobiliárias — roda às 18h (cron Vercel). Para cada imobiliária do
// empreendimento, monta o relatório de performance dos clientes DELA e manda por e-mail (o HTML) +
// WhatsApp (aviso). Só STATUS, nunca valores de crédito.
//
// Autorização: cron interno do Vercel (x-vercel-cron) OU Bearer CRON_SECRET; para disparo manual,
// o Bearer de um ADMIN do Apolo (WhatsApp tem custo). `dryRun=1` monta sem enviar.
// `teste=<email>&imobiliaria=<nome>`: envia SÓ por e-mail, SÓ dessa imobiliária, para o e-mail
// informado — é como o time confere o relatório antes do disparo real.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const EMPREENDIMENTO_PADRAO = "Vale do Ouro";
const EMAIL_FROM = getCacaSender();

// KILL-SWITCH DE ENVIO: quando true, o cron e qualquer disparo real ficam pausados (só dryRun
// passa). Foi usado em 24/07/2026 para segurar o relatório enquanto corrigíamos 9 CADs do Vale
// do Ouro com a imobiliária errada; religado (false) depois que as correções foram validadas.
// Fica aqui como trava reutilizável para o próximo incidente que precise pausar o envio na hora.
const ENVIO_RELATORIO_PAUSADO = false;

async function autorizado(request: NextRequest): Promise<boolean> {
  if (request.headers.get("x-vercel-cron")) return true;
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret && token === cronSecret) return true;
  const apolo = await authorizeApoloAdmin(request);
  return apolo.ok;
}

function normaliza(v: string): string {
  return v.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export async function GET(request: NextRequest) {
  if (!(await autorizado(request))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Sem acesso à base." }, { status: 503 });

  const empreendimento =
    request.nextUrl.searchParams.get("empreendimento")?.trim() || EMPREENDIMENTO_PADRAO;
  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  const testeEmail = request.nextUrl.searchParams.get("teste")?.trim() || null;
  const imobFiltro = request.nextUrl.searchParams.get("imobiliaria")?.trim() || null;
  // REENVIO: só para as imobiliárias listadas (separadas por |), só e-mail, sem WhatsApp.
  const reenvio = request.nextUrl.searchParams.get("reenvio") === "1";
  const reenvioImobs = (request.nextUrl.searchParams.get("imobiliarias") ?? "")
    .split("|")
    .map((nome) => nome.trim())
    .filter(Boolean);
  // O banner de retificação ("desconsidere o anterior") agora é OPT-IN, via `retificacao=1`.
  // Antes vinha grudado em todo reenvio, e isso mente quando o motivo do reenvio não foi dado
  // errado: em 26/07 o e-mail nem chegou às imobiliárias (o refresh token do Gmail expirou e
  // as 25 falharam), então o reenvio era o PRIMEIRO envio e o banner só confundiria o parceiro.
  const comRetificacao =
    request.nextUrl.searchParams.get("retificacao") === "1";
  const AVISO_RETIFICACAO =
    "Este e-mail substitui o relatório enviado hoje mais cedo, que trazia clientes atribuídos à imobiliária errada. Por favor, desconsidere o e-mail anterior e considere apenas este.";

  // Trava: nada é enviado enquanto as imobiliárias erradas não forem corrigidas. dryRun passa.
  if (ENVIO_RELATORIO_PAUSADO && !dryRun) {
    return NextResponse.json(
      {
        data: {
          enviados: 0,
          motivo:
            "Envio do relatório PAUSADO para correção das imobiliárias das CADs (Vale do Ouro). Use dryRun=1 para conferir sem enviar.",
          pausado: true,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const relatorios = await montarRelatoriosDoEmpreendimento(client, empreendimento);

  // MODO TESTE: um e-mail só, de uma imobiliária, para o endereço informado.
  if (testeEmail) {
    const alvo = imobFiltro
      ? relatorios.find((r) => normaliza(r.imobNome).includes(normaliza(imobFiltro)))
      : relatorios[0];
    if (!alvo) {
      return NextResponse.json(
        { error: `Nenhuma imobiliária encontrada${imobFiltro ? ` para "${imobFiltro}"` : ""}.` },
        { status: 404 },
      );
    }
    if (!isGmailConfigured()) {
      return NextResponse.json({ error: "Gmail não configurado." }, { status: 503 });
    }
    const montado = montarRelatorioImobiliaria({ ...alvo, empreendimento, imobiliaria: alvo.imobNome });
    try {
      await sendGmailMessage({
        bodyHtml: montado.bodyHtml,
        bodyText: montado.bodyText,
        from: EMAIL_FROM,
        subjectLine: `[TESTE] ${montado.subjectLine} — ${alvo.imobNome}`,
        to: testeEmail,
      });
    } catch (e) {
      return NextResponse.json({ error: `Falha ao enviar: ${(e as Error).message}` }, { status: 502 });
    }
    return NextResponse.json({
      data: { imobiliaria: alvo.imobNome, cads: alvo.totalCads, enviadoPara: testeEmail, teste: true },
    });
  }

  // MODO REENVIO: só as imobiliárias listadas, só e-mail (real da imobiliária). O banner de
  // retificação entra apenas com `retificacao=1` — por padrão vai o relatório limpo.
  if (reenvio) {
    if (reenvioImobs.length === 0) {
      return NextResponse.json(
        { error: "Reenvio exige a lista de imobiliarias (separadas por |)." },
        { status: 400 },
      );
    }
    if (!isGmailConfigured()) {
      return NextResponse.json({ error: "Gmail não configurado." }, { status: 503 });
    }

    const alvos = relatorios.filter((r) =>
      reenvioImobs.some((nome) => normaliza(r.imobNome).includes(normaliza(nome))),
    );

    const feitos: Array<{ email: string; imobiliaria: string; status: string }> = [];
    for (const rel of alvos) {
      const montado = montarRelatorioImobiliaria({
        ...rel,
        avisoRetificacao: comRetificacao ? AVISO_RETIFICACAO : undefined,
        empreendimento,
        imobiliaria: rel.imobNome,
      });
      const destino = rel.contato.email?.trim() || null;
      if (!destino) {
        feitos.push({ email: "—", imobiliaria: rel.imobNome, status: "sem e-mail" });
        continue;
      }
      try {
        await sendGmailMessage({
          bodyHtml: montado.bodyHtml,
          bodyText: montado.bodyText,
          from: EMAIL_FROM,
          subjectLine: montado.subjectLine,
          to: destino,
        });
        feitos.push({ email: destino, imobiliaria: rel.imobNome, status: "reenviado" });
      } catch (e) {
        feitos.push({
          email: destino,
          imobiliaria: rel.imobNome,
          status: `falhou: ${(e as Error).message}`,
        });
      }
    }

    return NextResponse.json({
      data: {
        naoEncontradas: reenvioImobs.filter(
          (nome) => !alvos.some((r) => normaliza(r.imobNome).includes(normaliza(nome))),
        ),
        reenviados: feitos.filter((f) => f.status === "reenviado").length,
        resultados: feitos,
      },
    });
  }

  const resultados: Array<{ cads: number; email: string; imobiliaria: string; whatsapp: string }> = [];
  for (const rel of relatorios) {
    const montado = montarRelatorioImobiliaria({ ...rel, empreendimento, imobiliaria: rel.imobNome });
    if (dryRun) {
      resultados.push({
        cads: rel.totalCads,
        email: rel.contato.email ? "enviaria" : "sem e-mail",
        imobiliaria: rel.imobNome,
        whatsapp: rel.contato.telefone ? "avisaria" : "sem telefone",
      });
      continue;
    }
    const envio = await dispararRelatorioImob(client, {
      contato: rel.contato,
      emailAssunto: montado.subjectLine,
      emailHtml: montado.bodyHtml,
      emailTexto: montado.bodyText,
      empreendimento,
      imobEntityId: rel.imobEntityId,
      imobNome: rel.imobNome,
    });
    resultados.push({
      cads: rel.totalCads,
      email: envio.email.ok ? "enviado" : (envio.email.erro ?? "falhou"),
      imobiliaria: rel.imobNome,
      whatsapp: envio.whatsapp.ok ? "enviado" : (envio.whatsapp.erro ?? "falhou"),
    });
  }

  return NextResponse.json({ data: { dryRun, empreendimento, enviados: resultados.length, resultados } });
}
