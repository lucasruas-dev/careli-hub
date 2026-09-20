import { NextResponse } from "next/server";

import { authorizeHadesWrite } from "@/lib/guardian/auth";
import {
  createGuardianMotorClient,
  getGuardianCompromissoDetail,
} from "@/lib/guardian/compromissos";
import { sanitizeHadesDbError } from "@/lib/guardian/db";
import { montarTermoDoAcordoEmPdf } from "@/lib/hades/acordo/termo-em-pdf";
import { motivoParaNaoEmitirOTermo } from "@/lib/hades/dossie/termo-de-acordo-gate";

// O TERMO DE ACORDO — o "Instrumento particular de acordo para regularização de inadimplência" de
// um acordo do Hades, em PDF, para o operador baixar e mandar para assinatura.
//
// Esta rota só BUSCA e ENTREGA. O que sai no papel é decidido em dois lugares puros e testados:
// `termo-de-acordo-gate.ts` (quando pode sair, e a frase quando não pode — a mesma que o botão da
// tela mostra) e `termo-de-acordo-dados.ts` (de onde sai cada número, e a recusa quando o C2X não
// confirma mais o débito que foi negociado).
//
// ⚠️ POST E `authorizeHadesWrite`, E NÃO GET E `Read`. Dois motivos, os mesmos do dossiê jurídico
// (`app/api/guardian/dossie/route.ts`): (1) é o único portão que entrega o NOME de quem está logado, e
// o termo é um documento que sai em nome da Careli para assinatura do cliente — quem emitiu fica
// no log; (2) o `viewer` do Hades é somente leitura, e emitir instrumento para assinatura é operar a
// cobrança, não consultá-la.
//
// ⚠️ O GATE RODA ANTES DO C2X. Medido em 20/09/2026 no Supabase de produção (`kind = 'acordo'`):
// 40 acordos, 18 APROVADOS e 22 reprovados, zero pendentes — ou seja, 22 cliques que o gate responde
// sozinho. Se a consulta ao legado viesse primeiro, cada um deles abriria uma conexão no MySQL do
// C2X — que tem teto de conexões e já derrubou a fila com "Too many connections" — só para responder
// a frase que o próprio card já sabia.
//
// ⚠️ A MONTAGEM DO PAPEL MORA EM `lib/hades/acordo/termo-em-pdf.ts`, E NÃO AQUI. Desde 20/09/2026
// são DOIS caminhos para o mesmo documento: este download e o envio para a Clicksign
// (`app/api/guardian/termo-de-acordo/assinatura/route.ts`). Duas montagens divergiriam no primeiro
// ajuste, e a divergência seria o cliente assinando um PDF diferente do que o operador baixou.
//
// ⚠️ NÃO TOCA EM `hercules_premissas_de_rescisao`. As alíquotas de rescisão são do relatório de
// rescisão; o termo de acordo não deduz nada, só formaliza o parcelamento que o acordo já decidiu.

export const dynamic = "force-dynamic";
// pdf-lib + mysql2 não rodam no edge.
export const runtime = "nodejs";
// Sem isto a rota cai no teto padrão da Vercel, e o timeout chega na tela como "Unexpected token"
// de JSON em vez de uma frase. A leitura do cliente no C2X é a mesma da ficha, com retry.
export const maxDuration = 30;

type Corpo = { compromissoId?: unknown };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const auth = await authorizeHadesWrite(request);
  if (!auth.ok) return auth.response;

  let corpo: Corpo;
  try {
    corpo = (await request.json()) as Corpo;
  } catch {
    return erro("Corpo inválido.", 400);
  }

  const compromissoId = typeof corpo.compromissoId === "string" ? corpo.compromissoId.trim() : "";
  if (!UUID.test(compromissoId)) {
    return erro("Acordo não informado.", 400);
  }

  const motor = createGuardianMotorClient();
  if (!motor) {
    return erro("Supabase indisponível.", 503);
  }

  try {
    const acordo = await getGuardianCompromissoDetail(motor, compromissoId);
    if (!acordo) {
      return erro("Acordo não encontrado.", 404);
    }

    const motivo = motivoParaNaoEmitirOTermo(acordo);
    if (motivo) {
      return erro(motivo, 409);
    }

    const termo = await montarTermoDoAcordoEmPdf(acordo);
    if (!termo.ok) {
      return erro(termo.motivo, termo.status);
    }

    const { bytes, nome } = termo;

    // Quem emitiu, qual acordo — sem dado do cliente no log.
    console.info("[guardian][termo-de-acordo] emitido", {
      acordo: acordo.protocol,
      por: auth.user.displayName ?? auth.user.email ?? auth.user.id,
    });

    return new Response(new Uint8Array(bytes), {
      headers: {
        "Cache-Control": "no-store",
        // `nomeDoArquivoDoTermoDeAcordo` já tira os acentos; o `filename*` é o que os navegadores
        // atuais leem, e o `filename` simples fica para quem só entende ele.
        "Content-Disposition": `attachment; filename="${asciiSeguro(nome)}"; filename*=UTF-8''${encodeURIComponent(nome)}`,
        "Content-Type": "application/pdf",
      },
      status: 200,
    });
  } catch (falha) {
    console.error("[guardian][termo-de-acordo] falha ao gerar", sanitizeHadesDbError(falha));
    return erro("Não foi possível gerar o termo de acordo agora. Tente de novo em instantes.", 500);
  }
}

function erro(mensagem: string, status: number) {
  return NextResponse.json({ error: mensagem }, { headers: { "Cache-Control": "no-store" }, status });
}

function asciiSeguro(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/"/g, "");
}
