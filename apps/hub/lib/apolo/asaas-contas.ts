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

// ⚠️ A CONTA É POR EMPREENDIMENTO, MAS UMA CONTA PODE SERVIR A VÁRIOS. Decisão do Lucas
// (01/09/2026): *"vamos ter varias contas asaas, cada uma cadastradas para os empreendimentos"*, e
// logo depois: os quatro edifícios (Jade, Ruby, Cristal, Esmeralda) *"vão ser em uma conta somente,
// CER, por isso na descrição vamos ter que apontar qual empreendimento"*.
//
// Cada boleto sai no CNPJ da dona da chave e o dinheiro cai nela; misturar é dinheiro na conta
// errada, e só o extrato conta. Quando várias carteiras dividem a conta, o que as separa no extrato
// é a DESCRIÇÃO da cobrança — ver `descricaoDoBoleto` em `boletos/emissao.ts`.
//
// `careli` e `gurgel` não são de boleto: a Careli é a leitura do Hades e a Gurgel os PIX da
// pré-venda. Ficam aqui porque a chave e o ambiente se conferem do mesmo jeito.
export type ContaAsaas =
  | "careli"
  | "cer"
  | "garden"
  | "giant-towers"
  | "guaimbe"
  | "gurgel"
  | "on-sky"
  | "vale-do-sol";

type Definicao = {
  /** Nome que a tela mostra antes do clique. */
  rotulo: string;
  variavel: string;
};

const CONTAS: Record<ContaAsaas, Definicao> = {
  careli: { rotulo: "Careli", variavel: "ASAAS_API_KEY" },
  // ⚠️ UMA CONTA PARA OS QUATRO EDIFÍCIOS. Decisão do Lucas (01/09/2026): Jade, Ruby, Cristal e
  // Esmeralda emitem todos pela CER. É por isso que a DESCRIÇÃO do boleto tem de nomear o
  // empreendimento: no extrato da CER as quatro carteiras chegam misturadas, e sem o nome na
  // descrição não há como saber de qual prédio veio cada pagamento.
  cer: { rotulo: "CER", variavel: "ASAAS_CER_API_KEY" },
  garden: { rotulo: "Garden", variavel: "ASAAS_GARDEN_API_KEY" },
  "giant-towers": { rotulo: "Giant Towers", variavel: "ASAAS_GIANT_TOWERS_API_KEY" },
  guaimbe: { rotulo: "Guaimbé", variavel: "ASAAS_GUAIMBE_API_KEY" },
  gurgel: { rotulo: "Gurgel", variavel: "ASAAS_GURGEL_API_KEY" },
  "on-sky": { rotulo: "On Sky", variavel: "ASAAS_ON_SKY_API_KEY" },
  "vale-do-sol": { rotulo: "Vale do Sol", variavel: "ASAAS_VALE_DO_SOL_API_KEY" },
};

/** Todas as contas cadastradas — para a tela conferir sem lista repetida em outro arquivo. */
export const TODAS_AS_CONTAS = Object.keys(CONTAS) as ContaAsaas[];

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

// ⚠️ O MAPA `CONTA_POR_EMPREENDIMENTO` FOI REMOVIDO EM 01/09/2026, e vale dizer por quê: ele
// dizia a mesma coisa que o campo `conta` de `boletos/empreendimentos.ts`, por outro caminho (o
// NOME do empreendimento), e nenhum código de produção o consumia — só o próprio teste. Quem
// cadastrasse uma conta ali e esquecesse o `conta:` do empreendimento veria o teste passar verde
// com o empreendimento sem emitir nada. Duas fontes para a mesma verdade é como se erra em silêncio.
//
// A fonte única é `EMPREENDIMENTOS_DE_BOLETO[].conta`.
