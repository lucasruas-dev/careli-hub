// OS EMPREENDIMENTOS QUE EMITEM BOLETO PELO PANTEON, e de onde vem a carteira de cada um.
//
// ⚠️ Pedido do Lucas (31/08/2026): *"chegou um outro arquivo com os demais empreendimentos que
// iremos emitir os boletos, tirando o vale do ouro, vamos ter que emitir todos esses pelo
// panteon (...) depois irei fazer cada empreendimento sua conta asaas, tudo separado"*.
//
// ⚠️ CADA UM COM SUA CONTA NO ASAAS. O boleto sai no CNPJ da dona da chave e o dinheiro cai nela:
// uma chave errada aqui é dinheiro na conta errada. Por isso `conta` é declarado por
// empreendimento e nunca herdado — ver `lib/apolo/asaas-contas.ts`.
//
// ⚠️ AS TRÊS ORIGENS DE CARTEIRA, e elas mudam o que a tela pode conferir:
//   • `lsoft`   — o contrato e as parcelas vivem nas tabelas `lsoft_*`. Dá para cruzar por CPF,
//                 conferir a parcela e mostrar o extrato. É o caso do Garden e do Vale do Sol.
//   • `planilha`— a planilha É a única fonte. Não existe contrato em lugar nenhum do Panteon,
//                 então a tela emite pelo que está escrito e não tem contra o que conferir.
//   • `c2x`     — reservado para quando alguma carteira nascer no legado. Nenhuma hoje.
//
// Nenhum destes empreendimentos existe no C2X: conferido em 31/08/2026 contra as 37 linhas de
// `enterprises`. Não é esquecimento de cadastro — são carteiras administradas fora do legado.

import type { ContaAsaas } from "../asaas-contas";

export type OrigemDaCarteira = "c2x" | "lsoft" | "planilha";

export type EmpreendimentoDeBoleto = {
  /** A conta do Asaas que emite. `null` = ainda não configurada, e a tela recusa a emissão. */
  conta: ContaAsaas | null;
  /** Como a aba se chama no arquivo que o administrativo manda. */
  aba: string;
  nome: string;
  origem: OrigemDaCarteira;
  /** Chave em `lsoft_parcelas.empreendimento`, quando a origem é o LSoft. */
  chaveLsoft?: string;
  slug: string;
};

/**
 * ⚠️ O VALE DO OURO ESTÁ DE FORA POR DECISÃO EXPLÍCITA (Lucas, 31/08: *"tirando o vale do
 * ouro"*). Ele tem aba no arquivo e continua sendo cobrado pelo caminho de sempre. Deixá-lo
 * cadastrado aqui com `conta: null` seria pior: apareceria na tela como "faltando configurar",
 * e alguém acabaria configurando.
 */
export const EMPREENDIMENTOS_DE_BOLETO: EmpreendimentoDeBoleto[] = [
  {
    aba: "BOLETOS GARDEN",
    chaveLsoft: "Garden",
    conta: "garden",
    nome: "Garden",
    origem: "lsoft",
    slug: "garden",
  },
  {
    aba: "BOLETOS VALE SOL",
    chaveLsoft: "Vale do Sol",
    conta: "vale-do-sol",
    nome: "Vale do Sol",
    origem: "lsoft",
    slug: "vale-do-sol",
  },
  { aba: "BOLETOS ON SKY", conta: "on-sky", nome: "On Sky", origem: "planilha", slug: "on-sky" },
  { aba: "BOLETOS GUAIMBE", conta: "guaimbe", nome: "Guaimbé", origem: "planilha", slug: "guaimbe" },
  {
    aba: "BOLETOS GIANT",
    conta: "giant-towers",
    nome: "Giant Towers",
    origem: "planilha",
    slug: "giant-towers",
  },
  {
    aba: "BOLETOS ED ESMERALDA",
    conta: "cer",
    nome: "Ed. Esmeralda",
    origem: "planilha",
    slug: "ed-esmeralda",
  },
  {
    aba: "BOLETOS ED CRISTAL",
    conta: "cer",
    nome: "Ed. Cristal",
    origem: "planilha",
    slug: "ed-cristal",
  },
  { aba: "BOLETOS ED RUBI", conta: "cer", nome: "Ed. Rubi", origem: "planilha", slug: "ed-rubi" },
  { aba: "BOLETOS ED JADE", conta: "cer", nome: "Ed. Jade", origem: "planilha", slug: "ed-jade" },
  // ⚠️ CARTEIRA DE TESTE, e ela existe para NÃO sujar as de verdade. Pedido do Lucas (01/09/2026):
  // *"coloca para mim um boleto Lucas Ruas - Teste - 10 reais"*. Um teste lançado dentro do Ed. Jade
  // entraria na soma daquele prédio, apareceria na conferência do administrativo e teria de ser
  // explicado todo mês. Aqui ele fica numa aba própria, e some com a remoção de uma linha.
  //
  // ⚠️ EMITE NA CONTA CER DE VERDADE. É essa a graça do teste: o boleto sai pela mesma chave, no
  // mesmo CNPJ, pelo mesmo caminho. `aba` é um nome que não existe em planilha nenhuma, então uma
  // carga nunca cria linha aqui — o que estiver nesta carteira foi posto à mão.
  { aba: "__TESTE__", conta: "cer", nome: "Teste", origem: "planilha", slug: "teste" },
];

/** Casa o nome da aba do arquivo com o empreendimento, tolerando espaço e acento. */
export function empreendimentoDaAba(aba: string): EmpreendimentoDeBoleto | null {
  const alvo = chaveDeComparacao(aba);
  return (
    EMPREENDIMENTOS_DE_BOLETO.find((e) => chaveDeComparacao(e.aba) === alvo) ?? null
  );
}

export function empreendimentoPorSlug(slug: string): EmpreendimentoDeBoleto | null {
  const alvo = String(slug ?? "").trim().toLowerCase();
  return EMPREENDIMENTOS_DE_BOLETO.find((e) => e.slug === alvo) ?? null;
}

/**
 * ⚠️ A ABA "BOLETOS GIANT " VEM COM ESPAÇO NO FIM no arquivo de 31/08, e "GUAIMBÉ" com acento
 * que a nossa lista não tem. Comparar cru perderia as duas — e perder aba é perder carteira
 * inteira sem erro visível.
 */
function chaveDeComparacao(texto: string): string {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}
