// A CESSÃO — o contrato não acaba, muda de dono.
//
// Regra do Lucas (02/09/2026): *"ele só pode nascer se a unidade não estiver inadimplente, se tiver
// adimplente, vai abrir o forms para puxar o novo cessionário (ou seja, esse vai ter que ter feito o
// cadastro do apolo antes) se não tiver não segue"*.
//
// ⚠️ AS DUAS TRAVAS SÃO DE ENTRADA, NÃO DE CHECKLIST, e essa diferença é o ponto. Atividade de
// checklist é coisa que alguém faz; trava de entrada é coisa que impede a solicitação de existir.
// Deixar a cessão nascer com a unidade inadimplente e cobrar isso depois, numa atividade, cria um
// card que atravessa metade do board para morrer — e nesse meio-tempo o cedente já foi avisado de
// que a transferência está em andamento.
//
// ⚠️ A INADIMPLÊNCIA É DA UNIDADE, E NÃO DO CEDENTE. Quem está saindo pode dever outra coisa em
// outro contrato; o que impede a cessão é a dívida DAQUELE imóvel, que passaria para o cessionário
// junto com o resto.
//
// ⚠️ O CESSIONÁRIO PRECISA DE CADASTRO NO APOLO ANTES. Não é burocracia: entra um devedor novo num
// contrato que continua, e é o cadastro do Apolo que traz documento, cônjuge e a validação que a
// minuta exige. Sem ele, a cessão pararia na confecção esperando dado que ninguém pediu.

export type MotivoDeRecusa = "cessionario_sem_cadastro" | "unidade_inadimplente";

export type PodeAbrirCessao =
  | { motivo: MotivoDeRecusa; ok: false; porque: string }
  | { ok: true };

export type FatosDaCessao = {
  /** O cessionário já tem cadastro no Apolo? */
  cessionarioTemCadastro: boolean;
  /** Quantas parcelas da unidade estão vencidas e não pagas. */
  parcelasEmAtraso: number;
};

/**
 * A cessão pode ser aberta?
 *
 * ⚠️ A ORDEM DAS DUAS TRAVAS IMPORTA PARA QUEM ATENDE. A inadimplência é conferida primeiro porque
 * é a que encerra o assunto: se a unidade deve, não adianta procurar o cessionário. Perguntar pelo
 * cadastro antes faria o atendente ir atrás de um dado que não vai ser usado.
 */
export function podeAbrirCessao(fatos: FatosDaCessao): PodeAbrirCessao {
  if (fatos.parcelasEmAtraso > 0) {
    return {
      motivo: "unidade_inadimplente",
      ok: false,
      porque:
        fatos.parcelasEmAtraso === 1
          ? "a unidade tem 1 parcela em atraso: a cessão só abre com a unidade em dia"
          : `a unidade tem ${fatos.parcelasEmAtraso} parcelas em atraso: a cessão só abre com a unidade em dia`,
    };
  }

  if (!fatos.cessionarioTemCadastro) {
    return {
      motivo: "cessionario_sem_cadastro",
      ok: false,
      porque:
        "o cessionário precisa ter cadastro no Apolo antes: é dele que vêm documento, cônjuge e a validação que o termo exige",
    };
  }

  return { ok: true };
}
