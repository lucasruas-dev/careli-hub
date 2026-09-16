import { NextResponse } from "next/server";

import {
  type CorpoDaFicha,
  lerFichaDoBoard,
  salvarFichaDoBoard,
} from "@/lib/apolo/board-do-servidor";
import {
  adminOu503,
  autorizarOperacaoDeVenda,
  cadNoEscopo,
  recorteDoProduto,
} from "@/lib/apolo/incorporador/board-do-portal";
import { lerEmpreendimentosDaPessoa } from "@/lib/apolo/incorporador/documentos-do-portal";
import { recusaDaEdicaoNoPortal } from "@/lib/apolo/incorporador/escrita-do-portal";
import {
  conferirTrocaDeDocumentoConsultado,
  idsDaEscritaNoBoard,
} from "@/lib/apolo/incorporador/escrita-no-board";
import {
  autorizarEscritaNoProduto,
  recorteQueOPortalOpera,
} from "@/lib/apolo/incorporador/operacao-do-produto-servidor";
import {
  ehPortalComercial,
  portalConfeccionaContrato,
} from "@/lib/apolo/incorporador/perfis-de-portal";

// A FICHA de um item do Board, pelo portal que opera a venda — GET e PATCH /api/incorporador/board/[id]?emp=
//
// Mesmo miolo da rota do hub (`lerFichaDoBoard` / `salvarFichaDoBoard`), com o escopo conferido
// ANTES: a CAD (entity_id + enterprise_id) tem que estar no produto do coordenador. Sem
// `?enterpriseId=`, a ficha é a da CAD mais recente DENTRO do recorte — nunca a de outro
// loteamento, que é o que o default "mais recente" da rota do hub devolveria.
//
// O autor da edição é a conta do portal (sessao.usuarioId / usuarioNome): o uuid vai em
// `actor_user_id` (a coluna não tem FK) e o nome no metadata, porque a conta não está em
// hub_users e o histórico mostraria um traço.
//
// (16/09/2026, D1) O PATCH SÓ GRAVA NO PRODUTO QUE O PORTAL OPERA. No portal que confecciona (o
// Cecílio), a CAD do VOC (37) ou do VOR (41) é só consulta: 403 com `soConsulta`
// (`autorizarEscritaNoProduto`, depois do escopo e antes de gravar). O comercial segue como hoje. O
// GET não passa pela régua: ler continua valendo.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = autorizarOperacaoDeVenda(request);
  if (!auth.ok) return auth.response;

  const rec = await recorteDoProduto(request, auth.sessao);
  if (!rec.ok) return rec.response;

  const admin = adminOu503();
  if (!admin.ok) return admin.response;

  const { id } = await context.params;
  const pedido = new URL(request.url).searchParams.get("enterpriseId");

  const escopo = await cadNoEscopo(admin.client, id, rec.recorte, pedido);
  if (!escopo.ok) return escopo.response;

  return lerFichaDoBoard(admin.client, id, escopo.escopo.enterpriseId);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = autorizarOperacaoDeVenda(request);
  if (!auth.ok) return auth.response;

  const rec = await recorteDoProduto(request, auth.sessao);
  if (!rec.ok) return rec.response;

  const admin = adminOu503();
  if (!admin.ok) return admin.response;

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as CorpoDaFicha;

  const escopo = await cadNoEscopo(admin.client, id, rec.recorte, body.enterpriseId);
  if (!escopo.ok) return escopo.response;

  // (16/09/2026, D1) Só no produto que o portal opera. O comercial passa sem ida ao banco.
  const escrita = await autorizarEscritaNoProduto(
    request,
    auth.sessao,
    idsDaEscritaNoBoard(escopo.escopo, rec.recorte),
  );
  if (!escrita.ok) return escrita.response;

  // (16/09/2026, revisão) ⚠️ FORA DO COMERCIAL, DADO COMPARTILHADO SÓ COM A PESSOA INTEIRA NO
  // RECORTE. Telefone e e-mail da CAD vão para `apolo_contacts` (CACÁ, Iris, avisos e cobrança de
  // todos os produtos), e a ficha da imobiliária é a mesma para os produtos de outros clientes. A
  // ficha da CAD em si (renda, cônjuge, endereço da esteira) é daquela CAD e continua livre
  // (lib/apolo/incorporador/escrita-do-portal.ts). Sem ler os empreendimentos, não grava.
  //
  // (16/09/2026, revisão do conjunto) ⚠️ "NO RECORTE" É NO QUE O PORTAL OPERA, NÃO NO COOKIE. Sem
  // `?emp`, o recorte cru da Cecílio é {37, 39, 41}, e o VOC e o VOR são só consulta para ela (D1):
  // uma cliente do VOC com a CAD do Garden acrescentada (D5) tinha o telefone e o e-mail da entidade
  // (a identidade da Iris) reescritos pelo portal. A régua passa a olhar só os ids que a Cecílio pode
  // escrever (`recorteQueOPortalOpera`); sem conferir, 503.
  const comercial = ehPortalComercial(auth.sessao.tipo);
  if (!comercial) {
    let recusa: null | string;
    try {
      const operados = await recorteQueOPortalOpera(escrita.sessao, rec.recorte.ids);
      if (!operados) {
        return NextResponse.json(
          { error: "Não foi possível conferir esta ficha agora." },
          { status: 503 },
        );
      }
      recusa = recusaDaEdicaoNoPortal({
        campos: body.campos ?? {},
        comercial,
        imobiliaria: escopo.escopo.imobiliaria,
        pessoa: await lerEmpreendimentosDaPessoa(admin.client, id),
        recorte: operados,
      });
    } catch (erro) {
      console.error("[incorporador][board][ficha] sem os empreendimentos da pessoa", erro);
      return NextResponse.json(
        { error: "Não foi possível conferir esta ficha agora." },
        { status: 503 },
      );
    }
    if (recusa) return NextResponse.json({ error: recusa }, { status: 409 });
  }

  // (16/09/2026) ⚠️ O CPF DO CÔNJUGE JÁ CONSULTADO NÃO MUDA PELO PORTAL QUE OPERA SOZINHO. A consulta
  // do cônjuge usa o `conjugeCpf` desta ficha; trocá-lo depois deixaria a CAD com o resultado de
  // outra pessoa, ou abriria o laço "troca o CPF, consulta de novo" na conta da Careli. Com consulta
  // do cônjuge nesta ficha, a troca é 409 e a correção é da Careli; sem conseguir ler, 503.
  const campos = body.campos ?? {};
  if (
    portalConfeccionaContrato(auth.sessao.slug, auth.sessao.tipo) &&
    Object.prototype.hasOwnProperty.call(campos, "conjugeCpf")
  ) {
    const recusaDoDocumento = await conferirTrocaDeDocumentoConsultado(admin.client, {
      alvo: "conjuge",
      documentoNovo: campos.conjugeCpf,
      entityId: id,
    });
    if (recusaDoDocumento) return recusaDoDocumento;
  }

  // A CAD alvo é a que o escopo resolveu (a pedida, ou a mais recente do produto). Imobiliária
  // (sem esteira) segue com `enterpriseId` nulo e grava no cadastro da entidade, como no hub.
  return salvarFichaDoBoard(
    admin.client,
    id,
    { ...body, enterpriseId: escopo.escopo.enterpriseId },
    auth.sessao.usuarioId,
    auth.sessao.usuarioNome,
  );
}
