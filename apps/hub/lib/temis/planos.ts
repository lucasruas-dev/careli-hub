// PLANOS COMERCIAIS DO TEMIS — a camada de dados.
//
// Pedido do Lucas (01/09/2026): *"vamos fazer tudo no panteon, vou cadastrar os planos dentro do
// panteon"*, e antes disso a regra que dá sentido ao módulo inteiro: *"o que define qual minuta
// usar é o plano de pagamento. na prática é a unidade x foi vendida no plano a, ae o contrato que
// vai ser gerado é do plano"*.
//
// A cadeia é: empreendimento → categoria (opcional) → plano → minuta.
//
// ⚠️ OS CAMPOS SÃO OS DE `lib/apolo/planos-comerciais.ts`, e a conversão para lá é feita por
// `paraCalculo` aqui embaixo. Aquele módulo calcula parcela e sinal com 27 testes medidos contra
// nove empreendimentos reais; manter dois formatos e traduzir na mão em cada leitura é como o
// número muda sem ninguém ver.
//
// ⚠️ `entradaPercentual` é 0 a 100, NUNCA fração. O banco tem CHECK, mas a checagem aqui existe
// para a mensagem ser útil: "20 significa 20%" resolve mais rápido que um erro de constraint.
import type { PlanoComercial, SlotDaPa } from "@/lib/apolo/planos-comerciais";

export type PlanoDoTemis = {
  ativo: boolean;
  categoriaId: null | string;
  categoriaNome: null | string;
  criadoEm: string;
  entradaPercentual: number;
  id: string;
  indiceCorrecao: string;
  jurosConvencao: string;
  jurosPeriodicidade: string;
  jurosTaxa: null | number;
  /** A minuta que este plano usa. Nula = plano ainda não gera contrato. */
  minutaId: null | string;
  minutaNome: null | string;
  nome: string;
  observacao: null | string;
  ordem: number;
  parcelas: number;
  sistemaAmortizacao: string;
  slot: null | string;
};

export type CategoriaDoTemis = {
  ativa: boolean;
  id: string;
  nome: string;
  ordem: number;
  /** Quantos planos pendem dela. A tela avisa antes de deixar apagar. */
  planos: number;
};

/** O que a tela manda ao criar ou editar. */
export type EntradaDePlano = {
  ativo?: boolean;
  categoriaId?: null | string;
  entradaPercentual: number;
  indiceCorrecao: string;
  jurosConvencao?: string;
  jurosPeriodicidade?: string;
  jurosTaxa: null | number;
  minutaId?: null | string;
  nome: string;
  observacao?: null | string;
  ordem?: number;
  parcelas: number;
  sistemaAmortizacao: string;
  slot?: null | string;
};

const INDICES = new Set([
  "IGPM_ANUAL",
  "INCC_M_MENSAL",
  "IPCA_ANUAL",
  "IPCA_MENSAL",
  "SEM_CORRECAO",
]);
const SISTEMAS = new Set(["price", "sac", "sacoc"]);
const SLOTS = new Set(["avista", "curto", "investidor", "normal"]);
const PERIODICIDADES = new Set(["anual", "mensal"]);
const CONVENCOES = new Set(["equivalente", "proporcional"]);

/**
 * Confere a entrada ANTES de tocar no banco, para a tela poder dizer o que está errado.
 *
 * Devolve a lista de problemas em português. Vazia = pode gravar.
 */
export function conferirPlano(entrada: EntradaDePlano): string[] {
  const problemas: string[] = [];

  if (!entrada.nome?.trim()) problemas.push("O plano precisa de um nome.");
  if (!Number.isInteger(entrada.parcelas) || entrada.parcelas <= 0) {
    problemas.push("O número de parcelas precisa ser um inteiro maior que zero.");
  }

  const entradaPct = Number(entrada.entradaPercentual);
  if (!Number.isFinite(entradaPct) || entradaPct < 0 || entradaPct > 100) {
    problemas.push("A entrada é um percentual de 0 a 100 — 20 significa 20%, não 0,20.");
  }

  if (entrada.jurosTaxa !== null && entrada.jurosTaxa !== undefined) {
    const j = Number(entrada.jurosTaxa);
    if (!Number.isFinite(j) || j < 0) problemas.push("A taxa de juros não pode ser negativa.");
    // ⚠️ 12 aqui significa 12% ao ano, não 1200%. O engano é o mesmo da entrada e custa caro:
    // uma taxa mil vezes maior passa despercebida na tela e explode no cálculo da parcela.
    if (Number.isFinite(j) && j > 100) {
      problemas.push("A taxa parece alta demais — informe em percentual (12 = 12%).");
    }
  }

  if (!INDICES.has(entrada.indiceCorrecao)) problemas.push("Índice de correção desconhecido.");
  if (!SISTEMAS.has(entrada.sistemaAmortizacao)) problemas.push("Sistema de amortização desconhecido.");
  if (entrada.slot && !SLOTS.has(entrada.slot)) problemas.push("Posição na proposta desconhecida.");
  if (entrada.jurosPeriodicidade && !PERIODICIDADES.has(entrada.jurosPeriodicidade)) {
    problemas.push("Periodicidade dos juros deve ser anual ou mensal.");
  }
  if (entrada.jurosConvencao && !CONVENCOES.has(entrada.jurosConvencao)) {
    problemas.push("Convenção de juros deve ser equivalente ou proporcional.");
  }

  return problemas;
}

/**
 * Converte o plano guardado para o formato que `lib/apolo/planos-comerciais.ts` calcula.
 *
 * ⚠️ É esta função que impede a duplicação de regra. Quem precisar de parcela, sinal ou natureza da
 * parcela passa por aqui e usa o módulo que já tem teste — nunca recalcula.
 */
export function paraCalculo(plano: PlanoDoTemis): PlanoComercial {
  return {
    entradaPercentual: plano.entradaPercentual,
    indiceCorrecao: plano.indiceCorrecao as PlanoComercial["indiceCorrecao"],
    jurosConvencao: plano.jurosConvencao as PlanoComercial["jurosConvencao"],
    jurosPeriodicidade: plano.jurosPeriodicidade as PlanoComercial["jurosPeriodicidade"],
    jurosTaxa: plano.jurosTaxa,
    nome: plano.nome,
    parcelas: plano.parcelas,
    sistemaAmortizacao: plano.sistemaAmortizacao as PlanoComercial["sistemaAmortizacao"],
    slot: (plano.slot as null | SlotDaPa) ?? null,
  };
}

/**
 * O plano que uma venda deve usar, dado o empreendimento e o plano escolhido.
 *
 * ⚠️ NÃO ESCOLHE POR APROXIMAÇÃO. Se o plano não estiver na lista, devolve null e a venda não
 * acontece — melhor travar que gerar contrato com o plano errado. Foi a regra que o Lucas definiu
 * para a cadeia inteira: sem combinação, não gera.
 */
export function acharPlano(planos: PlanoDoTemis[], planoId: string): null | PlanoDoTemis {
  return planos.find((p) => p.id === planoId && p.ativo) ?? null;
}

/**
 * Os planos prontos para gerar contrato, e os que ainda não estão.
 *
 * A tela usa isto para mostrar o que falta antes de o empreendimento poder vender: plano sem minuta
 * é plano que trava a venda no último passo, e é melhor o operador saber disso no cadastro.
 */
export function separarPorProntidao(planos: PlanoDoTemis[]): {
  prontos: PlanoDoTemis[];
  semMinuta: PlanoDoTemis[];
} {
  const ativos = planos.filter((p) => p.ativo);
  return {
    prontos: ativos.filter((p) => p.minutaId),
    semMinuta: ativos.filter((p) => !p.minutaId),
  };
}

/** Rótulo curto do índice, para a tabela. */
export function rotuloDoIndice(indice: string): string {
  const mapa: Record<string, string> = {
    IGPM_ANUAL: "IGP-M anual",
    INCC_M_MENSAL: "INCC-M mensal",
    IPCA_ANUAL: "IPCA anual",
    IPCA_MENSAL: "IPCA mensal",
    SEM_CORRECAO: "sem correção",
  };
  return mapa[indice] ?? indice;
}

/** Rótulo do sistema de amortização, com o que ele significa para a parcela. */
export function rotuloDoSistema(sistema: string): string {
  const mapa: Record<string, string> = {
    price: "Price — parcela fixa",
    sac: "SAC — parcela decrescente",
    sacoc: "SACOC — amortização pura",
  };
  return mapa[sistema] ?? sistema;
}

/** Onde o plano aparece na folha da proposta. */
export function rotuloDoSlot(slot: null | string): string {
  if (!slot) return "não vai à proposta";
  const mapa: Record<string, string> = {
    avista: "À vista",
    curto: "Curto",
    investidor: "Investidor",
    normal: "Normal",
  };
  return mapa[slot] ?? slot;
}
