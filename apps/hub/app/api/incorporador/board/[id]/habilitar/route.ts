import { NextResponse } from "next/server";

import {
  type CorpoDaDecisao,
  decidirCredenciamento,
  pedidosDaImobiliaria,
} from "@/lib/apolo/board-do-servidor";
import { catalogoDeEmpreendimentos } from "@/lib/apolo/catalogo-empreendimentos";
import { canonizador } from "@/lib/apolo/empreendimento-equivalencia";
import { normalizarEnterpriseId } from "@/lib/apolo/esteira-cad";
import {
  adminOu503,
  autorizarComercial,
  cadNoEscopo,
  recorteDoProduto,
  type RecorteDoProduto,
} from "@/lib/apolo/incorporador/board-do-portal";

// HABILITAR / CORREÇÃO / INDEFERIR a imobiliária, pelo portal comercial —
// GET e POST /api/incorporador/board/[id]/habilitar?emp=
//
// Mesmo miolo da rota do hub (`pedidosDaImobiliaria` / `decidirCredenciamento`: canonização dos
// dois lados, trava do corretor, ordem empreendimentos → papel, avisos por WhatsApp), com o
// recorte do produto por cima:
//   • o GET devolve só os empreendimentos PEDIDOS que caem no produto do coordenador — a
//     caixinha de outro produto não aparece e, por isso, não pode ser marcada;
//   • no POST, os `empreendimentos` escolhidos têm que estar no produto (senão 409 com a
//     explicação: o pedido cobre empreendimento fora do produto dele);
//   • indeferir, mandar para correção E reabrir afetam a IMOBILIÁRIA INTEIRA (papel + entidade),
//     não só o produto. Por isso, se ela tem vínculo (habilitado ou pedido) em empreendimento fora
//     do recorte, a decisão é da Careli, não deste coordenador: 409 com a explicação.
//
// ⚠️ HABILITAR É PELO GRUPO, E POR ISSO O RECORTE NÃO PODE SER CANONIZADO. `decidirCredenciamento`
// canoniza os escolhidos para o id do GRUPO ("33" vira "group:Lagoa Bonita") e cria o vínculo do
// grupo — que, pela regra do Apolo, cobre LBF + LBR + LBP. A primeira versão desta rota canonizava
// o recorte também ({33} virava {group:Lagoa Bonita}) e o coordenador de UMA gleba habilitava a
// imobiliária para o grupo inteiro — contra a régua de escopo.ts ("sessão com 33 → SÓ o LBF").
// Agora o ESCOLHIDO é canonizado (é o que vai ser gravado) e comparado contra o recorte CRU:
// `recorteDoProduto` só põe o id do grupo quando o produto cobre TODAS as divisões
// (board-do-portal.ts), então quem cobre o grupo inteiro continua habilitando o grupo, e quem
// cobre uma gleba recebe 409 — a habilitação dessa imobiliária é da Careli.
//
// A canonização continua valendo onde é A FAVOR da segurança: em `trabalhaFora`, o vínculo gravado
// como divisão de outro grupo tem que contar como "fora" mesmo que o recorte esteja no formato do
// grupo, e vice-versa.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

type Pedido = { enterpriseId: string; habilitado: boolean; label: string };

/** O canonizador do catálogo (grupo ↔ divisões), para o que PRECISA de equivalência. */
async function canonDoCatalogo() {
  const catalogo = await catalogoDeEmpreendimentos(Date.now());
  return canonizador(catalogo);
}

/** O que a habilitação gravaria (o id canônico) cabe no produto deste coordenador? */
function habilitacaoNoRecorte(
  recorte: RecorteDoProduto,
  canon: (id: string) => string,
  escolhido: string,
): boolean {
  return recorte.ids.has(canon(escolhido.trim()));
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = autorizarComercial(request);
  if (!auth.ok) return auth.response;

  const rec = await recorteDoProduto(request, auth.sessao);
  if (!rec.ok) return rec.response;

  const admin = adminOu503();
  if (!admin.ok) return admin.response;

  const { id } = await context.params;

  const escopo = await cadNoEscopo(admin.client, id, rec.recorte);
  if (!escopo.ok) return escopo.response;

  const resposta = await pedidosDaImobiliaria(admin.client, id);
  if (!resposta.ok) return resposta;

  // Recorta a lista devolvida: só o que cai no produto deste coordenador. Comparação CRUA de
  // propósito: o pedido gravado como "group:Lagoa Bonita" só aparece para quem tem o grupo no
  // recorte (cobre todas as divisões); o pedido gravado como "33" aparece para quem tem o 33 —
  // e, se ele não cobrir o grupo, o POST explica que a habilitação é da Careli.
  const corpo = (await resposta.json()) as {
    data?: { empreendimentos?: Pedido[]; papelStatus?: null | string; pendencias?: string[] };
  };
  const empreendimentos = (corpo.data?.empreendimentos ?? []).filter((pedido) =>
    rec.recorte.ids.has(String(pedido.enterpriseId ?? "").trim()),
  );

  return NextResponse.json({
    data: {
      empreendimentos,
      papelStatus: corpo.data?.papelStatus ?? null,
      pendencias: corpo.data?.pendencias ?? [],
    },
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = autorizarComercial(request);
  if (!auth.ok) return auth.response;

  const rec = await recorteDoProduto(request, auth.sessao);
  if (!rec.ok) return rec.response;

  const admin = adminOu503();
  if (!admin.ok) return admin.response;

  const { id } = await context.params;

  const escopo = await cadNoEscopo(admin.client, id, rec.recorte);
  if (!escopo.ok) return escopo.response;

  const corpo = (await request.json().catch(() => ({}))) as CorpoDaDecisao;
  const canon = await canonDoCatalogo();

  const acao =
    corpo.acao === "indeferir" || corpo.acao === "reabrir" || corpo.acao === "correcao"
      ? corpo.acao
      : "habilitar";

  if (acao === "habilitar") {
    // Tudo o que o coordenador marcou tem que caber no produto dele DEPOIS de canonizado — é o
    // que vai ser gravado. "33" com recorte {33} vira "group:Lagoa Bonita", que não está no
    // recorte de quem cobre uma gleba só: 409 com a explicação, e não o 404 do escopo, porque
    // o pedido É do produto dele; o que não é dele é a decisão.
    const escolhidos = Array.isArray(corpo.empreendimentos)
      ? corpo.empreendimentos.filter((item): item is string => typeof item === "string")
      : [];
    if (escolhidos.some((item) => !habilitacaoNoRecorte(rec.recorte, canon, item))) {
      return NextResponse.json(
        {
          error:
            "Este pedido cobre empreendimento fora do seu produto (a habilitacao vale para o empreendimento inteiro). A decisao e da Careli.",
        },
        { status: 409 },
      );
    }
  } else {
    // Indeferir / correção / reabrir mexem na imobiliária inteira (papel + entidade). Se ela tem
    // vínculo em outro produto que este coordenador não cobre, a decisão não é dele:
    //   • habilitado (`verified`) ou pedido vivo (`pending`) — indeferir mataria o pedido que
    //     outro coordenador ainda vai decidir;
    //   • para REABRIR, qualquer status conta: reabrir devolve o papel para `review` e desfaz um
    //     indeferimento que pode ter sido da Careli sobre uma imobiliária que pediu outros
    //     produtos (o vínculo dela ali pode estar em qualquer status).
    // Aqui a comparação é CANONIZADA dos dois lados, a favor da segurança: o vínculo gravado como
    // divisão de outro grupo é "fora" mesmo que o recorte esteja no formato do grupo.
    const idsCanonicos = new Set([...rec.recorte.ids].map((id) => canon(id)));

    const { data: vinculos } = await admin.client
      .from("apolo_relationships")
      .select("status, metadata")
      .eq("entity_id", id)
      .eq("relationship_type", "empreendimento")
      .limit(500);

    const trabalhaFora = ((vinculos ?? []) as Array<{
      metadata: { enterpriseId?: unknown } | null;
      status: null | string;
    }>).some((linha) => {
      const status = linha.status ?? "pending";
      const conta = acao === "reabrir" || status === "verified" || status === "pending";
      if (!conta) return false;
      const eid = normalizarEnterpriseId(linha.metadata?.enterpriseId);
      return eid !== null && !idsCanonicos.has(canon(eid));
    });

    if (trabalhaFora) {
      return NextResponse.json(
        {
          error:
            "Esta imobiliaria tem cadastro em outro empreendimento fora do seu produto. A decisao sobre o cadastro dela e da Careli.",
        },
        { status: 409 },
      );
    }
  }

  return decidirCredenciamento(admin.client, id, corpo, auth.sessao.usuarioId);
}
