import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

import { filtroSemExcluidos } from "@/lib/apolo/c2x-pelo-id";

// O QUE O ESPELHO DA D4SIGN LÊ NO C2X: o envio, a unidade, o rol de convidados e, só dos candidatos, o
// documento do comprador. SÓ SELECT (plano da fonte única, seção 6).
//
// Lucas, 28/09/2026 (decisão do dia): *o C2X é lido só para achar o documento da D4Sign; o status e
// quem assinou vêm da API da D4Sign*. O `uuidDoc` e o caminho até a unidade só existem no C2X; a ordem
// (`after_position`) e o perfil também (a D4Sign não tem `order`, `sequence` nem `priority`). Quem
// assinou e quando NÃO sai daqui: `ss.signed` e `ss.date_signed` ficaram de fora das consultas de
// propósito (o C2X erra isso: 1.470 "Em aberto" que a D4Sign já fechou, medido em 18/08).
//
// ⚠️ UMA CONEXÃO, TRANSAÇÃO READ ONLY E 20 s POR CONSULTA (Segurança 12 do plano; 0.29). O pool comum
// (`lib/guardian/db.ts`) não tem transação só-leitura nem teto de consulta, e o C2X é produção com
// `max_connections` escasso e compartilhado. `abrirLeituraDoC2x` pega UMA conexão e abre
// `START TRANSACTION READ ONLY`: qualquer escrita que escape por engano morre no próprio MySQL.
// `fecharLeituraDoC2x` faz `COMMIT` e devolve a conexão, sempre.
//
// ⚠️ `created_at` DO C2X É BRASÍLIA SEM FUSO, E O POOL FALA UTC (`timezone: "Z"`). Por isso a data sai
// como TEXTO (`date_format`) e vira ISO com `-03:00` em `instanteDeBrasilia`. Nunca `new Date` do
// driver: ele leria 23:30 de Brasília como 23:30Z, três horas adiantado.
//
// ⚠️ O DOCUMENTO DO COMPRADOR (consulta 3) VIVE SÓ EM MEMÓRIA: nunca gravado, logado nem devolvido.

/** O teto de UMA consulta ao C2X (0.29 do plano). */
export const TIMEOUT_DA_CONSULTA_MS = 20_000;

/** O `in (...)` do rol e do comprador vai em lotes (o C2X aceita mais; o lote é para a consulta não pesar). */
export const LOTE_DO_IN_NO_C2X = 500;

/** Um envio do C2X para a D4Sign: uma linha de `contract_signatures`. */
export type EnvioDoC2x = {
  arId: number;
  contractType: null | string;
  csId: number;
  /** ISO com `-03:00` (o `created_at` do C2X é Brasília sem fuso). */
  criadoEm: string;
  enterpriseCode: string;
  enterpriseId: string;
  ordenada: boolean;
  statusC2x: null | number;
  unidadeC2xId: number;
  /** Nulo = o envio nunca virou documento na D4Sign (contado em `semUuid`, não espelhado). */
  uuidDoc: null | string;
};

/** Uma pessoa do rol de um envio (`contract_signature_signers`). */
export type PessoaDoC2x = {
  csId: number;
  email: null | string;
  /** `contract_signature_signers.id`: é a `chave` do item no quadro (`c2x:<linhaId>`). */
  linhaId: number;
  nome: string;
  papelNoEmpreendimento: null | string;
  perfilC2x: null | string;
  /** `after_position` (0 = sem ordem). */
  posicao: number;
  usuarioC2xId: null | number;
};

// ── AS CONSULTAS (constantes: o teste confere que são só SELECT) ─────────────

/** (1) Os envios, uma linha por envio. `{EXCLUIDOS}` vira o `e.id not in (...)` da exclusão de sempre. */
export const SQL_DOS_ENVIOS = `select cs.id                                   as cs_id,
       nullif(trim(cs.uuidDoc), '')            as uuid_doc,
       cs.contract_signature_status_id         as status_c2x,
       cs.contract_type                        as tipo_c2x,
       date_format(cs.created_at, '%Y-%m-%d %H:%i:%s') as criado_em_brasilia,
       arc.acquisition_request_id              as ar_id,
       coalesce(arc.is_to_use_position_to_sign, 0) as ordenada,
       ar.enterprise_unity_id                  as unidade_c2x_id,
       u.enterprise_id                         as enterprise_c2x_id,
       e.code                                  as enterprise_code
  from contract_signatures cs
  join acquisition_request_contracts arc on arc.id = cs.acquisition_request_contract_id
  join acquisition_requests ar on ar.id = arc.acquisition_request_id
  join enterprise_unities u on u.id = ar.enterprise_unity_id
  join enterprises e on e.id = u.enterprise_id
 where cs.send_document_signature = 1
   and {EXCLUIDOS}
 order by cs.id`;

/** (2) Quem estava no envio. Sem `ss.signed`/`ss.date_signed`: quem assinou vem só da D4Sign. */
export const SQL_DAS_PESSOAS = `select ss.contract_signature_id as cs_id, ss.id as linha_id,
       ss.user_name as nome, ss.email, ss.after_position as posicao,
       pf.name as perfil_c2x, usr.id as usuario_c2x_id,
       case
         when usr.id is not null and usr.id = e.coordenador_id then 'coordenador'
         when usr.id is not null and usr.id = e.manager_id then 'gerente'
         when usr.id is not null and usr.id = e.captivator_id then 'captador'
         else null
       end as papel_no_empreendimento
  from contract_signature_signers ss
  join contract_signatures cs on cs.id = ss.contract_signature_id
  join acquisition_request_contracts arc on arc.id = cs.acquisition_request_contract_id
  join acquisition_requests ar on ar.id = arc.acquisition_request_id
  join enterprise_unities u on u.id = ar.enterprise_unity_id
  join enterprises e on e.id = u.enterprise_id
  left join contract_signers csg on csg.id = ss.contract_signer_id
  left join signers sg on sg.id = csg.signer_id
  left join users usr on usr.id = sg.user_id
  left join profiles pf on pf.id = usr.profile_id
 where ss.contract_signature_id in (?)
 order by ss.contract_signature_id, ss.after_position, ss.id`;

/** (3) O comprador, SÓ dos candidatos das regras 2 e 3. Em memória. */
export const SQL_DOS_COMPRADORES = `select ar.id as ar_id, client.cpf as documento
  from acquisition_requests ar
  join users client on client.id = ar.client_id
 where ar.id in (?)`;

/** As frases de controle da transação: as únicas que não são SELECT. */
export const SQL_ABRE_LEITURA = "START TRANSACTION READ ONLY";
export const SQL_FECHA_LEITURA = "COMMIT";

type LinhaDoEnvio = RowDataPacket & {
  ar_id: number | string;
  criado_em_brasilia: null | string;
  cs_id: number | string;
  enterprise_c2x_id: number | string;
  enterprise_code: null | string;
  ordenada: number | string | null;
  status_c2x: null | number | string;
  tipo_c2x: null | string;
  unidade_c2x_id: number | string;
  uuid_doc: null | string;
};

type LinhaDaPessoa = RowDataPacket & {
  cs_id: number | string;
  email: null | string;
  linha_id: number | string;
  nome: null | string;
  papel_no_empreendimento: null | string;
  perfil_c2x: null | string;
  posicao: null | number | string;
  usuario_c2x_id: null | number | string;
};

type LinhaDoComprador = RowDataPacket & { ar_id: number | string; documento: null | string };

/** O que o espelho precisa da conexão: só `query`. É o que deixa o teste passar uma conexão falsa. */
export type ConexaoDeLeitura = Pick<PoolConnection, "query">;

/**
 * UMA conexão do pool, com `START TRANSACTION READ ONLY`. Quem abre FECHA (`fecharLeituraDoC2x`).
 *
 * ⚠️ SE O `START TRANSACTION` FALHAR A CONEXÃO VOLTA NA HORA: uma conexão sem a trava só-leitura não
 * sai daqui.
 */
export async function abrirLeituraDoC2x(pool: Pick<Pool, "getConnection">): Promise<PoolConnection> {
  const conexao = await pool.getConnection();
  try {
    await conexao.query({ sql: SQL_ABRE_LEITURA, timeout: TIMEOUT_DA_CONSULTA_MS });
    return conexao;
  } catch (falha) {
    conexao.release();
    throw falha;
  }
}

/** `COMMIT` e devolve a conexão. NUNCA LANÇA (roda no `finally` da rodada). */
export async function fecharLeituraDoC2x(conexao: null | PoolConnection | undefined): Promise<void> {
  if (!conexao) return;
  try {
    await conexao.query({ sql: SQL_FECHA_LEITURA, timeout: TIMEOUT_DA_CONSULTA_MS });
  } catch {
    // A transação é só-leitura: não há o que perder. O importante é a conexão voltar ao pool.
  } finally {
    try {
      conexao.release();
    } catch {
      // Conexão já devolvida ou morta: o pool cuida.
    }
  }
}

/**
 * Joga fora a conexão cuja consulta FALHOU (timeout de 20 s, erro de SQL). NUNCA LANÇA.
 *
 * ⚠️ `destroy`, E NÃO `COMMIT` + `release`: no timeout o mysql2 só devolve o erro a quem chamou, e a
 * consulta pode continuar rodando no servidor. Devolvida ao pool, a conexão levaria a consulta presa
 * (e a transação aberta) para a próxima rodada; esquecida sem `release`, ela sairia do pool para
 * sempre (são 5 lugares no pool do Hades). Fechar o socket devolve o lugar e faz o MySQL encerrar a
 * transação só-leitura.
 */
export function descartarLeituraDoC2x(conexao: null | PoolConnection | undefined): void {
  if (!conexao) return;
  try {
    conexao.destroy();
  } catch {
    try {
      conexao.release();
    } catch {
      // Conexão já morta: o pool cuida.
    }
  }
}

const inteiro = (valor: unknown): null | number => {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isSafeInteger(n) ? n : null;
};

const textoOuNulo = (valor: unknown): null | string => {
  const t = valor === null || valor === undefined ? "" : String(valor).trim();
  return t || null;
};

/**
 * O `created_at` do C2X (texto de Brasília, sem fuso) em ISO com `-03:00`.
 *
 * ⚠️ O TEXTO NÃO PASSA POR `new Date`: `2026-09-11 23:30:00` vira `2026-09-11T23:30:00-03:00`, que é
 * o instante 02:30Z do dia 12. `null` quando não tem a forma esperada.
 */
export function instanteDeBrasilia(texto: null | string): null | string {
  const t = String(texto ?? "").trim();
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(t);
  if (!m) return null;
  const iso = `${m[1]}T${m[2]}-03:00`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** Em lotes, sem repetição e sem vazio. */
function emLotes<T>(itens: readonly T[], tamanho: number): T[][] {
  const unicos = [...new Set(itens)];
  const lotes: T[][] = [];
  for (let i = 0; i < unicos.length; i += tamanho) lotes.push(unicos.slice(i, i + tamanho));
  return lotes;
}

/**
 * (1) Todos os envios para a D4Sign, fora os empreendimentos excluídos (teste e masterplan), pelo id.
 *
 * ⚠️ O ENVIO SEM `uuidDoc` VEM JUNTO (com `uuidDoc: null`): ele é CONTADO em `semUuid` e não é
 * espelhado. Filtrar aqui o esconderia do relatório (diferença declarada na seção 5, f).
 */
export async function lerEnviosDoC2x(conexao: ConexaoDeLeitura): Promise<EnvioDoC2x[]> {
  const excluidos = filtroSemExcluidos("e.id");
  const [linhas] = await conexao.query<LinhaDoEnvio[]>(
    { sql: SQL_DOS_ENVIOS.replace("{EXCLUIDOS}", excluidos.sql), timeout: TIMEOUT_DA_CONSULTA_MS },
    excluidos.params,
  );
  const envios: EnvioDoC2x[] = [];
  for (const l of linhas) {
    const csId = inteiro(l.cs_id);
    const arId = inteiro(l.ar_id);
    const unidadeC2xId = inteiro(l.unidade_c2x_id);
    const criadoEm = instanteDeBrasilia(l.criado_em_brasilia);
    // Linha sem as chaves não é envio que se possa ligar a nada: fica de fora (o relatório conta os lidos).
    if (csId === null || arId === null || unidadeC2xId === null || !criadoEm) continue;
    envios.push({
      arId,
      contractType: textoOuNulo(l.tipo_c2x),
      csId,
      criadoEm,
      enterpriseCode: String(l.enterprise_code ?? "").trim(),
      enterpriseId: String(l.enterprise_c2x_id ?? "").trim(),
      ordenada: Number(l.ordenada ?? 0) === 1,
      statusC2x: inteiro(l.status_c2x),
      unidadeC2xId,
      uuidDoc: textoOuNulo(l.uuid_doc),
    });
  }
  return envios;
}

/**
 * (2) O rol de cada envio, por `cs.id`, em lotes de 500. Só para os envios NOVOS e para os em
 * movimento cujo rol mudou (a D4Sign trouxe outra contagem).
 */
export async function lerPessoasDosEnvios(
  conexao: ConexaoDeLeitura,
  csIds: readonly number[],
): Promise<Map<number, PessoaDoC2x[]>> {
  const porEnvio = new Map<number, PessoaDoC2x[]>();
  for (const lote of emLotes(csIds, LOTE_DO_IN_NO_C2X)) {
    const [linhas] = await conexao.query<LinhaDaPessoa[]>(
      { sql: SQL_DAS_PESSOAS, timeout: TIMEOUT_DA_CONSULTA_MS },
      [lote],
    );
    for (const l of linhas) {
      const csId = inteiro(l.cs_id);
      const linhaId = inteiro(l.linha_id);
      if (csId === null || linhaId === null) continue;
      const lista = porEnvio.get(csId) ?? [];
      lista.push({
        csId,
        email: textoOuNulo(l.email)?.toLowerCase() ?? null,
        linhaId,
        nome: String(l.nome ?? "").trim(),
        papelNoEmpreendimento: textoOuNulo(l.papel_no_empreendimento),
        perfilC2x: textoOuNulo(l.perfil_c2x),
        posicao: inteiro(l.posicao) ?? 0,
        usuarioC2xId: inteiro(l.usuario_c2x_id),
      });
      porEnvio.set(csId, lista);
    }
  }
  return porEnvio;
}

/**
 * (3) SÓ PARA OS CANDIDATOS DAS REGRAS 2 E 3: `ar.id` → dígitos do documento do comprador.
 *
 * ⚠️ EM MEMÓRIA. O mapa vive dentro da rodada e morre com ela; nunca é gravado, logado nem devolvido
 * (plano, seção 3). Quem chama compara com `cliente_documento` e descarta.
 */
export async function documentosDosCompradores(
  conexao: ConexaoDeLeitura,
  arIds: readonly number[],
): Promise<Map<number, string>> {
  const porAr = new Map<number, string>();
  for (const lote of emLotes(arIds, LOTE_DO_IN_NO_C2X)) {
    const [linhas] = await conexao.query<LinhaDoComprador[]>(
      { sql: SQL_DOS_COMPRADORES, timeout: TIMEOUT_DA_CONSULTA_MS },
      [lote],
    );
    for (const l of linhas) {
      const arId = inteiro(l.ar_id);
      const digitos = String(l.documento ?? "").replace(/\D/g, "");
      if (arId !== null && digitos) porAr.set(arId, digitos);
    }
  }
  return porAr;
}
