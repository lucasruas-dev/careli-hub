// O VIGIA DO CADASTRO, LADO SERVIDOR (PAN-124, fatia F3). Lê o C2X (SÓ SELECT) e o Panteon, chama a
// conferência pura (./vigia-do-cadastro), grava o retrato, abre ou atualiza um protocolo do Zeus por
// id divergente, notifica os admins só quando o protocolo NASCE e fecha o que voltou a bater.
//
// ONDE RODA. No sweep de notificações (lib/notifications/sweep.ts, cron de 15 min), e NÃO no
// incremental do Apolo, que o PAN-080 vai desligar. Três modos por rodada:
//   • bootstrap: o retrato está vazio (primeira rodada depois da 0201). Lê o C2X inteiro e a
//     auditoria de Enterprise inteira (134 linhas em 30/09/2026) e confere tudo;
//   • diario: uma vez por dia, na janela das 07:00 às 07:14 (BRT), se ainda não conferiu tudo hoje.
//     Confere todos os ids, e é o que fecha protocolo quando alguém acerta um dos lados;
//   • evento: fora disso, só se houver auditoria de Enterprise nova depois do cursor (o maior
//     `ultima_auditoria_id` do retrato). Confere só os ids auditados.
// Sem nada disso, a rodada custa UMA consulta ao C2X, por faixa de id (19 ms medidos em 30/09/2026).
//
// CUSTO DE UMA RODADA COMPLETA, medido em 30/09/2026: 37 empreendimentos no C2X (1 consulta), 38
// linhas de cadastro, os valores antigos de nome (view da 0192) e os códigos de 5.541 unidades do
// Panteon, em 6 páginas de 1.000 (só enterprise_id e codigo). Uma vez por dia.
//
// ⚠️ NA DÚVIDA, NÃO CONFERE. Se o cadastro ou as unidades não vierem, a rodada para sem gravar e sem
// fechar nada: conferir contra um lado vazio daria "sem cadastro" para todo mundo, ou fecharia os
// protocolos de prefixo como se tivessem sido resolvidos.
// ⚠️ A MIGRATION PODE NÃO ESTAR APLICADA. Sem a tabela do retrato (0201), o vigia devolve "parado" e
// não toca em nada.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { RowDataPacket } from "mysql2/promise";

import { getHadesDbPool } from "@/lib/guardian/db";
import { publishHubNotification } from "@/lib/notifications/publish";
import {
  loadOpenAlertProtocolsByFingerprintPrefix,
  syncOperationAlertProtocols,
  updateOperationAlertFeedback,
} from "@/lib/operations/alert-protocols";

import {
  alertaDoAviso,
  conferirCadastro,
  PREFIXO_DA_IMPRESSAO,
  protocolosAFechar,
  protocolosQueNasceram,
  textoDoMotivo,
  type CadastroParaOVigia,
  type EmpreendimentoNoC2x,
  type HistoricoDoC2x,
  type RetratoDoC2x,
} from "./vigia-do-cadastro";

// Mesmo workspace fixo das outras leituras do cadastro (lib/hercules/cadastro.ts).
const WORKSPACE = "careli";
const TABELA_DO_RETRATO = "hercules_empreendimentos_c2x_retrato";
const PAGINA = 1000;
// Teto da leitura por evento. Mais que isto numa rodada é carga de dados, não renome; o resto fica
// para a rodada seguinte, porque o cursor só anda até a última auditoria lida.
const LIMITE_DE_AUDITORIAS = 500;

export type ModoDoVigia = "bootstrap" | "diario" | "evento" | "parado";

export type ResultadoDoVigia = {
  avisos: number;
  fechados: number;
  modo: ModoDoVigia;
  notificados: number;
};

type HadesC2xPool = Extract<ReturnType<typeof getHadesDbPool>, { ok: true }>["pool"];

const PARADO: ResultadoDoVigia = { avisos: 0, fechados: 0, modo: "parado", notificados: 0 };

type LinhaDoRetrato = {
  cidade: string | null;
  codigo: string;
  enterprise_id: string;
  nome: string;
  nome_aceito: string;
  nomes_anteriores: string[] | null;
  prefixos_divergentes: number | null;
  sigla_divergente_aceita: boolean | null;
  siglas_anteriores: string[] | null;
  uf: string | null;
  ultima_auditoria_id: number | string | null;
  visto_em: string | null;
};

export async function vigiarCadastroContraOC2x(
  client: SupabaseClient,
  {
    agora = new Date(),
    listarAdmins,
  }: {
    agora?: Date;
    listarAdmins: () => Promise<string[]>;
  },
): Promise<ResultadoDoVigia> {
  const lidos = await lerRetratos(client);

  if (!lidos) {
    return PARADO;
  }

  const poolResult = getHadesDbPool();

  if (!poolResult.ok) {
    return PARADO;
  }

  const pool = poolResult.pool;
  const { retratos, vistoMaisAntigo } = lidos;
  let modo: ModoDoVigia;
  let auditorias: Map<string, number>;
  let historico: Map<string, HistoricoDoC2x> | undefined;

  if (retratos.size === 0) {
    modo = "bootstrap";
    ({ auditorias, historico } = await lerHistoricoDoC2x(pool));
  } else {
    const cursor = Math.max(0, ...[...retratos.values()].map((r) => r.ultimaAuditoriaId ?? 0));
    auditorias = await lerAuditoriasNovas(pool, cursor);

    if (ehJanelaDiaria(agora) && !conferidoHoje(vistoMaisAntigo, agora)) {
      modo = "diario";
    } else if (auditorias.size > 0) {
      modo = "evento";
    } else {
      return PARADO;
    }
  }

  const c2x = await lerEmpreendimentosDoC2x(pool);
  const cadastros = await lerCadastros(client);

  if (!cadastros || c2x.size === 0) {
    return PARADO;
  }

  const ids =
    modo === "evento"
      ? [...auditorias.keys()]
      : [...new Set([...c2x.keys(), ...cadastros.keys(), ...retratos.keys()])];
  const unidades = await lerUnidades(client, ids);

  if (!unidades) {
    return PARADO;
  }

  const resultado = conferirCadastro({
    auditorias,
    c2x,
    cadastros,
    historico,
    ids,
    nomesAntigosDoCadastro: await lerNomesAntigos(client),
    retratos,
    unidades,
  });

  if (!(await gravarRetratos(client, resultado.retratos, agora))) {
    return PARADO;
  }

  const fechados = await fecharOQueBateu(
    resultado.conferidos,
    resultado.avisos.map((aviso) => aviso.impressao),
    agora,
  );

  if (resultado.avisos.length === 0) {
    return { avisos: 0, fechados, modo, notificados: 0 };
  }

  const sincronia = await syncOperationAlertProtocols(
    resultado.avisos.map((aviso) => alertaDoAviso(aviso, agora)),
    null,
  );

  // Sem o banco dos protocolos, o reserva devolve TODO aviso como nascido (occurrenceCount 1). Notificar
  // aí seria notificar a cada 15 minutos.
  const nascidos =
    sincronia.status === "sincronizado" ? protocolosQueNasceram(sincronia.protocols) : [];
  let notificados = 0;

  if (nascidos.length > 0) {
    const admins = await listarAdmins();
    const avisoPorImpressao = new Map(resultado.avisos.map((aviso) => [aviso.impressao, aviso]));

    for (const protocolo of nascidos) {
      const aviso = avisoPorImpressao.get(protocolo.fingerprint);

      if (!aviso || admins.length === 0) {
        continue;
      }

      await publishHubNotification(
        {
          actionHref: "/zeus",
          body: aviso.motivos.map(textoDoMotivo).join(" "),
          context: {
            enterpriseId: aviso.enterpriseId,
            entityType: "cadastro-c2x",
            protocol: protocolo.protocol,
          },
          kind: "alerta",
          moduleId: "zeus",
          push: { tag: `cadastro-c2x:${aviso.enterpriseId}`, url: "/zeus" },
          recipientUserIds: admins,
          severity: "warning",
          title: `Cadastro diferente do C2X: ${aviso.rotulo}`,
        },
        client,
      );
      notificados += 1;
    }
  }

  return { avisos: resultado.avisos.length, fechados, modo, notificados };
}

// --- Janela diária ---

function partesEmBrasilia(agora: Date) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
    year: "numeric",
  }).formatToParts(agora);
  const valor = (tipo: string) => partes.find((parte) => parte.type === tipo)?.value ?? "0";

  return {
    dia: `${valor("year")}-${valor("month")}-${valor("day")}`,
    hora: Number.parseInt(valor("hour"), 10),
    minuto: Number.parseInt(valor("minute"), 10),
  };
}

/** Das 07:00 às 07:14 em Brasília: o cron de 15 min cai nela uma vez por dia. */
export function ehJanelaDiaria(agora: Date): boolean {
  const { hora, minuto } = partesEmBrasilia(agora);

  return hora === 7 && minuto < 15;
}

/** Todo id do retrato foi visto hoje (Brasília)? Então a conferência diária já rodou. */
export function conferidoHoje(vistoMaisAntigo: string | null, agora: Date): boolean {
  if (!vistoMaisAntigo) {
    return false;
  }

  const inicioDoDia = new Date(`${partesEmBrasilia(agora).dia}T00:00:00-03:00`);

  return new Date(vistoMaisAntigo).getTime() >= inicioDoDia.getTime();
}

// --- Panteon ---

async function lerRetratos(
  client: SupabaseClient,
): Promise<{ retratos: Map<string, RetratoDoC2x>; vistoMaisAntigo: string | null } | null> {
  const { data, error } = await client.from(TABELA_DO_RETRATO).select("*").limit(PAGINA);

  // Tabela ausente (0201 não aplicada) ou banco fora: não confere.
  if (error || !data) {
    return null;
  }

  const retratos = new Map<string, RetratoDoC2x>();
  let vistoMaisAntigo: string | null = null;

  for (const linha of data as LinhaDoRetrato[]) {
    retratos.set(linha.enterprise_id, {
      cidade: linha.cidade,
      codigo: linha.codigo,
      enterpriseId: linha.enterprise_id,
      nome: linha.nome,
      nomeAceito: linha.nome_aceito,
      nomesAnteriores: linha.nomes_anteriores ?? [],
      prefixosDivergentes: linha.prefixos_divergentes ?? 0,
      siglaDivergenteAceita: linha.sigla_divergente_aceita === true,
      siglasAnteriores: linha.siglas_anteriores ?? [],
      uf: linha.uf,
      ultimaAuditoriaId:
        linha.ultima_auditoria_id === null ? null : Number(linha.ultima_auditoria_id),
    });

    if (linha.visto_em && (!vistoMaisAntigo || linha.visto_em < vistoMaisAntigo)) {
      vistoMaisAntigo = linha.visto_em;
    }
  }

  return { retratos, vistoMaisAntigo };
}

async function lerCadastros(
  client: SupabaseClient,
): Promise<Map<string, CadastroParaOVigia> | null> {
  const { data, error } = await client
    .from("hercules_empreendimentos")
    .select("id,codigo,nome,cidade,uf,c2x_enterprise_id")
    .eq("workspace_id", WORKSPACE)
    .limit(PAGINA);

  if (error || !data) {
    return null;
  }

  const cadastros = new Map<string, CadastroParaOVigia>();

  for (const linha of data as Array<{
    c2x_enterprise_id: string | null;
    cidade: string | null;
    codigo: string;
    id: string;
    nome: string;
    uf: string | null;
  }>) {
    const c2xId = String(linha.c2x_enterprise_id ?? "").trim();

    // Pai sem id (LOX, PDX, RDX) não tem par no C2X: não há o que conferir.
    if (!c2xId) {
      continue;
    }

    cadastros.set(c2xId, {
      c2xId,
      cidade: linha.cidade,
      codigo: linha.codigo,
      id: linha.id,
      nome: linha.nome,
      uf: linha.uf,
    });
  }

  return cadastros;
}

/** Os nomes que já valeram no cadastro, por uuid. Falhou, fica sem: o silêncio só fica mais raro. */
async function lerNomesAntigos(client: SupabaseClient): Promise<Map<string, string[]>> {
  const nomes = new Map<string, string[]>();
  const { data, error } = await client
    .from("hercules_empreendimento_valores_antigos")
    .select("empreendimento_id,valor")
    .eq("workspace_id", WORKSPACE)
    .eq("campo", "nome")
    .limit(PAGINA);

  if (error || !data) {
    return nomes;
  }

  for (const linha of data as Array<{ empreendimento_id: string; valor: string | null }>) {
    if (!linha.valor) continue;
    nomes.set(linha.empreendimento_id, [...(nomes.get(linha.empreendimento_id) ?? []), linha.valor]);
  }

  return nomes;
}

/** Os códigos das unidades do Panteon, por id do C2X, paginados pelo teto de 1.000 do PostgREST. */
async function lerUnidades(
  client: SupabaseClient,
  ids: readonly string[],
): Promise<Map<string, string[]> | null> {
  const unidades = new Map<string, string[]>();

  if (ids.length === 0) {
    return unidades;
  }

  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await client
      .from("hercules_unidades")
      .select("id,enterprise_id,codigo")
      .in("enterprise_id", [...ids])
      .order("id", { ascending: true })
      .range(desde, desde + PAGINA - 1);

    if (error || !data) {
      return null;
    }

    for (const linha of data as Array<{ codigo: string | null; enterprise_id: string | null }>) {
      const id = String(linha.enterprise_id ?? "").trim();
      if (!id || !linha.codigo) continue;
      unidades.set(id, [...(unidades.get(id) ?? []), linha.codigo]);
    }

    if (data.length < PAGINA) {
      return unidades;
    }
  }
}

async function gravarRetratos(
  client: SupabaseClient,
  retratos: readonly RetratoDoC2x[],
  agora: Date,
): Promise<boolean> {
  if (retratos.length === 0) {
    return true;
  }

  const { error } = await client.from(TABELA_DO_RETRATO).upsert(
    retratos.map((retrato) => ({
      cidade: retrato.cidade,
      codigo: retrato.codigo,
      enterprise_id: retrato.enterpriseId,
      nome: retrato.nome,
      nome_aceito: retrato.nomeAceito,
      nomes_anteriores: retrato.nomesAnteriores,
      prefixos_divergentes: retrato.prefixosDivergentes,
      sigla_divergente_aceita: retrato.siglaDivergenteAceita,
      siglas_anteriores: retrato.siglasAnteriores,
      uf: retrato.uf,
      ultima_auditoria_id: retrato.ultimaAuditoriaId,
      visto_em: agora.toISOString(),
      workspace_id: WORKSPACE,
    })),
    { onConflict: "enterprise_id" },
  );

  return !error;
}

async function fecharOQueBateu(
  conferidos: readonly string[],
  impressoesDeAgora: readonly string[],
  agora: Date,
): Promise<number> {
  let abertos: Awaited<ReturnType<typeof loadOpenAlertProtocolsByFingerprintPrefix>>;

  try {
    abertos = await loadOpenAlertProtocolsByFingerprintPrefix(PREFIXO_DA_IMPRESSAO);
  } catch {
    return 0;
  }

  let fechados = 0;
  const quando = partesEmBrasilia(agora).dia;

  for (const protocolo of protocolosAFechar(abertos, conferidos, impressoesDeAgora)) {
    try {
      await updateOperationAlertFeedback({
        feedback: `Fechado pelo vigia do cadastro em ${quando}: o cadastro do Panteon e o C2X voltaram a bater neste ponto, ou a divergência mudou e abriu protocolo próprio.`,
        protocol: protocolo.protocol,
        status: "corrigido",
        userId: null,
      });
      fechados += 1;
    } catch {
      // Fica aberto; a próxima conferência tenta de novo.
    }
  }

  return fechados;
}

// --- C2X (SÓ SELECT) ---

async function lerEmpreendimentosDoC2x(
  pool: HadesC2xPool,
): Promise<Map<string, EmpreendimentoNoC2x>> {
  const [linhas] = await pool.query<
    (RowDataPacket & {
      cidade: string | null;
      code: string | null;
      id: number;
      name: string | null;
      uf: string | null;
    })[]
  >(
    `select e.id, e.code, e.name, ci.name as cidade, st.acronym as uf
       from enterprises e
       left join cities ci on ci.id = e.city_id
       left join states st on st.id = ci.state_id`,
  );
  const empreendimentos = new Map<string, EmpreendimentoNoC2x>();

  for (const linha of linhas) {
    const id = String(linha.id);
    empreendimentos.set(id, {
      cidade: linha.cidade?.trim() || null,
      codigo: String(linha.code ?? "").trim(),
      id,
      nome: String(linha.name ?? "").trim(),
      uf: linha.uf?.trim() || null,
    });
  }

  return empreendimentos;
}

/** A última auditoria de Enterprise depois do cursor, por id. Só id e auditable_id: nada do JSON. */
async function lerAuditoriasNovas(
  pool: HadesC2xPool,
  cursor: number,
): Promise<Map<string, number>> {
  const [linhas] = await pool.query<
    (RowDataPacket & { auditable_id: number | null; id: number })[]
  >(
    `select id, auditable_id from audits
      where auditable_type = 'Enterprise' and id > ?
      order by id asc limit ${LIMITE_DE_AUDITORIAS}`,
    [cursor],
  );
  const auditorias = new Map<string, number>();

  for (const linha of linhas) {
    if (!linha.auditable_id) continue;
    const id = String(linha.auditable_id);
    auditorias.set(id, Math.max(auditorias.get(id) ?? 0, Number(linha.id)));
  }

  return auditorias;
}

/**
 * O primeiro preenchimento: a última auditoria de cada id e o que ele já se chamou. Do JSON da
 * auditoria sai só o valor ANTERIOR de name e de code (json_extract), nunca o resto: nada de autor,
 * IP ou dado de pessoa.
 */
async function lerHistoricoDoC2x(
  pool: HadesC2xPool,
): Promise<{ auditorias: Map<string, number>; historico: Map<string, HistoricoDoC2x> }> {
  const [ultimas] = await pool.query<
    (RowDataPacket & { auditable_id: number | null; ultima: number })[]
  >(
    `select auditable_id, max(id) as ultima from audits
      where auditable_type = 'Enterprise' group by auditable_id`,
  );
  const [trocas] = await pool.query<
    (RowDataPacket & {
      auditable_id: number | null;
      nome_antes: string | null;
      sigla_antes: string | null;
    })[]
  >(
    `select auditable_id,
            json_unquote(json_extract(audited_changes, '$.name[0]')) as nome_antes,
            json_unquote(json_extract(audited_changes, '$.code[0]')) as sigla_antes
       from audits
      where auditable_type = 'Enterprise' and action = 'update'
      order by id asc`,
  );
  const auditorias = new Map<string, number>();
  const historico = new Map<string, HistoricoDoC2x>();

  for (const linha of ultimas) {
    if (linha.auditable_id) auditorias.set(String(linha.auditable_id), Number(linha.ultima));
  }

  for (const linha of trocas) {
    if (!linha.auditable_id) continue;
    const id = String(linha.auditable_id);
    const atual = historico.get(id) ?? { nomes: [], siglas: [] };
    const nome = valorDoJson(linha.nome_antes);
    const sigla = valorDoJson(linha.sigla_antes);
    if (nome) atual.nomes.push(nome);
    if (sigla) atual.siglas.push(sigla);
    historico.set(id, atual);
  }

  return { auditorias, historico };
}

/** json_unquote de um null do JSON devolve o texto "null". */
function valorDoJson(valor: string | null): string | null {
  const texto = String(valor ?? "").trim();

  return texto && texto !== "null" ? texto : null;
}
