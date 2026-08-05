import { getServerSupabaseConfig } from "@/lib/supabase/server-config";

import { EVENTO_CHAMADO, EVENTO_PALCO, topicoDaFila } from "./fila-topic";

// Avisa os celulares da fila (via broadcast HTTP do Realtime — SEM WebSocket, ideal pra serverless)
// que a fila mudou: alguém foi chamado. O cliente que recebe faz um refresh imediato (a fonte única
// da verdade continua no server); quem virou "chamado" dispara o alerta na própria tela. Broadcast
// é baratíssimo perto de reduzir o poll de 15s (que a regra de custo do Hermes proíbe).
//
// O `payload.c` leva QUEM foi chamado: só o celular daquele credenciado reage (refresh + alerta);
// os demais ignoram o broadcast e seguem no poll de 15s para a posição. Isso mantém o custo mínimo
// (1 refresh por chamada, não N) e ainda entrega o alerta na hora pra quem importa.
//
// BEST-EFFORT: nunca lança. Se o broadcast falhar, o poll de 15s continua sendo a rede de segurança.
export async function avisarFilaEmRealtime(
  eventoId: string,
  credenciadoId?: string | null,
): Promise<void> {
  try {
    const { serviceRoleKey, url } = getServerSupabaseConfig();
    if (!url || !serviceRoleKey || !eventoId) return;

    // Timeout curto: se o Realtime pendurar, não segura o resto do after() (ex.: o WhatsApp) nem
    // estoura o maxDuration da função. O poll de 15s do cliente cobre a falha.
    const abort = new AbortController();
    const t = setTimeout(() => abort.abort(), 3000);
    try {
      await fetch(`${url.replace(/\/+$/, "")}/realtime/v1/api/broadcast`, {
        body: JSON.stringify({
          messages: [
            {
              event: EVENTO_CHAMADO,
              payload: { c: credenciadoId ?? null },
              topic: topicoDaFila(eventoId),
            },
          ],
        }),
        cache: "no-store",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
        },
        method: "POST",
        signal: abort.signal,
      });
    } finally {
      clearTimeout(t);
    }
  } catch {
    // best-effort — o poll de segurança cobre.
  }
}

// O MAESTRO: manda o estado do palco (música/vídeo de fundo) para TODOS os telões do evento de
// uma vez. Mesmo tópico da fila (as TVs já estão inscritas), event próprio. As chamadas de cada
// canal seguem 100% independentes — isto só toca no fundo. BEST-EFFORT como o de cima: se o
// broadcast falhar, o poll de 20s do telão pega o estado novo na volta seguinte.
export async function avisarPalcoEmRealtime(
  eventoId: string,
  palco: Record<string, unknown>,
): Promise<void> {
  try {
    const { serviceRoleKey, url } = getServerSupabaseConfig();
    if (!url || !serviceRoleKey || !eventoId) return;

    const abort = new AbortController();
    const t = setTimeout(() => abort.abort(), 3000);
    try {
      await fetch(`${url.replace(/\/+$/, "")}/realtime/v1/api/broadcast`, {
        body: JSON.stringify({
          messages: [
            {
              event: EVENTO_PALCO,
              payload: palco,
              topic: topicoDaFila(eventoId),
            },
          ],
        }),
        cache: "no-store",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
        },
        method: "POST",
        signal: abort.signal,
      });
    } finally {
      clearTimeout(t);
    }
  } catch {
    // best-effort — o poll do telão cobre.
  }
}
