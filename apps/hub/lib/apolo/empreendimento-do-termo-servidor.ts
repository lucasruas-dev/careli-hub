// O RESOLVEDOR DE TERMO, COM AS FONTES DO SERVIDOR (PAN-124 F6): a régua do cadastro em cache
// (renovada pelo carimbo) e os nomes do C2X (cache de 5 min do painel). Ver ./empreendimento-do-termo.
import { reguaEmCache } from "@/lib/hercules/cadastro-em-cache";

import { type EmpreendimentoDoTermo, resolverTermoDeEmpreendimento } from "./empreendimento-do-termo";
import { carregarNomes } from "./painel-coordenador";

/**
 * Os ids do empreendimento que o termo nomeia, ou `null`: nada casou, ou as duas fontes estão fora.
 * Em `null`, quem chama volta ao filtro por texto, como antes da F6.
 */
export async function resolverTermoNoServidor(termo: unknown): Promise<EmpreendimentoDoTermo | null> {
  const [regua, nomesDoC2x] = await Promise.all([
    reguaEmCache().catch(() => null),
    carregarNomes().catch(() => new Map<number, { code: string; name: string }>()),
  ]);
  if (!regua && nomesDoC2x.size === 0) return null;
  return resolverTermoDeEmpreendimento(termo, { nomesDoC2x, regua });
}

/**
 * O filtro da esteira (`apolo_esteira`) para um termo de empreendimento: pelos IDS quando o termo
 * resolve (`enterprise_id in (...)`, com o grupo inteiro), pelo TEXTO como antes quando não resolve
 * (`empreendimento ilike '%termo%'`, ou o termo cru com `contem: false`, que era "igual sem caixa").
 */
export async function filtroDaEsteiraPeloTermo(
  termo: string,
  { contem = true }: { contem?: boolean } = {},
): Promise<{ ids: string[]; tipo: "ids" } | { padrao: string; tipo: "texto" }> {
  const resolvido = await resolverTermoNoServidor(termo).catch(() => null);
  if (resolvido && resolvido.ids.length > 0) return { ids: resolvido.ids, tipo: "ids" };
  // A reserva é IDÊNTICA à de antes: `%termo%` onde era "contém", o termo cru onde era "igual sem caixa".
  return { padrao: contem ? `%${termo.trim()}%` : termo.trim(), tipo: "texto" };
}

/** Aplica o filtro de `filtroDaEsteiraPeloTermo` a uma consulta da esteira. */
export function aplicarFiltroDaEsteira<Q>(
  consulta: Q,
  filtro: Awaited<ReturnType<typeof filtroDaEsteiraPeloTermo>>,
): Q {
  const c = consulta as unknown as {
    ilike(coluna: string, padrao: string): Q;
    in(coluna: string, valores: readonly string[]): Q;
  };
  return filtro.tipo === "ids" ? c.in("enterprise_id", filtro.ids) : c.ilike("empreendimento", filtro.padrao);
}
