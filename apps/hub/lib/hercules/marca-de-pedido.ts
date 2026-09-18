import type { SupabaseClient } from "@supabase/supabase-js";

import { ESTAGIOS_ENCERRADOS } from "@/lib/temis/trabalhos";

import { DEPOIS_DO_CONTRATO as ETAPAS_DO_PEDIDO } from "./acao-de-cancelamento";

// A MARCA DO PEDIDO DE CANCELAMENTO QUE SOBROU SEM PEDIDO.
//
// ⚠️ A MARCA NA VENDA NÃO É O PEDIDO. `hercules_propostas.cancelamento_pedido_em` é gravada quando
// o coordenador pede o cancelamento, e o pedido de verdade é o CARD na Têmis. Quando o card acaba
// (indeferido) e a marca fica, a venda parece ter um pedido que ninguém mais anda. Foi o caso de
// VOL1106 e VOC0306: indeferidos em 17/09/2026, antes de o indeferimento passar a limpar a marca.
// A v1.350.0 limpava esse resto só quando o pedido novo chegava à rota; mas a tela da Venda lia a
// marca, apagava o botão ("Cancelamento pedido") e o pedido novo nunca chegava. Medido em produção
// em 18/09/2026: as duas vendas presas, sem saída pela tela nem pela Têmis.
//
// ⚠️ E A MARCA NOVA TAMBÉM NÃO TEM CARD, POR UM INSTANTE. A rota do pedido grava a marca ANTES de
// criar o card (é a marca que impede o segundo card de um clique duplo). Tratar como resto a marca
// que acabou de nascer abriria justamente o segundo card que ela existe para impedir. Por isso o
// resto precisa das duas coisas: nenhum card de pedido aberto E a marca com mais de alguns minutos.

/**
 * Quanto a marca precisa ter para ser resto, e não um pedido a caminho da Têmis.
 *
 * ⚠️ MAIS DO QUE A ROTA DO PEDIDO PODE DURAR. Ela não fixa `maxDuration`, e o teto da Vercel chega a
 * 300 s: com 5 minutos, o limite ficaria em cima do pedido mais lento possível (revisão de 18/09/2026).
 */
export const IDADE_MINIMA_DO_RESTO_MS = 15 * 60 * 1000;

/**
 * A marca é resto de um pedido que acabou?
 *
 * `cardsAbertos` é quantos cards de pedido (cancelamento ou distrato) ainda andam na Têmis para esta
 * venda. `null` quando a leitura falhou: sem saber, a marca vale como pedido, porque dizer "não há
 * pedido" sem ter perguntado é abrir o segundo pedido do mesmo contrato.
 */
export function marcaEhResto({
  agora,
  cardsAbertos,
  marca,
}: {
  agora: Date;
  cardsAbertos: null | number;
  marca: null | string | undefined;
}): boolean {
  if (!marca) return false;
  if (cardsAbertos === null || cardsAbertos > 0) return false;
  const quando = Date.parse(marca);
  // Marca ilegível: não há como saber a idade, e na dúvida ela segura o botão, como antes.
  if (!Number.isFinite(quando)) return false;
  return agora.getTime() - quando >= IDADE_MINIMA_DO_RESTO_MS;
}

/**
 * Tira da carga a marca de pedido de cancelamento que sobrou sem card aberto na Têmis.
 *
 * ⚠️ SÓ NA CARGA DA TELA. O banco não muda aqui: quem limpa a marca, gravando a história do pedido
 * antigo, é a rota do pedido novo (`limparMarcaOrfa`), quando o coordenador clica. Esta leitura só
 * impede que o resto apague o botão que leva até lá.
 *
 * ⚠️ LEITURA QUE FALHA DEIXA TODA MARCA COMO ESTÁ. É o comportamento de antes: botão apagado. O
 * contrário (liberar sem ter perguntado) arriscaria o segundo pedido do mesmo contrato, e a rota do
 * pedido confere de novo de qualquer jeito.
 *
 * ⚠️ `.in()` EM LOTES DE 100, pelo limite de tamanho da URL do PostgREST. Hoje são 9 vendas
 * marcadas; o lote é para o dia em que forem muitas.
 */
export async function soltarMarcasQueSobraram(
  supabase: null | SupabaseClient,
  propostas: Array<{ cancelamento_pedido_em?: null | string; etapa?: null | string; id: string }>,
  agora: Date = new Date(),
): Promise<void> {
  if (!supabase) return;
  // ⚠️ SÓ A VENDA VIVA DEPOIS DO CONTRATO, que é onde o botão do pedido existe. Na venda que já caiu,
  // a conclusão guarda a marca como história, e é dela que a lista pinta a borda da venda cancelada.
  const marcadas = propostas.filter(
    (p) => p.cancelamento_pedido_em && ETAPAS_DO_PEDIDO.has(String(p.etapa ?? "")),
  );
  if (marcadas.length === 0) return;

  const comCardAberto = new Set<string>();
  const ids = [...new Set(marcadas.map((p) => p.id))];
  try {
    for (let de = 0; de < ids.length; de += 100) {
      const { data, error } = await supabase
        .from("temis_trabalhos")
        .select("proposta_id")
        .eq("workspace_id", "careli")
        .in("proposta_id", ids.slice(de, de + 100))
        .in("tipo", ["cancelamento", "distrato"])
        .not("estagio", "in", `(${ESTAGIOS_ENCERRADOS.join(",")})`);
      if (error) {
        console.error("[hercules][marca-de-pedido] os pedidos abertos da Têmis não foram lidos", error.message);
        return;
      }
      for (const linha of (data ?? []) as Array<{ proposta_id: null | string }>) {
        if (linha.proposta_id) comCardAberto.add(linha.proposta_id);
      }
    }
  } catch (erro) {
    console.error("[hercules][marca-de-pedido] os pedidos abertos da Têmis não foram lidos", erro);
    return;
  }

  for (const p of marcadas) {
    const resto = marcaEhResto({
      agora,
      cardsAbertos: comCardAberto.has(p.id) ? 1 : 0,
      marca: p.cancelamento_pedido_em,
    });
    if (resto) p.cancelamento_pedido_em = null;
  }
}
