// GRAFIA CANÔNICA DA IMOBILIÁRIA — uma imobiliária, um nome.
//
// A imobiliária vive como TEXTO LIVRE na esteira (é o que o corretor digita), e a mesma empresa
// aparece escrita de N jeitos: "RR Soluções" e "RR SOLUCOES IMOBILIARIAS LTDA", "J&F" e "J&F
// Negócios Imobiliários". Cada grafia vira uma linha no filtro e uma barra no ranking, e a
// imobiliária que mais produz aparece dividida em três pedaços médios.
//
// A regra (Lucas, 29/07: "temos que padronizar esses nomes") agrupa pela ENTIDADE da imobiliária
// — o vínculo em `apolo_relationships`, com o de-para `apolo_imobiliaria_match` como plano B — e
// escolhe, para todas as CADs do grupo, a MESMA grafia: a mais usada entre elas (empate → a mais
// curta → alfabética). Preserva acento e sigla, não força caixa alta.
//
// Nasceu dentro de `app/api/apolo/board/route.ts` e saiu de lá quando o painel do coordenador
// passou a precisar da mesma resposta: duas cópias da mesma regra divergem no primeiro ajuste, e
// aí o Board e o painel público passam a discordar sobre quem vendeu quanto.
import { imobiliariaEntityIdEmLote } from "./imobiliaria-do-cliente";
import { normalizarNome } from "./imobiliaria-match";
import type { createApoloAdminClient } from "./server";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

export type LinhaComImobiliaria = {
  entity_id: string;
  imobiliaria: null | string;
};

/**
 * entity_id do CLIENTE -> grafia canônica da imobiliária dele.
 *
 * Só entram linhas que têm alguma imobiliária escrita; quem não tem fica de fora do mapa (quem
 * chama decide o rótulo do vazio, que muda por tela: "Sem imobiliária", "—", nada).
 */
export async function grafiaCanonicaPorCliente(
  client: AdminClient,
  todas: LinhaComImobiliaria[],
): Promise<Map<string, string>> {
  const linhas = todas.filter((linha) => (linha.imobiliaria ?? "").trim());
  const resultado = new Map<string, string>();
  if (linhas.length === 0) return resultado;

  const imobPorVinculo = await imobiliariaEntityIdEmLote(
    client,
    linhas.map((linha) => linha.entity_id),
  );

  const { data: matches } = await client
    .from("apolo_imobiliaria_match")
    .select("nome_normalizado, entity_id")
    .not("entity_id", "is", null);

  const entidadePorTexto = new Map<string, string>();
  for (const match of (matches ?? []) as Array<{
    entity_id: string;
    nome_normalizado: string;
  }>) {
    entidadePorTexto.set(match.nome_normalizado, match.entity_id);
  }

  // Chave do grupo: a entidade da imobiliária, ou (na falta) o texto normalizado — que ao menos
  // junta as grafias que só diferem em acento e caixa.
  const chaveDe = (linha: LinhaComImobiliaria): string => {
    const texto = (linha.imobiliaria ?? "").trim();
    const entidade =
      imobPorVinculo.get(linha.entity_id) ?? entidadePorTexto.get(normalizarNome(texto));
    return entidade ? `ent:${entidade}` : `txt:${normalizarNome(texto)}`;
  };

  const contagem = new Map<string, Map<string, number>>();
  for (const linha of linhas) {
    const texto = (linha.imobiliaria ?? "").trim();
    const chave = chaveDe(linha);
    const porGrafia = contagem.get(chave) ?? new Map<string, number>();
    porGrafia.set(texto, (porGrafia.get(texto) ?? 0) + 1);
    contagem.set(chave, porGrafia);
  }

  const canonicaPorChave = new Map<string, string>();
  for (const [chave, porGrafia] of contagem) {
    let melhor = "";
    let melhorN = -1;
    for (const [grafia, n] of porGrafia) {
      const vence =
        n > melhorN ||
        (n === melhorN &&
          (grafia.length < melhor.length ||
            (grafia.length === melhor.length && grafia.localeCompare(melhor) < 0)));
      if (vence) {
        melhor = grafia;
        melhorN = n;
      }
    }
    canonicaPorChave.set(chave, melhor);
  }

  for (const linha of linhas) {
    const canonica = canonicaPorChave.get(chaveDe(linha));
    if (canonica) resultado.set(linha.entity_id, canonica);
  }

  return resultado;
}
