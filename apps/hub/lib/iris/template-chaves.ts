// AS CHAVES DE TEMPLATE QUE O SERVIDOR SABE PREENCHER — fonte única.
//
// Contexto (23/08/2026): o "Reabrir conversa" da Iris envia template com os parâmetros
// preenchidos NO SERVIDOR (preencherParametrosDoTemplate em /api/iris/meta/messages), que
// resolve cada variável do modelo por CHAVE. Chave que o servidor não conhece vira "-" — e
// esse "-" vai NO TEXTO que o cliente recebe ("Sua parcela de - venceu"). Em 23/08 havia 15+
// templates ofertados no reabrir com chaves sem fonte no ticket (variavel_2..5, unidade,
// empreendimento, parcelas, saldo_aberto): esses modelos são de disparo (Apolo/campanha), onde
// o CHAMADOR manda os valores; pelo reabrir sairiam degradados.
//
// Este módulo é a fonte única dos dois lados: a ROTA monta os valores por aqui, e a TELA usa
// `templateSaiCompletoPeloServidor` para só OFERECER no seletor de retomada o que sai correto.
// Chave nova? Adicione o valor em `montarValoresDeTemplate` — o Set e o filtro seguem sozinhos.

export type DadosParaTemplate = {
  assunto: string;
  nomeCompleto: string;
  operador: null | string;
  protocolo: null | string;
};

export function montarValoresDeTemplate(dados: DadosParaTemplate): Record<string, string> {
  const nomeCompleto = dados.nomeCompleto.trim();
  const primeiroNome = nomeCompleto.split(/\s+/)[0] ?? "";

  return {
    // A Meta rejeita o envio inteiro por causa de UM parâmetro em branco — todo valor aqui
    // tem fallback não-vazio.
    assunto: dados.assunto.trim() || "seu atendimento",
    // `cliente` e `nome_cliente` são a mesma coisa com nomes diferentes: templates da Athena
    // saíram com `cliente` (ex.: reprovacao_de_credito_corretor) e o servidor não conhecia a
    // chave — era um dos furos do caso "Reabrir conversa" de 23/08.
    cliente: nomeCompleto || "cliente",
    nome_cliente: nomeCompleto || "cliente",
    operador: dados.operador?.trim() || "equipe Careli",
    primeiro_nome: primeiroNome || "cliente",
    protocolo: dados.protocolo?.trim() || "-",
  };
}

/** As chaves preenchíveis derivam das keys do mapa — impossível descolar da montagem. */
export const CHAVES_DE_TEMPLATE_PREENCHIVEIS: ReadonlySet<string> = new Set(
  Object.keys(
    montarValoresDeTemplate({ assunto: "", nomeCompleto: "", operador: null, protocolo: null }),
  ),
);

/**
 * `true` quando TODAS as variáveis do modelo têm valor certo vindo do servidor.
 * Sem variáveis declaradas não há o que preencher — passa.
 */
export function templateSaiCompletoPeloServidor(variables: unknown): boolean {
  if (!Array.isArray(variables) || variables.length === 0) {
    return true;
  }

  return variables.every(
    (chave) => typeof chave === "string" && CHAVES_DE_TEMPLATE_PREENCHIVEIS.has(chave),
  );
}
