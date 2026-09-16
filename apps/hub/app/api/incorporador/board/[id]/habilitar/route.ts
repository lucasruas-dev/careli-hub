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
  autorizarOperacaoDeVenda,
  cadNoEscopo,
  recorteDoProduto,
  type RecorteDoProduto,
} from "@/lib/apolo/incorporador/board-do-portal";
import { vinculoDentroDoRecorte } from "@/lib/apolo/incorporador/escrita-do-portal";
import {
  autorizarEscritaNoProduto,
  recorteQueOPortalOpera,
} from "@/lib/apolo/incorporador/operacao-do-produto-servidor";
import { ehPortalComercial } from "@/lib/apolo/incorporador/perfis-de-portal";

// HABILITAR / CORREÇÃO / INDEFERIR a imobiliária, pelo portal que opera a venda —
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
// Em `trabalhaFora` (16/09/2026, revisão) o recorte também fica CRU: canonizá-lo fazia a sessão de
// uma divisão (37) virar o grupo inteiro, e o vínculo de outra divisão do mesmo grupo (36) contava
// como "dentro". Só o VÍNCULO é canonizado, para o vínculo gravado como grupo casar com quem cobre
// o grupo inteiro.
//
// (16/09/2026, D1) O POST SÓ DECIDE NO PRODUTO QUE O PORTAL OPERA. A decisão sobre a imobiliária vale
// para o produto aberto, então a régua olha TODOS os ids do recorte (e não a CAD, que a imobiliária
// não tem): no portal que confecciona (o Cecílio), o VOC (37) e o VOR (41) são só consulta, 403 com
// `soConsulta`. O comercial segue como hoje. O GET (a lista dos pedidos) é leitura e não passa.
//
// (16/09/2026, revisão do conjunto) DUAS RÉGUAS, UMA POR TIPO DE PORTAL, em `trabalhaFora`:
//   • COMERCIAL (a Gurgel): a comparação CANONIZADA dos dois lados, como antes da onda 1. Ela decidia
//     sobre a imobiliária credenciada no grupo ("group:Lagoa Bonita") a partir de uma gleba só (33); o
//     recorte cru tirou essa ação dela sem decisão do Lucas, e a D1 diz que o board da Gurgel não muda;
//   • QUEM CONFECCIONA (a Cecílio): o recorte CRU, e só com os ids que ela OPERA
//     (`recorteQueOPortalOpera`). O vínculo no VOC (37) ou no VOR (41), só consulta para ela, é "fora".
// E, para quem confecciona, HABILITAR também passa pela régua quando o papel da imobiliária ainda não
// está ativo: `decidirCredenciamento` promove o papel e a entidade para "active" (decisão GLOBAL) e
// manda o WhatsApp listando todos os produtos dela. Uma imobiliária que a Careli indeferiu, ou que
// está em análise com pedido em outro produto, não é aprovada pelo time da Cecílio: 409.
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
  const auth = autorizarOperacaoDeVenda(request);
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
  const auth = autorizarOperacaoDeVenda(request);
  if (!auth.ok) return auth.response;

  const rec = await recorteDoProduto(request, auth.sessao);
  if (!rec.ok) return rec.response;

  const admin = adminOu503();
  if (!admin.ok) return admin.response;

  const { id } = await context.params;

  const escopo = await cadNoEscopo(admin.client, id, rec.recorte);
  if (!escopo.ok) return escopo.response;

  // (16/09/2026, D1) Sempre os ids do recorte: a habilitação é do produto, não de uma CAD.
  const escrita = await autorizarEscritaNoProduto(request, auth.sessao, [...rec.recorte.ids]);
  if (!escrita.ok) return escrita.response;

  const corpo = (await request.json().catch(() => ({}))) as CorpoDaDecisao;
  const canon = await canonDoCatalogo();

  const acao =
    corpo.acao === "indeferir" || corpo.acao === "reabrir" || corpo.acao === "correcao"
      ? corpo.acao
      : "habilitar";

  const comercial = ehPortalComercial(auth.sessao.tipo);
  // Fora do comercial, "dentro" é só o que o portal opera (ver o cabeçalho). Sem conferir, 503.
  let operados: ReadonlySet<string> = rec.recorte.ids;
  if (!comercial) {
    const lidos = await recorteQueOPortalOpera(escrita.sessao, rec.recorte.ids);
    if (!lidos) {
      return NextResponse.json(
        { error: "Não foi possível conferir o produto agora. Tente de novo em instantes." },
        { status: 503 },
      );
    }
    operados = lidos;
  }
  const idsCanonicos = new Set([...rec.recorte.ids].map((eid) => canon(eid)));

  /**
   * A imobiliária tem vínculo que conta fora do produto? `qualquerStatus` conta também o recusado e o
   * indeferido (reabrir e a promoção do papel desfazem decisão da Careli). `null` = não deu para ler:
   * fora do comercial vira 503; no comercial a leitura segue como antes (sem vínculo lido, nada fora).
   */
  const trabalhaFora = async (qualquerStatus: boolean): Promise<boolean | null> => {
    const { data: vinculos, error } = await admin.client
      .from("apolo_relationships")
      .select("status, metadata")
      .eq("entity_id", id)
      .eq("relationship_type", "empreendimento")
      .limit(500);
    if (error && !comercial) return null;

    return ((vinculos ?? []) as Array<{
      metadata: { enterpriseId?: unknown } | null;
      status: null | string;
    }>).some((linha) => {
      const status = linha.status ?? "pending";
      const conta = qualquerStatus || status === "verified" || status === "pending";
      if (!conta) return false;
      const eid = normalizarEnterpriseId(linha.metadata?.enterpriseId);
      if (eid === null) return false;
      return comercial ? !idsCanonicos.has(canon(eid)) : !vinculoDentroDoRecorte(eid, operados, canon);
    });
  };

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

    if (!comercial) {
      const { data: papel, error: erroDoPapel } = await admin.client
        .from("apolo_entity_profiles")
        .select("status")
        .eq("entity_id", id)
        .eq("profile", "imobiliaria")
        .maybeSingle<{ status: null | string }>();
      if (erroDoPapel) {
        return NextResponse.json(
          { error: "Não foi possível conferir o cadastro desta imobiliária agora." },
          { status: 503 },
        );
      }
      if (papel && papel.status !== "active") {
        const fora = await trabalhaFora(true);
        if (fora === null) {
          return NextResponse.json(
            { error: "Não foi possível conferir o cadastro desta imobiliária agora." },
            { status: 503 },
          );
        }
        if (fora) {
          return NextResponse.json(
            {
              error:
                "Esta imobiliária também pediu cadastro em outro empreendimento. A aprovação do cadastro dela é feita pela Careli; depois disso, o seu produto pode ser liberado aqui.",
            },
            { status: 409 },
          );
        }
      }
    }
  } else {
    // Indeferir / correção / reabrir mexem na imobiliária inteira (papel + entidade). Se ela tem
    // vínculo em outro produto que este coordenador não cobre, a decisão não é dele:
    //   • habilitado (`verified`) ou pedido vivo (`pending`) — indeferir mataria o pedido que
    //     outro coordenador ainda vai decidir;
    //   • para REABRIR, qualquer status conta: reabrir devolve o papel para `review` e desfaz um
    //     indeferimento que pode ter sido da Careli sobre uma imobiliária que pediu outros
    //     produtos (o vínculo dela ali pode estar em qualquer status).
    // (16/09/2026, revisão) ⚠️ O RECORTE NÃO É CANONIZADO PARA QUEM CONFECCIONA. A primeira versão
    // canonizava os dois lados, e a sessão com só a divisão 37 virava {group:Vale do Ouro}: o vínculo
    // da imobiliária no 36 (VOL, do Lino) passava a contar como "dentro", e o time do Cecílio indeferia
    // a imobiliária que vende o produto do Lino. Para ele o vínculo é "dentro" só quando o id cru está
    // no que ele opera, ou quando o id canônico (o grupo) está lá. O comercial volta à comparação
    // canonizada de antes (ver o cabeçalho).
    const fora = await trabalhaFora(acao === "reabrir");
    if (fora === null) {
      return NextResponse.json(
        { error: "Não foi possível conferir o cadastro desta imobiliária agora." },
        { status: 503 },
      );
    }

    if (fora) {
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
