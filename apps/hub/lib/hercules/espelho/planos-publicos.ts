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
import { descontoDoPlano } from "@/lib/hercules/ajuste-de-preco";
import { colunasComAsNovas, semAColunaQueFaltou } from "@/lib/hercules/planos-do-panteon";
import { sistemaDoCadastro } from "@/lib/hercules/simulacao";
import { limparRessalva } from "@/lib/temis/planos";

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
  /**
   * O desconto do plano sobre a tabela (0178), 0 a menos de 100. Zero = sem desconto.
   *
   * ⚠️ SAI PARA O ESPELHO PORQUE É O PREÇO DO PLANO, e o espelho usa o MESMO simulador da Mesa: sem
   * ele o site anunciaria o Investidor Parcelado do Garden pelo preço cheio, e a parcela do link não
   * bateria com a que o corretor apresenta.
   */
  descontoPercentual: number;
  /**
   * A ressalva de disponibilidade do plano (0168), já limpa. Nula = sem etiqueta.
   *
   * ⚠️ SAI PARA O ESPELHO PORQUE É CONDIÇÃO DO PLANO, E A MMENDES A MOSTRA NO MAPA PÚBLICO (revisão de
   * 18/09/2026). O `garden.html` escreve "válido para as próximas 16 unidades" ao lado do nome do
   * INVESTIDOR PARCELADO, e a Mesa já mostrava a etiqueta; o espelho não lia a coluna, e os 87
   * cartões do INVESTIDOR PARCELADO no espelho do Garden saíam sem ela. Anunciar o plano sem dizer
   * que ele acaba é prometer uma condição que o corretor pode não ter mais para vender.
   */
  ressalva: null | string;
};

type LinhaDePlano = {
  anuais_quantidade: null | number;
  anuais_valor: null | number | string;
  /** Ausente enquanto a migration 0178 não roda. */
  desconto_percentual?: null | number | string;
  entrada_percentual: null | number | string;
  indice_correcao: null | string;
  juros_convencao: null | string;
  juros_periodicidade: null | string;
  juros_taxa: null | number | string;
  nome: string;
  parcelas: null | number;
  /** Ausente enquanto a migration 0168 não roda. */
  ressalva?: null | string;
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
      p.descontoPercentual,
    ].join("|");

    if (vistos.has(chave)) continue;
    vistos.add(chave);
    unicos.push(p);
  }

  return unicos;
}

/**
 * O piso de entrada que vale no espelho, dados os pisos cadastrados na árvore (pai e filhos).
 *
 * Lucas (18/09/2026), no espelho do Garden: o cartão dizia "entrada R$ 41.000 (8%)" num lote de
 * R$ 410.000 — 10%, o padrão da casa, com o rótulo do plano de 8% ao lado. A Mesa de Venda já
 * recebia o piso do empreendimento (`apolo_enterprise_settings.entrada_minima_percentual`); o
 * espelho, que monta o MESMO simulador, não recebia, e o Garden aparecia vendendo a 10%.
 *
 * ⚠️ AS REGRAS SÃO AS DE `entradaMinima`: nulo (ninguém cadastrou) é o padrão da casa; ZERO É ZERO,
 * uma decisão de vender sem entrada, e não "não cadastrado".
 *
 * ⚠️ NA ÁRVORE COM MAIS DE UM PISO, VALE O MAIOR. O espelho não mostra divisão interna (o lote
 * público não diz se é do VOC ou do VOL), então não há como dar a cada lote o piso do filho dele. O
 * maior é o que nenhum filho recusa: anunciar o piso menor prometeria, no lote do filho mais
 * exigente, uma entrada que a Mesa não aceita.
 */
export function pisoDoEspelho(
  pisos: ReadonlyArray<null | number | string | undefined>,
): null | number {
  const cadastrados = pisos
    .filter((p) => p !== null && p !== undefined && p !== "")
    .map((p) => Number(p))
    .filter((n) => Number.isFinite(n) && n >= 0);
  return cadastrados.length > 0 ? Math.max(...cadastrados) : null;
}

/**
 * O piso de entrada dos empreendimentos do espelho, lido da aba Política Comercial.
 *
 * ⚠️ FALHA DE LEITURA É "PADRÃO DA CASA", NUNCA ZERO: devolver 0 porque o banco piscou liberaria
 * venda sem entrada na tela do corretor. É a mesma escolha da rota `incorporador/venda`.
 */
export async function pisoDeEntradaPublico(
  client: SupabaseClient,
  enterpriseIds: readonly string[],
): Promise<null | number> {
  const ids = enterpriseIds.filter(Boolean);
  if (ids.length === 0) return null;

  const { data, error } = await client
    .from("apolo_enterprise_settings")
    .select("enterprise_id, entrada_minima_percentual")
    .in("enterprise_id", ids);

  if (error) {
    console.error("[publico][espelho] piso de entrada", error);
    return null;
  }
  return pisoDoEspelho(
    ((data ?? []) as Array<{ entrada_minima_percentual: null | number | string }>).map(
      (l) => l.entrada_minima_percentual,
    ),
  );
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

  const ler = (novas: { desconto: boolean; ressalva: boolean }) =>
    client
      .from("temis_planos")
      .select(
        colunasComAsNovas(
          "anuais_quantidade,anuais_valor,entrada_percentual,indice_correcao,juros_convencao,juros_periodicidade,juros_taxa,nome,parcelas,sistema_amortizacao",
          novas,
        ),
      )
      .in("enterprise_id", ids)
      .eq("ativo", true)
      // ⚠️ SÓ OS PLANOS DO PRODUTO, sem categoria. Um plano preso a categoria é recorte comercial
      // (lote caucionado, fase específica) e depende de saber QUAL unidade — pergunta que esta tela
      // não faz. Mostrar um plano de categoria para um lote que não é dela anunciaria condição
      // errada.
      .is("categoria_id", null)
      .order("ordem", { ascending: true });

  // ⚠️ AS COLUNAS NOVAS PODEM AINDA NÃO EXISTIR NO BANCO, com a mesma tolerância da Mesa
  // (`lerPlanosDoPanteon`): sem o desconto (0178) o plano sai sem desconto; sem a ressalva (0168),
  // sem etiqueta, que é o que o espelho mostrava até aqui. A leitura repete desligando só a coluna
  // que o banco disse não conhecer; outro erro sobe como sempre.
  let novas = { desconto: true, ressalva: true };
  let { data, error } = await ler(novas);
  for (let semElas = error ? semAColunaQueFaltou(error, novas) : null; semElas; ) {
    novas = semElas;
    ({ data, error } = await ler(novas));
    semElas = error ? semAColunaQueFaltou(error, novas) : null;
  }

  if (error) throw new Error(error.message);

  // A árvore inteira entra na consulta: o mesmo plano cadastrado no pai e num filho viria duas
  // vezes. Ver `semPlanosRepetidos`.
  return semPlanosRepetidos(
    ((data ?? []) as unknown as LinhaDePlano[])
      .map((p) => ({
        anuaisQuantidade: numero(p.anuais_quantidade, 0),
        anuaisValor: numero(p.anuais_valor, 0),
        descontoPercentual: descontoDoPlano(p.desconto_percentual),
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
        ressalva: limparRessalva(p.ressalva),
        sistemaAmortizacao: sistemaDoCadastro(p.sistema_amortizacao),
      }))
      // Plano sem parcela não simula nada — e apareceria na tela como um cartão morto.
      .filter((p) => p.parcelas > 0)
  );
}
