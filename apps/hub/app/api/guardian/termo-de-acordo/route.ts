import { NextResponse } from "next/server";

import { loadHadesAttendanceClient } from "@/lib/guardian/attendance";
import { authorizeHadesWrite } from "@/lib/guardian/auth";
import {
  createGuardianMotorClient,
  getGuardianCompromissoDetail,
} from "@/lib/guardian/compromissos";
import { sanitizeHadesDbError } from "@/lib/guardian/db";
import {
  hojeEmBrasilia,
  montarDadosDoTermoDeAcordo,
} from "@/lib/hades/dossie/termo-de-acordo-dados";
import { motivoParaNaoEmitirOTermo } from "@/lib/hades/dossie/termo-de-acordo-gate";
import {
  montarTermoDeAcordoPdf,
  nomeDoArquivoDoTermoDeAcordo,
} from "@/lib/hades/dossie/termo-de-acordo-pdf";

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
// ⚠️ O GATE RODA ANTES DO C2X. Hoje (medido em 16/09/2026) ZERO dos 18 acordos está aprovado; se a
// consulta ao legado viesse primeiro, cada clique num acordo pendente abriria uma conexão no MySQL
// do C2X — que tem teto de conexões e já derrubou a fila com "Too many connections" — só para
// responder a frase que o próprio card já sabia.
//
// ⚠️ A QUALIFICAÇÃO E AS PARCELAS VÊM DE `loadHadesAttendanceClient`, A MESMA LEITURA DA FICHA DO
// HADES (`app/api/guardian/attendance/client/[clientId]/route.ts`). Nome, CPF, nacionalidade,
// estado civil, profissão e endereço do termo são, letra por letra, os que o operador vê na tela
// antes de clicar. Uma segunda consulta ao C2X com outros joins e outra formatação faria o papel
// discordar da tela no dia em que um dos dois mudasse.
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

    // ⚠️ `client_c2x_id` É O `users.id` DO C2X, e não o id da negociação — os dois espaços de id
    // colidem (o 2508 existe nas duas tabelas). O prefixo `c2x-client-` diz ao leitor qual é qual.
    const cliente = await loadHadesAttendanceClient(`c2x-client-${acordo.clientC2xId}`);
    if (!cliente) {
      return erro("O cliente deste acordo não foi encontrado no C2X.", 404);
    }

    const montado = montarDadosDoTermoDeAcordo({
      acordo,
      cliente,
      emitidoEm: hojeEmBrasilia(),
    });
    if (!montado.ok) {
      return erro(montado.motivo, montado.status);
    }

    const bytes = await montarTermoDeAcordoPdf(montado.dados);
    const nome = nomeDoArquivoDoTermoDeAcordo(montado.dados);

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
