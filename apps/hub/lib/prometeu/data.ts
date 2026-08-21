// Prometeu: acesso a dados do dia do lancamento (server-side, service role).
//
// Reusa o admin client do Apolo — e o mesmo projeto Supabase, nao vale abrir outro.
// Escrita SO por aqui (as rotas chamam estas funcoes); RLS deixa o hub autenticado apenas ler.
import { imobiliariaEntityIdEmLote } from "@/lib/apolo/imobiliaria-do-cliente";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { lerPa } from "@/lib/prometeu/pa";

import {
  PROMETEU_ETAPAS,
  type PrometeuAtividade,
  type PrometeuChamada,
  type PrometeuCredenciado,
  type PrometeuEtapa,
  type PrometeuIndicadorDaMesa,
  type PrometeuPassoJornada,
  type PrometeuEvento,
  type PrometeuEventoConfig,
  type PrometeuEventoStatus,
  type PrometeuJanela,
  type PrometeuMesa,
  type PrometeuResumoDaMesa,
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

// O resultado da rotina de abertura do lancamento. Declarado por `Awaited<ReturnType<...>>` para
// nao criar import ESTATICO de `lib/apolo` aqui: o modulo do Apolo ja importa deste arquivo, e o
// ciclo quebraria o build.
type FilaDoLancamento = Awaited<
  ReturnType<typeof import("@/lib/apolo/popular-fila-lancamento").popularFilaDoLancamento>
>;

type EventoRow = {
  arquivado_em: string | null;
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
  // Quando a CAD chegou (data da task no Asana), lida da esteira do Apolo na hora de montar a
  // fila. Não é coluna desta tabela: `created_at` aqui é a hora em que a pessoa entrou na fila,
  // que num disparo em massa é a hora do disparo — a mesma para centenas de gente.
  chegou_em?: string | null;
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
  metadata: unknown;
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
  "id, nome, enterprise_id, enterprise_code, data_evento, status, config, iniciado_em, arquivado_em";
const CAMPOS_CREDENCIADO =
  "id, evento_id, entity_id, nome, documento, imobiliaria, corretor, etapa, entrou_em, etapa_desde, pago_em, origem, etiqueta_impressa_em, ordem_fila, ordem_motivo, credenciado_na_janela, created_at, metadata";

function mapEvento(row: EventoRow): PrometeuEvento {
  return {
    arquivadoEm: row.arquivado_em ?? null,
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

// ⚠️ ARQUIVADO NAO APARECE, por padrao.
//
// Esta lista alimenta os QUATRO seletores de evento do modulo (Setup, Central, Fila, Etiqueta) e
// o `eventoDoDia` das telas de posto. Sem o filtro, um lancamento que ja acabou fica no dropdown
// para sempre — foi exatamente assim que o Vale do Ouro continuou aparecendo em tudo depois de
// encerrado em 01/08.
//
// `incluirArquivados` existe para a consulta ao historico (a analise do lancamento passado), do
// mesmo jeito que `listCredenciados` tem `incluirEncerrados` para pessoa.
export async function listEventos(
  client: AdminClient,
  opts: { incluirArquivados?: boolean } = {},
): Promise<PrometeuEvento[]> {
  let query = client.from("prometeu_eventos").select(CAMPOS_EVENTO);

  if (!opts.incluirArquivados) query = query.is("arquivado_em", null);

  const { data, error } = await query.order("created_at", { ascending: false }).limit(200);

  if (error || !data) return [];
  return (data as EventoRow[]).map(mapEvento);
}

// ARQUIVA (ou desarquiva) um lancamento.
//
// ⚠️ NAO APAGA NADA E NAO MEXE NO `status`: o evento continua "encerrado", que e a verdade sobre
// como ele terminou. O que muda e so a visibilidade.
//
// Arquivar tambem DESATIVA OS OPERADORES daquele evento. Eles sao contas proprias, com senha, e
// nao usuarios do hub: sem isto, as credenciais de um lancamento acabado seguem valendo (medido
// em 21/08: 13 logins do Vale do Ouro ainda ativos, ultimo acesso em 02/08).
export async function arquivarEvento(input: {
  arquivar: boolean;
  client: AdminClient;
  eventoId: string;
  por?: null | string;
}): Promise<{ error?: string; ok: boolean }> {
  const agora = new Date().toISOString();

  const { error } = await input.client
    .from("prometeu_eventos")
    .update({
      arquivado_em: input.arquivar ? agora : null,
      arquivado_por: input.arquivar ? (input.por ?? null) : null,
      updated_at: agora,
    })
    .eq("id", input.eventoId);

  if (error) return { error: error.message, ok: false };

  // Best-effort: o evento ja esta arquivado, e uma falha aqui nao pode desfazer isso.
  try {
    await input.client
      .from("prometeu_operadores")
      .update({ ativo: !input.arquivar })
      .eq("evento_id", input.eventoId);
  } catch {
    /* segue */
  }

  return { ok: true };
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
}): Promise<{ error?: string; evento?: PrometeuEvento; fila?: FilaDoLancamento }> {
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
  const evento = mapEvento(data as EventoRow);

  // JÁ NA CRIAÇÃO, e não só na ativação (Lucas, 21/08: *"criou novo lançamento, temos que entender
  // se já tem cad em credenciado, se tiver já começar organizar a fila e encaminhar para
  // etiquetas"*).
  //
  // Faz sentido no rascunho: é justamente aí que o operador confere as etiquetas antes do dia. E
  // rodar nos dois momentos não duplica ninguém — a rotina é idempotente, e quem já está na fila
  // volta como "já estava".
  //
  // ⚠️ AS CADs QUE FOREM CREDENCIADAS DEPOIS não dependem disto: a esteira chama
  // `garantirNaFilaDoLancamento` a cada mudança de etapa. Mas ela só enxerga lançamento ATIVO
  // (`eventoOperavel`), então quem for credenciado enquanto o lançamento está em rascunho entra
  // pela rotina da ativação. Nos dois caminhos, ninguém se perde.
  let fila: FilaDoLancamento | undefined;
  try {
    const { popularFilaDoLancamento } = await import("@/lib/apolo/popular-fila-lancamento");
    fila = await popularFilaDoLancamento(input.client as never, evento.id);
  } catch {
    fila = undefined;
  }

  return { evento, fila };
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
  if (input.config !== undefined) {
    // FASE do check-in: nunca vem do formulario (o Setup nao sabe dela). Ou preservamos a atual,
    // ou incrementamos quando o liga/desliga vira. Ler o config gravado e comparar aqui e o que
    // garante que salvar o Setup por outro motivo (mesas, metas) nao mexe na fase — so a virada
    // real do regime cria fase nova, e e' isso que congela a fila no dia (ver `filaDaRecepcao`).
    const { data: eventoAtual } = await input.client
      .from("prometeu_eventos")
      .select("config")
      .eq("id", input.eventoId)
      .maybeSingle<{ config: PrometeuEventoConfig | null }>();
    const configAntes = eventoAtual?.config ?? {};
    const faseAtual = configAntes.checkinFase ?? 1;
    const ligadoAntes = configAntes.checkinHabilitado ?? true;
    const ligadoDepois = input.config.checkinHabilitado ?? true;
    patch.config = {
      ...input.config,
      checkinFase: ligadoAntes === ligadoDepois ? faseAtual : faseAtual + 1,
    };
  }
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
): Promise<{ error?: string; fila?: FilaDoLancamento; ok: boolean }> {
  // ⚠️ UM LANCAMENTO OPERAVEL POR VEZ. `eventoOperavel` desempata entre dois "ativo" pegando
  // `linhas[0]` de uma ordenacao com empate — ou seja, a escolha seria arbitraria e poderia
  // alternar entre requisicoes. A partir dai a fila do Apolo passaria a cair num evento
  // indefinido. Recusar aqui e a diferenca entre um erro na tela e um dia de evento confuso.
  const emOperacao = await eventoOperavel(client);
  if (emOperacao && emOperacao.id !== eventoId) {
    return {
      error:
        "Ja existe um lancamento em operacao. Encerre o dia dele antes de ativar este.",
      ok: false,
    };
  }

  const { error } = await client
    .from("prometeu_eventos")
    .update({ status: "ativo", updated_at: new Date().toISOString() })
    .eq("id", eventoId);

  if (error) return { error: error.message, ok: false };

  // A ROTINA DE ABRIR O LANCAMENTO (Lucas, 21/08: *"isso e padrao. Toda vez que eu habilitar um
  // lancamento, o sistema ja tem que buscar as cads do credenciado, entender se tem pix, fazer
  // toda essa rotina"*).
  //
  // Traz para a fila quem ja esta CREDENCIADO naquele empreendimento e resolve a ORDEM pelo
  // regime do empreendimento: com pre-venda, a ordem do pagamento; sem pre-venda, a chegada da
  // CAD. Sem isto, um lancamento novo nasce com a fila VAZIA — quem ja estava credenciado nunca
  // mais muda de etapa, que e o unico gatilho que alimentava a fila.
  //
  // Idempotente e best-effort: quem ja esta na fila nao duplica, e uma falha aqui NAO desfaz a
  // ativacao. Lancamento ativo com fila vazia se resolve com um clique; lancamento que nao ativa,
  // no dia do evento, nao.
  let fila: FilaDoLancamento | undefined;
  try {
    const { popularFilaDoLancamento } = await import("@/lib/apolo/popular-fila-lancamento");
    fila = await popularFilaDoLancamento(client as never, eventoId);
  } catch {
    fila = undefined;
  }

  return { fila, ok: true };
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

// Tira do metadata as marcas de OPERACAO do ensaio (no-show, PA e o regime do check-in) de todos
// os credenciados do evento, preservando o resto do metadata. Merge por linha (a licao da 0057): sobrescrever o
// metadata inteiro apagaria o que a esteira gravou ali. So toca as linhas que tem alguma marca.
async function limparMarcasDeEnsaio(
  client: AdminClient,
  eventoId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from("prometeu_credenciados")
    .select("id, metadata")
    .eq("evento_id", eventoId);
  if (error) return `Falha ao ler o metadata para o reset: ${error.message}`;

  for (const linha of (data ?? []) as { id: string; metadata: unknown }[]) {
    const meta =
      linha.metadata && typeof linha.metadata === "object" && !Array.isArray(linha.metadata)
        ? { ...(linha.metadata as Record<string, unknown>) }
        : {};
    if (!("noShow" in meta) && !("pa" in meta) && !("recepcao" in meta)) continue;

    delete meta.noShow;
    delete meta.pa;
    // `recepcao` (fase + regime congelados no check-in) e' marca de operacao do ensaio: some no
    // reset. Mesmo que sobrasse, o proximo check-in a reescreve — mas limpa evita confusao.
    delete meta.recepcao;
    const { error: erroUpd } = await client
      .from("prometeu_credenciados")
      .update({ metadata: meta, updated_at: new Date().toISOString() })
      .eq("id", linha.id);
    if (erroUpd) return `Falha ao limpar o metadata: ${erroUpd.message}`;
  }

  return null;
}

// ⚠️ DESTRUTIVO. O "Iniciar evento real": zera tudo que veio dos testes e comeca o dia limpo.
//
// SOBREVIVE (o que foi construido nas semanas anteriores):
//   credenciados (quem esta habilitado) · pago_em + ordem_fila (A FILA) · etiquetas impressas
// ZERA (so existiu no ensaio):
//   chamadas · movimentacoes · unidades reservadas · mesas ocupadas · etapa · check-in ·
//   no-show e PA (as duas marcas de operacao que vivem no metadata) ·
//   exclusoes de teste (encerrado_em volta a null — reintegra quem levou "No-show definitivo")
//
// 🔒 SO RODA ANTES DO EVENTO COMECAR. Depois que o credenciamento abriu (status em_andamento)
// esta funcao NAO reseta mais, em nenhuma hipotese e por ninguem — nao existe "forcar".
// Regra do Lucas (19/jul): zerar no meio do evento apagaria a fila fisica de centenas de
// pessoas que ja fizeram check-in, sem reconstrucao possivel. Para fechar o dia existe `encerrarDia`.
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
  // REINTEGRA os EXCLUIDOS do ensaio (encerrado_em = null): um "No-show definitivo" testado antes
  // do dia carimba encerrado_em e some o credenciado das telas. Sem limpar aqui, ele sumiria do
  // EVENTO REAL (foi o que aconteceu com o Emanuel, que tinha pago o PIX). O reset roda 1x na
  // virada ensaio->real e depois trava, entao aqui todo encerrado_em so pode ser lixo de teste.
  const { error: erroCred } = await input.client
    .from("prometeu_credenciados")
    .update({
      credenciado_na_janela: null,
      encerrado_em: null,
      encerrado_motivo: null,
      entrou_em: null,
      etapa: "recepcao",
      etapa_desde: new Date().toISOString(),
    })
    .eq("evento_id", input.eventoId);
  if (erroCred) {
    return { error: `Falha ao resetar credenciados: ${erroCred.message}`, ok: false };
  }

  // LIMPA AS MARCAS DE ENSAIO NO METADATA (no-show e PA). O update acima nao alcanca o metadata,
  // e sem isto um "nao veio" ou uma PA de teste sobreviviam ao reset: a etapa voltava para a
  // recepcao, mas a pessoa seguia no "Aguardando retorno" e com "PA ok". Merge por linha (so nas
  // que tem alguma das marcas) para nao apagar o resto do metadata — a licao da 0057.
  const erroMeta = await limparMarcasDeEnsaio(input.client, input.eventoId);
  if (erroMeta) return { error: erroMeta, ok: false };

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

    // ⚠️ AS CREDENCIAIS DA EQUIPE MORREM COM O LANCAMENTO.
    //
    // Regra do Lucas (21/08/2026): *"esses logins e senhas tambem sao arquivados com a
    // finalizacao do lancamento"*. Os operadores do Prometeu sao contas PROPRIAS, com senha, e
    // nao usuarios do hub — em boa parte gente de freela contratada para o dia. Sem isto, o login
    // continua valendo depois do evento acabar: medido em 21/08, os 13 operadores do Vale do Ouro
    // (encerrado em 01/08) seguiam com `ativo = true`.
    //
    // No ULTIMO dia, e nao nos intermediarios, exatamente como o status: a equipe volta amanha se
    // o lancamento tem mais uma leva.
    //
    // Best-effort: o dia ja foi encerrado, e uma falha aqui nao pode desfazer isso. O arquivamento
    // do lancamento faz a mesma coisa, entao ha um segundo caminho para o mesmo fim.
    try {
      await input.client
        .from("prometeu_operadores")
        .update({ ativo: false })
        .eq("evento_id", input.eventoId);
    } catch {
      /* segue */
    }
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

// Estamos, AGORA, dentro do periodo de check-in? E o que decide o regime da fila.
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

    // Quem ainda não pagou desempata pela CHEGADA DA CAD, não pela hora em que entrou na fila:
    // no disparo em massa todo mundo entra no mesmo minuto, e aí a ordem viraria a ordem do laço.
    return (a.chegou_em ?? a.created_at).localeCompare(b.chegou_em ?? b.created_at);
  });
}

// Data de chegada da CAD (a criação da task no Asana), que mora na esteira do Apolo.
async function chegadaDasFichas(
  client: AdminClient,
  entityIds: string[],
): Promise<Record<string, string | null>> {
  const ids = [...new Set(entityIds.filter(Boolean))];
  const mapa: Record<string, string | null> = {};
  if (ids.length === 0) return mapa;

  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await client
      .from("apolo_esteira")
      .select("entity_id, chegou_em")
      .in("entity_id", ids.slice(i, i + 300))
      .order("chegou_em", { ascending: true, nullsFirst: false });

    // ⚠️ ISTO DESEMPATA A ORDEM DA FILA DO LANÇAMENTO. Uma linha por CAD desde a 0080: quem tem
    // CAD em dois empreendimentos volta duas vezes aqui. A escolha é a chegada MAIS ANTIGA (o
    // `order` acima + o `if` abaixo), porque a fila é ordem de chegada e a pessoa chegou uma vez
    // só — usar a data da CAD mais nova a jogaria para trás na fila sem motivo. Antes disso,
    // quem vencia era a última linha que o banco devolvesse: a posição na fila era sorteada.
    for (const linha of (data ?? []) as { chegou_em: string | null; entity_id: string }[]) {
      if (mapa[linha.entity_id] == null) mapa[linha.entity_id] = linha.chegou_em;
    }
  }
  return mapa;
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

  // A chegada da CAD entra ANTES de ordenar: ela é o critério de desempate de quem não pagou.
  const cru = data as CredenciadoRow[];
  const chegada = await chegadaDasFichas(
    client,
    cru.map((l) => l.entity_id ?? ""),
  );
  const linhas = ordenarFilaDoEvento(
    cru.map((l) => ({ ...l, chegou_em: l.entity_id ? (chegada[l.entity_id] ?? null) : null })),
  );

  const unidadesPorCredenciado = await listUnidades(
    client,
    linhas.map((l) => l.id),
  );

  // IMOBILIÁRIA POR ENTIDADE (não por texto): as etiquetas agrupam pela entidade cadastrada no
  // Apolo, não pela grafia livre da esteira (que tem variações: "RR Soluções" vs "RR Soluções
  // Imobiliárias LTDA"). Resolve pelo VÍNCULO do cliente (fonte única) e, como reforço, pelo de-para
  // de texto (apolo_imobiliaria_match) de quem só tem o texto. Exibe o nome canônico da entidade.
  const entityIds = linhas
    .map((l) => l.entity_id)
    .filter((id): id is string => Boolean(id));
  const imobPorVinculo = await imobiliariaEntityIdEmLote(client, entityIds);
  const imobPorTexto = new Map<string, string>();
  {
    const { data: matches } = await client
      .from("apolo_imobiliaria_match")
      .select("nome_normalizado, entity_id")
      .not("entity_id", "is", null);
    for (const m of (matches ?? []) as { entity_id: string; nome_normalizado: string }[]) {
      imobPorTexto.set(m.nome_normalizado, m.entity_id);
    }
  }
  const imobIds = [...new Set([...imobPorVinculo.values(), ...imobPorTexto.values()])];
  const nomeImob = new Map<string, string>();
  for (let i = 0; i < imobIds.length; i += 200) {
    const { data } = await client
      .from("apolo_entities")
      .select("id, display_name, trade_name, legal_name")
      .in("id", imobIds.slice(i, i + 200));
    for (const e of (data ?? []) as Array<{
      display_name: string | null;
      id: string;
      legal_name: string | null;
      trade_name: string | null;
    }>) {
      nomeImob.set(e.id, (e.display_name || e.trade_name || e.legal_name || "").trim());
    }
  }
  const normalizarImob = (v: string | null): string =>
    String(v ?? "")
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();

  // A posicao 1,2,3 nasce AQUI, da ordenacao — nao existe coluna. Uma fonte de verdade so.
  return linhas.map((row, indice) => {
    const imobEnt =
      (row.entity_id ? imobPorVinculo.get(row.entity_id) : undefined) ??
      imobPorTexto.get(normalizarImob(row.imobiliaria)) ??
      null;
    const imobNome = imobEnt ? nomeImob.get(imobEnt) || row.imobiliaria : row.imobiliaria;
    return {
      chegouEm: row.chegou_em ?? null,
      corretor: row.corretor,
      credenciadoNaJanela: row.credenciado_na_janela,
      documento: row.documento,
      entityId: row.entity_id,
      entrouEm: row.entrou_em,
      etapa: row.etapa as PrometeuEtapa,
      etapaDesde: row.etapa_desde,
      etiquetaImpressaEm: row.etiqueta_impressa_em,
      noShow: estaEmNoShow(row.metadata),
      noShowZona: lerNoShowZona(row.metadata),
      paPath: lerPa(row.metadata)?.path ?? null,
      eventoId: row.evento_id,
      id: row.id,
      imobiliaria: imobNome,
      imobiliariaEntityId: imobEnt,
      nome: row.nome,
      ordemFila: row.ordem_fila,
      ordemMotivo: row.ordem_motivo,
      origem: row.origem,
      pagoEm: row.pago_em,
      posicao: indice + 1,
      recepcaoFase: lerRecepcao(row.metadata)?.fase ?? null,
      recepcaoLigado: lerRecepcao(row.metadata)?.ligado ?? null,
      unidades: unidadesPorCredenciado[row.id] ?? [],
    };
  });
}

// A fila da RECEPCAO (dia do evento): so quem ja fez check-in. O REGIME agora e um liga/desliga do
// evento (config.checkinHabilitado), nao mais a janela de data/hora:
//   - check-in LIGADO  -> quem pagou o PIX (posicao da fila do evento) vem na frente, na ordem do
//     PIX; a fila REORDENA a cada check-in (quem pagou antes assume a frente mesmo chegando depois).
//     Quem nao pagou vai atras, por ordem de chegada.
//   - check-in DESLIGADO -> o PIX perde a prioridade: TODOS por ordem de chegada (hora do check-in).
// A FILA DO SALÃO = quem já entrou no salão e ainda não foi para a secretaria (regra do Lucas,
// 27/07: "a secretária tem que ver a fila do salão").
//
// Cada posto chama do ESTOQUE DO POSTO ANTERIOR: o salão chama de quem está na recepção, a
// secretaria chama de quem está no salão. Mostrar a fila geral do evento em todos os postos era
// o erro do print — o salão via 391 pessoas, sendo que só interessam a ele as que já chegaram.
//
// Ordem por `etapaDesde`: aqui não vale a prioridade do PIX. Ela decidiu quem entrou primeiro no
// salão; dentro do salão, quem chegou antes é atendido antes.
export function filaDoSalao(
  credenciados: PrometeuCredenciado[],
): PrometeuCredenciado[] {
  return credenciados
    .filter((c) => c.etapa === "negociacao" && !c.noShow)
    .sort((a, b) => (a.etapaDesde ?? "").localeCompare(b.etapaDesde ?? ""));
}

// A FILA DA SECRETARIA = quem o organizador da secretaria já bipou na chegada e ainda espera
// ser atendido numa mesa.
//
// Correção do Lucas (27/07): "o organizador da secretaria vê a fila DA SECRETARIA, que está
// sendo formada conforme ele vai fazendo o check-in dos clientes na secretaria". Ou seja, o bip
// dele não é para chamar do salão — é ele MONTANDO a própria fila com quem vai chegando. Quem
// ainda está no salão não é problema dele.
// NO-SHOW: chamou, rechamou, e a pessoa não apareceu.
//
// Sem isso a fila TRAVA (o Lucas viu testando): o chamado fica preso no painel de trânsito para
// sempre, porque só o bip do QR o fecha — e quem não veio não tem QR para bipar. O organizador
// marca no-show, a pessoa sai da tela e vai para uma lista à parte.
//
// NÃO é desistência: se aparecer depois, é só chamar de novo e ela volta ao fluxo normal. Por
// isso a etapa NÃO muda — ela continua onde estava, só deixa de estar "a caminho".
//
// Fica em `metadata.noShow` (jsonb que já existe, sem migration).
export async function marcarNoShow(input: {
  client: AdminClient;
  credenciadoId: string;
  // Posto que marcou o "nao veio" (salao/recepcao/secretaria). A etapa nao muda, entao guardamos a
  // ORIGEM aqui pra cada posto listar so' o seu no-show (senao o do salao vaza pra recepcao).
  zona?: string | null;
}): Promise<{ error?: string; ok: boolean }> {
  const agora = new Date().toISOString();

  // Fecha a chamada em aberto: é ela que segura a pessoa no painel de trânsito.
  const { error: erroChamada } = await input.client
    .from("prometeu_chamadas")
    .update({ atendido_em: agora })
    .eq("credenciado_id", input.credenciadoId)
    .is("atendido_em", null);

  if (erroChamada) return { error: erroChamada.message, ok: false };

  const { data: atual } = await input.client
    .from("prometeu_credenciados")
    .select("metadata")
    .eq("id", input.credenciadoId)
    .maybeSingle<{ metadata: unknown }>();

  const metadataAtual =
    atual?.metadata && typeof atual.metadata === "object" && !Array.isArray(atual.metadata)
      ? (atual.metadata as Record<string, unknown>)
      : {};

  const { error } = await input.client
    .from("prometeu_credenciados")
    .update({
      metadata: { ...metadataAtual, noShow: { em: agora, zona: input.zona ?? null } },
      updated_at: agora,
    })
    .eq("id", input.credenciadoId);

  if (error) return { error: error.message, ok: false };

  return { ok: true };
}

// Tira a marca de no-show. Chamado quando a pessoa REAPARECE e é chamada de novo — o `chamar`
// já faz isso sozinho, para ninguém precisar lembrar de dois passos.
export async function limparNoShow(input: {
  client: AdminClient;
  credenciadoId: string;
}): Promise<void> {
  const { data: atual } = await input.client
    .from("prometeu_credenciados")
    .select("metadata")
    .eq("id", input.credenciadoId)
    .maybeSingle<{ metadata: unknown }>();

  if (
    !atual?.metadata ||
    typeof atual.metadata !== "object" ||
    Array.isArray(atual.metadata) ||
    !("noShow" in (atual.metadata as Record<string, unknown>))
  ) {
    return;
  }

  const semNoShow = { ...(atual.metadata as Record<string, unknown>) };
  delete semNoShow.noShow;

  await input.client
    .from("prometeu_credenciados")
    .update({ metadata: semNoShow, updated_at: new Date().toISOString() })
    .eq("id", input.credenciadoId);
}

export function estaEmNoShow(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return false;
  }

  const noShow = (metadata as Record<string, unknown>).noShow;

  return Boolean(noShow && typeof noShow === "object");
}

// De qual POSTO veio o no-show (metadata.noShow.zona). Nulo quando ausente (no-show antigo, gravado
// antes de guardarmos a origem) — nesse caso o filtro da tela cai no fallback pela etapa.
export function lerNoShowZona(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const noShow = (metadata as Record<string, unknown>).noShow;
  if (!noShow || typeof noShow !== "object" || Array.isArray(noShow)) return null;
  const zona = (noShow as Record<string, unknown>).zona;
  return typeof zona === "string" && zona ? zona : null;
}

// Regime CONGELADO no check-in (metadata.recepcao): a fase vigente e se estava LIGADO. E o que
// trava a posicao na fila da recepcao mesmo que o liga/desliga vire depois (ver `filaDaRecepcao`).
export function lerRecepcao(metadata: unknown): { fase: number; ligado: boolean } | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const r = (metadata as Record<string, unknown>).recepcao;
  if (!r || typeof r !== "object" || Array.isArray(r)) return null;
  const obj = r as Record<string, unknown>;
  if (typeof obj.fase !== "number" || typeof obj.ligado !== "boolean") return null;
  return { fase: obj.fase, ligado: obj.ligado };
}

// Motivo padrão da exclusão. Fica em `encerrado_motivo` para o relatório do dia separar quem
// saiu por no-show de quem foi arquivado em massa no fim do dia ("Nao finalizou o fluxo no dia").
export const MOTIVO_NO_SHOW_DEFINITIVO =
  "No-show: chamado e nao compareceu; retirado da operacao";

// EXCLUIR DA OPERAÇÃO — o "No-show" da aba Aguardando retorno (decisão D2 do Lucas, 27/07: o
// termo no-show fica reservado para TIRAR DE VEZ; "Não veio" continua sendo o recuperável).
//
// POR QUE `encerrado_em` E NÃO OUTRA MARCA:
//   • `etapa = "cancelado"` significa outra coisa no Prometeu (desistiu da COMPRA) e nem
//     resolveria: cancelado continua saindo em `listCredenciados`, ou seja, a pessoa seguiria
//     aparecendo nas telas.
//   • `metadata.excluido` funcionaria, mas exigiria repetir `!c.excluido` em cada fila
//     (secretaria, salão, recepção, no-show da rota) — e toda tela nova nasceria com o buraco.
//   • `encerrado_em` já existe (migration 0055) e JÁ é o filtro padrão de `listCredenciados`:
//     um carimbo só e a pessoa some de todas as telas de operação de uma vez.
// E a semântica é exatamente a mesma do encerramento do dia: NÃO é delete, é arquivamento —
// quantos foram excluídos, e por quê, continua no histórico para medir o dia.
export async function excluirCredenciado(input: {
  client: AdminClient;
  credenciadoId: string;
  motivo?: string | null;
}): Promise<{ error?: string; ok: boolean }> {
  const { data: pessoa } = await input.client
    .from("prometeu_credenciados")
    .select("id, encerrado_em")
    .eq("id", input.credenciadoId)
    .maybeSingle<{ encerrado_em: string | null; id: string }>();

  if (!pessoa) return { error: "Credenciado nao encontrado.", ok: false };

  // Já fora da operação: não recarimba. Reescrever o motivo apagaria o registro de por que a
  // pessoa saiu (ex.: o arquivamento do fim do dia viraria "no-show" num duplo clique).
  if (pessoa.encerrado_em) return { ok: true };

  const agora = new Date().toISOString();

  // O PAINEL DE TRÂNSITO lê `prometeu_chamadas` sem olhar o encerramento: sem fechar a chamada em
  // aberto, o excluído continuaria "a caminho" na tela de quem o chamou, para sempre.
  const { error: erroChamada } = await input.client
    .from("prometeu_chamadas")
    .update({ atendido_em: agora })
    .eq("credenciado_id", input.credenciadoId)
    .is("atendido_em", null);

  if (erroChamada) return { error: erroChamada.message, ok: false };

  // A mesa que estiver reservada para ele volta a livre. Quem vem da aba de retorno já teve a
  // mesa liberada, mas uma mesa presa a alguém que sumiu da lista não teria como ser destravada
  // pela tela depois — e são 18 mesas puxando da mesma fila.
  const { error: erroMesa } = await input.client
    .from("prometeu_mesas")
    .update({ credenciado_id: null, estado: "livre", updated_at: agora })
    .eq("credenciado_id", input.credenciadoId);

  if (erroMesa) return { error: erroMesa.message, ok: false };

  const { error } = await input.client
    .from("prometeu_credenciados")
    .update({
      encerrado_em: agora,
      encerrado_motivo: input.motivo?.trim() || MOTIVO_NO_SHOW_DEFINITIVO,
      updated_at: agora,
    })
    .eq("id", input.credenciadoId);

  if (error) return { error: error.message, ok: false };

  return { ok: true };
}

export function filaDaSecretaria(
  credenciados: PrometeuCredenciado[],
): PrometeuCredenciado[] {
  return credenciados
    .filter((c) => c.etapa === "secretaria" && !c.noShow)
    .sort((a, b) => (a.etapaDesde ?? "").localeCompare(b.etapaDesde ?? ""));
}

export function filaDaRecepcao(
  credenciados: PrometeuCredenciado[],
  checkinHabilitado = true,
): PrometeuCredenciado[] {
  // A FILA DA RECEPÇÃO É SÓ QUEM ESTÁ NA RECEPÇÃO (regra do Lucas, 27/07: "quando o cliente vai
  // para outra fila ele tem que sair da que ele estava, ele tem que andar no circuito").
  //
  // Antes daqui saía todo mundo que tinha feito check-in e não estava concluído/cancelado — ou
  // seja, quem já tinha ido para o salão continuava aparecendo na espera. O organizador chamava
  // alguém que já estava sendo atendido, e a contagem de "esperando" nunca baixava.
  //
  // Agora o critério é a ETAPA: saiu da recepção, saiu da fila. O bip do salão move a etapa, e
  // é isso que faz a pessoa andar no circuito sozinha, sem ninguém remover nada à mão.
  // Quem esta em NO-SHOW sai da fila de espera: ele ja foi chamado e nao veio. Fica na lista
  // propria ate reaparecer — chamar de novo o traz de volta.
  const presentes = credenciados.filter(
    (c) => c.entrouEm !== null && c.etapa === "recepcao" && !c.noShow,
  );

  // ORDEM CONGELADA POR FASE (Lucas, 29/07: "na hora da mudanca o que ja foi registrado nao mexe,
  // somente nos novos"). Cada credenciado guarda, do momento do check-in, a FASE do regime e se o
  // check-in estava LIGADO. A fila ordena por essa chave congelada — NUNCA pelo estado atual do
  // flag —, entao ligar/desligar o check-in nao reordena quem ja entrou:
  //   1) FASE: quem entrou numa fase anterior fica sempre na frente (a fase sobe a cada troca do
  //      liga/desliga). E o que impede a fila de "desmontar" quando o regime vira.
  //   2) Dentro da fase, se o check-in estava LIGADO, quem pagou o PIX vem na frente pela ordem do
  //      PIX; se estava DESLIGADO, o PIX nao conta e vale so a chegada.
  //   3) Empate: hora do check-in fisico.
  // Quem fez check-in antes deste mecanismo (recepcaoFase nula) cai no flag atual e na fase 1.
  //
  // ⚠️ "pagou o PIX" = `ordemFila != null`, NAO `posicao != null`. `posicao` e DERIVADA na leitura
  // (indice+1) e vem preenchida para TODO mundo, pago ou nao — usa-la como proxy de pagamento joga
  // todo nao-pagante pro grupo do PIX e os ordena pela DATA DA CAD (chegou_em, o desempate de
  // `ordenarFilaDoEvento`) em vez da chegada fisica. `ordemFila` e a chave real da fila do evento:
  // nula = sem lugar na fila (nao pagou e o admin nao furou). `posicao` segue como sub-ordem DENTRO
  // do grupo do PIX (e o rank de `ordemFila`, entao respeita a ordem do pagamento).
  const porChegada = (a: PrometeuCredenciado, b: PrometeuCredenciado) =>
    (a.entrouEm ?? "").localeCompare(b.entrouEm ?? "");

  const faseDe = (c: PrometeuCredenciado) => c.recepcaoFase ?? 1;
  const grupoPixDe = (c: PrometeuCredenciado) => {
    const ligado = c.recepcaoLigado ?? checkinHabilitado;
    const temPix = c.ordemFila !== null && c.ordemFila !== undefined;
    return ligado && temPix ? 0 : 1;
  };

  return [...presentes].sort((a, b) => {
    if (faseDe(a) !== faseDe(b)) return faseDe(a) - faseDe(b);

    const grupoA = grupoPixDe(a);
    const grupoB = grupoPixDe(b);
    if (grupoA !== grupoB) return grupoA - grupoB;

    if (grupoA === 0) {
      const posA = a.posicao ?? Number.MAX_SAFE_INTEGER;
      const posB = b.posicao ?? Number.MAX_SAFE_INTEGER;
      if (posA !== posB) return posA - posB;
    }

    return porChegada(a, b);
  });
}

async function listUnidades(
  client: AdminClient,
  credenciadoIds: string[],
): Promise<Record<string, PrometeuUnidade[]>> {
  if (credenciadoIds.length === 0) return {};

  const out: Record<string, PrometeuUnidade[]> = {};
  // Lotes de 200: um `.in` com TODOS os ids (uuids) de um evento grande estoura a URL do PostgREST
  // (400) — a mesma armadilha que já derrubou a Iris (700 ids ≈ 27k chars). Fatiar evita o 400
  // silencioso, que faria as unidades sumirem da fila/etiqueta.
  for (let i = 0; i < credenciadoIds.length; i += 200) {
    const { data, error } = await client
      .from("prometeu_unidades")
      .select("id, credenciado_id, codigo, quadra, lote, situacao")
      .in("credenciado_id", credenciadoIds.slice(i, i + 200));

    if (error || !data) continue;

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

// REGISTRA A UNIDADE QUE O CLIENTE PEGOU no salão e move a ficha para `reserva`.
//
// Por que existe (Lucas, 01/08, com o evento rodando): "temos que registrar os clientes que estão
// reservando unidades, agora não está pegando". A tabela `prometeu_unidades` existia desde a
// migration 0053 e a tela do atendente já mostrava "Nenhuma unidade reservada", mas NINGUÉM
// escrevia nela — não havia onde o operador digitar o lote. Sem isso a aba Reservas ficava vazia
// (ela filtra por etapa `reserva`) e ninguém sabia qual lote cada cliente pegou.
//
// A etapa vai junto de propósito: registrar a unidade É a reserva. Deixar as duas coisas em
// botões separados criaria o estado meia-boca "tem unidade mas não está em reserva", que é
// exatamente o tipo de divergência que ninguém percebe no meio de um evento.
//
// O CÓDIGO DA UNIDADE segue o padrão da casa (VLO + quadra + lote, 2 dígitos cada), o mesmo que
// subiu para o C2X — é ele que vai permitir o cruzamento com as unidades de lá.
export async function reservarUnidade(input: {
  client: AdminClient;
  credenciadoId: string;
  eventoId: string;
  lote: string;
  por?: string | null;
  quadra: string;
}): Promise<{ codigo?: string; error?: string; ok: boolean }> {
  const doisDigitos = (v: string) => String(v ?? "").trim().replace(/\D/g, "").padStart(2, "0");
  const quadra = doisDigitos(input.quadra);
  const lote = doisDigitos(input.lote);
  if (quadra === "00" || lote === "00") {
    return { error: "Informe quadra e lote.", ok: false };
  }

  const { data: evento } = await input.client
    .from("prometeu_eventos")
    .select("enterprise_code")
    .eq("id", input.eventoId)
    .maybeSingle<{ enterprise_code: string | null }>();
  // ⚠️ SEM SIGLA, NÃO SE INVENTA UMA. Aqui havia `?? "VLO"`: um lançamento cadastrado sem
  // empreendimento gerava reserva com o prefixo do VALE DO OURO, em silêncio, e o código errado
  // seguia para a proposta e para o contrato. Recusar é a diferença entre um erro visível na hora
  // e um dado corrompido que só aparece semanas depois.
  const sigla = (evento?.enterprise_code ?? "").trim().toUpperCase();
  if (!sigla) {
    return {
      error:
        "Este lançamento está sem empreendimento. Escolha o empreendimento no Setup antes de reservar unidade.",
      ok: false,
    };
  }

  const codigo = `${sigla}${quadra}${lote}`;

  // Mesma unidade para a MESMA pessoa: não duplica, só confirma. Para pessoas diferentes o
  // registro entra assim mesmo — dois corretores disputando o mesmo lote é um problema REAL do
  // salão, e escondê-lo aqui só faria a briga aparecer mais tarde, no contrato.
  const { data: jaTem } = await input.client
    .from("prometeu_unidades")
    .select("id")
    .eq("credenciado_id", input.credenciadoId)
    .eq("codigo", codigo)
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (!jaTem) {
    const { error } = await input.client.from("prometeu_unidades").insert({
      codigo,
      credenciado_id: input.credenciadoId,
      lote,
      quadra,
      situacao: "reservada",
    });
    if (error) return { error: error.message, ok: false };
  }

  // A etapa só avança; quem já está adiante (proposta, pagamento) não volta para reserva.
  const { data: atual } = await input.client
    .from("prometeu_credenciados")
    .select("etapa")
    .eq("id", input.credenciadoId)
    .maybeSingle<{ etapa: string }>();

  const jaPassou = ["reserva", "secretaria", "proposta", "pagamento", "concluido"].includes(
    atual?.etapa ?? "",
  );
  if (!jaPassou) {
    const r = await moverEtapa({
      client: input.client,
      credenciadoId: input.credenciadoId,
      motivo: `Reservou a unidade ${codigo}`,
      para: "reserva",
      por: input.por ?? null,
    });
    if (!r.ok) return { codigo, error: r.error, ok: false };
  }

  return { codigo, ok: true };
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
    .select("entrou_em, metadata, encerrado_em, evento_id")
    .eq("id", input.credenciadoId)
    .maybeSingle();

  const pessoa = atual as {
    encerrado_em: string | null;
    entrou_em: string | null;
    evento_id: string;
    metadata?: unknown;
  } | null;

  if (pessoa && pessoa.evento_id !== input.eventoId) {
    return { error: "Este QR nao e' deste lancamento.", ok: false };
  }

  // A CREDENCIAL DE ONTEM VALE HOJE (Lucas, 02/08 — evento de mais de um dia): o encerramento
  // do dia arquiva quem nao concluiu, e o RETORNO da pessoa no dia seguinte e' o bip. Estava
  // arquivada + QR na mao = reativa e trata como NOVA chegada (entrou_em de hoje; o "ja fez
  // check-in" e' regra de um dia so, nao vale contra o dia anterior).
  const voltouDoArquivo = Boolean(pessoa?.encerrado_em);
  if (voltouDoArquivo) {
    await input.client
      .from("prometeu_credenciados")
      .update({ encerrado_em: null, encerrado_motivo: null })
      .eq("id", input.credenciadoId)
      .eq("evento_id", input.eventoId);
  }

  if (!voltouDoArquivo && pessoa?.entrou_em) {
    return { error: "Este credenciado ja fez check-in.", ok: false };
  }

  const naJanela = await dentroDaJanela(input.client, input.eventoId);
  const agora = new Date().toISOString();

  // REGIME CONGELADO: qual a fase e se o check-in esta LIGADO NESTE momento. Fica no credenciado
  // (metadata.recepcao) pra que uma troca posterior do liga/desliga NAO mexa em quem ja entrou —
  // a fila da recepcao ordena por essa fase congelada. Ver `filaDaRecepcao`.
  const { data: evento } = await input.client
    .from("prometeu_eventos")
    .select("config")
    .eq("id", input.eventoId)
    .maybeSingle<{ config: PrometeuEventoConfig | null }>();
  const configEvento = evento?.config ?? {};
  const recepcao = {
    fase: configEvento.checkinFase ?? 1,
    ligado: configEvento.checkinHabilitado ?? true,
  };
  const metaAtual =
    atual && typeof (atual as { metadata?: unknown }).metadata === "object" &&
    !Array.isArray((atual as { metadata?: unknown }).metadata)
      ? ((atual as { metadata: Record<string, unknown> }).metadata ?? {})
      : {};

  const { error } = await input.client
    .from("prometeu_credenciados")
    .update({
      credenciado_na_janela: naJanela,
      entrou_em: agora,
      etapa: "recepcao",
      etapa_desde: agora,
      metadata: { ...metaAtual, recepcao },
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

// OS OUTROS DOIS PONTOS DE QR DO DIA. O trilho fisico tem tres bips: recepcao (fazerCheckIn),
// salao e secretaria. Os dois daqui existem separados de `moverEtapa` por um motivo: quem bipa
// e' o organizador de posto, que no dia costuma ser FREELA — nao tem login do hub, so' o cookie
// de operador. `moverEtapa` cru continua restrito ao hub, porque mover etapa a mao e' outra
// coisa: aqui o que autoriza a mudanca e' o QR na mao da pessoa, nao a escolha do operador.

export type ResultadoDoBip = {
  // Nome de quem foi bipado, pra tela confirmar em voz alta ("Pode entrar, Maria").
  credenciado?: { etapa: string; nome: string };
  error?: string;
  // `true` quando a recusa e' por regra (nao foi chamado), nao por falha tecnica. A tela pinta
  // diferente: erro tecnico manda tentar de novo, recusa por regra manda chamar o organizador.
  recusadoPelaRegra?: boolean;
  ok: boolean;
};

// SALAO — o bip CONFIRMA uma chamada. E' a trava anti-fraude do evento: so' entra no salao
// quem foi chamado. Bipar alguem que nao foi chamado nao move nada e devolve recusa explicita,
// pro organizador barrar na hora (regra do Lucas, 24/jul).
export async function bipDoSalao(input: {
  client: AdminClient;
  credenciadoId: string;
  eventoId: string;
}): Promise<ResultadoDoBip> {
  const { data: pessoa } = await input.client
    .from("prometeu_credenciados")
    .select("nome, etapa, evento_id, encerrado_em")
    .eq("id", input.credenciadoId)
    .maybeSingle<{
      encerrado_em: string | null;
      etapa: string;
      evento_id: string;
      nome: string;
    }>();

  if (!pessoa) {
    return { error: "Credenciado nao encontrado.", ok: false };
  }

  if (pessoa.evento_id !== input.eventoId) {
    return { error: "Este QR nao e' deste lancamento.", ok: false };
  }

  // Credencial de ontem vale hoje: arquivado pelo encerramento do dia + QR presente = reativa.
  if (pessoa.encerrado_em) {
    await input.client
      .from("prometeu_credenciados")
      .update({ encerrado_em: null, encerrado_motivo: null })
      .eq("id", input.credenciadoId)
      .eq("evento_id", input.eventoId);
  }

  // A chamada em aberto e' a autorizacao de entrada. Sem ela, o QR nao vale.
  // SÓ chamada SEM mesa: a de MESA é da secretaria — um bip no posto errado fechava a chamada
  // da mesa (o atendente perdia o cliente sem aviso) e ainda REGREDIA a pessoa de `secretaria`
  // para `negociacao`, mandando quem estava a caminho da Mesa 07 de volta ao fim da fila.
  const { data: chamada } = await input.client
    .from("prometeu_chamadas")
    .select("id")
    .eq("credenciado_id", input.credenciadoId)
    .is("atendido_em", null)
    .is("mesa_id", null)
    .order("chamado_em", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (!chamada) {
    // A MENSAGEM TEM QUE SER VERDADE. Não ter chamada em aberto tem dois motivos bem
    // diferentes, e dizer "não foi chamado" para os dois é mentir metade das vezes:
    //   • a pessoa ainda está na recepção  -> realmente não foi chamada, manda aguardar;
    //   • a pessoa JÁ ESTÁ no salão adiante -> ela FOI chamada, entrou, e a chamada foi
    //     fechada. Foi o caso do Lucas: chamou uma pessoa, bipou outra que já estava no salão,
    //     e a tela acusou "não foi chamado" para alguém que tinha sido.
    const jaAndou = pessoa.etapa !== "recepcao";
    const ondeEsta =
      PROMETEU_ETAPAS.find((e) => e.id === pessoa.etapa)?.label ?? pessoa.etapa;

    return {
      credenciado: { etapa: pessoa.etapa, nome: pessoa.nome },
      error: jaAndou
        ? `${pessoa.nome} já passou por aqui e está em ${ondeEsta}.`
        : `${pessoa.nome} ainda não foi chamado. Peça para aguardar a chamada.`,
      ok: false,
      recusadoPelaRegra: true,
    };
  }

  const agora = new Date().toISOString();

  const { error: erroChamada } = await input.client
    .from("prometeu_chamadas")
    .update({ atendido_em: agora })
    .eq("id", chamada.id)
    // Corrida: se outro posto confirmou a mesma chamada no meio do caminho, o filtro nao casa.
    .is("atendido_em", null);

  if (erroChamada) {
    return { error: erroChamada.message, ok: false };
  }

  // Chegou de verdade: some com um "não veio" que estivesse pendente. Mesma razão da secretaria —
  // a marca de ausência não pode sobreviver à pessoa aparecendo com o QR na mão.
  await limparNoShow({ client: input.client, credenciadoId: input.credenciadoId });

  const movido = await moverEtapa({
    client: input.client,
    credenciadoId: input.credenciadoId,
    motivo: "Entrada no salao confirmada por QR",
    para: "negociacao",
  });

  if (!movido.ok) {
    return { error: movido.error, ok: false };
  }

  return { credenciado: { etapa: "negociacao", nome: pessoa.nome }, ok: true };
}

// SECRETARIA — aqui NAO ha chamada previa: a pessoa vai por conta propria depois de fechar no
// salao. A CHEGADA e' o sinal, e o proprio bip fecha a etapa anterior (moverEtapa carimba
// etapa_desde). Ninguem precisa apertar "foi pra secretaria" (regra do Lucas, 24/jul).
export async function bipDaSecretaria(input: {
  client: AdminClient;
  credenciadoId: string;
  eventoId: string;
}): Promise<ResultadoDoBip> {
  const { data: pessoa } = await input.client
    .from("prometeu_credenciados")
    .select("nome, etapa, evento_id")
    .eq("id", input.credenciadoId)
    .maybeSingle<{ etapa: string; evento_id: string; nome: string }>();

  if (!pessoa) {
    return { error: "Credenciado nao encontrado.", ok: false };
  }

  if (pessoa.evento_id !== input.eventoId) {
    return { error: "Este QR nao e' deste lancamento.", ok: false };
  }

  // O BIP É PRESENCIAL: a pessoa está aqui, com o QR na mão. Isso ANULA qualquer "não veio"
  // pendente sobre ela, venha de onde vier.
  //
  // ⚠️ Sem isto, um "não veio" marcado no SALÃO apagava a pessoa da fila da SECRETARIA, porque
  // `filaDaSecretaria` descarta quem tem a marca. E o cenário não é raro: a pessoa sai do salão
  // rumo à secretaria, o organizador do salão a perde de vista e marca "não veio" — só que ela
  // não sumiu, ela avançou. Em 01/08 isso engoliu 5 pessoas; a Rosiene chegou na secretaria às
  // 9:35 e levou a marca às 13:22, sumindo da fila enquanto estava sentada esperando.
  //
  // Roda ANTES do atalho de rebipe: quem já está na secretaria e levou a marca depois só se
  // recupera se o segundo bip limpar.
  await limparNoShow({ client: input.client, credenciadoId: input.credenciadoId });

  // E FECHA QUALQUER "A CAMINHO" DE POSTO ANTERIOR (chamada aberta SEM mesa, ex.: o chamado do
  // salão cujo bip foi pulado). A pessoa está AQUI com o QR na mão — o trânsito acabou. Sem
  // isto ela ficava em `idsEmTransito` para sempre: sentada na secretaria, invisível para as 18
  // mesas, sem nenhum aviso. Chamada DE MESA não entra: essa é do atendente desta etapa.
  // Também antes do atalho de rebipe, pelo mesmo motivo do limparNoShow.
  await input.client
    .from("prometeu_chamadas")
    .update({ atendido_em: new Date().toISOString() })
    .eq("credenciado_id", input.credenciadoId)
    .is("atendido_em", null)
    .is("mesa_id", null);

  // Rebipar quem ja' esta' na secretaria nao e' erro: e' o organizador conferindo. Devolve ok
  // sem mexer em nada, pra tela nao acusar falha de quem so' passou o QR duas vezes.
  if (pessoa.etapa === "secretaria") {
    return { credenciado: { etapa: pessoa.etapa, nome: pessoa.nome }, ok: true };
  }

  const movido = await moverEtapa({
    client: input.client,
    credenciadoId: input.credenciadoId,
    motivo: "Chegada na secretaria confirmada por QR",
    para: "secretaria",
  });

  if (!movido.ok) {
    return { error: movido.error, ok: false };
  }

  return { credenciado: { etapa: "secretaria", nome: pessoa.nome }, ok: true };
}

// ---------------------------------------------------------------- movimento

// Troca a etapa e registra no historico. `etapa_desde` reinicia: e o cronometro do estagio.
export async function moverEtapa(input: {
  client: AdminClient;
  credenciadoId: string;
  // Só o chamarCredenciado usa: ele acabou de ABRIR uma chamada e move a etapa no mesmo ato —
  // sem isto, a limpeza de chamadas abaixo mataria a chamada recém-nascida.
  manterChamadas?: boolean;
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

  // SAIU DA SECRETARIA → A MESA SE SOLTA SOZINHA.
  //
  // ⚠️ Isto é uma REDE, não o caminho principal: Finalizar e Direcionar já liberam a mesa no mesmo
  // request. O problema é que eles são só DOIS dos caminhos — concluir pela Central, mover pelo
  // painel, direcionar de outro lugar, qualquer um deles tirava a pessoa da etapa e deixava a mesa
  // com ela grudada.
  //
  // E o estado que sobrava era um beco sem saída na tela do atendente: mesa `ocupada` com cliente,
  // sem chamada aberta. Sem chamada não aparece o overlay (Rechamar/Não veio/Compareceu); com
  // estado `ocupada` em vez de `atendimento` não aparece Finalizar/Direcionar; e como "tem
  // cliente", o botão Chamar fica desabilitado. O atendente ficava sem NENHUM botão e a mesa
  // morria — foi o que parou 4 das 18 mesas da secretaria em 01/08, uma delas por mais de uma hora.
  //
  // `secretaria` é a única etapa em que estar numa mesa faz sentido; qualquer outra significa que
  // o atendimento acabou ali. Best-effort de propósito: se a liberação falhar, a etapa já mudou —
  // o que não pode é o contrário, a etapa não mudar porque a mesa não soltou.
  if (input.para !== "secretaria") {
    await input.client
      .from("prometeu_mesas")
      .update({ credenciado_id: null, estado: "livre", updated_at: agora })
      .eq("credenciado_id", input.credenciadoId);
  }

  // MUDOU DE ETAPA → CHAMADA ABERTA MORRE JUNTO (mesma rede da mesa, pelo outro lado).
  //
  // Chamada aberta = "a caminho de algum posto". Se a etapa andou por QUALQUER via (Central,
  // bip, Finalizar), esse trânsito acabou — e a chamada zumbi que sobrava era o pior bug do
  // dia 01/08: entrava em `idsEmTransito`, escondia a pessoa de TODAS as filas para sempre, e a
  // trava anti-corrida ainda impedia qualquer mesa de chamá-la de novo. Invisível e inchamável.
  //
  // Indo PARA a secretaria (bip de chegada), só as chamadas SEM mesa morrem (o "venha do salão"
  // cumpriu o papel); uma chamada DE MESA aberta nesse instante é do atendente e fica.
  if (!input.manterChamadas) {
    let limpeza = input.client
      .from("prometeu_chamadas")
      .update({ atendido_em: agora })
      .eq("credenciado_id", input.credenciadoId)
      .is("atendido_em", null);
    if (input.para === "secretaria") limpeza = limpeza.is("mesa_id", null);
    await limpeza;
  }

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
    .select("id, zona, numero, estado, atendente_user_id, atendente_nome, credenciado_id, updated_at")
    .eq("evento_id", eventoId)
    .order("zona", { ascending: true })
    .order("numero", { ascending: true })
    .limit(500);

  if (error || !data) return [];

  return (
    data as {
      atendente_nome: string | null;
      atendente_user_id: string | null;
      credenciado_id: string | null;
      estado: string;
      id: string;
      numero: string;
      updated_at: string | null;
      zona: string;
    }[]
  ).map((row) => ({
    atendenteNome: row.atendente_nome,
    atendenteUserId: row.atendente_user_id,
    credenciadoId: row.credenciado_id,
    estado: (row.estado as PrometeuMesa["estado"]) ?? "livre",
    id: row.id,
    numero: row.numero,
    updatedAt: row.updated_at,
    zona: row.zona,
  }));
}

// SENTAR/SAIR da mesa: o atendente entra numa mesa pela tela do Atendente e o Mapa do salão passa
// a mostrar o nome dele ali. Sem isto, a escolha da mesa ficava só no localStorage e a gestão via
// "sem atendente". `nome` vem do operador logado (ou do admin que estiver testando).
export async function sentarNaMesa(input: {
  client: AdminClient;
  mesaId: string;
  nome: string;
}): Promise<{ error?: string; ok: boolean }> {
  const nome = input.nome.trim();
  const { error } = await input.client
    .from("prometeu_mesas")
    .update({ atendente_nome: nome || null, updated_at: new Date().toISOString() })
    .eq("id", input.mesaId);

  if (error) return { error: error.message, ok: false };
  return { ok: true };
}

export async function sairDaMesa(input: {
  client: AdminClient;
  mesaId: string;
}): Promise<{ error?: string; ok: boolean }> {
  const { error } = await input.client
    .from("prometeu_mesas")
    .update({ atendente_nome: null, updated_at: new Date().toISOString() })
    .eq("id", input.mesaId);

  if (error) return { error: error.message, ok: false };
  return { ok: true };
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

// As ultimas chamadas do evento — alimenta o card "Ultimas chamadas" da Central.
// QUEM ESTÁ EM TRÂNSITO: foi chamado e ainda não apareceu (chamada sem `atendido_em`).
//
// Isto vem do BANCO, e não do último clique da tela, porque no dia UMA pessoa chama VÁRIAS de
// uma vez (regra do Lucas, 27/07: "eu posso ter uma menina chamando 5 pessoas"). Guardar só o
// último chamado no navegador quebrava de dois jeitos: quem chamou 5 só via o quinto, e o
// organizador do OUTRO celular não via nada do que o colega chamou.
//
// É esta lista que autoriza o bip do salão: qualquer um em trânsito pode ser confirmado, na
// ordem em que aparecer na porta — que raramente é a ordem em que foram chamados.
export async function listEmTransito(
  client: AdminClient,
  eventoId: string,
): Promise<{ chamadoEm: string; credenciadoId: string; mesaId: string | null; zona: string | null }[]> {
  const { data, error } = await client
    .from("prometeu_chamadas")
    .select("credenciado_id, chamado_em, mesa_id, zona")
    .eq("evento_id", eventoId)
    .is("atendido_em", null)
    .order("chamado_em", { ascending: true });

  if (error || !data) return [];

  // A ZONA E A MESA VÊM JUNTAS de propósito. Sem elas, o painel "aguardando chegar" do SALÃO
  // listava TODAS as chamadas do evento, inclusive as que um atendente da secretaria tinha
  // acabado de fazer para a mesa dele. Um toque em "Não veio" ali fechava a chamada da MESA e
  // travava o atendente do outro lado do salão: mesa `ocupada`, sem chamada aberta, sem botão
  // nenhum na tela. Aconteceu três vezes em 01/08, com a fila da secretaria parada e 50 pessoas
  // esperando. Cada posto só enxerga — e só encerra — o que ele mesmo chamou.
  return (
    data as { chamado_em: string; credenciado_id: string; mesa_id: string | null; zona: string | null }[]
  ).map((linha) => ({
    chamadoEm: linha.chamado_em,
    credenciadoId: linha.credenciado_id,
    mesaId: linha.mesa_id,
    zona: linha.zona,
  }));
}

export async function listChamadasRecentes(
  client: AdminClient,
  eventoId: string,
  limite = 8,
): Promise<PrometeuChamada[]> {
  const { data, error } = await client
    .from("prometeu_chamadas")
    .select("id, credenciado_id, zona, chamado_em, mesa_id")
    .eq("evento_id", eventoId)
    .order("chamado_em", { ascending: false })
    .limit(limite);

  if (error || !data) return [];

  const linhas = data as {
    chamado_em: string;
    credenciado_id: string;
    id: string;
    mesa_id: string | null;
    zona: string | null;
  }[];

  // Nome de quem foi chamado e numero da mesa: o card mostra "Fulano · Secretaria · Mesa 07".
  const nomes = await mapaDeNomes(
    client,
    linhas.map((l) => l.credenciado_id),
  );
  const mesas = await mapaDeMesas(
    client,
    linhas.map((l) => l.mesa_id).filter(Boolean) as string[],
  );

  return linhas.map((row) => ({
    chamadoEm: row.chamado_em,
    id: row.id,
    mesa: row.mesa_id ? (mesas[row.mesa_id] ?? null) : null,
    nome: nomes[row.credenciado_id] ?? "(sem nome)",
    zona: row.zona,
  }));
}

// ------------------------------------------------------- resumo da mesa (KPIs do atendente)

// OS DOIS INDICADORES QUE O BANCO NÃO GUARDA PRONTOS: "Atendimentos hoje" e "Tempo médio".
//
// A chamada carimba `atendido_em` (a hora em que a pessoa SENTOU), mas não existe coluna para a
// hora em que ela LEVANTOU. Quem registra a saída é a movimentação de etapa que o "Finalizar" e o
// "Direcionar" gravam. Então: fim do atendimento = primeira movimentação daquela pessoa DEPOIS de
// ela sentar. Derivar assim tira a migration do caminho às vésperas do evento.
//
// Atendimento sem movimentação depois é o que ainda está acontecendo: fica de fora da média (não
// terminou) e vira o começo do cronômetro da tela.
export type AtendimentoDaMesa = { atendidoEm: string; credenciadoId: string };
export type SaidaDeEtapa = { credenciadoId: string; em: string };

export function derivarResumoDaMesa(
  atendimentos: AtendimentoDaMesa[],
  saidas: SaidaDeEtapa[],
): PrometeuResumoDaMesa {
  const saidasPorPessoa = new Map<string, number[]>();
  for (const saida of saidas) {
    const em = new Date(saida.em).getTime();
    if (Number.isNaN(em)) continue;

    const lista = saidasPorPessoa.get(saida.credenciadoId) ?? [];
    lista.push(em);
    saidasPorPessoa.set(saida.credenciadoId, lista);
  }
  for (const lista of saidasPorPessoa.values()) lista.sort((a, b) => a - b);

  let somaMs = 0;
  let encerrados = 0;
  let emCurso: { em: string; inicio: number } | null = null;

  for (const atendimento of atendimentos) {
    const inicio = new Date(atendimento.atendidoEm).getTime();
    if (Number.isNaN(inicio)) continue;

    const fim = (saidasPorPessoa.get(atendimento.credenciadoId) ?? []).find((t) => t > inicio);

    if (fim === undefined) {
      // Ainda sentado. Se houver mais de um em aberto (mesa que ficou presa num dia anterior de
      // evento, por exemplo), vale o mais recente — é quem está na cadeira agora.
      if (!emCurso || inicio > emCurso.inicio) {
        emCurso = { em: atendimento.atendidoEm, inicio };
      }
      continue;
    }

    somaMs += fim - inicio;
    encerrados += 1;
  }

  return {
    atendimentosHoje: encerrados,
    emAtendimentoDesde: emCurso?.em ?? null,
    tempoMedioMs: encerrados > 0 ? Math.round(somaMs / encerrados) : null,
  };
}

// MEIA-NOITE DE HOJE no fuso do evento. O banco carimba em UTC, mas "hoje" para quem está no
// salão é o dia de Brasília: por volta das 21h a diferença já viraria o contador de atendimentos.
// O Brasil não tem mais horário de verão, então o -03:00 é fixo.
function inicioDoDiaDoEvento(momento = new Date()): string {
  return `${agoraNoEvento(momento).data}T00:00:00-03:00`;
}

export async function resumoDaMesa(
  client: AdminClient,
  input: { eventoId: string; mesaId: string },
): Promise<PrometeuResumoDaMesa> {
  const inicioDoDia = inicioDoDiaDoEvento();

  const { data: linhas } = await client
    .from("prometeu_chamadas")
    .select("credenciado_id, atendido_em")
    .eq("evento_id", input.eventoId)
    .eq("mesa_id", input.mesaId)
    .gte("atendido_em", inicioDoDia)
    .order("atendido_em", { ascending: true })
    .limit(500);

  const atendimentos: AtendimentoDaMesa[] = (
    (linhas ?? []) as { atendido_em: string; credenciado_id: string }[]
  ).map((linha) => ({ atendidoEm: linha.atendido_em, credenciadoId: linha.credenciado_id }));

  if (atendimentos.length === 0) {
    return { atendimentosHoje: 0, emAtendimentoDesde: null, tempoMedioMs: null };
  }

  const ids = [...new Set(atendimentos.map((a) => a.credenciadoId))];
  const saidas: SaidaDeEtapa[] = [];

  // Lista longa em `.in()` estoura o tamanho da URL do PostgREST e volta 400 (foi o que derrubou
  // a Iris em produção). Uma mesa faz dezenas de atendimentos por dia, não centenas, mas o lote
  // fica aqui porque o custo é zero e a falha seria silenciosa.
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await client
      .from("prometeu_movimentacoes")
      .select("credenciado_id, em")
      .in("credenciado_id", ids.slice(i, i + 100))
      .gte("em", inicioDoDia)
      .order("em", { ascending: true });

    for (const linha of (data ?? []) as { credenciado_id: string; em: string }[]) {
      saidas.push({ credenciadoId: linha.credenciado_id, em: linha.em });
    }
  }

  return derivarResumoDaMesa(atendimentos, saidas);
}

// OS INDICADORES DE TODAS AS MESAS DE UMA VEZ, para o Mapa do salão da gestão. Mesma derivação do
// `resumoDaMesa` (atendimento fecha na 1ª movimentação depois de sentar), mas em lote e com duas
// coisas a mais que a gestão pede: o TEMPO TOTAL e a soma de UNIDADES vendidas nos atendimentos
// fechados. Poucas queries no total (não uma por mesa).
export async function resumoDeTodasAsMesas(
  client: AdminClient,
  eventoId: string,
): Promise<Record<string, PrometeuIndicadorDaMesa>> {
  const inicioDoDia = inicioDoDiaDoEvento();

  const { data: chamadas } = await client
    .from("prometeu_chamadas")
    .select("credenciado_id, atendido_em, mesa_id")
    .eq("evento_id", eventoId)
    .gte("atendido_em", inicioDoDia)
    .not("mesa_id", "is", null)
    .order("atendido_em", { ascending: true })
    .limit(3000);

  const porMesa = new Map<string, AtendimentoDaMesa[]>();
  const ids = new Set<string>();
  for (const c of (chamadas ?? []) as {
    atendido_em: string;
    credenciado_id: string;
    mesa_id: string;
  }[]) {
    const lista = porMesa.get(c.mesa_id) ?? [];
    lista.push({ atendidoEm: c.atendido_em, credenciadoId: c.credenciado_id });
    porMesa.set(c.mesa_id, lista);
    ids.add(c.credenciado_id);
  }

  if (ids.size === 0) return {};

  const listaIds = [...ids];
  const saidasPorPessoa = new Map<string, number[]>();
  for (let i = 0; i < listaIds.length; i += 100) {
    const { data } = await client
      .from("prometeu_movimentacoes")
      .select("credenciado_id, em")
      .in("credenciado_id", listaIds.slice(i, i + 100))
      .gte("em", inicioDoDia);
    for (const m of (data ?? []) as { credenciado_id: string; em: string }[]) {
      const t = new Date(m.em).getTime();
      if (Number.isNaN(t)) continue;
      const lista = saidasPorPessoa.get(m.credenciado_id) ?? [];
      lista.push(t);
      saidasPorPessoa.set(m.credenciado_id, lista);
    }
  }
  for (const lista of saidasPorPessoa.values()) lista.sort((a, b) => a - b);

  const unidadesPorCredenciado = await listUnidades(client, listaIds);

  const resultado: Record<string, PrometeuIndicadorDaMesa> = {};
  for (const [mesaId, atendimentos] of porMesa) {
    let somaMs = 0;
    let encerrados = 0;
    let unidades = 0;
    for (const a of atendimentos) {
      const inicio = new Date(a.atendidoEm).getTime();
      if (Number.isNaN(inicio)) continue;
      // Fim = 1ª saída depois de sentar. Sem saída = ainda em atendimento (não conta na média).
      const fim = (saidasPorPessoa.get(a.credenciadoId) ?? []).find((t) => t > inicio);
      if (fim === undefined) continue;
      somaMs += fim - inicio;
      encerrados += 1;
      unidades += (unidadesPorCredenciado[a.credenciadoId] ?? []).length;
    }
    resultado[mesaId] = {
      atendimentos: encerrados,
      tempoMedioMs: encerrados > 0 ? Math.round(somaMs / encerrados) : null,
      tempoTotalMs: somaMs,
      unidades,
    };
  }

  return resultado;
}

// A JORNADA do cliente no evento (modal da Central). Reconstitui do que o banco carimbou: check-in,
// o HISTÓRICO de etapas (prometeu_movimentacoes), o momento em que sentou na mesa da secretaria e o
// no-show — na ordem do relógio. As unidades reservadas entram como detalhe do passo Reserva.
const LABEL_DA_JORNADA: Record<string, string> = {
  cancelado: "Cancelou a compra",
  concluido: "Finalizado",
  negociacao: "Negociação",
  pagamento: "Financeiro",
  proposta: "Proposta",
  recepcao: "Voltou para a recepção",
  reserva: "Reserva",
  secretaria: "Secretária · check-in",
};

function lerNoShowEm(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const noShow = (metadata as Record<string, unknown>).noShow;
  if (!noShow || typeof noShow !== "object" || Array.isArray(noShow)) return null;
  const em = (noShow as Record<string, unknown>).em;
  return typeof em === "string" ? em : null;
}

export async function jornadaDoCredenciado(
  client: AdminClient,
  credenciadoId: string,
): Promise<PrometeuPassoJornada[]> {
  const { data: cred } = await client
    .from("prometeu_credenciados")
    .select("entrou_em, metadata, credenciado_na_janela")
    .eq("id", credenciadoId)
    .maybeSingle<{
      credenciado_na_janela: boolean | null;
      entrou_em: string | null;
      metadata: unknown;
    }>();
  if (!cred) return [];

  const { data: movs } = await client
    .from("prometeu_movimentacoes")
    .select("para_etapa, em")
    .eq("credenciado_id", credenciadoId)
    .order("em", { ascending: true });

  // O momento em que sentou na mesa da secretaria (o "Secretária · atendimento", diferente do bip
  // de chegada). É a chamada da zona secretaria que foi atendida.
  const { data: atend } = await client
    .from("prometeu_chamadas")
    .select("atendido_em")
    .eq("credenciado_id", credenciadoId)
    .eq("zona", "secretaria")
    .not("atendido_em", "is", null)
    .order("atendido_em", { ascending: true })
    .limit(1);

  const unidades = (await listUnidades(client, [credenciadoId]))[credenciadoId] ?? [];
  const codigos = unidades.map((u) => u.codigo).join(", ");

  const passos: PrometeuPassoJornada[] = [];

  if (cred.entrou_em) {
    passos.push({
      cancelado: false,
      detalhe: null,
      quando: cred.entrou_em,
      titulo: cred.credenciado_na_janela ? "Check-in (dentro da janela)" : "Check-in",
    });
  }

  let temReserva = false;
  for (const m of (movs ?? []) as { em: string; para_etapa: string }[]) {
    const titulo = LABEL_DA_JORNADA[m.para_etapa];
    if (!titulo) continue;
    if (m.para_etapa === "reserva") temReserva = true;
    passos.push({
      cancelado: m.para_etapa === "cancelado",
      detalhe: m.para_etapa === "reserva" && codigos ? codigos : null,
      quando: m.em,
      titulo,
    });
  }

  // Reservou unidades mas sem uma movimentação de "reserva" registrada: mostra assim mesmo — é o
  // que interessa à imobiliária.
  if (!temReserva && codigos) {
    passos.push({ cancelado: false, detalhe: codigos, quando: null, titulo: "Reserva" });
  }

  const atendidoEm = (atend?.[0] as { atendido_em: string } | undefined)?.atendido_em;
  if (atendidoEm) {
    passos.push({
      cancelado: false,
      detalhe: null,
      quando: atendidoEm,
      titulo: "Secretária · atendimento",
    });
  }

  const noShowEm = lerNoShowEm(cred.metadata);
  if (noShowEm) {
    passos.push({ cancelado: true, detalhe: null, quando: noShowEm, titulo: "Não veio (chamado)" });
  }

  // Ordena pelo relógio; passos sem carimbo vão para o fim, na ordem em que entraram.
  return passos
    .map((passo, indice) => ({ indice, passo }))
    .sort((a, b) => {
      if (!a.passo.quando && !b.passo.quando) return a.indice - b.indice;
      if (!a.passo.quando) return 1;
      if (!b.passo.quando) return -1;
      return a.passo.quando.localeCompare(b.passo.quando);
    })
    .map((x) => x.passo);
}

// O feed "Atividade ao vivo": as ultimas trocas de etapa, com o nome de quem se moveu.
export async function listAtividadeRecente(
  client: AdminClient,
  eventoId: string,
  limite = 12,
): Promise<PrometeuAtividade[]> {
  // As movimentacoes nao tem evento_id (so credenciado_id), entao partimos dos credenciados.
  const { ids } = await idsDoEvento(client, eventoId);
  if (ids.length === 0) return [];

  const { data, error } = await client
    .from("prometeu_movimentacoes")
    .select("id, credenciado_id, de_etapa, para_etapa, motivo, em")
    .in("credenciado_id", ids.slice(0, 1000))
    .order("em", { ascending: false })
    .limit(limite);

  if (error || !data) return [];

  const linhas = data as {
    credenciado_id: string;
    de_etapa: string | null;
    em: string;
    id: string;
    motivo: string | null;
    para_etapa: string;
  }[];

  const nomes = await mapaDeNomes(
    client,
    linhas.map((l) => l.credenciado_id),
  );

  return linhas.map((row) => ({
    deEtapa: row.de_etapa,
    em: row.em,
    id: row.id,
    motivo: row.motivo,
    nome: nomes[row.credenciado_id] ?? "(sem nome)",
    paraEtapa: row.para_etapa as PrometeuEtapa,
  }));
}

async function mapaDeNomes(
  client: AdminClient,
  ids: string[],
): Promise<Record<string, string>> {
  const unicos = [...new Set(ids)].filter(Boolean);
  if (unicos.length === 0) return {};

  const { data } = await client
    .from("prometeu_credenciados")
    .select("id, nome")
    .in("id", unicos.slice(0, 200));

  const out: Record<string, string> = {};
  for (const row of ((data ?? []) as { id: string; nome: string }[])) {
    out[row.id] = row.nome;
  }
  return out;
}

async function mapaDeMesas(
  client: AdminClient,
  ids: string[],
): Promise<Record<string, string>> {
  const unicos = [...new Set(ids)].filter(Boolean);
  if (unicos.length === 0) return {};

  const { data } = await client
    .from("prometeu_mesas")
    .select("id, numero")
    .in("id", unicos.slice(0, 200));

  const out: Record<string, string> = {};
  for (const row of ((data ?? []) as { id: string; numero: string }[])) {
    out[row.id] = row.numero;
  }
  return out;
}

// Chama o credenciado pra uma mesa: registra a chamada (telao/locutor leem daqui) e ocupa.
// CHAMAR um credenciado. Dois modos, porque a esteira tem dois:
//   - Secretaria: chama para uma MESA (mesaId) — a mesa fica ocupada.
//   - Salão: chama para a ZONA (zona="salao"), sem mesa fixa — só registra a chamada (o telão/
//     locutor precisam do nome) e, via `moverPara`, avança o cliente para negociação no mesmo ato.
export async function chamarCredenciado(input: {
  chamadoPor?: string | null;
  client: AdminClient;
  credenciadoId: string;
  eventoId: string;
  mesaId?: string | null;
  moverPara?: PrometeuEtapa | null;
  zona?: string | null;
}): Promise<{ error?: string; ok: boolean }> {
  let zona = input.zona ?? null;

  if (input.mesaId) {
    const { data: mesa } = await input.client
      .from("prometeu_mesas")
      .select("zona")
      .eq("id", input.mesaId)
      .maybeSingle();
    zona = (mesa as { zona: string } | null)?.zona ?? zona;
  }

  // REAPARECEU: chamar alguém que estava em no-show tira a marca sozinho. Sem isso o operador
  // teria que lembrar de dois passos, e no dia ninguém lembra.
  await limparNoShow({ client: input.client, credenciadoId: input.credenciadoId });

  // UMA CHAMADA ABERTA POR PESSOA. Cada toque em "Chamar" inseria uma linha nova, então o
  // mesmo cliente aparecia quatro vezes no painel de trânsito (foi o que o Lucas viu no dia
  // 27/07 com o Washington). Rechamar é REPETIR o anúncio, não abrir outra chamada: se já
  // existe uma em aberto, aproveitamos ela (e sem mexer em `chamado_em`, ver logo abaixo).
  const { data: jaChamado } = await input.client
    .from("prometeu_chamadas")
    .select("id, mesa_id")
    .eq("credenciado_id", input.credenciadoId)
    .is("atendido_em", null)
    .limit(1)
    .maybeSingle<{ id: string; mesa_id: string | null }>();

  // ── TRAVA ANTI-CORRIDA (a definitiva, no servidor) ────────────────────────
  // Com 18 mesas lendo a mesma fila num polling de 10s, duas mesas conseguem clicar "Chamar" na
  // mesma pessoa dentro da janela. O filtro da tela reduz, mas só o servidor elimina: o segundo
  // clique era aceito em silêncio, TROCAVA o mesa_id da chamada e deixava as duas mesas com o
  // mesmo cliente — uma delas morta, sem botão. Aconteceu de verdade em 01/08.
  //
  // A regra: chamada aberta que JÁ pertence a outra MESA não pode ser roubada. Rechamar da
  // própria mesa continua livre (é repetir o anúncio), e uma chamada sem mesa pode ser assumida
  // por uma mesa (transição legítima).
  if (input.mesaId && jaChamado?.mesa_id && jaChamado.mesa_id !== input.mesaId) {
    const { data: mesaDona } = await input.client
      .from("prometeu_mesas")
      .select("numero")
      .eq("id", jaChamado.mesa_id)
      .maybeSingle<{ numero: string }>();
    return {
      error: `Este cliente já foi chamado pela Mesa ${mesaDona?.numero ?? "?"}. Atualize a fila e chame o próximo.`,
      ok: false,
    };
  }

  // E a MESA de destino não pode estar com OUTRO cliente: aceitar sobrescreveria um atendimento
  // em andamento sem ninguém perceber.
  if (input.mesaId) {
    const { data: mesaDestino } = await input.client
      .from("prometeu_mesas")
      .select("estado, credenciado_id")
      .eq("id", input.mesaId)
      .maybeSingle<{ credenciado_id: string | null; estado: string }>();
    if (
      mesaDestino &&
      mesaDestino.estado !== "livre" &&
      mesaDestino.credenciado_id &&
      mesaDestino.credenciado_id !== input.credenciadoId
    ) {
      return {
        error: "Esta mesa ainda está com outro cliente. Finalize ou libere antes de chamar.",
        ok: false,
      };
    }
  }

  // E NÃO SE CHAMA QUEM JÁ ESTÁ SENTADO EM OUTRA MESA. O "Compareceu" fecha a chamada, mas a
  // etapa segue `secretaria` até o Finalizar — então quem estava EM ATENDIMENTO reaparecia na
  // fila das outras 17 mesas (com etapaDesde antigo, perto do topo) e era chamado de novo no
  // meio do atendimento: o mesmo cliente em duas mesas e um "Não veio" caindo em quem estava
  // sentado. A trava de cima não pega porque a chamada dele já está FECHADA.
  const { data: mesaOndeEsta } = await input.client
    .from("prometeu_mesas")
    .select("id, numero")
    .eq("credenciado_id", input.credenciadoId)
    .neq("estado", "livre")
    .limit(1)
    .maybeSingle<{ id: string; numero: string }>();
  if (mesaOndeEsta && mesaOndeEsta.id !== (input.mesaId ?? null)) {
    return {
      error: `Este cliente já está na Mesa ${mesaOndeEsta.numero}. Atualize a fila e chame o próximo.`,
      ok: false,
    };
  }

  if (jaChamado) {
    // RECHAMAR NÃO REINICIA O CRONÔMETRO (correção do Lucas, 27/07). O tempo que interessa é
    // desde a PRIMEIRA chamada: é ele que diz há quanto tempo a pessoa está sendo esperada e
    // quando desistir dela. Se cada rechamada zerasse, chamar de novo esconderia o problema
    // justamente de quem precisa vê-lo — e o no-show nunca pareceria no-show.
    const { error: erroRechamada } = await input.client
      .from("prometeu_chamadas")
      .update({ mesa_id: input.mesaId ?? null, zona })
      .eq("id", jaChamado.id);

    if (erroRechamada) return { error: erroRechamada.message, ok: false };
  } else {
    const { error } = await input.client.from("prometeu_chamadas").insert({
      chamado_por: input.chamadoPor ?? null,
      credenciado_id: input.credenciadoId,
      evento_id: input.eventoId,
      mesa_id: input.mesaId ?? null,
      zona,
    });

    if (error) return { error: error.message, ok: false };
  }

  if (input.mesaId) {
    await input.client
      .from("prometeu_mesas")
      .update({
        credenciado_id: input.credenciadoId,
        estado: "ocupada",
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.mesaId);
  }

  if (input.moverPara) {
    await moverEtapa({
      client: input.client,
      credenciadoId: input.credenciadoId,
      // A chamada acabou de nascer — a limpeza de chamadas do moverEtapa não pode matá-la.
      manterChamadas: true,
      motivo: null,
      para: input.moverPara,
      por: input.chamadoPor ?? null,
    });
  }

  return { ok: true };
}

// O cliente CHEGOU na mesa (compareceu): a mesa passa de ocupada para atendimento e a chamada
// mais recente dele naquela mesa recebe o carimbo `atendido_em` (prova de quando sentou).
export async function marcarEmAtendimento(input: {
  client: AdminClient;
  credenciadoId: string;
  mesaId: string;
}): Promise<{ error?: string; ok: boolean }> {
  const agora = new Date().toISOString();

  // `.select` para CONTAR o que o update casou: update de 0 linhas NÃO é erro no PostgREST
  // (armadilha da 0057). Se a mesa foi solta/trocada entre o poll e o clique, o "Compareceu"
  // devolvia ok, a tela agia como se o cliente tivesse sentado e a chamada era dada como
  // atendida sem atendimento nenhum.
  const { data: casadas, error } = await input.client
    .from("prometeu_mesas")
    .update({ estado: "atendimento", updated_at: agora })
    .eq("id", input.mesaId)
    .eq("credenciado_id", input.credenciadoId)
    .select("id");

  if (error) return { error: error.message, ok: false };
  if (!casadas || casadas.length === 0) {
    return { error: "A mesa já não está com este cliente. Atualize a tela.", ok: false };
  }

  // Carimba a chamada em aberto (sem atendido_em) desse credenciado nesta mesa.
  const { data: chamada } = await input.client
    .from("prometeu_chamadas")
    .select("id")
    .eq("mesa_id", input.mesaId)
    .eq("credenciado_id", input.credenciadoId)
    .is("atendido_em", null)
    .order("chamado_em", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (chamada?.id) {
    await input.client
      .from("prometeu_chamadas")
      .update({ atendido_em: agora })
      .eq("id", chamada.id);
  }

  return { ok: true };
}

// Fecha o atendimento na mesa: ela volta a `livre` e solta o cliente. `moverPara` avanca a etapa
// do credenciado no mesmo ato (concluido / cancelado / ou uma etapa anterior quando "direciona").
// Sem isto a mesa so era liberada no reset/encerramento em lote — no dia, ninguem senta de novo.
export async function liberarMesa(input: {
  client: AdminClient;
  credenciadoId?: string | null;
  mesaId: string;
  motivo?: string | null;
  moverPara?: PrometeuEtapa | null;
  por?: string | null;
}): Promise<{ aviso?: string; error?: string; ok: boolean }> {
  const agora = new Date().toISOString();

  // QUEM ESTÁ NA MESA DE VERDADE, lido AGORA. A tela manda o ocupante do último poll — até 10s
  // velho, e muito mais se a aba ficou oculta. Um Finalizar com dado velho concluía a PESSOA
  // ERRADA (que podia já estar em proposta) e derrubava a mesa com o cliente novo. A validação
  // fica AQUI dentro para valer nas duas vias (operador do evento E usuário do hub).
  const { data: mesaAtual } = await input.client
    .from("prometeu_mesas")
    .select("credenciado_id")
    .eq("id", input.mesaId)
    .maybeSingle<{ credenciado_id: string | null }>();

  const { error } = await input.client
    .from("prometeu_mesas")
    .update({
      credenciado_id: null,
      estado: "livre",
      updated_at: agora,
    })
    .eq("id", input.mesaId);

  if (error) return { error: error.message, ok: false };

  // A CHAMADA ABERTA DO OCUPANTE MORRE JUNTO. Mesa livre + chamada viva era o "cliente no
  // limbo": fora de todas as filas (idsEmTransito), invisível nos painéis (chamada com mesa) e
  // inchamável por outra mesa (trava anti-corrida). O botão Liberar mesa produzia exatamente isso.
  const ocupante = mesaAtual?.credenciado_id ?? input.credenciadoId ?? null;
  if (ocupante) {
    await input.client
      .from("prometeu_chamadas")
      .update({ atendido_em: agora })
      .eq("credenciado_id", ocupante)
      .is("atendido_em", null);
  }

  if (input.credenciadoId && input.moverPara) {
    if (mesaAtual?.credenciado_id && mesaAtual.credenciado_id !== input.credenciadoId) {
      return {
        aviso:
          "A mesa já não estava com este cliente — liberei a mesa e não mudei ninguém de etapa. Atualize a tela.",
        ok: true,
      };
    }
    await moverEtapa({
      client: input.client,
      credenciadoId: input.credenciadoId,
      motivo: input.motivo ?? null,
      para: input.moverPara,
      por: input.por ?? null,
    });
  }

  return { ok: true };
}

// -------------------------------------------------------------- evento operavel

// O evento que esta rolando: prioriza o `em_andamento` (evento real), senao o `ativo` (preparo).
// E' o alvo das operacoes do dia e do "meu posto".
export async function eventoOperavel(
  client: AdminClient,
): Promise<null | { enterpriseId: null | string; id: string }> {
  const { data } = await client
    .from("prometeu_eventos")
    .select("id,status,enterprise_id")
    .in("status", ["em_andamento", "ativo"])
    .is("arquivado_em", null)
    .order("status", { ascending: true }) // 'ativo' < 'em_andamento' no alfabeto; corrigido abaixo
    .limit(5);

  const linhas = (data ?? []) as Array<{
    enterprise_id: null | string;
    id: string;
    status: string;
  }>;
  const escolhido = linhas.find((linha) => linha.status === "em_andamento") ?? linhas[0];

  return escolhido
    ? { enterpriseId: escolhido.enterprise_id ?? null, id: escolhido.id }
    : null;
}

export async function eventoOperavelId(
  client: AdminClient,
): Promise<string | null> {
  return (await eventoOperavel(client))?.id ?? null;
}
