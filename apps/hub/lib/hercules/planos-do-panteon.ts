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
import { INDICES as ROTULOS_DE_INDICE } from "@/lib/apolo/planos-comerciais";
import type { FaixaDePrazo } from "@/lib/hercules/premissa-do-prazo";
import type { PlanosDoEmpreendimento } from "@/lib/apolo/planos-comerciais-c2x";
import { ehColunaDaRessalvaAusente, limparRessalva } from "@/lib/temis/planos";

type Cliente = Pick<SupabaseClient, "from">;

/**
 * Uma linha de `temis_planos`, como as leituras do Panteon a pedem.
 *
 * ⚠️ OS OPCIONAIS SÃO O QUE UMA LEITURA PODE NÃO TER PEDIDO: a aba de políticas do portal não pede
 * `juros_convencao`, e `ressalva` não existe enquanto a migration 0168 não roda. A normalização
 * trata ausente como o padrão da casa, nunca como erro.
 */
export type LinhaDoPlano = {
  anuais_quantidade?: null | number | string;
  anuais_valor?: null | number | string;
  ativo?: boolean;
  categoria_id?: null | string;
  enterprise_id: string;
  entrada_percentual: null | number | string;
  id?: null | string;
  indice_correcao: null | string;
  juros_convencao?: null | string;
  juros_periodicidade: null | string;
  juros_taxa: null | number | string;
  nome: null | string;
  ordem: null | number;
  parcelas: null | number | string;
  /** Ausente enquanto a migration 0168 não roda. */
  ressalva?: null | string;
  sistema_amortizacao: null | string;
  slot: null | string;
};

/**
 * O plano do Panteon normalizado: o `PlanoComercial` que a conta usa, mais o que só o cadastro daqui
 * tem.
 *
 * ⚠️ UM TIPO SÓ PARA A MESA E PARA A ABA DE POLÍTICAS DO PORTAL. Até 16/09/2026 a aba tinha a sua
 * própria conversão da linha (`planoDaLinha`), "leve" e com os mesmos tratamentos: é exatamente o
 * tipo de cópia que discorda da original no primeiro ajuste. Agora as duas leem daqui.
 */
export type PlanoDoPanteon = PlanoComercial & {
  /** As anuais do plano (0138). Andam em par: meia configuração não é anual nenhuma. */
  anuaisQuantidade: null | number;
  anuaisValor: null | number;
  /** `temis_planos.id`. Nulo só quando a leitura não pediu a coluna. */
  id: null | string;
  /**
   * O código do índice COMO ESTÁ NO CADASTRO, mesmo quando este build ainda não o conhece.
   *
   * ⚠️ NÃO É O QUE A CONTA USA. `indiceCorrecao` cai em SEM_CORRECAO para código desconhecido (a
   * conta não sabe corrigir pelo que não conhece); a TELA mostra este aqui, porque um "TR_ANUAL"
   * estranho é melhor do que um "sem correção" falso. `temis_indices` (0154) pode estar à frente do
   * build.
   */
  indiceDoCadastro: string;
  ordem: number;
  /** A ressalva de disponibilidade (0168), já limpa. Nula = sem etiqueta. */
  ressalva: null | string;
};

/** `numeric` do Postgres chega como STRING no PostgREST — somar sem converter concatena. */
function numero(valor: null | number | string | undefined): null | number {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

const SISTEMAS: SistemaAmortizacao[] = ["price", "sac", "sacoc"];
/**
 * ⚠️ DERIVADA, E NAO COPIADA. Ate 13/09/2026 esta lista era escrita a mao aqui, e era uma de CINCO
 * copias da mesma verdade no repo (mais o CHECK do banco). Elas ja discordavam entre si. A fonte e
 * a tabela `temis_indices` (migration 0154); `INDICES` em `planos-comerciais.ts` e o espelho dela
 * em tempo de compilacao, e e dele que esta lista sai agora.
 */
const INDICES = Object.keys(ROTULOS_DE_INDICE) as IndiceCorrecao[];
const SLOTS: SlotDaPa[] = ["avista", "curto", "investidor", "normal"];

/**
 * Converte a linha do banco no plano que a conta usa.
 *
 * ⚠️ CADA UNIÃO É CONFERIDA, e o que não bater cai no padrão da casa. As colunas são `text` com
 * default, não enum: um `sistema_amortizacao` digitado como "SACOC" em maiúscula ou "sacooc" com
 * dois "o" (como o C2X escreve) faria a matemática cair no `else` de `calcularParcela` e imprimir
 * Price num contrato SACOC — o erro mais caro que esta tela pode cometer.
 *
 * ⚠️ EXPORTADA (16/09/2026): é a normalização ÚNICA da linha de `temis_planos`, usada pela Mesa
 * (`lerPlanosDoPanteon`) e pela aba de políticas do portal (`politicas-do-produto.ts`).
 */
export function comoPlano(linha: LinhaDoPlano): PlanoDoPanteon {
  const sistema = String(linha.sistema_amortizacao ?? "")
    .trim()
    .toLowerCase();
  const indice = String(linha.indice_correcao ?? "")
    .trim()
    .toUpperCase();
  const slot = String(linha.slot ?? "")
    .trim()
    .toLowerCase();
  const periodicidade = String(linha.juros_periodicidade ?? "")
    .trim()
    .toLowerCase();
  const convencao = String(linha.juros_convencao ?? "")
    .trim()
    .toLowerCase();
  const anuaisQuantidade = numero(linha.anuais_quantidade);
  const anuaisValor = numero(linha.anuais_valor);
  const ordem = Number(linha.ordem);

  return {
    // ⚠️ AS ANUAIS ANDAM EM PAR (CHECK da 0138): meia configuração não é anual nenhuma.
    anuaisQuantidade: anuaisQuantidade && anuaisValor ? anuaisQuantidade : null,
    anuaisValor: anuaisQuantidade && anuaisValor ? anuaisValor : null,
    categoriaId: String(linha.categoria_id ?? "").trim() || null,
    enterpriseId: String(linha.enterprise_id ?? "").trim() || null,
    entradaPercentual: numero(linha.entrada_percentual) ?? 0,
    id: String(linha.id ?? "").trim() || null,
    indiceCorrecao: (INDICES as string[]).includes(indice)
      ? (indice as IndiceCorrecao)
      : "SEM_CORRECAO",
    indiceDoCadastro: indice || "SEM_CORRECAO",
    jurosConvencao: (convencao === "proporcional"
      ? "proporcional"
      : "equivalente") as ConvencaoJuros,
    jurosPeriodicidade: (periodicidade === "mensal"
      ? "mensal"
      : "anual") as PeriodicidadeJuros,
    jurosTaxa: numero(linha.juros_taxa),
    nome: String(linha.nome ?? "").trim(),
    ordem: Number.isFinite(ordem) ? ordem : 0,
    parcelas: Math.max(0, Math.trunc(Number(linha.parcelas) || 0)),
    ressalva: limparRessalva(linha.ressalva),
    // ⚠️ SACOC É O PADRÃO DA CASA, e não Price: são 21 dos 24 empreendimentos. Cair no mais raro
    // por engano de digitação anunciaria uma parcela que o boleto não vai cobrar.
    sistemaAmortizacao: ((SISTEMAS as string[]).includes(sistema)
      ? sistema
      : "sacoc") as SistemaAmortizacao,
    slot: (SLOTS as string[]).includes(slot) ? (slot as SlotDaPa) : null,
  };
}

/**
 * As colunas que a Mesa lê de `temis_planos` (a ressalva entra à parte, tolerante à 0168).
 *
 * ⚠️ `id` E AS ANUAIS ENTRARAM COM A NORMALIZAÇÃO ÚNICA: o plano que a Mesa recebe é o mesmo objeto
 * que a aba de políticas mostra. As anuais existem desde a 0138 (o espelho público já as lê).
 */
const COLUNAS_DO_PLANO =
  "id,enterprise_id,categoria_id,nome,parcelas,entrada_percentual,juros_taxa,juros_periodicidade,juros_convencao,indice_correcao,sistema_amortizacao,slot,ativo,ordem,anuais_quantidade,anuais_valor";

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
  const ids = [
    ...new Set(enterpriseIds.map((id) => String(id).trim()).filter(Boolean)),
  ];
  if (ids.length === 0) return [];

  const linhas: LinhaDoPlano[] = [];
  // ⚠️ A RESSALVA É PEDIDA, E SUA AUSÊNCIA NÃO DERRUBA A MESA (16/09/2026). Sem ela a Mesa e o
  // simulador ofereciam o plano Investidor do Garden sem a condição "válido para as próximas 16
  // unidades", que só aparecia no Apolo. Enquanto a 0168 não roda, o primeiro erro que for DA
  // COLUNA faz a leitura seguir sem ela (plano sem etiqueta); qualquer outro erro lança, como antes.
  let comRessalva = true;
  // ⚠️ EM LOTES DE 100: `.in()` monta a lista na URL, e um escopo grande estoura o limite do
  // PostgREST sem erro claro.
  for (let de = 0; de < ids.length; ) {
    const { data, error } = await cliente
      .from("temis_planos")
      // ⚠️ `categoria_id` ENTRA AQUI, e a ausência dela era um vazamento esperando o cadastro.
      // Sem a coluna, um plano preso a uma categoria chegava à Mesa indistinguível de um plano do
      // produto — e valeria para todos os lotes.
      .select(comRessalva ? `${COLUNAS_DO_PLANO},ressalva` : COLUNAS_DO_PLANO)
      .eq("workspace_id", "careli")
      .eq("ativo", true)
      .in("enterprise_id", ids.slice(de, de + 100))
      .order("ordem", { ascending: true });

    if (error && comRessalva && ehColunaDaRessalvaAusente(error)) {
      comRessalva = false;
      continue;
    }
    if (error) throw new Error(error.message);
    linhas.push(...((data ?? []) as unknown as LinhaDoPlano[]));
    de += 100;
  }

  const porEmpreendimento = new Map<string, PlanosDoEmpreendimento>();
  for (const linha of linhas) {
    const id = String(linha.enterprise_id);
    let alvo = porEmpreendimento.get(id);
    if (!alvo) {
      alvo = {
        code: "",
        enterpriseId: id,
        planos: [],
        tabelaDoEmpreendimento: null,
      };
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
  const cadastrados = new Set(
    doPanteon.filter((e) => e.planos.length > 0).map((e) => e.enterpriseId),
  );
  return [
    ...doPanteon.filter((e) => e.planos.length > 0),
    ...doC2x.filter((e) => !cadastrados.has(e.enterpriseId)),
  ];
}

/**
 * As faixas de prazo cadastradas, por empreendimento.
 *
 * ⚠️ MESMO LOTE DE 100 DOS PLANOS, e pela mesma razão: `.in()` monta a lista na URL e um escopo
 * grande estoura o limite do PostgREST sem erro claro — 700 ids já mediram 27.670 caracteres e
 * 400 Bad Request nesta casa.
 *
 * ⚠️ SÓ AS ATIVAS. Faixa desativada continua no banco para explicar o plano que ela gerou (é a
 * mesma regra do plano e do índice: nada se apaga, tudo se desativa), mas não deve preencher
 * formulário novo.
 *
 * ⚠️ E O VAZIO É O ESTADO NORMAL DE HOJE. A tabela nasceu vazia na migration 0155: enquanto nenhum
 * empreendimento tiver faixa, `premissaDoPrazo` devolve `null` e a tela se comporta exatamente como
 * se comportava. É o que torna esta entrega segura de subir antes de a tela de cadastro existir.
 */
export async function lerFaixasDoPanteon(
  cliente: Cliente,
  enterpriseIds: string[],
): Promise<Record<string, FaixaDePrazo[]>> {
  const ids = [
    ...new Set(enterpriseIds.map((id) => String(id).trim()).filter(Boolean)),
  ];
  if (ids.length === 0) return {};

  type LinhaDaFaixa = {
    define_entrada: boolean;
    define_indice: boolean;
    define_juros: boolean;
    enterprise_id: string;
    entrada_percentual: null | number | string;
    indice_correcao: null | string;
    juros_convencao: string;
    juros_periodicidade: string;
    juros_taxa: null | number | string;
    parcela_maxima: number;
    parcela_minima: number;
  };

  const linhas: LinhaDaFaixa[] = [];
  for (let de = 0; de < ids.length; de += 100) {
    const { data, error } = await cliente
      .from("temis_faixas_de_prazo")
      .select(
        "enterprise_id,parcela_minima,parcela_maxima,define_entrada,entrada_percentual,define_juros,juros_taxa,juros_periodicidade,juros_convencao,define_indice,indice_correcao",
      )
      .eq("workspace_id", "careli")
      .eq("ativo", true)
      .in("enterprise_id", ids.slice(de, de + 100))
      .order("parcela_minima", { ascending: true });

    if (error) throw new Error(error.message);
    linhas.push(...((data ?? []) as LinhaDaFaixa[]));
  }

  const porEmpreendimento: Record<string, FaixaDePrazo[]> = {};
  for (const l of linhas) {
    const id = String(l.enterprise_id);
    (porEmpreendimento[id] ??= []).push({
      defineEntrada: l.define_entrada,
      defineIndice: l.define_indice,
      defineJuros: l.define_juros,
      entradaPercentual: numero(l.entrada_percentual),
      indiceCorrecao: l.indice_correcao,
      jurosConvencao: l.juros_convencao,
      jurosPeriodicidade: l.juros_periodicidade,
      jurosTaxa: numero(l.juros_taxa),
      parcelaMaxima: Number(l.parcela_maxima),
      parcelaMinima: Number(l.parcela_minima),
    });
  }
  return porEmpreendimento;
}
