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

import { createApoloAdminClient, hashIdentifier } from "@/lib/apolo/server";
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

// --- relógio ------------------------------------------------------------------------------------
//
// ⚠️ O C2X GRAVA `datetime` SEM FUSO, NO RELÓGIO DE BRASÍLIA, e a sessão do MySQL é UTC. Medido em
// 25/09/2026: `@@session.time_zone = UTC`, e `created_at`/`updated_at` de payments,
// acquisition_requests, enterprise_unities, users, addresses, spouses e phones são `datetime`.
// Três consequências, e as três já custaram dado ao GLOTES:
//   1. A marca de `alterado_desde` chega da porta em UTC (lerAlteradoDesde) e precisa ir para o
//      relógio de Brasília ANTES de ser comparada com a coluna. Até 25/09 só `clientes` convertia:
//      em vendas e recebimentos o corte andava 3 horas para a frente e perdia para sempre o que
//      mudou nessas 3 horas (desde 10/09, o incremental de recebimentos devolvia 534 linhas contra
//      1.564 reais).
//   2. O `atualizado_em` que sai precisa carregar o fuso: o contrato manda o cliente repassar o
//      maior `atualizado_em` em `alterado_desde`, e a porta recusa marca sem fuso (com razão).
//   3. O fuso de Brasília NÃO é constante: houve horário de verão até fevereiro de 2019. Colar
//      `-03:00` fixo erra uma hora nas datas daquele período; o deslocamento sai do banco de fusos
//      (Intl), instante a instante.

const FUSO_DO_C2X = "America/Sao_Paulo";

/**
 * Piso dos relógios combinados.
 *
 * `GREATEST` do MySQL devolve NULL se QUALQUER argumento for NULL, e NULL no relógio tira a linha
 * do incremental calada (`NULL >= marca` não é verdadeiro). As colunas de relógio são NOT NULL hoje
 * (conferido em 25/09/2026), mas o `max()` de uma tabela filha sem linha é NULL: todo argumento
 * leva `coalesce(..., RELOGIO_ZERO_SQL)`. O piso nunca aparece na saída (relogioComFuso devolve
 * null para ele).
 */
const RELOGIO_ZERO = "1970-01-01 00:00:00";
const RELOGIO_ZERO_SQL = `cast('${RELOGIO_ZERO}' as datetime)`;

// `hourCycle: h23`, e não `hour12: false`: com este último alguns motores escrevem meia-noite como
// "24", e a hora 24 viraria o dia seguinte na conta do deslocamento.
const FORMATO_BRASILIA = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  month: "2-digit",
  second: "2-digit",
  timeZone: FUSO_DO_C2X,
  year: "numeric",
});

type PartesDoRelogio = {
  ano: number;
  dia: number;
  hora: number;
  mes: number;
  minuto: number;
  segundo: number;
};

function partesEmBrasilia(instante: Date): PartesDoRelogio {
  const partes: Record<string, number> = {};
  for (const parte of FORMATO_BRASILIA.formatToParts(instante)) {
    if (parte.type !== "literal") partes[parte.type] = Number(parte.value);
  }
  return {
    ano: partes.year ?? 0,
    dia: partes.day ?? 0,
    hora: (partes.hour ?? 0) % 24,
    mes: partes.month ?? 0,
    minuto: partes.minute ?? 0,
    segundo: partes.second ?? 0,
  };
}

function doisDigitos(valor: number): string {
  return String(valor).padStart(2, "0");
}

/** `YYYY-MM-DD HH:MM:SS`: o formato do `date_format` do C2X, que compara como texto. */
function textoDoRelogio(p: PartesDoRelogio): string {
  return `${String(p.ano).padStart(4, "0")}-${doisDigitos(p.mes)}-${doisDigitos(p.dia)} ${doisDigitos(p.hora)}:${doisDigitos(p.minuto)}:${doisDigitos(p.segundo)}`;
}

/**
 * Um instante (ISO com fuso, ex.: o `updated_at` do Supabase) no relógio de Brasília,
 * `YYYY-MM-DD HH:MM:SS`: o MESMO formato e fuso das colunas do C2X, para comparar como texto.
 */
function relogioBrasilia(iso: null | string): null | string {
  if (!iso) return null;
  const instante = new Date(iso);
  if (Number.isNaN(instante.getTime())) return null;
  return textoDoRelogio(partesEmBrasilia(instante));
}

/**
 * A marca de `alterado_desde` no RELÓGIO DO C2X.
 *
 * A porta entrega a marca em UTC (`YYYY-MM-DD HH:MM:SS`, ver lerAlteradoDesde); as colunas do C2X
 * estão no relógio de Brasília. Sem esta conversão a marca `2026-09-10T00:00:00-03:00` virava
 * `2026-09-10 03:00:00` e comparava com uma coluna local: o corte andava 3 horas.
 */
export function marcaNoRelogioDoC2x(alteradoDesde: null | string | undefined): null | string {
  const bruto = alteradoDesde?.trim();
  if (!bruto) return null;
  return relogioBrasilia(`${bruto.replace(" ", "T")}Z`);
}

/** Deslocamento de Brasília, em minutos (-180 = `-03:00`), NAQUELE instante. */
function deslocamentoEmMinutos(instanteMs: number): number {
  const semMilissegundos = Math.floor(instanteMs / 1000) * 1000;
  const p = partesEmBrasilia(new Date(semMilissegundos));
  const comoSeFosseUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  return Math.round((comoSeFosseUtc - semMilissegundos) / 60_000);
}

/**
 * O relógio do C2X (`YYYY-MM-DD HH:MM:SS`, Brasília, sem fuso) em ISO 8601 COM o deslocamento de
 * Brasília daquele instante: `2026-09-25 12:20:00` vira `2026-09-25T12:20:00-03:00`, e
 * `2018-12-01 12:00:00` (horário de verão) vira `2018-12-01T12:00:00-02:00`.
 *
 * É o formato que a porta aceita de volta em `alterado_desde`: repassar o valor recebido devolve
 * exatamente a mesma marca no relógio do C2X (ida e volta testada). Antes de 25/09/2026 `clientes`
 * saía sem fuso e repassar o valor dava 400.
 *
 * O deslocamento é resolvido em duas voltas: a primeira lê o fuso no instante "como se a hora fosse
 * UTC", a segunda confere no instante real. Só difere a menos de 3 horas de uma virada de horário
 * de verão. Na hora repetida do fim do horário de verão fica a primeira ocorrência (`-02:00`).
 */
export function relogioComFuso(local: unknown): null | string {
  const bruto = String(local ?? "").trim();
  const m = bruto.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, ano, mes, dia, hora, minuto, segundo] = m;
  const comoTexto = `${ano}-${mes}-${dia} ${hora}:${minuto}:${segundo}`;
  // O piso dos relógios combinados (e qualquer data "zero" do legado) não é alteração: sai null.
  if (comoTexto <= RELOGIO_ZERO) return null;

  const comoSeFosseUtc = Date.UTC(
    Number(ano),
    Number(mes) - 1,
    Number(dia),
    Number(hora),
    Number(minuto),
    Number(segundo),
  );
  const palpite = deslocamentoEmMinutos(comoSeFosseUtc);
  const deslocamento = deslocamentoEmMinutos(comoSeFosseUtc - palpite * 60_000);
  const sinal = deslocamento < 0 ? "-" : "+";
  const absoluto = Math.abs(deslocamento);
  return `${ano}-${mes}-${dia}T${hora}:${minuto}:${segundo}${sinal}${doisDigitos(Math.floor(absoluto / 60))}:${doisDigitos(absoluto % 60)}`;
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

// --- contatos ATUALIZADOS, do Panteon -----------------------------------------------------------
//
// "Esses dados agora têm que sair do Panteon — os atualizados" (Lucas, 24/08). O cadastro VIVO
// de e-mail/telefone mora em `apolo_contacts` (é lá que a Iris, o CRM e o próprio cliente
// corrigem); o C2X vira fallback de quem não tem entidade/contato no Apolo. O casamento é por
// CPF/CNPJ via `document_hash` (a MESMA fórmula do dedup da CAD), nunca por nome.

type ContatoDoPanteon = {
  atualizadoEm: null | string;
  email: null | string;
  telefone: null | string;
};

async function contatosDoPanteonPorDocumento(
  documentos: string[],
): Promise<Map<string, ContatoDoPanteon>> {
  const resultado = new Map<string, ContatoDoPanteon>();
  const client = createApoloAdminClient();
  if (!client) return resultado;

  // hash → documento (o mapa final é por documento, que é o que a linha do C2X tem).
  const hashPorDocumento = new Map<string, string>();
  for (const doc of documentos) {
    const limpo = (doc ?? "").replace(/\D/g, "");
    if (limpo.length !== 11 && limpo.length !== 14) continue;
    hashPorDocumento.set(hashIdentifier(limpo.length === 11 ? "cpf" : "cnpj", limpo), limpo);
  }
  if (hashPorDocumento.size === 0) return resultado;

  // ⚠️ `.in()` estoura a URL do PostgREST com listas grandes — lotes de 100, sempre.
  const hashes = [...hashPorDocumento.keys()];
  const entidadePorHash = new Map<string, string>();
  for (let inicio = 0; inicio < hashes.length; inicio += 100) {
    const { data } = await client
      .from("apolo_entities")
      .select("id, document_hash")
      .in("document_hash", hashes.slice(inicio, inicio + 100));
    for (const linha of (data ?? []) as { document_hash: string; id: string }[]) {
      entidadePorHash.set(linha.document_hash, linha.id);
    }
  }
  if (entidadePorHash.size === 0) return resultado;

  const entityIds = [...new Set(entidadePorHash.values())];
  const contatosPorEntidade = new Map<
    string,
    { is_primary: boolean; tipo: string; updated_at: null | string; valor: string }[]
  >();
  for (let inicio = 0; inicio < entityIds.length; inicio += 100) {
    const { data } = await client
      .from("apolo_contacts")
      .select("entity_id, contact_type, value, is_primary, updated_at")
      .in("entity_id", entityIds.slice(inicio, inicio + 100))
      .in("contact_type", ["email", "phone", "whatsapp"]);
    for (const linha of (data ?? []) as Array<{
      contact_type: string;
      entity_id: string;
      is_primary: boolean | null;
      updated_at: null | string;
      value: null | string;
    }>) {
      const valor = (linha.value ?? "").trim();
      if (!valor) continue;
      const lista = contatosPorEntidade.get(linha.entity_id) ?? [];
      lista.push({
        is_primary: Boolean(linha.is_primary),
        tipo: linha.contact_type,
        updated_at: linha.updated_at,
        valor,
      });
      contatosPorEntidade.set(linha.entity_id, lista);
    }
  }

  // Preferências (as MESMAS da ficha): principal primeiro; no telefone, whatsapp > phone;
  // empate resolve pelo mais recente.
  const peso = (c: { is_primary: boolean; tipo: string; updated_at: null | string }) =>
    `${c.is_primary ? 1 : 0}|${c.tipo === "whatsapp" ? 1 : 0}|${c.updated_at ?? ""}`;

  for (const [hash, documento] of hashPorDocumento) {
    const entityId = entidadePorHash.get(hash);
    if (!entityId) continue;
    const contatos = contatosPorEntidade.get(entityId) ?? [];
    if (contatos.length === 0) continue;

    const emails = contatos
      .filter((c) => c.tipo === "email")
      .sort((a, b) => (peso(a) < peso(b) ? 1 : -1));
    const fones = contatos
      .filter((c) => c.tipo === "phone" || c.tipo === "whatsapp")
      .sort((a, b) => (peso(a) < peso(b) ? 1 : -1));
    const maisRecente = contatos
      .map((c) => c.updated_at)
      .filter((v): v is string => Boolean(v))
      .sort()
      .pop();

    resultado.set(documento, {
      atualizadoEm: relogioBrasilia(maisRecente ?? null),
      email: emails[0]?.valor ?? null,
      telefone: fones[0]?.valor ?? null,
    });
  }

  return resultado;
}

// --- 2. clientes --------------------------------------------------------------------------------

type ClienteRow = RowDataPacket & {
  atualizado_em: null | string;
  bairro: null | string;
  cep: null | string;
  cidade: null | string;
  cnpj: null | string;
  codigo_cliente: null | string;
  complemento: null | string;
  conjuge_cpf: null | string;
  conjuge_nome: null | string;
  cpf: null | string;
  email: null | string;
  fantasy_name: null | string;
  id: number;
  logradouro: null | string;
  name: null | string;
  numero: null | string;
  person_type_id: null | number;
  social_name: null | string;
  telefone: null | string;
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

  // ⚠️ TELEFONE não mora em `users.phone/cellphone` (quase vazios na base): no C2X a fonte é a
  // tabela polimórfica `phones`, preferindo o WhatsApp — a MESMA leitura do sync do Apolo. Mas
  // o C2X aqui é só o FALLBACK: o dado ATUALIZADO sai do Panteon (Lucas, 24/08: "esses dados
  // agora tem que sair do Panteon — os atualizados"), no merge feito após esta consulta.
  const telefoneSql = `(
       select nullif(trim(ph.phone), '')
         from phones ph
        where ph.ownertable_type = 'User'
          and ph.ownertable_id = u.id
          and trim(coalesce(ph.phone, '')) <> ''
        order by ph.is_whatsapp desc, ph.updated_at desc, ph.id desc
        limit 1
     )`;
  // Relógio do lado C2X (o do Panteon entra no merge): o maior entre o usuário, as três tabelas
  // polimórficas que alimentam a linha e os contratos do Lavra de que ele é titular.
  //
  // Telefone, endereço e cônjuge: trocar qualquer um deles NÃO toca `users.updated_at`. Telefone
  // entrou em 24/08; endereço e cônjuge em 25/09/2026, porque `endereco`, `bairro`, `cidade`, `uf`,
  // `cep` e `conjuge_*` saem de `addresses` e `spouses`, e uma correção só ali ficava fora do
  // incremental. (Medido em 25/09: nenhum cliente do recorte tinha, desde 14/08, endereço ou cônjuge
  // mais novo que o resto do cadastro. O buraco existia, ainda sem vítima.)
  //
  // O contrato entrou em 25/09/2026, depois da revisão: o cliente ENTRA no recorte quando vira
  // titular de uma venda do Lavra (venda nova ou troca de titular), e isso não toca o cadastro
  // dele. Caso medido: o relógio do CLI4258 era o próprio cadastro (10/09 15:01:39), e a VEN-5008
  // (gleba 4, aberta, a única venda aberta dele no recorte) nasceu em 16/09 18:55:13. O incremental
  // de clientes não o trazia, e o GLOTES recebia a venda e as parcelas com um `codigo_cliente` que
  // não tinha. Não é caso isolado, é o fluxo normal: dos 224 clientes que entraram no recorte em
  // 2024, 88 tinham o cadastro parado mais de 5 minutos antes da primeira venda (em 2026, 2 de 4).
  // - `ar2.updated_at`, e NÃO RELOGIO_DA_VENDA: as parcelas mudam a cada lote de boletos e trariam
  //   todos os clientes de volta todo mês.
  // - Sem `ar2.open = 1`: trazer a mais é seguro (upsert), e o cancelamento não move
  //   `ar.updated_at` (nenhum audit de `open` no C2X inteiro).
  // - `ENTERPRISES` entra no texto, e não como `?`: é constante numérica do servidor, e este trecho
  //   fica na lista do SELECT, ANTES do `in (?)` do recorte. Um `?` a mais aqui deslocaria os
  //   parâmetros [ENTERPRISES, desde, limite].
  //
  // Cada argumento com coalesce: ver RELOGIO_ZERO_SQL.
  const maxDoDono = (tabela: string, apelido: string) => `coalesce(
       (select max(coalesce(${apelido}.updated_at, ${apelido}.created_at)) from ${tabela} ${apelido}
         where ${apelido}.ownertable_type = 'User' and ${apelido}.ownertable_id = u.id),
       ${RELOGIO_ZERO_SQL})`;
  const maxDosContratos = `coalesce(
       (select max(coalesce(ar2.updated_at, ar2.created_at)) from acquisition_requests ar2
          join enterprise_unities eu2 on eu2.id = ar2.enterprise_unity_id
         where ar2.client_id = u.id and eu2.enterprise_id in (${ENTERPRISES.join(", ")})),
       ${RELOGIO_ZERO_SQL})`;
  const atualizadoSql = `greatest(
       coalesce(u.updated_at, u.created_at, ${RELOGIO_ZERO_SQL}),
       ${maxDoDono("phones", "ph2")},
       ${maxDoDono("addresses", "ad2")},
       ${maxDoDono("spouses", "sp2")},
       ${maxDosContratos}
     )`;

  const paramsBase: unknown[] = [ENTERPRISES];

  const total = await contar(
    `select count(*) as total from users u where ${doRecorte}`,
    paramsBase,
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
       nullif(trim(u.email), '') as email,
       ${telefoneSql} as telefone,
       date_format(${atualizadoSql}, '%Y-%m-%d %H:%i:%s') as atualizado_em,
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
    [...paramsBase, desde, limite],
  );

  // O DADO ATUALIZADO VEM DO PANTEON: o cadastro vivo (e-mail/telefone corrigidos pela Iris,
  // pelo CRM, pelo cliente) mora em apolo_contacts — o C2X fica como fallback de quem não tem
  // entidade/contato no Apolo. O casamento é por CPF/CNPJ via document_hash (mesma fórmula do
  // dedup da CAD, hashIdentifier).
  const doPanteon = await contatosDoPanteonPorDocumento(
    linhas.map((linha) => {
      const pj = Number(linha.person_type_id) === 2;
      return digitos(pj ? linha.cnpj : linha.cpf) ?? "";
    }),
  );

  const registros = linhas.map((linha) => {
    const pj = Number(linha.person_type_id) === 2;
    const endereco = [texto(linha.logradouro), texto(linha.numero), texto(linha.complemento)]
      .filter(Boolean)
      .join(", ");
    const documento = (pj ? digitos(linha.cnpj) : digitos(linha.cpf)) ?? "";
    const panteon = doPanteon.get(documento);

    // O maior relógio entre as duas fontes (mesmo formato/fuso — compara como texto).
    const atualizadoC2x = texto(linha.atualizado_em);
    const atualizadoEm =
      panteon?.atualizadoEm && (!atualizadoC2x || panteon.atualizadoEm > atualizadoC2x)
        ? panteon.atualizadoEm
        : atualizadoC2x;

    const saida = {
      // Relógio da atualização do cadastro (Panteon OU C2X, o mais novo), ISO com o fuso de
      // Brasília: o mesmo relógio do filtro `alterado_desde`, e aceito de volta nele.
      atualizado_em: relogioComFuso(atualizadoEm),
      bairro: texto(linha.bairro),
      cep: digitos(linha.cep),
      cidade: texto(linha.cidade),
      codigo_cliente: texto(linha.codigo_cliente),
      conjuge_cpf: digitos(linha.conjuge_cpf),
      conjuge_nome: texto(linha.conjuge_nome),
      cpf_cnpj: documento || null,
      // O ATUALIZADO ganha: Panteon primeiro (é onde o cadastro vive), C2X de fallback.
      email: panteon?.email ?? texto(linha.email),
      endereco: endereco || null,
      // Em PJ o `name` traz a pessoa física representante; a razão social vive em `social_name`.
      nome: texto(linha.name),
      nome_fantasia: pj ? texto(linha.fantasy_name) : null,
      razao_social: pj ? texto(linha.social_name) : null,
      telefone: panteon?.telefone ? digitos(panteon.telefone) : digitos(linha.telefone),
      tipo_pessoa: pj ? "J" : "F",
      uf: texto(linha.uf),
    };

    // O relógio LOCAL (`YYYY-MM-DD HH:MM:SS`, Brasília) segue ao lado da saída só para o corte de
    // `alterado_desde` abaixo, que compara como texto. O fuso entra só na saída.
    return { relogio: atualizadoEm, saida };
  });

  // `alterado_desde` compara o relógio COMBINADO (Panteon + C2X), então o corte é aqui, depois
  // do merge — no SQL só o lado C2X existe e uma atualização feita no Apolo ficaria invisível.
  // A base tem ~375 clientes: uma página cobre tudo, o pós-filtro não custa nada.
  // ⚠️ FUSO: a porta normaliza a marca para UTC (lerAlteradoDesde), e o relógio daqui está no de
  // Brasília: converter antes de comparar, senão o corte come 3 horas.
  const marcaBrasilia = marcaNoRelogioDoC2x(filtros.alteradoDesde);
  const filtrados = (
    marcaBrasilia
      ? registros.filter((r) => r.relogio !== null && r.relogio >= marcaBrasilia)
      : registros
  ).map((r) => r.saida);

  const ultimo = linhas[linhas.length - 1];
  return {
    dados: filtrados,
    proxima_pagina: linhas.length === limite && ultimo ? escreverCursor(Number(ultimo.id)) : null,
    // Com `alterado_desde`, o total conta o que passou no corte NESTA página: o corte é feito aqui,
    // depois do merge, página a página. Com o limite padrão de 500 a base de 374 cabe numa página
    // e o número é o do corte inteiro; com limite menor, não é (revisão de 25/09, limite=100:
    // totais de 0, 2, 3 e 3, um por página). Por isso o contrato manda usar limite=1000 no
    // incremental de clientes.
    total: filtros.alteradoDesde ? filtrados.length : total,
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
  atualizado_em: null | string;
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

/**
 * O relógio da VENDA: o maior entre o contrato, as parcelas de Sinal e Parcela dele e a unidade.
 *
 * Até 25/09/2026 era só `ar.updated_at`, e isso perdia quase tudo: `qtd_parcelas`, `qtd_sinal`,
 * `valor_sinal`, `valor_parcela` e `data_1o_vencimento` SAEM das parcelas, e mexer em parcela não
 * toca `acquisition_requests.updated_at`. Medido em 25/09, das 474 vendas abertas: desde 10/09 o
 * relógio antigo devolvia 2 e o combinado devolve 459; desde 14/08, 2 contra 466.
 *
 * - Parcelas SEM o filtro de `payment_to_delete`: marcar para apagar muda `qtd_parcelas` (a
 *   contagem exclui as marcadas), então a marcação tem que mover o relógio.
 * - A unidade entra porque `valor_venda` (`eu.price`) e `codigo_lote` (`eu.name`) saem dela. Hoje
 *   não acrescenta nenhuma venda (medido), mas mudar o preço da unidade mudaria a linha sem aviso.
 * - Parcela APAGADA de verdade não deixa rastro aqui (a linha some e o `max` não sobe). Se a régua
 *   é recriada, as novas movem o relógio; se só é apagada, não. Esse é o limite documentado no
 *   contrato: a carga completa é a verdade.
 * - Cada argumento com coalesce: ver RELOGIO_ZERO_SQL.
 */
const RELOGIO_DA_VENDA = `greatest(
       coalesce(ar.updated_at, ar.created_at, ${RELOGIO_ZERO_SQL}),
       coalesce(
         (select max(coalesce(pu.updated_at, pu.created_at)) from payments pu
           where pu.acquisition_request_id = ar.id and pu.parcel_type_id in (2, 3)),
         ${RELOGIO_ZERO_SQL}),
       coalesce(eu.updated_at, eu.created_at, ${RELOGIO_ZERO_SQL})
     )`;

export async function listarVendas(filtros: Filtros): Promise<Pagina<unknown>> {
  const limite = limiteDe(filtros.limite);
  const desde = lerCursor(filtros.cursor);
  const abertas = filtros.incluirCanceladas ? "" : "and ar.open = 1";
  // O MESMO relógio no filtro e no `atualizado_em` da saída: o cliente repassa o maior valor
  // recebido e o corte tem que medir a mesma coisa que ele viu.
  const marca = marcaNoRelogioDoC2x(filtros.alteradoDesde);
  const alterado = marca ? `and ${RELOGIO_DA_VENDA} >= ?` : "";

  const paramsBase: unknown[] = [ENTERPRISES];
  if (marca) paramsBase.push(marca);

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
       date_format(${RELOGIO_DA_VENDA}, '%Y-%m-%d %H:%i:%s') as atualizado_em,
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
    // Relógio da venda (contrato, parcelas de Sinal e Parcela, unidade), ISO com o fuso de
    // Brasília. Novo em 25/09/2026: o mesmo relógio do filtro `alterado_desde`, e aceito de volta
    // nele.
    atualizado_em: relogioComFuso(linha.atualizado_em),
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
  atualizado_em: null | string;
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

/**
 * O relógio do RECEBIMENTO: o maior entre a parcela e a venda dela.
 *
 * A venda entra porque `codigo_cliente` sai do titular da venda (`ar.client_id`), e trocar o
 * titular não toca a parcela. Caso real: a troca de titular da VEN-223 em 15/09/2026 17:18 moveu
 * `ar.updated_at` (medido: audit e coluna com o mesmo instante), mas só 1 das 144 parcelas foi
 * tocada depois; as outras 141 continuavam com o titular antigo do lado do GLOTES. Desde 10/09 o
 * relógio combinado devolve 1.705 parcelas, contra 1.564 só pela parcela (as 141 da VEN-223).
 *
 * Custo medido em 25/09 (C2X real, `count` do recorte): 200 a 250 ms com o `greatest`, o mesmo
 * da lista completa. Não há índice em `payments.updated_at`, então a forma com OR entre as duas
 * colunas (mesmo resultado) não tem índice para usar e não ganhou nada (200 a 520 ms); ficou o
 * `greatest`, que é a MESMA expressão do `atualizado_em` da saída. Cada argumento com coalesce:
 * ver RELOGIO_ZERO_SQL.
 */
const RELOGIO_DO_RECEBIMENTO = `greatest(
       coalesce(p.updated_at, p.created_at, ${RELOGIO_ZERO_SQL}),
       coalesce(ar.updated_at, ar.created_at, ${RELOGIO_ZERO_SQL})
     )`;

export async function listarRecebimentos(filtros: Filtros): Promise<Pagina<unknown>> {
  const limite = limiteDe(filtros.limite);
  const desde = lerCursor(filtros.cursor);
  const abertas = filtros.incluirCanceladas ? "" : "and ar.open = 1";

  const extras: string[] = [];
  const extrasParams: unknown[] = [];

  const marca = marcaNoRelogioDoC2x(filtros.alteradoDesde);
  if (marca) {
    extras.push(`and ${RELOGIO_DO_RECEBIMENTO} >= ?`);
    extrasParams.push(marca);
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
       date_format(${RELOGIO_DO_RECEBIMENTO}, '%Y-%m-%d %H:%i:%s') as atualizado_em,
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
      // Relógio do recebimento (parcela ou venda), ISO com o fuso de Brasília. Novo em 25/09/2026,
      // pedido do GLOTES em 10/09 ("nos recebimentos não tem a coluna da data de atualização"): o
      // mesmo relógio do filtro `alterado_desde`, e aceito de volta nele.
      atualizado_em: relogioComFuso(linha.atualizado_em),
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
      // O C2X não guarda valor original separado: é a mesma coluna de `valor_parcela`. E ela é o
      // valor do CRONOGRAMA, não o corrigido: só a parcela que recebe boleto é atualizada, a futura
      // fica no valor do contrato. Medido em 25/09/2026: 5.389 das 11.977 parcelas pagas (45%)
      // têm `valor_pago` maior que ela, R$ 151.872,85 de diferença, e só R$ 8.452,53 (5,6%) disso
      // está em `interest_value`. O contrato (OpenAPI) avisa o GLOTES.
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
