// Configuração da integração Serasa Experian (APIs de Crédito).
//
// TUDO vem de variável de ambiente, nada de host no código. Não é preferência de estilo: a
// documentação do Serasa publica TRÊS hosts diferentes (`uat-api` no FAQ, `sandbox-api` no
// swagger, `api` em produção) e DOIS caminhos de token (`client-identities/login` e
// `user-identities/login?clientId=`). Enquanto eles não confirmarem por escrito, chutar no
// código significaria, no pior caso, disparar consulta PAGA em produção achando que é teste.
//
// Ver o levantamento completo em docs/architecture/serasa-credito-integracao.md.

export type AmbienteSerasa = "producao" | "homologacao";

export type ConfigSerasa = {
  ambiente: AmbienteSerasa;
  // URL COMPLETA do login, incluindo o caminho. Fica inteira na env justamente por causa da
  // divergência entre `client-identities` e `user-identities` na documentação.
  authUrl: string;
  clientId: string;
  clientSecret: string;
  // PF e PJ são serviços DIFERENTES, com paths diferentes:
  //   PF: /credit-services/person-information-report/v1/creditreport
  //   PJ: /credit-services/business-information-report/v1/reports
  pfUrl: string;
  pjUrl: string;
  // CNPJ de QUEM CONSULTA (header X-Retailer-Document-Id). Sem ele, a documentação diz que
  // "a contabilização será direcionada para o cliente distribuidor" — ou seja, nossa consulta
  // é cobrada de outra empresa. É por isso que ele é obrigatório aqui.
  retailerDocumentId: string;
  // Código de centro de custo (X-Cost-Center). Máximo 12 posições numéricas: NÃO cabe UUID.
  costCenter: string | null;
};

function env(nome: string): string {
  return process.env[nome]?.trim() ?? "";
}

// Devolve a config OU a lista do que falta. Nunca devolve config pela metade: consulta paga
// com configuração incompleta é o tipo de erro que só aparece na fatura.
export function lerConfigSerasa():
  | { config: ConfigSerasa; ok: true }
  | { faltando: string[]; ok: false } {
  const obrigatorias = [
    "SERASA_AUTH_URL",
    "SERASA_CLIENT_ID",
    "SERASA_CLIENT_SECRET",
    "SERASA_PF_URL",
    "SERASA_PJ_URL",
    "SERASA_RETAILER_DOCUMENT_ID",
  ];

  const faltando = obrigatorias.filter((nome) => !env(nome));
  if (faltando.length > 0) return { faltando, ok: false };

  // Qualquer coisa diferente de "producao" é tratada como homologação. O default seguro é o
  // ambiente que não cobra.
  const ambiente: AmbienteSerasa =
    env("SERASA_AMBIENTE").toLowerCase() === "producao" ? "producao" : "homologacao";

  return {
    config: {
      ambiente,
      authUrl: env("SERASA_AUTH_URL"),
      clientId: env("SERASA_CLIENT_ID"),
      clientSecret: env("SERASA_CLIENT_SECRET"),
      costCenter: env("SERASA_COST_CENTER") || null,
      pfUrl: env("SERASA_PF_URL"),
      pjUrl: env("SERASA_PJ_URL"),
      retailerDocumentId: env("SERASA_RETAILER_DOCUMENT_ID"),
    },
    ok: true,
  };
}

// Trava de segurança: o ambiente declarado tem que bater com o host configurado.
//
// O cenário que isto impede: alguém aponta as URLs para `api.serasaexperian.com.br` (produção)
// mas esquece `SERASA_AMBIENTE=producao`. A tela mostraria "homologação", ninguém se
// preocuparia com custo, e cada clique seria uma consulta cobrada de verdade.
export function ambienteConfere(config: ConfigSerasa): { erro?: string; ok: boolean } {
  const urls = [config.authUrl, config.pfUrl, config.pjUrl];
  const pareceTeste = urls.some((u) => /uat-|sandbox-|homolog/i.test(u));

  if (config.ambiente === "homologacao" && !pareceTeste) {
    return {
      erro:
        "SERASA_AMBIENTE=homologacao, mas as URLs não parecem de teste. " +
        "Confirme antes de consultar: em producao cada consulta e cobrada.",
      ok: false,
    };
  }

  if (config.ambiente === "producao" && pareceTeste) {
    return {
      erro: "SERASA_AMBIENTE=producao, mas as URLs apontam para o ambiente de teste.",
      ok: false,
    };
  }

  return { ok: true };
}
