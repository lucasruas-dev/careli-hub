// Prometeu: acesso a dados do dia do lancamento (server-side, service role).
//
// Reusa o admin client do Apolo — e o mesmo projeto Supabase, nao vale abrir outro.
// Escrita SO por aqui (as rotas chamam estas funcoes); RLS deixa o hub autenticado apenas ler.
import { createApoloAdminClient } from "@/lib/apolo/server";

import {
  type PrometeuCredenciado,
  type PrometeuEtapa,
  type PrometeuEvento,
  type PrometeuEventoConfig,
  type PrometeuEventoStatus,
  type PrometeuJanela,
  type PrometeuMesa,
  type PrometeuUnidade,
} from "./types";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

export function createPrometeuClient(): AdminClient | null {
  return createApoloAdminClient();
}

// O evento roda em horario de Brasilia, o servidor em UTC. Toda comparacao com a janela de
// credenciamento passa por aqui — errar o fuso bagunçaria a ordem da fila no dia.
// `sv-SE` formata como ISO ("2026-08-01 08:32:10"), que e o que queremos comparar com
// `data` (date) e `hora_inicio`/`hora_fim` (time) do banco.
const FUSO_EVENTO = "America/Sao_Paulo";

export function agoraNoEvento(momento = new Date()): { data: string; hora: string } {
  const texto = new Intl.DateTimeFormat("sv-SE", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone: FUSO_EVENTO,
    year: "numeric",
  }).format(momento);

  const [data = "", hora = ""] = texto.split(" ");
  return { data, hora };
}

type EventoRow = {
  config: PrometeuEventoConfig | null;
  data_evento: string | null;
  enterprise_code: string | null;
  enterprise_id: string | null;
  id: string;
  iniciado_em: string | null;
  nome: string;
  status: string;
};

type CredenciadoRow = {
  corretor: string | null;
  created_at: string;
  credenciado_na_janela: boolean | null;
  documento: string | null;
  entity_id: string | null;
  entrou_em: string | null;
  etapa: string;
  etapa_desde: string;
  etiqueta_impressa_em: string | null;
  evento_id: string;
  id: string;
  imobiliaria: string | null;
  nome: string;
  ordem_fila: number | null;
  ordem_motivo: string | null;
  origem: string;
  pago_em: string | null;
};

type UnidadeRow = {
  codigo: string;
  credenciado_id: string;
  id: string;
  lote: string | null;
  quadra: string | null;
  situacao: string;
};

const CAMPOS_EVENTO =
  "id, nome, enterprise_id, enterprise_code, data_evento, status, config, iniciado_em";
const CAMPOS_CREDENCIADO =
  "id, evento_id, entity_id, nome, documento, imobiliaria, corretor, etapa, entrou_em, etapa_desde, pago_em, origem, etiqueta_impressa_em, ordem_fila, ordem_motivo, credenciado_na_janela, created_at";

function mapEvento(row: EventoRow): PrometeuEvento {
  return {
    config: row.config ?? {},
    dataEvento: row.data_evento,
    enterpriseCode: row.enterprise_code,
    enterpriseId: row.enterprise_id,
    id: row.id,
    iniciadoEm: row.iniciado_em,
    nome: row.nome,
    status: (row.status as PrometeuEventoStatus) ?? "rascunho",
  };
}

// ------------------------------------------------------------------ eventos

export async function listEventos(client: AdminClient): Promise<PrometeuEvento[]> {
  const { data, error } = await client
    .from("prometeu_eventos")
    .select(CAMPOS_EVENTO)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error || !data) return [];
  return (data as EventoRow[]).map(mapEvento);
}

export async function getEvento(
  client: AdminClient,
  eventoId: string,
): Promise<PrometeuEvento | null> {
  const { data, error } = await client
    .from("prometeu_eventos")
    .select(CAMPOS_EVENTO)
    .eq("id", eventoId)
    .maybeSingle();

  if (error || !data) return null;
  return mapEvento(data as EventoRow);
}

export async function criarEvento(input: {
  client: AdminClient;
  config?: PrometeuEventoConfig;
  createdBy?: string | null;
  dataEvento?: string | null;
  enterpriseCode?: string | null;
  enterpriseId?: string | null;
  nome: string;
}): Promise<{ error?: string; evento?: PrometeuEvento }> {
  const nome = input.nome.trim();
  if (!nome) return { error: "Informe o nome do evento." };

  const { data, error } = await input.client
    .from("prometeu_eventos")
    .insert({
      config: input.config ?? {},
      created_by: input.createdBy ?? null,
      data_evento: input.dataEvento ?? null,
      enterprise_code: input.enterpriseCode ?? null,
      enterprise_id: input.enterpriseId ?? null,
      nome,
    })
    .select(CAMPOS_EVENTO)
    .single();

  if (error || !data) return { error: error?.message ?? "Nao foi possivel criar o evento." };
  return { evento: mapEvento(data as EventoRow) };
}

export async function atualizarEvento(input: {
  client: AdminClient;
  config?: PrometeuEventoConfig;
  dataEvento?: string | null;
  enterpriseCode?: string | null;
  enterpriseId?: string | null;
  eventoId: string;
  nome?: string;
}): Promise<{ error?: string; evento?: PrometeuEvento }> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.nome !== undefined) patch.nome = input.nome.trim();
  if (input.config !== undefined) patch.config = input.config;
  if (input.dataEvento !== undefined) patch.data_evento = input.dataEvento;
  if (input.enterpriseId !== undefined) patch.enterprise_id = input.enterpriseId;
  if (input.enterpriseCode !== undefined) patch.enterprise_code = input.enterpriseCode;

  const { data, error } = await input.client
    .from("prometeu_eventos")
    .update(patch)
    .eq("id", input.eventoId)
    .select(CAMPOS_EVENTO)
    .single();

  if (error || !data) return { error: error?.message ?? "Nao foi possivel salvar." };
  return { evento: mapEvento(data as EventoRow) };
}

// Libera a PREPARACAO: a partir daqui entram CAD, etiqueta, PIX, fila e os testes do time.
export async function ativarEvento(
  client: AdminClient,
  eventoId: string,
): Promise<{ error?: string; ok: boolean }> {
  const { error } = await client
    .from("prometeu_eventos")
    .update({ status: "ativo", updated_at: new Date().toISOString() })
    .eq("id", eventoId);

  if (error) return { error: error.message, ok: false };
  return { ok: true };
}

// O PostgREST monta o filtro `in` na URL: mandar milhares de UUIDs de uma vez estoura o limite
// do gateway (414) e o delete falha calado. Fatiamos e conferimos cada bloco.
const LOTE_IDS = 200;

async function apagarPorCredenciado(
  client: AdminClient,
  tabela: "prometeu_movimentacoes" | "prometeu_unidades",
  ids: string[],
): Promise<{ error?: string }> {
  for (let i = 0; i < ids.length; i += LOTE_IDS) {
    const bloco = ids.slice(i, i + LOTE_IDS);
    const { error } = await client.from(tabela).delete().in("credenciado_id", bloco);
    if (error) {
      return { error: `Falha ao limpar ${tabela}: ${error.message}` };
    }
  }
  return {};
}

// Busca TODOS os ids do evento, paginando — sem teto silencioso.
async function idsDoEvento(
  client: AdminClient,
  eventoId: string,
): Promise<{ error?: string; ids: string[] }> {
  const ids: string[] = [];
  const pagina = 1000;

  for (let inicio = 0; ; inicio += pagina) {
    const { data, error } = await client
      .from("prometeu_credenciados")
      .select("id")
      .eq("evento_id", eventoId)
      .order("created_at", { ascending: true })
      .range(inicio, inicio + pagina - 1);

    if (error) return { error: error.message, ids: [] };

    const bloco = (data as { id: string }[] | null) ?? [];
    ids.push(...bloco.map((r) => r.id));
    if (bloco.length < pagina) break;
  }

  return { ids };
}

// ⚠️ DESTRUTIVO. O "Iniciar evento real": zera tudo que veio dos testes e comeca o dia limpo.
//
// SOBREVIVE (o que foi construido nas semanas anteriores):
//   credenciados (quem esta habilitado) · pago_em + ordem_fila (A FILA) · etiquetas impressas
// ZERA (so existiu no ensaio):
//   chamadas · movimentacoes · unidades reservadas · mesas ocupadas · etapa · check-in
//
// 🔒 SO RODA ANTES DO EVENTO COMECAR. Depois que o credenciamento abriu (status em_andamento)
// esta funcao NAO reseta mais, em nenhuma hipotese e por ninguem — nao existe "forcar".
// Regra do Lucas (19/jul): zerar no meio do evento apagaria a fila fisica de centenas de
// pessoas ja bipadas, sem reconstrucao possivel. Para fechar o dia existe `encerrarDia`.
export async function iniciarEventoReal(input: {
  client: AdminClient;
  eventoId: string;
}): Promise<{ error?: string; ok: boolean; resetados?: number }> {
  const evento = await getEvento(input.client, input.eventoId);
  if (!evento) return { error: "Evento nao encontrado.", ok: false };

  if (evento.status === "em_andamento" || evento.iniciadoEm) {
    return {
      error:
        "O evento ja esta em andamento: o reset esta bloqueado em definitivo. Zerar agora apagaria a fila de quem ja foi credenciado. Para fechar o dia, use Encerrar o dia.",
      ok: false,
    };
  }

  if (evento.status === "encerrado") {
    return { error: "Evento encerrado.", ok: false };
  }

  const { error: erroIds, ids } = await idsDoEvento(input.client, input.eventoId);
  if (erroIds) return { error: erroIds, ok: false };

  // Historico do ensaio: nao interessa pro dia real.
  const { error: erroChamadas } = await input.client
    .from("prometeu_chamadas")
    .delete()
    .eq("evento_id", input.eventoId);
  if (erroChamadas) {
    return { error: `Falha ao limpar chamadas: ${erroChamadas.message}`, ok: false };
  }

  if (ids.length > 0) {
    const erroMov = await apagarPorCredenciado(input.client, "prometeu_movimentacoes", ids);
    if (erroMov.error) return { error: erroMov.error, ok: false };

    // Quadra/lote sao reserva feita no salao: no ensaio sao reservas falsas (Lucas 19/jul).
    const erroUni = await apagarPorCredenciado(input.client, "prometeu_unidades", ids);
    if (erroUni.error) return { error: erroUni.error, ok: false };
  }

  const { error: erroMesas } = await input.client
    .from("prometeu_mesas")
    .update({ credenciado_id: null, estado: "livre", updated_at: new Date().toISOString() })
    .eq("evento_id", input.eventoId);
  if (erroMesas) {
    return { error: `Falha ao liberar mesas: ${erroMesas.message}`, ok: false };
  }

  // Todo mundo volta a "habilitado, ainda nao chegou". A fila (ordem_fila) fica intacta.
  const { error: erroCred } = await input.client
    .from("prometeu_credenciados")
    .update({
      credenciado_na_janela: null,
      entrou_em: null,
      etapa: "recepcao",
      etapa_desde: new Date().toISOString(),
    })
    .eq("evento_id", input.eventoId);
  if (erroCred) {
    return { error: `Falha ao resetar credenciados: ${erroCred.message}`, ok: false };
  }

  // A trava so e gravada DEPOIS que tudo deu certo: se algo falhou acima, da pra rodar de novo.
  const { error: erroEvento } = await input.client
    .from("prometeu_eventos")
    .update({ iniciado_em: new Date().toISOString(), status: "em_andamento" })
    .eq("id", input.eventoId);
  if (erroEvento) {
    return { error: `Falha ao iniciar o evento: ${erroEvento.message}`, ok: false };
  }

  return { ok: true, resetados: ids.length };
}

// ENCERRAR O DIA (fim de cada dia do evento — normalmente sao 2).
//
// Quem CONCLUIU o fluxo fica: e o dado de performance do time.
// Quem ficou no meio do caminho (fila solta, negociacao parada) sai da operacao.
//
// "Sair" aqui NAO e delete: e arquivamento (`encerrado_em`). Quantas pessoas nao fecharam,
// e em que etapa pararam, e justamente um numero de performance — apagar destruiria a
// resposta para "como foi o dia". Some das telas de operacao, permanece no historico.
export async function encerrarDia(input: {
  client: AdminClient;
  encerrar?: boolean;
  eventoId: string;
  por?: string | null;
}): Promise<{
  arquivados?: number;
  concluidos?: number;
  error?: string;
  ok: boolean;
}> {
  const evento = await getEvento(input.client, input.eventoId);
  if (!evento) return { error: "Evento nao encontrado.", ok: false };

  if (evento.status !== "em_andamento") {
    return { error: "So da pra encerrar o dia de um evento em andamento.", ok: false };
  }

  const agora = new Date().toISOString();

  const { count: concluidos } = await input.client
    .from("prometeu_credenciados")
    .select("id", { count: "exact", head: true })
    .eq("evento_id", input.eventoId)
    .eq("etapa", "concluido")
    .is("encerrado_em", null);

  // Todo mundo que NAO concluiu e ainda esta ativo sai da operacao do dia.
  const { count: arquivados, error } = await input.client
    .from("prometeu_credenciados")
    .update(
      { encerrado_em: agora, encerrado_motivo: "Nao finalizou o fluxo no dia" },
      { count: "exact" },
    )
    .eq("evento_id", input.eventoId)
    .neq("etapa", "concluido")
    .is("encerrado_em", null);

  if (error) return { error: `Falha ao encerrar o dia: ${error.message}`, ok: false };

  // Mesas voltam a ficar livres pro dia seguinte.
  await input.client
    .from("prometeu_mesas")
    .update({ credenciado_id: null, estado: "livre", updated_at: agora })
    .eq("evento_id", input.eventoId);

  // O evento so vai pra "encerrado" no ULTIMO dia; nos dias intermediarios ele continua
  // em andamento, esperando a proxima leva.
  if (input.encerrar) {
    await input.client
      .from("prometeu_eventos")
      .update({ status: "encerrado", updated_at: agora })
      .eq("id", input.eventoId);
  }

  return {
    arquivados: arquivados ?? 0,
    concluidos: concluidos ?? 0,
    ok: true,
  };
}

// ------------------------------------------------------------------ janelas

export async function listJanelas(
  client: AdminClient,
  eventoId: string,
): Promise<PrometeuJanela[]> {
  const { data, error } = await client
    .from("prometeu_janelas_credenciamento")
    .select("id, data, hora_inicio, hora_fim")
    .eq("evento_id", eventoId)
    .order("data", { ascending: true })
    .limit(60);

  if (error || !data) return [];

  return (
    data as { data: string; hora_fim: string; hora_inicio: string; id: string }[]
  ).map((row) => ({
    data: row.data,
    horaFim: row.hora_fim,
    horaInicio: row.hora_inicio,
    id: row.id,
  }));
}

export async function salvarJanela(input: {
  client: AdminClient;
  data: string;
  eventoId: string;
  horaFim: string;
  horaInicio: string;
}): Promise<{ error?: string; ok: boolean }> {
  if (input.horaFim <= input.horaInicio) {
    return { error: "A hora de fim tem que ser depois da hora de inicio.", ok: false };
  }

  const { error } = await input.client.from("prometeu_janelas_credenciamento").upsert(
    {
      data: input.data,
      evento_id: input.eventoId,
      hora_fim: input.horaFim,
      hora_inicio: input.horaInicio,
    },
    { onConflict: "evento_id,data" },
  );

  if (error) return { error: error.message, ok: false };
  return { ok: true };
}

// Estamos, AGORA, dentro do periodo de credenciamento? E o que decide o regime da fila.
export async function dentroDaJanela(
  client: AdminClient,
  eventoId: string,
  momento = new Date(),
): Promise<boolean> {
  const { data: hoje, hora } = agoraNoEvento(momento);

  const { data, error } = await client
    .from("prometeu_janelas_credenciamento")
    .select("hora_inicio, hora_fim")
    .eq("evento_id", eventoId)
    .eq("data", hoje)
    .maybeSingle();

  if (error || !data) return false;

  const janela = data as { hora_fim: string; hora_inicio: string };
  return hora >= janela.hora_inicio && hora <= janela.hora_fim;
}

// ------------------------------------------------------------- credenciados

// A fila do EVENTO: ordem do PIX, com os ajustes do admin ja embutidos em `ordem_fila`.
// Quem nao pagou (ordem_fila nula) vai pro fim, desempatando por ordem de cadastro.
function ordenarFilaDoEvento(linhas: CredenciadoRow[]): CredenciadoRow[] {
  return [...linhas].sort((a, b) => {
    const ordemA = a.ordem_fila;
    const ordemB = b.ordem_fila;

    if (ordemA !== null && ordemB !== null) {
      if (ordemA !== ordemB) return ordemA - ordemB;
    } else if (ordemA !== null) {
      return -1;
    } else if (ordemB !== null) {
      return 1;
    }

    return a.created_at.localeCompare(b.created_at);
  });
}

export async function listCredenciados(
  client: AdminClient,
  eventoId: string,
  // Arquivados (encerrados no fim de um dia) ficam FORA da operação por padrão. Só a análise
  // de performance pede a lista completa.
  opcoes: { incluirEncerrados?: boolean } = {},
): Promise<PrometeuCredenciado[]> {
  let consulta = client
    .from("prometeu_credenciados")
    .select(CAMPOS_CREDENCIADO)
    .eq("evento_id", eventoId);

  if (!opcoes.incluirEncerrados) {
    consulta = consulta.is("encerrado_em", null);
  }

  const { data, error } = await consulta.limit(5000);

  if (error || !data) return [];

  const linhas = ordenarFilaDoEvento(data as CredenciadoRow[]);
  const unidadesPorCredenciado = await listUnidades(
    client,
    linhas.map((l) => l.id),
  );

  // A posicao 1,2,3 nasce AQUI, da ordenacao — nao existe coluna. Uma fonte de verdade so.
  return linhas.map((row, indice) => ({
    corretor: row.corretor,
    credenciadoNaJanela: row.credenciado_na_janela,
    documento: row.documento,
    entityId: row.entity_id,
    entrouEm: row.entrou_em,
    etapa: row.etapa as PrometeuEtapa,
    etapaDesde: row.etapa_desde,
    etiquetaImpressaEm: row.etiqueta_impressa_em,
    eventoId: row.evento_id,
    id: row.id,
    imobiliaria: row.imobiliaria,
    nome: row.nome,
    ordemFila: row.ordem_fila,
    ordemMotivo: row.ordem_motivo,
    origem: row.origem,
    pagoEm: row.pago_em,
    posicao: indice + 1,
    unidades: unidadesPorCredenciado[row.id] ?? [],
  }));
}

// A fila da RECEPCAO (dia do evento): so quem ja fez check-in, nos dois regimes.
//   1) bipado DENTRO da janela -> ordena pela fila do evento; a fila REORDENA a cada bip,
//      entao quem chega depois pode assumir a frente (foi o que ele comprou no PIX).
//   2) bipado DEPOIS da janela -> ordem de chegada, sempre atras de todo o grupo 1.
export function filaDaRecepcao(
  credenciados: PrometeuCredenciado[],
): PrometeuCredenciado[] {
  const presentes = credenciados.filter((c) => c.entrouEm !== null);

  return presentes.sort((a, b) => {
    const naJanelaA = a.credenciadoNaJanela === true;
    const naJanelaB = b.credenciadoNaJanela === true;

    // Grupo da janela vem inteiro na frente.
    if (naJanelaA !== naJanelaB) return naJanelaA ? -1 : 1;

    // Dentro da janela: vale a fila do evento (posicao ja vem derivada de ordem_fila).
    if (naJanelaA && naJanelaB) {
      const posA = a.posicao ?? Number.MAX_SAFE_INTEGER;
      const posB = b.posicao ?? Number.MAX_SAFE_INTEGER;
      if (posA !== posB) return posA - posB;
    }

    // Fora da janela (ou empate): ordem de chegada.
    return (a.entrouEm ?? "").localeCompare(b.entrouEm ?? "");
  });
}

async function listUnidades(
  client: AdminClient,
  credenciadoIds: string[],
): Promise<Record<string, PrometeuUnidade[]>> {
  if (credenciadoIds.length === 0) return {};

  const { data, error } = await client
    .from("prometeu_unidades")
    .select("id, credenciado_id, codigo, quadra, lote, situacao")
    .in("credenciado_id", credenciadoIds)
    .limit(20000);

  if (error || !data) return {};

  const out: Record<string, PrometeuUnidade[]> = {};
  for (const row of data as UnidadeRow[]) {
    const lista = out[row.credenciado_id] ?? [];
    lista.push({
      codigo: row.codigo,
      id: row.id,
      lote: row.lote,
      quadra: row.quadra,
      situacao: row.situacao,
    });
    out[row.credenciado_id] = lista;
  }
  return out;
}

export async function adicionarCredenciado(input: {
  client: AdminClient;
  corretor?: string | null;
  documento?: string | null;
  entityId?: string | null;
  eventoId: string;
  imobiliaria?: string | null;
  nome: string;
  origem?: string;
  origemRef?: string | null;
  pagoEm?: string | null;
}): Promise<{ credenciadoId?: string; error?: string }> {
  const nome = input.nome.trim();
  if (!nome) return { error: "Informe o nome do credenciado." };

  const { data, error } = await input.client
    .from("prometeu_credenciados")
    .insert({
      corretor: input.corretor ?? null,
      documento: input.documento ?? null,
      entity_id: input.entityId ?? null,
      evento_id: input.eventoId,
      imobiliaria: input.imobiliaria ?? null,
      nome,
      // Quem ja chega pago entra na fila pela hora do pagamento.
      ordem_fila: input.pagoEm ? epochDe(input.pagoEm) : null,
      origem: input.origem ?? "manual",
      origem_ref: input.origemRef ?? null,
      pago_em: input.pagoEm ?? null,
    })
    .select("id")
    .single();

  if (error || !data) {
    // Indice unico (evento, origem, origem_ref): reimportacao da mesma origem.
    if (error?.code === "23505") return { error: "Este credenciado ja esta no evento." };
    return { error: error?.message ?? "Nao foi possivel adicionar." };
  }

  return { credenciadoId: (data as { id: string }).id };
}

function epochDe(iso: string): number {
  return new Date(iso).getTime() / 1000;
}

// PIX confirmado. A chave de ordenacao vira a hora do pagamento: a fila se ordena sozinha,
// sem tocar em mais ninguem.
export async function registrarPagamento(input: {
  client: AdminClient;
  credenciadoId: string;
  pagoEm?: string;
}): Promise<{ error?: string; ok: boolean }> {
  const quando = input.pagoEm ?? new Date().toISOString();

  const { error } = await input.client
    .from("prometeu_credenciados")
    .update({ ordem_fila: epochDe(quando), pago_em: quando })
    .eq("id", input.credenciadoId);

  if (error) return { error: error.message, ok: false };
  return { ok: true };
}

// O admin fura a fila: poe alguem entre `antes` e `depois` (ou no topo, se antes for nulo).
// So o arrastado muda de chave — ninguem mais e recalculado.
// Motivo e OBRIGATORIO: furar fila e decisao sensivel e tem que ficar registrado.
export async function ajustarOrdem(input: {
  client: AdminClient;
  credenciadoId: string;
  motivo: string;
  // Chaves dos vizinhos no destino (ordemFila deles). Nulo = ponta da lista.
  ordemAnterior?: number | null;
  ordemSeguinte?: number | null;
  por?: string | null;
}): Promise<{ error?: string; ok: boolean; ordem?: number }> {
  const motivo = input.motivo.trim();
  if (!motivo) return { error: "Informe o motivo do ajuste na fila.", ok: false };

  const anterior = input.ordemAnterior ?? null;
  const seguinte = input.ordemSeguinte ?? null;

  let nova: number;
  if (anterior === null && seguinte === null) {
    nova = Date.now() / 1000;
  } else if (anterior === null) {
    // Topo da fila: um passo antes do primeiro.
    nova = seguinte! - 1;
  } else if (seguinte === null) {
    // Fim da fila.
    nova = anterior + 1;
  } else {
    // No meio: a media cabe sempre, porque a coluna e numeric.
    nova = (anterior + seguinte) / 2;
  }

  const { error } = await input.client
    .from("prometeu_credenciados")
    .update({
      ordem_ajustada_em: new Date().toISOString(),
      ordem_ajustada_por: input.por ?? null,
      ordem_fila: nova,
      ordem_motivo: motivo,
    })
    .eq("id", input.credenciadoId);

  if (error) return { error: error.message, ok: false };
  return { ok: true, ordem: nova };
}

// CHECK-IN (o bip do QR na recepcao). Carimba a chegada e — o ponto importante — grava se
// estava dentro da janela NAQUELE INSTANTE. Editar a janela depois nao reescreve o passado.
export async function fazerCheckIn(input: {
  client: AdminClient;
  credenciadoId: string;
  eventoId: string;
}): Promise<{ error?: string; naJanela?: boolean; ok: boolean }> {
  const { data: atual } = await input.client
    .from("prometeu_credenciados")
    .select("entrou_em")
    .eq("id", input.credenciadoId)
    .maybeSingle();

  if ((atual as { entrou_em: string | null } | null)?.entrou_em) {
    return { error: "Este credenciado ja fez check-in.", ok: false };
  }

  const naJanela = await dentroDaJanela(input.client, input.eventoId);
  const agora = new Date().toISOString();

  const { error } = await input.client
    .from("prometeu_credenciados")
    .update({
      credenciado_na_janela: naJanela,
      entrou_em: agora,
      etapa: "recepcao",
      etapa_desde: agora,
    })
    .eq("id", input.credenciadoId);

  if (error) return { error: error.message, ok: false };

  await input.client.from("prometeu_movimentacoes").insert({
    credenciado_id: input.credenciadoId,
    de_etapa: null,
    motivo: naJanela ? "Check-in dentro da janela" : "Check-in fora da janela",
    para_etapa: "recepcao",
  });

  return { naJanela, ok: true };
}

// ---------------------------------------------------------------- movimento

// Troca a etapa e registra no historico. `etapa_desde` reinicia: e o cronometro do estagio.
export async function moverEtapa(input: {
  client: AdminClient;
  credenciadoId: string;
  motivo?: string | null;
  para: PrometeuEtapa;
  por?: string | null;
}): Promise<{ error?: string; ok: boolean }> {
  const { data: atual } = await input.client
    .from("prometeu_credenciados")
    .select("etapa")
    .eq("id", input.credenciadoId)
    .maybeSingle();

  const deEtapa = (atual as { etapa: string } | null)?.etapa ?? null;
  if (deEtapa === input.para) return { ok: true };

  const agora = new Date().toISOString();
  const { error } = await input.client
    .from("prometeu_credenciados")
    .update({ etapa: input.para, etapa_desde: agora, updated_at: agora })
    .eq("id", input.credenciadoId);

  if (error) return { error: error.message, ok: false };

  await input.client.from("prometeu_movimentacoes").insert({
    credenciado_id: input.credenciadoId,
    de_etapa: deEtapa,
    motivo: input.motivo ?? null,
    para_etapa: input.para,
    por: input.por ?? null,
  });

  return { ok: true };
}

export async function marcarEtiquetaImpressa(
  client: AdminClient,
  credenciadoId: string,
): Promise<void> {
  await client
    .from("prometeu_credenciados")
    .update({ etiqueta_impressa_em: new Date().toISOString() })
    .eq("id", credenciadoId);
}

// -------------------------------------------------------------------- mesas

export async function listMesas(
  client: AdminClient,
  eventoId: string,
): Promise<PrometeuMesa[]> {
  const { data, error } = await client
    .from("prometeu_mesas")
    .select("id, zona, numero, estado, atendente_user_id, credenciado_id")
    .eq("evento_id", eventoId)
    .order("zona", { ascending: true })
    .order("numero", { ascending: true })
    .limit(500);

  if (error || !data) return [];

  return (
    data as {
      atendente_user_id: string | null;
      credenciado_id: string | null;
      estado: string;
      id: string;
      numero: string;
      zona: string;
    }[]
  ).map((row) => ({
    atendenteUserId: row.atendente_user_id,
    credenciadoId: row.credenciado_id,
    estado: (row.estado as PrometeuMesa["estado"]) ?? "livre",
    id: row.id,
    numero: row.numero,
    zona: row.zona,
  }));
}

// Cria as mesas numeradas de uma zona (setup do evento). Idempotente pelo indice unico.
export async function criarMesas(input: {
  client: AdminClient;
  eventoId: string;
  quantidade: number;
  zona: string;
}): Promise<{ criadas: number }> {
  const total = Math.max(1, Math.min(99, Math.trunc(input.quantidade)));
  const linhas = Array.from({ length: total }, (_, i) => ({
    evento_id: input.eventoId,
    numero: String(i + 1).padStart(2, "0"),
    zona: input.zona,
  }));

  const { error } = await input.client
    .from("prometeu_mesas")
    .upsert(linhas, { ignoreDuplicates: true, onConflict: "evento_id,zona,numero" });

  return { criadas: error ? 0 : linhas.length };
}

// Chama o credenciado pra uma mesa: registra a chamada (telao/locutor leem daqui) e ocupa.
export async function chamarCredenciado(input: {
  chamadoPor?: string | null;
  client: AdminClient;
  credenciadoId: string;
  eventoId: string;
  mesaId: string;
}): Promise<{ error?: string; ok: boolean }> {
  const { data: mesa } = await input.client
    .from("prometeu_mesas")
    .select("zona")
    .eq("id", input.mesaId)
    .maybeSingle();

  const { error } = await input.client.from("prometeu_chamadas").insert({
    chamado_por: input.chamadoPor ?? null,
    credenciado_id: input.credenciadoId,
    evento_id: input.eventoId,
    mesa_id: input.mesaId,
    zona: (mesa as { zona: string } | null)?.zona ?? null,
  });

  if (error) return { error: error.message, ok: false };

  await input.client
    .from("prometeu_mesas")
    .update({
      credenciado_id: input.credenciadoId,
      estado: "ocupada",
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.mesaId);

  return { ok: true };
}
