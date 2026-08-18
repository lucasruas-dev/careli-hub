import { NextResponse } from "next/server";

import { loadApoloEnterpriseCarteira } from "@/lib/apolo/carteira";
import { catalogoDeEmpreendimentos } from "@/lib/apolo/catalogo-empreendimentos";
import {
  agregarCompradores,
  agregarImobiliarias,
  anexarIdentidade,
  contarCadsPorImobiliaria,
  lerEsteiraDoEscopo,
  lerIdentidades,
  lerImobiliariasVinculadas,
  montarProspects,
} from "@/lib/apolo/incorporador/crm";
import { autorizar, codigosDaSessao, idsDaSessao } from "@/lib/apolo/incorporador/escopo";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { loadApoloEnterpriseVendas } from "@/lib/apolo/vendas";

// O CRM DO INCORPORADOR — as pessoas ligadas ao empreendimento dele.
//
// Pedido do Lucas (17/08/2026): *"é como se o incorporador estivesse acessando o Apolo, contudo
// filtrado o empreendimento deles, tanto prospect, comprador, e imobiliárias, todos deverão ter
// vínculos com o empreendimento"*.
//
// ⚠️ O ESCOPO VEM DO TOKEN, NUNCA DA URL. `codigosDaSessao` e `idsDaSessao` são as únicas fontes
// dos empreendimentos; o parâmetro `code` só consegue ESTREITAR o que já é dele. É a mesma regra da
// Carteira, e aqui pesa mais: o que trafega são pessoas, não totais.
//
// ⚠️ UMA ABA POR CHAMADA. Compradores custa sete consultas no C2X (carteira + vendas). Servir as
// três listas de uma vez faria a tela pagar tudo isso para mostrar uma. A tela pede a aba que o
// cliente abriu e guarda o que já veio. Ver [[project_hermes_cost]].
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const ABAS = new Set(["compradores", "imobiliarias", "prospects"]);

const semDado = (aba: string) =>
  NextResponse.json(
    { data: { aba, compradores: [], imobiliarias: [], prospects: [] } },
    { headers: { "Cache-Control": "no-store" } },
  );

export async function GET(request: Request) {
  const auth = autorizar(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const aba = url.searchParams.get("aba") ?? "compradores";

  if (!ABAS.has(aba)) {
    return NextResponse.json({ error: "Aba desconhecida." }, { status: 400 });
  }

  const filtro = url.searchParams.get("code");
  const [codes, enterpriseIds] = await Promise.all([
    codigosDaSessao(auth.sessao, filtro),
    idsDaSessao(auth.sessao, filtro),
  ]);

  // Pedido que não sobra nada = empreendimento que não é dele. Lista vazia, e NUNCA o consolidado:
  // um filtro que "não achou" não pode virar visão de tudo.
  if (codes.length === 0 && enterpriseIds.length === 0) return semDado(aba);

  // Sessão com empreendimento e SEM código = o catálogo do C2X não respondeu (é ele que traduz id
  // em code). As abas que leem o C2X têm que dizer que não conseguiram, nunca mostrar lista vazia:
  // "nenhuma venda registrada" é uma afirmação, e errada ela vira ligação do cliente.
  const semCatalogo = codes.length === 0;

  if (aba === "compradores") {
    if (semCatalogo) {
      return NextResponse.json(
        { error: "Não foi possível carregar os compradores agora." },
        { status: 503 },
      );
    }

    const [carteira, vendas] = await Promise.all([
      loadApoloEnterpriseCarteira(codes),
      loadApoloEnterpriseVendas(codes),
    ]);

    if (!carteira.ok || !vendas.ok) {
      return NextResponse.json(
        { error: "Não foi possível carregar os compradores agora." },
        { status: 503 },
      );
    }

    const catalogo = await catalogoDeEmpreendimentos(Date.now());
    const nomePorCode = new Map<string, string>();
    for (const empreendimento of catalogo) {
      for (const code of empreendimento.codes) {
        nomePorCode.set(code.toUpperCase(), empreendimento.name);
      }
    }

    let compradores = agregarCompradores({
      carteira: carteira.data.units,
      nomePorCode,
      vendas: vendas.data.units,
    });

    // Completa documento + cidade/UF para o card no padrão do CRM 360 interno ("documento nome"
    // na primeira linha). Best-effort: sem Apolo, a lista sai só com os nomes.
    const adminIdentidade = createApoloAdminClient();
    if (adminIdentidade) {
      compradores = anexarIdentidade(
        compradores,
        await lerIdentidades(adminIdentidade, compradores.map((comprador) => comprador.id)),
      );
    }

    return NextResponse.json(
      { data: { aba, compradores } },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const admin = createApoloAdminClient();

  if (!admin) {
    return NextResponse.json(
      { error: "Cadastro indisponível agora." },
      { status: 503 },
    );
  }

  if (aba === "prospects") {
    const esteira = await lerEsteiraDoEscopo(admin, enterpriseIds);
    if (!esteira.ok) {
      return NextResponse.json({ error: "Não foi possível carregar os cadastros." }, { status: 503 });
    }

    const prospects = await montarProspects(admin, esteira.linhas);
    if (!prospects.ok) {
      return NextResponse.json({ error: "Não foi possível carregar os cadastros." }, { status: 503 });
    }

    return NextResponse.json(
      { data: { aba, prospects: prospects.prospects } },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  if (semCatalogo) {
    return NextResponse.json(
      { error: "Não foi possível carregar as imobiliárias agora." },
      { status: 503 },
    );
  }

  const [carteira, vendas, esteira, vinculadas] = await Promise.all([
    loadApoloEnterpriseCarteira(codes),
    loadApoloEnterpriseVendas(codes),
    lerEsteiraDoEscopo(admin, enterpriseIds),
    lerImobiliariasVinculadas(admin, enterpriseIds),
  ]);

  if (!carteira.ok || !vendas.ok || !esteira.ok || !vinculadas.ok) {
    return NextResponse.json(
      { error: "Não foi possível carregar as imobiliárias agora." },
      { status: 503 },
    );
  }

  return NextResponse.json(
    {
      data: {
        aba,
        imobiliarias: agregarImobiliarias({
          cadsPorEntidade: contarCadsPorImobiliaria(esteira.linhas),
          carteira: carteira.data.units,
          credenciadas: vinculadas.credenciadas,
          vendas: vendas.data.units,
        }),
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
