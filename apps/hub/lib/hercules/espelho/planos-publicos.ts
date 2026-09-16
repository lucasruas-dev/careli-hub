// OS PLANOS QUE O ESPELHO PÚBLICO MOSTRA — a mesma conta da proposta, na tela do cliente.
//
// Lucas (10/09/2026): *"simulador não é esse, trazer o mesmo que temos na aba vendas do
// hercules"* e, sobre o que exibir, *"mostra tudo, como na proposta"*.
//
// ⚠️ SÓ `temis_planos`, NUNCA O C2X. A regra da tela vale aqui também: *"nada de olhar no c2x"*.
// Medido em 10/09/2026: dos oito empreendimentos com masterplan, só o Veredas do Ouro tem plano
// cadastrado no Panteon (quatro). Onde não houver plano o simulador não aparece — o lote mostra
// metragem e valor, e ponto. Não é falha: é o cadastro ainda por fazer, e inventar um plano
// padrão seria anunciar condição que ninguém aprovou.
//
// ⚠️ E O QUE SAI DAQUI NÃO É O PLANO INTEIRO. Ficam de fora `minuta_id`, `categoria_id`,
// `observacao` e `slot` — respectivamente o contrato que a venda usa, o recorte comercial, o
// bilhete interno de quem cadastrou e a posição na folha da proposta. Nada disso é do cliente.
// O que sai é o que ele veria na proposta assinada: nome, entrada, parcelas, juros, correção e
// sistema de amortização.
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  type ConvencaoJuros,
  INDICES as ROTULOS_DE_INDICE,
  type IndiceCorrecao,
  type PeriodicidadeJuros,
  type PlanoComercial,
} from "@/lib/apolo/planos-comerciais";
import { sistemaDoCadastro } from "@/lib/hercules/simulacao";

/**
 * O plano como o espelho público o entrega.
 *
 * É `PlanoComercial` sem o `slot` — a tela pública não tem folha de proposta, e o campo só diria
 * a quem lê o JSON como a casa organiza o papel.
 */
export type PlanoPublico = Omit<PlanoComercial, "slot"> & {
  /** Quantidade de parcelas anuais (balões), quando o plano tem. */
  anuaisQuantidade: number;
  /** Valor de cada anual. */
  anuaisValor: number;
};

type LinhaDePlano = {
  anuais_quantidade: null | number;
  anuais_valor: null | number | string;
  entrada_percentual: null | number | string;
  indice_correcao: null | string;
  juros_convencao: null | string;
  juros_periodicidade: null | string;
  juros_taxa: null | number | string;
  nome: string;
  parcelas: null | number;
  sistema_amortizacao: null | string;
};

/**
 * ⚠️ ESTA COPIA ESTAVA ERRADA, e era a pior das cinco porque e a que serve a TELA PUBLICA.
 * Ela aceitava `INCC_ANUAL` e `INCC_MENSAL`, que o banco NUNCA aceitou, e nao aceitava
 * `INCC_M_MENSAL`, que e o unico INCC que o CHECK da 0111 admitia e o que o C2X usa em 96 planos.
 * Resultado medido em 13/09/2026: o unico INCC valido caia no fallback e o espelho publico
 * anunciava ao comprador um contrato "sem correcao". Agora deriva da lista unica.
 */
const INDICES_VALIDOS = new Set(Object.keys(ROTULOS_DE_INDICE));

function numero(v: null | number | string | undefined, padrao: number): number {
  if (v === null || v === undefined) return padrao;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : padrao;
}

/**
 * O mesmo plano, cadastrado em dois níveis da árvore, aparece UMA vez.
 *
 * ⚠️ EXISTE PORQUE A ÁRVORE INTEIRA ENTRA NA CONSULTA. Os quatro chamadores passam
 * `[pai, ...filhos]`, e a consulta devolve os planos de todos somados. Enquanto só um nível tinha
 * plano, ninguém via. Em 15/09/2026 os três planos do Vale do Ouro foram cadastrados no VLO (pai)
 * E no VOC (filho), idênticos, e o espelho passou a mostrar seis cartões — print do Lucas,
 * 16/09/2026.
 *
 * Dois planos são o MESMO quando tudo o que muda a conta é igual: nome, parcelas, entrada,
 * índice, juros e anuais. Fica a primeira ocorrência. Plano DIFERENTE continua aparecendo — esta
 * função tira repetição, não decide precedência entre pai e filho.
 */
export function semPlanosRepetidos(planos: readonly PlanoPublico[]): PlanoPublico[] {
  const vistos = new Set<string>();
  const unicos: PlanoPublico[] = [];

  for (const p of planos) {
    // ⚠️ `jurosTaxa` entra com String(): nulo vira "null" e zero vira "0". Nulo é plano SEM juros
    // (ausência) e zero é juros escolhido como zero — não podem virar o mesmo plano.
    const chave = [
      p.nome.trim().toLowerCase(),
      p.parcelas,
      p.entradaPercentual,
      p.indiceCorrecao,
      String(p.jurosTaxa),
      p.jurosPeriodicidade,
      p.jurosConvencao,
      p.sistemaAmortizacao,
      p.anuaisQuantidade,
      p.anuaisValor,
    ].join("|");

    if (vistos.has(chave)) continue;
    vistos.add(chave);
    unicos.push(p);
  }

  return unicos;
}

/**
 * Os planos ativos de um empreendimento, prontos para a conta.
 *
 * `enterpriseId` é o `c2x_enterprise_id` do TOPO da árvore — o mesmo recorte do resto do espelho:
 * para quem está de fora o loteamento é um só, e o plano é do produto, não da carteira.
 *
 * Lista vazia não é erro: é empreendimento sem plano cadastrado.
 */
export async function planosPublicos(
  client: SupabaseClient,
  enterpriseIds: readonly string[],
): Promise<PlanoPublico[]> {
  const ids = enterpriseIds.filter(Boolean);
  if (ids.length === 0) return [];

  const { data, error } = await client
    .from("temis_planos")
    .select(
      "anuais_quantidade, anuais_valor, entrada_percentual, indice_correcao, juros_convencao, juros_periodicidade, juros_taxa, nome, parcelas, sistema_amortizacao",
    )
    .in("enterprise_id", ids)
    .eq("ativo", true)
    // ⚠️ SÓ OS PLANOS DO PRODUTO, sem categoria. Um plano preso a categoria é recorte comercial
    // (lote caucionado, fase específica) e depende de saber QUAL unidade — pergunta que esta tela
    // não faz. Mostrar um plano de categoria para um lote que não é dela anunciaria condição
    // errada.
    .is("categoria_id", null)
    .order("ordem", { ascending: true });

  if (error) throw new Error(error.message);

  // A árvore inteira entra na consulta: o mesmo plano cadastrado no pai e num filho viria duas
  // vezes. Ver `semPlanosRepetidos`.
  return semPlanosRepetidos(
    ((data ?? []) as LinhaDePlano[])
      .map((p) => ({
        anuaisQuantidade: numero(p.anuais_quantidade, 0),
        anuaisValor: numero(p.anuais_valor, 0),
        entradaPercentual: numero(p.entrada_percentual, 0),
        indiceCorrecao: (INDICES_VALIDOS.has(String(p.indice_correcao))
          ? p.indice_correcao
          : "SEM_CORRECAO") as IndiceCorrecao,
        jurosConvencao: (p.juros_convencao === "proporcional"
          ? "proporcional"
          : "efetiva") as ConvencaoJuros,
        jurosPeriodicidade: (p.juros_periodicidade === "mensal"
          ? "mensal"
          : "anual") as PeriodicidadeJuros,
        // Nulo é plano SEM juros, e é o caso de metade dos cadastrados. `?? 0` transformaria a
        // ausência em zero por acidente — aqui a ausência é intencional e tem de sobreviver.
        jurosTaxa: p.juros_taxa === null ? null : numero(p.juros_taxa, 0),
        nome: p.nome,
        parcelas: numero(p.parcelas, 0),
        sistemaAmortizacao: sistemaDoCadastro(p.sistema_amortizacao),
      }))
      // Plano sem parcela não simula nada — e apareceria na tela como um cartão morto.
      .filter((p) => p.parcelas > 0)
  );
}
