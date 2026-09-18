import type { createPrometeuClient } from "./data";

type AdminClient = NonNullable<ReturnType<typeof createPrometeuClient>>;

// O CUPOM DO SALÃO SEGUE A RESERVA DO HÉRCULES.
//
// Lucas (18/09/2026): *"toda reserva, proposta deve ser criada no hercules"* · *"cadastro apolo,
// interações comerciais hercules"*. Desde então cada linha nova de `prometeu_reservas` (o cupom que
// o salão imprime) tem uma reserva do Hércules por trás (`hercules_reservas.prometeu_reserva_id`), e
// quem diz se o lote ainda é daquele cliente é ELA. A régua única já pensa assim
// (lib/hercules/situacao-da-unidade.ts: cupom ligado a reserva do Hércules não conta sozinho).
//
// ⚠️ O QUE ESTE ARQUIVO RESOLVE: a reserva cancelada na tela Venda não escreve no cupom (a rota da
// Venda não conhece o salão). A linha continua `reservada` na tabela, e cada leitor do Prometeu que
// lesse a coluna crua (a PA, a Central, o mini dash) mostraria um lote que o cliente já não segura,
// enquanto o telão e a Venda o mostram livre. Os leitores perguntam aqui.
//
// ⚠️ CUPOM SEM RESERVA DO HÉRCULES (anterior a 18/09) VALE SOZINHO, como sempre valeu.

export type ReservaDoHerculesDoCupom = {
  id: string;
  prometeu_reserva_id: null | string;
  situacao: string;
  unidade_id: null | string;
};

/** As reservas do Hércules ligadas a linhas do cupom, por linha. */
export async function reservasDoHerculesDosCupons(
  client: AdminClient,
  linhaIds: readonly string[],
): Promise<{ error?: string; porCupom: Map<string, ReservaDoHerculesDoCupom[]> }> {
  const porCupom = new Map<string, ReservaDoHerculesDoCupom[]>();
  const ids = [...new Set(linhaIds.map((id) => String(id ?? "").trim()).filter(Boolean))];
  // Em blocos: `.in()` com centenas de uuids estoura a URL do PostgREST.
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await client
      .from("hercules_reservas")
      .select("id, situacao, unidade_id, prometeu_reserva_id")
      .eq("workspace_id", "careli")
      .in("prometeu_reserva_id", ids.slice(i, i + 100));
    if (error) return { error: error.message, porCupom };
    for (const r of (data ?? []) as ReservaDoHerculesDoCupom[]) {
      const id = String(r.prometeu_reserva_id ?? "");
      if (!id) continue;
      const lista = porCupom.get(id) ?? [];
      lista.push(r);
      porCupom.set(id, lista);
    }
  }
  return { porCupom };
}

/**
 * A linha do cupom tem reserva do Hércules, e TODAS as que ela tem já caíram (cancelada ou
 * expirada)? É o cupom que ficou sem dono. Sem reserva do Hércules ligada a resposta é `false`.
 */
export function reservaDoHerculesCaiu(ligadas: readonly ReservaDoHerculesDoCupom[] | undefined): boolean {
  if (!ligadas || ligadas.length === 0) return false;
  return ligadas.every((r) => r.situacao === "cancelada" || r.situacao === "expirada");
}

/**
 * Das linhas `reservada` dadas, as que a reserva do Hércules já soltou.
 *
 * `null` = não foi possível ler o Hércules. Quem MOSTRA (Central, nome no Apolo, mini dash) segue
 * com a linha crua, que é o lado ocupado; quem IMPRIME ou GRAVA (a PA, a reserva nova) recusa.
 */
export async function cuponsSoltosPeloHercules(
  client: AdminClient,
  linhaIds: readonly string[],
): Promise<null | Set<string>> {
  const { error, porCupom } = await reservasDoHerculesDosCupons(client, linhaIds);
  if (error) {
    console.error("[prometeu][cupom] reservas do Hércules não lidas", error);
    return null;
  }
  return new Set(linhaIds.filter((id) => reservaDoHerculesCaiu(porCupom.get(id))));
}
