import { NextResponse } from "next/server";

import { loadApoloEnterpriseCarteira, type ApoloCarteiraUnit } from "@/lib/apolo/carteira";
import { catalogoDeEmpreendimentos } from "@/lib/apolo/catalogo-empreendimentos";
import {
  carteiraLiquidaDoIncorporador,
  type CarteiraPorUnidade,
} from "@/lib/apolo/incorporador/carteira-liquida";
import {
  codesDoRecorte,
  empreendimentosDoPortal,
} from "@/lib/apolo/incorporador/empreendimentos-do-portal";
import { autorizar, codigosDaSessao } from "@/lib/apolo/incorporador/escopo";
import { loadPoliticaComercial } from "@/lib/apolo/politica-comercial";
import { type PoliticaDoEmpreendimento } from "@/lib/apolo/liquido-incorporador";
import { createApoloAdminClient } from "@/lib/apolo/server";

// A CARTEIRA DO INCORPORADOR: o bruto que a Careli administra e o LÍQUIDO que é dele.
//
// Pedido do Lucas (17/08/2026): *"quero que o incorporador tenha acesso à tela da carteira do
// empreendimento dele; o que temos que ter adicional é trazer os valores líquidos, pois nessa tela
// temos os valores brutos"*.
//
// ⚠️ O ESCOPO VEM DO TOKEN, NUNCA DA URL. `codigosDaSessao` é a única fonte dos empreendimentos, e
// a rota não aceita parâmetro que amplie isso: no máximo o cliente FILTRA dentro do que já é dele.
// Sem essa regra, trocar um código na barra de endereço devolveria a carteira de outro loteador.
//
// O QUE A ROTA DEVOLVE (17/08/2026, para a TelaCarteira nova, réplica da CarteiraTab interna):
//   • `bruto`            — o resumo da carteira (mesma matemática do Hades, de propósito);
//   • `liquido`          — a soma do líquido do incorporador (split real primeiro, fórmula depois);
//   • `units`            — a carteira POR UNIDADE, já com o líquido de cada uma casado por id;
//   • `empreendimentos`  — os empreendimentos da sessão (id + nome), para a tela montar o seletor;
//   • `indicadores`      — os KPIs do BI de Gestão de Carteira, SÓ quando `?indicadores=1`.
//
// ⚠️ OS INDICADORES MORAM NESTA ROTA, e não numa sub-rota. Decisão documentada: os KPIs saem das
// MESMAS linhas cruas que somam o líquido (`carteira-liquida.ts` lê uma vez e agrega tudo) — uma
// sub-rota teria que repetir a leitura no C2X, e é exatamente a segunda consulta "quase igual" que
// faz duas abas da mesma tela divergirem. O parâmetro existe porque a leitura ampliada (parcelas
// em aberto) custa mais: a aba Carteira não paga por ela; a aba Indicadores pede quando abre.
//
// ⚠️ O QUE NUNCA SAI DAQUI: documento pessoal, telefone, e-mail e id interno de entidade do CRM.
// Cliente e imobiliária vão por NOME (o incorporador é parte do contrato). Cada unidade sai com o
// nome de MERCADO do empreendimento, nunca com a divisão interna.
//
// O CONTRATO passou a ser sinalizado em 18/08/2026, por ordem do Lucas: *"temos que trazer o
// contrato e nas parcelas dentro de carteira o link do boleto do asaas"*. Sai SÓ `temContrato`
// (booleano): o uuidDoc do D4Sign NÃO atravessa para o navegador — a tela só precisa saber "tem
// contrato assinado?", e o uuid é exatamente o identificador que a rota interna de contrato aceita
// cru. O PDF abre por /api/incorporador/contrato?unitId=…, que resolve o uuid DE NOVO no C2X e
// nunca aceita uuid vindo do navegador.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/** Uma unidade como o PORTAL a mostra: allowlist explícita sobre `ApoloCarteiraUnit`. */
type UnidadeDoPortal = {
  block: null | string;
  /** Nome do comprador. Só o nome: o `entityId` interno do CRM não atravessa esta rota. */
  client: null | string;
  code: string;
  contractCode: null | string;
  /** Nome de MERCADO do empreendimento ("Vista Alegre"), nunca o código da divisão interna. */
  empreendimento: null | string;
  faturadoAt: null | string;
  id: string;
  imobiliaria: null | string;
  /** O líquido apurado da unidade, ou `null` quando ainda não há parcela paga apurada. */
  liquido: null | Omit<CarteiraPorUnidade, "unidade" | "unitId">;
  lot: null | string;
  maxOverdueDays: number;
  overdueAmount: number;
  overdueInstallments: number;
  paidAmount: number;
  /**
   * `true` quando há contrato assinado no D4Sign (ordem do Lucas, 18/08/2026). SÓ o sinal: o
   * uuidDoc não atravessa para o navegador; o PDF sai da rota escopada, que resolve o uuid no
   * C2X a cada clique.
   */
  temContrato: boolean;
  toReceiveAmount: number;
  totalContract: number;
};

function unidadeParaOPortal(
  unit: ApoloCarteiraUnit,
  nomePorCode: Map<string, string>,
  liquidoPorUnitId: Map<string, CarteiraPorUnidade>,
): UnidadeDoPortal {
  const liquido = liquidoPorUnitId.get(unit.id) ?? null;

  return {
    block: unit.block,
    client: unit.client?.name ?? null,
    code: unit.code,
    contractCode: unit.contractCode,
    empreendimento: nomePorCode.get(unit.enterpriseCode.toUpperCase()) ?? null,
    faturadoAt: unit.faturadoAt,
    id: unit.id,
    imobiliaria: unit.imobiliaria?.name ?? null,
    liquido: liquido
      ? {
          bruto: liquido.bruto,
          liquido: liquido.liquido,
          parcelasPagas: liquido.parcelasPagas,
          semLiquido: liquido.semLiquido,
        }
      : null,
    lot: unit.lot,
    maxOverdueDays: unit.maxOverdueDays,
    overdueAmount: unit.overdueAmount,
    overdueInstallments: unit.overdueInstallments,
    paidAmount: unit.paidAmount,
    // A MESMA régua de `contratosAssinados` (documentos.ts): uuid vazio ou só espaço = sem
    // contrato — o botão da tela só aparece quando a rota do PDF vai conseguir resolver.
    temContrato: Boolean(unit.contractDocumentId?.trim()),
    toReceiveAmount: unit.toReceiveAmount,
    totalContract: unit.totalContract,
  };
}

export async function GET(request: Request) {
  const auth = autorizar(request);
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  const filtro = params.get("code")?.trim() || null;
  const comIndicadores = params.get("indicadores") === "1";

  // Tudo o que a sessão autoriza, SEM filtro: é sobre esta lista que o seletor de empreendimento
  // se monta, e é só DENTRO dela que o pedido da tela consegue escolher.
  const codesAutorizados = await codigosDaSessao(auth.sessao);
  const catalogo = await catalogoDeEmpreendimentos(Date.now());
  const empreendimentos = empreendimentosDoPortal(catalogo, codesAutorizados);

  // Código da divisão interna -> nome de mercado. É com este mapa que a unidade e o extrato saem
  // rotulados com o empreendimento que o cliente conhece, nunca com a divisão da Careli.
  const nomePorCode = new Map<string, string>();
  for (const emp of empreendimentos) {
    for (const code of emp.codes) nomePorCode.set(code.toUpperCase(), emp.nome);
  }

  // O filtro só ESTREITA. Primeiro tenta como id do seletor (o mesmo formato da rota de vendas,
  // inclusive "group:…"); se não casar, tenta como id de empreendimento da sessão (o formato
  // antigo, que a rota sempre aceitou). Nos dois caminhos o resultado é subconjunto da sessão.
  let codes = codesAutorizados;
  if (filtro) {
    const porSeletor = codesDoRecorte(empreendimentos, filtro);
    codes = porSeletor.length > 0 ? porSeletor : await codigosDaSessao(auth.sessao, filtro);
  }

  // Pedido que não sobra nada = o cliente pediu empreendimento que não é dele. Devolve vazio, e
  // NUNCA a carteira inteira: um filtro que "não achou" não pode virar visão consolidada.
  if (codes.length === 0) {
    return NextResponse.json(
      { data: { bruto: null, liquido: null, semCarteira: true } },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // A % de gestão de carteira mora no Apolo e muda POR EMPREENDIMENTO, mesmo para o mesmo
  // incorporador (regra do Lucas). Ela alimenta a fórmula de fallback do líquido.
  const adminClient = createApoloAdminClient();
  const politicaPorCode = new Map<string, PoliticaDoEmpreendimento>();

  if (adminClient) {
    const { data: settings } = await adminClient
      .from("apolo_enterprise_settings")
      .select("enterprise_id, code, gestao_carteira_percentual")
      .limit(2000);

    const gestaoPorId = new Map<string, null | number>(
      ((settings ?? []) as Array<{
        enterprise_id: string;
        gestao_carteira_percentual: null | number | string;
      }>).map((linha) => [
        String(linha.enterprise_id),
        linha.gestao_carteira_percentual == null
          ? null
          : Number(linha.gestao_carteira_percentual),
      ]),
    );

    const politicas = await loadPoliticaComercial(codes, gestaoPorId);
    if (politicas.ok) {
      for (const p of politicas.politicas) {
        politicaPorCode.set(p.code, {
          comissaoPct: p.comissaoTotal,
          entradaPct: p.entradaMinima,
          gestaoCarteiraPct: p.gestaoCarteiraApolo ?? p.gestaoCarteiraSplit,
        });
      }
    }
  }

  const [bruta, liquida] = await Promise.all([
    loadApoloEnterpriseCarteira(codes),
    carteiraLiquidaDoIncorporador({
      codes,
      // Os KPIs do BI só quando a tela pede: a leitura ampliada (parcelas em aberto) custa mais.
      indicadores: comIndicadores ? { agoraMs: Date.now(), nomePorCode } : undefined,
      // Casa o split quando a linha não traz `perfil` — em boa parte das parcelas o único campo
      // presente é a razão social.
      nomeDoIncorporador: auth.sessao.incorporadorNome,
      politicaPorCode,
    }),
  ]);

  if (!bruta.ok) {
    // O detalhe do loader NÃO atravessa para o cliente EXTERNO: ele pode citar nome de env
    // interna ("Configuração C2X ausente: …"). Fica no log do servidor; o portal recebe genérico.
    console.error("[incorporador/carteira] falha ao carregar a carteira:", bruta.error);
    return NextResponse.json(
      { error: "Não foi possível carregar a carteira agora." },
      { status: 503 },
    );
  }

  // O líquido POR UNIDADE casa com as unidades do bruto pela MESMA chave: enterprise_unities.id.
  const liquidoPorUnitId = new Map<string, CarteiraPorUnidade>(
    liquida.ok ? liquida.data.porUnidade.map((u) => [u.unitId, u]) : [],
  );

  return NextResponse.json(
    {
      data: {
        // O que a Careli administra: contratos, inadimplência, a receber. É o mesmo número da
        // tela interna, de propósito — carteira que diverge entre nós e o cliente vira reunião.
        bruto: bruta.data.summary,
        // O seletor da tela. `id` é o que volta em `?code` para estreitar a visão.
        empreendimentos: empreendimentos.map((emp) => ({ id: emp.id, nome: emp.nome })),
        filtro,
        // Os KPIs do BI de Gestão de Carteira (só com `?indicadores=1`). Percentuais já em 0–100.
        indicadores: liquida.ok ? liquida.data.indicadores : null,
        // ⚠️ `null` quando não deu para calcular NENHUMA parcela: a tela diz que não conseguiu,
        // em vez de mostrar R$ 0,00, que o cliente leria como "não recebi nada".
        liquido: liquida.ok
          ? {
              motivos: liquida.data.motivos,
              // `true` = a leitura bateu no teto e a soma NÃO é completa. A tela avisa.
              parcial: liquida.data.parcial,
              porSplit: liquida.data.porSplit,
              recebido: liquida.data.liquido,
              recebidoBruto: liquida.data.bruto,
              semLiquido: liquida.data.semLiquido,
              total: liquida.data.total,
            }
          : null,
        unidades: bruta.data.units.length,
        // A carteira por unidade da CarteiraTab interna, com a coluna nova de líquido e o sinal
        // de contrato assinado (18/08/2026) — e SEM o que não atravessa o portal (entityId do
        // CRM, uuid do D4Sign, selo de cobrança do Hades).
        units: bruta.data.units.map((unit) =>
          unidadeParaOPortal(unit, nomePorCode, liquidoPorUnitId),
        ),
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
