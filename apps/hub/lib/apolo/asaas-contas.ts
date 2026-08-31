// QUAL CONTA DO ASAAS EMITE — a escolha explícita, num lugar só.
//
// ⚠️ UMA CHAVE = UMA CONTA. Está na documentação do Asaas: a chave identifica a conta e autoriza
// as requisições, então empresas diferentes exigem chaves diferentes. Não existe "emitir em nome
// de" com a chave de outra conta — o boleto sai no CNPJ da dona da chave, e o dinheiro cai nela.
//
// ⚠️ POR QUE ISTO VIROU UM MÓDULO. A casa já tem TRÊS contas e elas nunca podem se misturar:
//   • CARELI    (ASAAS_API_KEY)        — leitura do Hades, cobrança da carteira própria
//   • GURGEL    (ASAAS_GURGEL_API_KEY) — os PIX da pré-venda dos lançamentos
//   • GARDEN    (ASAAS_GARDEN_API_KEY) — os boletos mensais do Garden (Lucas, 31/08/2026)
// Escolher a conta pelo caminho do código, como era antes, é como um boleto do Garden sai no
// CNPJ da Gurgel: ninguém percebe até o dinheiro cair na conta errada. Aqui a escolha é um
// parâmetro, e o nome da conta viaja junto para a tela poder mostrar ANTES do clique.
//
// ⚠️ A CHAVE DIZ O AMBIENTE. Produção começa com `$aact_prod_`, sandbox com `$aact_hmlg_`, e
// trocar uma pela outra dá erro de autenticação. `ambienteDaChave` existe para a tela avisar
// "esta chave é de sandbox" antes de alguém emitir 142 boletos que não existem.

export type ContaAsaas = "careli" | "garden" | "gurgel";

type Definicao = {
  /** Nome que a tela mostra antes do clique. */
  rotulo: string;
  variavel: string;
};

const CONTAS: Record<ContaAsaas, Definicao> = {
  careli: { rotulo: "Careli", variavel: "ASAAS_API_KEY" },
  garden: { rotulo: "Garden", variavel: "ASAAS_GARDEN_API_KEY" },
  gurgel: { rotulo: "Gurgel", variavel: "ASAAS_GURGEL_API_KEY" },
};

export function rotuloDaConta(conta: ContaAsaas): string {
  return CONTAS[conta].rotulo;
}

export function chaveDaConta(conta: ContaAsaas): null | string {
  return process.env[CONTAS[conta].variavel]?.trim() || null;
}

export function variavelDaConta(conta: ContaAsaas): string {
  return CONTAS[conta].variavel;
}

/**
 * Produção, sandbox ou desconhecido — pelo PREFIXO da chave, sem expor a chave.
 *
 * O Asaas emite `$aact_prod_...` para produção e `$aact_hmlg_...` para sandbox. Chave de
 * sandbox num endpoint de produção falha na autenticação, mas o contrário é pior: emitir de
 * verdade achando que era teste.
 */
export function ambienteDaChave(conta: ContaAsaas): "producao" | "sandbox" | "desconhecido" {
  const k = chaveDaConta(conta);
  if (!k) return "desconhecido";
  if (k.includes("_prod_")) return "producao";
  if (k.includes("_hmlg_")) return "sandbox";
  return "desconhecido";
}

/** O que a tela mostra sobre a conta — NUNCA a chave, só se ela existe e de que ambiente é. */
export type EstadoDaConta = {
  ambiente: "desconhecido" | "producao" | "sandbox";
  configurada: boolean;
  conta: ContaAsaas;
  rotulo: string;
  variavel: string;
};

export function estadoDaConta(conta: ContaAsaas): EstadoDaConta {
  return {
    ambiente: ambienteDaChave(conta),
    configurada: Boolean(chaveDaConta(conta)),
    conta,
    rotulo: rotuloDaConta(conta),
    variavel: variavelDaConta(conta),
  };
}

/**
 * A conta que emite as cobranças de cada empreendimento.
 *
 * ⚠️ MAPA EXPLÍCITO, e não convenção. O empreendimento sem entrada aqui NÃO EMITE — melhor a
 * tela dizer "este empreendimento não tem conta de cobrança" do que cair numa conta padrão e
 * faturar no CNPJ errado.
 */
const CONTA_POR_EMPREENDIMENTO: Record<string, ContaAsaas> = {
  Garden: "garden",
};

export function contaDoEmpreendimento(nome: string): ContaAsaas | null {
  return CONTA_POR_EMPREENDIMENTO[nome.trim()] ?? null;
}
