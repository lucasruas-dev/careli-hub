// OS DOCUMENTOS QUE CADA EMPREENDIMENTO PRECISA TER CADASTRADOS.
//
// Regra do Lucas (02/09/2026): *"vamos ter que incluir no setup, a minuta, termo de cessão, termo de
// distrato por empreendimento"*, e depois *"vamos colocar também um campo para o cancelamento"*.
//
// ⚠️ SÃO POR EMPREENDIMENTO, E NÃO DA CARELI. Não existe "termo de distrato da casa": existe o do
// JDG e o do ACP, cada um com o texto que o loteador daquele empreendimento aprovou. Um modelo
// único economizaria cadastro e produziria documento que não corresponde ao contrato assinado.
//
// ⚠️ E É AQUI QUE O TRABALHO TRAVA ANTES DE COMEÇAR. Uma cessão aberta num empreendimento sem termo
// de cessão cadastrado chega à confecção e para — depois de o cedente já ter sido avisado, de a taxa
// já ter sido cobrada e de o cessionário já ter feito cadastro. Por isso o board precisa dizer o que
// falta no Setup ANTES de o serviço estar disponível.

import type { TipoDeTrabalho } from "./trabalhos";

/**
 * ⚠️ SÃO OS MESMOS VALORES DE `temis_minutas.tipo`, e não um vocabulário paralelo. A tabela já
 * guarda documento com tipo e versão desde a migration 0113; inventar `termo_distrato` aqui faria o
 * documento publicado como `distrato` nunca casar com o serviço que o procura — e o empreendimento
 * apareceria como "sem termo" com o termo cadastrado.
 */
export type TipoDeDocumento = "cancelamento" | "cessao" | "contrato" | "distrato";

export const NOME_DO_DOCUMENTO: Record<TipoDeDocumento, string> = {
  cancelamento: "Termo de cancelamento",
  cessao: "Termo de cessão",
  contrato: "Minuta do contrato",
  distrato: "Termo de distrato",
};

/**
 * Qual documento cada serviço gera.
 *
 * ⚠️ O CANCELAMENTO POR CORREÇÃO USA A MINUTA DO CONTRATO, e não um termo próprio: corrigir é
 * refazer o contrato com o dado certo, e o comprador assina o mesmo instrumento de novo. Um "termo
 * de correção" seria um documento a mais para o empreendimento cadastrar e manter — e um a mais que
 * pode faltar bem na hora.
 */
export const DOCUMENTO_DO_SERVICO: Record<TipoDeTrabalho, TipoDeDocumento> = {
  cancelamento: "cancelamento",
  cancelamento_correcao: "contrato",
  cessao: "cessao",
  contrato: "contrato",
  distrato: "distrato",
};

export type PreparoDoEmpreendimento = {
  /** Os tipos de documento que já têm versão publicada. */
  documentosPublicados: TipoDeDocumento[];
  /** A taxa de cessão está cadastrada? `null` = não configurada. */
  taxaDeCessao: null | number;
};

export type ServicoDisponivel =
  | { faltando: string[]; ok: false }
  | { ok: true };

/**
 * O empreendimento consegue atender este serviço hoje?
 *
 * ⚠️ A TAXA ZERADA É DIFERENTE DE TAXA AUSENTE. `0` é uma decisão — a casa não cobra pela cessão
 * naquele empreendimento — e `null` é ninguém ter configurado. Tratar os dois igual faria a cessão
 * travar onde a isenção é intencional, ou sair de graça onde alguém esqueceu de preencher.
 */
export function servicoDisponivel(
  servico: TipoDeTrabalho,
  preparo: PreparoDoEmpreendimento,
): ServicoDisponivel {
  const faltando: string[] = [];

  const documento = DOCUMENTO_DO_SERVICO[servico];
  if (!preparo.documentosPublicados.includes(documento)) {
    faltando.push(`${NOME_DO_DOCUMENTO[documento]} não publicado`);
  }

  if (servico === "cessao" && preparo.taxaDeCessao === null) {
    faltando.push("taxa de cessão não configurada");
  }

  return faltando.length > 0 ? { faltando, ok: false } : { ok: true };
}

/** Tudo que falta no Setup, para o board mostrar de uma vez. */
export function oQueFaltaNoSetup(preparo: PreparoDoEmpreendimento): {
  servico: TipoDeTrabalho;
  faltando: string[];
}[] {
  const servicos: TipoDeTrabalho[] = [
    "contrato",
    "cessao",
    "distrato",
    "cancelamento",
    "cancelamento_correcao",
  ];
  return servicos
    .map((servico) => ({ resultado: servicoDisponivel(servico, preparo), servico }))
    .filter((x): x is { resultado: { faltando: string[]; ok: false }; servico: TipoDeTrabalho } =>
      !x.resultado.ok,
    )
    .map((x) => ({ faltando: x.resultado.faltando, servico: x.servico }));
}
