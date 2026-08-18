// GESTÃO DE ASSINATURA — a aba de Vendas do portal do incorporador que mostra a fila de
// assinaturas dos contratos do escopo: KPIs, o quadro por assinante e os contratos pendentes.
//
// A REFERÊNCIA É O PAINEL INTERNO (lib/apolo/painel-assinatura.ts), e as regras dele são
// IMPORTADAS, não copiadas:
//   • `marcarSituacao` — assinado / vez / aguardando respeitando a ORDEM dos assinantes
//     (`after_position`): é a regra que o dono definiu, e é a diferença entre cobrar a pessoa
//     certa e a errada (o caso Northon: 181 "pendências" quando só 2 estavam com ele);
//   • `perfilDeTela` — Cliente vira Comprador, e-mail @careli.adm.br vira Backoffice;
//   • o filtro de envio: `send_document_signature = 1` e status ≠ 6.
//
// Por CONTRATO (proposta) vale UM envio — o com uuidDoc, senão o de maior id (`escolherEnvio`,
// de contratos.ts): a média é de 2 envios por contrato e contar todos dobraria o quadro.
//
// ⚠️ ENVIO VÁLIDO SEM NENHUM ASSINANTE EXISTE (contratos.ts admite o cenário; medido 0 casos no
// VAL, mas o portal vai além do VAL). Por isso a leitura usa LEFT JOIN em
// `contract_signature_signers`, como a aba Contratos: com join interno o envio sumiria, o
// contrato cairia (errado) no KPI "Aguardando emissão" e as duas abas se contradiriam para o
// MESMO contrato. Aqui ele entra nos pendentes como "sem assinante registrado".
//
// ⚠️ RÉGUA IMPORTADA À RISCA (decisão registrada): as linhas NÃO filtram estágio nem se
// restringem à proposta mais recente da unidade — fiel ao painel interno. Um envio pendente de
// venda já distratada/cancelada segue em "Contratos aguardando assinatura" até o envio ser
// cancelado no C2X (status 6). Se o Lucas decidir que o portal (vitrine externa) deve esconder
// esses mortos, o corte é cruzar `enviosPorAr` com os `vivos` que esta função já lê.
//
// OS NOMES DOS ASSINANTES DO FLUXO APARECEM — decisão já comunicada ao dono: o incorporador é
// parte do contrato e assina junto; esconder quem está segurando a fila inutilizaria o quadro.
// E-mail e telefone NÃO atravessam (o e-mail entra só na tradução de perfil, no servidor).
//
// Medido no C2X em 18/08/2026 (VAL, o portal de teste): 39 contratos vivos, 39 com envio válido,
// 39 totalmente assinados, 61 linhas de Comprador (todas assinadas), 0 aguardando emissão, tempo
// médio geração→última assinatura de 9,9 dias (n=13; só 13 têm a geração no histórico).
import type { RowDataPacket } from "mysql2";

import {
  marcarSituacao,
  perfilDeTela,
  type LinhaAssinatura,
} from "@/lib/apolo/painel-assinatura";
import { EXCLUDED_ENTERPRISE_CODES } from "@/lib/guardian/c2x-analytics";
import { getHadesDbPool } from "@/lib/guardian/db";

import {
  escolherEnvio,
  ESTAGIOS_COM_CONTRATO,
  ESTAGIOS_DE_GERACAO,
  type EnvioDeAssinatura,
} from "./contratos";

export type AssinanteDoQuadro = {
  /** Contratos em que a fila parou em ALGUÉM ANTES dele: pendência que não é dele (ainda). */
  aguardandoAnteriores: number;
  /** Contratos que ele já assinou. */
  assinou: number;
  /** Contratos em que a bola está COM ELE agora: é a fila do gargalo. */
  naVez: number;
  nome: string;
  /** Perfil traduzido (Comprador, Imobiliária, Incorporador, Backoffice…), quando existe. */
  papel: null | string;
};

export type ContratoPendenteDeAssinatura = {
  empreendimento: string;
  /** Data em que o contrato saiu para assinatura (ISO curto, "2026-07-01"). */
  enviadoEm: string;
  /** Quem está na vez NESTE contrato — pode ser mais de um (degrau dividido assina em paralelo). */
  naVez: string[];
  unidade: string;
};

export type KpisDeAssinatura = {
  /** Contratos vivos que ainda NÃO saíram para assinar (sem envio válido na D4Sign). */
  aguardandoEmissao: number;
  /** % das linhas de Comprador já assinadas (0–100). Nulo sem nenhum comprador no escopo. */
  pctCompradoresAssinaram: null | number;
  /** Média de dias entre a geração do contrato e a ÚLTIMA assinatura dele. Nulo sem amostra. */
  tempoMedioDias: null | number;
  /** Unidades cujo(s) contrato(s) enviados estão 100% assinados. */
  unidadesTotalmenteAssinadas: number;
  /** Unidades com pelo menos um contrato enviado para assinatura. */
  unidadesComEnvio: number;
};

export type QuadroDeAssinaturas = {
  assinantes: AssinanteDoQuadro[];
  kpis: KpisDeAssinatura;
  pendentes: ContratoPendenteDeAssinatura[];
};

/** Um contrato vivo do escopo: id da proposta + quando o contrato foi gerado (histórico). */
export type ContratoVivo = {
  arId: number;
  geradoEm: null | string;
};

/** Um envio VÁLIDO que saiu para a D4Sign sem NENHUMA linha de assinante registrada. */
export type EnvioSemAssinante = {
  emp: string;
  /** Data do envio (ISO curto), mesma régua de `ContratoPendenteDeAssinatura.enviadoEm`. */
  enviadoEm: string;
  un: string;
};

/**
 * Monta o quadro inteiro a partir das LINHAS de assinatura (já do envio escolhido de cada
 * contrato) e dos contratos vivos do escopo. Função pura: é ela que os testes fixam.
 *
 * @param linhas        Linhas de assinatura no formato do painel interno.
 * @param vivos         Contratos vivos do escopo (para o KPI de emissão e o tempo médio).
 * @param arPorEnvio    De qual proposta (`ar_id`) é cada envio (`LinhaAssinatura.contrato`) —
 *                      INCLUSIVE o envio sem linha: é o que o tira do KPI "Aguardando emissão".
 * @param semAssinante  Envios escolhidos sem nenhuma linha: entram como pendentes visíveis.
 */
export function montarQuadroDeAssinaturas(
  linhas: LinhaAssinatura[],
  vivos: ContratoVivo[],
  arPorEnvio: Map<number, number>,
  semAssinante: EnvioSemAssinante[] = [],
): QuadroDeAssinaturas {
  // A regra da fila é a do painel interno, importada: quem está na vez é quem divide o menor
  // degrau ainda pendente DAQUELE contrato.
  const situadas = marcarSituacao(linhas);

  // ── KPIs ──────────────────────────────────────────────────────────────────────────────────
  const compradores = situadas.filter((linha) => linha.perfil === "Comprador");
  const compradoresAssinados = compradores.filter((linha) => linha.assinou).length;

  const porContrato = new Map<number, LinhaAssinatura[]>();
  for (const linha of situadas) {
    const lista = porContrato.get(linha.contrato) ?? [];
    lista.push(linha);
    porContrato.set(linha.contrato, lista);
  }

  // Unidade 100% assinada = TODOS os envios dela com todas as linhas assinadas (uma unidade
  // revendida pode ter mais de um contrato com envio; um pendente segura a unidade).
  //
  // ⚠️ A CHAVE É empreendimento + unidade: no recorte "todos", dois loteamentos podem batizar a
  // unidade com o MESMO nome, e chavear só pelo nome subcontaria (e uma pendente de um seguraria
  // a homônima do outro).
  const unidades = new Map<string, boolean>();
  for (const [, doContrato] of porContrato) {
    const chave = `${doContrato[0]?.emp ?? ""}:${doContrato[0]?.un ?? ""}`;
    const completo = doContrato.every((linha) => linha.assinou);
    unidades.set(chave, (unidades.get(chave) ?? true) && completo);
  }
  // Envio sem nenhum assinante registrado: a unidade TEM envio, e não está 100% assinada.
  for (const envio of semAssinante) {
    unidades.set(`${envio.emp}:${envio.un}`, false);
  }
  const unidadesTotalmenteAssinadas = [...unidades.values()].filter(Boolean).length;

  // Tempo médio: geração do contrato (primeira entrada no estágio "Contrato gerado") até a
  // ÚLTIMA assinatura do envio. Só contratos completos e com a geração registrada entram — as
  // vendas antigas do C2X não têm o histórico, e chutar a data mentiria a média.
  const geradoPorAr = new Map(vivos.map((vivo) => [vivo.arId, vivo.geradoEm]));
  const temposDias: number[] = [];
  for (const [contrato, doContrato] of porContrato) {
    if (!doContrato.every((linha) => linha.assinou)) continue;
    const arId = arPorEnvio.get(contrato);
    const gerado = arId === undefined ? null : geradoPorAr.get(arId) ?? null;
    if (!gerado) continue;
    const ultima = doContrato
      .map((linha) => linha.assinadoEm)
      .filter((data): data is string => Boolean(data))
      .sort()
      .at(-1);
    if (!ultima) continue;
    const dias = (new Date(ultima).getTime() - new Date(gerado).getTime()) / 86_400_000;
    if (Number.isFinite(dias)) temposDias.push(Math.max(0, dias));
  }

  const arsComEnvio = new Set(arPorEnvio.values());
  const aguardandoEmissao = vivos.filter((vivo) => !arsComEnvio.has(vivo.arId)).length;

  // ── O QUADRO POR ASSINANTE ────────────────────────────────────────────────────────────────
  const assinantes = new Map<string, AssinanteDoQuadro>();
  for (const linha of situadas) {
    const nome = linha.usuario;
    if (!nome) continue;
    const atual = assinantes.get(nome) ?? {
      aguardandoAnteriores: 0,
      assinou: 0,
      naVez: 0,
      nome,
      papel: linha.perfil || null,
    };
    if (linha.situacao === "assinado") atual.assinou += 1;
    else if (linha.situacao === "vez") atual.naVez += 1;
    else atual.aguardandoAnteriores += 1;
    assinantes.set(nome, atual);
  }

  // ── CONTRATOS PENDENTES, com quem está na vez em cada um ──────────────────────────────────
  const pendentes: ContratoPendenteDeAssinatura[] = [];
  for (const [, doContrato] of porContrato) {
    if (doContrato.every((linha) => linha.assinou)) continue;
    const naVez = [
      ...new Set(
        doContrato
          .filter((linha) => linha.situacao === "vez")
          .map((linha) => linha.usuario)
          .filter(Boolean),
      ),
    ];
    pendentes.push({
      empreendimento: doContrato[0]?.emp ?? "",
      enviadoEm: doContrato[0]?.envio ?? "",
      naVez,
      unidade: doContrato[0]?.un ?? "",
    });
  }
  // O envio que saiu sem nenhum assinante registrado é pendência VISÍVEL: não aparece no quadro
  // por assinante (não há linha de quem cobrar), mas não pode sumir da lista — a tela mostra
  // "sem assinante registrado" quando `naVez` vem vazio.
  for (const envio of semAssinante) {
    pendentes.push({
      empreendimento: envio.emp,
      enviadoEm: envio.enviadoEm,
      naVez: [],
      unidade: envio.un,
    });
  }
  // O mais antigo primeiro: é onde o gargalo dói há mais tempo.
  pendentes.sort((a, b) => a.enviadoEm.localeCompare(b.enviadoEm));

  return {
    // Quem tem mais contrato NA VEZ primeiro: o quadro existe para achar o gargalo.
    assinantes: [...assinantes.values()].sort(
      (a, b) =>
        b.naVez - a.naVez ||
        b.aguardandoAnteriores - a.aguardandoAnteriores ||
        b.assinou - a.assinou ||
        a.nome.localeCompare(b.nome, "pt-BR"),
    ),
    kpis: {
      aguardandoEmissao,
      pctCompradoresAssinaram:
        compradores.length > 0
          ? arredondar1((compradoresAssinados / compradores.length) * 100)
          : null,
      tempoMedioDias:
        temposDias.length > 0
          ? arredondar1(temposDias.reduce((soma, dias) => soma + dias, 0) / temposDias.length)
          : null,
      unidadesTotalmenteAssinadas,
      unidadesComEnvio: unidades.size,
    },
    pendentes,
  };
}

type LinhaRow = RowDataPacket & {
  ar_id: number;
  assinado: null | number;
  data_assinatura: null | string;
  dias_envio: null | number;
  email: null | string;
  emp: null | string;
  envio: null | string;
  id_ass: number;
  lot: null | string;
  perfil_c2x: null | string;
  posicao: null | number;
  quadra: null | string;
  /** Nulo = envio sem NENHUM assinante (o LEFT JOIN devolve uma linha só, vazia). */
  signer_id: null | number;
  unidade: null | string;
  usuario: null | string;
  uuid_doc: null | string;
  valor: null | number | string;
};

type VivoRow = RowDataPacket & { ar_id: number; gerado_em: null | Date | string };

export type ResultadoAssinaturas =
  | { data: QuadroDeAssinaturas; ok: true }
  | { error: string; ok: false };

/**
 * Lê o cenário de assinaturas do C2X (read-only) para os CÓDIGOS já autorizados pela sessão.
 *
 * ⚠️ Esta função NÃO autoriza nada: `codes` tem que vir de `codigosDaSessao` + `codesDoRecorte`,
 * e é a rota que garante isso antes de chamar.
 */
export async function lerAssinaturasDoPortal(codes: string[]): Promise<ResultadoAssinaturas> {
  const validCodes = codes
    .map((code) => code.trim().toUpperCase())
    .filter((code) => code && !EXCLUDED_ENTERPRISE_CODES.includes(code));

  if (validCodes.length === 0) {
    return { data: montarQuadroDeAssinaturas([], [], new Map()), ok: true };
  }

  const poolResult = getHadesDbPool();
  if (!poolResult.ok) {
    return { error: `Configuracao C2X ausente: ${poolResult.missing.join(", ")}.`, ok: false };
  }

  const placeholders = validCodes.map(() => "?").join(", ");
  const vivosPlaceholders = ESTAGIOS_COM_CONTRATO.map(() => "?").join(", ");
  const geracaoPlaceholders = ESTAGIOS_DE_GERACAO.map(() => "?").join(", ");

  try {
    // As LINHAS de assinatura do escopo — a MESMA consulta do painel interno (filtro de envio
    // incluído), escopada por código e com o ar_id e o uuidDoc a mais, para escolher o envio.
    //
    // ⚠️ `contract_signature_signers` entra por LEFT JOIN (diferença deliberada do painel
    // interno): envio válido sem nenhum assinante precisa aparecer — com join interno ele some,
    // cai no KPI errado e contradiz a aba Contratos (ver o cabeçalho). O `signer_id` nulo é o
    // marcador dessas linhas vazias.
    const [linhaRows] = await poolResult.pool.query<LinhaRow[]>(
      `select
         e.code as emp,
         coalesce(nullif(trim(u.name), ''), concat(e.code, u.block, u.lot)) as unidade,
         u.block as quadra, u.lot, u.price as valor,
         cs.id as id_ass,
         ar.id as ar_id,
         nullif(trim(cs.uuidDoc), '') as uuid_doc,
         date_format(cs.created_at, '%Y-%m-%d') as envio,
         datediff(now(), cs.created_at) as dias_envio,
         ss.id as signer_id,
         ss.user_name as usuario,
         ss.email,
         pf.name as perfil_c2x,
         ss.signed as assinado,
         date_format(ss.date_signed, '%Y-%m-%d') as data_assinatura,
         ss.after_position as posicao
       from contract_signatures cs
       join acquisition_request_contracts arc on arc.id = cs.acquisition_request_contract_id
       join acquisition_requests ar on ar.id = arc.acquisition_request_id
       join enterprise_unities u on u.id = ar.enterprise_unity_id
       join enterprises e on e.id = u.enterprise_id
       left join contract_signature_signers ss on ss.contract_signature_id = cs.id
       left join contract_signers csg on csg.id = ss.contract_signer_id
       left join signers sg on sg.id = csg.signer_id
       left join users usr on usr.id = sg.user_id
       left join profiles pf on pf.id = usr.profile_id
       where e.code in (${placeholders})
         and cs.send_document_signature = 1
         and cs.contract_signature_status_id <> 6
       order by e.code, u.block, u.lot, ss.after_position, ss.id`,
      validCodes,
    );

    // Os contratos VIVOS do escopo (mesma régua da aba de contratos), com a data de geração.
    const [vivoRows] = await poolResult.pool.query<VivoRow[]>(
      `select ar.id as ar_id,
              (select min(h.created_at) from acquisition_request_historics h
                 where h.acquisition_request_id = ar.id
                   and h.new_acquisition_request_stage_id in (${geracaoPlaceholders})) as gerado_em
         from enterprise_unities u
         join enterprises e on e.id = u.enterprise_id
         join acquisition_requests ar on ar.id = (
                select ar2.id from acquisition_requests ar2
                 where ar2.enterprise_unity_id = u.id
                 order by ar2.created_at desc, ar2.id desc
                 limit 1)
        where e.code in (${placeholders})
          and ar.acquisition_request_stage_id in (${vivosPlaceholders})`,
      [...ESTAGIOS_DE_GERACAO, ...validCodes, ...ESTAGIOS_COM_CONTRATO],
    );

    // Por contrato, UM envio: o com uuidDoc, senão o de maior id (regra do estudo, reusada).
    const enviosPorAr = new Map<number, EnvioDeAssinatura[]>();
    for (const row of linhaRows) {
      const arId = Number(row.ar_id);
      const lista = enviosPorAr.get(arId) ?? [];
      if (!lista.some((envio) => envio.csId === Number(row.id_ass))) {
        lista.push({
          arId,
          csId: Number(row.id_ass),
          linhas: 0,
          linhasAssinadas: 0,
          uuidDoc: row.uuid_doc,
        });
      }
      enviosPorAr.set(arId, lista);
    }
    const enviosEscolhidos = new Set<number>();
    const arPorEnvio = new Map<number, number>();
    for (const [arId, envios] of enviosPorAr) {
      const escolhido = escolherEnvio(envios);
      if (escolhido) {
        enviosEscolhidos.add(escolhido.csId);
        arPorEnvio.set(escolhido.csId, arId);
      }
    }

    // Envio escolhido SEM nenhuma linha de assinante: o LEFT JOIN devolve exatamente uma linha
    // vazia (signer_id nulo). Ele já conta em `arPorEnvio` (sai do KPI de emissão) e entra nos
    // pendentes como "sem assinante registrado".
    const semAssinante: EnvioSemAssinante[] = linhaRows
      .filter((row) => row.signer_id === null && enviosEscolhidos.has(Number(row.id_ass)))
      .map((row) => ({
        emp: String(row.emp ?? ""),
        enviadoEm: String(row.envio ?? ""),
        un: limpo(row.unidade),
      }));

    const linhas: LinhaAssinatura[] = linhaRows
      .filter((row) => row.signer_id !== null && enviosEscolhidos.has(Number(row.id_ass)))
      .map((row) => {
        const email = String(row.email ?? "").trim().toLowerCase();
        return {
          assinadoEm: row.data_assinatura,
          assinou: Number(row.assinado) === 1,
          contrato: Number(row.id_ass),
          degrau: Number(row.posicao ?? 0),
          diasDesdeEnvio: Number(row.dias_envio ?? 0),
          email,
          emp: String(row.emp ?? ""),
          envio: String(row.envio ?? ""),
          lote: limpo(row.lot),
          perfil: perfilDeTela(row.perfil_c2x, email),
          // O portal não mostra o prazo do comprador; o campo existe no tipo do painel interno.
          prazo: null,
          quadra: limpo(row.quadra),
          // Preenchido por `marcarSituacao` dentro de `montarQuadroDeAssinaturas`.
          situacao: "aguardando",
          un: limpo(row.unidade),
          usuario: limpo(row.usuario),
          valor: Math.round(Number(row.valor ?? 0)),
        };
      });

    const vivos: ContratoVivo[] = vivoRows.map((row) => ({
      arId: Number(row.ar_id),
      geradoEm: isoOuNulo(row.gerado_em),
    }));

    return { data: montarQuadroDeAssinaturas(linhas, vivos, arPorEnvio, semAssinante), ok: true };
  } catch (error) {
    console.error("[incorporador][assinaturas] falha ao ler o C2X", error);
    return { error: "Não foi possível ler as assinaturas agora.", ok: false };
  }
}

function limpo(valor: unknown): string {
  return String(valor ?? "").trim().replace(/\s+/g, " ");
}

function isoOuNulo(valor: null | Date | string): null | string {
  if (!valor) return null;
  const data = valor instanceof Date ? valor : new Date(String(valor));
  return Number.isNaN(data.getTime()) ? null : data.toISOString();
}

function arredondar1(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 10) / 10;
}
