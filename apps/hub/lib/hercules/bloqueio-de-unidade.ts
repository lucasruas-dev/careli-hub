// O BLOQUEIO DE UNIDADE — tirar um lote da venda sem que haja comprador.
//
// Lucas (14/09/2026): *"o coordenador pode bloquear as unidades. então vamos ter que ter um botão
// que bloqueia essa unidade ae ter um campo de justificativa do bloqueio"* · *"não pode ter nenhuma
// proposta, reserva, contrato, o bloqueio aparece somente quando não há nada na unidade. se tiver
// uma reserva, primeiro ele cancela a reserva para depois bloquear o lote"* · e, sobre a forma do
// botão: *"o botão fica apagado mas sem mensagem nenhuma quando tem reserva, proposta assinatura,
// fatura, ou seja, ele só ficará disponível quando a unidade estiver disponível"*.
//
// ⚠️ BLOQUEIO NÃO É RESERVA, e a diferença está escrita desde a migration 0112: *"`bloqueada` é
// diferente de `reservada`: bloqueio é decisão da empresa (permuta, lote da diretoria, matrícula com
// problema) e não tem comprador nem prazo"*. Reserva tem dono e vence sozinha; bloqueio não tem
// nenhum dos dois, e por isso precisa de um humano para desfazer — e de um motivo escrito para que
// alguém, daqui a três meses, saiba se ainda vale.

/**
 * A etapa da unidade, como a tela Venda a calcula.
 *
 * ⚠️ É A ETAPA, E NÃO A COLUNA `situacao`, QUE RESPONDE "TEM ALGO AQUI". As duas já discordam em
 * produção: 38 unidades estão `situacao = 'bloqueada'` no cadastro E têm proposta VIVA no fluxo. A
 * etapa nasce de `fluxo-de-venda.ts`, onde a proposta viva MANDA sobre o cadastro — é ela que sabe
 * de reserva, proposta, contrato, assinatura e faturamento.
 */
export type EtapaDaUnidade = string;

/**
 * Esta unidade pode ser bloqueada?
 *
 * ⚠️ UM ÚNICO `disponivel`, E NÃO UMA LISTA DE PROIBIDOS. A regra do Lucas é pela positiva — *"ele
 * só ficará disponível quando a unidade estiver disponível"* — e escrever assim fecha o portão
 * sozinho: etapa nova que apareça amanhã (um "em análise", um "permutado") entra pelo lado seguro,
 * sem que ninguém precise lembrar de acrescentá-la a uma lista de bloqueados.
 *
 * ⚠️ E `bloqueada` TAMBÉM NÃO PASSA — bloquear o que já está bloqueado sobrescreveria o motivo do
 * primeiro bloqueio sem deixar rastro, porque a coluna é uma só.
 */
export function podeBloquear(etapa: null | string | undefined): boolean {
  return String(etapa ?? "").trim().toLowerCase() === "disponivel";
}

/**
 * Os motivos de bloqueio.
 *
 * ⚠️ NÃO SÃO OS MOTIVOS DE CANCELAMENTO, e reusar aqueles seria o erro fácil. A lista de
 * `MOTIVOS_DE_CANCELAMENTO` (`reserva.ts`) fala de VENDA que não aconteceu — "Cliente desistiu",
 * "Crédito não aprovado", "Prazo esgotado". Bloqueio não tem cliente nenhum: é a empresa retirando
 * o lote de oferta. Os três primeiros abaixo são os que a própria migration 0112 nomeia como o caso
 * de uso, escritos lá um ano antes de existir tela.
 */
export const MOTIVOS_DE_BLOQUEIO = [
  "Permuta",
  "Lote da diretoria",
  "Matrícula com problema",
  "Área institucional ou de infraestrutura",
  "Reserva técnica do loteamento",
  "Pendência jurídica",
  "Outro",
] as const;

export type MotivoDeBloqueio = (typeof MOTIVOS_DE_BLOQUEIO)[number];

/** Quando o motivo é este, o detalhe passa a ser obrigatório. */
export const MOTIVO_ABERTO: MotivoDeBloqueio = "Outro";

/** Teto do detalhe. Generoso para caber uma frase inteira, curto o bastante para caber na tela. */
export const LIMITE_DO_DETALHE = 240;

export type PedidoDeBloqueio = {
  detalhe: string;
  motivo: string;
  unidadeId: string;
};

/**
 * O formato de erro da casa: campo + frase.
 *
 * ⚠️ É O MESMO DE `conferirCancelamento`, E NÃO POR COPIAR POR COPIAR. A modal do motivo já lê este
 * formato para pintar o erro ABAIXO DO CAMPO certo (`erroDe("motivo")`, `erroDe("detalhe")`).
 * Devolver uma lista de frases soltas faria o bloqueio ser o único alvo da modal com o erro no
 * lugar errado.
 */
export type ErroDoBloqueio = { campo: "detalhe" | "motivo" | "unidade"; mensagem: string };

/**
 * Confere o pedido e devolve TODOS os erros.
 *
 * ⚠️ TODOS, E NÃO O PRIMEIRO. É a mesma escolha de `conferirCancelamento`: devolver um erro por vez
 * faz a pessoa descobrir o segundo problema depois de consertar o primeiro, e a modal tem espaço
 * para mostrar os dois.
 *
 * ⚠️ ESTA FUNÇÃO RODA DUAS VEZES, DE PROPÓSITO: na tela, para não deixar confirmar, e na rota, para
 * não aceitar pedido forjado. Escrever só a da tela deixa a rota aceitando motivo vazio; escrever
 * só a da rota faz a pessoa descobrir o problema depois de clicar.
 */
export function conferirBloqueio(pedido: PedidoDeBloqueio): ErroDoBloqueio[] {
  const erros: ErroDoBloqueio[] = [];
  const motivo = String(pedido.motivo ?? "").trim();
  const detalhe = String(pedido.detalhe ?? "").trim();

  if (!String(pedido.unidadeId ?? "").trim()) {
    erros.push({ campo: "unidade", mensagem: "Escolha a unidade." });
  }

  if (!motivo) {
    erros.push({ campo: "motivo", mensagem: "Escolha o motivo do bloqueio." });
  } else if (!(MOTIVOS_DE_BLOQUEIO as readonly string[]).includes(motivo)) {
    erros.push({ campo: "motivo", mensagem: "Motivo de bloqueio desconhecido." });
  }

  if (motivo === MOTIVO_ABERTO && !detalhe) {
    erros.push({ campo: "detalhe", mensagem: "Escreva o motivo do bloqueio." });
  }

  if (detalhe.length > LIMITE_DO_DETALHE) {
    erros.push({
      campo: "detalhe",
      mensagem: `O motivo tem no máximo ${LIMITE_DO_DETALHE} caracteres.`,
    });
  }

  return erros;
}

/**
 * O texto que vai para `bloqueio_motivo`.
 *
 * ⚠️ O MOTIVO ESCOLHIDO ENTRA SEMPRE, mesmo quando há detalhe. Quem lê daqui a três meses precisa
 * da categoria para decidir se o bloqueio ainda vale — "Matrícula com problema · aguardando
 * retificação no cartório" responde a pergunta; só o detalhe, não. É a mesma forma de
 * `motivoEscrito` no cancelamento.
 */
export function motivoDoBloqueio(pedido: PedidoDeBloqueio): string {
  const motivo = String(pedido.motivo ?? "").trim();
  const detalhe = String(pedido.detalhe ?? "").trim();
  return detalhe ? `${motivo} · ${detalhe}` : motivo;
}

/**
 * Este bloqueio foi feito AQUI, ou veio do retrato do C2X?
 *
 * ⚠️ A AUSÊNCIA DE AUTOR É O SINAL, e é por isso que a 0163 não inventou autor para o passado. As
 * 1.554 unidades bloqueadas hoje vieram da carga de 01/09 e não têm dono; um bloqueio nosso tem
 * carimbo. Quem precisa distinguir — a carga do C2X, antes de sobrescrever, e o histórico da
 * unidade — pergunta aqui.
 */
export function ehBloqueioNativo(unidade: { bloqueado_em?: null | string }): boolean {
  return typeof unidade.bloqueado_em === "string" && unidade.bloqueado_em.length > 0;
}
