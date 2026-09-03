// O ID DO PAI NO PAINEL DE PRODUTOS — e como ele vira ids do C2X SEM ampliar o escopo.
//
// A aba Produtos do Hércules lista um PAI do cadastro do Panteon por linha, e o "Ver mais" abre a
// Vendas daquele produto. Só que a Vendas lê o C2X por CÓDIGO e a sessão autoriza IDS do C2X; o
// pai é um uuid do Panteon, que nenhum dos dois lados conhece. Este arquivo é a ponte, num lugar
// só, para o painel (que soma os cards) e a rota de Vendas (que lê o funil) nunca discordarem
// sobre o que "Vale do Ouro" significa para esta sessão.
//
// Lucas (02/09/2026): *"o espelho sempre será o pai (...) os filhos podem ter visões segmentadas"*.
//
// ⚠️ O ESPELHO ESTÁ PARADO. O VLO (35) no C2X ainda mostra 118 unidades "em negociação" que já
// viraram venda nos filhos (VOC 37, VOL 36, VOR 41). Por isso, quando o pai tem filho autorizado,
// o pai É os filhos e o espelho fica de fora. O espelho só responde quando é a ÚNICA coisa que a
// sessão alcança (sessão antiga que carrega o 35 e nenhum filho): aí é o único número que ela
// tem direito de ver, e zero seria mentira maior.
//
// ⚠️ SÓ REDUZ, NUNCA AMPLIA. `permitidos` é a lista que `idsDaSessao` já expandiu (ids reais +
// grupos); tudo o que sai daqui é subconjunto dela. Pedido que não alcança nada volta VAZIO, e a
// rota responde 404 — nunca cai na visão consolidada.
import type { LinhaDoCadastro } from "./cadastro";

export const PREFIXO_DO_PAI = "pai:";

/** O id que o painel devolve para um pai: "pai:<uuid do cadastro>". */
export function idDoPainelDoPai(uuid: string): string {
  return `${PREFIXO_DO_PAI}${uuid}`;
}

/** O pedido é um pai do cadastro (e não um id do C2X ou do catálogo)? */
export function ehIdDoPai(id: null | string | undefined): boolean {
  return String(id ?? "").trim().startsWith(PREFIXO_DO_PAI);
}

/**
 * Os filhos de cada pai, na ordem do cadastro (ordem, depois código). Índice único para o painel
 * e o expansor percorrerem a mesma lista na mesma ordem — a ordem aparece na tela ("LBF + LBR +
 * LBP") e a chave de cache da Vendas depende dela.
 */
export function filhosDoCadastro(
  cadastro: LinhaDoCadastro[],
): Map<string, LinhaDoCadastro[]> {
  const filhosDe = new Map<string, LinhaDoCadastro[]>();

  for (const linha of cadastro) {
    if (linha.paiId === null) continue;
    const lista = filhosDe.get(linha.paiId) ?? [];
    lista.push(linha);
    filhosDe.set(linha.paiId, lista);
  }

  for (const lista of filhosDe.values()) {
    lista.sort((a, b) => a.ordem - b.ordem || a.codigo.localeCompare(b.codigo));
  }

  return filhosDe;
}

export type AlcanceDoPai = {
  /** O espelho do pai, quando ele responde SOZINHO (nenhum filho autorizado). */
  espelho: null | string;
  /** Os filhos que a sessão autoriza, na ordem do cadastro. */
  filhos: LinhaDoCadastro[];
};

/**
 * O que, deste pai, a sessão alcança. É A regra — o painel soma por ela e a Vendas lê por ela.
 *
 *   • algum filho autorizado → esses filhos (e SÓ esses: quem tem a gleba do Fernando não vê a
 *     do Raposo, mesmo dentro do mesmo pai);
 *   • nenhum filho autorizado, espelho autorizado → o espelho;
 *   • nada autorizado → nada (o pai não aparece).
 */
export function alcanceDoPai(
  pai: LinhaDoCadastro,
  filhos: LinhaDoCadastro[],
  permitidos: Set<string>,
): AlcanceDoPai {
  const autorizados = filhos.filter(
    (filho) => filho.c2xEnterpriseId !== null && permitidos.has(filho.c2xEnterpriseId),
  );

  if (autorizados.length > 0) return { espelho: null, filhos: autorizados };

  const espelho = pai.c2xEnterpriseId;
  if (espelho !== null && permitidos.has(espelho)) return { espelho, filhos: [] };

  return { espelho: null, filhos: [] };
}

/**
 * Traduz o `emp` que a tela mandou em ids REAIS do C2X, dentro do escopo.
 *
 *   • "pai:<uuid>" → os c2x ids dos filhos autorizados, ou o do próprio pai quando ele não tem
 *     filho (Garden) ou nenhum filho é autorizado;
 *   • qualquer outro valor → [id] se autorizado, [] se não.
 *
 * Uuid que não é PAI (é filho, ou não existe) devolve vazio: filho não é produto, e um uuid
 * inventado na URL não pode virar leitura.
 */
export function expandirIdDoPainel(
  id: null | string | undefined,
  cadastro: LinhaDoCadastro[],
  permitidos: Set<string>,
): string[] {
  const alvo = String(id ?? "").trim();
  if (!alvo) return [];

  if (!alvo.startsWith(PREFIXO_DO_PAI)) {
    return permitidos.has(alvo) ? [alvo] : [];
  }

  const uuid = alvo.slice(PREFIXO_DO_PAI.length).trim();
  const pai = cadastro.find((linha) => linha.id === uuid && linha.paiId === null);
  if (!pai) return [];

  const alcance = alcanceDoPai(pai, filhosDoCadastro(cadastro).get(pai.id) ?? [], permitidos);

  if (alcance.filhos.length > 0) {
    return alcance.filhos
      .map((filho) => filho.c2xEnterpriseId)
      .filter((c2xId): c2xId is string => c2xId !== null);
  }

  return alcance.espelho ? [alcance.espelho] : [];
}

/**
 * Ids do C2X → CÓDIGOS (VOC, LBF), pelo catálogo. É o que a leitura de vendas recebe.
 *
 * ⚠️ NÃO usa `codigosDaSessao`: aquela filtra o pedido contra `sessao.enterpriseIds` CRU, e uma
 * sessão que carrega "group:Lagoa Bonita" não tem o "33" lá — o filho autorizado pela expansão
 * do grupo voltaria vazio. Aqui os ids JÁ passaram pelo escopo expandido; só falta o nome.
 * Quem chama ainda cruza o resultado com os códigos autorizados (fail-closed em duas camadas).
 */
export function codigosDosIdsDoC2x(
  catalogo: Array<{ codes: string[]; stageIds: string[] }>,
  ids: string[],
): string[] {
  const alvo = new Set(ids.map((id) => String(id).trim()).filter(Boolean));
  const codes: string[] = [];

  for (const emp of catalogo) {
    emp.stageIds.forEach((stageId, i) => {
      if (!alvo.has(String(stageId).trim())) return;
      const code = emp.codes[i];
      if (code) codes.push(String(code).trim().toUpperCase());
    });
  }

  return [...new Set(codes.filter(Boolean))];
}
