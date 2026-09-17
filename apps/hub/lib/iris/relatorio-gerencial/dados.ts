import type { SupabaseClient } from "@supabase/supabase-js";

import { createIrisMetaAdminClient } from "@/lib/iris/meta-server";

import type { JanelaDoRelatorio } from "./janela";
import {
  classificarBacklog,
  FILAS_DO_RELATORIO,
  type ItemDoBacklog,
  type MensagemDaJanela,
  type TicketDaJanela,
} from "./metricas";

// A LEITURA DO DIA — tudo pelo client do Supabase, agregando em memória.
//
// ⚠️ NÃO EXISTE SQL CRU AQUI, e não é preguiça: o hub fala com o Supabase pelo PostgREST, e o
// volume de um dia cabe na memória com folga (medido em 17/09/2026: 212 tickets e 1.055 mensagens).
// É o mesmo padrão de `lib/analytics/iris-builder.ts`. A conta fica em `metricas.ts`, que é puro e
// tem teste — e não num SQL que só o banco sabe executar.
//
// ⚠️ PAGINA DE MIL EM MIL. O PostgREST corta em 1.000 linhas SEM ERRO: num dia movimentado, sem
// paginar, o relatório sairia com menos mensagens do que houve e ninguém notaria.
//
// ⚠️ O `provider_payload` SÓ VEM DAS FALHAS. Ele é o JSON inteiro do provedor; trazê-lo nas 1.055
// mensagens do dia carregaria megabytes para ler um código de erro que só existe em 39 delas.

const PAGINA = 1000;

/** Duas horas de folga depois do fim: a resposta das 18h40 a um recado das 18h25 conta. */
const FOLGA_DEPOIS_EM_MS = 2 * 60 * 60 * 1000;

export type DadosDoRelatorio = {
  backlogDoAtendimento: ItemDoBacklog[];
  mensagens: MensagemDaJanela[];
  nomePorUsuario: Map<string, string>;
  tickets: TicketDaJanela[];
};

type LinhaDeMensagem = {
  created_at: string;
  delivery_status: null | string;
  direction: null | string;
  message_type: null | string;
  sender_user_id: null | string;
  ticket_id: null | string;
};

type LinhaDeTicket = {
  closed_at: null | string;
  id: string;
  metadata: null | Record<string, unknown>;
  opened_at: null | string;
  queue_id: null | string;
};

async function emPaginas<T>(
  consulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const tudo: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await consulta(de, de + PAGINA - 1);
    if (error) throw new Error(String((error as { message?: string }).message ?? error));
    const linhas = data ?? [];
    tudo.push(...linhas);
    if (linhas.length < PAGINA) break;
  }
  return tudo;
}

export async function lerDadosDoRelatorio(
  janela: JanelaDoRelatorio,
  clientInjetado?: SupabaseClient | null,
): Promise<DadosDoRelatorio> {
  const client = clientInjetado ?? createIrisMetaAdminClient();
  if (!client) throw new Error("Supabase indisponível para o relatório de atendimento.");

  const inicio = janela.inicio.toISOString();
  const fim = janela.fim.toISOString();
  const fimComFolga = new Date(janela.fim.getTime() + FOLGA_DEPOIS_EM_MS).toISOString();

  // ── As filas: o nome é o que o relatório mostra, o id é o que o banco guarda ──
  const { data: filas, error: erroDasFilas } = await client
    .from("caredesk_queues")
    .select("id,name")
    .in("name", [...FILAS_DO_RELATORIO]);
  if (erroDasFilas) throw new Error(erroDasFilas.message);

  const nomeDaFila = new Map<string, string>();
  for (const f of (filas ?? []) as Array<{ id: string; name: string }>) {
    nomeDaFila.set(f.id, f.name);
  }
  const idsDasFilas = [...nomeDaFila.keys()];
  if (idsDasFilas.length === 0) {
    return { backlogDoAtendimento: [], mensagens: [], nomePorUsuario: new Map(), tickets: [] };
  }

  // ── As mensagens da janela (com folga para a resposta atrasada) ──
  const linhasDeMensagem = await emPaginas<LinhaDeMensagem>((de, ate) =>
    client
      .from("caredesk_messages")
      .select("ticket_id,direction,message_type,delivery_status,sender_user_id,created_at")
      .gte("created_at", inicio)
      .lte("created_at", fimComFolga)
      .order("created_at", { ascending: true })
      .range(de, ate),
  );

  // ── Os tickets: os que a janela abriu ou fechou, mais os que as mensagens tocaram ──
  const abertos = await emPaginas<LinhaDeTicket>((de, ate) =>
    client
      .from("caredesk_tickets")
      .select("id,queue_id,opened_at,closed_at,metadata")
      .in("queue_id", idsDasFilas)
      .gte("opened_at", inicio)
      .lte("opened_at", fim)
      .order("opened_at", { ascending: true })
      .range(de, ate),
  );

  const fechados = await emPaginas<LinhaDeTicket>((de, ate) =>
    client
      .from("caredesk_tickets")
      .select("id,queue_id,opened_at,closed_at,metadata")
      .in("queue_id", idsDasFilas)
      .gte("closed_at", inicio)
      .lte("closed_at", fim)
      .order("closed_at", { ascending: true })
      .range(de, ate),
  );

  const porId = new Map<string, LinhaDeTicket>();
  for (const t of [...abertos, ...fechados]) porId.set(t.id, t);

  const idsDasMensagens = [
    ...new Set(linhasDeMensagem.map((m) => m.ticket_id).filter((id): id is string => Boolean(id))),
  ];
  const faltando = idsDasMensagens.filter((id) => !porId.has(id));

  // ⚠️ `.in()` MONTA A URL, e uma lista longa estoura o limite do PostgREST. Em blocos de 200.
  for (let i = 0; i < faltando.length; i += 200) {
    const bloco = faltando.slice(i, i + 200);
    const { data, error } = await client
      .from("caredesk_tickets")
      .select("id,queue_id,opened_at,closed_at,metadata")
      .in("id", bloco);
    if (error) throw new Error(error.message);
    for (const t of (data ?? []) as LinhaDeTicket[]) porId.set(t.id, t);
  }

  const daCaca = (t: LinhaDeTicket | undefined) =>
    String((t?.metadata as { handlingOwner?: unknown } | null)?.handlingOwner ?? "")
      .trim()
      .toLowerCase() === "caca";

  const tickets: TicketDaJanela[] = [];
  for (const t of porId.values()) {
    const fila = t.queue_id ? nomeDaFila.get(t.queue_id) : undefined;
    if (!fila) continue;
    tickets.push({
      abertoEm: t.opened_at,
      daCaca: daCaca(t),
      fechadoEm: t.closed_at,
      fila,
      id: t.id,
    });
  }

  // ── Os códigos de erro, só das mensagens que falharam ──
  const erroPorMensagem = new Map<string, string>();
  const { data: falhas, error: erroDasFalhas } = await client
    .from("caredesk_messages")
    .select("ticket_id,created_at,provider_payload")
    .eq("delivery_status", "failed")
    .gte("created_at", inicio)
    .lte("created_at", fimComFolga)
    .limit(PAGINA);
  if (erroDasFalhas) throw new Error(erroDasFalhas.message);

  for (const f of (falhas ?? []) as Array<{
    created_at: string;
    provider_payload: null | Record<string, unknown>;
    ticket_id: null | string;
  }>) {
    const erro = (f.provider_payload as { deliveryError?: { code?: unknown } } | null)?.deliveryError
      ?.code;
    if (erro === undefined || erro === null) continue;
    erroPorMensagem.set(`${f.ticket_id}|${f.created_at}`, String(erro));
  }

  const ticketPorId = new Map(tickets.map((t) => [t.id, t]));
  const mensagens: MensagemDaJanela[] = [];
  for (const m of linhasDeMensagem) {
    if (!m.ticket_id) continue;
    const ticket = ticketPorId.get(m.ticket_id);
    // Mensagem de fila que não é do relatório (Financeiro, Jurídico) fica de fora.
    if (!ticket) continue;
    mensagens.push({
      criadoEm: m.created_at,
      daCaca: ticket.daCaca,
      direcao: String(m.direction ?? ""),
      entrega: m.delivery_status,
      erroCodigo: erroPorMensagem.get(`${m.ticket_id}|${m.created_at}`) ?? null,
      fila: ticket.fila,
      ticketId: m.ticket_id,
      tipo: m.message_type,
      usuarioId: m.sender_user_id,
    });
  }

  // ── Quem é quem ──
  const idsDeUsuario = [
    ...new Set(mensagens.map((m) => m.usuarioId).filter((id): id is string => Boolean(id))),
  ];
  const nomePorUsuario = new Map<string, string>();
  for (let i = 0; i < idsDeUsuario.length; i += 200) {
    const bloco = idsDeUsuario.slice(i, i + 200);
    // ⚠️ A COLUNA É `display_name`, e não `name` — com o nome errado o select não falha: devolve
    // a linha sem o campo, e o relatório sai com sete "Sem nome" no lugar da equipe.
    const { data } = await client.from("hub_users").select("id,display_name,email").in("id", bloco);
    for (const u of (data ?? []) as Array<{
      display_name: null | string;
      email: null | string;
      id: string;
    }>) {
      nomePorUsuario.set(u.id, (u.display_name ?? u.email ?? "Sem nome").trim());
    }
  }

  // ── O backlog do Atendimento, com o remetente para classificar ──
  const idDoAtendimento = [...nomeDaFila.entries()].find(([, nome]) => nome === "Atendimento")?.[0];
  const backlogDoAtendimento: ItemDoBacklog[] = [];

  if (idDoAtendimento) {
    const pendentes = await emPaginas<{
      contact_id: null | string;
      opened_at: null | string;
      protocol: null | string;
      subject: null | string;
    }>((de, ate) =>
      client
        .from("caredesk_tickets")
        .select("protocol,subject,contact_id,opened_at")
        .eq("queue_id", idDoAtendimento)
        .eq("status", "new")
        .order("opened_at", { ascending: true })
        .range(de, ate),
    );

    const idsDeContato = [
      ...new Set(pendentes.map((p) => p.contact_id).filter((id): id is string => Boolean(id))),
    ];
    const emailPorContato = new Map<string, string>();
    for (let i = 0; i < idsDeContato.length; i += 200) {
      const bloco = idsDeContato.slice(i, i + 200);
      const { data } = await client.from("caredesk_contacts").select("id,email").in("id", bloco);
      for (const c of (data ?? []) as Array<{ email: null | string; id: string }>) {
        if (c.email) emailPorContato.set(c.id, c.email);
      }
    }

    for (const p of pendentes) {
      const email = p.contact_id ? (emailPorContato.get(p.contact_id) ?? null) : null;
      backlogDoAtendimento.push({
        assunto: p.subject,
        classe: classificarBacklog({ assunto: p.subject, email }),
        diasParado: p.opened_at
          ? Math.max(
              0,
              Math.floor((janela.fim.getTime() - new Date(p.opened_at).getTime()) / 86_400_000),
            )
          : 0,
        email,
        protocolo: p.protocol,
      });
    }
  }

  return { backlogDoAtendimento, mensagens, nomePorUsuario, tickets };
}
