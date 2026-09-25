// O NOME DE MERCADO POR ID, LIDO UMA VEZ: a tabela que o sync do Apolo usa no lugar do nome do C2X.
//
// Lucas (24/09/2026), depois de a Nívea renomear no C2X o empreendimento 43 de RECANTO DO VALE/RDV
// para PORTAL DO IBITURUNA/PDI: *"Tivemos que mudar de nome"*; e *"pode"* para travar as portas por
// onde o C2X ainda mexe no Panteon. O sync do Apolo (crons `/api/apolo/sync/c2x`, a cada 6 h, e
// `.../incremental`, a cada 5 min) era uma dessas portas: gravava em
// `apolo_commercial_links.enterprise_name` o nome que o C2X tivesse NA HORA da rodada.
//
// ⚠️ O EFEITO NÃO ERA SÓ "NOME VELHO", ERA O MESMO EMPREENDIMENTO COM DOIS NOMES. O sync só regrava
// o cliente que mexeu, então um renome no legado não troca tudo de uma vez: fragmenta. Medido em
// 24/09/2026 na Aldeia (42), renomeada no C2X em 12/09: 27 linhas com "ALDEIA DA CACHOEIRA DAS
// PEDRAS" (gravadas de 14/09 a 24/09) e 20 com "ALDEIA DAS CACHOEIRAS DAS PEDRAS" (paradas desde
// 10/09). E o cadastro do Panteon diz uma terceira grafia.
//
// A FONTE É `hercules_empreendimentos`, pelo ID do C2X (`c2x_enterprise_id`), que é a chave que não
// muda quando alguém renomeia no legado. E o nome é o DE MERCADO: o do PAI, sem a divisão interna
// (`nomeDeMercado`, a mesma régua do PDF da CAD; [[feedback_pai_e_a_fonte_unidade_unica]]). Ler o
// `nome` da própria linha mostraria "Vale do Ouro · VOC" para o cliente do VOC.
//
// ⚠️ ID QUE O PANTEON NÃO CONHECE CAI NO NOME DO C2X, de propósito. É o caso do empreendimento que
// nasceu no legado depois da semeadura de 02/09 e ainda não foi cadastrado aqui, e dos que ficaram de
// fora por decisão (SDT, TSC e o 30). Gravar vazio ou "Carteira comercial" apagaria da ficha e da
// busca a única pista de onde o cliente comprou; o nome do C2X é o melhor que existe até o cadastro
// chegar. Quando chegar, a próxima rodada troca sozinha.
//
// ⚠️ UMA LEITURA POR RODADA, NUNCA POR LINHA. O incremental roda a cada 5 minutos e um lote tem até
// 500 clientes: quem chama lê o mapa uma vez e o reaproveita em todos os lotes da rodada.
import type { SupabaseClient } from "@supabase/supabase-js";

import { nomeDeMercado, type LinhaDoCadastro } from "@/lib/apolo/empreendimento-de-mercado";

/** Id do C2X (texto, aparado) → nome de mercado do Panteon. */
export type NomesDeMercado = ReadonlyMap<string, string>;

type ClienteDoCadastro = Pick<SupabaseClient, "from">;

// Mesmo workspace fixo das outras leituras do cadastro (lib/hercules/cadastro.ts).
const WORKSPACE = "careli";
// ⚠️ PAGINA MESMO SENDO 38 LINHAS HOJE: o PostgREST corta em 1.000 SEM ERRO
// ([[reference_postgrest_teto_de_1000_linhas]]), e o que some é o fim da lista.
const PAGINA = 1000;

/**
 * O mapa, PURO: recebe o cadastro inteiro já lido e devolve, para cada linha com id do C2X, o nome de
 * mercado dela. Linha sem nome confiável (nem dela, nem do pai) fica de fora, e aí vale o do C2X.
 */
export function mapaDeNomesDeMercado(cadastro: readonly LinhaDoCadastro[]): Map<string, string> {
  const mapa = new Map<string, string>();

  for (const linha of cadastro) {
    const id = (linha.c2x_enterprise_id ?? "").trim();
    if (!id) continue;

    const nome = nomeDeMercado(id, cadastro);
    if (nome) mapa.set(id, nome);
  }

  return mapa;
}

/**
 * O nome que vai para o banco: o de mercado do Panteon quando o id é conhecido; o do C2X quando não é.
 * Sem mapa (leitura falhou), o do C2X, que é exatamente o comportamento de antes.
 */
export function nomeDoEmpreendimentoPorId(
  nomes: NomesDeMercado | undefined,
  enterpriseId: unknown,
  nomeDoC2x: null | string,
): null | string {
  if (!nomes || nomes.size === 0) return nomeDoC2x;

  // O id chega como número (`e.id` direto) ou como texto (`cast(e.id as char)` dentro de um
  // group_concat), e o driver pode entregar texto longo como Buffer: `String()` cobre os três.
  const id = enterpriseId === null || enterpriseId === undefined ? "" : String(enterpriseId).trim();

  return (id && nomes.get(id)) || nomeDoC2x;
}

/**
 * Lê o cadastro inteiro UMA vez e devolve o mapa.
 *
 * ⚠️ NUNCA LANÇA, E FALHA DEVOLVE MAPA VAZIO. Quem chama é o sync da carteira, e a carteira é o que a
 * operação inteira usa: o nome do empreendimento não pode derrubar a rodada. Mapa vazio faz a rodada
 * gravar o nome do C2X, que é o que ela gravava até 24/09/2026; o `console.error` deixa o rastro no
 * log da Vercel. O supabase-js não lança em erro de consulta (devolve `{ data: null, error }`), então
 * o `error` é conferido em cada página, e o que lançar de verdade cai no `catch`.
 */
export async function lerNomesDeMercado(client: ClienteDoCadastro): Promise<Map<string, string>> {
  const linhas: LinhaDoCadastro[] = [];

  try {
    for (let de = 0; ; de += PAGINA) {
      const { data, error } = await client
        .from("hercules_empreendimentos")
        .select("c2x_enterprise_id, id, nome, pai_id")
        .eq("workspace_id", WORKSPACE)
        .order("id", { ascending: true })
        .range(de, de + PAGINA - 1);

      if (error) {
        console.error("[apolo][nome-de-mercado] cadastro do Panteon indisponível; vale o nome do C2X", error);
        return new Map();
      }

      const pagina = (data ?? []) as LinhaDoCadastro[];
      linhas.push(...pagina);
      if (pagina.length < PAGINA) break;
    }
  } catch (erro) {
    console.error("[apolo][nome-de-mercado] cadastro do Panteon indisponível; vale o nome do C2X", erro);
    return new Map();
  }

  return mapaDeNomesDeMercado(linhas);
}
