import {
  CORTE_ANUAL,
  periodicidadeDaTaxa,
} from "@/lib/apolo/periodicidade-da-taxa";

// A régua vive num módulo PURO: ela é usada pela tela do Hércules, e este arquivo carrega o mysql2.
export { periodicidadeDaTaxa };

import type { RowDataPacket } from "mysql2";

import { getHadesDbPool } from "@/lib/guardian/db";

import type {
  IndiceCorrecao,
  PlanoComercial,
  SistemaAmortizacao,
  SlotDaPa,
} from "./planos-comerciais";

// OS PLANOS COMERCIAIS DO C2X — leitura, e só os que estão AMARRADOS A UM SLOT.
//
// ⚠️ POR QUE SÓ OS SLOTADOS. A tabela `commercial_plans` tem 137 planos "padrão" (sem proposta
// vinculada), e uns 60 deles são lixo acumulado: duplicatas exatas, nomes como "LUCAS RUAS", o
// Lagoa Bonita sozinho com ~40 planos soltos. Mas `enterprises` aponta explicitamente para os
// planos que valem — `investor_plan_id`, `short_plan_id`, `normal_plan_id` —, e ESSES estão
// limpos nos 24 empreendimentos que os têm. Entrar pela porta dos slots é o que separa o
// cadastro vivo do entulho, sem precisar de curadoria manual.
//
// ⚠️ POR QUE LER DO C2X E NÃO SÓ DO APOLO. A PA tem que anunciar o que o boleto vai cobrar, e
// quem emite o boleto é o C2X. Enquanto a tela de cadastro do Apolo não existir, ler daqui é a
// única forma de a folha sair com os números do empreendimento certo — os planos fixos no
// código eram os do Villa Paris, impressos em qualquer lançamento. Quando a tela existir, ela
// passa a ter precedência e esta leitura vira o default e a semente.
//
// ⚠️ ISTO É READ-ONLY, como todo acesso ao legado.

/** O que o Prometeu precisa saber além do plano em si. */
export type PlanosDoEmpreendimento = {
  code: string;
  enterpriseId: string;
  /** PRICE | SACOOC do cadastro do empreendimento — governa a matemática de TODOS os planos. */
  tabelaDoEmpreendimento: null | string;
  planos: PlanoComercial[];
};

type LinhaC2x = RowDataPacket & {
  code: string;
  contractual_interest: null | number | string;
  enterprise_id: number;
  indice: null | string;
  initial_input_value: null | number | string;
  parcels: null | number;
  plano: null | string;
  slot: string;
  tabela: null | string;
};

/**
 * O de-para entre o nome do índice no C2X e o código do Panteon.
 *
 * ⚠️ AQUI MORAVA UM DEFEITO VIVO, e ele não dava erro: o C2X tem SEIS índices em
 * `index_monetary_corrections` e este mapa tinha CINCO. `POUPANÇA` foi cadastrada no legado em
 * 29/08/2026 e ficou de fora — e como a leitura termina em `?? "SEM_CORRECAO"`, o desconhecido não
 * estourava, ele virava "sem correção" em silêncio.
 *
 * ⚠️ O CUSTO MEDIDO (13/09/2026): o plano NORMAL do JARDIM DAS GERAIS (empreendimento 40, com
 * `vendendo = true`, 120 parcelas) é corrigido pela poupança, e a proposta saía anunciando que o
 * contrato não tinha correção nenhuma. São 3 planos do legado nessa situação e 5 propostas já
 * gravadas com `plano_correcao = 'POUPANÇA'`. Índice que o sistema não conhece não dá erro: ele
 * some, e some do lado que favorece o cliente no papel e a casa descobre na cobrança.
 *
 * ⚠️ AS CHAVES SÃO O TEXTO EXATO DO LEGADO, acentos e hífens incluídos — é o que
 * `index_monetary_corrections.name` guarda. Mudar a grafia aqui é recriar o mesmo buraco.
 */
const INDICE_POR_NOME: Record<string, IndiceCorrecao> = {
  "IGPM-ANUAL": "IGPM_ANUAL",
  "INCC-M MENSAL": "INCC_M_MENSAL",
  "IPCA ANUAL": "IPCA_ANUAL",
  "IPCA-MENSAL": "IPCA_MENSAL",
  POUPANÇA: "POUPANCA",
  "SEM CORREÇAO": "SEM_CORRECAO",
};

function numero(v: null | number | string): null | number {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * PRICE | SACOOC do empreendimento vira o sistema de todos os planos dele.
 *
 * ⚠️ NO C2X A AMORTIZAÇÃO NÃO EXISTE POR PLANO, só por empreendimento — e a medição contra as
 * parcelas emitidas confirmou que é ela que governa: 9 de 9 SACOOC emitem amortização pura, e
 * o único PRICE com parcelas emitidas bate na Price. O Veredas do Ouro já precisou furar isso
 * e codificou no NOME ("PLANO NORMAL PRICE" e "PLANO NORMAL SACOC" no mesmo empreendimento),
 * o que é justamente o motivo de o Apolo ter a coluna por plano.
 *
 * Sem cadastro, cai em SACOC: é o caso de 21 dos 24, e errar para SACOC subestima o total pago
 * pelo cliente em vez de superestimar a parcela do papel.
 */
function sistemaDaTabela(tabela: null | string): SistemaAmortizacao {
  return (tabela ?? "").trim().toUpperCase() === "PRICE" ? "price" : "sacoc";
}

function montarPlano(linha: LinhaC2x, slot: SlotDaPa): null | PlanoComercial {
  const parcelas = linha.parcels;
  if (parcelas == null || parcelas <= 0) return null;

  const taxa = numero(linha.contractual_interest);
  const temJuros = taxa != null && taxa > 0;

  return {
    entradaPercentual: numero(linha.initial_input_value) ?? 0,
    indiceCorrecao:
      INDICE_POR_NOME[(linha.indice ?? "").trim()] ?? "SEM_CORRECAO",
    jurosConvencao: "equivalente",
    jurosPeriodicidade: temJuros && taxa >= CORTE_ANUAL ? "anual" : "mensal",
    jurosTaxa: temJuros ? taxa : null,
    nome: (linha.plano ?? slot).trim().toUpperCase(),
    parcelas,
    sistemaAmortizacao: sistemaDaTabela(linha.tabela),
    slot,
  };
}

// Um SELECT por slot, unidos: `enterprises` guarda cada plano numa COLUNA diferente, então não
// há como pegar os três num join só sem repetir a tabela de planos três vezes de qualquer jeito.
function sqlDosPlanos(marcadores: string): string {
  const bloco = (coluna: string, slot: string) => `
    select e.id as enterprise_id, e.code, et.name as tabela, '${slot}' as slot,
           cp.name as plano, cp.initial_input_value, cp.parcels,
           cp.contractual_interest, imc.name as indice
      from enterprises e
      join commercial_plans cp on cp.id = e.${coluna}
      left join enterprise_tables et on et.id = e.enterprise_table_id
      left join index_monetary_corrections imc on imc.id = cp.index_monetary_correction_id
     where e.code in (${marcadores})`;

  return [
    bloco("investor_plan_id", "investidor"),
    bloco("short_plan_id", "curto"),
    bloco("normal_plan_id", "normal"),
  ].join(" union all ");
}

/**
 * Lê os planos slotados dos empreendimentos pedidos.
 *
 * ⚠️ VAZIO NÃO É FALHA. Empreendimento sem plano cadastrado devolve lista vazia com `ok: true`;
 * o C2X fora do ar devolve `ok: false`. Quem chama precisa tratar os dois de formas opostas —
 * o primeiro cai no plano padrão com aviso, o segundo tem que dizer "não consegui ler, confira
 * antes de imprimir". Confundir os dois faz a folha sair errada em silêncio num dia em que o
 * banco simplesmente não respondeu.
 */
export async function lerPlanosDoC2x(
  codes: string[],
): Promise<
  | { error: string; ok: false }
  | { empreendimentos: PlanosDoEmpreendimento[]; ok: true }
> {
  const alvos = [
    ...new Set(codes.map((c) => c.trim().toUpperCase()).filter(Boolean)),
  ];
  if (alvos.length === 0) return { empreendimentos: [], ok: true };

  const poolResult = getHadesDbPool();
  if (!poolResult.ok) {
    return {
      error: `Configuracao C2X ausente: ${poolResult.missing.join(", ")}.`,
      ok: false,
    };
  }

  const marcadores = alvos.map(() => "?").join(", ");

  try {
    const [rows] = await poolResult.pool.query<LinhaC2x[]>(
      sqlDosPlanos(marcadores),
      // Três blocos no union, cada um com sua cópia da lista de códigos.
      [...alvos, ...alvos, ...alvos],
    );

    const porCode = new Map<string, PlanosDoEmpreendimento>();
    for (const linha of rows) {
      const code = (linha.code ?? "").trim().toUpperCase();
      if (!code) continue;

      let alvo = porCode.get(code);
      if (!alvo) {
        alvo = {
          code,
          enterpriseId: String(linha.enterprise_id),
          planos: [],
          tabelaDoEmpreendimento: linha.tabela ?? null,
        };
        porCode.set(code, alvo);
      }

      const plano = montarPlano(linha, linha.slot as SlotDaPa);
      if (plano) alvo.planos.push(plano);
    }

    return { empreendimentos: [...porCode.values()], ok: true };
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Falha ao ler os planos do C2X.",
      ok: false,
    };
  }
}
