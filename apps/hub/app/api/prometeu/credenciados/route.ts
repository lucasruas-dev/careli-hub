import { after, NextResponse } from "next/server";

import { authorizePrometeuWrite } from "@/lib/prometeu/auth";
import {
  autorizarEscritaDoHubOuDoCoordenador,
  eventoNoEscopo,
  respostaForaDoEscopo,
} from "@/lib/prometeu/operador-server";
import { enviarBoasVindasDoCheckIn } from "@/lib/prometeu/boas-vindas-disparo";
import { enviarChamadoPorWhatsApp } from "@/lib/prometeu/chamado-disparo";
import {
  adicionarCredenciado,
  ajustarOrdem,
  chamarCredenciado,
  createPrometeuClient,
  getEvento,
  bipDaSecretaria,
  bipDoSalao,
  excluirCredenciado,
  fazerCheckIn,
  liberarMesa,
  marcarEmAtendimento,
  marcarEtiquetaImpressa,
  marcarNoShow,
  moverEtapa,
  registrarPagamento,
  reservarUnidade,
} from "@/lib/prometeu/data";
import {
  autorizarEscritaComCoordenador,
  autorizarOperacaoComCoordenador,
} from "@/lib/prometeu/operador-server";
import { avisarFilaEmRealtime } from "@/lib/prometeu/realtime-fila";
import { PROMETEU_ETAPAS, type PrometeuEtapa } from "@/lib/prometeu/types";

// POST  = poe alguem no evento.
// PATCH = age sobre quem ja esta: mover de etapa, confirmar PIX, marcar etiqueta impressa.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A tarefa after() da boas-vindas roda depois da resposta, dentro do lifecycle da função — teto
// generoso pra ela não ser cortada se a Meta demorar.
export const maxDuration = 60;

type ClienteDoPrometeu = NonNullable<ReturnType<typeof createPrometeuClient>>;

/**
 * O credenciado do ato está num lançamento que esta autorização enxerga?
 *
 * ⚠️ VALE PARA TODO RAMO DO PATCH, inclusive os que respondem cedo (checkin, os dois bips, no-show
 * e chamar-do-salao). Na revisão de 02/09/2026 esses cinco aceitavam o coordenador e devolviam
 * ANTES da conferência de escopo que só existia lá embaixo: o coordenador com vínculo no 40
 * chamava (com WhatsApp real) o cliente do lançamento do 35. O evento sai da LINHA do credenciado
 * (é ele quem está sendo movido), não do corpo — o corpo só decide no "liberar" puro, sem pessoa.
 * Sem `escopo` (hub ou operador do posto) não há recorte e a resposta é sempre true.
 */
async function credenciadoNoEscopo(
  client: ClienteDoPrometeu,
  auth: { escopo?: string[] },
  credenciadoId: string,
  eventoIdDoCorpo: string | undefined,
): Promise<boolean> {
  if (!auth.escopo) return true;

  let eventoId = eventoIdDoCorpo ?? "";
  if (credenciadoId) {
    const { data: pessoa } = await client
      .from("prometeu_credenciados")
      .select("evento_id")
      .eq("id", credenciadoId)
      .maybeSingle<{ evento_id: string }>();
    eventoId = pessoa?.evento_id ?? eventoId;
  }
  const eventoDoAto = eventoId ? await getEvento(client, eventoId) : null;
  if (!eventoDoAto) return false;
  return eventoNoEscopo(auth, eventoDoAto);
}

export async function POST(request: Request) {
  const auth = await authorizePrometeuWrite(request);
  if (!auth.ok) return auth.response;

  const client = createPrometeuClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    corretor?: string;
    documento?: string;
    entityId?: string;
    eventoId?: string;
    imobiliaria?: string;
    nome?: string;
    origem?: string;
    origemRef?: string;
    pagoEm?: string;
  };

  if (!body.eventoId) {
    return NextResponse.json({ error: "Informe o eventoId." }, { status: 400 });
  }

  // Unidades (quadra/lote) NAO entram aqui: sao reserva feita no salao, durante o evento.
  const { credenciadoId, error } = await adicionarCredenciado({
    client,
    corretor: body.corretor ?? null,
    documento: body.documento ?? null,
    entityId: body.entityId ?? null,
    eventoId: body.eventoId,
    imobiliaria: body.imobiliaria ?? null,
    nome: body.nome ?? "",
    origem: body.origem ?? "manual",
    origemRef: body.origemRef ?? null,
    pagoEm: body.pagoEm ?? null,
  });

  if (error) return NextResponse.json({ error }, { status: 400 });
  return NextResponse.json({ data: { credenciadoId } });
}

export async function PATCH(request: Request) {
  const client = createPrometeuClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    acao?:
      | "mover"
      | "pagamento"
      | "etiqueta"
      | "bip-salao"
      | "no-show"
      | "excluir"
      | "chamar-do-salao"
      | "bip-secretaria"
      | "checkin"
      | "ordem"
      | "chamar"
      | "atender"
      | "liberar"
      | "reservar-unidade";
    credenciadoId?: string;
    etapa?: string;
    eventoId?: string;
    // Unidade que o cliente pegou no salão (ação "reservar-unidade").
    lote?: string;
    mesaId?: string;
    moverPara?: string;
    motivo?: string;
    ordemAnterior?: number | null;
    ordemSeguinte?: number | null;
    pagoEm?: string;
    quadra?: string;
    zona?: string;
  };

  // TODAS as ações do PATCH agem sobre uma pessoa: exigem o credenciadoId. (O "liberar" também o
  // recebe — a tela manda o cliente da mesa junto, mesmo quando só solta a mesa.) Foi o que faltava
  // no Finalizar/Direcionar/Não veio: iam sem credenciadoId, tomavam 400 aqui e a mesa ficava presa.
  //
  // EXCEÇÃO: o "liberar" puro (botão Liberar mesa, o escape universal) pode vir sem credenciado —
  // uma mesa órfã pode estar exatamente no estado em que ninguém sabe mais quem era o cliente, e
  // exigir o id aqui deixaria o único botão de socorro inútil no pior momento.
  if (!body.credenciadoId && body.acao !== "liberar") {
    return NextResponse.json({ error: "Informe o credenciadoId." }, { status: 400 });
  }
  // Estreitado para as ações abaixo: vazio só é alcançável no "liberar" puro, que trata isso.
  const credenciadoId: string = body.credenciadoId ?? "";

  // CHECK-IN (leitura do QR na recepcao): aceita o OPERADOR do evento (cookie proprio) OU um
  // usuario do hub. O organizador que fica na porta toca a recepcao e nao e' usuario do hub —
  // precisa poder bipar. Grava se estava dentro da janela NAQUELE instante. Fica ANTES da
  // autorizacao de escrita do hub porque e' a UNICA acao que o operador pode disparar.
  if (body.acao === "checkin") {
    const auth = await autorizarOperacaoComCoordenador(request);
    if (!auth.ok) return auth.response;

    if (!body.eventoId) {
      return NextResponse.json({ error: "Informe o eventoId." }, { status: 400 });
    }
    // `fazerCheckIn` só confere credenciado × eventoId, não o recorte do coordenador.
    if (!(await credenciadoNoEscopo(client, auth, credenciadoId, body.eventoId))) {
      return respostaForaDoEscopo();
    }

    const { error, naJanela, ok } = await fazerCheckIn({
      client,
      credenciadoId,
      eventoId: body.eventoId,
    });

    if (!ok) return NextResponse.json({ error }, { status: 400 });

    // BOAS-VINDAS no WhatsApp, FORA do caminho crítico. `after` roda a tarefa DEPOIS de a resposta
    // sair (o organizador na porta não espera a Meta responder), e o runtime garante a execução —
    // uma promise solta seria cortada em serverless. best-effort: a função nunca lança.
    // Capturamos o eventoId numa const (já validado acima) porque a closure do after perde o
    // narrowing; o credenciadoId já vem estreitado do topo do handler.
    const eventoId = body.eventoId;
    after(async () => {
      await enviarBoasVindasDoCheckIn({ client, credenciadoId, eventoId });
    });

    return NextResponse.json({ data: { naJanela, ok: true } });
  }

  // OS OUTROS DOIS BIPS DO TRILHO FISICO (salao e secretaria). Ficam aqui em cima, junto do
  // check-in, porque quem bipa e' o organizador de posto — no dia, freela com cookie proprio e
  // sem login do hub. O que autoriza a mudanca de etapa e' o QR na mao da pessoa, nao a escolha
  // de quem opera: por isso nao passam pelo gate de escrita do hub, mas TAMBEM nao aceitam
  // etapa arbitraria (cada uma so' move pro seu destino).
  if (body.acao === "bip-salao" || body.acao === "bip-secretaria") {
    const auth = await autorizarOperacaoComCoordenador(request);
    if (!auth.ok) return auth.response;

    if (!body.eventoId) {
      return NextResponse.json({ error: "Informe o eventoId." }, { status: 400 });
    }
    if (!(await credenciadoNoEscopo(client, auth, credenciadoId, body.eventoId))) {
      return respostaForaDoEscopo();
    }

    const entrada = {
      client,
      credenciadoId,
      eventoId: body.eventoId,
    };
    const resultado =
      body.acao === "bip-salao"
        ? await bipDoSalao(entrada)
        : await bipDaSecretaria(entrada);

    if (!resultado.ok) {
      // 409 quando a REGRA recusou (nao foi chamado): a tela trata diferente de erro tecnico.
      return NextResponse.json(
        { credenciado: resultado.credenciado ?? null, error: resultado.error },
        { status: resultado.recusadoPelaRegra ? 409 : 400 },
      );
    }

    return NextResponse.json({
      data: { credenciado: resultado.credenciado ?? null, ok: true },
    });
  }

  // NO-SHOW: chamou, rechamou, ninguem apareceu. Sem isso o chamado fica PRESO no painel de
  // transito pra sempre, porque so o bip do QR o fecha — e quem nao veio nao tem QR pra bipar.
  // Aberto ao operador: e ele quem esta na porta vendo que a pessoa nao chegou.
  if (body.acao === "no-show") {
    const auth = await autorizarOperacaoComCoordenador(request);
    if (!auth.ok) return auth.response;
    // `marcarNoShow` nem recebe eventoId: o recorte só se prova pela linha do credenciado.
    if (!(await credenciadoNoEscopo(client, auth, credenciadoId, body.eventoId))) {
      return respostaForaDoEscopo();
    }

    const { error, ok } = await marcarNoShow({
      client,
      credenciadoId,
      // Posto que marcou (salao/recepcao/secretaria): guarda a ORIGEM pra cada tela listar so' o seu.
      zona: body.zona ?? null,
    });

    if (!ok) return NextResponse.json({ error }, { status: 400 });
    return NextResponse.json({ data: { ok: true } });
  }

  // CHAMAR DO SALAO — versao restrita da acao "chamar", aberta ao operador do evento.
  // O organizador do salao trabalha com a FILA na tela: ele chama o proximo e so' depois bipa o
  // QR pra confirmar que foi essa pessoa que apareceu. Sem isso ele nao consegue chamar
  // ninguem, porque `chamar` normal exige login do hub.
  // A trava: zona FIXA em "salao" e SEM mesa e SEM mover etapa — quem move e' o bip. Assim o
  // operador nao consegue chamar pra mesa da secretaria nem empurrar alguem de etapa por aqui.
  if (body.acao === "chamar-do-salao") {
    const auth = await autorizarOperacaoComCoordenador(request);
    if (!auth.ok) return auth.response;

    if (!body.eventoId) {
      return NextResponse.json({ error: "Informe o eventoId." }, { status: 400 });
    }
    // Este ramo dispara WhatsApp REAL ao cliente: fora do recorte, nem chega ao `chamar`.
    if (!(await credenciadoNoEscopo(client, auth, credenciadoId, body.eventoId))) {
      return respostaForaDoEscopo();
    }

    const { error, ok } = await chamarCredenciado({
      client,
      credenciadoId,
      eventoId: body.eventoId,
      mesaId: null,
      moverPara: null,
      zona: "salao",
    });

    if (!ok) return NextResponse.json({ error }, { status: 400 });
    // Avisa os celulares da fila em tempo real + reforço por WhatsApp (best-effort, fora do caminho
    // crítico). Chamada do salão => zona sempre "salao".
    const eventoDoSalao = body.eventoId;
    const chamadoDoSalao = body.credenciadoId;
    after(async () => {
      await avisarFilaEmRealtime(eventoDoSalao, chamadoDoSalao);
      if (chamadoDoSalao) {
        const envio = await enviarChamadoPorWhatsApp({
          client,
          credenciadoId: chamadoDoSalao,
          eventoId: eventoDoSalao,
          zona: "salao",
        });
        // Falha de WhatsApp era 100% invisível (resultado jogado fora): se a Meta recusar
        // (billing, template pausado), pelo menos os logs da Vercel contam.
        if (!envio.enviado) {
          console.error("[prometeu] chamado WhatsApp NÃO saiu:", chamadoDoSalao, envio.motivo);
        }
      }
    });
    return NextResponse.json({ data: { ok: true } });
  }

  // AS TRES ACOES DA MESA (chamar / atender / liberar) sao o TRABALHO do atendente da secretaria:
  // ele chama o proximo, marca que sentou e libera a mesa no fim. Quem faz isso no dia e' o freela
  // logado com a conta PROPRIA do evento (nao tem usuario do hub), entao elas aceitam as duas
  // identidades. As demais (mover, pagamento, ordem, etiqueta, excluir) mexem na FILA ou desfazem
  // coisas e seguem restritas ao hub — o operador de posto nao fura fila nem tira ninguem do evento.
  const ehAcaoDaMesa =
    body.acao === "chamar" || body.acao === "atender" || body.acao === "liberar";

  // Na via do HUB continua valendo o papel de escrita (viewer NAO opera mesa); na via do EVENTO
  // vale o cookie assinado do operador. Ver autorizarOperacaoDeEscrita.
  // ⚠️ O COORDENADOR DO PORTAL COMERCIAL ENTRA NAS DUAS PORTAS — ele é gente da Careli, e no dia
  // do lançamento comanda a fila como o time interno. O que ele NÃO faz é sair do próprio recorte:
  // o evento da pessoa tem que ser de um empreendimento dele (ver `credenciadoNoEscopo`).
  const autorizacao = ehAcaoDaMesa
    ? await autorizarEscritaComCoordenador(request)
    : await autorizarEscritaDoHubOuDoCoordenador(request);
  if (!autorizacao.ok) return autorizacao.response;

  // O evento vem do credenciado (é ele quem está sendo movido); no "liberar" puro, do corpo.
  if (!(await credenciadoNoEscopo(client, autorizacao, credenciadoId, body.eventoId))) {
    return respostaForaDoEscopo();
  }

  // Quem assinou o ato: o usuario do hub, ou o operador do evento (auditoria da chamada).
  const auth = {
    userId:
      "userId" in autorizacao && autorizacao.userId
        ? autorizacao.userId
        : ("operadorId" in autorizacao ? (autorizacao.operadorId ?? null) : null),
  };

  // ⚠️ QUEM ENTROU PELO EVENTO (freela, sem conta do hub) NAO EMPURRA ETAPA A DEDO.
  //
  // `liberar` aceita `etapa` e `chamar` aceita `moverPara` — os dois caem em moverEtapa. Sem esta
  // trava, um operador de posto faria pela porta da mesa exatamente o que a acao `mover` (restrita
  // ao hub, logo abaixo) proibe: carimbar qualquer um dos credenciados como concluido/cancelado.
  // A tela do atendente so' move ALGUEM QUE ESTA NA MESA DELE, entao exigimos isso: a mesa
  // informada tem que estar de fato ocupada por aquele credenciado. Nao bate -> a mesa e' liberada
  // (o trabalho da mesa continua), mas a etapa NAO se move.
  const veioDoEvento =
    ehAcaoDaMesa && "operadorId" in autorizacao && Boolean(autorizacao.operadorId);
  if (veioDoEvento && (body.etapa || body.moverPara) && body.credenciadoId) {
    const { data: mesaDoAto } = await client
      .from("prometeu_mesas")
      .select("credenciado_id")
      .eq("id", body.mesaId ?? "")
      .maybeSingle<{ credenciado_id: string | null }>();

    if (mesaDoAto?.credenciado_id !== body.credenciadoId) {
      body.etapa = undefined;
      body.moverPara = undefined;
    }
  }

  // EXCLUIR (o "No-show" definitivo da aba Aguardando retorno): carimba `encerrado_em` e a pessoa
  // sai de TODAS as telas de operacao. Diferente do "no-show" acima — aquele e' recuperavel e o
  // organizador de posto pode marcar; este TIRA DE VEZ, entao fica atras do login do hub.
  if (body.acao === "excluir") {
    const { error, ok } = await excluirCredenciado({
      client,
      credenciadoId,
      motivo: body.motivo ?? null,
    });

    if (!ok) return NextResponse.json({ error }, { status: 400 });
    return NextResponse.json({ data: { ok: true } });
  }

  if (body.acao === "mover") {
    const etapa = body.etapa ?? "";
    if (!PROMETEU_ETAPAS.some((e) => e.id === etapa)) {
      return NextResponse.json({ error: "Etapa invalida." }, { status: 400 });
    }

    const { error, ok } = await moverEtapa({
      client,
      credenciadoId,
      motivo: body.motivo ?? null,
      para: etapa as PrometeuEtapa,
      por: auth.userId,
    });

    if (!ok) return NextResponse.json({ error }, { status: 400 });
    return NextResponse.json({ data: { ok: true } });
  }

  // O atendente registra a unidade que o cliente pegou. Grava em `prometeu_unidades` e move a
  // ficha para `reserva` — as duas coisas juntas, porque registrar a unidade É a reserva.
  if (body.acao === "reservar-unidade") {
    // `body.eventoId` já foi exigido lá em cima (400 quando falta), mas o TypeScript não carrega
    // essa garantia até aqui — o fallback deixa o contrato explícito.
    const { codigo, error, ok } = await reservarUnidade({
      client,
      credenciadoId,
      eventoId: body.eventoId ?? "",
      lote: body.lote ?? "",
      por: auth.userId,
      quadra: body.quadra ?? "",
    });

    if (!ok) return NextResponse.json({ error }, { status: 400 });
    return NextResponse.json({ data: { codigo, ok: true } });
  }

  if (body.acao === "pagamento") {
    const { error, ok } = await registrarPagamento({
      client,
      credenciadoId,
      pagoEm: body.pagoEm,
    });

    if (!ok) return NextResponse.json({ error }, { status: 400 });
    return NextResponse.json({ data: { ok: true } });
  }

  // Admin furando a fila: exige motivo e fica auditado.
  if (body.acao === "ordem") {
    const { error, ok, ordem } = await ajustarOrdem({
      client,
      credenciadoId,
      motivo: body.motivo ?? "",
      ordemAnterior: body.ordemAnterior ?? null,
      ordemSeguinte: body.ordemSeguinte ?? null,
      por: auth.userId,
    });

    if (!ok) return NextResponse.json({ error }, { status: 400 });
    return NextResponse.json({ data: { ok: true, ordem } });
  }

  if (body.acao === "etiqueta") {
    await marcarEtiquetaImpressa(client, credenciadoId);
    return NextResponse.json({ data: { ok: true } });
  }

  // CHAMAR o cliente: para uma MESA (secretaria) ou para uma ZONA (salao, sem mesa fixa).
  if (body.acao === "chamar") {
    if (!body.eventoId || (!body.mesaId && !body.zona)) {
      return NextResponse.json(
        { error: "Chamar exige eventoId e (mesaId ou zona)." },
        { status: 400 },
      );
    }
    const moverPara =
      body.moverPara && PROMETEU_ETAPAS.some((e) => e.id === body.moverPara)
        ? (body.moverPara as PrometeuEtapa)
        : null;
    const { error, ok } = await chamarCredenciado({
      chamadoPor: auth.userId,
      client,
      credenciadoId,
      eventoId: body.eventoId,
      mesaId: body.mesaId ?? null,
      moverPara,
      zona: body.zona ?? null,
    });
    if (!ok) return NextResponse.json({ error }, { status: 400 });
    // Avisa os celulares da fila em tempo real + reforço por WhatsApp (best-effort, fora do caminho
    // crítico). A zona do chamado: a explícita, ou "secretaria" quando foi pra uma mesa.
    const eventoChamado = body.eventoId;
    const credenciadoChamado = body.credenciadoId;
    const zonaChamado = body.zona ?? (body.mesaId ? "secretaria" : null);
    after(async () => {
      await avisarFilaEmRealtime(eventoChamado, credenciadoChamado);
      if (credenciadoChamado) {
        const envio = await enviarChamadoPorWhatsApp({
          client,
          credenciadoId: credenciadoChamado,
          eventoId: eventoChamado,
          zona: zonaChamado,
        });
        if (!envio.enviado) {
          console.error(
            "[prometeu] chamado WhatsApp NÃO saiu:",
            credenciadoChamado,
            envio.motivo,
          );
        }
      }
    });
    return NextResponse.json({ data: { ok: true } });
  }

  // ATENDER: o cliente compareceu na mesa (ocupada -> atendimento) + carimba a chamada.
  if (body.acao === "atender") {
    if (!body.mesaId) {
      return NextResponse.json({ error: "Atender exige mesaId." }, { status: 400 });
    }
    const { error, ok } = await marcarEmAtendimento({
      client,
      credenciadoId,
      mesaId: body.mesaId,
    });
    if (!ok) return NextResponse.json({ error }, { status: 400 });
    return NextResponse.json({ data: { ok: true } });
  }

  // LIBERAR a mesa (fim do atendimento): mesa volta a livre e o cliente avanca de etapa
  // (concluido/cancelado, ou uma etapa anterior quando o atendente "direciona"). Sem etapa, so
  // libera a mesa (ex.: no-show apos chamar).
  if (body.acao === "liberar") {
    if (!body.mesaId) {
      return NextResponse.json({ error: "Liberar exige mesaId." }, { status: 400 });
    }
    const etapaDestino = body.etapa ?? "";
    const moverPara =
      etapaDestino && PROMETEU_ETAPAS.some((e) => e.id === etapaDestino)
        ? (etapaDestino as PrometeuEtapa)
        : null;
    const { error, ok } = await liberarMesa({
      client,
      credenciadoId,
      mesaId: body.mesaId,
      motivo: body.motivo ?? null,
      moverPara,
      por: auth.userId,
    });
    if (!ok) return NextResponse.json({ error }, { status: 400 });
    return NextResponse.json({ data: { ok: true } });
  }

  return NextResponse.json({ error: "Acao desconhecida." }, { status: 400 });
}
