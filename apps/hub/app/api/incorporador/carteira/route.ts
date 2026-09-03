import { NextResponse } from "next/server";

import { loadApoloEnterpriseCarteira, type ApoloCarteiraUnit } from "@/lib/apolo/carteira";
import { catalogoDeEmpreendimentos } from "@/lib/apolo/catalogo-empreendimentos";
import {
  carteiraLiquidaDoIncorporador,
  perfilDaParcela,
  type CarteiraPorUnidade,
  type ColunaDoExtrato,
  type FiltroDoExtrato,
  type SituacaoDaParcela,
} from "@/lib/apolo/incorporador/carteira-liquida";
import {
  codesDoRecorte,
  empreendimentosDoPortal,
} from "@/lib/apolo/incorporador/empreendimentos-do-portal";
import { autorizar, codigosDaSessao } from "@/lib/apolo/incorporador/escopo";
import { ehPortalComercial } from "@/lib/apolo/incorporador/perfis-de-portal";
import { numeroDaParcela } from "@/lib/apolo/numero-da-parcela";
import { loadPoliticaComercial } from "@/lib/apolo/politica-comercial";
import { type PoliticaDoEmpreendimento } from "@/lib/apolo/liquido-incorporador";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { getHadesDbPool } from "@/lib/guardian/db";

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
//
// O RECORTE DO COORDENADOR (02/09/2026). O mesmo cookie serve o portal COMERCIAL (o Hércules dos
// coordenadores), e ali a aba se chama Financeiro. Pedido do Lucas, vendo a aba no /gurgel:
// *"aqui o financeiro não tem carteira, é Parcelas, e para o time de coordenação eles não precisam
// ver o financiamento, somente o Ato e o Sinal. outra coisa, eles veem o que o cliente paga, não
// precisa trazer % de participação, é para trazer o valor cheio"* — e, na sequência, *"aqui trazer
// os boletos, para que o coordenador possa também encaminhar para o cliente, corretor"*.
//
// `bruto` e `units` somam TODAS as parcelas (financiamento incluso) e não trazem perfil, então não
// dá para recortar Ato e Sinal na tela a partir deles. Por isso, SÓ quando a SESSÃO é comercial,
// cada unidade sai também com `atoESinal.parcelas`: as parcelas de Ato e Sinal da carteira ativa,
// valor cheio, com situação, atraso e o link do boleto. A tela do coordenador soma os cards e monta
// a tabela a partir DESSA lista, e nunca do `bruto`.
//
// ⚠️ A DECISÃO É DO COOKIE, NUNCA DA URL. Não existe `?modo=` nem `?boletos=`: quem diz se o link
// de boleto por unidade atravessa é `sessao.tipo` (assinado). Para o incorporador o campo nem
// existe no payload — a tela dele continua recebendo exatamente o que recebia.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Uma parcela de Ato ou Sinal, como o COORDENADOR a vê: valor cheio (o que o cliente paga), sem
 * líquido, sem rateio, com o boleto. Só existe no payload da sessão comercial.
 */
type ParcelaDeAtoESinal = {
  /** Fatura/Boleto Asaas: `payment_asaas_url` primeiro, `payment_asaas_invoice_url` de fallback (a mesma escolha de parcelas-portal.ts). */
  boletoUrl: null | string;
  diasDeAtraso: number;
  id: string;
  /** `true` = o vencimento já passou (pago ou não). É o denominador da inadimplência, como no bruto. */
  jaVenceu: boolean;
  /** "1/1" no Ato, "n/total" no Sinal (a régua de numero-da-parcela.ts). */
  numero: string;
  pagoEm: null | string;
  /** `true` = paga com pagamento no mês corrente (o card "Recuperação" do bruto). */
  pagoNoMes: boolean;
  perfil: "Ato" | "Sinal";
  situacao: SituacaoDaParcela;
  /** O principal (valor cheio da parcela), a mesma régua de `PRINCIPAL` em carteira.ts. */
  valor: number;
  /** Em aberto COM encargos quando vencida (a régua `OUTSTANDING` de carteira.ts); 0 quando não. */
  valorEmAberto: number;
  valorPago: number;
  vencimento: null | string;
};

/** Uma unidade como o PORTAL a mostra: allowlist explícita sobre `ApoloCarteiraUnit`. */
type UnidadeDoPortal = {
  /** SÓ na sessão comercial (ver o cabeçalho): as parcelas de Ato e Sinal desta unidade. */
  atoESinal?: { parcelas: ParcelaDeAtoESinal[] };
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

/** Uma linha crua da leitura de Ato e Sinal (ver `parcelasDeAtoESinal`). */
type LinhaDeAtoESinal = {
  dias_atraso: null | number | string;
  due_date: null | string;
  invoice_url: null | string;
  ja_venceu: null | number | string;
  pago_no_mes: null | number | string;
  parcel_type: null | string;
  parcela_n: null | number | string;
  parcela_total: null | number | string;
  payment_date: null | string;
  payment_id: number | string;
  payment_url: null | string;
  sinal_n: null | number | string;
  sinal_total: null | number | string;
  situacao: null | string;
  unit_id: number | string;
  valor_em_aberto: null | number | string;
  valor_pago: null | number | string;
  valor_previsto: null | number | string;
};

/** Teto de segurança da leitura de Ato e Sinal: bateu, `parcial` vem `true` e a tela avisa. */
const TETO_ATO_E_SINAL = 20000;

const numero = (valor: unknown): number => {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const http = (valor: unknown): null | string => {
  const texto = typeof valor === "string" ? valor.trim() : "";
  return /^https?:\/\//i.test(texto) ? texto : null;
};

/**
 * As parcelas de ATO e SINAL da carteira ativa, por unidade — a leitura do modo coordenador.
 *
 * ⚠️ A MESMA MATEMÁTICA DO BRUTO, de propósito. Carteira ativa = `payment_status_id in (5, 6, 7)`
 * sem as apagadas; paga = 5; vencida = a régua `OVERDUE`; pago/a receber/total = o PRINCIPAL
 * (`initial_value`); vencido = o `OUTSTANDING` (com encargos). É a régua de
 * lib/apolo/carteira.ts (`runCarteiraQueries`) linha a linha, só que recortada por tipo — assim os
 * cards do coordenador são o subconjunto exato dos cards do incorporador, e não uma segunda conta.
 * As constantes de lá não são exportadas; se a régua mudar lá, mudar aqui.
 *
 * O tipo entra por um LIKE largo no SQL (só para não trazer 15 mil mensais à toa) e a decisão
 * final é de `perfilDaParcela`, a MESMA régua que rotula o extrato do incorporador: o que o
 * incorporador vê como "Ato" é o que o coordenador vê como "Ato".
 *
 * Leitura READ-ONLY do C2X. O link é o mesmo par de campos de `loadApoloUnitInstallments`.
 */
async function parcelasDeAtoESinal(
  codes: string[],
): Promise<{ parcial: boolean; porUnitId: Map<string, ParcelaDeAtoESinal[]> } | { erro: string }> {
  const pool = getHadesDbPool();
  if (!pool.ok) {
    return { erro: `Configuracao C2X ausente: ${pool.missing.join(", ")}.` };
  }

  const marcadores = codes.map(() => "?").join(", ");
  const ativa = "(p.payment_to_delete is null or p.payment_to_delete = 0)";
  const vencida = `((p.payment_status_id = 7 or (p.due_date < curdate() and p.payment_status_id not in (1,2,5))) and ${ativa})`;
  const emAberto = `greatest(coalesce(p.initial_value,0)+coalesce(p.interest_value,0)+coalesce(p.mulct_value,0)-(case when p.payment_date is not null then coalesce(p.paid_value,0) else 0 end), 0)`;

  const [linhas] = await pool.pool.query(
    `select
       p.id                                     as payment_id,
       eu.id                                    as unit_id,
       pt.name                                  as parcel_type,
       p.current_total_parcel                   as parcela_n,
       p.total_parcels                          as parcela_total,
       p.current_signal_parcel                  as sinal_n,
       p.total_signal_parcels                   as sinal_total,
       case when p.payment_status_id = 5 then 'paga'
            when ${vencida} then 'vencida'
            else 'a_vencer' end                 as situacao,
       coalesce(p.initial_value, 0)             as valor_previsto,
       coalesce(p.paid_value, 0)                as valor_pago,
       case when ${vencida} then ${emAberto} else 0 end as valor_em_aberto,
       case when ${vencida} then datediff(curdate(), p.due_date) else 0 end as dias_atraso,
       case when p.due_date <= curdate() then 1 else 0 end as ja_venceu,
       case when p.payment_status_id = 5
             and p.payment_date >= cast(date_format(curdate(), '%Y-%m-01') as date)
             and p.payment_date < date_add(cast(date_format(curdate(), '%Y-%m-01') as date), interval 1 month)
            then 1 else 0 end                   as pago_no_mes,
       date_format(p.due_date, '%Y-%m-%d')      as due_date,
       date_format(p.payment_date, '%Y-%m-%d')  as payment_date,
       p.payment_asaas_url                      as payment_url,
       p.payment_asaas_invoice_url              as invoice_url
     from payments p
     join acquisition_requests ar on ar.id = p.acquisition_request_id
     join enterprise_unities eu on eu.id = ar.enterprise_unity_id
     join enterprises e on e.id = eu.enterprise_id
     left join parcel_types pt on pt.id = p.parcel_type_id
    where e.code in (${marcadores})
      and p.payment_status_id in (5, 6, 7)
      and ${ativa}
      and (lower(coalesce(pt.name, '')) like '%ato%' or lower(coalesce(pt.name, '')) like '%sinal%')
    order by eu.id asc, p.due_date asc, p.id asc
    limit ${TETO_ATO_E_SINAL + 1}`,
    codes,
  );

  const cruas = linhas as LinhaDeAtoESinal[];
  const parcial = cruas.length > TETO_ATO_E_SINAL;
  const porUnitId = new Map<string, ParcelaDeAtoESinal[]>();

  for (const linha of cruas.slice(0, TETO_ATO_E_SINAL)) {
    // A régua canônica decide; o LIKE do SQL só reduziu o volume.
    const perfil = perfilDaParcela(linha.parcel_type);
    if (perfil !== "ato" && perfil !== "sinal") continue;

    const situacao = linha.situacao;
    const unitId = String(linha.unit_id);
    const lista = porUnitId.get(unitId) ?? [];
    lista.push({
      // A fatura primeiro, o PDF cru de fallback: a mesma escolha documentada em parcelas-portal.ts.
      boletoUrl: http(linha.payment_url) ?? http(linha.invoice_url),
      diasDeAtraso: numero(linha.dias_atraso),
      id: String(linha.payment_id),
      jaVenceu: numero(linha.ja_venceu) === 1,
      numero: numeroDaParcela({
        parcelaAtual: linha.parcela_n == null ? null : numero(linha.parcela_n),
        parcelaTotal: linha.parcela_total == null ? null : numero(linha.parcela_total),
        sinalAtual: linha.sinal_n == null ? null : numero(linha.sinal_n),
        sinalTotal: linha.sinal_total == null ? null : numero(linha.sinal_total),
        tipo: linha.parcel_type,
      }),
      pagoEm: linha.payment_date,
      pagoNoMes: numero(linha.pago_no_mes) === 1,
      perfil: perfil === "ato" ? "Ato" : "Sinal",
      situacao: situacao === "paga" ? "paga" : situacao === "vencida" ? "vencida" : "a_vencer",
      valor: numero(linha.valor_previsto),
      valorEmAberto: numero(linha.valor_em_aberto),
      valorPago: numero(linha.valor_pago),
      vencimento: linha.due_date,
    });
    porUnitId.set(unitId, lista);
  }

  return { parcial, porUnitId };
}

function unidadeParaOPortal(
  unit: ApoloCarteiraUnit,
  nomePorCode: Map<string, string>,
  liquidoPorUnitId: Map<string, CarteiraPorUnidade>,
  atoESinalPorUnitId: Map<string, ParcelaDeAtoESinal[]> | null,
): UnidadeDoPortal {
  const liquido = liquidoPorUnitId.get(unit.id) ?? null;

  return {
    // O campo só NASCE na sessão comercial (`atoESinalPorUnitId` é `null` fora dela): o payload
    // do incorporador não ganha nem um `atoESinal: undefined`.
    ...(atoESinalPorUnitId
      ? { atoESinal: { parcelas: atoESinalPorUnitId.get(unit.id) ?? [] } }
      : null),
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

  // ⚠️ O RECORTE DO EXTRATO VEM NA URL, e é aplicado NO SERVIDOR. Antes a tela filtrava o que já
  // tinha recebido — e o que ela recebia era um corte de `EXTRATO_TETO` linhas feito ANTES do
  // filtro, então procurar "Paga" ou "Vencida" varria um recorte onde elas não estavam e voltava
  // vazio (Lucas, 20/08/2026).
  //
  // Os valores entram como texto e são normalizados aqui; `situacao` e `ordenarPor` passam por
  // allowlist, porque viram comparação e chave de ordenação lá dentro.
  const SITUACOES = ["a_vencer", "liquidada", "paga", "vencida"] as const;
  const COLUNAS = [
    "cliente",
    "liquido",
    "pagamento",
    "situacao",
    "unidade",
    "valor",
    "vencimento",
  ] as const;

  const texto = (chave: string) => params.get(chave)?.trim() || null;
  const situacaoPedida = texto("situacao");
  const colunaPedida = texto("ordenarPor");

  const filtroDoExtrato: FiltroDoExtrato = {
    ano: texto("ano"),
    busca: texto("q"),
    direcao: params.get("direcao") === "desc" ? "desc" : "asc",
    mes: texto("mes"),
    ordenarPor: COLUNAS.includes(colunaPedida as never)
      ? (colunaPedida as ColunaDoExtrato)
      : undefined,
    perfil: texto("perfil"),
    situacao: SITUACOES.includes(situacaoPedida as never)
      ? (situacaoPedida as SituacaoDaParcela)
      : null,
  };

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

  // ⚠️ SÓ O COOKIE DECIDE (ver o cabeçalho): o recorte de Ato e Sinal com boleto é da sessão
  // COMERCIAL. Nenhum parâmetro de URL liga isto — para o incorporador a leitura nem roda.
  const comercial = ehPortalComercial(auth.sessao.tipo);

  const [bruta, liquida, atoESinal] = await Promise.all([
    loadApoloEnterpriseCarteira(codes),
    carteiraLiquidaDoIncorporador({
      codes,
      // Os KPIs do BI só quando a tela pede: a leitura ampliada (parcelas em aberto) custa mais.
      indicadores: comIndicadores
        ? { agoraMs: Date.now(), filtroDoExtrato, nomePorCode }
        : undefined,
      // Casa o split quando a linha não traz `perfil` — em boa parte das parcelas o único campo
      // presente é a razão social.
      nomeDoIncorporador: auth.sessao.incorporadorNome,
      politicaPorCode,
    }),
    comercial ? parcelasDeAtoESinal(codes) : Promise.resolve(null),
  ]);

  if (atoESinal && "erro" in atoESinal) {
    // Mesma regra do bruto: o detalhe fica no log; o portal recebe o genérico.
    console.error("[incorporador/carteira] falha ao ler ato e sinal:", atoESinal.erro);
    return NextResponse.json(
      { error: "Não foi possível carregar as parcelas agora." },
      { status: 503 },
    );
  }

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
        // SÓ na sessão comercial: `true` = a leitura de Ato e Sinal bateu no teto e a lista NÃO
        // é completa. A tela do coordenador avisa em vez de somar errado calada.
        ...(atoESinal ? { atoESinalParcial: atoESinal.parcial } : null),
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
          unidadeParaOPortal(
            unit,
            nomePorCode,
            liquidoPorUnitId,
            atoESinal ? atoESinal.porUnitId : null,
          ),
        ),
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
