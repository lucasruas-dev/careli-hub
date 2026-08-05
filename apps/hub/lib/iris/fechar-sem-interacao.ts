import { donoPadraoDaFila } from "@/lib/iris/evolution-inbound-processor";
import { createIrisMetaAdminClient } from "@/lib/iris/meta-server";

// Fechamento automatico dos atendimentos que morreram na mao da CACA.
//
// O problema: quando a Caca responde e o cliente nao volta, o ticket fica aberto para sempre.
// Isso nao e' so' sujeira de tela — a trava de "cliente ja esta em atendimento" consulta o
// BANCO, entao o ticket zumbi impede o time de iniciar uma conversa nova com aquele cliente.
//
// A regra (definida pelo Lucas em 24/07): a ULTIMA mensagem e' da Caca e o cliente nao
// respondeu em 4 horas. Fecha com motivo proprio, separado do "Sem Interacao" que o operador
// escolhe a mao, para dar pra medir quanto a Caca conversa sozinha.
//
// Travas de seguranca (nunca fechar trabalho de gente):
//   - ticket COM operador atribuido fica de fora, mesmo batendo o resto da regra;
//   - se a ultima mensagem e' do CLIENTE, fica aberto (e' justamente quem espera resposta);
//   - se a ultima mensagem e' de um operador humano, fica aberto.
export const MOTIVO_SEM_INTERACAO_CACA = "Sem interação - Assistente Virtual";

const HORAS_SEM_RESPOSTA_PADRAO = 4;
// Marcador do ticket que nasceu de uma conversa privada no numero do relacionamento (Evolution).
// Mesmo valor gravado em evolution-inbound-processor.ts.
const DIRECT_SOURCE_ENTITY_TYPE = "whatsapp-direct";
const DIRECT_QUEUE_SLUG = "relacionamento-direct";
// Os ids viajam na URL do PostgREST — lista longa demais derruba a requisicao (400).
// Ver [[project-iris]] e a correcao equivalente em iris-data-client.ts.
const LOTE_DE_IDS = 100;
const PAGINA_DE_MENSAGENS = 1000;

type TicketAberto = {
  assigned_to_user_id: string | null;
  id: string;
  metadata: unknown;
  protocol: string | null;
  source_entity_type: string | null;
  status: string | null;
};

type MensagemLeve = {
  created_at: string | null;
  direction: string | null;
  sender_type: string | null;
  sender_user_id: string | null;
  ticket_id: string | null;
};

export type FechamentoSemInteracaoResultado = {
  candidatos: number;
  fechados: number;
  falhas: number;
  horas: number;
  simulacao: boolean;
  ticketsAbertos: number;
  protocolos: string[];
};

export function ehDaCaca(mensagem: MensagemLeve) {
  // A Caca grava como operador, mas SEM usuario do hub — e' isso que a separa de um humano.
  return (
    mensagem.direction === "outbound" &&
    mensagem.sender_type === "operator" &&
    !mensagem.sender_user_id
  );
}

// Regra de fechamento isolada do banco para poder ser testada: recebe a ULTIMA mensagem do
// ticket e o instante-limite (agora - N horas).
export function deveFecharPorSemInteracao(
  ultimaMensagem: MensagemLeve | undefined,
  limiteIso: string,
) {
  if (!ultimaMensagem?.created_at) {
    // Ticket sem mensagem nenhuma: nao da' pra afirmar que a Caca falou por ultimo.
    return false;
  }

  return ehDaCaca(ultimaMensagem) && ultimaMensagem.created_at < limiteIso;
}

// Quem responde pela fila Direct por padrao. Vem do banco (metadata da fila) para poder trocar
// sem deploy; se nao estiver configurado, o comportamento e' o de antes.
async function lerDonoPadraoDaFilaDirect(
  client: ReturnType<typeof createIrisMetaAdminClient>,
): Promise<string | null> {
  if (!client) {
    return null;
  }

  const { data } = await client
    .from("caredesk_queues")
    .select("metadata")
    .eq("slug", DIRECT_QUEUE_SLUG)
    .maybeSingle<{ metadata: unknown }>();

  return donoPadraoDaFila(data?.metadata);
}

function comoRegistro(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {};
}

export async function fecharTicketsSemInteracaoDaCaca(options?: {
  horas?: number;
  simulacao?: boolean;
}): Promise<FechamentoSemInteracaoResultado> {
  const horas = options?.horas ?? HORAS_SEM_RESPOSTA_PADRAO;
  const simulacao = options?.simulacao ?? false;
  const client = createIrisMetaAdminClient();

  if (!client) {
    throw new Error("Supabase indisponivel para o fechamento automatico da Iris.");
  }

  // A fila Direct passou a nascer COM dono (a responsavel pelo relacionamento). Sem o trecho
  // abaixo, a trava "ticket com operador fica de fora" desligaria o fechamento automatico
  // dessa fila inteira — e ela responde por 22 dos 148 tickets que o cron ja' fechou.
  //
  // O criterio nao e' "tem dono", e' "alguem ASSUMIU". Enquanto o dono for exatamente o dono
  // PADRAO da fila, ninguem pegou o atendimento e a trava nao deveria valer. No instante em
  // que alguem transfere pra si, o dono deixa de ser o padrao e o ticket sai da mira sozinho.
  const donoPadraoDirect = await lerDonoPadraoDaFilaDirect(client);
  const filtroDeDono = donoPadraoDirect
    ? `assigned_to_user_id.is.null,and(source_entity_type.eq.${DIRECT_SOURCE_ENTITY_TYPE},assigned_to_user_id.eq.${donoPadraoDirect})`
    : null;

  const consultaAbertos = client
    .from("caredesk_tickets")
    .select("id,protocol,status,metadata,assigned_to_user_id,source_entity_type")
    .neq("status", "closed");

  const { data: abertosData, error: abertosError } = await (filtroDeDono
    ? consultaAbertos.or(filtroDeDono)
    : consultaAbertos.is("assigned_to_user_id", null)
  ).limit(2000);

  if (abertosError) {
    throw abertosError;
  }

  const abertos = (abertosData ?? []) as TicketAberto[];
  const ticketIds = abertos.map((ticket) => ticket.id);

  if (ticketIds.length === 0) {
    return {
      candidatos: 0,
      falhas: 0,
      fechados: 0,
      horas,
      protocolos: [],
      simulacao,
      ticketsAbertos: 0,
    };
  }

  // A ultima mensagem de cada ticket sai daqui. Paginamos ate esgotar em vez de confiar num
  // .limit(): com corte, os tickets MAIS parados (mensagens antigas) seriam os primeiros a
  // ficar de fora — justamente os que precisamos fechar.
  const ultimaPorTicket = new Map<string, MensagemLeve>();

  for (let inicio = 0; inicio < ticketIds.length; inicio += LOTE_DE_IDS) {
    const lote = ticketIds.slice(inicio, inicio + LOTE_DE_IDS);
    let pagina = 0;

    for (;;) {
      const { data, error } = await client
        .from("caredesk_messages")
        .select("ticket_id,created_at,direction,sender_type,sender_user_id")
        .in("ticket_id", lote)
        .order("created_at", { ascending: false })
        .range(
          pagina * PAGINA_DE_MENSAGENS,
          (pagina + 1) * PAGINA_DE_MENSAGENS - 1,
        );

      if (error) {
        throw error;
      }

      const linhas = (data ?? []) as MensagemLeve[];

      for (const mensagem of linhas) {
        const ticketId = mensagem.ticket_id;

        if (!ticketId) {
          continue;
        }

        const atual = ultimaPorTicket.get(ticketId);
        const quando = mensagem.created_at ?? "";

        if (!atual || quando > (atual.created_at ?? "")) {
          ultimaPorTicket.set(ticketId, mensagem);
        }
      }

      if (linhas.length < PAGINA_DE_MENSAGENS) {
        break;
      }

      pagina += 1;
    }
  }

  const limite = new Date(Date.now() - horas * 60 * 60 * 1000).toISOString();
  const candidatos = abertos.filter((ticket) =>
    deveFecharPorSemInteracao(ultimaPorTicket.get(ticket.id), limite),
  );

  if (simulacao) {
    return {
      candidatos: candidatos.length,
      falhas: 0,
      fechados: 0,
      horas,
      protocolos: candidatos.map((ticket) => ticket.protocol ?? ticket.id),
      simulacao,
      ticketsAbertos: abertos.length,
    };
  }

  const agora = new Date().toISOString();
  let fechados = 0;
  let falhas = 0;
  const protocolos: string[] = [];

  for (const ticket of candidatos) {
    const ultima = ultimaPorTicket.get(ticket.id);
    // closed_at = a hora da ultima mensagem, nao a hora do cron: o atendimento morreu la',
    // e e' isso que o historico e os relatorios de tempo precisam enxergar.
    const encerradoEm = ultima?.created_at ?? agora;

    const atualizacao = client
      .from("caredesk_tickets")
      .update({
        closed_at: encerradoEm,
        metadata: {
          ...comoRegistro(ticket.metadata),
          closedAt: encerradoEm,
          closedByUserId: null,
          closedMotivo: MOTIVO_SEM_INTERACAO_CACA,
          closedReason: `Cliente sem resposta ha mais de ${horas}h apos a ultima mensagem da CACA.`,
          closedSource: "iris_cron_sem_interacao",
          closedTicketProtocol: ticket.protocol ?? null,
        },
        status: "closed",
        updated_at: agora,
      })
      .eq("id", ticket.id)
      // Corrida com o operador: se alguem assumiu ou fechou entre a leitura e o update, o
      // filtro nao casa e o ticket fica como esta'.
      .neq("status", "closed");

    // A trava vale para os dois casos. Ticket orfao so' fecha se continuar orfao; ticket da
    // fila Direct so' fecha se o dono for O MESMO que a gente leu — se alguem assumiu no meio
    // do caminho, o filtro nao casa e o atendimento fica aberto na mao de quem pegou.
    const { error } = await (ticket.assigned_to_user_id
      ? atualizacao.eq("assigned_to_user_id", ticket.assigned_to_user_id)
      : atualizacao.is("assigned_to_user_id", null));

    if (error) {
      falhas += 1;
      continue;
    }

    fechados += 1;
    protocolos.push(ticket.protocol ?? ticket.id);
  }

  return {
    candidatos: candidatos.length,
    falhas,
    fechados,
    horas,
    protocolos,
    simulacao,
    ticketsAbertos: abertos.length,
  };
}
