import type { SupabaseClient } from "@supabase/supabase-js";

import type { UnidadesInteresse } from "@/lib/apolo/acoes";

// RESPOSTA do cliente a um disparo de AÇÃO (o botão do convite). Casada pelo wa_message_id do
// disparo (message.context.id do inbound = apolo_acao_alvos.disparo_wa_message_id). Grava a resposta
// NA AÇÃO e NÃO abre ticket: ação não é atendimento (a Cacá não responde). Ver
// [[project_apolo_acao_contato]]. Chamada bem cedo no meta-inbound-processor.

// Texto do botão do template → unidades de interesse. Os botões são fixos ("1 unidade" / "2 a 3" /
// "acima de 3"), mas normalizamos com folga (a Meta pode variar acento/caixa).
export function derivarUnidades(texto: string): UnidadesInteresse | null {
  const t = texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
  if (t.startsWith("acima")) return "acima_3";
  if (t.startsWith("1")) return "1";
  if (t.startsWith("2")) return "2_3"; // "2 a 3", "2-3", "2 a 3 unidades"
  return null;
}

// Registra a resposta do botão no alvo cujo disparo_wa_message_id casa com o waMessageId (o
// context.id do inbound). Retorna {registrado:true} quando ERA uma resposta de ação — o inbound usa
// isso para NÃO seguir o fluxo de ticket. Best-effort: qualquer erro devolve registrado:false para o
// inbound cair no caminho normal (não podemos perder uma mensagem real por um efeito colateral).
export async function registrarRespostaDeAcao(
  client: SupabaseClient,
  input: { recebidoEm: string; texto: string; waMessageId: string | null },
): Promise<{ alvoId?: string; registrado: boolean }> {
  if (!input.waMessageId) return { registrado: false };

  try {
    const { data: alvo } = await client
      .from("apolo_acao_alvos")
      .select("id, unidades_interesse, unidades_origem")
      .eq("disparo_wa_message_id", input.waMessageId)
      .maybeSingle<{
        id: string;
        unidades_interesse: string | null;
        unidades_origem: string | null;
      }>();

    if (!alvo) return { registrado: false };

    const unidades = derivarUnidades(input.texto);
    const patch: Record<string, unknown> = {
      resposta_em: input.recebidoEm,
      resposta_texto: input.texto,
      updated_at: input.recebidoEm,
    };
    // Só grava unidades quando o botão foi reconhecido; a resposta do CLIENTE manda sobre o que o
    // operador tinha posto. Se o botão não casar com nenhuma opção, guarda só o texto cru.
    if (unidades) {
      patch.unidades_interesse = unidades;
      patch.unidades_origem = "cliente";
    }

    const { error } = await client
      .from("apolo_acao_alvos")
      .update(patch)
      .eq("id", alvo.id);
    if (error) return { registrado: false };

    return { alvoId: alvo.id, registrado: true };
  } catch {
    return { registrado: false };
  }
}
