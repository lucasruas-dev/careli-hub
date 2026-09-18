import type { SupabaseClient } from "@supabase/supabase-js";

import type { EmpreendimentoDoCatalogo } from "@/lib/apolo/catalogo-empreendimentos";
import type { ApoloEnterpriseScenario } from "@/lib/apolo/empreendimentos";
import { cenarioVazio } from "@/lib/apolo/incorporador/painel-de-produtos";
import type { ApoloVendaStage } from "@/lib/apolo/vendas";
import { EXCLUDED_ENTERPRISE_CODES } from "@/lib/guardian/c2x-analytics";

import {
  acharUnidade,
  baldeDaSituacao,
  lerSituacaoDasUnidades,
  type SituacaoDasUnidades,
  type SituacaoDaUnidade,
  situacaoDoTerreno,
} from "./situacao-da-unidade";

// O ESTOQUE CONTADO PELA SITUAÇÃO: os cards do painel de Produtos, a lista de produtos e o funil do
// Resumo, todos pela MESMA conta. A TelaVendas do portal recebe a situação já escrita pela leitura
// das vendas (`estagioPelaSituacao`, lib/apolo/vendas.ts), que o teste de
// lib/apolo/incorporador/vendas-resumo.test.ts prende a `estagioDaSituacao`, daqui.
//
// Lucas (18/09/2026): *"esses status tem que morar em um so lugar"* · *"quero é dentro do panteon tem
// que ter o mesmo status"*.
//
// ⚠️ POR QUE ESTE ARQUIVO EXISTE. A régua (situacao-da-unidade.ts) já era uma só, mas cada rota que
// CONTA tinha a sua cópia do resto: o painel de Produtos e a lista de produtos tinham cada uma o seu
// `baldeDoEstoque`, o seu `contarEstoque` e o seu `SITUACAO_FORA_DO_MAPA`, e o Resumo tinha o seu
// `estagioNoFunil`. Cópia é o lugar onde a próxima mudança acontece só de um lado: o mesmo lote com
// um número no card e outro na faixa, que é a queixa do Lucas em outra roupa.
//
// ⚠️ O QUE ESTE ARQUIVO NÃO DECIDE: se a unidade está livre. Quem decide é `situacaoDoTerreno`, e o
// agrupamento em cinco é `baldeDaSituacao`. Aqui só se CONTA o que eles disseram.

type Cenario = ApoloEnterpriseScenario;

/**
 * A situação de uma unidade que a régua não devolveu (nasceu entre duas leituras, ou o sync ainda
 * não a trouxe): a que a própria régua dá a quem não se conhece, hoje "bloqueada".
 *
 * ⚠️ CALCULADA, E NÃO ESCRITA À MÃO, para mudar junto se a régua mudar de ideia. E NUNCA LIVRE: é a
 * unidade que ninguém conseguiu ler, e oferecer lote que não se leu é convidar a segunda venda. O
 * teste deste arquivo trava isso.
 */
export const SITUACAO_FORA_DO_MAPA: SituacaoDaUnidade = situacaoDoTerreno({
  cadastro: null,
  propostasVivas: [],
  reservada: false,
});

/**
 * A situação de uma unidade pelas chaves que a tela tiver, na ORDEM ÚNICA de `acharUnidade` (linha
 * do Panteon, id do legado, código). Chave que não casa sai `SITUACAO_FORA_DO_MAPA`, ocupada.
 */
export function situacaoPelaRegua(
  situacoes: SituacaoDasUnidades,
  chaves: { codigo?: null | string; linhaId?: null | string; origemC2x?: null | number | string },
): SituacaoDaUnidade {
  return acharUnidade(situacoes, chaves)?.situacao ?? SITUACAO_FORA_DO_MAPA;
}

/**
 * O estágio do funil (o `stage` que o Resumo conta, e que a TelaVendas recebe da leitura das
 * vendas) de uma situação.
 *
 * ⚠️ QUEM DECIDE É O BALDE. O estágio só REFINA dentro do balde, e só onde o balde tem mais de uma
 * etapa (negociação: proposta, contrato, assinatura). Assim o funil nunca discorda dos cards:
 *   • `bloqueado` sai "disponivel", porque o funil do C2X não tem estágio de bloqueio. Quem precisa
 *     separar a bloqueada (a TelaVendas) olha o balde, e o Resumo não mostra esse número;
 *   • `reservado` junta a reserva do processo e a "reservada" do cadastro;
 *   • `vendido` é "faturado": a "vendida" sem proposta viva é venda que acabou.
 * Situação que a régua um dia inventar cai no balde que `baldeDaSituacao` der a ela, nunca em livre
 * por esquecimento daqui.
 */
export function estagioDaSituacao(situacao: SituacaoDaUnidade): ApoloVendaStage {
  switch (baldeDaSituacao(situacao)) {
    case "disponivel":
    case "bloqueado":
      return "disponivel";
    case "reservado":
      return "reservado";
    case "negociacao":
      return situacao === "contrato" || situacao === "assinatura" ? situacao : "proposta";
    case "vendido":
      return "faturado";
  }
}

// ── A CONTAGEM ──────────────────────────────────────────────────────────────

/** O mínimo de uma linha de `hercules_unidades` para contar: onde ela conta e quanto vale. */
export type LinhaDoEstoque = {
  enterprise_id: number | string;
  id: string;
  preco_tabela: null | number | string;
};

function valorDe(preco: null | number | string): number {
  const n = typeof preco === "number" ? preco : Number(preco ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * O estoque de cada empreendimento, nos cinco baldes de `baldeDaSituacao` mais o total.
 *
 * ⚠️ QUANTIDADE E PREÇO SÃO DA LINHA; A SITUAÇÃO É DO TERRENO. Cada linha de `hercules_unidades`
 * conta no empreendimento dela, como sempre contou (o espelho que responde sozinho continua com as
 * linhas dele; quem não soma o pai com os filhos é `montarPainelDeProdutos`). O balde sai de
 * `porLinha`, que responde pela viva e pela antiga do mesmo lote com a mesma situação.
 *
 * ⚠️ UNIDADE FORA DO MAPA CONTA COMO OCUPADA (bloqueada), e entra no total: sumir com ela diminuiria
 * o estoque, e contá-la livre ofereceria o que não se leu.
 */
export function contarEstoque(
  linhas: readonly LinhaDoEstoque[],
  situacoes: SituacaoDasUnidades,
): Map<string, Cenario> {
  const porEmpreendimento = new Map<string, Cenario>();

  for (const linha of linhas) {
    const id = String(linha.enterprise_id).trim();
    const cenario = porEmpreendimento.get(id) ?? cenarioVazio();
    const balde = baldeDaSituacao(situacaoPelaRegua(situacoes, { linhaId: linha.id }));
    const valor = valorDe(linha.preco_tabela);

    cenario[balde].units += 1;
    cenario[balde].value += valor;
    cenario.total.units += 1;
    cenario.total.value += valor;

    porEmpreendimento.set(id, cenario);
  }

  return porEmpreendimento;
}

const PAGINA = 1000;

async function lerLinhasDoEstoque(client: SupabaseClient, ids: readonly string[]): Promise<LinhaDoEstoque[]> {
  const linhas: LinhaDoEstoque[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await client
      .from("hercules_unidades")
      .select("id,enterprise_id,preco_tabela")
      .eq("workspace_id", "careli")
      .in("enterprise_id", [...ids])
      .order("id", { ascending: true })
      .range(de, de + PAGINA - 1);
    if (error) throw new Error(error.message);
    linhas.push(...((data ?? []) as LinhaDoEstoque[]));
    if ((data?.length ?? 0) < PAGINA) break;
  }
  return linhas;
}

/**
 * O estoque dos empreendimentos pedidos, lido e contado: as linhas (quantidade e preço) e a régua,
 * em paralelo, e `contarEstoque` por cima.
 *
 * ⚠️ UMA CHAMADA À RÉGUA PARA TODOS OS EMPREENDIMENTOS, e não uma por produto: a régua lê as
 * propostas vivas e as reservas do banco inteiro, e N chamadas seriam N vezes essa conta. Quem chama
 * junta os ids da requisição inteira e chama isto uma vez.
 *
 * ⚠️ PAGINA. O PostgREST corta em 1.000 linhas SEM ERRO: sem paginar, o card mostraria um estoque
 * truncado que parece certo.
 *
 * ⚠️ FALHA LANÇA, e nunca devolve mapa vazio: quem chama precisa saber que não leu, para zerar e
 * avisar (painel) ou deixar o card sem estoque (lista). Zero afirmado seria mentira; livre, pior.
 *
 * `enterpriseIds` são os ids do C2X que `hercules_unidades.enterprise_id` guarda. O id sintético do
 * agrupamento do Apolo ("group:…") fica de fora: nenhuma unidade o guarda.
 */
export async function lerEstoquePelaRegua(
  client: SupabaseClient,
  enterpriseIds: readonly string[],
): Promise<Map<string, Cenario>> {
  const pedidos = [
    ...new Set(
      enterpriseIds.map((id) => String(id).trim()).filter((id) => id && !id.toLowerCase().startsWith("group:")),
    ),
  ];
  if (pedidos.length === 0) return new Map();

  const [linhas, situacoes] = await Promise.all([
    lerLinhasDoEstoque(client, pedidos),
    lerSituacaoDasUnidades(client, pedidos),
  ]);
  return contarEstoque(linhas, situacoes);
}

// ── OS IDS QUE A RÉGUA ENTENDE ──────────────────────────────────────────────

/**
 * Os ids do C2X (os que `hercules_unidades.enterprise_id` guarda) destes códigos, pelo catálogo:
 * `codes[i]` é a sigla de `stageIds[i]`. Devolve também o código que o catálogo não achou.
 *
 * Existe para as telas que recebem o recorte em CÓDIGOS (o Resumo da ficha) poderem perguntar à
 * régua, que fala em ids. Era privada da rota do Resumo; mora aqui para a próxima tela não escrever
 * a dela.
 *
 * ⚠️ CÓDIGO QUE NINGUÉM TRADUZ É PARA A ROTA RECUSAR (503), e não para seguir sem ele: a unidade
 * daquele código sairia fora do mapa, e a tela contaria "0" onde há venda.
 *
 * ⚠️ OS CÓDIGOS QUE O FUNIL NUNCA CONTOU CONTINUAM FORA (`EXCLUDED_ENTERPRISE_CODES`: teste,
 * laboratório e o espelho do Lagoa Bonita), a mesma lista que as leituras do C2X pulam.
 */
export function idsDosCodigos(
  catalogo: readonly Pick<EmpreendimentoDoCatalogo, "codes" | "stageIds">[],
  codes: readonly string[],
): { faltando: string[]; ids: string[] } {
  const chave = (code: string) => String(code ?? "").trim().toUpperCase();
  const excluidos = new Set(EXCLUDED_ENTERPRISE_CODES.map(chave));
  const alvo = new Set(codes.map(chave).filter((code) => code && !excluidos.has(code)));

  const achados = new Set<string>();
  const ids: string[] = [];
  for (const emp of catalogo) {
    emp.codes.forEach((code, indice) => {
      const id = String(emp.stageIds[indice] ?? "").trim();
      if (!id || !alvo.has(chave(code))) return;
      achados.add(chave(code));
      ids.push(id);
    });
  }

  return { faltando: [...alvo].filter((code) => !achados.has(code)), ids };
}
