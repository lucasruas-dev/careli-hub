// AS UNIDADES DO PRODUTO QUE SÓ EXISTE NO PANTEON, NAS ABAS DA FICHA DO PORTAL.
//
// Por que existe (revisão da onda do Cecílio, 16/09/2026): as rotas da ficha passaram a aceitar o
// produto que só existe no Panteon (`propriosDoPortal`), mas continuavam lendo as unidades só do
// C2X (`loadApoloEnterpriseUnits`, `loadApoloEnterpriseVendas`). O produto cadastrado pelo próprio
// portal (decisão do Lucas, 16/09/2026: o C2X é somente leitura, unidade nova nasce em
// `hercules_unidades`) abria Unidades com a tabela vazia e o Resumo com o funil zerado, respondendo
// 200. Parecia produto sem estoque; era a leitura olhando para o lugar errado.
//
// O QUE ENTRA: os produtos PRÓPRIOS do recorte (o que o C2X não conhece) e, desde a D2 do Lucas
// (16/09/2026), os que têm DONO MARCADO (`operado_por`, como o Garden da Cecílio), cujo estoque passou
// a ser mantido aqui; e só as linhas VIVAS (`apenasVivas`: a linha antiga de um terreno que mudou de
// lugar não se conta duas vezes). O produto do C2X sem dono continua vindo do C2X, sem mistura. Quem
// decide a lista é `lidosDoPanteon` (proprios-do-portal.ts).
//
// ⚠️ O QUE NÃO ENTRA: comprador e imobiliária. A unidade do Panteon não guarda a movimentação do C2X;
// o preço e a matrícula saem de `hercules_unidades`, que é o que o espelho, a Venda e a correção de
// unidade (D2) já usam.
//
// ⚠️ E A SITUAÇÃO NÃO SAI DE `hercules_unidades.situacao` CRU (18/09/2026). Lucas: *"tem unidades que
// estão com reserva, proposta no hercules, que dentro de unidade do apolo não estão com o mesmo
// status"* · *"esses status tem que morar em um so lugar"*. O cadastro não sabe da reserva nem da
// proposta: o lote reservado na Venda aparecia "Disponível" na aba Unidades do portal. A situação vem
// da régua única (lib/hercules/situacao-da-unidade.ts), pelo id da linha. O cadastro continua valendo
// como a última palavra da régua (bloqueado no Apolo é bloqueado no Hércules), mas quem lê é ela.
import type { ApoloEnterpriseUnit } from "@/lib/apolo/empreendimentos";
import type { createApoloAdminClient } from "@/lib/apolo/server";
import { situacaoPelaRegua } from "@/lib/hercules/estoque-da-situacao";
import {
  baldeDaSituacao,
  rotuloDaSituacao,
  type SituacaoDasUnidades,
} from "@/lib/hercules/situacao-da-unidade";
import { apenasVivas } from "@/lib/hercules/unidade-viva";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

export type LinhaDaUnidadeDoPanteon = {
  area: null | number | string;
  codigo: null | string;
  enterprise_id: string;
  espelho_de: null | string;
  id: string;
  lote: null | string;
  /** A matrícula do cartório. Opcional no tipo só para quem monta a linha à mão (testes). */
  matricula?: null | string;
  preco_tabela: null | number | string;
  quadra: null | string;
  /**
   * O cadastro cru. ⚠️ NÃO É A SITUAÇÃO DA TELA: fica no tipo porque a leitura o traz, mas quem pinta
   * a unidade é a régua (`unidadeDoPanteonNaTela` com `situacoes`).
   */
  situacao: null | string;
};

/** Um mapa da régua sem unidade nenhuma: toda linha cai em `SITUACAO_FORA_DO_MAPA`, ocupada. */
const SEM_REGUA: SituacaoDasUnidades = {
  porCodigo: new Map(),
  porLinha: new Map(),
  porOrigemC2x: new Map(),
  terreno: () => undefined,
  unidades: [],
};

function numero(valor: null | number | string | undefined): null | number {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = typeof valor === "number" ? valor : Number(String(valor).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Uma linha de `hercules_unidades` no formato que a `UnidadesTab` do Apolo desenha, com a situação da
 * RÉGUA ÚNICA.
 *
 * O balde (cor do selo, filtro) é `baldeDaSituacao` e o texto é `rotuloDaSituacao`: a MESMA escrita do
 * ramo do C2X (`situacaoNaAbaUnidades`, lib/apolo/empreendimentos.ts), para o mesmo lote ter o mesmo
 * selo venha a linha de onde vier. Cor e palavra saem da mesma situação (o RVPA09 saiu âmbar escrito
 * "Disponível" em 28/08/2026 porque cada uma vinha de um lugar).
 *
 * ⚠️ SEM `situacoes`, A UNIDADE SAI OCUPADA (`SITUACAO_FORA_DO_MAPA`, hoje "Bloqueado"), e nunca pelo
 * cadastro cru. O parâmetro é opcional só porque a tela interna
 * (app/api/apolo/empreendimentos/unidades/route.ts) ainda chama com dois argumentos e escreve a
 * situação por cima. Quem esquecer de passar a régua vê tudo bloqueado, o erro barato, em vez de ver
 * o lote reservado como livre, o erro que vira processo.
 */
export function unidadeDoPanteonNaTela(
  linha: LinhaDaUnidadeDoPanteon,
  codigoDoProduto: string,
  situacoes?: SituacaoDasUnidades,
): ApoloEnterpriseUnit {
  const situacao = situacaoPelaRegua(situacoes ?? SEM_REGUA, { linhaId: linha.id });
  return {
    area: numero(linha.area),
    block: linha.quadra ?? null,
    bucket: baldeDaSituacao(situacao),
    code: String(linha.codigo ?? "").trim() || linha.id,
    enterpriseCode: codigoDoProduto,
    id: linha.id,
    kind: null,
    lot: linha.lote ?? null,
    movement: null,
    price: numero(linha.preco_tabela) ?? 0,
    // A matrícula é o que a coluna "Matrícula" da UnidadesTab mostra, e é um dos três campos que a
    // correção de unidade (D2) edita: sem ela aqui, a pessoa corrigia e a tabela continuava vazia.
    registration: String(linha.matricula ?? "").trim() || null,
    status: rotuloDaSituacao(situacao),
  };
}

/**
 * As unidades VIVAS destes empreendimentos, paginadas (o PostgREST corta em 1.000 sem avisar).
 * ⚠️ Erro lança: a rota responde indisponível, nunca "zero unidades".
 */
export async function lerUnidadesDoPanteon(
  admin: AdminClient,
  enterpriseIds: readonly string[],
): Promise<LinhaDaUnidadeDoPanteon[]> {
  const ids = [...new Set(enterpriseIds.map((id) => String(id).trim()).filter(Boolean))];
  if (ids.length === 0) return [];

  const PAGINA = 1000;
  const saida: LinhaDaUnidadeDoPanteon[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await admin
      .from("hercules_unidades")
      .select("id,codigo,quadra,lote,situacao,preco_tabela,area,matricula,enterprise_id,espelho_de")
      .eq("workspace_id", "careli")
      .in("enterprise_id", ids)
      .order("codigo", { ascending: true })
      .order("id", { ascending: true })
      .range(de, de + PAGINA - 1);
    if (error) throw new Error(error.message);
    const pagina = (data ?? []) as LinhaDaUnidadeDoPanteon[];
    saida.push(...pagina);
    if (pagina.length < PAGINA) break;
  }
  return apenasVivas(saida);
}
