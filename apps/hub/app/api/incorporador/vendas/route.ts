import { NextResponse } from "next/server";

import { catalogoDeEmpreendimentos } from "@/lib/apolo/catalogo-empreendimentos";
import { codigosDoPedido } from "@/lib/apolo/incorporador/codigos-do-pedido";
import { clientesUnicos } from "@/lib/apolo/incorporador/contratos";
import { empreendimentosDoPortal } from "@/lib/apolo/incorporador/empreendimentos-do-portal";
import { autorizar, codigosDaSessao, foraDoEscopo } from "@/lib/apolo/incorporador/escopo";
import {
  agregarPerfilDoComprador,
  lerCompradoresDasVendas,
  type PerfilDoComprador,
} from "@/lib/apolo/incorporador/perfil-comprador";
import {
  type IndicadoresDeVendasBI,
  lerEventosDeVendas,
  montarIndicadoresDeVendasBI,
} from "@/lib/apolo/incorporador/vendas-bi";
import {
  resumoDeVendas,
  ritmoDeVendas,
  unidadesParaOPortal,
} from "@/lib/apolo/incorporador/vendas-resumo";
import { loadApoloEnterpriseVendas } from "@/lib/apolo/vendas";

// AS VENDAS DO EMPREENDIMENTO DO INCORPORADOR.
//
// Mesmo assunto da aba Vendas do Apolo interno (`loadApoloEnterpriseVendas`), recortado para os
// empreendimentos deste cliente e traduzido para a língua dele em `vendas-resumo`.
//
// ⚠️ O ESCOPO VEM DO TOKEN, NUNCA DA URL. `codigosDaSessao` é a única fonte dos códigos; o
// parâmetro `emp` apenas ESCOLHE um dos empreendimentos que já saíram de lá, e `codigosDoPedido`
// trabalha sobre essa lista, então ele só consegue reduzir. Empreendimento que não é dele não dá
// erro revelador: dá 404, o mesmo que ele receberia para um empreendimento inexistente.
//
// ⚠️ CUSTO. `loadApoloEnterpriseVendas` faz quatro consultas no C2X, uma delas com subconsulta por
// unidade. É a mesma leitura que a tela interna já paga, e ela roda quando o cliente ABRE a aba,
// não em polling. Nada aqui pode virar chamada repetida sem antes ganhar cache.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const auth = autorizar(request);
  if (!auth.ok) return auth.response;

  // Os códigos que esta sessão enxerga. Sem filtro nenhum aqui de propósito: o recorte por
  // empreendimento é feito depois, sobre esta lista.
  const codesAutorizados = await codigosDaSessao(auth.sessao);

  // ⚠️ AQUI NÃO É "ELE NÃO TEM NADA". A sessão só existe com empreendimento (a leitura do token
  // recusa lista vazia), então zero código significa catálogo do C2X fora do ar, e não falta de
  // permissão. Dizer "nenhum empreendimento liberado" para o dono de um loteamento por causa de
  // um pico do legado é o tipo de tela que vira ligação para a Careli.
  if (codesAutorizados.length === 0) {
    return NextResponse.json(
      { error: "Não foi possível carregar os empreendimentos agora." },
      { status: 503 },
    );
  }

  const catalogo = await catalogoDeEmpreendimentos(Date.now());
  const empreendimentos = empreendimentosDoPortal(catalogo, codesAutorizados);

  const pedido = new URL(request.url).searchParams.get("emp");

  // O `emp` chega em TRÊS formatos ("pai:<uuid>" do cadastro do Panteon, id numérico do C2X de
  // um filho, id do catálogo do seletor) e os três só REDUZEM o que a sessão já autorizou. A
  // tradução mora em `codigosDoPedido`, num lugar só, porque as rotas de assinaturas e contratos
  // recebem o MESMO `emp` desta tela — e a regra só aqui deixava a pílula "Contratos" morta
  // dentro do produto aberto pelo "Ver mais". Cadastro fora do ar = 503 (resposta pronta).
  const resolvido = await codigosDoPedido({
    catalogo,
    codesAutorizados,
    empreendimentos,
    pedido,
    sessao: auth.sessao,
  });
  if (!resolvido.ok) return resolvido.response;

  const { codes } = resolvido;

  // Pedido que não sobra nada = empreendimento que não é dele (ou que saiu do catálogo). Nunca
  // cai na visão consolidada: filtro que "não achou" virando relatório do loteamento inteiro é
  // exatamente o vazamento que o escopo existe para evitar.
  if (codes.length === 0) {
    return foraDoEscopo();
  }

  // A leitura do funil, a do histórico (KPIs do BI) e a do perfil do comprador correm juntas:
  // mesmo escopo, um fetch só na tela. Histórico e perfil são enriquecimento — se falharem, a
  // tela segue sem essas seções, em vez de derrubar as vendas inteiras.
  const [vendas, eventos, compradores] = await Promise.all([
    loadApoloEnterpriseVendas(codes),
    lerEventosDeVendas(codes),
    lerCompradoresDasVendas(codes),
  ]);

  if (!vendas.ok) {
    return NextResponse.json({ error: vendas.error }, { status: 503 });
  }

  const bi: IndicadoresDeVendasBI | null = eventos.ok
    ? montarIndicadoresDeVendasBI(eventos.eventos, vendas.data.units, Date.now(), eventos.parcial)
    : null;

  // O perfil do comprador (como no relatório "Quem é o comprador do Vale do Ouro"), agregado
  // sobre o MESMO recorte de códigos das vendas. Só baldes com contagem e percentual — nenhum
  // dado individual atravessa, e abaixo do piso de agregação (`PISO_DE_AGREGACAO`) o agregador
  // devolve nulo: recorte com 1–2 vendas viraria a ficha individual de quem aparece nominalmente
  // na tabela desta mesma tela (ver perfil-comprador.ts).
  const perfilComprador: null | PerfilDoComprador = compradores.ok
    ? agregarPerfilDoComprador(compradores.compradores, Date.now())
    : null;

  return NextResponse.json(
    {
      data: {
        // Os KPIs do BI (Propostas/Faturadas/Canceladas por unidade, % cancelamento, deadline,
        // série mensal, ranking de imobiliárias). Nulo quando o histórico não pôde ser lido.
        //
        // ⚠️ CONVENÇÃO DE VGV, registrada (pergunta 7 do plano): o card "VGV do empreendimento"
        // desta rota SOMA as bloqueadas (`resumoDeVendas`); os VGVs do BI e do kanban somam só o
        // que está em cada métrica/coluna. São recortes do MESMO conjunto de unidades, rotulados
        // na tela — nenhum número novo nasce aqui.
        bi,
        empreendimentos: empreendimentos.map((emp) => ({
          id: emp.id,
          // O código do mapa, quando existe. É o que a tela manda para /api/incorporador/masterplan.
          masterplan: emp.masterplanInterno,
          nome: emp.nome,
        })),
        filtro: pedido?.trim() ? pedido.trim() : null,
        // OS IDS DO CATÁLOGO QUE O RECORTE ALCANÇA. Com produto fixo (o "Ver mais" da aba
        // Produtos) a fileira de mapas da tela precisa mostrar só o mapa DAQUELE produto, e a
        // lista `empreendimentos` acima é a da sessão inteira (o seletor de pílulas precisa
        // dela completa). Como `codes` já é o recorte resolvido (pai expandido → VOC/VOL/VOR;
        // Garden → GDN), a tela filtra por estes ids sem precisar conhecer "pai:".
        recorte: pedido?.trim()
          ? empreendimentosDoPortal(catalogo, codes).map((emp) => emp.id)
          : null,
        // Agregado, nunca individual: contagem e percentual por faixa (sexo, idade, estado
        // civil, renda, profissões top 6, cidades top 5). Nulo quando o C2X não respondeu — e
        // também quando o recorte tem menos vendas que o piso de agregação.
        perfilComprador,
        // CLIENTES ÚNICOS das vendas vivas: derivado das unidades que a leitura JÁ trouxe (o
        // `client` só vem em venda ativa), sem query nova. Medido no VAL: 39 vendas, 36 clientes.
        resumo: { ...resumoDeVendas(vendas.data), clientesUnicos: clientesUnicos(vendas.data.units) },
        ritmo: ritmoDeVendas(vendas.data.units, Date.now()),
        unidades: unidadesParaOPortal(vendas.data.units),
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
