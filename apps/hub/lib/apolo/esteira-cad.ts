// QUAL CAD? — a pergunta que a esteira passou a ter que responder.
//
// Até a migration 0080, `apolo_esteira` tinha `entity_id` como CHAVE PRIMÁRIA: uma CAD por
// pessoa, para sempre. Todo o código nasceu com essa suposição e busca a esteira por pessoa,
// com `.eq("entity_id", x).maybeSingle()`. Com a chave `(entity_id, enterprise_id)` isso passa a
// poder voltar VÁRIAS linhas — e `maybeSingle()` LANÇA ERRO quando volta mais de uma.
//
// Este módulo é a resposta única para "de qual CAD desta pessoa estamos falando":
//
//   • COM empreendimento no escopo  -> a CAD daquele empreendimento. É sempre o caminho certo, e
//     é para cá que todo chamador deve migrar quando tiver o id em mãos.
//   • SEM empreendimento no escopo  -> a CAD MAIS RECENTE, com `order` EXPLÍCITO. Nunca confiar
//     na ordem natural da tabela: sem `order`, qual linha volta é decisão do planner e muda entre
//     execuções — o mesmo clique daria respostas diferentes.
//
// O desempate é determinístico até o fim: `atualizado_em desc` (NOT NULL, com default now()),
// depois `created_at desc`, depois `enterprise_id desc`. Como `(entity_id, enterprise_id)` é
// único, o último critério sozinho já decide qualquer empate.

import type { SupabaseClient } from "@supabase/supabase-js";

// Só o que estes helpers usam. Aceita tanto o admin client do Apolo quanto um SupabaseClient
// cru — os dois convivem no módulo (lib/apolo/* usa os dois estilos).
type ClienteEsteira = Pick<SupabaseClient, "from">;

// Id do empreendimento no C2X. A COLUNA É `text` (migration 0061), não inteiro: o código antigo
// declarava `number` em alguns pontos e comparar tipo trocado devolve zero linha em silêncio.
// Aceita number por conveniência dos chamadores e devolve sempre texto normalizado, ou null.
export function normalizarEnterpriseId(valor: unknown): null | string {
  if (typeof valor === "number" && Number.isFinite(valor)) return String(valor);
  if (typeof valor !== "string") return null;
  const limpo = valor.trim();
  return limpo ? limpo : null;
}

// UMA linha da esteira desta pessoa.
//
// `enterpriseId` presente = a CAD daquele empreendimento (e só ela: se não existir, devolve null,
// nunca a CAD de outro loteamento). Ausente = a mais recente.
export async function lerCadDaEsteira<T>(
  client: ClienteEsteira,
  entityId: string,
  colunas: string,
  opts: { enterpriseId?: unknown } = {},
): Promise<null | T> {
  const enterpriseId = normalizarEnterpriseId(opts.enterpriseId);

  let query = client.from("apolo_esteira").select(colunas).eq("entity_id", entityId);
  if (enterpriseId) query = query.eq("enterprise_id", enterpriseId);

  // `.limit(1)` ANTES do `.maybeSingle()` é o que impede o erro "mais de uma linha": o PostgREST
  // corta no servidor e o maybeSingle só decide entre 0 e 1.
  const { data, error } = await query
    .order("atualizado_em", { ascending: false })
    .order("created_at", { ascending: false })
    .order("enterprise_id", { ascending: false })
    .limit(1)
    .maybeSingle<T>();

  // ⚠️ FAIL-CLOSED. Uma leitura que FALHOU (blip de rede, RLS, timeout) NÃO é "não tem CAD" — é
  // "não sei". Devolver null aqui fazia o dedup concluir que a pessoa não tem CAD e liberar o
  // upsert POR CIMA da CAD viva do empreendimento (etapa volta pra validação, corretor/origem
  // trocam). Propagar o erro força quem chama a barrar em vez de sobrescrever às cegas.
  if (error) throw new Error(`apolo_esteira: leitura falhou (${error.message})`);

  return (data ?? null) as null | T;
}

// TODAS as CADs desta pessoa, da mais recente para a mais antiga. É o que passa a fazer sentido
// onde a resposta é para uma PESSOA (a CACÁ atende por CPF e não sabe de empreendimento).
export async function lerCadsDaEsteira<T>(
  client: ClienteEsteira,
  entityId: string,
  colunas: string,
  opts: { limite?: number } = {},
): Promise<T[]> {
  const { data, error } = await client
    .from("apolo_esteira")
    .select(colunas)
    .eq("entity_id", entityId)
    .order("atualizado_em", { ascending: false })
    .order("created_at", { ascending: false })
    .order("enterprise_id", { ascending: false })
    .limit(opts.limite ?? 20);

  // ⚠️ FAIL-CLOSED (mesmo motivo do `lerCadDaEsteira`). Uma lista vazia por FALHA de leitura é
  // indistinguível de "pessoa sem CAD", e é justamente essa confusão que abre a trava de
  // duplicidade sozinha. Erro na leitura vira exceção; quem chama decide barrar.
  if (error) throw new Error(`apolo_esteira: leitura falhou (${error.message})`);

  return ((data ?? []) as unknown as T[]) ?? [];
}

// Colapsa um lote de linhas (uma leitura `.in("entity_id", ...)`) num mapa por pessoa.
//
// ⚠️ ISTO É UMA PERDA CONSCIENTE: com várias CADs por pessoa, um `Map` chaveado por `entity_id`
// só cabe uma. Onde a consequência é grave (a ficha que sobe para o C2X, a ordem da fila do
// lançamento) a escolha é sempre a CAD MAIS RECENTE, e nunca "a última que o banco devolveu".
// Quem puder chavear pelo par (entity_id, enterprise_id) deve fazer isso em vez de usar isto.
export function maisRecentePorEntidade<T extends { entity_id: string }>(linhas: T[]): Map<string, T> {
  const mapa = new Map<string, T>();
  for (const linha of linhas) {
    const atual = mapa.get(linha.entity_id);
    if (!atual || compararRecencia(linha, atual) < 0) mapa.set(linha.entity_id, linha);
  }
  return mapa;
}

// Mesmo critério do `order` do banco, aplicado em memória. Negativo = `a` é mais recente.
function compararRecencia(a: Record<string, unknown>, b: Record<string, unknown>): number {
  const texto = (v: unknown) => (typeof v === "string" ? v : "");
  return (
    texto(b.atualizado_em).localeCompare(texto(a.atualizado_em)) ||
    texto(b.created_at).localeCompare(texto(a.created_at)) ||
    texto(b.enterprise_id).localeCompare(texto(a.enterprise_id))
  );
}
