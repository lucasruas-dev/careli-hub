import { NextResponse } from "next/server";

import { createApoloAdminClient } from "@/lib/apolo/server";
import { TERMO_DE_ACORDO_LIBERADO } from "@/lib/apolo/termos-liberados";
import { conferirConfiguracao } from "@/lib/assinatura/clicksign/cliente";
import { diarioDoCompromisso } from "@/lib/assinatura/diario-do-envelope-db";
import { authorizeHadesWrite } from "@/lib/guardian/auth";
import {
  createGuardianMotorClient,
  getGuardianCompromissoDetail,
  type GuardianCompromissoDetail,
} from "@/lib/guardian/compromissos";
import { sanitizeHadesDbError } from "@/lib/guardian/db";
import {
  cancelarAssinaturaDoAcordo,
  enviarAcordoParaAssinatura,
  prepararEnvioDoAcordo,
} from "@/lib/hades/acordo/envio-db";
import { motivoParaNaoEnviarParaAssinatura } from "@/lib/hades/acordo/envio-gate";
import { reenviarConvite } from "@/lib/temis/trocar-signatario";

// O TERMO DE ACORDO INDO PARA A ASSINATURA — a porta do Hades.
//
//   GET    ?acordo=…   quem assina, o que impede, e o envelope que já existe (nada é criado).
//   POST   { acordo }  manda para a Clicksign de verdade.
//   PATCH  { acordo, signerId }  reenvia o convite de UMA pessoa.
//   DELETE { acordo }  cancela o envelope na Clicksign, e é isso que libera o reenvio.
//
// ────────────────────────────────────────────────────────────────────────────────────────────
// ⚠️ A REGRA DO LUCAS (20/09/2026): *"o acordo so pode ficar disponivel para envio depois da
// aprovacao"*. E ela mora no SERVIDOR, não no botão.
// ────────────────────────────────────────────────────────────────────────────────────────────
//
// A tela esconde o botão para o acordo que não pode ir (é o que o operador vê), mas esconder botão
// protege a TELA. O que protege a CONTA da Clicksign — que é de produção, onde cada envelope custa e
// o ativado não se apaga — é esta rota recusar: o POST direto, o F5, o duplo clique e a segunda aba
// passam todos por `motivoParaNaoEnviarParaAssinatura`, a MESMA função que apaga o botão. Vale
// igual para o reenvio, que o Lucas pediu na mesma mensagem.
//
// ⚠️ O GET EXISTE PARA QUE NINGUÉM DESCUBRA DEPOIS DE CLICAR. Ele mostra as três partes, a ordem e o
// impedimento ANTES de existir envelope — a mesma razão do GET de `/api/temis/assinatura/enviar`.
// Sem ele, o primeiro clique seria também a primeira conferência.
//
// ⚠️ A CHAVE `TERMO_DE_ACORDO_LIBERADO` FECHA O POST E O PATCH, E NÃO SÓ O BOTÃO. Ela está `false`
// por decisão do Lucas (16/09/2026), e até 20/09/2026 vivia só na tela: com o botão escondido,
// qualquer usuário de ESCRITA do Hades, ou um script com o token dele, chamava este POST e criava um
// envelope REAL na conta de PRODUÇÃO, pago, permanente, com convite por e-mail para o comprador,
// antes de o Lucas ter ligado coisa nenhuma. São os DOIS métodos que mandam e-mail para o cliente.
//
// ⚠️ O GET E O DELETE FICAM DE FORA, e é escolha. O GET não cria nada e é o que a tela usa para
// MOSTRAR o envelope de um acordo que já foi enviado; o DELETE é o gesto corretivo, e trancá-lo
// deixaria um envelope vivo sem como cancelar no dia em que a chave voltasse para `false`.
//
// ⚠️ TODOS OS MÉTODOS USAM `authorizeHadesWrite`, INCLUSIVE O GET. Dois motivos: (1) a resposta do
// GET lista NOME e E-MAIL de comprador e de representante, que é dado de pessoa, e quem não pode
// enviar não precisa da lista; (2) o `viewer` do Hades é somente leitura, e mandar instrumento para
// assinatura é operar a cobrança, não consultá-la. É o mesmo portão da rota do termo.
//
// ⚠️ DOIS CLIENTES DO SUPABASE, E NÃO UM. `createGuardianMotorClient` é o cliente TIPADO do Hades e
// é por ele que o acordo é lido; `createApoloAdminClient` é o cliente do Panteon, que lê a venda
// (`hercules_propostas`), o quadro do empreendimento e escreve em `temis_envelopes`. São os mesmos
// dois que as rotas do Hades e da Têmis já usam, cada um no seu recorte de tipos.

export const dynamic = "force-dynamic";
// pdf-lib + mysql2 não rodam no edge.
export const runtime = "nodejs";
// ⚠️ 120s, O MESMO DA ROTA DE CONTRATO. O envio são até 14 chamadas HTTP (1 envelope + 1 upload +
// 2 por signatário + ativar + notificar) e o upload leva o PDF inteiro em base64, depois de montar
// o papel com uma leitura do C2X. No teto padrão da Vercel isso chega na tela como "Unexpected
// token" de JSON em vez de uma frase ([[reference_vercel_timeout_vira_erro_de_json]]).
export const maxDuration = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A porta trancada enquanto o Lucas não liga o termo. `null` quando está liberado.
 *
 * ⚠️ 503 E NÃO 404. 404 diria "esta rota não existe", e ela existe: quem chamar precisa entender que
 * o caminho está fechado por decisão, não por engano de endereço, e que não adianta tentar de novo.
 */
function portaFechada(): null | NextResponse {
  if (TERMO_DE_ACORDO_LIBERADO) return null;
  return erro(
    "O envio do termo de acordo para assinatura ainda não está liberado. Nada foi mandado para a Clicksign.",
    503,
  );
}

export async function GET(request: Request) {
  const auth = await authorizeHadesWrite(request);
  if (!auth.ok) return auth.response;

  const compromissoId = (new URL(request.url).searchParams.get("acordo") ?? "").trim();
  if (!UUID.test(compromissoId)) return erro("Acordo não informado.", 400);

  return comOAcordo(compromissoId, async (acordo, sb) => {
    const preparo = await prepararEnvioDoAcordo(sb, acordo);
    if (!preparo.ok) return erro(preparo.erro, preparo.status);

    // ⚠️ O DIÁRIO É ENFEITE, E POR ISSO NUNCA DERRUBA A RESPOSTA. Ele explica POR QUE o termo está
    // parado (quem assinou, de quantos, convite devolvido); sem ele a tela ainda mostra o envelope
    // e o botão. E ele é o MESMO cálculo do card da Têmis — `diarioDoCompromisso` e
    // `diarioDaProposta` são duas cascas sobre um miolo só, que é o que impede a contagem de
    // divergir entre as duas telas ([[reference_painel_assinatura_duas_telas]]).
    const diario = preparo.envelope
      ? await diarioDoCompromisso(sb, acordo.id).catch((falha: unknown) => {
          console.error("[guardian][termo-de-acordo][assinatura] diário falhou", falha);
          return null;
        })
      : null;

    return NextResponse.json(
      {
        data: {
          assinatura: diario,
          envelope: preparo.envelope,
          impedimento: preparo.impedimento,
          signatarios: preparo.signatarios.map((s) => ({
            email: s.email,
            nome: s.nome,
            ordem: s.ordem,
            papel: s.papel,
          })),
        },
      },
      // ⚠️ `no-store`: a resposta lista nome e e-mail de pessoa.
      { headers: { "Cache-Control": "no-store" }, status: 200 },
    );
  });
}

export async function POST(request: Request) {
  const auth = await authorizeHadesWrite(request);
  if (!auth.ok) return auth.response;

  const fechada = portaFechada();
  if (fechada) return fechada;

  const corpo = await lerCorpo(request);
  if (!UUID.test(corpo.acordo)) return erro("Acordo não informado.", 400);

  // ⚠️ SEM CHAVE, NEM COMEÇA. `chamar` recusaria também, mas só na primeira chamada — e a essa
  // altura a linha de registro já teria nascido. A causa mais provável é a armadilha do "Sensitive"
  // da Vercel: a variável existe no painel e chega VAZIA na função, sem erro nenhum
  // ([[reference_vercel_env_sensitive]]).
  const chaves = conferirConfiguracao();
  const semChave = chaves.faltando.filter((nome) => nome !== "CLICKSIGN_WEBHOOK_SECRET");
  if (semChave.length > 0) {
    return erro(
      `A Clicksign não está configurada: falta ${semChave.join(", ")}. ` +
        "⚠️ Confira se as variáveis não estão marcadas como 'Sensitive' na Vercel, porque assim elas chegam vazias, sem erro.",
      503,
    );
  }

  return comOAcordo(corpo.acordo, async (acordo, sb) => {
    const enviado = await enviarAcordoParaAssinatura(sb, acordo, {
      usuarioId: auth.user.id,
      usuarioNome: auth.user.displayName ?? auth.user.email ?? null,
    });

    if (!enviado.ok) {
      return NextResponse.json(
        { envelopeAtivo: enviado.envelopeAtivo ?? false, error: enviado.erro },
        { headers: { "Cache-Control": "no-store" }, status: enviado.status },
      );
    }

    // Quem mandou, qual acordo — sem dado do cliente no log.
    console.info("[guardian][termo-de-acordo][assinatura] enviado", {
      acordo: acordo.protocol,
      envelope: enviado.envelopeId,
      por: auth.user.displayName ?? auth.user.email ?? auth.user.id,
    });

    // ⚠️ O `aviso` SOBE JUNTO COM O 200. Ele existe para um desfecho só: o envelope foi criado,
    // ativado e notificado, e o Panteon NÃO conseguiu registrar isso. Responder 200 limpo aí faria a
    // tela recarregar, não mostrar envelope nenhum, e o operador clicar de novo em cima de um
    // envelope pago que já está na caixa de entrada do cliente.
    return NextResponse.json(
      {
        data: {
          ...(enviado.aviso ? { aviso: enviado.aviso } : {}),
          envelopeId: enviado.envelopeId,
          nome: enviado.nome,
          registroId: enviado.registroId,
        },
      },
      { headers: { "Cache-Control": "no-store" }, status: 200 },
    );
  });
}

/**
 * REENVIA O CONVITE de uma pessoa — o botão que o Lucas pediu em 12/09/2026 (*"ocorre muito do
 * e-mail esta correto mais o cliente nao recebeu, ae teria que ter um botao para reenviar"*).
 *
 * ⚠️ NÃO MEXE NO ENVELOPE: nada é criado, nada é removido, e nenhum envelope novo nasce. É o mesmo
 * convite, para o mesmo endereço. Por isso ele NÃO passa pela guarda do envelope vivo (que existe
 * para impedir um SEGUNDO envelope) — mas passa pelo gate do Lucas, porque um acordo reprovado
 * depois do envio não deve continuar sendo cobrado por e-mail.
 */
export async function PATCH(request: Request) {
  const auth = await authorizeHadesWrite(request);
  if (!auth.ok) return auth.response;

  // ⚠️ O REENVIO TAMBÉM MANDA E-MAIL PARA O CLIENTE, e por isso passa pela mesma chave do POST.
  const fechada = portaFechada();
  if (fechada) return fechada;

  const corpo = await lerCorpo(request);
  if (!UUID.test(corpo.acordo)) return erro("Acordo não informado.", 400);
  if (!corpo.signerId) return erro("Sem o signatário não dá para reenviar o convite.", 400);

  return comOAcordo(corpo.acordo, async (acordo, sb) => {
    // ⚠️ O GATE DO LUCAS VALE PARA O REENVIO, E ELE É CHAMADO DIRETO AQUI. Lucas, 20/09/2026: a
    // régua vale *"tambem para reenvio"*. Não dá para usar o `impedimento` do preparo no lugar
    // dele: aquele campo carrega também a guarda do envelope vivo, que aqui está SEMPRE acesa (o
    // reenvio só existe porque há envelope) e recusaria todo convite. O que o reenvio precisa
    // perguntar é só isto: este acordo ainda está aprovado? Um acordo reprovado depois do envio não
    // pode continuar sendo cobrado por e-mail em nome da Careli.
    const doGate = motivoParaNaoEnviarParaAssinatura(acordo);
    if (doGate) return erro(doGate, 409);

    const preparo = await prepararEnvioDoAcordo(sb, acordo);
    if (!preparo.ok) return erro(preparo.erro, preparo.status);

    const envelopeId = preparo.envelope?.envelopeId;
    if (!envelopeId) return erro("Este acordo não tem envelope na Clicksign.", 404);

    const reenviado = await reenviarConvite(sb, { envelopeId, signerId: corpo.signerId });
    if (!reenviado.ok) return erro(reenviado.erro, reenviado.status);

    return NextResponse.json(
      { data: { ok: true } },
      { headers: { "Cache-Control": "no-store" }, status: 200 },
    );
  });
}

export async function DELETE(request: Request) {
  const auth = await authorizeHadesWrite(request);
  if (!auth.ok) return auth.response;

  const corpo = await lerCorpo(request);
  if (!UUID.test(corpo.acordo)) return erro("Acordo não informado.", 400);

  return comOAcordo(corpo.acordo, async (acordo, sb) => {
    const cancelado = await cancelarAssinaturaDoAcordo(sb, acordo, {
      motivo: corpo.motivo,
      usuarioNome: auth.user.displayName ?? auth.user.email ?? null,
    });
    if (!cancelado.ok) return erro(cancelado.erro, cancelado.status);

    console.info("[guardian][termo-de-acordo][assinatura] cancelado", {
      acordo: acordo.protocol,
      envelope: cancelado.envelopeId,
      por: auth.user.displayName ?? auth.user.email ?? auth.user.id,
    });

    return NextResponse.json(
      { data: { envelopeId: cancelado.envelopeId } },
      { headers: { "Cache-Control": "no-store" }, status: 200 },
    );
  });
}

// ── O QUE OS QUATRO MÉTODOS COMPARTILHAM ────────────────────────────────────

type Corpo = { acordo: string; motivo?: string; signerId: string };

async function lerCorpo(request: Request): Promise<Corpo> {
  const cru = (await request.json().catch(() => ({}))) as {
    acordo?: unknown;
    compromissoId?: unknown;
    motivo?: unknown;
    signerId?: unknown;
  };
  // `compromissoId` é o nome que a rota do termo já usa; os dois valem, para a tela não ter de
  // lembrar qual é qual.
  const acordo = typeof cru.acordo === "string" ? cru.acordo : cru.compromissoId;

  return {
    acordo: typeof acordo === "string" ? acordo.trim() : "",
    ...(typeof cru.motivo === "string" && cru.motivo.trim() ? { motivo: cru.motivo.trim() } : {}),
    signerId: typeof cru.signerId === "string" ? cru.signerId.trim() : "",
  };
}

/** Abre os dois clientes, acha o acordo e entrega os dois para quem faz o trabalho. */
async function comOAcordo(
  compromissoId: string,
  trabalho: (
    acordo: GuardianCompromissoDetail,
    sb: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  ) => Promise<NextResponse>,
): Promise<NextResponse> {
  const motor = createGuardianMotorClient();
  const sb = createApoloAdminClient();
  if (!motor || !sb) return erro("Supabase indisponível.", 503);

  try {
    const acordo = await getGuardianCompromissoDetail(motor, compromissoId);
    if (!acordo) return erro("Acordo não encontrado.", 404);

    return await trabalho(acordo, sb);
  } catch (falha) {
    console.error(
      "[guardian][termo-de-acordo][assinatura] falha",
      sanitizeHadesDbError(falha),
    );
    return erro(
      "Não foi possível falar com a assinatura agora. Confira na Clicksign antes de tentar de novo.",
      500,
    );
  }
}

function erro(mensagem: string, status: number) {
  return NextResponse.json({ error: mensagem }, { headers: { "Cache-Control": "no-store" }, status });
}
