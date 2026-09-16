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
// a situação, o preço e a matrícula saem de `hercules_unidades`, que é o que o espelho, a Venda e a
// correção de unidade (D2) já usam.
import type { ApoloEnterpriseUnit } from "@/lib/apolo/empreendimentos";
import { rotuloDoBalde } from "@/lib/apolo/balde-da-unidade";
import type { createApoloAdminClient } from "@/lib/apolo/server";
import type { ApoloVendaStage } from "@/lib/apolo/vendas";
import { situacaoConhecida } from "@/lib/hercules/cores-de-situacao";
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
  situacao: null | string;
};

function numero(valor: null | number | string | undefined): null | number {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = typeof valor === "number" ? valor : Number(String(valor).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Uma linha de `hercules_unidades` no formato que a `UnidadesTab` do Apolo desenha. */
export function unidadeDoPanteonNaTela(
  linha: LinhaDaUnidadeDoPanteon,
  codigoDoProduto: string,
): ApoloEnterpriseUnit {
  const bucket = situacaoConhecida(linha.situacao);
  return {
    area: numero(linha.area),
    block: linha.quadra ?? null,
    bucket,
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
    status: rotuloDoBalde(bucket),
  };
}

/**
 * O estágio do funil (o `stage` que o Resumo conta) de uma unidade do Panteon.
 *
 * A unidade do Panteon só sabe a SITUAÇÃO, não a etapa do contrato: `vendido` conta como faturada
 * (a venda acabou), `negociacao` como proposta, `reservado` como reserva. Bloqueada e disponível não
 * são venda e ficam em `disponivel`, como no C2X (lá a bloqueada também sai com estágio disponível).
 */
export function estagioDaUnidadeDoPanteon(situacao: null | string): ApoloVendaStage {
  const balde = situacaoConhecida(situacao);
  if (balde === "vendido") return "faturado";
  if (balde === "negociacao") return "proposta";
  if (balde === "reservado") return "reservado";
  return "disponivel";
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
