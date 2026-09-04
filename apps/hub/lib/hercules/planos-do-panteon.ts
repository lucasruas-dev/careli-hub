// OS PLANOS COMERCIAIS CADASTRADOS NO PANTEON — a segunda fonte do simulador.
//
// Lucas (04/09/2026), vendo o simulador abrir vazio no empreendimento de teste: *"está dando erro,
// não abriu a simulação"* e, depois do diagnóstico, *"cria então os planos, para teste"*.
//
// ⚠️ O SIMULADOR SÓ CONHECIA O C2X (`lerPlanosDoC2x`, que consulta `commercial_plans` por `code`
// no MySQL do legado). Empreendimento que existe só no Panteon — o de teste, e qualquer produto
// novo antes de ser cadastrado lá — chegava com a lista vazia, e sem plano não há prazo, não há
// taxa e não há o que simular.
//
// ⚠️ O PANTEON GANHA DO LEGADO quando os dois têm plano para o mesmo empreendimento. É a
// precedência certa pelo mesmo motivo que `apolo_enterprise_settings` manda na entrada mínima: o
// cadastro daqui é o que o time edita, e um cadastro que não vence não é cadastro. Hoje a questão
// é teórica — `temis_planos` está vazia para os 24 empreendimentos que têm plano no C2X.
//
// ⚠️ A TABELA JÁ EXISTIA, vazia desde 01/09 (migration 0120). Ela nasceu com exatamente os campos
// de `PlanoComercial`, e é onde a tela de cadastro de planos vai gravar quando existir. Escrever
// uma tabela nova aqui criaria a segunda casa do mesmo dado.

import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  ConvencaoJuros,
  IndiceCorrecao,
  PeriodicidadeJuros,
  PlanoComercial,
  SistemaAmortizacao,
  SlotDaPa,
} from "@/lib/apolo/planos-comerciais";
import type { PlanosDoEmpreendimento } from "@/lib/apolo/planos-comerciais-c2x";

type Cliente = Pick<SupabaseClient, "from">;

type LinhaDoPlano = {
  ativo: boolean;
  enterprise_id: string;
  entrada_percentual: null | number | string;
  indice_correcao: null | string;
  juros_convencao: null | string;
  juros_periodicidade: null | string;
  juros_taxa: null | number | string;
  nome: string;
  ordem: null | number;
  parcelas: number;
  sistema_amortizacao: null | string;
  slot: null | string;
};

/** `numeric` do Postgres chega como STRING no PostgREST — somar sem converter concatena. */
function numero(valor: null | number | string | undefined): null | number {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

const SISTEMAS: SistemaAmortizacao[] = ["price", "sac", "sacoc"];
const INDICES: IndiceCorrecao[] = [
  "IGPM_ANUAL",
  "INCC_M_MENSAL",
  "IPCA_ANUAL",
  "IPCA_MENSAL",
  "SEM_CORRECAO",
];
const SLOTS: SlotDaPa[] = ["avista", "curto", "investidor", "normal"];

/**
 * Converte a linha do banco no plano que a conta usa.
 *
 * ⚠️ CADA UNIÃO É CONFERIDA, e o que não bater cai no padrão da casa. As colunas são `text` com
 * default, não enum: um `sistema_amortizacao` digitado como "SACOC" em maiúscula ou "sacooc" com
 * dois "o" (como o C2X escreve) faria a matemática cair no `else` de `calcularParcela` e imprimir
 * Price num contrato SACOC — o erro mais caro que esta tela pode cometer.
 */
function comoPlano(linha: LinhaDoPlano): PlanoComercial {
  const sistema = String(linha.sistema_amortizacao ?? "").trim().toLowerCase();
  const indice = String(linha.indice_correcao ?? "").trim().toUpperCase();
  const slot = String(linha.slot ?? "").trim().toLowerCase();
  const periodicidade = String(linha.juros_periodicidade ?? "").trim().toLowerCase();
  const convencao = String(linha.juros_convencao ?? "").trim().toLowerCase();

  return {
    entradaPercentual: numero(linha.entrada_percentual) ?? 0,
    indiceCorrecao: (INDICES as string[]).includes(indice)
      ? (indice as IndiceCorrecao)
      : "SEM_CORRECAO",
    jurosConvencao: (convencao === "proporcional" ? "proporcional" : "equivalente") as ConvencaoJuros,
    jurosPeriodicidade: (periodicidade === "mensal" ? "mensal" : "anual") as PeriodicidadeJuros,
    jurosTaxa: numero(linha.juros_taxa),
    nome: String(linha.nome ?? "").trim(),
    parcelas: Math.max(0, Math.trunc(Number(linha.parcelas) || 0)),
    // ⚠️ SACOC É O PADRÃO DA CASA, e não Price: são 21 dos 24 empreendimentos. Cair no mais raro
    // por engano de digitação anunciaria uma parcela que o boleto não vai cobrar.
    sistemaAmortizacao: ((SISTEMAS as string[]).includes(sistema)
      ? sistema
      : "sacoc") as SistemaAmortizacao,
    slot: (SLOTS as string[]).includes(slot) ? (slot as SlotDaPa) : null,
  };
}

/**
 * Os planos cadastrados no Panteon para estes empreendimentos (ids do C2X).
 *
 * Devolve no mesmo formato de `lerPlanosDoC2x` para os dois poderem ser mesclados sem tradutor no
 * meio. `code` sai vazio: aqui a chave é o id, e quem consome a lista final usa os planos, não o
 * código.
 */
export async function lerPlanosDoPanteon(
  cliente: Cliente,
  enterpriseIds: string[],
): Promise<PlanosDoEmpreendimento[]> {
  const ids = [...new Set(enterpriseIds.map((id) => String(id).trim()).filter(Boolean))];
  if (ids.length === 0) return [];

  const linhas: LinhaDoPlano[] = [];
  // ⚠️ EM LOTES DE 100: `.in()` monta a lista na URL, e um escopo grande estoura o limite do
  // PostgREST sem erro claro.
  for (let de = 0; de < ids.length; de += 100) {
    const { data, error } = await cliente
      .from("temis_planos")
      .select(
        "enterprise_id,nome,parcelas,entrada_percentual,juros_taxa,juros_periodicidade,juros_convencao,indice_correcao,sistema_amortizacao,slot,ativo,ordem",
      )
      .eq("workspace_id", "careli")
      .eq("ativo", true)
      .in("enterprise_id", ids.slice(de, de + 100))
      .order("ordem", { ascending: true });

    if (error) throw new Error(error.message);
    linhas.push(...((data ?? []) as LinhaDoPlano[]));
  }

  const porEmpreendimento = new Map<string, PlanosDoEmpreendimento>();
  for (const linha of linhas) {
    const id = String(linha.enterprise_id);
    let alvo = porEmpreendimento.get(id);
    if (!alvo) {
      alvo = { code: "", enterpriseId: id, planos: [], tabelaDoEmpreendimento: null };
      porEmpreendimento.set(id, alvo);
    }
    alvo.planos.push(comoPlano(linha));
  }

  return [...porEmpreendimento.values()];
}

/**
 * Une as duas fontes: o que está no Panteon vence, o resto vem do legado.
 *
 * ⚠️ A UNIÃO É POR EMPREENDIMENTO, e não plano a plano. Misturar os dois lados num empreendimento
 * daria uma lista com o mesmo "PLANO NORMAL" duas vezes, com prazos diferentes, e o simulador
 * resolve plano por NOME — a escolha cairia na ordem do array, que é a mais silenciosa das
 * escolhas erradas.
 */
export function planosPreferindoOPanteon(
  doC2x: PlanosDoEmpreendimento[],
  doPanteon: PlanosDoEmpreendimento[],
): PlanosDoEmpreendimento[] {
  const cadastrados = new Set(doPanteon.filter((e) => e.planos.length > 0).map((e) => e.enterpriseId));
  return [...doPanteon.filter((e) => e.planos.length > 0), ...doC2x.filter((e) => !cadastrados.has(e.enterpriseId))];
}
