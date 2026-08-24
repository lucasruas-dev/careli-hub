import type { RowDataPacket } from "mysql2/promise";

import { getHadesDbPool } from "@/lib/guardian/db";

// Agregados do BI PÚBLICO de vendas do Vale do Ouro, direto do C2X read-only.
// TUDO agregado — nenhum nome/documento de comprador sai daqui (a página é pública). Nomes de
// IMOBILIÁRIA são públicos por natureza (ranking do lançamento).
// ESTOQUE (vendido/reserva/disponível) = situação da UNIDADE no C2X, ver `SITUACAO_DO_LOTE`.
// VENDA (quem comprou, de qual imobiliária, em que plano) = PROPOSTA viva, ver `VENDA`.
// Ver docs/architecture/c2x-schema-map.md e [[project_apolo_diagnostico_mostqi]].

// A FAMÍLIA VALE DO OURO no C2X (divisão de 03/08, padrão Lagoa Bonita):
//   35 VLO — o master histórico (o masterplan que o corretor enxerga; unidades aposentadas)
//   36 VOL — carteira do Lino    (unidades "externas")
//   37 VOC — carteira do Cecílio (unidades "internas")
// Para o MERCADO é UM lançamento; para a OPERAÇÃO são duas carteiras, com contas de recebimento
// diferentes. Daí os três recortes servidos pelo MESMO código: "todos", "voc" e "vol".
// O 35 não aparece em consulta nenhuma deste arquivo: as unidades dele são as MESMAS de 36/37
// (contá-las dobraria o empreendimento) e as propostas dele são cópias das que vivem nas
// carteiras (ver o bloco das "órfãs" abaixo). Ele segue existindo no C2X como masterplan.
const VOL = 36;
const VOC = 37;
const CARTEIRAS_VIVAS = [VOL, VOC];

export type CarteiraDoVale = "todos" | "voc" | "vol";

/** Aceita o que vier da URL e devolve um recorte válido (padrão: o lançamento inteiro). */
export function normalizarCarteira(valor: unknown): CarteiraDoVale {
  const bruto = typeof valor === "string" ? valor.trim().toLowerCase() : "";
  return bruto === "voc" || bruto === "vol" ? bruto : "todos";
}

// ── AS "ÓRFÃS" DO 35 NÃO ERAM ÓRFÃS: ERAM A MESMA VENDA DUAS VEZES ────────────
// A leitura anterior deste arquivo era que a divisão de 03/08 recriou as propostas nas carteiras
// "menos algumas, que ficaram abertas no 35", e por isso as consultas de proposta varriam os TRÊS
// empreendimentos e atribuíam a proposta do master à carteira do lote gêmeo.
// ⚠️ ERRADO, conferido lote a lote em 09/08: as 8 propostas vivas do master têm gêmeo na carteira
// com a MESMA venda e o MESMO cliente (VLO0104/cliente 4738 <-> VOC0104/cliente 4738, e assim as
// oito). Elas não são vendas que faltavam: são a segunda cópia de vendas que já estão contadas.
// O sintoma na tela: o card dizia 84 vendas no VOC e o ranking de imobiliária somava 89, porque
// 5 vendas entravam duas vezes; no lançamento inteiro, 177 contra 185.
// Agora TODA consulta de proposta olha só as carteiras vivas do recorte (36/37), e o gêmeo saiu
// junto com o master: uma venda, uma linha, no empreendimento onde o dinheiro entra.
// A única proposta do master sem venda no gêmeo é a do VLO0225, cujo lote na carteira está
// carimbado como RESERVADO. Ela fica de fora com razão: pela regra do Lucas quem manda é a
// situação do lote, e contá-la faria o mesmo lote aparecer como reserva na barra e como venda no
// ranking. As 37 reservas abertas no master são resíduo da divisão pelo mesmo motivo (31 têm o
// gêmeo já VENDIDO), e é por isso que reserva também passou a sair da unidade.
const JOIN_UNIDADE = `JOIN enterprise_unities eu ON eu.id = ar.enterprise_unity_id`;

// ── O QUE É ESTOQUE DE VERDADE ────────────────────────────────────────────────
// Das 298 unidades, 108 estão com preço R$ 1,00 e bloqueadas para venda: NUNCA foram postas à
// venda (conferido em 06/08: nenhuma delas tem proposta, e já estavam assim no 35 antes da
// divisão). Contá-las no denominador afunda o percentual — o painel dizia "53% do
// empreendimento" quando, sobre os lotes de fato comercializados, o vendido é 83%.
// Então: COMERCIAL = preço > 1; NÃO LANÇADO = preço <= 1 e bloqueado (vira número à parte, para
// a informação não sumir).
const UNIDADE_COMERCIAL = "eu.price > 1";
const UNIDADE_NAO_LANCADA = "eu.price <= 1 AND eu.sale_blocked = 1";

// ⚠️ `VENDA` continua sendo a PROPOSTA, e continua certo onde é usado: perfil do comprador
// (idade, profissão, cidade, renda), ranking de corretor e o filme do dia saem de
// `acquisition_requests`, porque é lá que o CLIENTE existe — a unidade sozinha não sabe quem
// comprou. O que NÃO pode mais sair daqui é CONTAGEM e VGV de estoque: isso vem da situação do
// lote (ver `SITUACAO_DO_LOTE`), senão a mesma tela mostra dois números para a mesma coisa.
//
// 🔴 A VENDA QUE ANDA PARA A FRENTE SOME. Achado em 09/08 conferindo o vigia: o VOC tinha 41
// propostas em "Em assinatura" (etapa 5) e a regra antiga só olhava 3 e 9 — ou seja, o ranking de
// imobiliária, o perfil do comprador e a cobrança enxergavam 43 vendas onde havia 84. Não era
// proposta cancelada: era proposta que PROGREDIU e caiu fora do filtro. Com 3,4,5,6,9 o VOC fecha
// 84 = 84 unidades vendidas e o VOL 93 = 93.
// ✅ CONFIRMADO PELO LUCAS EM 10/08, quando mostrei as 41: "tudo que estiver em proposta, contrato
// gerado e assinatura, vamos contar como vendido" — ou seja 9, 3 e 5. Junto com elas ficam 4
// (Faturado) e 6 (Finalizado), que são etapas ADIANTE da assinatura: fora da lista, a venda
// sumiria do painel no dia em que fosse faturada, que é exatamente o defeito que ele mandou tirar.
// O que NÃO é venda fica de fora de propósito: 1 (Reservado) é reserva, 2 (Análise de crédito)
// ainda não é venda, e 7/8/10/11 (cancelado, reprovado, distrato) são as mortas. Se o C2X ganhar
// etapa nova, ela cai fora até alguém pôr aqui — e o `coerencia` do payload acusa a diferença no
// dia seguinte, que é exatamente para isso que ele serve.
const VENDA = "ar.open = 1 AND ar.acquisition_request_stage_id IN (3, 4, 5, 6, 9)";
const RESERVA_VIVA = "ar.open = 1 AND ar.acquisition_request_stage_id = 1";
// As mortas, que são o motivo do vigia existir: proposta cancelada não desfaz o carimbo sozinha.
const PROPOSTA_MORTA = "ar.acquisition_request_stage_id IN (7, 8, 10, 11)";

// ── A SITUAÇÃO DO LOTE VEM DO C2X, NÃO DA PROPOSTA ────────────────────────────
// ⚠️ REGRA DO LUCAS, 09/08, depois de comparar o painel com a tela do C2X lado a lado:
//   "existe somente os status: Vendido - Reserva - Disponível. No C2X tudo que estiver em
//    Negociação e Vendido, no BI vira vendido, o Reserva é reserva e o disponível é disponível."
//
// O QUE ESTAVA ERRADO: o painel contava pela PROPOSTA (contrato gerado / proposta realizada) e a
// tela do C2X mostra o `sale_status_id` do CADASTRO. Os dois não são atualizados juntos: no VOL há
// 93 lotes com contrato gerado cuja unidade continua carimbada "Em negociação", ninguém deu baixa.
// Resultado: o BI dizia 96 vendidos, 4 reservas e 2 disponíveis; o C2X mostrava 93 em negociação,
// 1 reserva e 6 disponíveis. Duas telas da mesma empresa, dois números, e o corretor no meio.
//
// AGORA a fonte é uma só, a do C2X — é ela que o corretor vê no masterplan na hora de oferecer:
//   3 (Em negociação) + 4 (Vendido) -> VENDIDO      2 (Reservado) -> RESERVA
//   1 (Disponível)                  -> DISPONÍVEL   5 (Bloqueado) -> bloqueado, à parte
// Conferido nos três: VOL 93+1+6=100 · VOC 84+1+5=90 · VLO 149+37+4=190. Os dois totais que o
// Lucas já conhecia (100 e 190) fecham sozinhos, o que é a melhor validação que essa regra podia ter.
//
// O 5 (Bloqueado) sai nomeado em vez de cair no ELSE. Hoje ele NÃO aparece na barra: as 216
// unidades bloqueadas do lançamento estão todas a R$ 1,00 e já saem antes pelo `UNIDADE_COMERCIAL`
// (viram "não lançadas", o número à parte). Mas basta alguém bloquear um lote COM preço para o
// ELSE anunciar como disponível um lote que ninguém pode vender, e o corretor descobrir no salão.
const SITUACAO_DO_LOTE = `CASE
           WHEN eu.sale_status_id IN (3, 4) THEN 'Vendido'
           WHEN eu.sale_status_id = 2       THEN 'Reservado'
           WHEN eu.sale_status_id = 5       THEN 'Bloqueado para venda'
           ELSE 'Disponível' END`;

// ── HISTÓRICO: por que este arquivo já contou de dois jeitos ─────────────────
// 07/08 o Lucas achou que o estoque não fechava ("tínhamos somente 190 lotes para venda"), e a
// correção da época foi contar o LOTE em vez da PROPOSTA, mas ainda decidindo o desfecho pelas
// propostas do lote. 09/08 ele fechou a regra de vez, comparando com a tela do C2X: a situação
// vem do cadastro da unidade, não da proposta (ver `SITUACAO_DO_LOTE` acima). A função
// `PROPOSTA_DO_LOTE`, que casava o lote com o gêmeo no master pelo número, saiu junto — o
// `sale_status_id` já vive na unidade e não precisa de gêmeo para ser lido.

type Linha = RowDataPacket & Record<string, unknown>;

export type BiValeDoOuro = Awaited<ReturnType<typeof montarBiValeDoOuro>>;

/**
 * Recorte do BI: os empreendimentos que este painel enxerga. UMA lista só, usada tanto para
 * contar unidade quanto para contar proposta — é o que garante que o card do topo e o ranking
 * falem do mesmo universo. O master (35) nunca entra: unidade dele é cópia, proposta dele é cópia.
 */
export function recorteDaCarteira(carteira: CarteiraDoVale) {
  const empresa = carteira === "voc" ? VOC : carteira === "vol" ? VOL : null;

  return {
    listaUnidades: empresa === null ? CARTEIRAS_VIVAS.join(", ") : String(empresa),
  };
}

// ── O VIGIA ───────────────────────────────────────────────────────────────────
// Pedido do Lucas, 09/08, no mesmo minuto em que fechou a regra nova:
//   "proposta podem ser canceladas, temos que ficar de olho nas atualizações".
// Ele tem razão e o risco é da própria regra: contando pela SITUAÇÃO DA UNIDADE, uma proposta
// cancelada sem baixa no cadastro deixa o lote carimbado "Vendido" para sempre — e o painel
// mostraria um lote vendido que na verdade voltou para a prateleira. A regra antiga tinha o
// problema espelhado (venda que anda para a frente sumia). Nenhuma das duas fontes é confiável
// sozinha, então o painel conta por uma e VIGIA a outra.
//
// Quatro números, todos contados só nas carteiras vivas (o master 35 fica de fora de propósito:
// as propostas dele foram recriadas em VOC/VOL na divisão, então lá "sem proposta" é o normal,
// não é erro — ele é espelho de status, ver espelhar-status-vale-do-ouro.mjs):
//   • carimboSemVenda — lote Vendido/Em negociação sem NENHUMA proposta de venda viva. É o caso
//     que o Lucas antecipou: proposta caiu, ninguém liberou o lote.
//   • vendaSemCarimbo — o inverso: proposta de venda viva num lote que o cadastro não carimbou.
//   • reservaSemLastro — lote Reservado sem proposta em etapa de reserva.
//   • morteDepoisDoCarimbo — dos casos acima, aqueles em que a proposta MORREU depois da última
//     mexida na unidade. É o mais forte dos quatro: prova ordem no tempo, não só ausência.
// Medido em 09/08 nas duas carteiras: 0, 0, 0, 0 — o time está dando baixa direito (as 9
// unidades que voltaram a Disponível depois de cancelamento provam o processo funcionando).
// Qualquer número diferente de zero aqui é lote pendurado, e o painel está mentindo naquele lote.
/** SQL do vigia. Recebe a lista de unidades do recorte — nunca o master. */
export function sqlDaCoerencia(listaUnidades: string) {
  return `SELECT
       SUM(CASE WHEN eu.sale_status_id IN (3, 4) AND COALESCE(p.venda, 0) = 0
                THEN 1 ELSE 0 END) carimbo_sem_venda,
       SUM(CASE WHEN eu.sale_status_id NOT IN (3, 4) AND COALESCE(p.venda, 0) > 0
                THEN 1 ELSE 0 END) venda_sem_carimbo,
       SUM(CASE WHEN eu.sale_status_id = 2 AND COALESCE(p.reserva, 0) = 0
                THEN 1 ELSE 0 END) reserva_sem_lastro,
       SUM(CASE WHEN eu.sale_status_id IN (2, 3, 4) AND COALESCE(p.venda, 0) = 0
                 AND COALESCE(p.reserva, 0) = 0 AND p.morte > eu.updated_at
                THEN 1 ELSE 0 END) morte_depois_do_carimbo
     FROM enterprise_unities eu
     LEFT JOIN (SELECT ar.enterprise_unity_id uid,
                       SUM(${VENDA}) venda,
                       SUM(${RESERVA_VIVA}) reserva,
                       MAX(CASE WHEN ${PROPOSTA_MORTA} THEN ar.updated_at END) morte
                  FROM acquisition_requests ar GROUP BY 1) p ON p.uid = eu.id
     WHERE eu.enterprise_id IN (${listaUnidades}) AND ${UNIDADE_COMERCIAL}`;
}

export async function montarBiValeDoOuro(
  carteira: CarteiraDoVale = "todos",
  // GENERALIZAÇÃO (24/08): os relatórios do LANÇAMENTO reusam este motor inteiro apontando
  // para o empreendimento do evento — todas as consultas já saem de `listaUnidades`, então o
  // recorte custom é um ponto só. Sem o parâmetro, o BI do Vale segue idêntico.
  enterpriseIdCustom?: number,
) {
  const poolResult = getHadesDbPool();
  if (!poolResult.ok) throw new Error("C2X indisponível.");
  const { pool } = poolResult;

  const { listaUnidades } =
    enterpriseIdCustom && Number.isFinite(enterpriseIdCustom)
      ? { listaUnidades: String(enterpriseIdCustom) }
      : recorteDaCarteira(carteira);

  const q = async (sql: string): Promise<Linha[]> => {
    const [rows] = await pool.query<Linha[]>(sql);
    return rows;
  };

  // Base das consultas de PROPOSTA. `joins` entra antes do WHERE — é onde cada consulta pendura
  // a sua dimensão (imobiliária, plano, sexo, cidade…), sem repetir o recorte de carteira.
  // O universo é o MESMO `listaUnidades` das consultas de unidade: proposta e lote contados sobre
  // os mesmos empreendimentos, senão o ranking soma mais que o card do topo.
  const de = (joins = "") => `FROM acquisition_requests ar
     ${JOIN_UNIDADE}
     LEFT JOIN users cli ON cli.id = ar.client_id
     ${joins}
     WHERE eu.enterprise_id IN (${listaUnidades})`;

  const [
    unidades,
    statusUnidades,
    vendas,
    reservas,
    rankingImob,
    planos,
    parcelasEntrada,
    sexo,
    estadoCivil,
    idades,
    profissoes,
    faixaSalarial,
    vendasHoje,
  ] = await Promise.all([
    q(`SELECT COUNT(*) total,
         SUM(CASE WHEN ${UNIDADE_COMERCIAL} THEN 1 ELSE 0 END) comerciais,
         SUM(CASE WHEN ${UNIDADE_NAO_LANCADA} THEN 1 ELSE 0 END) nao_lancadas
       FROM enterprise_unities eu WHERE eu.enterprise_id IN (${listaUnidades})`),
    // O estoque que o painel mostra é o COMERCIAL: percentual e "ainda disponíveis" falam dos
    // lotes de fato postos à venda.
    q(`SELECT ${SITUACAO_DO_LOTE} status,
         COUNT(*) qtd, ROUND(SUM(eu.price)) vgv
       FROM enterprise_unities eu
       WHERE eu.enterprise_id IN (${listaUnidades}) AND ${UNIDADE_COMERCIAL} GROUP BY 1`),
    // UNIDADES VENDIDAS / VGV / TICKET — o card do topo. Também pela situação do lote, senão o
    // card diria 96 (proposta) e a barra logo abaixo diria 93 (situação): a mesma divergência que
    // o Lucas achou entre as duas telas, agora dentro da MESMA tela.
    q(`SELECT COUNT(*) unidades, ROUND(SUM(eu.price)) vgv, ROUND(AVG(eu.price)) ticket
       FROM enterprise_unities eu
       WHERE eu.enterprise_id IN (${listaUnidades}) AND ${UNIDADE_COMERCIAL}
         AND eu.sale_status_id IN (3, 4)`),
    // Reservas ativas: mesma fonte do estoque (a situação do lote no C2X), senão o card do topo
    // contaria por proposta e a barra por situação — dois números para a mesma coisa, na mesma tela.
    q(`SELECT COUNT(*) unidades, ROUND(SUM(eu.price)) vgv
       FROM enterprise_unities eu
       WHERE eu.enterprise_id IN (${listaUnidades}) AND ${UNIDADE_COMERCIAL}
         AND eu.sale_status_id = 2`),
    // 🪦 O DUELO Cecílio x Lino saiu daqui em 10/08 junto com o BI unificado ("não tem mais esse
    // BI junto, agora está separado"): ele só existia naquela tela. Cada painel agora fala da sua
    // carteira, e comparar as duas é somar dois links. Uma consulta a menos por ciclo de 60s.
    q(`SELECT COALESCE(NULLIF(TRIM(imo.fantasy_name),''), NULLIF(TRIM(imo.name),''), '(sem imobiliária)') imob,
       COUNT(*) vendas, ROUND(SUM(eu.price)) vgv
       ${de("LEFT JOIN users imo ON imo.id = cli.vinculed_by_id")}
       AND ${VENDA} GROUP BY 1 ORDER BY vendas DESC, vgv DESC LIMIT 25`),
    q(`SELECT CASE WHEN ar.custom_commercial_plan = 1 THEN 'Plano customizado'
         WHEN UPPER(TRIM(COALESCE(cp.name,''))) IN ('PLANO NORMAL','NORMAL','PLANO-NORMAL') THEN 'Plano Normal'
         ELSE COALESCE(NULLIF(TRIM(cp.name),''), 'Sem plano') END plano, COUNT(*) qtd
       ${de("LEFT JOIN commercial_plans cp ON cp.id = ar.commercial_plan_id")}
       AND ${VENDA} GROUP BY 1 ORDER BY qtd DESC`),
    q(`SELECT COALESCE(ar.quantity_signal_parcels, 0) parcelas, COUNT(*) qtd
       ${de()} AND ${VENDA} GROUP BY 1 ORDER BY 1`),
    q(`SELECT COALESCE(sx.name, 'Não informado') k, COUNT(*) qtd
       ${de("LEFT JOIN sexes sx ON sx.id = cli.sex_id")}
       AND ${VENDA} GROUP BY 1 ORDER BY qtd DESC`),
    q(`SELECT COALESCE(cs.name, 'Não informado') k, COUNT(*) qtd
       ${de("LEFT JOIN civil_states cs ON cs.id = cli.civil_state_id")}
       AND ${VENDA} GROUP BY 1 ORDER BY qtd DESC`),
    q(`SELECT CASE
         WHEN cli.birthday IS NULL THEN 'Não informado'
         WHEN TIMESTAMPDIFF(YEAR, cli.birthday, CURDATE()) < 25 THEN 'Até 24'
         WHEN TIMESTAMPDIFF(YEAR, cli.birthday, CURDATE()) < 35 THEN '25 a 34'
         WHEN TIMESTAMPDIFF(YEAR, cli.birthday, CURDATE()) < 45 THEN '35 a 44'
         WHEN TIMESTAMPDIFF(YEAR, cli.birthday, CURDATE()) < 55 THEN '45 a 54'
         ELSE '55+' END k, COUNT(*) qtd ${de()} AND ${VENDA} GROUP BY 1`),
    q(`SELECT COALESCE(NULLIF(TRIM(p.name),''), 'Não informado') k, COUNT(*) qtd
       ${de("LEFT JOIN professions p ON p.id = cli.profession_id")}
       AND ${VENDA} GROUP BY 1 ORDER BY qtd DESC LIMIT 6`),
    q(`SELECT COALESCE(NULLIF(TRIM(sr.name),''), 'Não informado') k, COUNT(*) qtd
       ${de("LEFT JOIN salary_ranges sr ON sr.id = cli.salary_range_id")}
       AND ${VENDA} GROUP BY 1 ORDER BY qtd DESC`),
    q(`SELECT DATE_FORMAT(ar.created_at, '%H:00') hora, COUNT(*) qtd
       ${de()} AND ${VENDA} AND DATE(ar.created_at) = CURDATE() GROUP BY 1 ORDER BY 1`),
  ]);

  // Onde o comprador MORA (endereço real via addresses→cities, não a naturalidade).
  const cidades = await q(`SELECT CONCAT(ci.name, '/', st.acronym) k, COUNT(*) qtd
     ${de(`LEFT JOIN addresses ad ON ad.ownertable_type = 'User' AND ad.ownertable_id = cli.id
           LEFT JOIN cities ci ON ci.id = ad.city_id
           LEFT JOIN states st ON st.id = ad.state_id`)}
     AND ${VENDA} AND ci.name IS NOT NULL GROUP BY 1 ORDER BY qtd DESC LIMIT 6`);

  // Pós-venda e investidores (agregados leves; o CDN segura 60s).
  const [contratos, cobranca, investidores, coerencia] = await Promise.all([
    q(`SELECT COUNT(DISTINCT arc.acquisition_request_id) gerados
       FROM acquisition_request_contracts arc
       JOIN acquisition_requests ar ON ar.id = arc.acquisition_request_id
       ${JOIN_UNIDADE}
       WHERE eu.enterprise_id IN (${listaUnidades}) AND ${VENDA}`),
    // Entrada = Ato (1) + Sinal (2); liquidado = status 5. payment_to_delete fica de fora.
    q(`SELECT COUNT(DISTINCT p.acquisition_request_id) vendas_com_cobranca,
       ROUND(SUM(p.initial_value)) entrada_gerada,
       ROUND(SUM(CASE WHEN p.payment_status_id = 5 THEN COALESCE(p.paid_value, p.initial_value) ELSE 0 END)) liquidado
       FROM payments p
       JOIN acquisition_requests ar ON ar.id = p.acquisition_request_id
       ${JOIN_UNIDADE}
       WHERE eu.enterprise_id IN (${listaUnidades}) AND ${VENDA}
         AND p.parcel_type_id IN (1, 2) AND COALESCE(p.payment_to_delete, 0) = 0`),
    // `propostas` e `vgv_proposta` são o TOTAL do universo de proposta, e existem para servir de
    // DENOMINADOR aos percentuais que contam proposta (perfil do comprador, peso do investidor).
    // Antes a tela dividia numerador de proposta pelo card de venda, que hoje conta LOTE: enquanto
    // os dois empatam (84 e 93 hoje) ninguém vê nada, mas no dia em que um lote atrasar o carimbo
    // o perfil imprime percentual acima de 100%. Saem do mesmo SELECT, sem consulta a mais.
    q(`SELECT COUNT(*) titulares, SUM(lotes) propostas, ROUND(SUM(vgv)) vgv_proposta,
       SUM(CASE WHEN lotes >= 2 THEN 1 ELSE 0 END) multi_lote,
       SUM(CASE WHEN lotes >= 2 THEN lotes ELSE 0 END) unidades_multi,
       ROUND(SUM(CASE WHEN lotes >= 2 THEN vgv ELSE 0 END)) vgv_multi,
       MAX(lotes) maior_lotes
       FROM (SELECT ar.client_id, COUNT(*) lotes, SUM(eu.price) vgv ${de()} AND ${VENDA}
             GROUP BY ar.client_id) t`),
    q(sqlDaCoerencia(listaUnidades)),
  ]);

  const u = unidades[0];
  const c = coerencia[0];

  return {
    carteira,
    cidades,
    cobranca: cobranca[0] ?? null,
    // O VIGIA (ver `sqlDaCoerencia`): quantos lotes discordam da própria proposta. Tudo zero =
    // painel e C2X contando a mesma coisa. São números, não nomes — pode viajar na rota pública.
    coerencia: {
      carimboSemVenda: Number(c?.carimbo_sem_venda ?? 0),
      morteDepoisDoCarimbo: Number(c?.morte_depois_do_carimbo ?? 0),
      reservaSemLastro: Number(c?.reserva_sem_lastro ?? 0),
      vendaSemCarimbo: Number(c?.venda_sem_carimbo ?? 0),
    },
    contratos: contratos[0] ?? null,
    estadoCivil,
    faixaSalarial,
    geradoEm: new Date().toISOString(),
    idades,
    investidores: investidores[0] ?? null,
    parcelasEntrada,
    planos,
    profissoes,
    rankingImob,
    reservas: reservas[0] ?? null,
    sexo,
    statusUnidades,
    // Estoque separado: o painel fala dos COMERCIAIS; os não lançados ficam à vista, à parte.
    unidades: {
      comerciais: Number(u?.comerciais ?? 0),
      naoLancadas: Number(u?.nao_lancadas ?? 0),
      total: Number(u?.total ?? 0),
    },
    vendas: vendas[0] ?? null,
    vendasHoje,
  };
}
