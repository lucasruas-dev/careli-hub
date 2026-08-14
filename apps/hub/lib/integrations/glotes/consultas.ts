// LEITURA DA CARTEIRA LAVRA DO OURO PARA O GLOTES (C2X, read-only).
//
// O contrato com o cliente é `docs/integrations/glotes-openapi.yaml`; o levantamento campo a campo,
// feito contra a base real em 07/08/2026, é `docs/integrations/glotes-lavra-do-ouro.md`. Este
// arquivo implementa aquilo, e cada decisão estranha aqui tem explicação lá.
//
// TRÊS CONVENÇÕES QUE NÃO PODEM SER QUEBRADAS (estão no cabeçalho do OpenAPI):
//   1. DINHEIRO É STRING DECIMAL com duas casas. Somar 68 mil parcelas em ponto flutuante diverge
//      do fechamento em centavos. O MySQL já devolve `decimal` como string; o trabalho aqui é não
//      transformar em número no meio do caminho.
//   2. DOCUMENTO E CEP SÓ COM DÍGITOS. Na origem vêm com máscara (`000.000.000-00`, `00.000-000`).
//   3. TODO CAMPO PEDIDO APARECE NA RESPOSTA, inclusive os que não temos — como `null`, e
//      documentados no contrato. Omitir empurra a descoberta para o meio da integração do cliente.
//
// ESCOPO É DO SERVIDOR, NUNCA DO CLIENTE. A API enxerga só os enterprises 1 e 4 (as duas glebas do
// Lavra do Ouro). Não existe parâmetro de loteamento: mesmo que o GLOTES peça outro, não há por
// onde pedir. É a diferença entre um filtro e uma trava.
import type { RowDataPacket } from "mysql2";

import { getHadesDbPool } from "@/lib/guardian/db";

/** As duas glebas do Lavra do Ouro no C2X. Trava de escopo, não filtro. */
const ENTERPRISES = [1, 4];

/**
 * O cliente enxerga UM loteamento.
 *
 * No C2X são dois `enterprises` (1 = LOU, 4 = LOS) com o MESMO nome, "LAVRA DO OURO" — e é assim
 * que o contrato foi fechado com o GLOTES: um loteamento só, 493 unidades. O prefixo LOU/LOS que
 * aparece no código do lote é histórico e não corresponde a este código; o OpenAPI avisa isso ao
 * cliente com todas as letras, para ninguém tentar derivar o loteamento do prefixo.
 */
const LOTEAMENTO = { codigo: "LAVRA", nome: "LAVRA DO OURO" };

/** Status de parcela que contam como carteira: 5 Pago, 6 Aguardando pagamento, 7 Atrasado. */
const STATUS_ATIVOS = [5, 6, 7];

/**
 * Recebimentos = SÓ O PARCELAMENTO (`parcel_type_id = 3`).
 *
 * Decisão do Lucas (14/08): "a parte financeira é somente do parcelamento, não entra o ato e nem
 * o sinal". Ato e Sinal são a ENTRADA do contrato, e a entrada já é descrita no conjunto
 * `vendas` (`qtd_sinal`, `valor_sinal`, `data_sinal`). Mandá-los também como recebimento faria o
 * GLOTES contar a entrada duas vezes: uma no resumo da venda e outra na régua de parcelas.
 *
 * Efeito no volume: 66.805 linhas em vez de 68.356 (saem 1.076 de Sinal, 474 de Ato e 1 Avulso).
 */
const TIPO_PARCELAMENTO = 3;

const LIMITE_PADRAO = 500;
const LIMITE_MAXIMO = 1000;

export type Pagina<T> = {
  dados: T[];
  proxima_pagina: null | string;
  total: number;
};

export type Filtros = {
  alteradoDesde?: null | string;
  codigoVenda?: null | string;
  cursor?: null | string;
  incluirCanceladas?: boolean;
  limite?: null | number;
  statusParcela?: null | string;
  vencimentoAte?: null | string;
  vencimentoDe?: null | string;
};

// --- utilidades de formato ----------------------------------------------------------------------

/** Só dígitos. CPF, CNPJ e CEP saem sem máscara: máscara é decisão de exibição, não de dado. */
function digitos(valor: unknown): null | string {
  const limpo = String(valor ?? "").replace(/\D/g, "");
  return limpo.length > 0 ? limpo : null;
}

function texto(valor: unknown): null | string {
  const limpo = String(valor ?? "").trim().replace(/\s+/g, " ");
  return limpo.length > 0 ? limpo : null;
}

/**
 * Dinheiro: string decimal com DUAS casas, ou null.
 *
 * O driver devolve `decimal` como string ("1187.34"), e é assim que ela deve sair. A conversão
 * para Number aqui só existe para normalizar a quantidade de casas quando a origem varia; o valor
 * volta a ser texto imediatamente.
 */
function dinheiro(valor: unknown): null | string {
  if (valor === null || valor === undefined || valor === "") return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero.toFixed(2) : null;
}

/** Decimal livre (área, percentual): mantém o que a origem tem, sem forçar duas casas. */
function decimal(valor: unknown, casas: number): null | string {
  if (valor === null || valor === undefined || valor === "") return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero.toFixed(casas) : null;
}

/** Data ISO curta (yyyy-mm-dd) ou null. A consulta já formata; aqui é rede de segurança. */
function data(valor: unknown): null | string {
  const bruto = String(valor ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(bruto) ? bruto : null;
}

// --- cursor -------------------------------------------------------------------------------------

/**
 * Cursor OPACO por id crescente.
 *
 * Opaco de propósito: o contrato manda o cliente repassar o valor sem interpretar, para o formato
 * poder mudar. Paginar por id (e não por OFFSET) mantém a página estável mesmo com escrita
 * concorrente na origem — com OFFSET, uma linha inserida no meio faz a próxima página pular
 * registro, e numa carga de 68 mil parcelas isso passa despercebido.
 */
function lerCursor(cursor: null | string | undefined): number {
  if (!cursor) return 0;
  try {
    const cru = Buffer.from(cursor, "base64url").toString("utf8");
    const [marca, id] = cru.split(":");
    const numero = Number(id);
    return marca === "id" && Number.isFinite(numero) && numero >= 0 ? numero : 0;
  } catch {
    return 0;
  }
}

function escreverCursor(id: number): string {
  return Buffer.from(`id:${id}`, "utf8").toString("base64url");
}

export function cursorValido(cursor: null | string | undefined): boolean {
  if (!cursor) return true;
  try {
    const cru = Buffer.from(cursor, "base64url").toString("utf8");
    return /^id:\d+$/.test(cru);
  } catch {
    return false;
  }
}

function limiteDe(limite: null | number | undefined): number {
  if (!limite || !Number.isFinite(limite)) return LIMITE_PADRAO;
  return Math.min(Math.max(Math.trunc(limite), 1), LIMITE_MAXIMO);
}

async function consultar<T extends RowDataPacket>(
  sql: string,
  params: unknown[],
): Promise<T[]> {
  const pool = getHadesDbPool();
  if (!pool.ok) {
    throw new Error(`Configuração do C2X ausente: ${pool.missing.join(", ")}.`);
  }
  const [linhas] = await pool.pool.query<T[]>(sql, params);
  return linhas;
}

async function contar(sql: string, params: unknown[]): Promise<number> {
  const linhas = await consultar<RowDataPacket & { total: number }>(sql, params);
  return Number(linhas[0]?.total ?? 0);
}

// --- 1. loteamentos -----------------------------------------------------------------------------

export async function listarLoteamentos(): Promise<Pagina<unknown>> {
  // Uma linha, fixa. Não vale ir ao banco: as duas glebas do C2X são apresentadas como UM
  // loteamento (decisão do contrato), então a resposta não depende do estado da base.
  return {
    dados: [{ codigo_loteamento: LOTEAMENTO.codigo, nome: LOTEAMENTO.nome }],
    proxima_pagina: null,
    total: 1,
  };
}

// --- 2. clientes --------------------------------------------------------------------------------

type ClienteRow = RowDataPacket & {
  bairro: null | string;
  cep: null | string;
  cidade: null | string;
  cnpj: null | string;
  codigo_cliente: null | string;
  complemento: null | string;
  conjuge_cpf: null | string;
  conjuge_nome: null | string;
  cpf: null | string;
  fantasy_name: null | string;
  id: number;
  logradouro: null | string;
  name: null | string;
  numero: null | string;
  person_type_id: null | number;
  social_name: null | string;
  uf: null | string;
};

/**
 * Quem é cliente: titular de venda das duas glebas.
 *
 * ⚠️ `addresses` e `spouses` são POLIMÓRFICAS (`ownertable_type`/`ownertable_id`). Sem o filtro
 * `= 'User'` a consulta traz endereço de EMPREENDIMENTO junto e multiplica as linhas. Conferido:
 * cada cliente tem exatamente um endereço, então o `left join` não duplica.
 */
const CLIENTES_DO_RECORTE = `
  u.id in (
    select distinct ar.client_id
      from acquisition_requests ar
      join enterprise_unities eu on eu.id = ar.enterprise_unity_id
     where eu.enterprise_id in (?)
       and ar.client_id is not null`;

export async function listarClientes(filtros: Filtros): Promise<Pagina<unknown>> {
  const limite = limiteDe(filtros.limite);
  const desde = lerCursor(filtros.cursor);
  const abertas = filtros.incluirCanceladas ? "" : "and ar.open = 1";
  const doRecorte = `${CLIENTES_DO_RECORTE} ${abertas})`;

  const total = await contar(
    `select count(*) as total from users u where ${doRecorte}`,
    [ENTERPRISES],
  );

  const linhas = await consultar<ClienteRow>(
    `select
       u.id,
       u.user_code as codigo_cliente,
       u.name,
       u.social_name,
       u.fantasy_name,
       u.cpf,
       u.cnpj,
       u.person_type_id,
       en.address as logradouro,
       en.number as numero,
       en.complement as complemento,
       en.district as bairro,
       en.zipcode as cep,
       ci.name as cidade,
       st.acronym as uf,
       sp.name as conjuge_nome,
       sp.cpf as conjuge_cpf
     from users u
     left join addresses en on en.ownertable_id = u.id and en.ownertable_type = 'User'
     left join cities ci on ci.id = en.city_id
     left join states st on st.id = en.state_id
     left join spouses sp on sp.ownertable_id = u.id and sp.ownertable_type = 'User'
     where ${doRecorte}
       and u.id > ?
     order by u.id
     limit ?`,
    [ENTERPRISES, desde, limite],
  );

  const dados = linhas.map((linha) => {
    const pj = Number(linha.person_type_id) === 2;
    const endereco = [texto(linha.logradouro), texto(linha.numero), texto(linha.complemento)]
      .filter(Boolean)
      .join(", ");

    return {
      bairro: texto(linha.bairro),
      cep: digitos(linha.cep),
      cidade: texto(linha.cidade),
      codigo_cliente: texto(linha.codigo_cliente),
      conjuge_cpf: digitos(linha.conjuge_cpf),
      conjuge_nome: texto(linha.conjuge_nome),
      cpf_cnpj: pj ? digitos(linha.cnpj) : digitos(linha.cpf),
      endereco: endereco || null,
      // Em PJ o `name` traz a pessoa física representante; a razão social vive em `social_name`.
      nome: texto(linha.name),
      nome_fantasia: pj ? texto(linha.fantasy_name) : null,
      razao_social: pj ? texto(linha.social_name) : null,
      tipo_pessoa: pj ? "J" : "F",
      uf: texto(linha.uf),
    };
  });

  const ultimo = linhas[linhas.length - 1];
  return {
    dados,
    proxima_pagina: linhas.length === limite && ultimo ? escreverCursor(Number(ultimo.id)) : null,
    total,
  };
}

// --- 3. lotes -----------------------------------------------------------------------------------

type LoteRow = RowDataPacket & {
  area: null | number | string;
  block: null | string;
  codigo_lote: null | string;
  id: number;
  lot: null | string;
  price: null | number | string;
  sale_blocked: null | number;
  secured_lot: null | number;
  status: null | string;
};

export async function listarLotes(filtros: Filtros): Promise<Pagina<unknown>> {
  const limite = limiteDe(filtros.limite);
  const desde = lerCursor(filtros.cursor);

  const total = await contar(
    "select count(*) as total from enterprise_unities where enterprise_id in (?)",
    [ENTERPRISES],
  );

  const linhas = await consultar<LoteRow>(
    `select
       eu.id,
       eu.name as codigo_lote,
       eu.block,
       eu.lot,
       eu.price,
       eu.area,
       eu.sale_blocked,
       eu.secured_lot,
       ss.name as status
     from enterprise_unities eu
     left join sale_statuses ss on ss.id = eu.sale_status_id
     where eu.enterprise_id in (?)
       and eu.id > ?
     order by eu.id
     limit ?`,
    [ENTERPRISES, desde, limite],
  );

  const dados = linhas.map((linha) => ({
    area_total: decimal(linha.area, 2),
    bloqueado_para_venda: Number(linha.sale_blocked) === 1,
    codigo_loteamento: LOTEAMENTO.codigo,
    codigo_lote: texto(linha.codigo_lote),
    // Decisão do Lucas (14/08), fechando a pendência P1: "vamos mandar somente o tamanho do lote
    // como um todo, o que temos hoje". Ou seja, `area_total` e nada de medidas de lado.
    //
    // Elas não existem no C2X — estão no memorial descritivo e na matrícula, que são documentos e
    // não campos, e extrair das 493 unidades seria um projeto à parte. Saem nulas e documentadas
    // em vez de omitidas, para o cliente não descobrir isso no meio da integração.
    frente: null,
    fundo: null,
    lado_direito: null,
    lado_esquerdo: null,
    lado5: null,
    lado6: null,
    lote: texto(linha.lot),
    lote_caucionado: Number(linha.secured_lot) === 1,
    quadra: texto(linha.block),
    status: texto(linha.status),
    valor: dinheiro(linha.price),
  }));

  const ultimo = linhas[linhas.length - 1];
  return {
    dados,
    proxima_pagina: linhas.length === limite && ultimo ? escreverCursor(Number(ultimo.id)) : null,
    total,
  };
}

// --- 4. vendas ----------------------------------------------------------------------------------

type VendaRow = RowDataPacket & {
  act_date: null | string;
  codigo_cliente: null | string;
  codigo_lote: null | string;
  data_1o_vencimento: null | string;
  data_sinal: null | string;
  id: number;
  indice: null | string;
  price: null | number | string;
  qtd_parcelas: null | number;
  qtd_sinal: null | number;
  situacao: null | string;
  valor_parcela_unico: null | number | string;
  valor_sinal: null | number | string;
};

export async function listarVendas(filtros: Filtros): Promise<Pagina<unknown>> {
  const limite = limiteDe(filtros.limite);
  const desde = lerCursor(filtros.cursor);
  const abertas = filtros.incluirCanceladas ? "" : "and ar.open = 1";
  const alterado = filtros.alteradoDesde ? "and ar.updated_at >= ?" : "";

  const paramsBase: unknown[] = [ENTERPRISES];
  if (filtros.alteradoDesde) paramsBase.push(filtros.alteradoDesde);

  const total = await contar(
    `select count(*) as total
       from acquisition_requests ar
       join enterprise_unities eu on eu.id = ar.enterprise_unity_id
      where eu.enterprise_id in (?) ${abertas} ${alterado}`,
    paramsBase,
  );

  // As contagens de parcela são CONTADAS, não lidas das colunas declaradas: `total_parcels` e
  // `quantity_signal_parcels` divergem da realidade em 4 e 12 das 475 vendas. E `valor_parcela` só
  // existe quando TODAS as mensais do contrato têm o mesmo valor (7 de 474): no resto o reajuste
  // já vem embutido no cronograma, e um valor único seria invenção.
  const linhas = await consultar<VendaRow>(
    `select
       ar.id,
       cli.user_code as codigo_cliente,
       eu.name as codigo_lote,
       eu.price,
       date_format(ar.act_date, '%Y-%m-%d') as act_date,
       date_format(ar.first_signal_payment, '%Y-%m-%d') as data_sinal,
       st.name as situacao,
       imc.name as indice,
       (select count(*) from payments p
         where p.acquisition_request_id = ar.id and p.parcel_type_id = 3
           and coalesce(p.payment_to_delete, 0) = 0) as qtd_parcelas,
       (select count(*) from payments p
         where p.acquisition_request_id = ar.id and p.parcel_type_id = 2
           and coalesce(p.payment_to_delete, 0) = 0) as qtd_sinal,
       (select sum(p.initial_value) from payments p
         where p.acquisition_request_id = ar.id and p.parcel_type_id = 2
           and coalesce(p.payment_to_delete, 0) = 0) as valor_sinal,
       (select date_format(min(p.due_date), '%Y-%m-%d') from payments p
         where p.acquisition_request_id = ar.id and p.parcel_type_id = 3
           and coalesce(p.payment_to_delete, 0) = 0) as data_1o_vencimento,
       (select case when count(distinct p.initial_value) = 1 then max(p.initial_value) else null end
          from payments p
         where p.acquisition_request_id = ar.id and p.parcel_type_id = 3
           and coalesce(p.payment_to_delete, 0) = 0) as valor_parcela_unico
     from acquisition_requests ar
     join enterprise_unities eu on eu.id = ar.enterprise_unity_id
     left join users cli on cli.id = ar.client_id
     left join acquisition_request_stages st on st.id = ar.acquisition_request_stage_id
     left join commercial_plans cp on cp.id = ar.commercial_plan_id
     left join index_monetary_corrections imc on imc.id = cp.index_monetary_correction_id
     where eu.enterprise_id in (?) ${abertas} ${alterado}
       and ar.id > ?
     order by ar.id
     limit ?`,
    [...paramsBase, desde, limite],
  );

  const dados = linhas.map((linha) => ({
    codigo_cliente: texto(linha.codigo_cliente),
    codigo_lote: texto(linha.codigo_lote),
    // Prefixado para não colidir com código de outro conjunto: a base reaproveita faixas de id
    // entre tabelas, e um "45" solto pode ser venda, cliente ou parcela.
    codigo_venda: `VEN-${linha.id}`,
    data_1o_vencimento: data(linha.data_1o_vencimento),
    data_sinal: data(linha.data_sinal),
    data_venda: data(linha.act_date),
    indice: texto(linha.indice),
    observacao: null,
    // SEMPRE NULO por decisão do Lucas (14/08): "não vamos mandar nenhum reajuste".
    //
    // O plano comercial tem DOIS percentuais e os dois são chamados de reajuste em contextos
    // diferentes (`contractual_interest` e `correction_rate`), o que era a pendência P2 do
    // contrato. Mandar o número errado é pior que não mandar: o cliente recalcularia a carteira
    // inteira em cima dele e a divergência só apareceria no fechamento. O campo continua na
    // resposta, nulo, porque o contrato promete que todo campo pedido aparece.
    percentual_reajuste: null,
    qtd_parcelas: Number(linha.qtd_parcelas ?? 0),
    qtd_sinal: Number(linha.qtd_sinal ?? 0),
    situacao: texto(linha.situacao),
    valor_parcela: dinheiro(linha.valor_parcela_unico),
    valor_sinal: dinheiro(linha.valor_sinal),
    // Não existe coluna de valor de venda nesta base: o preço de tabela da unidade é o que baseia
    // o contrato (provado na seção 8.2 do levantamento).
    valor_venda: dinheiro(linha.price),
  }));

  const ultimo = linhas[linhas.length - 1];
  return {
    dados,
    proxima_pagina: linhas.length === limite && ultimo ? escreverCursor(Number(ultimo.id)) : null,
    total,
  };
}

// --- 5. recebimentos ----------------------------------------------------------------------------

type RecebimentoRow = RowDataPacket & {
  codigo_cliente: null | string;
  data_pagamento: null | string;
  data_vencimento: null | string;
  forma_pagamento: null | string;
  id: number;
  initial_value: null | number | string;
  interest_value: null | number | string;
  numero_parcela: null | number;
  paid_value: null | number | string;
  status_parcela: null | string;
  tipo_parcela: null | string;
  venda_id: number;
};

export async function listarRecebimentos(filtros: Filtros): Promise<Pagina<unknown>> {
  const limite = limiteDe(filtros.limite);
  const desde = lerCursor(filtros.cursor);
  const abertas = filtros.incluirCanceladas ? "" : "and ar.open = 1";

  const extras: string[] = [];
  const extrasParams: unknown[] = [];

  if (filtros.alteradoDesde) {
    extras.push("and p.updated_at >= ?");
    extrasParams.push(filtros.alteradoDesde);
  }
  if (filtros.codigoVenda) {
    // O cliente manda "VEN-45"; aqui vira o id. Se vier lixo, `Number` dá NaN e a consulta não
    // casa nada — melhor devolver vazio do que ignorar o filtro e mandar a carteira inteira.
    extras.push("and ar.id = ?");
    extrasParams.push(Number(String(filtros.codigoVenda).replace(/^VEN-/i, "")));
  }
  if (filtros.statusParcela) {
    extras.push("and ps.name = ?");
    extrasParams.push(filtros.statusParcela);
  }
  if (filtros.vencimentoDe) {
    extras.push("and p.due_date >= ?");
    extrasParams.push(filtros.vencimentoDe);
  }
  if (filtros.vencimentoAte) {
    extras.push("and p.due_date <= ?");
    extrasParams.push(filtros.vencimentoAte);
  }

  const filtro = extras.join(" ");
  const de = `
     from payments p
     join acquisition_requests ar on ar.id = p.acquisition_request_id
     join enterprise_unities eu on eu.id = ar.enterprise_unity_id
     left join payment_statuses ps on ps.id = p.payment_status_id
    where eu.enterprise_id in (?) ${abertas}
      and p.parcel_type_id = ${TIPO_PARCELAMENTO}
      and coalesce(p.payment_to_delete, 0) = 0
      and p.payment_status_id in (?)
      ${filtro}`;

  const params: unknown[] = [ENTERPRISES, STATUS_ATIVOS, ...extrasParams];
  const total = await contar(`select count(*) as total ${de}`, params);

  const linhas = await consultar<RecebimentoRow>(
    `select
       p.id,
       ar.id as venda_id,
       cli.user_code as codigo_cliente,
       pt.name as tipo_parcela,
       ps.name as status_parcela,
       pay.name as forma_pagamento,
       p.initial_value,
       p.paid_value,
       p.interest_value,
       date_format(p.due_date, '%Y-%m-%d') as data_vencimento,
       date_format(p.payment_date, '%Y-%m-%d') as data_pagamento,
       -- NULLIF, e nao so COALESCE: as duas colunas vem ZERO (nao nulas) quando nao se aplicam.
       -- Na mensal vale current_total_parcel; no sinal, current_signal_parcel; o Ato e parcela
       -- unica e as duas ficam em zero, entao ele vira 1. Sem o nullif, TODA parcela de Ato e
       -- Sinal saia numerada como 0.
       coalesce(nullif(p.current_total_parcel, 0), nullif(p.current_signal_parcel, 0), 1) as numero_parcela
     from payments p
     join acquisition_requests ar on ar.id = p.acquisition_request_id
     join enterprise_unities eu on eu.id = ar.enterprise_unity_id
     left join payment_statuses ps on ps.id = p.payment_status_id
     left join parcel_types pt on pt.id = p.parcel_type_id
     left join payment_types pay on pay.id = p.payment_type_id
     left join users cli on cli.id = ar.client_id
    where eu.enterprise_id in (?) ${abertas}
      and p.parcel_type_id = ${TIPO_PARCELAMENTO}
      and coalesce(p.payment_to_delete, 0) = 0
      and p.payment_status_id in (?)
      ${filtro}
      and p.id > ?
    order by p.id
    limit ?`,
    [...params, desde, limite],
  );

  const dados = linhas.map((linha) => {
    // Zero NÃO é pagamento: há 940 linhas com `paid_value = 0` que significam ausência. Elas saem
    // como null, senão o GLOTES contabiliza pagamento onde não houve.
    const pago = Number(linha.paid_value ?? 0);

    return {
      codigo_cliente: texto(linha.codigo_cliente),
      codigo_recebimento: `REC-${linha.id}`,
      codigo_venda: `VEN-${linha.venda_id}`,
      data_pagamento: data(linha.data_pagamento),
      data_vencimento: data(linha.data_vencimento),
      forma_pagamento: texto(linha.forma_pagamento),
      // Número de EXIBIÇÃO: repete dentro do mesmo contrato. A chave é `codigo_recebimento`.
      numero_parcela: Number(linha.numero_parcela ?? 0),
      // Sempre nulo: não há identificador bancário nesta base (`payment_transactions` está vazia).
      nosso_numero: null,
      observacao: null,
      status_parcela: texto(linha.status_parcela),
      tipo_parcela: texto(linha.tipo_parcela),
      valor_desconto: null,
      valor_juros: dinheiro(linha.interest_value),
      // Sempre nulo: `mulct_value` é zero em 68.356 de 68.356 linhas.
      valor_multa: null,
      // O C2X não guarda valor original separado — o cronograma já nasce reajustado.
      valor_original: dinheiro(linha.initial_value),
      valor_pago: pago > 0 ? dinheiro(linha.paid_value) : null,
      valor_parcela: dinheiro(linha.initial_value),
    };
  });

  const ultimo = linhas[linhas.length - 1];
  return {
    dados,
    proxima_pagina: linhas.length === limite && ultimo ? escreverCursor(Number(ultimo.id)) : null,
    total,
  };
}
