import { createApoloAdminClient } from "@/lib/apolo/server";

// O HISTÓRICO DE CADA BOLETO — o que aconteceu, quando, e com que resultado.
//
// Pedido do Lucas (01/09/2026): *"eu queria ao clicar na linha que abrisse um modal abaixo mostrando
// o histórico, geração, envio whatsapp(numero) se foi entregue"*.
//
// ⚠️ O AVISO VERDE DA TELA SOME. "1 boleto emitido", "1 mensagem enviada" respondem tudo e
// desaparecem no primeiro recarregamento. Quando o cliente liga dizendo que não recebeu, o operador
// precisa saber para qual número foi, quando, e se o WhatsApp entregou. É isso que mora aqui.
//
// ⚠️ NUNCA UM UPDATE. Cada tentativa é uma linha nova, inclusive as que falharam: é justamente o
// "mandei duas vezes" e o "falhou na primeira" que explicam a conversa com o cliente.

export type TipoDeEvento = "cancelamento" | "emissao" | "envio";

export type EventoDoBoleto = {
  autor: null | string;
  canal: null | string;
  cobrancaId: null | string;
  detalhe: null | string;
  /** Só nos eventos de envio, e só depois que o webhook do WhatsApp responde. */
  entrega: null | { em: null | string; status: string };
  ok: boolean;
  quando: string;
  telefone: null | string;
  tipo: TipoDeEvento;
  waMessageId: null | string;
};

/**
 * Registra um evento.
 *
 * ⚠️ NÃO LANÇA. O evento é a MEMÓRIA do que aconteceu, não a ação: se a gravação falhar depois de um
 * boleto emitido ou uma mensagem enviada, derrubar a operação faria o operador repetir e o cliente
 * receber duas vezes. Perder uma linha de histórico é ruim; cobrar duas vezes é pior.
 */
export async function registrarEvento(input: {
  autor?: null | string;
  canal?: null | string;
  cobrancaId?: null | string;
  competencia: string;
  detalhe?: null | string;
  empreendimento: string;
  ok: boolean;
  telefone?: null | string;
  tipo: TipoDeEvento;
  unidade: string;
  waMessageId?: null | string;
}): Promise<void> {
  try {
    const supabase = createApoloAdminClient();
    if (!supabase) return;
    await supabase.from("boletos_eventos").insert({
      autor: input.autor ?? null,
      canal: input.canal ?? null,
      cobranca_id: input.cobrancaId ?? null,
      competencia: input.competencia,
      detalhe: input.detalhe ?? null,
      empreendimento: input.empreendimento,
      ok: input.ok,
      telefone: input.telefone ?? null,
      tipo: input.tipo,
      unidade: input.unidade,
      wa_message_id: input.waMessageId ?? null,
      workspace_id: "careli",
    });
  } catch {
    // Ver a nota acima: a ação já aconteceu.
  }
}

type LinhaCrua = {
  autor: null | string;
  canal: null | string;
  cobranca_id: null | string;
  detalhe: null | string;
  ok: boolean;
  quando: string;
  telefone: null | string;
  tipo: TipoDeEvento;
  wa_message_id: null | string;
};

/**
 * O histórico de uma unidade, do mais novo para o mais antigo, com o status de entrega junto.
 *
 * ⚠️ A ENTREGA É LIDA ONDE O WEBHOOK JÁ A ESCREVE. O status ("entregue", "lido", "falhou") chega da
 * Meta por webhook, que atualiza `caredesk_messages` pelo id da mensagem. Este módulo não processa
 * webhook nenhum: ele guarda o `wa_message_id` no evento e vai buscar o status ali na hora de montar
 * o histórico. Duplicar o processamento seria uma segunda verdade sobre a mesma mensagem.
 */
export async function historicoDoBoleto(input: {
  competencia: string;
  empreendimento: string;
  unidade: string;
}): Promise<EventoDoBoleto[]> {
  const supabase = createApoloAdminClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("boletos_eventos")
    .select("autor, canal, cobranca_id, detalhe, ok, quando, telefone, tipo, wa_message_id")
    .eq("workspace_id", "careli")
    .eq("empreendimento", input.empreendimento)
    .eq("unidade", input.unidade)
    .eq("competencia", input.competencia)
    .order("quando", { ascending: false });

  if (error || !data) return [];

  const linhas = data as LinhaCrua[];
  const wamids = linhas.map((l) => l.wa_message_id).filter((id): id is string => Boolean(id));
  const entregas = await statusDasMensagens(wamids);

  return linhas.map((l) => ({
    autor: l.autor,
    canal: l.canal,
    cobrancaId: l.cobranca_id,
    detalhe: l.detalhe,
    entrega: l.wa_message_id ? (entregas.get(l.wa_message_id) ?? null) : null,
    ok: l.ok,
    quando: l.quando,
    telefone: l.telefone,
    tipo: l.tipo,
    waMessageId: l.wa_message_id,
  }));
}

/**
 * O status de entrega das mensagens, por id.
 *
 * ⚠️ VAZIO NÃO É "NÃO ENTREGUE". O webhook de status pode não ter chegado ainda, e o disparo pelo
 * Relacionamento (Evolution) não passa pela Meta, então nunca terá status nenhum. Quem lê precisa
 * mostrar "sem confirmação" e não "falhou": as duas coisas levam a ações opostas.
 */
async function statusDasMensagens(
  wamids: string[],
): Promise<Map<string, { em: null | string; status: string }>> {
  const mapa = new Map<string, { em: null | string; status: string }>();
  if (wamids.length === 0) return mapa;

  try {
    const supabase = createApoloAdminClient();
    if (!supabase) return mapa;

    const { data } = await supabase
      .from("caredesk_messages")
      .select("delivered_at, delivery_status, provider_message_id, read_at")
      .in("provider_message_id", wamids);

    for (const m of (data ?? []) as {
      delivered_at: null | string;
      delivery_status: null | string;
      provider_message_id: null | string;
      read_at: null | string;
    }[]) {
      if (!m.provider_message_id) continue;
      // 'lido' é mais forte que 'entregue': quem leu, recebeu.
      const status = m.read_at ? "lido" : m.delivered_at ? "entregue" : (m.delivery_status ?? "enviado");
      mapa.set(m.provider_message_id, { em: m.read_at ?? m.delivered_at, status });
    }
  } catch {
    // Sem a tabela, ou id que não é de mensagem nossa: o histórico sai sem o status.
  }

  return mapa;
}
