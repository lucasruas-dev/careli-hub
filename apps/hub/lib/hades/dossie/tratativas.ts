import type { createApoloAdminClient } from "@/lib/apolo/server";

// TUDO QUE A CARELI FEZ PARA RESOLVER A PENDÊNCIA — é a seção 6 do dossiê.
//
// Pedido do Lucas (03/08): "histórico é das nossas tratativas dentro do hades, e as tratativas
// são as tentativas de negociação, as negociações (quando houve), enfim, trazer tudo que fizemos
// em prol de resolver essa pendência".
//
// ⚠️ A granularidade real do Hades é o CLIENTE, não a negociação. A coluna
// `guardian_compromissos.acquisition_request_c2x_id` existe na migration 0036 mas NENHUMA tela a
// preenche — conferido no banco em 03/08: NULL em 100% das linhas. Então a busca é por
// `client_c2x_id`, e o dossiê declara isso: são as tratativas do cliente, não só do contrato.
//
// `client_c2x_id` É O `users.id` DO C2X — checado no banco, não no nome da coluna: o compromisso
// PR-000008 tem client_c2x_id 2508, metadata.client_name "Jose Arnaldo de Moura", e users.id 2508
// é justamente ele (o acquisition_request 2508 é de outra pessoa). A parcela gravada no mesmo
// compromisso (payment 256481) pertence ao AR 2433, cujo client_id é 2508. Fecha pelos dois lados.
// Isso importa porque os ids colidem: 2508 existe nas DUAS tabelas do C2X.
//
// TRÊS FONTES, porque nenhuma sozinha conta a história:
//   1. guardian_compromissos       — acordos (AC-) e promessas (PR-) que o motor gerou
//   2. guardian_compromisso_comments — a thread de aprovação/reprovação da proposta
//   3. caredesk_ticket_events      — o contato de verdade (ligação, WhatsApp, boleto, visita).
//      Estes têm ticket_id NULL e só se ligam ao cliente pelo jsonb `metadata.client_id`.

type Client = NonNullable<ReturnType<typeof createApoloAdminClient>>;

export type Tratativa = {
  canal: string;
  data: string;
  historico: string;
  responsavel: string;
  // ISO usado só para ordenar; não vai impresso.
  ordenacao: string;
};

const fmt = (iso: string | null | undefined): string => {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleDateString("pt-BR");
};

const BRL = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0
    ? n.toLocaleString("pt-BR", { currency: "BRL", style: "currency" })
    : null;
};

// Um único mapa id→nome para não fazer N consultas em hub_users.
async function nomesDeUsuarios(client: Client, ids: string[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((v) => /^[0-9a-f-]{36}$/i.test(v)))];
  const mapa = new Map<string, string>();
  if (!unicos.length) return mapa;

  // ⚠️ `.in()` com lista grande estoura a URL do PostgREST (já derrubou a Iris). Lotes de 100.
  for (let i = 0; i < unicos.length; i += 100) {
    const { data } = await client
      .from("hub_users")
      .select("id, display_name, email")
      .in("id", unicos.slice(i, i + 100))
      .returns<Array<{ display_name: null | string; email: null | string; id: string }>>();

    for (const u of data ?? []) mapa.set(u.id, u.display_name ?? u.email ?? "Equipe Careli");
  }
  return mapa;
}

export async function carregarTratativas(input: {
  client: Client;
  clienteC2xId: number;
}): Promise<Tratativa[]> {
  const { client, clienteC2xId } = input;
  const tratativas: Tratativa[] = [];
  const idsUsuarios: string[] = [];

  // ── 1. Acordos e promessas ────────────────────────────────────────────────
  const { data: compromissos } = await client
    .from("guardian_compromissos")
    .select(
      "id, protocol, kind, status, stage, approval_status, approval_reason, notes, "
      + "total_amount, installments_count, promised_date, first_due_date, "
      + "created_by_user_id, created_at, fulfilled_at, broken_at",
    )
    .eq("client_c2x_id", clienteC2xId)
    .order("created_at", { ascending: true })
    .limit(200)
    .returns<
      Array<{
        approval_reason: null | string;
        approval_status: null | string;
        broken_at: null | string;
        created_at: string;
        created_by_user_id: null | string;
        first_due_date: null | string;
        fulfilled_at: null | string;
        id: string;
        installments_count: null | number;
        kind: string;
        notes: null | string;
        promised_date: null | string;
        protocol: null | string;
        status: null | string;
        total_amount: null | number;
      }>
    >();

  const compromissoIds: string[] = [];

  for (const c of compromissos ?? []) {
    compromissoIds.push(c.id);
    if (c.created_by_user_id) idsUsuarios.push(c.created_by_user_id);

    const eAcordo = c.kind === "acordo";
    const partes = [
      eAcordo ? "Acordo proposto" : "Promessa de pagamento registrada",
      c.protocol ? `(${c.protocol})` : null,
      BRL(c.total_amount) ? `no valor de ${BRL(c.total_amount)}` : null,
      c.installments_count && c.installments_count > 1 ? `em ${c.installments_count} parcelas` : null,
      c.promised_date ? `com pagamento prometido para ${fmt(c.promised_date)}` : null,
      c.first_due_date && !c.promised_date ? `com primeiro vencimento em ${fmt(c.first_due_date)}` : null,
    ].filter(Boolean);

    // O DESFECHO é o que interessa ao jurídico: prometeu e não cumpriu vale mais que prometeu.
    const desfecho = c.broken_at
      ? `Descumprido em ${fmt(c.broken_at)}.`
      : c.fulfilled_at
        ? `Cumprido em ${fmt(c.fulfilled_at)}.`
        : c.approval_status === "reprovado"
          ? `Proposta reprovada${c.approval_reason ? `: ${c.approval_reason}` : "."}`
          : c.status
            ? `Situação: ${c.status}.`
            : "";

    tratativas.push({
      canal: eAcordo ? "Acordo" : "Promessa",
      data: fmt(c.created_at),
      historico: [`${partes.join(" ")}.`, desfecho, c.notes?.trim()].filter(Boolean).join(" "),
      ordenacao: c.created_at,
      responsavel: c.created_by_user_id ?? "",
    });
  }

  // ── 2. Thread da proposta (aprovação, reprovação, comentários do gestor) ───
  if (compromissoIds.length) {
    const { data: comentarios } = await client
      .from("guardian_compromisso_comments")
      .select("author_user_id, body, created_at, kind, metadata")
      .in("compromisso_id", compromissoIds.slice(0, 100))
      .order("created_at", { ascending: true })
      .limit(300)
      .returns<
        Array<{
          author_user_id: null | string;
          body: null | string;
          created_at: string;
          kind: null | string;
          metadata: null | Record<string, unknown>;
        }>
      >();

    for (const c of comentarios ?? []) {
      const corpo = c.body?.trim();
      if (!corpo) continue;
      if (c.author_user_id) idsUsuarios.push(c.author_user_id);

      const rotulo =
        c.kind === "aprovacao" ? "Aprovação" : c.kind === "reprovacao" ? "Reprovação" : "Análise interna";

      tratativas.push({
        canal: rotulo,
        data: fmt(c.created_at),
        historico: corpo,
        ordenacao: c.created_at,
        // O nome vem denormalizado no metadata. ⚠️ A coluna é `author_name` (snake_case) —
        // `authorName` é só o nome do campo em TS e devolve undefined aqui.
        responsavel: (c.metadata?.author_name as string) ?? c.author_user_id ?? "",
      });
    }
  }

  // ── 3. Contato de verdade (ligação, WhatsApp, boleto, acionamento) ────────
  // Estes eventos têm ticket_id NULL e só se ligam ao cliente pelo jsonb.
  const { data: eventos } = await client
    .from("caredesk_ticket_events")
    .select("actor_user_id, created_at, description, metadata, title")
    .contains("metadata", { client_id: `c2x-client-${clienteC2xId}`, source_module: "guardian" })
    .order("created_at", { ascending: true })
    .limit(300)
    .returns<
      Array<{
        actor_user_id: null | string;
        created_at: string;
        description: null | string;
        metadata: null | Record<string, unknown>;
        title: null | string;
      }>
    >();

  for (const e of eventos ?? []) {
    if (e.actor_user_id) idsUsuarios.push(e.actor_user_id);
    const evento = (e.metadata?.event ?? {}) as Record<string, unknown>;

    // `occurredAt` é QUANDO ACONTECEU; created_at é quando foi digitado. No documento vale o
    // que aconteceu — o operador registra a ligação de ontem hoje de manhã o tempo todo.
    const quando = (evento.occurredAt as string) ?? e.created_at;
    const titulo = e.title?.trim() ?? (evento.title as string) ?? "";
    const texto = e.description?.trim() ?? (evento.description as string) ?? "";
    if (!titulo && !texto) continue;

    tratativas.push({
      canal: (evento.type as string) ?? "Atendimento",
      data: fmt(quando),
      historico: [titulo, texto].filter(Boolean).join(" - "),
      ordenacao: quando,
      responsavel: (evento.operator as string) ?? e.actor_user_id ?? "",
    });
  }

  // ── Nomes + ordem cronológica ─────────────────────────────────────────────
  const nomes = await nomesDeUsuarios(client, idsUsuarios);

  return tratativas
    .map((t) => ({ ...t, responsavel: nomes.get(t.responsavel) ?? t.responsavel ?? "Equipe Careli" }))
    .map((t) => ({ ...t, responsavel: t.responsavel || "Equipe Careli" }))
    .sort((a, b) => a.ordenacao.localeCompare(b.ordenacao));
}
