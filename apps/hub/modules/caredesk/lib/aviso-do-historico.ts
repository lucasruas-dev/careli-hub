// O QUE A ABA HISTÓRICO PRECISA DIZER SOBRE SI MESMA.
//
// ⚠️ SEM FOCO, O HISTÓRICO MOSTRA SÓ OS ENCERRADOS — E ISSO É DESENHO, NÃO DEFEITO.
// `iris-history-view.tsx` monta a lista com `focus ? focusTickets : closedTickets`. Quando
// ninguém está em foco, os abertos ficam de fora por escolha: eles são o trabalho e vivem no
// Board. Só que a tela nunca disse isso, e o efeito foi um chamado real em 09/09/2026 — "não
// está trazendo os tickets abertos de um cliente" — onde o sistema estava certo e a tela é que
// não explicava. Quem busca o nome, não acha o atendimento em aberto e conclui que ele sumiu.
//
// Este arquivo é só a decisão de QUANDO falar e O QUE falar. O desenho fica na view.

export type ContextoDoAviso = {
  /** Quantas linhas a busca devolveu. */
  resultados: number;
  /** Há um cliente em foco? Com foco a lista passa a incluir os abertos dele. */
  temFoco: boolean;
  /** O termo digitado na busca. */
  termo: string;
};

/**
 * A frase a mostrar, ou `null` para ficar calado.
 *
 * Fala só quando alguém está BUSCANDO SEM FOCO, que é a única situação em que a pessoa pode
 * concluir errado. Navegando sem buscar, o cabeçalho já basta; com foco, avisar seria mentira,
 * porque ali os abertos entram.
 */
export function avisoDoHistorico({
  resultados,
  temFoco,
  termo,
}: ContextoDoAviso): null | string {
  if (temFoco || termo.trim().length === 0) {
    return null;
  }

  // Busca vazia é onde a conclusão errada nasce, então aqui a frase diz também a outra saída
  // possível: o atendimento pode ser antigo demais para o que já foi carregado.
  if (resultados === 0) {
    return "Esta lista tem apenas atendimentos encerrados. Se o atendimento estiver em aberto, ele está no Board; se for antigo, use \"Carregar atendimentos mais antigos\" abaixo.";
  }

  return "Esta lista tem apenas atendimentos encerrados. Os que estao em aberto ficam no Board.";
}
