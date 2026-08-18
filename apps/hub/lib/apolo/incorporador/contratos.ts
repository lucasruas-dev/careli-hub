// CONTRATOS GERADOS — a aba de Vendas do portal do incorporador que lista os contratos VIVOS dos
// empreendimentos da sessão, com a situação da assinatura resumida.
//
// ⚠️ A RÉGUA DE ESTÁGIO É A DAS VENDAS, IMPORTADA. "Contrato vivo" = a proposta MAIS RECENTE da
// unidade está num estágio que a dobra `STAGE_MAP` (lib/apolo/vendas.ts) traduz como contrato,
// assinatura ou faturado. Os ids do C2X (3, 4, 5, 6 hoje) são DERIVADOS do mapa, nunca repetidos
// aqui: se a dobra mudar, este arquivo acompanha sozinho.
//
// ⚠️ A ARMADILHA DAS ASSINATURAS (ver [[reference_c2x_assinatura_contratos]] e o cabeçalho de
// lib/apolo/painel-assinatura.ts): `contract_signatures` tem mais de um ENVIO por contrato
// (médias de 2 linhas via `acquisition_request_contracts`), o campo `statusId` é 100% NULL (o
// status real é `contract_signature_status_id`), e existem envios fantasma. A regra de leitura é
// a MESMA do painel interno: só envio com `send_document_signature = 1` e status ≠ 6, e por
// contrato vale O envio com `uuidDoc`; sem nenhum, o de maior id (`escolherEnvio`).
//
// Medido no C2X em 18/08/2026 (VAL, Vista Alegre, enterprise 29 — o empreendimento do portal de
// teste): 39 contratos vivos, todos faturados, todos com envio válido e uuidDoc, 39 com todas as
// linhas assinadas, 0 aguardando emissão. Só 13 têm a data de geração no histórico: as vendas
// antigas entraram no C2X sem transição registrada, e é por isso que a ordenação tem fallback.
//
// ⚠️ O QUE NÃO SAI DAQUI: telefone, e-mail, documento, motivo de cancelamento. O incorporador é
// parte do contrato e vê o NOME de quem comprou e de quem vendeu, e só isso.
import type { RowDataPacket } from "mysql2";

import { EXCLUDED_ENTERPRISE_CODES } from "@/lib/guardian/c2x-analytics";
import { getHadesDbPool } from "@/lib/guardian/db";
import { STAGE_MAP, type ApoloVendaUnit } from "@/lib/apolo/vendas";

/** Estágios do C2X em que a unidade JÁ TEM contrato: contrato gerado, em assinatura, faturado. */
export const ESTAGIOS_COM_CONTRATO = Object.entries(STAGE_MAP)
  .filter(([, dobra]) => dobra === "contrato" || dobra === "assinatura" || dobra === "faturado")
  .map(([id]) => Number(id))
  .sort((a, b) => a - b);

/** O(s) estágio(s) "Contrato gerado" — a PRIMEIRA entrada aqui é a data de geração do contrato. */
export const ESTAGIOS_DE_GERACAO = Object.entries(STAGE_MAP)
  .filter(([, dobra]) => dobra === "contrato")
  .map(([id]) => Number(id))
  .sort((a, b) => a - b);

/**
 * Teto da lista, com aviso. NUNCA truncamento silencioso: quando estoura, `truncado` vem true e a
 * rota avisa a tela. O maior escopo real hoje (Lagoa Bonita inteira, 495 lotes) cabe com folga.
 */
export const TETO_DE_CONTRATOS = 500;

export type SituacaoDaAssinatura = "aguardando-emissao" | "assinado" | "em-assinatura";

export const SITUACAO_ASSINATURA_LABELS: Record<SituacaoDaAssinatura, string> = {
  "aguardando-emissao": "Aguardando emissão",
  assinado: "Assinado",
  "em-assinatura": "Em assinatura",
};

export type ContratoDoPortal = {
  /** Situação resumida da assinatura, derivada do envio escolhido (ver `situacaoDaAssinatura`). */
  assinatura: SituacaoDaAssinatura;
  bloco: null | string;
  /** Nome de quem comprou. Documento e contato NÃO atravessam. */
  comprador: null | string;
  /**
   * Data de faturamento (`billing_date`), quando houver — ISO CURTO 'YYYY-MM-DD', formatar por
   * STRING na tela (rotuloDeYmd). `billing_date` é coluna DATE e o pool fala UTC: passar por
   * `new Date` mostraria a véspera no fuso de São Paulo.
   */
  faturadoEm: null | string;
  /** Primeira entrada no estágio "Contrato gerado" (histórico). Nulo em venda antiga sem registro. */
  geradoEm: null | string;
  imobiliaria: null | string;
  lote: null | string;
  /**
   * O contrato assinado existe no D4Sign (há uuidDoc). É o que liga o botão de PDF da tela, que
   * aponta para /api/incorporador/contrato?unitId=… — rota que reconfere `unidadeNoEscopo` e
   * resolve o uuid NO C2X, nunca aceita uuid do navegador.
   */
  temContrato: boolean;
  /** Rótulo compacto código+quadra+lote (VALB0218), o mesmo da carteira. */
  unidade: string;
  /** A chave do botão de PDF. Único id que atravessa; a rota que o recebe reconfere o escopo. */
  unitId: number;
  /** Valor de tabela da unidade. */
  valorTabela: number;
};

export type ContratosDoPortal = {
  contratos: ContratoDoPortal[];
  /**
   * Contagem por situação do recorte INTEIRO, calculada ANTES do teto: é o que os chips da tela
   * mostram — contar só a lista cortada faria os chips divergirem do total do título.
   */
  porSituacao: Record<SituacaoDaAssinatura, number>;
  /** Quantos contratos vivos o escopo tem DE VERDADE, mesmo quando a lista foi cortada no teto. */
  total: number;
  truncado: boolean;
};

/** Um contrato vivo como sai do C2X, antes da montagem (o formato que os testes fixam). */
export type ContratoBruto = {
  arId: number;
  bloco: null | string;
  comprador: null | string;
  enterpriseCode: string;
  /** ISO curto 'YYYY-MM-DD' — a query já usa date_format, porque `billing_date` é DATE. */
  faturadoEm: null | string;
  geradoEm: null | Date | string;
  imobiliaria: null | string;
  lote: null | string;
  /** Data da proposta — o fallback de ordenação quando o histórico não tem a geração. */
  propostaEm: null | Date | string;
  unitId: number;
  valorTabela: number;
};

/** Um ENVIO válido à D4Sign (send=1, status≠6), agregado: quantas linhas, quantas assinadas. */
export type EnvioDeAssinatura = {
  arId: number;
  csId: number;
  linhas: number;
  linhasAssinadas: number;
  uuidDoc: null | string;
};

/**
 * O envio que VALE para um contrato, na regra documentada do estudo de assinaturas: o que tem
 * `uuidDoc`; se nenhum tem, o de maior id. É o que evita contar o mesmo contrato duas vezes
 * (média de 2 envios por contrato) e o que casa com o documento que o botão de PDF abre.
 */
export function escolherEnvio(envios: EnvioDeAssinatura[]): EnvioDeAssinatura | null {
  let melhor: EnvioDeAssinatura | null = null;

  for (const envio of envios) {
    if (!melhor) {
      melhor = envio;
      continue;
    }
    const envioTemUuid = Boolean(envio.uuidDoc);
    const melhorTemUuid = Boolean(melhor.uuidDoc);

    if (envioTemUuid !== melhorTemUuid) {
      if (envioTemUuid) melhor = envio;
      continue;
    }
    if (envio.csId > melhor.csId) melhor = envio;
  }

  return melhor;
}

/**
 * A situação resumida que a tela mostra:
 *   • sem envio válido           → "aguardando-emissao" (o contrato existe, ainda não saiu p/ assinar);
 *   • envio com TODAS as linhas  → "assinado";
 *   • qualquer outra coisa       → "em-assinatura" (inclui envio ainda sem linha registrada:
 *     o documento saiu, então "aguardando emissão" mentiria — medido, 0 casos assim no VAL).
 */
export function situacaoDaAssinatura(envio: EnvioDeAssinatura | null): SituacaoDaAssinatura {
  if (!envio) return "aguardando-emissao";
  if (envio.linhas > 0 && envio.linhasAssinadas >= envio.linhas) return "assinado";
  return "em-assinatura";
}

/**
 * Monta a lista final: junta contrato + envio escolhido, ordena do mais recente e aplica o teto.
 *
 * A ordenação usa geradoEm e cai para faturadoEm e depois propostaEm: no VAL só 13 de 39 têm a
 * geração no histórico, e ordenar só por ela jogaria dois terços da lista para o fim sem critério.
 */
export function montarContratos(
  brutos: ContratoBruto[],
  envios: EnvioDeAssinatura[],
  teto = TETO_DE_CONTRATOS,
): ContratosDoPortal {
  const enviosPorContrato = new Map<number, EnvioDeAssinatura[]>();
  for (const envio of envios) {
    const lista = enviosPorContrato.get(envio.arId) ?? [];
    lista.push(envio);
    enviosPorContrato.set(envio.arId, lista);
  }

  const ordenaveis = brutos.map((bruto) => {
    const envio = escolherEnvio(enviosPorContrato.get(bruto.arId) ?? []);

    return {
      contrato: {
        assinatura: situacaoDaAssinatura(envio),
        bloco: limparTexto(bruto.bloco),
        comprador: limparTexto(bruto.comprador),
        // Por STRING, nunca new Date: billing_date é DATE, e o ISO de meia-noite UTC viraria a
        // véspera quando a tela formatasse no fuso de São Paulo.
        faturadoEm: ymdOuNulo(bruto.faturadoEm),
        geradoEm: isoOuNulo(bruto.geradoEm),
        imobiliaria: limparTexto(bruto.imobiliaria),
        lote: limparTexto(bruto.lote),
        temContrato: Boolean(envio?.uuidDoc),
        unidade: rotuloDaUnidade(bruto.enterpriseCode, bruto.bloco, bruto.lote),
        unitId: bruto.unitId,
        valorTabela: bruto.valorTabela,
      } satisfies ContratoDoPortal,
      // Misturar ISO longo (geração/proposta) com ISO curto (faturamento) na régua de ordenação
      // funciona: o prefixo YYYY-MM-DD ordena igual nos dois formatos.
      ordem:
        isoOuNulo(bruto.geradoEm) ?? ymdOuNulo(bruto.faturadoEm) ?? isoOuNulo(bruto.propostaEm) ?? "",
    };
  });

  ordenaveis.sort((a, b) => b.ordem.localeCompare(a.ordem));

  // A contagem por situação olha o conjunto INTEIRO, antes do corte no teto.
  const porSituacao = contagemZerada();
  for (const item of ordenaveis) porSituacao[item.contrato.assinatura] += 1;

  return {
    contratos: ordenaveis.slice(0, teto).map((item) => item.contrato),
    porSituacao,
    total: ordenaveis.length,
    truncado: ordenaveis.length > teto,
  };
}

function contagemZerada(): Record<SituacaoDaAssinatura, number> {
  return { "aguardando-emissao": 0, assinado: 0, "em-assinatura": 0 };
}

/**
 * CLIENTES ÚNICOS das vendas vivas: quantas PESSOAS distintas estão comprando no escopo. Derivado
 * das unidades que a leitura de vendas JÁ traz (o `client` só vem preenchido em venda ativa),
 * então não custa uma query nova. Medido no VAL: 39 vendas vivas, 36 clientes únicos.
 *
 * ⚠️ A RÉGUA É O FUNIL VIVO INTEIRO, não só o vendido: `client` vem preenchido também em unidade
 * reservada e em proposta em análise. Num lançamento com fila de reservas este número passa o de
 * "Unidades vendidas" — e está certo. O tile da tela diz isso no apoio ("pessoas comprando neste
 * recorte"); se o Lucas preferir a régua do vendido, é aqui que se filtra pelo balde.
 */
export function clientesUnicos(unidades: Pick<ApoloVendaUnit, "client">[]): number {
  const distintos = new Set<string>();
  for (const unidade of unidades) {
    if (unidade.client) distintos.add(unidade.client.entityId);
  }
  return distintos.size;
}

type ContratoRow = RowDataPacket & Record<string, Date | number | string | null>;
type EnvioRow = RowDataPacket & Record<string, number | string | null>;

export type ResultadoContratos =
  | { data: ContratosDoPortal; ok: true }
  | { error: string; ok: false };

/**
 * Lê os contratos vivos do C2X (read-only) para os CÓDIGOS já autorizados pela sessão.
 *
 * ⚠️ Esta função NÃO autoriza nada: ela confia que `codes` veio de `codigosDaSessao` +
 * `codesDoRecorte`, como toda leitura do portal. É a rota que garante isso, antes de chamar.
 */
export async function lerContratosDoPortal(codes: string[]): Promise<ResultadoContratos> {
  const validCodes = codes
    .map((code) => code.trim().toUpperCase())
    .filter((code) => code && !EXCLUDED_ENTERPRISE_CODES.includes(code));

  if (validCodes.length === 0) {
    return { data: montarContratos([], []), ok: true };
  }

  const poolResult = getHadesDbPool();
  if (!poolResult.ok) {
    return { error: `Configuracao C2X ausente: ${poolResult.missing.join(", ")}.`, ok: false };
  }

  const codePlaceholders = validCodes.map(() => "?").join(", ");
  const vivosPlaceholders = ESTAGIOS_COM_CONTRATO.map(() => "?").join(", ");
  const geracaoPlaceholders = ESTAGIOS_DE_GERACAO.map(() => "?").join(", ");
  const nameSql = (alias: string) =>
    `coalesce(nullif(trim(${alias}.name), ''), nullif(trim(${alias}.fantasy_name), ''), nullif(trim(${alias}.social_name), ''))`;

  try {
    // Contratos vivos: a proposta MAIS RECENTE de cada unidade (mesmo padrão da leitura de
    // vendas), quando ela está num estágio com contrato.
    const [rows] = await poolResult.pool.query<ContratoRow[]>(
      `select u.id as unit_id, u.block, u.lot, u.price,
              e.code as enterprise_code,
              ar.id as ar_id, ar.created_at as proposta_em,
              date_format(ar.billing_date, '%Y-%m-%d') as billing_date,
              (select min(h.created_at) from acquisition_request_historics h
                 where h.acquisition_request_id = ar.id
                   and h.new_acquisition_request_stage_id in (${geracaoPlaceholders})) as gerado_em,
              ${nameSql("cli")} as comprador,
              ${nameSql("imo")} as imobiliaria
         from enterprise_unities u
         join enterprises e on e.id = u.enterprise_id
         join acquisition_requests ar on ar.id = (
                select ar2.id from acquisition_requests ar2
                 where ar2.enterprise_unity_id = u.id
                 order by ar2.created_at desc, ar2.id desc
                 limit 1)
         left join users cli on cli.id = ar.client_id
         left join users imo on imo.id = cli.vinculed_by_id
        where e.code in (${codePlaceholders})
          and ar.acquisition_request_stage_id in (${vivosPlaceholders})`,
      [...ESTAGIOS_DE_GERACAO, ...validCodes, ...ESTAGIOS_COM_CONTRATO],
    );

    const brutos: ContratoBruto[] = rows.map((row) => ({
      arId: Number(row.ar_id),
      bloco: textoOuNulo(row.block),
      comprador: textoOuNulo(row.comprador),
      enterpriseCode: String(row.enterprise_code ?? ""),
      // Já vem 'YYYY-MM-DD' do date_format: coluna DATE não pode virar Date do driver (o pool
      // fala UTC e a meia-noite viraria véspera na formatação em America/Sao_Paulo).
      faturadoEm: textoOuNulo(row.billing_date),
      geradoEm: row.gerado_em as Date | string | null,
      imobiliaria: textoOuNulo(row.imobiliaria),
      lote: textoOuNulo(row.lot),
      propostaEm: row.proposta_em as Date | string | null,
      unitId: Number(row.unit_id),
      valorTabela: Number(row.price ?? 0) || 0,
    }));

    if (brutos.length === 0) {
      return { data: montarContratos([], []), ok: true };
    }

    // Os envios VÁLIDOS destes contratos (regra do painel interno: send=1, status ≠ 6), já
    // agregados por envio: quantas linhas de assinatura, quantas assinadas.
    const arIds = brutos.map((bruto) => bruto.arId);
    const [envioRows] = await poolResult.pool.query<EnvioRow[]>(
      `select arc.acquisition_request_id as ar_id, cs.id as cs_id,
              nullif(trim(cs.uuidDoc), '') as uuid_doc,
              count(ss.id) as linhas,
              coalesce(sum(case when ss.signed = 1 then 1 else 0 end), 0) as assinadas
         from contract_signatures cs
         join acquisition_request_contracts arc on arc.id = cs.acquisition_request_contract_id
         left join contract_signature_signers ss on ss.contract_signature_id = cs.id
        where arc.acquisition_request_id in (?)
          and cs.send_document_signature = 1
          and cs.contract_signature_status_id <> 6
        group by arc.acquisition_request_id, cs.id, cs.uuidDoc`,
      [arIds],
    );

    const envios: EnvioDeAssinatura[] = envioRows.map((row) => ({
      arId: Number(row.ar_id),
      csId: Number(row.cs_id),
      linhas: Number(row.linhas ?? 0),
      linhasAssinadas: Number(row.assinadas ?? 0),
      uuidDoc: textoOuNulo(row.uuid_doc),
    }));

    return { data: montarContratos(brutos, envios), ok: true };
  } catch (error) {
    console.error("[incorporador][contratos] falha ao ler o C2X", error);
    return { error: "Não foi possível ler os contratos agora.", ok: false };
  }
}

// Mesmo padrão de `buildUnitCode` (vendas.ts/carteira.ts): 3 letras do code + quadra + lote sem o L.
function rotuloDaUnidade(
  enterpriseCode: string,
  block: null | string,
  lot: null | string,
): string {
  const prefix = String(enterpriseCode ?? "")
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase()
    .slice(0, 3)
    .padEnd(3, "X");
  const blockCode = String(block ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();
  const lotCode = String(lot ?? "")
    .replace(/[^a-z0-9]/gi, "")
    .replace(/^L/i, "")
    .toUpperCase();

  return `${prefix}${blockCode}${lotCode}`;
}

function limparTexto(valor: null | string): null | string {
  const limpo = typeof valor === "string" ? valor.trim() : "";
  return limpo || null;
}

function textoOuNulo(valor: unknown): null | string {
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}

function isoOuNulo(valor: null | Date | string): null | string {
  if (!valor) return null;
  const data = valor instanceof Date ? valor : new Date(String(valor));
  return Number.isNaN(data.getTime()) ? null : data.toISOString();
}

/** ISO curto 'YYYY-MM-DD' validado por STRING — sem `new Date`, que mudaria o dia no fuso. */
function ymdOuNulo(valor: null | string): null | string {
  const texto = String(valor ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(texto) ? texto : null;
}
