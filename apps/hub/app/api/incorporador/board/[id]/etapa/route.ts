import { NextResponse } from "next/server";

import {
  type CorpoDaEtapa,
  conferirEtapaDeDecisao,
  ETAPAS_DE_DECISAO,
  moverEtapaDoBoard,
} from "@/lib/apolo/board-do-servidor";
import {
  adminOu503,
  autorizarOperacaoDeVenda,
  autorizarPortalQueOperaSozinho,
  cadNoEscopo,
  origemDoAutorNoPortal,
  recorteDoProduto,
} from "@/lib/apolo/incorporador/board-do-portal";
import { idsDaEscritaNoBoard } from "@/lib/apolo/incorporador/escrita-no-board";
import {
  autorizarEscritaNoProduto,
  escritaNoProduto,
  respostaDaEscrita,
} from "@/lib/apolo/incorporador/operacao-do-produto-servidor";
import { portalConfeccionaContrato } from "@/lib/apolo/incorporador/perfis-de-portal";
import type { SessaoIncorporador } from "@/lib/apolo/incorporador/sessao";

// MOVER DE ETAPA pelo portal que opera a venda — PATCH (e POST) /api/incorporador/board/[id]/etapa?emp=
//
// Mesmas regras da rota do hub (`moverEtapaDoBoard`: etapa válida, `nuncaRebaixar`, saída de
// revisão barrada, auditoria, CAD regenerada), com o escopo conferido ANTES: a CAD alvo
// (entity_id + enterpriseId do card) tem que estar no produto do coordenador. Fora dele: 404.
//
// Aceita POST além de PATCH porque o contrato das frentes do Hércules cita POST; o BoardView
// manda PATCH, como sempre mandou.
//
// ⚠️ NEM TODA ETAPA É DO COORDENADOR. A tela esconde o botão de avanço em Crédito e Pré-venda
// (board-view.tsx: *"a consulta de verdade vive no painel da etapa, igual ao PIX"*), mas esconder
// é do cliente: com o cookie na mão, um PATCH direto com `etapa: "credenciado"` passava por
// `moverEtapaDoBoard`, que só barra a SAÍDA de revisão — e a CAD entrava na fila do Prometeu
// aprovada sem Serasa e sem PIX. A régua fica AQUI, no servidor: o coordenador anda com a CAD até
// a análise de crédito e pode pedir correção ou revisão; pré-venda, credenciado e indeferido são
// decisão da Careli (o servidor do crédito/PIX é quem grava essas).
//
// (16/09/2026) ⚠️ EXCEÇÃO: O PORTAL QUE OPERA SOZINHO. Decisão do Lucas: *"A Cecílio, no portal"* faz
// a análise de crédito e o credenciamento dos clientes dela. Para `portalConfeccionaContrato` (hoje
// só o `cecilio-rocha`), pré-venda, credenciado e indeferido passam, com três camadas a mais antes de
// `moverEtapaDoBoard`: a conta e o incorporador revalidados (`autorizarPortalQueOperaSozinho`), o
// recorte refeito com a sessão vigente, e a régua que a tela do Apolo garante pela ordem dos botões
// (`conferirEtapaDeDecisao`: credenciado só com crédito aprovado e, com pré-venda ligada, só com PIX
// gerado; indeferido só com motivo, só a partir da revisão e nunca com PIX gerado). O comercial
// (Gurgel) continua no 403 de sempre, na mesma ordem.
//
// (16/09/2026, D1) ⚠️ E QUALQUER ETAPA, SÓ NO PRODUTO QUE O PORTAL OPERA. No portal que confecciona
// (o Cecílio), a CAD do VOC (37) ou do VOR (41) está no escopo, mas é da Gurgel/Careli: mover a
// etapa dela é 403 com `soConsulta`. A régua roda depois do escopo e antes de gravar: nas etapas de
// decisão, sobre a sessão já revalidada (`escritaNoProduto`, sem revalidar de novo); nas do
// coordenador, pela porta que revalida (`autorizarEscritaNoProduto`). O comercial não passa pelo
// cadastro.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A transição regenera a CAD (monta PDF + upload); dá folga pra não estourar o tempo da função.
export const maxDuration = 30;

// O vocabulário da esteira é `validacao | credito | revisao | prevenda | credenciado | correcao |
// indeferido` (lib/apolo/esteira.ts). Só estas quatro têm porta no portal que opera a venda sem
// operar sozinho (o comercial); o que opera sozinho grava também as de decisão (abaixo).
const ETAPAS_DO_COORDENADOR: ReadonlySet<string> = new Set([
  "validacao",
  "credito",
  "correcao",
  "revisao",
]);

async function mover(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = autorizarOperacaoDeVenda(request);
  if (!auth.ok) return auth.response;

  let rec = await recorteDoProduto(request, auth.sessao);
  if (!rec.ok) return rec.response;

  const admin = adminOu503();
  if (!admin.ok) return admin.response;

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as CorpoDaEtapa;
  const etapaPedida = String(body.etapa ?? "").trim();

  // Antes de tocar em qualquer CAD: etapa que não é do coordenador é 403 com a explicação, e não
  // o 400 "etapa invalida" (a etapa existe; quem não pode gravá-la é ele).
  //
  // (16/09/2026, revisão) A FRASE DIZ O QUE FAZER. O BoardView mostra o `error` em cima do card.
  const operaSozinho = portalConfeccionaContrato(auth.sessao.slug, auth.sessao.tipo);
  const ehDecisao = !ETAPAS_DO_COORDENADOR.has(etapaPedida);
  if (ehDecisao && !operaSozinho) {
    return NextResponse.json(
      {
        error:
          "Esta etapa é decidida pela Careli (pré-venda, credenciamento e indeferimento). Leve a CAD até a análise de crédito: a Careli conclui o credenciamento.",
      },
      { status: 403 },
    );
  }

  // A sessão revalidada das etapas de decisão (null nas do coordenador): a régua de quem opera usa
  // ela, sem revalidar de novo.
  let revalidada: null | SessaoIncorporador = null;

  if (ehDecisao) {
    // Para quem opera sozinho, o que não é do coordenador nem de decisão não é etapa: é o mesmo 400
    // de `moverEtapaDoBoard`, dito antes de gastar a revalidação.
    if (!ETAPAS_DE_DECISAO.has(etapaPedida)) {
      return NextResponse.json({ error: "Etapa invalida." }, { status: 400 });
    }

    // A decisão credencia, sobe para o C2X e entra na fila do lançamento: a conta tem que estar
    // ATIVA agora, e o recorte é refeito com os empreendimentos que ela tem agora (não os do cookie).
    const sozinho = await autorizarPortalQueOperaSozinho(request, auth.sessao);
    if (!sozinho.ok) return sozinho.response;
    revalidada = sozinho.sessao;
    rec = await recorteDoProduto(request, sozinho.sessao);
    if (!rec.ok) return rec.response;
  }

  const escopo = await cadNoEscopo(admin.client, id, rec.recorte, body.enterpriseId);
  if (!escopo.ok) return escopo.response;

  // Imobiliária não passa pela esteira (a decisão dela é por /habilitar). Mesma resposta 409 que
  // `atualizarEtapa` daria para "sem CAD", só que antes de tocar no banco.
  if (escopo.escopo.imobiliaria) {
    return NextResponse.json(
      { error: "Esta ficha nao tem CAD na esteira: imobiliaria e decidida em Habilitar." },
      { status: 409 },
    );
  }

  // (16/09/2026, D1) Só no produto que o portal opera, antes de qualquer régua ou gravação.
  const idsDaEscrita = idsDaEscritaNoBoard(escopo.escopo, rec.recorte);
  if (revalidada) {
    const resultado = await escritaNoProduto(revalidada, idsDaEscrita);
    if (resultado !== "pode") return respostaDaEscrita(resultado);
  } else {
    const escrita = await autorizarEscritaNoProduto(request, auth.sessao, idsDaEscrita);
    if (!escrita.ok) return escrita.response;
  }

  if (ehDecisao) {
    // Sem o empreendimento da CAD não há régua a aplicar (pré-venda, PIX e override são por CAD).
    // Hoje só a imobiliária chega sem ele, e ela já saiu acima; se outra chegar, não grava.
    const enterpriseId = escopo.escopo.enterpriseId;
    if (!enterpriseId) {
      return NextResponse.json(
        { error: "Esta ficha não tem CAD com empreendimento na esteira." },
        { status: 409 },
      );
    }
    const recusa = await conferirEtapaDeDecisao(admin.client, id, {
      enterpriseId,
      etapa: etapaPedida,
      // Só a consulta ao Serasa que este portal fez prova o crédito (a ficha é compartilhada, D5).
      incorporadorId: (revalidada ?? auth.sessao).incorporadorId,
      motivo: body.motivo,
    });
    if (recusa) return NextResponse.json({ error: recusa.error }, { status: recusa.status });
  }

  return moverEtapaDoBoard(
    admin.client,
    id,
    // A CAD alvo é a que o escopo resolveu: nunca "a mais recente" de outro loteamento.
    { ...body, enterpriseId: escopo.escopo.enterpriseId },
    {
      nome: auth.sessao.usuarioNome,
      // (16/09/2026, revisão) Quem moveu: o comercial da Careli ou o time do incorporador que opera
      // a própria venda. Com o mesmo rótulo para os dois, a auditoria não separava o trabalho de um
      // do outro.
      origem: origemDoAutorNoPortal(auth.sessao),
      uploadedByName: auth.sessao.usuarioNome,
      userId: auth.sessao.usuarioId,
    },
  );
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return mover(request, context);
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return mover(request, context);
}
